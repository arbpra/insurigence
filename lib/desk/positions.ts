/**
 * Positions and the people who hold them (Module 47). The Super Admin edits
 * them; nobody else, so no one can widen their own access.
 *
 *  - ensureDefaultPositions: creates the client's positions if missing, then
 *    gives every Desk staff member without a position the one for their role
 *    (DESK_ADMIN → COO, ACCOUNT_MANAGER → Account Manager, DESK_VA → VA).
 *    Create-only: it never changes a position the Super Admin edited, except
 *    that a permission added to the catalogue later (PERMISSION_ADDITIONS) is
 *    given once to the default positions listed for it.
 *  - effectivePermissions: what one person may do, the union of their active
 *    positions (lib/desk/staff-profile.ts, which the access layer uses too).
 *  - list / create / update positions, add and remove holders: audited. Open
 *    work a person can no longer see or work goes back to the queue with it.
 */
import { Prisma, type DeskAgencyReach, type DeskDepartment, type PrismaClient, type UserRole } from '@prisma/client';
import { isDeskRole, roleLabel } from '@/lib/roles';
import { can, DeskAccessError, isObjectId, resolveDeskScope, taskWhere, type DeskScope, type GuardContext } from './access';
import { recordAudit, type AuditAction } from './audit';
import { DEFAULT_POSITIONS, PERMISSION_ADDITIONS, PERMISSION_KEYS, REACH_ORDER, isPermissionKey, type PermissionKey } from './permission-catalogue';
import { staffProfile } from './staff-profile';
import { CLOSED_STATUSES } from './task-filters';
import { returnToQueue } from './task-release';

type Db = PrismaClient;
type Tx = Prisma.TransactionClient;

const DEPARTMENTS: readonly DeskDepartment[] = ['EXECUTIVE', 'VIRTUAL_OPERATIONS', 'AGENCY_OPERATIONS'];
const REACHES: readonly DeskAgencyReach[] = REACH_ORDER;
const NAME_MAX = 80;
const DESCRIPTION_MAX = 300;

const bad = (message: string) => new DeskAccessError(400, message);
const conflict = (message: string) => new DeskAccessError(409, message);
const notFound = () => new DeskAccessError(404, 'Not found');
const CHANGED_ELSEWHERE = 'Someone else just changed this position. Reload and try again.';

const personName = (u: { firstName: string | null; lastName: string | null; email: string }) =>
  [u.firstName, u.lastName].filter(Boolean).join(' ') || u.email;
const PERSON = { id: true, firstName: true, lastName: true, email: true, role: true, isActive: true } as const;

async function inTransaction<T>(db: Db, fn: (tx: Tx) => Promise<T>): Promise<T> {
  try {
    return await db.$transaction(fn, { timeout: 60_000, maxWait: 10_000 });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && (err.code === 'P2034' || err.code === 'P2002')) throw conflict(CHANGED_ELSEWHERE);
    throw err;
  }
}

function audit(tx: Tx | Db, scope: DeskScope, ctx: GuardContext, action: AuditAction, entityId: string | null, metadata: Record<string, unknown>) {
  return recordAudit(tx, { actor: { id: scope.userId, role: scope.role }, action, entityType: 'DeskPosition', entityId, metadata, ip: ctx.ip, userAgent: ctx.userAgent });
}

/** Only the Super Admin manages positions. A refusal is logged. */
async function assertSuperAdmin(db: Db, scope: DeskScope, ctx: GuardContext): Promise<void> {
  if (scope.kind === 'PLATFORM' && scope.role === 'SUPER_ADMIN') return;
  await recordAudit(db, {
    actor: { id: scope.userId, role: scope.role }, action: 'access.denied', entityType: 'DeskPosition',
    metadata: { scope: scope.kind, reason: 'positions are managed by the Super Admin' }, ip: ctx.ip, userAgent: ctx.userAgent,
  });
  throw new DeskAccessError(403, 'Only the Super Admin can manage positions.');
}

// ── Defaults and migration ──

