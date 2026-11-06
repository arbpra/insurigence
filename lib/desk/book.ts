/**
 * The book of business: insured accounts, their policies and who at the agency
 * is assigned to them (client answer Q3). What a user can see always comes from
 * the access layer's filters, so nobody reaches another agency's accounts here;
 * anything out of scope is a 404 with an audit entry.
 *
 * Who may do what:
 *  - agency users edit the accounts they can see, and add accounts (a user who
 *    sees only assigned accounts is assigned to the one they add);
 *  - agency admins, Account Managers and Insurigence admins also deactivate
 *    accounts and assign staff (Q3: "the agency admin manages these permissions");
 *  - VAs read only, and only what they need: no notes, premiums or staff list
 *    (Q4: "only see the information necessary to complete their assigned work").
 *
 * Accounts are deactivated, never deleted: requests and their history refer to
 * them. Text that reads like a password is refused, as everywhere in The Desk.
 */
import { Prisma, PolicyStatus, InsuredAssignmentRole, type InsuredStatus, type PrismaClient } from '@prisma/client';
import { canBeAssignedToInsured, defaultAssignmentRole } from '@/lib/roles';
import {
  canManageAgencyAccess, DeskAccessError, getInsuredForScope, getPolicyForScope, insuredWhere, isObjectId, policyWhere,
  scopeAgencyIds, type DeskScope, type GuardContext,
} from './access';
import { ACCOUNT_NAME_MAX, CONTACT_EMAIL_MAX, INSURED_TEXT, type TextRule } from './account-form';
import { recordAudit, type AuditAction } from './audit';
import { insuredNameKey } from './insureds';
import { literal } from './literal-match';
import { looksLikeCredential } from './profile';
import { CLOSED_STATUSES } from './task-filters';

type Db = PrismaClient;
type Tx = Prisma.TransactionClient;

const TX_OPTIONS = { timeout: 20_000, maxWait: 10_000 };
const OPEN_TASK = { status: { notIn: [...CLOSED_STATUSES] } };
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_PREMIUM_CENTS = 100_000_000_000; // $1 billion: anything above is a typing error
const MAX_PAGE_SIZE = 100;
const MAX_PAGE = 1_000_000;
const MAX_SEARCH = 200;
const CHANGED_ELSEWHERE = 'Someone else just changed this. Reload to see their changes, then try again.';

const bad = (message: string) => new DeskAccessError(400, message);
const conflict = (message: string, code?: string) => new DeskAccessError(409, message, code);

async function inTransaction<T>(db: Db, fn: (tx: Tx) => Promise<T>): Promise<T> {
  try {
    return await db.$transaction(fn, TX_OPTIONS);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2034') throw conflict(CHANGED_ELSEWHERE);
    throw err;
  }
}

function audit(db: Pick<Db, 'deskAuditLog'> | Tx, scope: DeskScope, ctx: GuardContext, action: AuditAction, entityType: string, entityId: string, agencyId: string, metadata: Record<string, unknown>) {
  return recordAudit(db, { actor: { id: scope.userId, role: scope.role }, action, entityType, entityId, agencyId, metadata, ip: ctx.ip, userAgent: ctx.userAgent });
}

/** A refusal of something the user's role may not do on a record they can see. Logged. */
async function forbid(db: Db, scope: DeskScope, ctx: GuardContext, entityType: string, entityId: string, agencyId: string | null, op: string, message: string): Promise<never> {
  try {
    await recordAudit(db, { actor: { id: scope.userId, role: scope.role }, action: 'access.denied', entityType, entityId, agencyId, metadata: { op, scope: scope.kind }, ip: ctx.ip, userAgent: ctx.userAgent });
  } catch (err) {
    console.error('[desk/book] could not log refused action', err);
  }
  throw new DeskAccessError(403, message);
}

/** VAs work requests; they do not change the book. */
const canEdit = (scope: DeskScope) => scope.kind === 'AGENCY' || scope.kind === 'ACCOUNT_MANAGER' || scope.kind === 'PLATFORM';

/** Deactivating an account and assigning staff: the agency's admin, its Account Manager, Insurigence admins. */
function canManage(scope: DeskScope, agencyId: string): boolean {
  if (scope.kind === 'ACCOUNT_MANAGER') return scope.agencyIds.includes(agencyId);
  return canManageAgencyAccess(scope, agencyId);
}

// ── Field rules ──

