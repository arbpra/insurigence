/**
 * The Desk access layer — the one place that decides what a user may see.
 * Every Desk query and route goes through here; no screen writes its own
 * permission check (build plan, section 6).
 *
 *  - Owner / Admin: the agency's whole book.
 *  - Producer, CSR: accounts they are assigned to, unless the agency admin
 *    granted the whole book (User.bookAccess, via effectiveBookAccess).
 *  - Desk staff (Module 48): what they may do and which agencies they reach
 *    come from the positions they hold (lib/desk/staff-profile.ts):
 *      - reach "all agencies" (COO, the Directors) → kind PLATFORM;
 *      - reach "assigned" or "supervised" (Account Managers) → kind
 *        ACCOUNT_MANAGER: every agency where they are primary or backup AM,
 *        plus pod work if a position of theirs also reaches by pod;
 *      - reach "pod authorisation" only (Pod Leaders, VAs) → kind VA.
 *    Their permissions ride on the scope; `can(scope, key)` asks for one.
 *    A position never opens agency data on its own beyond its reach:
 *      - agency books are open directly only with `accounts.view`, otherwise
 *        only through requests the person can see;
 *      - Financial / Personal documents only with `documents.all_categories`
 *        or an individual grant;
 *      - a request restricted to named people (Q4) is seen, beyond the named,
 *        only by those who may restrict (`requests.restrict`) in their reach.
 *  - Super Admin: everything.
 *  - Pod work, need-to-know (client answer Q4): a task is visible only when
 *      1. the VA is in the task's pod (an active pod),
 *      2. the agency authorised that pod as a whole, or this VA by name,
 *         and has The Desk switched on,
 *      3. the task is not restricted to other named staff, and
 *      4. the task is open, or the VA is its assignee (their own history).
 *    A VA reaches accounts and policies only through such tasks, and opens
 *    Financial / Personal documents only with an individual grant.
 *
 * Anything outside a user's scope is reported as "not found" (404), never
 * "forbidden", so a user cannot learn that another agency's record exists.
 * Every refusal is written to the audit log.
 */
import type { DocumentSensitivity, Prisma } from '@prisma/client';
import { NextResponse } from 'next/server';
import { effectiveBookAccess, isAgencyRole, isDeskRole, type BookAccessLevel } from '../roles';
import { recordAudit } from './audit';
import { DEFAULT_STAFF_SENSITIVITIES } from './need-to-know';
import { WHOLE_POD_ACCESS } from './pods';
import { DESK_NOT_ENABLED } from './scope-reasons';
import { CLOSED_STATUSES, TOP_LEVEL, passesRestriction } from './task-filters';
import type { PermissionKey } from './permission-catalogue';
import { staffProfile } from './staff-profile';

/** A client or a transaction: a scope can be resolved inside the change that affects it. */
type Db = Prisma.TransactionClient;

/** What a Desk staff member's positions allow (Module 48). */
interface StaffAccess {
  permissions: PermissionKey[];
  /** Document categories they may open (lib/desk/need-to-know.ts). */
  sensitivities: DocumentSensitivity[];
}

/** An (agency, pod) pair a person may work through pod authorisation. */
export interface PodGrant { agencyId: string; podId: string }

export type DeskScope =
  /** Super Admin, and positions that reach every agency (COO, the Directors). */
  | ({ kind: 'PLATFORM'; userId: string; role: string } & StaffAccess)
  /** An agency user, in a Desk-enabled agency. */
  | { kind: 'AGENCY'; userId: string; role: string; agencyId: string; book: BookAccessLevel }
  /**
   * Positions that reach assigned (or supervised) agencies: the agencies they
   * manage (may be empty), plus pod work when another position of theirs
   * reaches by pod.
   */
  | ({ kind: 'ACCOUNT_MANAGER'; userId: string; role: string; agencyIds: string[]; grants: PodGrant[] } & StaffAccess)
  /**
   * Positions that reach only through pods (Pod Leader, VA): the (agency, pod)
   * pairs they may work. No pairs = no access.
   */
  | ({ kind: 'VA'; userId: string; role: string; grants: PodGrant[] } & StaffAccess)
  /** No Desk access (agency not enabled, unknown or inactive user, no active position). */
  | { kind: 'NONE'; userId: string; role: string; reason: string };