/** Gives a Desk staff member the position for their role, if they hold none. Returns whether one was given. */
export async function placeByRole(tx: Tx | Db, user: { id: string; role: UserRole }, assignedById: string | null): Promise<boolean> {
  if (!isDeskRole(user.role)) return false;
  if (await tx.deskPositionHolder.count({ where: { userId: user.id } })) return false;
  const position = await tx.deskPosition.findFirst({ where: { legacyRole: user.role, isActive: true }, orderBy: { sortOrder: 'asc' }, select: { id: true } });
  if (!position) return false;
  await tx.deskPositionHolder.create({ data: { userId: user.id, positionId: position.id, assignedById } });
  return true;
}

/** The DeskJobRun that records a catalogue addition as given. */
export const additionMarker = (key: string) => `permission-added:${key}`;

export async function ensureDefaultPositions(db: Db): Promise<{ created: string[]; staffPlaced: number; permissionsAdded: string[] }> {
  const created: string[] = [];
  for (const [i, p] of DEFAULT_POSITIONS.entries()) {
    if (await db.deskPosition.findUnique({ where: { code: p.code }, select: { id: true } })) continue;
    await db.deskPosition.create({
      data: {
        code: p.code, name: p.name, description: p.description, department: p.department, reach: p.reach,
        permissions: [...p.permissions], legacyRole: p.legacyRole, isSystem: true, sortOrder: i + 1,
      },
    });
    created.push(p.code);
  }
  // Reporting lines only for positions created now, so an edit is never undone.
  if (created.length) {
    const ids = new Map((await db.deskPosition.findMany({ select: { id: true, code: true } })).map((p) => [p.code, p.id]));
    for (const p of DEFAULT_POSITIONS) {
      if (!created.includes(p.code) || !p.reportsTo || !ids.get(p.reportsTo)) continue;
      await db.deskPosition.update({ where: { code: p.code }, data: { reportsToId: ids.get(p.reportsTo)! } });
    }
  }
  const permissionsAdded = await applyPermissionAdditions(db);
  let staffPlaced = 0;
  const staff = await db.user.findMany({ where: { role: { in: ['DESK_ADMIN', 'ACCOUNT_MANAGER', 'DESK_VA'] }, deskPositions: { none: {} } }, select: { id: true, role: true } });
  for (const user of staff) if (await placeByRole(db, user, null)) staffPlaced += 1;
  return { created, staffPlaced, permissionsAdded };
}

export interface PermissionAddition { key: PermissionKey; module: number; codes: readonly string[]; /** Tests only: another marker. */ marker?: string }

/**
 * Permissions added to the catalogue later, given to the default positions
 * listed for each: once each (recorded as a DeskJobRun), so a removal by the
 * Super Admin stands. Returns what was given, for the seed's output.
 */
export async function applyPermissionAdditions(db: Db, additions: readonly PermissionAddition[] = PERMISSION_ADDITIONS): Promise<string[]> {
  const permissionsAdded: string[] = [];
  for (const add of additions) {
    const id = add.marker ?? additionMarker(add.key);
    if (await db.deskJobRun.findUnique({ where: { id }, select: { id: true } })) continue;
    const given: string[] = [];
    for (const position of await db.deskPosition.findMany({ where: { code: { in: [...add.codes] }, isSystem: true }, select: { id: true, code: true, permissions: true } })) {
      if (position.permissions.includes(add.key)) continue;
      await db.deskPosition.update({ where: { id: position.id }, data: { permissions: [...position.permissions, add.key] } });
      given.push(position.code);
    }
    const now = new Date();
    await db.deskJobRun.create({ data: { id, startedAt: now, finishedAt: now, result: { module: add.module, positions: given } } });
    permissionsAdded.push(`${add.key} → ${given.join(', ') || 'none needed'}`);
  }
  return permissionsAdded;
}

// ── What a person may do ──

export interface EffectivePermissions {
  permissions: Set<PermissionKey>;
  /** Every reach the person's active positions give. */
  reaches: Set<DeskAgencyReach>;
  positions: { id: string; code: string; name: string }[];
}

/** The union of a person's active positions. The Super Admin has everything. Unknown keys are ignored. */
export async function effectivePermissions(db: Db | Tx, userId: string): Promise<EffectivePermissions> {
  const user = await db.user.findUnique({ where: { id: userId }, select: { id: true, role: true, isActive: true } });
  if (!user || !user.isActive) return { permissions: new Set(), reaches: new Set(), positions: [] };
  const profile = await staffProfile(db, user);
  return { permissions: new Set(profile.permissions), reaches: new Set(profile.reaches), positions: profile.positions };
}

