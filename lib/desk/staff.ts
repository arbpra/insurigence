/**
 * Internal Desk staff: Account Managers, VAs and Operations Managers. Invites
 * use the same single-use link as agency teammates, so no password is ever
 * sent or seen; the invitee sets their own.
 *
 * Deactivating never waits for a handover, because someone leaving must lose
 * access at once. Their open tasks go back to the queue and the admin is told
 * which agencies need a new Account Manager. Agency and pod assignments stay
 * on record, so reactivating restores them and the setup form flags the gap.
 *
 * Only a Super Admin manages Operations Managers: they hold platform-wide
 * access, so they cannot create or remove their own peers.
 */
import { randomBytes } from 'crypto';
import { Prisma, type PrismaClient, type TaskStatus, type UserRole } from '@prisma/client';
import { APP_URL } from '@/lib/email/client';
import { sendEmail } from '@/lib/email/send';
import { inviteEmail } from '@/lib/email/templates';
import { DESK_ROLES, isDeskRole, roleLabel } from '@/lib/roles';
import { DeskAccessError, isObjectId, type DeskScope, type GuardContext } from './access';
import { assertDeskPlatform } from './agency-setup';
import { recordAudit, type AuditAction } from './audit';
import { CLOSED_STATUSES } from './task-filters';

type Db = PrismaClient;

export type SendInvite = typeof sendEmail;

const TX_OPTIONS = { timeout: 20_000, maxWait: 10_000 };
const INVITE_TTL_HOURS = 72;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const OPEN_TASK = { status: { notIn: [...CLOSED_STATUSES] } };
/**
 * An invite not used yet. Tokens are created without usedAt, and a filter on
 * null alone does not match a field that was never set.
 */
const UNUSED_INVITE: Prisma.InviteTokenWhereInput = { OR: [{ usedAt: null }, { usedAt: { isSet: false } }] };
/** Statuses that mean someone is working on it, so they cannot outlast the person. */
const RESTART_STATUSES = ['ASSIGNED', 'IN_PROGRESS', 'QA_REVIEW'] as const;
/** The team name in the invite: "You're invited to join The Insurigence Desk". */
const TEAM_NAME = 'The Insurigence Desk';

const bad = (message: string) => new DeskAccessError(400, message);
const conflict = (message: string) => new DeskAccessError(409, message);

/** One transaction; losing a write conflict to another save is a 409, not a server error. */
async function inTransaction<T>(db: Db, fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  try {
    return await db.$transaction(fn, TX_OPTIONS);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2034') throw conflict('Someone else just changed this person. Reload and try again.');
    throw err;
  }
}

const personName = (u: { firstName: string | null; lastName: string | null; email: string }) =>
  [u.firstName, u.lastName].filter(Boolean).join(' ') || u.email;

/** May this scope manage a staff member with this role? */
export function canManageRole(scope: DeskScope, role: string): boolean {
  if (scope.kind !== 'PLATFORM' || !isDeskRole(role)) return false;
  return role !== 'DESK_ADMIN' || scope.role === 'SUPER_ADMIN';
}

function assertCanManage(scope: DeskScope, role: string): void {
  if (!canManageRole(scope, role)) throw new DeskAccessError(403, 'Only a Super Admin can manage Operations Managers.');
}

function requiredName(value: unknown, field: string): string {
  const name = typeof value === 'string' ? value.trim() : '';
  if (!name) throw bad(`${field} is required.`);
  if (name.length > 100) throw bad(`${field} must be 100 characters or fewer.`);
  return name;
}

// ── Reading ──

export type InviteState = 'ACCEPTED' | 'PENDING' | 'EXPIRED';

export interface StaffRow {
  id: string;
  email: string;
  name: string;
  firstName: string | null;
  lastName: string | null;
  role: string;
  roleLabel: string;
  isActive: boolean;
  invite: InviteState;
  lastLoginAt: string | null;
  agencies: number;
  pods: number;
  openTasks: number;
  /** Whether the person viewing may change this person. */
  canManage: boolean;
  isSelf: boolean;
}

