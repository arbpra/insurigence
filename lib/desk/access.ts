/**
 * The Desk access layer — the one place that decides what a user may see.
 * Every Desk query and route goes through here; no screen writes its own
 * permission check (build plan, section 6).
 *
 *  - Owner / Admin: the agency's whole book.
 *  - Producer, CSR: accounts they are assigned to, unless the agency admin
 *    granted the whole book (User.bookAccess, via effectiveBookAccess).
 *  - Account Manager: every agency where they are primary or backup AM.
 *  - Operations Manager, Super Admin: every agency.
 *  - Desk VA, need-to-know (client answer Q4): a task is visible only when
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
import type { DocumentSensitivity, Prisma, PrismaClient } from '@prisma/client';
import { NextResponse } from 'next/server';
import { effectiveBookAccess, isAgencyRole, type BookAccessLevel } from '../roles';
import { recordAudit } from './audit';
import { DEFAULT_STAFF_SENSITIVITIES } from './need-to-know';
import { WHOLE_POD_ACCESS } from './pods';
import { DESK_NOT_ENABLED } from './scope-reasons';
import { CLOSED_STATUSES, passesRestriction } from './task-filters';

type Db = PrismaClient;

export type DeskScope =
  /** Super Admin, Operations Manager: all agencies. */
  | { kind: 'PLATFORM'; userId: string; role: string }
  /** An agency user, in a Desk-enabled agency. */
  | { kind: 'AGENCY'; userId: string; role: string; agencyId: string; book: BookAccessLevel }
  /** An Account Manager: their assigned agencies (may be empty). */
  | { kind: 'ACCOUNT_MANAGER'; userId: string; role: string; agencyIds: string[] }
  /**
   * A Desk VA: the (agency, pod) pairs they may work, and the document
   * categories they may open. No pairs = no access.
   */
  | { kind: 'VA'; userId: string; role: string; grants: { agencyId: string; podId: string }[]; sensitivities: DocumentSensitivity[] }
  /** No Desk access (agency not enabled, unknown or inactive user). */
  | { kind: 'NONE'; userId: string; role: string; reason: string };

/**
 * A refused Desk request. 404 for anything out of scope (never more detail);
 * 403 for an action the user's role may not take on a record they can see;
 * 400 / 409 for invalid input or a rule such as a status change not allowed
 * from the task's current status (lib/desk/tasks.ts). Messages for 400 / 403
 * / 409 are shown to the user, so they never contain other agencies' data.
 */