/** Does the scope's position allow this? Agency users and NONE have no Desk-staff permissions. */
export function can(scope: DeskScope, permission: PermissionKey): boolean {
  return 'permissions' in scope && scope.permissions.includes(permission);
}

/** Desk staff, whatever their reach. */
export function isStaffScope(scope: DeskScope): scope is Extract<DeskScope, { kind: 'PLATFORM' | 'ACCOUNT_MANAGER' | 'VA' }> {
  return scope.kind === 'PLATFORM' || scope.kind === 'ACCOUNT_MANAGER' || scope.kind === 'VA';
}

/** Throws 403 unless the scope has at least one of the permissions. */
export function assertCan(scope: DeskScope, permissions: readonly PermissionKey[], message = 'Your position does not allow this.'): void {
  if (!permissions.some((p) => can(scope, p))) throw new DeskAccessError(403, message);
}

const ALL_SENSITIVITIES: DocumentSensitivity[] = ['GENERAL', 'POLICY', 'FINANCIAL', 'PERSONAL'];

/**
 * A refused Desk request. 404 for anything out of scope (never more detail);
 * 403 for an action the user's role may not take on a record they can see;
 * 400 / 409 for invalid input or a rule such as a status change not allowed
 * from the task's current status (lib/desk/tasks.ts). Messages for 400 / 403
 * / 409 are shown to the user, so they never contain other agencies' data.
 */
export class DeskAccessError extends Error {
  /** `code` lets a screen respond to a particular refusal without reading its wording. */
  constructor(public status: 400 | 401 | 403 | 404 | 409 | 503, message: string, public code?: string) {
    super(message);
    this.name = 'DeskAccessError';
  }
}

/** Matches nothing; used for scopes with no access so a query can never leak. */
const NOTHING = { id: { in: [] as string[] } };

const OBJECT_ID = /^[a-f0-9]{24}$/i;
export function isObjectId(value: unknown): value is string {
  return typeof value === 'string' && OBJECT_ID.test(value);
}

/**
 * Works out a user's Desk scope from the database, not from the session, so a
 * role, book-access or AM change takes effect on the next request.
 */
export async function resolveDeskScope(db: Db, userId: string): Promise<DeskScope> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true, agencyId: true, bookAccess: true, isActive: true },
  });
  if (!user || !user.isActive) return { kind: 'NONE', userId, role: user?.role ?? 'UNKNOWN', reason: 'inactive or missing user' };
  const base = { userId: user.id, role: user.role };

  if (isAgencyRole(user.role)) {
    if (!user.agencyId) return { kind: 'NONE', ...base, reason: 'agency user without an agency' };
    const agency = await db.agency.findUnique({ where: { id: user.agencyId }, select: { deskEnabled: true } });
    if (!agency?.deskEnabled) return { kind: 'NONE', ...base, reason: DESK_NOT_ENABLED };
    return { kind: 'AGENCY', ...base, agencyId: user.agencyId, book: effectiveBookAccess(user.role, user.bookAccess)! };
  }

  if (user.role !== 'SUPER_ADMIN' && !isDeskRole(user.role)) return { kind: 'NONE', ...base, reason: 'role has no Desk access' };
  const profile = await staffProfile(db, user);
  if (!profile.reaches.length) return { kind: 'NONE', ...base, reason: 'no active position' };
  const { permissions } = profile;
  const reaches = new Set(profile.reaches);
  const sensitivities = permissions.includes('documents.all_categories') ? [...ALL_SENSITIVITIES] : await grantedSensitivities(db, user.id);
  const staff = { ...base, permissions, sensitivities };

  if (reaches.has('ALL')) return { kind: 'PLATFORM', ...staff };
  const grants = reaches.has('POD') ? await podGrants(db, user.id) : [];
  if (reaches.has('ASSIGNED') || reaches.has('SUPERVISED')) {
    // Supervised agencies (Senior AMs) widen this in Module 50.
    const rows = await db.agencyDeskAssignment.findMany({
      where: { OR: [{ primaryAmId: user.id }, { backupAmId: user.id }], agency: { deskEnabled: true } },
      select: { agencyId: true },
    });
    return { kind: 'ACCOUNT_MANAGER', ...staff, agencyIds: rows.map((r) => r.agencyId), grants };
  }
  return { kind: 'VA', ...staff, grants };
}