export async function listStaff(
  db: Db, scope: DeskScope, opts: { q?: string; role?: string; status?: 'active' | 'inactive' } = {}
): Promise<StaffRow[]> {
  assertDeskPlatform(scope);
  const q = opts.q?.trim();
  const roles = opts.role && isDeskRole(opts.role) ? [opts.role as UserRole] : ([...DESK_ROLES] as UserRole[]);
  const users = await db.user.findMany({
    where: {
      role: { in: roles },
      ...(opts.status ? { isActive: opts.status === 'active' } : {}),
      ...(q ? { OR: [
        { email: { contains: q, mode: 'insensitive' as const } },
        { firstName: { contains: q, mode: 'insensitive' as const } },
        { lastName: { contains: q, mode: 'insensitive' as const } },
      ] } : {}),
    },
    orderBy: [{ firstName: 'asc' }, { email: 'asc' }],
    select: {
      id: true, email: true, firstName: true, lastName: true, role: true, isActive: true, passwordHash: true, lastLoginAt: true,
      inviteTokens: { where: UNUSED_INVITE, select: { expiresAt: true } },
      primaryAmFor: { select: { agencyId: true } },
      backupAmFor: { select: { agencyId: true } },
      podMemberships: { select: { podId: true } },
    },
  });
  const ids = users.map((u) => u.id);
  const tasks = ids.length
    ? await db.task.groupBy({ by: ['assigneeId'], where: { assigneeId: { in: ids }, ...OPEN_TASK }, _count: { _all: true } })
    : [];
  const openByUser = new Map(tasks.map((t) => [t.assigneeId, t._count._all]));
  const now = Date.now();

  return users.map((u) => ({
    id: u.id, email: u.email, name: personName(u), firstName: u.firstName, lastName: u.lastName,
    role: u.role, roleLabel: roleLabel(u.role), isActive: u.isActive,
    invite: u.passwordHash ? 'ACCEPTED' : u.inviteTokens.some((t) => t.expiresAt.getTime() > now) ? 'PENDING' : 'EXPIRED',
    lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
    agencies: new Set([...u.primaryAmFor, ...u.backupAmFor].map((a) => a.agencyId)).size,
    pods: u.podMemberships.length,
    openTasks: openByUser.get(u.id) ?? 0,
    canManage: canManageRole(scope, u.role),
    isSelf: u.id === scope.userId,
  }));
}

/** The staff member, or 404 for anyone who is not Desk staff. */
async function loadStaff(db: Db, userId: string) {
  if (!isObjectId(userId)) throw new DeskAccessError(404, 'Not found');
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, firstName: true, lastName: true, role: true, isActive: true, passwordHash: true },
  });
  if (!user || !isDeskRole(user.role)) throw new DeskAccessError(404, 'Not found');
  return user;
}

// ── Inviting ──

export interface InviteResult {
  id: string;
  emailSent: boolean;
  emailError?: string;
  /** Only when the email did not go out, so the admin can share the link. */
  acceptUrl?: string;
}

/** Writes a fresh single-use link, replacing any earlier unused one. */
async function writeInviteToken(tx: Prisma.TransactionClient, userId: string): Promise<string> {
  await tx.inviteToken.deleteMany({ where: { userId, ...UNUSED_INVITE } });
  const token = randomBytes(32).toString('hex');
  await tx.inviteToken.create({ data: { token, userId, expiresAt: new Date(Date.now() + INVITE_TTL_HOURS * 60 * 60 * 1000) } });
  return token;
}

async function deliverInvite(
  db: Db, scope: DeskScope, user: { id: string; email: string; firstName: string | null }, token: string, send: SendInvite
): Promise<InviteResult> {
  const acceptUrl = `${APP_URL}/invite/${token}`;
  const actor = await db.user.findUnique({ where: { id: scope.userId }, select: { firstName: true, lastName: true, email: true } });
  const mail = inviteEmail({
    inviteeName: user.firstName || user.email,
    agencyName: TEAM_NAME,
    invitedByName: actor ? personName(actor) : 'Insurigence',
    acceptUrl,
    expiresInHours: INVITE_TTL_HOURS,
  });
  const sent = await send({ to: user.email, subject: mail.subject, html: mail.html, text: mail.text });
  return sent.ok
    ? { id: user.id, emailSent: true }
    : { id: user.id, emailSent: false, emailError: sent.error, acceptUrl };
}

