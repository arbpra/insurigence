/**
 * Who in an agency sees what (client answer Q3: "the agency admin manages these
 * permissions"): each person's role and book access, and assigning people to
 * accounts in bulk. Single assignments are in lib/desk/book.ts.
 *
 * Roles and book access are for the agency's Owner / Admin, Operations Managers
 * and Super Admin, never Account Managers. Assigning follows book.ts: those
 * people, and the agency's Account Manager.
 *
 * An agency always keeps an active Owner / Admin, and nobody changes their own
 * access. Demoting an admin also writes to the agency's own record, so two
 * demotions at the same moment collide and one fails, instead of both succeeding
 * and leaving the agency with none.
 */
import { Prisma, InsuredAssignmentRole, type PrismaClient, type UserRole } from '@prisma/client';
import { AGENCY_ROLES, effectiveBookAccess, isAgencyRole, roleLabel, type BookAccessLevel } from '@/lib/roles';
import { canManageAgencyAccess, DeskAccessError, insuredWhere, isObjectId, type DeskScope, type GuardContext } from './access';
import { recordAudit } from './audit';
import { canManage, insuredListWhere } from './book';
import { MAX_BULK_ASSIGN } from './team-form';

type Db = PrismaClient;

const TX_OPTIONS = { timeout: 30_000, maxWait: 10_000 };
const CHANGED_ELSEWHERE = 'Someone else just changed this. Reload to see their changes, then try again.';

const bad = (message: string, code?: string) => new DeskAccessError(400, message, code);
const conflict = (message: string, code?: string) => new DeskAccessError(409, message, code);

const MEMBER = {
  id: true, email: true, firstName: true, lastName: true, role: true, bookAccess: true, isActive: true, agencyId: true,
  passwordHash: true, lastLoginAt: true, updatedAt: true,
} as const;
type MemberRow = Prisma.UserGetPayload<{ select: typeof MEMBER }>;

const personName = (u: { firstName: string | null; lastName: string | null; email: string }) =>
  [u.firstName, u.lastName].filter(Boolean).join(' ') || u.email;

function memberView(u: MemberRow, scope: DeskScope, assignedAccounts: number) {
  return {
    id: u.id, version: u.updatedAt.toISOString(), name: personName(u), email: u.email,
    role: u.role, roleLabel: roleLabel(u.role), bookAccess: effectiveBookAccess(u.role, u.bookAccess) as BookAccessLevel,
    isActive: u.isActive,
    // Whether they have set a password. The password itself is never sent.
    inviteAccepted: !!u.passwordHash,
    lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
    assignedAccounts,
    isSelf: u.id === scope.userId,
  };
}

async function logRefusal(db: Db, scope: DeskScope, ctx: GuardContext, entityId: string | null, agencyId: string | null, op: string) {
  try {
    await recordAudit(db, { actor: { id: scope.userId, role: scope.role }, action: 'access.denied', entityType: 'User', entityId, agencyId, metadata: { op, scope: scope.kind }, ip: ctx.ip, userAgent: ctx.userAgent });
  } catch (err) {
    console.error('[desk/team] could not log refused action', err);
  }
}

/** The agency this request is about: an agency user's own, or the one a platform user names. */
async function teamAgency(db: Db, scope: DeskScope, requested: string | null | undefined, ctx: GuardContext): Promise<string> {
  const agencyId = scope.kind === 'AGENCY' ? scope.agencyId : requested;
  if (scope.kind === 'PLATFORM' && !isObjectId(agencyId)) throw bad('Choose an agency.');
  if (!agencyId || !canManageAgencyAccess(scope, agencyId)) {
    await logRefusal(db, scope, ctx, null, isObjectId(agencyId) ? agencyId : null, 'team');
    throw new DeskAccessError(403, 'Only an agency admin can manage team access.');
  }
  return agencyId;
}

/** A person this scope manages, or a logged 404: someone elsewhere is "not found", never "forbidden". */
async function loadMember(db: Db, scope: DeskScope, userId: string, ctx: GuardContext, op: string, allowed: (agencyId: string) => boolean): Promise<MemberRow & { agencyId: string }> {
  const user = isObjectId(userId) ? await db.user.findUnique({ where: { id: userId }, select: MEMBER }) : null;
  if (user?.agencyId && isAgencyRole(user.role) && allowed(user.agencyId)) return user as MemberRow & { agencyId: string };
  await logRefusal(db, scope, ctx, isObjectId(userId) ? userId : null, user?.agencyId ?? null, op);
  throw new DeskAccessError(404, 'Not found');
}

const assignedCounts = async (db: Db, agencyId: string) => {
  const rows = await db.insuredAssignment.groupBy({ by: ['userId'], where: { agencyId }, _count: { _all: true } });
  return new Map(rows.map((r) => [r.userId, r._count._all]));
};

// ── Reading ──