/** The (agency, pod) pairs a person may work: their active pods × each agency's authorisation of the pod or of them by name. */
async function podGrants(db: Db, userId: string): Promise<PodGrant[]> {
  const memberships = await db.podMember.findMany({ where: { userId, pod: { isActive: true } }, select: { podId: true } });
  const podIds = memberships.map((m) => m.podId);
  if (!podIds.length) return [];
  const access = await db.agencyPodAccess.findMany({
    where: { podId: { in: podIds }, agency: { deskEnabled: true }, OR: [WHOLE_POD_ACCESS, { userId }] },
    select: { agencyId: true, podId: true },
  });
  // A whole-pod row and a named row for the same pair grant the same thing.
  const seen = new Set<string>();
  return access.filter((g) => {
    const key = `${g.agencyId}:${g.podId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** General and Policy for everyone, plus categories granted to this person (Pods page). */
async function grantedSensitivities(db: Db, userId: string): Promise<DocumentSensitivity[]> {
  const permission = await db.deskStaffPermission.findUnique({ where: { userId }, select: { allowedSensitivities: true } });
  return [...new Set([...DEFAULT_STAFF_SENSITIVITIES, ...(permission?.allowedSensitivities ?? [])])];
}

/** Agencies the scope can see at all: a list, or 'ALL' for platform roles. */
export function scopeAgencyIds(scope: DeskScope): string[] | 'ALL' {
  switch (scope.kind) {
    case 'PLATFORM': return 'ALL';
    case 'AGENCY': return [scope.agencyId];
    case 'ACCOUNT_MANAGER': return [...new Set([...scope.agencyIds, ...scope.grants.map((g) => g.agencyId)])];
    case 'VA': return [...new Set(scope.grants.map((g) => g.agencyId))];
    case 'NONE': return [];
  }
}

// ── Query filters. Combine with other conditions through AND. ──

/** Requests in a scope's managed agencies (or all, for PLATFORM): restricted ones only for those who may restrict. */
function managedTasks(scope: Extract<DeskScope, { kind: 'PLATFORM' | 'ACCOUNT_MANAGER' }>): Prisma.TaskWhereInput {
  const where: Prisma.TaskWhereInput = scope.kind === 'PLATFORM' ? {} : { agencyId: { in: scope.agencyIds } };
  if (can(scope, 'requests.restrict')) return where;
  return scope.kind === 'PLATFORM' ? passesRestriction(scope.userId) : { AND: [where, passesRestriction(scope.userId)] };
}

/** Pod work: open requests in authorised (agency, pod) pairs, plus the person's own history. */
function podTasks(scope: { userId: string; grants: PodGrant[] }): Prisma.TaskWhereInput {
  if (!scope.grants.length) return NOTHING;
  return {
    AND: [
      // Built from (agency, pod) pairs only, so a task with no pod never matches.
      { OR: scope.grants.map((g) => ({ agencyId: g.agencyId, podId: g.podId })) },
      passesRestriction(scope.userId),
      { OR: [{ status: { notIn: [...CLOSED_STATUSES] } }, { assigneeId: scope.userId }] },
    ],
  };
}

/** Insured accounts the scope may see. Desk staff open books directly only with `accounts.view`; otherwise through requests they can see. */
export function insuredWhere(scope: DeskScope): Prisma.InsuredAccountWhereInput {
  switch (scope.kind) {
    case 'AGENCY':
      return scope.book === 'ALL'
        ? { agencyId: scope.agencyId }
        : { agencyId: scope.agencyId, assignments: { some: { userId: scope.userId } } };
    case 'PLATFORM':
      return can(scope, 'accounts.view') ? {} : { tasks: { some: taskWhere(scope) } };
    case 'ACCOUNT_MANAGER': {
      if (!can(scope, 'accounts.view')) return { tasks: { some: taskWhere(scope) } };
      const managed: Prisma.InsuredAccountWhereInput = { agencyId: { in: scope.agencyIds } };
      return scope.grants.length ? { OR: [managed, { tasks: { some: podTasks(scope) } }] } : managed;
    }
    case 'VA': return scope.grants.length ? { tasks: { some: taskWhere(scope) } } : NOTHING;
    case 'NONE': return NOTHING;
  }
}

/** Policies reached through visible requests: the request's policy, or the account's policies when the request names none. */
function policiesThroughTasks(visible: Prisma.TaskWhereInput, account?: Prisma.InsuredAccountWhereInput): Prisma.PolicyWhereInput {
  const onAccount: Prisma.InsuredAccountWhereInput = { tasks: { some: { AND: [visible, { OR: [{ policyId: null }, { policyId: { isSet: false } }] }] } } };
  if (!account) return { OR: [{ tasks: { some: visible } }, { insured: onAccount }] };
  return {
    OR: [
      { AND: [{ insured: { is: account } }, { tasks: { some: visible } }] },
      { insured: { is: { AND: [account, onAccount] } } },
    ],
  };
}

/**
 * Policies the scope may see: those on insureds it may see. A VA sees the
 * policy a visible task is about; a visible task on an account with no
 * specific policy (a COI, say) shows that account's policies.
 *
 * To limit by the account as well, pass the condition as `account`; never AND
 * `policyWhere(scope)` with another `insured` condition. Prisma on MongoDB
 * joins the account once per condition, the second join drops the first's
 * requests, and the query fails.
 */
export function policyWhere(scope: DeskScope, account?: Prisma.InsuredAccountWhereInput): Prisma.PolicyWhereInput {
  const onAccount: Prisma.PolicyWhereInput = account ? { insured: { is: account } } : {};
  switch (scope.kind) {
    case 'AGENCY':
      return scope.book === 'ALL'
        ? { agencyId: scope.agencyId, ...onAccount }
        : { agencyId: scope.agencyId, insured: { is: { AND: [account ?? {}, { assignments: { some: { userId: scope.userId } } }] } } };
    case 'PLATFORM':
      return can(scope, 'accounts.view') ? onAccount : policiesThroughTasks(taskWhere(scope), account);
    case 'ACCOUNT_MANAGER': {
      if (!can(scope, 'accounts.view')) return policiesThroughTasks(taskWhere(scope), account);
      const managed: Prisma.PolicyWhereInput = { agencyId: { in: scope.agencyIds }, ...onAccount };
      return scope.grants.length ? { OR: [managed, policiesThroughTasks(podTasks(scope), account)] } : managed;
    }
    case 'VA':
      return scope.grants.length ? policiesThroughTasks(taskWhere(scope), account) : NOTHING;
    case 'NONE': return NOTHING;
  }
}

/**
 * Tasks the scope may see.
 *  - A Producer / CSR on assigned accounts sees tasks on those accounts, plus
 *    tasks they submitted themselves (including ones with no account).
 *  - The named-staff restriction does not apply to agency users; staff who
 *    may restrict pass it in their reach (lib/desk/need-to-know.ts).
 */
export function taskWhere(scope: DeskScope): Prisma.TaskWhereInput {
  switch (scope.kind) {
    case 'PLATFORM': return managedTasks(scope);
    case 'AGENCY':
      // Subtasks are the Desk team's own pieces of a request (Module 38): an agency sees the request only.
      return scope.book === 'ALL'
        ? { AND: [{ agencyId: scope.agencyId }, TOP_LEVEL] }
        : {
            AND: [{
              agencyId: scope.agencyId,
              OR: [
                { insured: { is: { assignments: { some: { userId: scope.userId } } } } },
                { createdById: scope.userId },
              ],
            }, TOP_LEVEL],
          };
    case 'ACCOUNT_MANAGER':
      return scope.grants.length ? { OR: [managedTasks(scope), podTasks(scope)] } : managedTasks(scope);
    case 'VA': return podTasks(scope);
    case 'NONE': return NOTHING;
  }
}

const NOT_DELETED: Prisma.TaskDocumentWhereInput = { OR: [{ deletedAt: null }, { deletedAt: { isSet: false } }] };

/**
 * Task documents the scope may see: on a visible task and not removed.
 * Agency users see only those shared with the agency; VAs only the
 * categories they hold (lib/desk/need-to-know.ts).
 */
export function documentWhere(scope: DeskScope): Prisma.TaskDocumentWhereInput {
  if (scope.kind === 'NONE') return NOTHING;
  const parts: Prisma.TaskDocumentWhereInput[] = [NOT_DELETED];
  if (!seesEveryTask(scope)) parts.push({ task: taskWhere(scope) });
  if (scope.kind === 'AGENCY') parts.push({ visibility: 'AGENCY' });
  if (isStaffScope(scope) && scope.sensitivities.length < ALL_SENSITIVITIES.length) parts.push({ sensitivity: { in: scope.sensitivities } });
  return { AND: parts };
}

/** Every task, with no filter at all: the Super Admin, and all-agency positions that may restrict. */
function seesEveryTask(scope: DeskScope): boolean {
  return scope.kind === 'PLATFORM' && can(scope, 'requests.restrict');
}

/** Timeline entries the scope may see: agency users never see internal ones. */
export function taskEventWhere(scope: DeskScope): Prisma.TaskEventWhereInput {
  if (scope.kind === 'NONE') return NOTHING;
  const parts: Prisma.TaskEventWhereInput[] = [];
  if (!seesEveryTask(scope)) parts.push({ task: taskWhere(scope) });
  if (scope.kind === 'AGENCY') parts.push({ visibility: 'AGENCY' });
  return { AND: parts };
}

// ── Single-record guards. Return the record or throw a 404. ──

export interface GuardContext {
  /** For the audit entry on refusal. */
  ip?: string | null;
  userAgent?: string | null;
}

/** Logs a refused attempt (with the record's real agency, if it exists) and throws 404. */
async function refuse(
  db: Db,
  scope: DeskScope,
  entityType: string,
  entityId: string,
  agencyId: string | null,
  ctx: GuardContext,
  extra: Record<string, unknown> = {}
): Promise<never> {
  try {
    await recordAudit(db, {
      actor: { id: scope.userId, role: scope.role },
      action: 'access.denied',
      entityType,
      entityId: isObjectId(entityId) ? entityId : null,
      agencyId,
      metadata: { scope: scope.kind, ...(scope.kind === 'NONE' ? { reason: scope.reason } : {}), ...(isObjectId(entityId) ? {} : { requestedId: String(entityId).slice(0, 64) }), ...extra },
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });
  } catch (err) {
    // The request is refused either way; a logging failure must not turn a
    // "not found" into a different response that hints the record exists.
    console.error('[desk/access] could not log refused access', err);
  }
  throw new DeskAccessError(404, 'Not found');
}

export async function getInsuredForScope<S extends Prisma.InsuredAccountSelect | undefined = undefined>(
  db: Db, scope: DeskScope, insuredId: string, ctx: GuardContext = {}, select?: S
) {
  if (isObjectId(insuredId)) {
    const found = await db.insuredAccount.findFirst({ where: { AND: [{ id: insuredId }, insuredWhere(scope)] }, ...(select ? { select } : {}) });
    if (found) return found as NonNullable<typeof found>;
  }
  const real = isObjectId(insuredId) ? await db.insuredAccount.findUnique({ where: { id: insuredId }, select: { agencyId: true } }) : null;
  return refuse(db, scope, 'InsuredAccount', insuredId, real?.agencyId ?? null, ctx);
}

export async function getPolicyForScope(db: Db, scope: DeskScope, policyId: string, ctx: GuardContext = {}) {
  if (isObjectId(policyId)) {
    const found = await db.policy.findFirst({ where: { AND: [{ id: policyId }, policyWhere(scope)] } });
    if (found) return found;
  }
  const real = isObjectId(policyId) ? await db.policy.findUnique({ where: { id: policyId }, select: { agencyId: true } }) : null;
  return refuse(db, scope, 'Policy', policyId, real?.agencyId ?? null, ctx);
}

export async function getTaskForScope(db: Db, scope: DeskScope, taskId: string, ctx: GuardContext = {}) {
  if (isObjectId(taskId)) {
    const found = await db.task.findFirst({ where: { AND: [{ id: taskId }, taskWhere(scope)] } });
    if (found) return found;
  }
  const real = isObjectId(taskId) ? await db.task.findUnique({ where: { id: taskId }, select: { agencyId: true } }) : null;
  return refuse(db, scope, 'Task', taskId, real?.agencyId ?? null, ctx);
}

/**
 * A document the scope may open. A refusal is logged with the file's
 * category, so attempts on sensitive files stand out in the audit log.
 */
export async function getDocumentForScope(db: Db, scope: DeskScope, documentId: string, ctx: GuardContext = {}) {
  if (isObjectId(documentId)) {
    const found = await db.taskDocument.findFirst({ where: { AND: [{ id: documentId }, documentWhere(scope)] } });
    if (found) return found;
  }
  const real = isObjectId(documentId)
    ? await db.taskDocument.findUnique({ where: { id: documentId }, select: { agencyId: true, sensitivity: true } })
    : null;
  return refuse(db, scope, 'TaskDocument', documentId, real?.agencyId ?? null, ctx, real ? { sensitivity: real.sensitivity } : {});
}

// ── Submitting work ──

/**
 * Where a new request may be filed, and for which account. Decision D4
 * (default): a user may submit only for accounts they can see. Returns the
 * agency the task belongs to — always taken from the account or the user's
 * own agency, never from the request body.
 *  - Agency users: their own agency; the account (if any) must be visible.
 *  - AM / platform: on behalf of an agency they cover; an account, when
 *    given, fixes the agency. Without one, agencyId must be in scope.
 */
export async function resolveSubmission(
  db: Db,
  scope: DeskScope,
  input: { insuredId?: string | null; policyId?: string | null; agencyId?: string | null },
  ctx: GuardContext = {}
): Promise<{ agencyId: string; insuredId: string | null; policyId: string | null }> {
  // Desk staff file requests for an agency only if they may edit its book (Account Managers and up);
  // VAs and Pod Leaders work requests, they don't file them (subtasks are separate, Module 38).
  if (scope.kind === 'NONE' || (scope.kind !== 'AGENCY' && !can(scope, 'accounts.edit'))) return refuse(db, scope, 'Task', 'submit', null, ctx, { op: 'submit' });

  let insuredId: string | null = null;
  let agencyId: string | null = null;
  if (input.insuredId) {
    const insured = await getInsuredForScope(db, scope, input.insuredId, ctx, { id: true, agencyId: true });
    insuredId = insured.id;
    agencyId = insured.agencyId;
  }

  let policyId: string | null = null;
  if (input.policyId) {
    const policy = await getPolicyForScope(db, scope, input.policyId, ctx);
    // A policy must belong to the chosen account (or fixes it, when none was given).
    if (insuredId && policy.insuredId !== insuredId) {
      return refuse(db, scope, 'Policy', input.policyId, policy.agencyId, ctx, { op: 'submit', reason: 'policy not on insured' });
    }
    policyId = policy.id;
    insuredId = policy.insuredId;
    agencyId = policy.agencyId;
  }

  if (insuredId) {
    const account = await db.insuredAccount.findUnique({ where: { id: insuredId }, select: { status: true } });
    if (account?.status === 'INACTIVE') throw new DeskAccessError(409, 'This account is inactive. Reactivate it to send a new request.');
  }

  if (scope.kind === 'AGENCY') {
    return { agencyId: scope.agencyId, insuredId, policyId };
  }
  if (!agencyId) {
    const requested = input.agencyId ?? null;
    const allowed = scopeAgencyIds(scope);
    if (!isObjectId(requested) || (allowed !== 'ALL' && !allowed.includes(requested))) {
      return refuse(db, scope, 'Agency', requested ?? 'none', isObjectId(requested) ? requested : null, ctx, { op: 'submit' });
    }
    agencyId = requested;
  }
  // AMs' agencies are already Desk-enabled; platform roles can reach any agency's account.
  if (scope.kind === 'PLATFORM') {
    const agency = await db.agency.findUnique({ where: { id: agencyId }, select: { deskEnabled: true } });
    if (!agency?.deskEnabled) return refuse(db, scope, 'Agency', agencyId, agencyId, ctx, { op: 'submit', reason: 'desk not enabled' });
  }
  return { agencyId, insuredId, policyId };
}

// ── Managing access ──

/**
 * Who may change an agency's Desk permissions (book access, account
 * assignments): that agency's Owner / Admin, Operations Managers and Super
 * Admin (client answer Q3: "the agency admin manages these permissions").
 * Account Managers do not.
 */
export function canManageAgencyAccess(scope: DeskScope, agencyId: string): boolean {
  if (scope.kind === 'PLATFORM') return can(scope, 'agencies.setup');
  return scope.kind === 'AGENCY' && scope.role === 'ADMIN' && scope.agencyId === agencyId;
}

// ── Route helpers ──

/** Turns a DeskAccessError into its response; anything else is rethrown. */
export function deskAccessResponse(err: unknown): NextResponse {
  if (err instanceof DeskAccessError) {
    if (err.status === 404) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ error: err.message, ...(err.code ? { code: err.code } : {}) }, { status: err.status });
  }
  throw err;
}