// ── Reading ──

export async function listPositions(db: Db, scope: DeskScope, ctx: GuardContext = {}) {
  await assertSuperAdmin(db, scope, ctx);
  const [positions, staff] = await Promise.all([
    db.deskPosition.findMany({
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      include: { holders: { select: { user: { select: PERSON } }, orderBy: { createdAt: 'asc' } } },
    }),
    db.user.findMany({
      where: { role: { in: ['DESK_ADMIN', 'ACCOUNT_MANAGER', 'DESK_VA'] } },
      select: { ...PERSON, deskPositions: { select: { positionId: true } } },
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }, { email: 'asc' }],
    }),
  ]);
  const names = new Map(positions.map((p) => [p.id, p.name]));
  const byDepartment = (d: DeskDepartment) => DEPARTMENTS.indexOf(d);
  return {
    positions: positions
      .sort((a, b) => byDepartment(a.department) - byDepartment(b.department) || a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
      .map((p) => ({
        id: p.id, code: p.code, name: p.name, description: p.description, department: p.department, reach: p.reach,
        permissions: p.permissions.filter(isPermissionKey),
        reportsToId: p.reportsToId, reportsToName: p.reportsToId ? names.get(p.reportsToId) ?? null : null,
        legacyRole: p.legacyRole, isSystem: p.isSystem, isActive: p.isActive, updatedAt: p.updatedAt.toISOString(),
        holders: p.holders.map(({ user: u }) => ({ id: u.id, name: personName(u), email: u.email, role: roleLabel(u.role), isActive: u.isActive })),
      })),
    staff: staff.map((u) => ({ id: u.id, name: personName(u), email: u.email, role: roleLabel(u.role), isActive: u.isActive, positionIds: u.deskPositions.map((d) => d.positionId) })),
  };
}

// ── Validation ──

function name(value: unknown): string {
  const text = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
  if (text.length < 2) throw bad('A position needs a name.');
  if (text.length > NAME_MAX) throw bad(`A position name can be up to ${NAME_MAX} characters.`);
  return text;
}

function description(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') throw bad('The description must be text.');
  const text = value.trim();
  if (text.length > DESCRIPTION_MAX) throw bad(`The description can be up to ${DESCRIPTION_MAX} characters.`);
  return text || null;
}

function department(value: unknown): DeskDepartment {
  if (!DEPARTMENTS.includes(value as DeskDepartment)) throw bad('Choose a department.');
  return value as DeskDepartment;
}

function reach(value: unknown): DeskAgencyReach {
  if (!REACHES.includes(value as DeskAgencyReach)) throw bad('Choose which agencies the position reaches.');
  return value as DeskAgencyReach;
}

function permissions(value: unknown): PermissionKey[] {
  if (!Array.isArray(value)) throw bad('Permissions must be a list.');
  const unknown = value.filter((k) => !isPermissionKey(k));
  if (unknown.length) throw bad(`Unknown permission: ${String(unknown[0]).slice(0, 60)}.`);
  const chosen = new Set(value as PermissionKey[]);
  return PERMISSION_KEYS.filter((k) => chosen.has(k));
}

/** Null, or a position that exists and doesn't sit below `selfId` (no loops). */
async function reportsTo(db: Db | Tx, value: unknown, selfId: string | null): Promise<string | null> {
  if (value === null || value === undefined || value === '') return null;
  if (!isObjectId(value)) throw bad('Choose the position it reports to.');
  if (value === selfId) throw bad('A position cannot report to itself.');
  const all = await db.deskPosition.findMany({ select: { id: true, reportsToId: true } });
  const parent = new Map(all.map((p) => [p.id, p.reportsToId]));
  if (!parent.has(value)) throw bad('That position does not exist.');
  for (let at: string | null | undefined = value, steps = 0; at && steps <= all.length; at = parent.get(at), steps++) {
    if (at === selfId) throw bad('That would make the positions report to each other in a loop.');
  }
  return value;
}

function codeFor(text: string): string {
  return text.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40) || 'POSITION';
}

// ── Changing ──

/**
 * Returns to the queue the open work these people hold but can no longer see
 * or work, so it never sits with someone who can't do it. Agencies with The
 * Desk off are left alone: nobody sees their work until it is back on.
 */