export class DeskAccessError extends Error {
  constructor(public status: 400 | 401 | 403 | 404 | 409, message: string) {
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

  if (user.role === 'SUPER_ADMIN' || user.role === 'DESK_ADMIN') return { kind: 'PLATFORM', ...base };

  if (isAgencyRole(user.role)) {
    if (!user.agencyId) return { kind: 'NONE', ...base, reason: 'agency user without an agency' };
    const agency = await db.agency.findUnique({ where: { id: user.agencyId }, select: { deskEnabled: true } });
    if (!agency?.deskEnabled) return { kind: 'NONE', ...base, reason: DESK_NOT_ENABLED };
    return { kind: 'AGENCY', ...base, agencyId: user.agencyId, book: effectiveBookAccess(user.role, user.bookAccess)! };
  }

  if (user.role === 'ACCOUNT_MANAGER') {
    const rows = await db.agencyDeskAssignment.findMany({
      where: { OR: [{ primaryAmId: user.id }, { backupAmId: user.id }], agency: { deskEnabled: true } },
      select: { agencyId: true },
    });
    return { kind: 'ACCOUNT_MANAGER', ...base, agencyIds: rows.map((r) => r.agencyId) };
  }

  if (user.role === 'DESK_VA') {
    const memberships = await db.podMember.findMany({
      where: { userId: user.id, pod: { isActive: true } },
      select: { podId: true },
    });
    const podIds = memberships.map((m) => m.podId);
    const access = podIds.length
      ? await db.agencyPodAccess.findMany({
          where: {
            podId: { in: podIds },
            agency: { deskEnabled: true },
            OR: [WHOLE_POD_ACCESS, { userId: user.id }],
          },
          select: { agencyId: true, podId: true },
        })
      : [];
    // A whole-pod row and a named row for the same pair grant the same thing.
    const seen = new Set<string>();
    const grants = access.filter((g) => {
      const key = `${g.agencyId}:${g.podId}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    const permission = await db.deskStaffPermission.findUnique({ where: { userId: user.id }, select: { allowedSensitivities: true } });
    const sensitivities = [...new Set([...DEFAULT_STAFF_SENSITIVITIES, ...(permission?.allowedSensitivities ?? [])])];
    return { kind: 'VA', ...base, grants, sensitivities };
  }
  return { kind: 'NONE', ...base, reason: 'role has no Desk access' };
}

/** Agencies the scope can see at all: a list, or 'ALL' for platform roles. */
export function scopeAgencyIds(scope: DeskScope): string[] | 'ALL' {
  switch (scope.kind) {
    case 'PLATFORM': return 'ALL';
    case 'AGENCY': return [scope.agencyId];
    case 'ACCOUNT_MANAGER': return scope.agencyIds;
    case 'VA': return [...new Set(scope.grants.map((g) => g.agencyId))];
    case 'NONE': return [];
  }
}

// ── Query filters. Combine with other conditions through AND. ──

/** Insured accounts the scope may see. */
export function insuredWhere(scope: DeskScope): Prisma.InsuredAccountWhereInput {
  switch (scope.kind) {
    case 'PLATFORM': return {};
    case 'AGENCY':
      return scope.book === 'ALL'
        ? { agencyId: scope.agencyId }
        : { agencyId: scope.agencyId, assignments: { some: { userId: scope.userId } } };
    case 'ACCOUNT_MANAGER': return { agencyId: { in: scope.agencyIds } };
    case 'VA': return scope.grants.length ? { tasks: { some: taskWhere(scope) } } : NOTHING;
    case 'NONE': return NOTHING;
  }
}

/**
 * Policies the scope may see: those on insureds it may see. A VA sees the
 * policy a visible task is about; a visible task on an account with no
 * specific policy (a COI, say) shows that account's policies.
 */
export function policyWhere(scope: DeskScope): Prisma.PolicyWhereInput {
  switch (scope.kind) {
    case 'PLATFORM': return {};
    case 'AGENCY':
      return scope.book === 'ALL'
        ? { agencyId: scope.agencyId }
        : { agencyId: scope.agencyId, insured: { assignments: { some: { userId: scope.userId } } } };
    case 'ACCOUNT_MANAGER': return { agencyId: { in: scope.agencyIds } };
    case 'VA': {
      if (!scope.grants.length) return NOTHING;
      const visible = taskWhere(scope);
      return {
        OR: [
          { tasks: { some: visible } },
          { insured: { tasks: { some: { AND: [visible, { OR: [{ policyId: null }, { policyId: { isSet: false } }] }] } } } },
        ],
      };
    }
    case 'NONE': return NOTHING;
  }
}

/**
 * Tasks the scope may see.
 *  - A Producer / CSR on assigned accounts sees tasks on those accounts, plus
 *    tasks they submitted themselves (including ones with no account).
 *  - The named-staff restriction does not apply to agency users, and an AM
 *    bypasses it for their own agencies (lib/desk/need-to-know.ts).
 */
export function taskWhere(scope: DeskScope): Prisma.TaskWhereInput {
  switch (scope.kind) {
    case 'PLATFORM': return {};
    case 'AGENCY':
      return scope.book === 'ALL'
        ? { agencyId: scope.agencyId }
        : {
            agencyId: scope.agencyId,
            OR: [
              { insured: { is: { assignments: { some: { userId: scope.userId } } } } },
              { createdById: scope.userId },
            ],
          };
    case 'ACCOUNT_MANAGER': return { agencyId: { in: scope.agencyIds } };
    case 'VA':
      if (!scope.grants.length) return NOTHING;
      return {
        AND: [
          // Built from (agency, pod) pairs only, so a task with no pod never matches.
          { OR: scope.grants.map((g) => ({ agencyId: g.agencyId, podId: g.podId })) },
          passesRestriction(scope.userId),
          { OR: [{ status: { notIn: [...CLOSED_STATUSES] } }, { assigneeId: scope.userId }] },
        ],
      };
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
  if (scope.kind !== 'PLATFORM') parts.push({ task: taskWhere(scope) });
  if (scope.kind === 'AGENCY') parts.push({ visibility: 'AGENCY' });
  if (scope.kind === 'VA') parts.push({ sensitivity: { in: scope.sensitivities } });
  return { AND: parts };
}

/** Timeline entries the scope may see: agency users never see internal ones. */
export function taskEventWhere(scope: DeskScope): Prisma.TaskEventWhereInput {
  if (scope.kind === 'NONE') return NOTHING;
  const parts: Prisma.TaskEventWhereInput[] = [];
  if (scope.kind !== 'PLATFORM') parts.push({ task: taskWhere(scope) });
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
  // VAs work requests; they do not file them (subtasks come in Module 38).
  if (scope.kind === 'NONE' || scope.kind === 'VA') return refuse(db, scope, 'Task', 'submit', null, ctx, { op: 'submit' });

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

  if (scope.kind === 'AGENCY') {
    return { agencyId: scope.agencyId, insuredId, policyId };
  }
  if (!agencyId) {
    const requested = input.agencyId ?? null;
    const allowed = scopeAgencyIds(scope);
    if (!isObjectId(requested) || (allowed !== 'ALL' && !allowed.includes(requested))) {
      return refuse(db, scope, 'Agency', requested ?? 'none', isObjectId(requested) ? requested : null, ctx, { op: 'submit' });
    }
    if (allowed === 'ALL') {
      const agency = await db.agency.findUnique({ where: { id: requested }, select: { deskEnabled: true } });
      if (!agency?.deskEnabled) return refuse(db, scope, 'Agency', requested, requested, ctx, { op: 'submit', reason: 'desk not enabled' });
    }
    agencyId = requested;
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
  if (scope.kind === 'PLATFORM') return true;
  return scope.kind === 'AGENCY' && scope.role === 'ADMIN' && scope.agencyId === agencyId;
}

// ── Route helpers ──

/** Turns a DeskAccessError into its response; anything else is rethrown. */
export function deskAccessResponse(err: unknown): NextResponse {
  if (err instanceof DeskAccessError) {
    return NextResponse.json({ error: err.status === 404 ? 'Not found' : err.message }, { status: err.status });
  }
  throw err;
}