export async function listTeam(db: Db, scope: DeskScope, opts: { agencyId?: string | null } = {}, ctx: GuardContext = {}) {
  const agencyId = await teamAgency(db, scope, opts.agencyId, ctx);
  const [users, counts] = await Promise.all([
    db.user.findMany({ where: { agencyId, role: { in: [...AGENCY_ROLES] as UserRole[] } }, select: MEMBER, orderBy: [{ firstName: 'asc' }, { email: 'asc' }] }),
    assignedCounts(db, agencyId),
  ]);
  return { members: users.map((u) => memberView(u, scope, counts.get(u.id) ?? 0)) };
}

export async function getTeamMember(db: Db, scope: DeskScope, userId: string, ctx: GuardContext = {}) {
  const user = await loadMember(db, scope, userId, ctx, 'team.read', (agencyId) => canManage(scope, agencyId));
  const assigned = await db.insuredAssignment.count({ where: { userId: user.id } });
  return memberView(user, scope, assigned);
}

// ── Role and book access ──

/** Saves `role` and / or `bookAccess`. Book access doesn't apply to an Owner / Admin, who always sees everything. */
export async function updateTeamMember(db: Db, scope: DeskScope, userId: string, input: Record<string, unknown>, ctx: GuardContext = {}) {
  const target = await loadMember(db, scope, userId, ctx, 'team.update', (agencyId) => canManageAgencyAccess(scope, agencyId));
  if (target.id === scope.userId) {
    await logRefusal(db, scope, ctx, target.id, target.agencyId, 'team.update.self');
    throw new DeskAccessError(403, 'You can\'t change your own access. Ask another Owner / Admin.');
  }
  if (input.version !== undefined && input.version !== target.updatedAt.toISOString()) throw conflict(CHANGED_ELSEWHERE, 'CHANGED_ELSEWHERE');
  if (input.role !== undefined && !(AGENCY_ROLES as readonly unknown[]).includes(input.role)) throw bad('Role must be Owner / Admin, Producer or CSR.');
  if (input.bookAccess !== undefined && input.bookAccess !== 'ALL' && input.bookAccess !== 'ASSIGNED') throw bad('Book access must be whole book or assigned accounts.');

  const nextRole = (input.role ?? target.role) as UserRole;
  if (nextRole === 'ADMIN' && input.bookAccess === 'ASSIGNED') throw bad('An Owner / Admin always sees the whole book.');
  // An admin's stored value is ignored, so it is cleared: a grant from before their
  // promotion must not quietly come back if they are later moved to Producer.
  const nextStored: BookAccessLevel | null = nextRole === 'ADMIN' ? null : (input.bookAccess as BookAccessLevel | undefined) ?? (target.role === 'ADMIN' ? null : target.bookAccess);

  const fromBook = effectiveBookAccess(target.role, target.bookAccess);
  const toBook = effectiveBookAccess(nextRole, nextStored);
  if (nextRole === target.role && fromBook === toBook) return getTeamMember(db, scope, userId, ctx);
  if (!target.isActive) throw conflict('This person is no longer active.');

  try {
    await db.$transaction(async (tx) => {
      if (target.role === 'ADMIN' && nextRole !== 'ADMIN') {
        const others = await tx.user.count({ where: { agencyId: target.agencyId, role: 'ADMIN', isActive: true, id: { not: target.id } } });
        if (others === 0) throw conflict('An agency must keep at least one active Owner / Admin.', 'LAST_ADMIN');
        // See the top of this file.
        await tx.agency.update({ where: { id: target.agencyId }, data: { updatedAt: new Date() } });
      }
      if (scope.kind === 'AGENCY') {
        // The scope was worked out at the start of the request: they may have been demoted a moment ago.
        const still = await tx.user.count({ where: { id: scope.userId, agencyId: target.agencyId, role: 'ADMIN', isActive: true } });
        if (still !== 1) throw new DeskAccessError(403, 'Only an agency admin can manage team access.');
      }
      const { count } = await tx.user.updateMany({ where: { id: target.id, updatedAt: target.updatedAt }, data: { role: nextRole, bookAccess: nextStored } });
      if (count !== 1) throw conflict(CHANGED_ELSEWHERE, 'CHANGED_ELSEWHERE');
      await recordAudit(tx, {
        actor: { id: scope.userId, role: scope.role }, action: 'permission.changed', entityType: 'User', entityId: target.id, agencyId: target.agencyId,
        metadata: { role: { from: target.role, to: nextRole }, bookAccess: { from: fromBook, to: toBook } }, ip: ctx.ip, userAgent: ctx.userAgent,
      });
    }, TX_OPTIONS);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2034') throw conflict(CHANGED_ELSEWHERE, 'CHANGED_ELSEWHERE');
    throw err;
  }
  return getTeamMember(db, scope, userId, ctx);
}

// ── Assigning in bulk ──