export async function releaseUnreachable(tx: Tx, userIds: string[], actorId: string | null, reason = 'position_changed'): Promise<number> {
  const held = await tx.task.findMany({
    where: { assigneeId: { in: userIds }, status: { notIn: [...CLOSED_STATUSES] }, agency: { is: { deskEnabled: true } } },
    select: { id: true, agencyId: true, status: true, assigneeId: true },
  });
  let returned = 0;
  for (const userId of new Set(held.map((t) => t.assigneeId!))) {
    const own = held.filter((t) => t.assigneeId === userId);
    const scope = await resolveDeskScope(tx, userId);
    const reachable = can(scope, 'requests.work')
      ? new Set((await tx.task.findMany({ where: { AND: [{ id: { in: own.map((t) => t.id) } }, taskWhere(scope)] }, select: { id: true } })).map((t) => t.id))
      : new Set<string>();
    returned += await returnToQueue(tx, own.filter((t) => !reachable.has(t.id)), actorId, reason);
  }
  return returned;
}

export async function createPosition(db: Db, scope: DeskScope, input: Record<string, unknown>, ctx: GuardContext = {}) {
  await assertSuperAdmin(db, scope, ctx);
  const data = {
    name: name(input.name),
    description: description(input.description),
    department: department(input.department),
    reach: reach(input.reach),
    permissions: permissions(input.permissions ?? []),
  };
  return inTransaction(db, async (tx) => {
    if (await tx.deskPosition.findFirst({ where: { name: { equals: data.name, mode: 'insensitive' } }, select: { id: true } })) {
      throw conflict('A position with this name already exists.');
    }
    const reportsToId = await reportsTo(tx, input.reportsToId, null);
    const base = codeFor(data.name);
    let code = base;
    for (let n = 2; await tx.deskPosition.findUnique({ where: { code }, select: { id: true } }); n++) code = `${base}_${n}`;
    const last = await tx.deskPosition.findFirst({ orderBy: { sortOrder: 'desc' }, select: { sortOrder: true } });
    const position = await tx.deskPosition.create({ data: { ...data, code, reportsToId, sortOrder: (last?.sortOrder ?? 0) + 1 } });
    await audit(tx, scope, ctx, 'position.created', position.id, { code, name: data.name, department: data.department, reach: data.reach, permissions: data.permissions, reportsToId });
    return { id: position.id, code };
  });
}

/** Changes any of: name, description, department, reach, permissions, reportsToId, isActive. */
export async function updatePosition(db: Db, scope: DeskScope, positionId: string, input: Record<string, unknown>, ctx: GuardContext = {}) {
  await assertSuperAdmin(db, scope, ctx);
  if (!isObjectId(positionId)) throw notFound();
  return inTransaction(db, async (tx) => {
    const current = await tx.deskPosition.findUnique({ where: { id: positionId }, include: { _count: { select: { holders: true } } } });
    if (!current) throw notFound();
    const data: Prisma.DeskPositionUpdateManyMutationInput = {};
    const changes: Record<string, { from: unknown; to: unknown }> = {};
    const set = (key: 'name' | 'description' | 'department' | 'reach' | 'reportsToId' | 'isActive', to: unknown, from: unknown) => {
      if (to === from) return;
      (data as Record<string, unknown>)[key] = to;
      changes[key] = { from, to };
    };
    if ('name' in input) {
      const to = name(input.name);
      if (to !== current.name && await tx.deskPosition.findFirst({ where: { id: { not: positionId }, name: { equals: to, mode: 'insensitive' } }, select: { id: true } })) {
        throw conflict('A position with this name already exists.');
      }
      set('name', to, current.name);
    }
    if ('description' in input) set('description', description(input.description), current.description);
    if ('department' in input) set('department', department(input.department), current.department);
    if ('reach' in input) set('reach', reach(input.reach), current.reach);
    if ('reportsToId' in input) set('reportsToId', await reportsTo(tx, input.reportsToId, positionId), current.reportsToId);
    if ('permissions' in input) {
      const to = permissions(input.permissions);
      const from = current.permissions.filter(isPermissionKey);
      if (to.join() !== from.join()) {
        data.permissions = to;
        changes.permissions = { from: PERMISSION_KEYS.filter((k) => from.includes(k) && !to.includes(k)), to: to.filter((k) => !from.includes(k)) };
      }
    }
    if ('isActive' in input) {
      if (typeof input.isActive !== 'boolean') throw bad('isActive must be true or false.');
      if (!input.isActive && current.isActive) {
        if (current._count.holders) throw conflict(`${current._count.holders} ${current._count.holders === 1 ? 'person holds' : 'people hold'} this position. Move them to another position first.`);
        const below = await tx.deskPosition.count({ where: { reportsToId: positionId, isActive: true } });
        if (below) throw conflict(`${below} active position${below === 1 ? ' reports' : 's report'} to this one. Change who they report to first.`);
      }
      set('isActive', input.isActive, current.isActive);
    }
    if (!Object.keys(changes).length) throw conflict('Nothing to change.');
    const { count } = await tx.deskPosition.updateMany({ where: { id: positionId, updatedAt: current.updatedAt }, data });
    if (!count) throw conflict(CHANGED_ELSEWHERE);
    const holders = changes.reach || changes.permissions || changes.isActive
      ? (await tx.deskPositionHolder.findMany({ where: { positionId }, select: { userId: true } })).map((h) => h.userId)
      : [];
    const tasksReturned = holders.length ? await releaseUnreachable(tx, holders, scope.userId) : 0;
    // Permission changes are listed as removed (`from`) and added (`to`).
    await audit(tx, scope, ctx, 'position.updated', positionId, { code: current.code, name: current.name, changes, holders: current._count.holders, tasksReturned });
    return { id: positionId, changed: Object.keys(changes), tasksReturned };
  });
}