export async function inviteStaff(
  db: Db, scope: DeskScope,
  input: { email?: unknown; firstName?: unknown; lastName?: unknown; role?: unknown },
  ctx: GuardContext = {}, send: SendInvite = sendEmail
): Promise<InviteResult> {
  assertDeskPlatform(scope);
  const role = String(input.role ?? '');
  if (!isDeskRole(role)) throw bad('Role must be Account Manager, Desk VA or Operations Manager.');
  assertCanManage(scope, role);
  const email = String(input.email ?? '').trim().toLowerCase();
  if (!EMAIL_RE.test(email) || email.length > 254) throw bad('A valid email address is required.');
  const firstName = requiredName(input.firstName, 'First name');
  const lastName = requiredName(input.lastName, 'Last name');
  const taken = () => conflict('A user with this email already exists.');
  if (await db.user.findUnique({ where: { email }, select: { id: true } })) throw taken();

  let created: { id: string; token: string };
  try {
    created = await inTransaction(db, async (tx) => {
      // No password is set: login refuses the account until the invitee sets
      // one through the link. agencyId stays null, as for all Desk staff.
      const user = await tx.user.create({
        data: { email, firstName, lastName, role: role as UserRole, agencyId: null, isActive: true, mustChangePassword: false },
        select: { id: true },
      });
      const token = await writeInviteToken(tx, user.id);
      await recordAudit(tx, {
        actor: { id: scope.userId, role: scope.role }, action: 'staff.invited', entityType: 'User', entityId: user.id,
        metadata: { email, role }, ip: ctx.ip, userAgent: ctx.userAgent,
      });
      return { id: user.id, token };
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') throw taken();
    throw err;
  }
  await logActivity(db, scope, 'USER_CREATED', { createdUserId: created.id, role });
  return deliverInvite(db, scope, { id: created.id, email, firstName }, created.token, send);
}

/** A new link for someone who has not accepted yet. The old link stops working. */
export async function resendStaffInvite(
  db: Db, scope: DeskScope, userId: string, ctx: GuardContext = {}, send: SendInvite = sendEmail
): Promise<InviteResult> {
  assertDeskPlatform(scope);
  const user = await loadStaff(db, userId);
  assertCanManage(scope, user.role);
  if (!user.isActive) throw conflict('Reactivate this person before sending an invite.');
  if (user.passwordHash) throw conflict('This person has already set up their account.');
  const token = await inTransaction(db, async (tx) => {
    const fresh = await writeInviteToken(tx, user.id);
    await audit(tx, scope, 'staff.invite_resent', user.id, { email: user.email }, ctx);
    return fresh;
  });
  return deliverInvite(db, scope, user, token, send);
}

// ── Changing ──

export async function renameStaff(
  db: Db, scope: DeskScope, userId: string, input: { firstName?: unknown; lastName?: unknown }, ctx: GuardContext = {}
): Promise<void> {
  assertDeskPlatform(scope);
  const user = await loadStaff(db, userId);
  assertCanManage(scope, user.role);
  const firstName = requiredName(input.firstName, 'First name');
  const lastName = requiredName(input.lastName, 'Last name');
  if (firstName === user.firstName && lastName === user.lastName) return;
  await inTransaction(db, async (tx) => {
    await tx.user.update({ where: { id: user.id }, data: { firstName, lastName } });
    await audit(tx, scope, 'staff.updated', user.id, { changed: ['name'] }, ctx);
  });
}

export interface DeactivateResult {
  tasksReturned: number;
  /** Agencies left with no active Account Manager. */
  agenciesWithoutAm: string[];
}

export async function deactivateStaff(
  db: Db, scope: DeskScope, userId: string, ctx: GuardContext = {}
): Promise<DeactivateResult> {
  assertDeskPlatform(scope);
  const user = await loadStaff(db, userId);
  assertCanManage(scope, user.role);

  const result = await inTransaction(db, async (tx) => {
    const { count } = await tx.user.updateMany({ where: { id: user.id, isActive: true }, data: { isActive: false } });
    if (count !== 1) throw conflict('This person is already inactive.');
    // Signed out now, and any unused invite link stops working.
    await tx.session.deleteMany({ where: { userId: user.id } });
    await tx.inviteToken.deleteMany({ where: { userId: user.id, ...UNUSED_INVITE } });

    // Their open work goes back to the queue. Waiting tasks keep waiting, with
    // the clock still stopped; started work has no owner now, so it starts over.
    const tasks = await tx.task.findMany({ where: { assigneeId: user.id, ...OPEN_TASK }, select: { id: true, agencyId: true, status: true } });
    const restart = new Set<TaskStatus>(RESTART_STATUSES);
    const now = new Date();
    const ids = tasks.map((t) => t.id);
    await tx.task.updateMany({ where: { id: { in: ids }, status: { in: [...RESTART_STATUSES] } }, data: { status: 'NEW', assigneeId: null, lastActivityAt: now } });
    await tx.task.updateMany({ where: { id: { in: ids }, assigneeId: user.id }, data: { assigneeId: null, lastActivityAt: now } });
    if (tasks.length) {
      await tx.taskEvent.createMany({
        data: tasks.map((t) => ({
          taskId: t.id, agencyId: t.agencyId, actorId: scope.userId, kind: 'UNASSIGNED' as const,
          fromStatus: restart.has(t.status) ? t.status : null, toStatus: restart.has(t.status) ? 'NEW' as const : null,
          metadata: { from: user.id, to: null, automatic: 'staff_deactivated' },
        })),
      });
    }

    // Open work under them as Account Manager moves to the agency's backup,
    // or to nobody; new work skips them too (lib/desk/tasks.ts).
    const assignments = await tx.agencyDeskAssignment.findMany({
      where: { OR: [{ primaryAmId: user.id }, { backupAmId: user.id }] },
      select: {
        agencyId: true,
        agency: { select: { name: true, deskEnabled: true } },
        primaryAm: { select: { id: true, isActive: true } },
        backupAm: { select: { id: true, isActive: true } },
      },
    });
    const agenciesWithoutAm: string[] = [];
    let tasksMoved = 0;
    for (const a of assignments) {
      const next = [a.primaryAm, a.backupAm].find((m) => m && m.isActive && m.id !== user.id)?.id ?? null;
      const moved = await tx.task.updateMany({ where: { agencyId: a.agencyId, amId: user.id, ...OPEN_TASK }, data: { amId: next } });
      tasksMoved += moved.count;
      if (!next && a.agency.deskEnabled) agenciesWithoutAm.push(a.agency.name);
    }

    await audit(tx, scope, 'staff.deactivated', user.id, { email: user.email, role: user.role, tasksReturned: tasks.length, tasksMoved, agenciesWithoutAm: agenciesWithoutAm.length }, ctx);
    return { tasksReturned: tasks.length, agenciesWithoutAm };
  });

  await logActivity(db, scope, 'USER_DEACTIVATED', { deactivatedUserId: user.id });
  return result;
}

export async function reactivateStaff(db: Db, scope: DeskScope, userId: string, ctx: GuardContext = {}): Promise<void> {
  assertDeskPlatform(scope);
  const user = await loadStaff(db, userId);
  assertCanManage(scope, user.role);
  await inTransaction(db, async (tx) => {
    const { count } = await tx.user.updateMany({ where: { id: user.id, isActive: false }, data: { isActive: true } });
    if (count !== 1) throw conflict('This person is already active.');
    await audit(tx, scope, 'staff.reactivated', user.id, { email: user.email, role: user.role }, ctx);
  });
}

function audit(
  tx: Prisma.TransactionClient, scope: DeskScope, action: AuditAction, userId: string, metadata: Record<string, unknown>, ctx: GuardContext
) {
  return recordAudit(tx, {
    actor: { id: scope.userId, role: scope.role }, action, entityType: 'User', entityId: userId,
    metadata, ip: ctx.ip, userAgent: ctx.userAgent,
  });
}

/** The Super Admin activity feed. Best effort: it is not the audit record. */
async function logActivity(db: Db, scope: DeskScope, eventType: 'USER_CREATED' | 'USER_DEACTIVATED', metadata: Prisma.InputJsonObject) {
  try {
    await db.activityEvent.create({ data: { agencyId: null, userId: scope.userId, eventType, metadata } });
  } catch (err) {
    console.error('[desk/staff] activity log failed', err);
  }
}