function viewFilter(userId: string, view: unknown) {
  if (view === 'ASSIGNED') return { assignedTo: userId };
  if (view === 'NOT_ASSIGNED') return { notAssignedTo: userId, status: 'ACTIVE' as const };
  if (view === 'ALL') return { status: 'ACTIVE' as const };
  throw bad('Unknown list.');
}

/**
 * Assigns or removes one person on many accounts: ticked rows (`insuredIds`) or
 * everything a search matches (`matching`). All or nothing, and every account
 * must be one this user can see in that person's agency. One log entry, listing
 * the accounts that changed.
 */
export async function bulkAssign(db: Db, scope: DeskScope, userId: string, input: Record<string, unknown>, ctx: GuardContext = {}): Promise<{ changed: number; total: number }> {
  const target = await loadMember(db, scope, userId, ctx, 'team.assign', (agencyId) => canManage(scope, agencyId));
  const action = input.action;
  if (action !== 'assign' && action !== 'unassign') throw bad('Choose assign or remove.');
  if (input.role !== undefined && !(Object.values(InsuredAssignmentRole) as unknown[]).includes(input.role)) throw bad('Role must be Producer or Service.');
  if (action === 'assign' && !target.isActive) throw bad('This person is no longer active.');
  const role = (input.role ?? (target.role === 'CSR' ? 'SERVICE' : 'PRODUCER')) as InsuredAssignmentRole;

  const inAgency = { agencyId: target.agencyId };
  let ids: string[];
  if (Array.isArray(input.insuredIds) && input.matching === undefined) {
    const asked = [...new Set(input.insuredIds)];
    if (asked.length === 0) throw bad('Choose at least one account.');
    if (asked.length > MAX_BULK_ASSIGN) throw bad(`Choose ${MAX_BULK_ASSIGN.toLocaleString('en-US')} accounts or fewer at a time.`);
    if (!asked.every(isObjectId)) throw bad('Choose accounts from the list.');
    const found = await db.insuredAccount.findMany({ where: { AND: [{ id: { in: asked as string[] } }, insuredWhere(scope), inAgency] }, select: { id: true } });
    if (found.length !== asked.length) {
      // Nothing is changed, and the answer doesn't say which account it was.
      await logRefusal(db, scope, ctx, target.id, target.agencyId, 'team.assign.account');
      throw new DeskAccessError(404, 'Not found');
    }
    ids = found.map((a) => a.id);
  } else if (input.matching && typeof input.matching === 'object' && input.insuredIds === undefined) {
    const { view, q } = input.matching as { view?: unknown; q?: unknown };
    if (q !== undefined && typeof q !== 'string') throw bad('Invalid search.');
    const where: Prisma.InsuredAccountWhereInput = { AND: [insuredListWhere(scope, { q, ...viewFilter(target.id, view) }), inAgency] };
    const total = await db.insuredAccount.count({ where });
    if (total > MAX_BULK_ASSIGN) throw bad(`That matches ${total.toLocaleString('en-US')} accounts. The limit is ${MAX_BULK_ASSIGN.toLocaleString('en-US')} at a time: narrow the search.`);
    ids = (await db.insuredAccount.findMany({ where, select: { id: true } })).map((a) => a.id);
  } else {
    throw bad('Choose at least one account.');
  }

  try {
    return await db.$transaction(async (tx) => {
      const existing = await tx.insuredAssignment.findMany({ where: { userId: target.id, insuredId: { in: ids } }, select: { insuredId: true, role: true } });
      let changedIds: string[];
      if (action === 'assign') {
        const have = new Map(existing.map((e) => [e.insuredId, e.role]));
        const toAdd = ids.filter((id) => !have.has(id));
        const toChange = ids.filter((id) => have.has(id) && have.get(id) !== role);
        if (toAdd.length) await tx.insuredAssignment.createMany({ data: toAdd.map((insuredId) => ({ agencyId: target.agencyId, insuredId, userId: target.id, role, createdById: scope.userId })) });
        if (toChange.length) await tx.insuredAssignment.updateMany({ where: { userId: target.id, insuredId: { in: toChange } }, data: { role } });
        changedIds = [...toAdd, ...toChange];
      } else {
        changedIds = existing.map((e) => e.insuredId);
        if (changedIds.length) await tx.insuredAssignment.deleteMany({ where: { userId: target.id, insuredId: { in: changedIds } } });
      }
      if (changedIds.length) {
        await recordAudit(tx, {
          actor: { id: scope.userId, role: scope.role }, action: 'insured.assigned', entityType: 'User', entityId: target.id, agencyId: target.agencyId,
          metadata: { bulk: true, action, role: action === 'assign' ? role : null, count: changedIds.length, insuredIds: changedIds }, ip: ctx.ip, userAgent: ctx.userAgent,
        });
      }
      return { changed: changedIds.length, total: ids.length };
    }, TX_OPTIONS);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && (err.code === 'P2034' || err.code === 'P2002')) throw conflict(CHANGED_ELSEWHERE, 'CHANGED_ELSEWHERE');
    throw err;
  }
}