export async function addPositionHolder(db: Db, scope: DeskScope, positionId: string, input: { userId?: unknown }, ctx: GuardContext = {}) {
  await assertSuperAdmin(db, scope, ctx);
  if (!isObjectId(positionId)) throw notFound();
  const userId = input.userId;
  if (!isObjectId(userId)) throw bad('Choose a person.');
  return inTransaction(db, async (tx) => {
    const position = await tx.deskPosition.findUnique({ where: { id: positionId }, select: { id: true, code: true, name: true, isActive: true } });
    if (!position) throw notFound();
    if (!position.isActive) throw conflict('This position is switched off.');
    const user = await tx.user.findUnique({ where: { id: userId }, select: PERSON });
    if (!user || !isDeskRole(user.role)) throw bad('Only Desk staff can hold a position.');
    if (await tx.deskPositionHolder.findUnique({ where: { userId_positionId: { userId, positionId } }, select: { id: true } })) {
      throw conflict(`${personName(user)} already holds this position.`);
    }
    await tx.deskPositionHolder.create({ data: { userId, positionId, assignedById: scope.userId } });
    // A first position replaces the default for their role, which can narrow what they reach.
    const tasksReturned = await releaseUnreachable(tx, [userId], scope.userId);
    await audit(tx, scope, ctx, 'position.holder_added', positionId, { code: position.code, position: position.name, userId, name: personName(user), tasksReturned });
    return { positionId, userId, tasksReturned };
  });
}

export async function removePositionHolder(db: Db, scope: DeskScope, positionId: string, userId: string, ctx: GuardContext = {}) {
  await assertSuperAdmin(db, scope, ctx);
  if (!isObjectId(positionId) || !isObjectId(userId)) throw notFound();
  return inTransaction(db, async (tx) => {
    const holder = await tx.deskPositionHolder.findUnique({
      where: { userId_positionId: { userId, positionId } },
      select: { id: true, position: { select: { code: true, name: true } }, user: { select: PERSON } },
    });
    if (!holder) throw notFound();
    // An active person with no position would lose The Desk altogether.
    if (holder.user.isActive && (await tx.deskPositionHolder.count({ where: { userId } })) === 1) {
      throw conflict(`This is ${personName(holder.user)}'s only position. Give them another first, or deactivate them on the Staff page.`);
    }
    await tx.deskPositionHolder.delete({ where: { id: holder.id } });
    const tasksReturned = await releaseUnreachable(tx, [userId], scope.userId);
    await audit(tx, scope, ctx, 'position.holder_removed', positionId, { code: holder.position.code, position: holder.position.name, userId, name: personName(holder.user), tasksReturned });
    return { positionId, userId, tasksReturned };
  });
}