const POLICY_TEXT: Record<string, TextRule> = {
  policyNumber: { label: 'Policy number', max: 100 },
  lineOfBusiness: { label: 'Line of business', max: 100 },
  carrierName: { label: 'Carrier', max: 200 },
  notes: { label: 'Notes', max: 2000, screen: true },
  externalRef: { label: 'AMS reference', max: 100 },
};

function text(value: unknown, rule: TextRule): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') throw bad(`${rule.label} must be text.`);
  const t = value.trim();
  if (t.length > rule.max) throw bad(`${rule.label} must be ${rule.max.toLocaleString('en-US')} characters or fewer.`);
  if (rule.screen) {
    const reason = looksLikeCredential(t);
    if (reason) throw bad(reason);
  }
  return t || null;
}

function requiredName(value: unknown): string {
  const name = text(value, { label: 'Account name', max: ACCOUNT_NAME_MAX });
  if (!name) throw bad('Account name is required.');
  return name;
}

function email(value: unknown): string | null {
  const t = text(value, { label: 'Contact email', max: CONTACT_EMAIL_MAX });
  if (t && !EMAIL_RE.test(t)) throw bad('Contact email is not a valid address.');
  return t ? t.toLowerCase() : null;
}

function day(value: unknown, label: string): Date | null {
  if (value === null || value === undefined || value === '') return null;
  const m = typeof value === 'string' ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(value) : null;
  if (!m) throw bad(`${label} must be a date (YYYY-MM-DD).`);
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  if (d.toISOString().slice(0, 10) !== value) throw bad(`${label} is not a real date.`);
  return d;
}

/** Only the listed fields are ever read from a request, so nothing else can be set through this API. */
function insuredFields(input: Record<string, unknown>) {
  const data: Record<string, string | null> = {};
  for (const [field, rule] of Object.entries(INSURED_TEXT)) {
    if (input[field] !== undefined) data[field] = text(input[field], rule);
  }
  if (input.contactEmail !== undefined) data.contactEmail = email(input.contactEmail);
  return data;
}

function policyFields(input: Record<string, unknown>) {
  const data: Prisma.PolicyUncheckedUpdateInput = {};
  const record = data as Record<string, unknown>;
  for (const [field, rule] of Object.entries(POLICY_TEXT)) {
    if (input[field] !== undefined) record[field] = text(input[field], rule);
  }
  if (input.effectiveDate !== undefined) data.effectiveDate = day(input.effectiveDate, 'Effective date');
  if (input.expirationDate !== undefined) data.expirationDate = day(input.expirationDate, 'Expiration date');
  if (input.premiumCents !== undefined) {
    const p = input.premiumCents;
    if (p === null) data.premiumCents = null;
    else if (typeof p !== 'number' || !Number.isInteger(p) || p < 0 || p > MAX_PREMIUM_CENTS) throw bad('Premium must be a whole number of cents, 0 or more.');
    else data.premiumCents = BigInt(p);
  }
  if (input.status !== undefined) {
    if (!(Object.values(PolicyStatus) as unknown[]).includes(input.status)) throw bad('Unknown policy status.');
    data.status = input.status as PolicyStatus;
  }
  return data;
}

function assertDates(effective: Date | null | undefined, expiration: Date | null | undefined) {
  if (effective && expiration && expiration.getTime() <= effective.getTime()) throw bad('Expiration date must be after the effective date.');
}

const sameValue = (a: unknown, b: unknown) => (a instanceof Date && b instanceof Date ? a.getTime() === b.getTime() : (a ?? null) === (b ?? null));

// ── Views ──

const personName = (u: { firstName: string | null; lastName: string | null; email: string }) =>
  [u.firstName, u.lastName].filter(Boolean).join(' ') || u.email;

type PolicyRow = Awaited<ReturnType<Db['policy']['findFirstOrThrow']>>;

function policyView(p: PolicyRow, scope: DeskScope) {
  const dateOnly = (d: Date | null) => d?.toISOString().slice(0, 10) ?? null;
  return {
    id: p.id, insuredId: p.insuredId, policyNumber: p.policyNumber, lineOfBusiness: p.lineOfBusiness, carrierName: p.carrierName,
    effectiveDate: dateOnly(p.effectiveDate), expirationDate: dateOnly(p.expirationDate), status: p.status, externalRef: p.externalRef,
    // Need-to-know: premiums and notes are not part of a VA's work.
    ...(scope.kind === 'VA' ? {} : { premiumCents: p.premiumCents === null ? null : Number(p.premiumCents), notes: p.notes }),
  };
}

// ── Listing and reading ──

export interface InsuredListOptions {
  q?: string;
  status?: InsuredStatus;
  /** Only accounts assigned to the person asking. */
  mine?: boolean;
  /** Narrow to one agency (Account Managers and Insurigence admins). */
  agencyId?: string;
  page?: number;
  pageSize?: number;
}

export async function listInsureds(db: Db, scope: DeskScope, opts: InsuredListOptions = {}) {
  const pageSize = Math.min(Math.max(1, Math.trunc(opts.pageSize ?? 25)), MAX_PAGE_SIZE);
  // An absurd ?page= is an empty page, not a database error.
  const page = Number.isFinite(opts.page) ? Math.min(Math.max(1, Math.trunc(opts.page!)), MAX_PAGE) : 1;
  const q = opts.q?.trim().slice(0, MAX_SEARCH);
  const text = q ? literal(q) : '';
  const key = q ? literal(insuredNameKey(q)) : '';
  const where: Prisma.InsuredAccountWhereInput = {
    AND: [
      insuredWhere(scope),
      opts.status ? { status: opts.status } : {},
      opts.agencyId && isObjectId(opts.agencyId) ? { agencyId: opts.agencyId } : {},
      opts.mine ? { assignments: { some: { userId: scope.userId } } } : {},
      q ? {
        OR: [
          { name: { contains: text, mode: 'insensitive' } },
          { nameKey: { contains: key } },
          { dba: { contains: text, mode: 'insensitive' } },
          { contactName: { contains: text, mode: 'insensitive' } },
          { contactEmail: { contains: text, mode: 'insensitive' } },
          { externalRef: { contains: text, mode: 'insensitive' } },
          // Only policies this user may see: otherwise a search could confirm a number they have no access to.
          { policies: { some: { AND: [policyWhere(scope), { policyNumber: { contains: text, mode: 'insensitive' } }] } } },
        ],
      } : {},
    ],
  };
  const isVa = scope.kind === 'VA';
  const [total, rows] = await Promise.all([
    db.insuredAccount.count({ where }),
    db.insuredAccount.findMany({
      where,
      orderBy: [{ nameKey: 'asc' }, { id: 'asc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true, agencyId: true, name: true, dba: true, status: true, contactName: true, city: true, state: true, externalRef: true, source: true,
        policies: { where: policyWhere(scope), select: { id: true } },
        assignments: { select: { role: true, user: { select: { id: true, firstName: true, lastName: true, email: true } } } },
      },
    }),
  ]);
  const open = rows.length
    ? await db.task.groupBy({ by: ['insuredId'], where: { insuredId: { in: rows.map((r) => r.id) }, ...OPEN_TASK }, _count: { _all: true } })
    : [];
  const openBy = new Map(open.map((o) => [o.insuredId, o._count._all]));
  return {
    total, page, pageSize,
    insureds: rows.map(({ policies, assignments, ...r }) => ({
      ...r,
      policyCount: policies.length,
      // A VA sees requests only through their own work, and has no need of the staff list.
      ...(isVa ? {} : {
        openTasks: openBy.get(r.id) ?? 0,
        assignments: assignments.map((a) => ({ userId: a.user.id, name: personName(a.user), role: a.role })),
      }),
    })),
  };
}

/** One account with its policies. Every read is logged. */
export async function getInsured(db: Db, scope: DeskScope, insuredId: string, ctx: GuardContext = {}) {
  const row = await getInsuredForScope(db, scope, insuredId, ctx);
  const isVa = scope.kind === 'VA';
  const [policies, assignments, openTasks] = await Promise.all([
    db.policy.findMany({ where: { AND: [{ insuredId: row.id }, policyWhere(scope)] }, orderBy: [{ expirationDate: 'asc' }, { id: 'asc' }] }),
    isVa ? [] : db.insuredAssignment.findMany({ where: { insuredId: row.id }, select: { role: true, user: { select: { id: true, firstName: true, lastName: true, email: true, isActive: true } } } }),
    isVa ? 0 : db.task.count({ where: { insuredId: row.id, ...OPEN_TASK } }),
  ]);
  await audit(db, scope, ctx, 'insured.viewed', 'InsuredAccount', row.id, row.agencyId, {});
  const manages = canManage(scope, row.agencyId);
  const { nameKey: _nameKey, importBatchId: _batch, convertedFromLeadId: _lead, createdById: _by, ...fields } = row;
  return {
    ...(isVa ? (({ notes: _notes, ...rest }) => rest)(fields) : fields),
    version: row.updatedAt.toISOString(),
    policies: policies.map((p) => policyView(p, scope)),
    ...(isVa ? {} : {
      openTasks,
      assignments: assignments.map((a) => ({ userId: a.user.id, name: personName(a.user), role: a.role, isActive: a.user.isActive })),
    }),
    can: { edit: canEdit(scope), manage: manages },
  };
}

// ── Accounts ──

/** Where a new account goes: the user's own agency, or one the staff member covers. */
async function targetAgency(db: Db, scope: DeskScope, requested: unknown, ctx: GuardContext): Promise<string> {
  if (scope.kind === 'AGENCY') return scope.agencyId;
  if (!canEdit(scope)) return forbid(db, scope, ctx, 'InsuredAccount', 'create', null, 'create', 'Only agency users and Account Managers add accounts.');
  if (!isObjectId(requested)) throw bad('Choose an agency.');
  const allowed = scopeAgencyIds(scope);
  if (allowed !== 'ALL' && !allowed.includes(requested)) throw new DeskAccessError(404, 'Not found');
  const agency = await db.agency.findUnique({ where: { id: requested }, select: { deskEnabled: true } });
  if (!agency?.deskEnabled) throw new DeskAccessError(404, 'Not found');
  return requested;
}

/** Refuses a same-named active account in the agency, unless the request confirms it. Says only that one exists. */
async function assertNotDuplicate(db: Db, agencyId: string, nameKey: string, exceptId?: string): Promise<void> {
  const same = await db.insuredAccount.count({ where: { agencyId, nameKey, status: 'ACTIVE', ...(exceptId ? { id: { not: exceptId } } : {}) } });
  if (same) throw conflict('An account with this name already exists in this agency.', 'DUPLICATE_NAME');
}

export async function createInsured(db: Db, scope: DeskScope, input: Record<string, unknown>, ctx: GuardContext = {}): Promise<{ id: string }> {
  const agencyId = await targetAgency(db, scope, input.agencyId, ctx);
  const name = requiredName(input.name);
  const nameKey = insuredNameKey(name);
  const fields = insuredFields(input);
  if (input.allowDuplicate !== true) await assertNotDuplicate(db, agencyId, nameKey);
  return inTransaction(db, async (tx) => {
    const created = await tx.insuredAccount.create({
      data: { ...fields, agencyId, name, nameKey, source: 'MANUAL', createdById: scope.userId },
      select: { id: true },
    });
    // Otherwise someone who sees only assigned accounts could not see what they just added.
    let assigned = false;
    if (scope.kind === 'AGENCY' && scope.book === 'ASSIGNED') {
      await tx.insuredAssignment.create({ data: { agencyId, insuredId: created.id, userId: scope.userId, role: defaultAssignmentRole(scope.role), createdById: scope.userId } });
      assigned = true;
    }
    await audit(tx, scope, ctx, 'insured.created', 'InsuredAccount', created.id, agencyId, { source: 'MANUAL', assignedToCreator: assigned });
    return created;
  });
}

/**
 * Saves the fields present. `status` deactivates or reactivates, for those who
 * manage the agency; an account with open requests cannot be deactivated.
 */
export async function updateInsured(db: Db, scope: DeskScope, insuredId: string, input: Record<string, unknown>, ctx: GuardContext = {}): Promise<void> {
  const current = await getInsuredForScope(db, scope, insuredId, ctx);
  if (!canEdit(scope)) return forbid(db, scope, ctx, 'InsuredAccount', current.id, current.agencyId, 'update', 'VAs cannot change accounts.');
  if (input.version !== undefined && input.version !== current.updatedAt.toISOString()) throw conflict(CHANGED_ELSEWHERE, 'CHANGED_ELSEWHERE');

  const fields: Prisma.InsuredAccountUpdateManyMutationInput = insuredFields(input);
  if (input.name !== undefined) {
    const name = requiredName(input.name);
    fields.name = name;
    const nameKey = insuredNameKey(name);
    fields.nameKey = nameKey;
    if (nameKey !== current.nameKey && input.allowDuplicate !== true) await assertNotDuplicate(db, current.agencyId, nameKey, current.id);
  }
  if (input.status !== undefined) {
    if (input.status !== 'ACTIVE' && input.status !== 'INACTIVE') throw bad('Unknown account status.');
    if (input.status !== current.status) {
      if (!canManage(scope, current.agencyId)) return forbid(db, scope, ctx, 'InsuredAccount', current.id, current.agencyId, 'status', 'Only an agency admin or Account Manager can change an account\'s status.');
      if (input.status === 'INACTIVE') {
        const open = await db.task.count({ where: { insuredId: current.id, ...OPEN_TASK } });
        if (open) throw conflict(`This account has ${open} open request${open === 1 ? '' : 's'}. Complete or cancel them first.`);
      } else if (input.allowDuplicate !== true) {
        // Another active account may have taken this name while this one was inactive.
        await assertNotDuplicate(db, current.agencyId, (fields.nameKey as string | undefined) ?? current.nameKey, current.id);
      }
      fields.status = input.status;
    }
  }

  const record = current as unknown as Record<string, unknown>;
  const changed = Object.entries(fields).filter(([k, v]) => !sameValue(v, record[k])).map(([k]) => k).filter((k) => k !== 'nameKey');
  if (changed.length === 0) return;

  await inTransaction(db, async (tx) => {
    const { count } = await tx.insuredAccount.updateMany({ where: { id: current.id, updatedAt: current.updatedAt }, data: fields });
    if (count !== 1) throw conflict(CHANGED_ELSEWHERE);
    // Field names only: the audit log is not another copy of the client's details.
    await audit(tx, scope, ctx, 'insured.updated', 'InsuredAccount', current.id, current.agencyId, { changed });
  });
}

// ── Policies ──

export async function addPolicy(db: Db, scope: DeskScope, insuredId: string, input: Record<string, unknown>, ctx: GuardContext = {}): Promise<{ id: string }> {
  const insured = await getInsuredForScope(db, scope, insuredId, ctx, { id: true, agencyId: true });
  if (!canEdit(scope)) return forbid(db, scope, ctx, 'Policy', insured.id, insured.agencyId, 'create', 'VAs cannot change policies.');
  const data = policyFields(input);
  assertDates(data.effectiveDate as Date | null | undefined, data.expirationDate as Date | null | undefined);
  const number = data.policyNumber as string | null | undefined;
  if (number) {
    const same = await db.policy.count({ where: { insuredId: insured.id, policyNumber: number } });
    if (same) throw conflict('This account already has a policy with that number.');
  }
  return inTransaction(db, async (tx) => {
    const created = await tx.policy.create({
      data: { ...(data as Prisma.PolicyUncheckedCreateInput), agencyId: insured.agencyId, insuredId: insured.id, createdById: scope.userId },
      select: { id: true },
    });
    await audit(tx, scope, ctx, 'policy.created', 'Policy', created.id, insured.agencyId, { insuredId: insured.id });
    return created;
  });
}

/** Saves the fields present. Open requests keep the due dates they already have. */
export async function updatePolicy(db: Db, scope: DeskScope, policyId: string, input: Record<string, unknown>, ctx: GuardContext = {}): Promise<void> {
  const current = await getPolicyForScope(db, scope, policyId, ctx);
  if (!canEdit(scope)) return forbid(db, scope, ctx, 'Policy', current.id, current.agencyId, 'update', 'VAs cannot change policies.');
  if (input.version !== undefined && input.version !== current.updatedAt.toISOString()) throw conflict(CHANGED_ELSEWHERE);
  const data = policyFields(input);
  const nextEffective = data.effectiveDate !== undefined ? data.effectiveDate as Date | null : current.effectiveDate;
  const nextExpiration = data.expirationDate !== undefined ? data.expirationDate as Date | null : current.expirationDate;
  assertDates(nextEffective, nextExpiration);
  const number = data.policyNumber as string | null | undefined;
  if (number && number !== current.policyNumber) {
    const same = await db.policy.count({ where: { insuredId: current.insuredId, policyNumber: number, id: { not: current.id } } });
    if (same) throw conflict('This account already has a policy with that number.');
  }
  const record = current as unknown as Record<string, unknown>;
  const changed = Object.entries(data).filter(([k, v]) => !sameValue(v, record[k])).map(([k]) => k);
  if (changed.length === 0) return;
  await inTransaction(db, async (tx) => {
    const { count } = await tx.policy.updateMany({ where: { id: current.id, updatedAt: current.updatedAt }, data: data as Prisma.PolicyUpdateManyMutationInput });
    if (count !== 1) throw conflict(CHANGED_ELSEWHERE);
    await audit(tx, scope, ctx, 'policy.updated', 'Policy', current.id, current.agencyId, { insuredId: current.insuredId, changed });
  });
}

/** For a policy entered by mistake. One with requests stays, and is marked cancelled or expired instead. */
export async function removePolicy(db: Db, scope: DeskScope, policyId: string, ctx: GuardContext = {}): Promise<void> {
  const current = await getPolicyForScope(db, scope, policyId, ctx);
  if (!canEdit(scope)) return forbid(db, scope, ctx, 'Policy', current.id, current.agencyId, 'remove', 'VAs cannot change policies.');
  const used = await db.task.count({ where: { policyId: current.id } });
  if (used) throw conflict(`This policy has ${used} request${used === 1 ? '' : 's'} on record, so it can't be removed. Change its status instead.`);
  await inTransaction(db, async (tx) => {
    await tx.policy.delete({ where: { id: current.id } });
    await audit(tx, scope, ctx, 'policy.removed', 'Policy', current.id, current.agencyId, { insuredId: current.insuredId, policyNumber: current.policyNumber });
  });
}

// ── Staff assignments ──

export async function assignInsuredStaff(
  db: Db, scope: DeskScope, insuredId: string, input: { userId?: unknown; role?: unknown }, ctx: GuardContext = {}
): Promise<void> {
  const insured = await getInsuredForScope(db, scope, insuredId, ctx, { id: true, agencyId: true });
  if (!canManage(scope, insured.agencyId)) return forbid(db, scope, ctx, 'InsuredAccount', insured.id, insured.agencyId, 'assign', 'Only an agency admin or Account Manager can assign staff to an account.');
  if (!isObjectId(input.userId)) throw bad('Choose someone from this agency.');
  const user = await db.user.findUnique({ where: { id: input.userId }, select: { id: true, role: true, agencyId: true, isActive: true } });
  // The same message for another agency's user as for nobody: this reveals nothing about them.
  if (!user || user.agencyId !== insured.agencyId || !user.isActive || !canBeAssignedToInsured(user.role)) throw bad('Choose someone from this agency.');
  if (input.role !== undefined && !(Object.values(InsuredAssignmentRole) as unknown[]).includes(input.role)) throw bad('Role must be Producer or Service.');
  const role = (input.role ?? defaultAssignmentRole(user.role)) as InsuredAssignmentRole;

  const existing = await db.insuredAssignment.findUnique({ where: { insuredId_userId: { insuredId: insured.id, userId: user.id } } });
  if (existing?.role === role) return;
  try {
    await inTransaction(db, async (tx) => {
      if (existing) await tx.insuredAssignment.update({ where: { id: existing.id }, data: { role } });
      else await tx.insuredAssignment.create({ data: { agencyId: insured.agencyId, insuredId: insured.id, userId: user.id, role, createdById: scope.userId } });
      await audit(tx, scope, ctx, 'insured.assigned', 'InsuredAccount', insured.id, insured.agencyId, { userId: user.id, role, from: existing?.role ?? null });
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') throw conflict(CHANGED_ELSEWHERE);
    throw err;
  }
}

export async function unassignInsuredStaff(db: Db, scope: DeskScope, insuredId: string, userId: unknown, ctx: GuardContext = {}): Promise<void> {
  const insured = await getInsuredForScope(db, scope, insuredId, ctx, { id: true, agencyId: true });
  if (!canManage(scope, insured.agencyId)) return forbid(db, scope, ctx, 'InsuredAccount', insured.id, insured.agencyId, 'unassign', 'Only an agency admin or Account Manager can assign staff to an account.');
  if (!isObjectId(userId)) throw bad('Choose someone assigned to this account.');
  await inTransaction(db, async (tx) => {
    const { count } = await tx.insuredAssignment.deleteMany({ where: { insuredId: insured.id, userId } });
    if (count !== 1) throw conflict('That person is not assigned to this account.');
    await audit(tx, scope, ctx, 'insured.assigned', 'InsuredAccount', insured.id, insured.agencyId, { userId, role: null });
  });
}
