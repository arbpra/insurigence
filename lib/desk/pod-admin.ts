/**
 * Pods, who is in them, which agencies each pod may work for, and VA
 * sensitive-data permissions (client answer Q4: access is "controlled by
 * agency authorization, pod assignment, individual permissions, and task
 * requirements"). lib/desk/access.ts reads these on every request, so a change
 * applies at once. Super Admin and Operations Managers only.
 *
 * A pod's access to an agency has three states, stored as AgencyPodAccess rows:
 *  - NONE:  no rows;
 *  - WHOLE: one row with no user, for every VA in the pod;
 *  - NAMED: a row per VA, to "restrict certain agencies … to specific employees".
 *
 * Whenever a change takes a VA's sight of a task away, that task returns to the
 * queue in the same transaction, so nothing sits assigned to someone who cannot
 * open it.
 */
import { randomBytes } from 'crypto';
import { Prisma, type DocumentSensitivity, type PrismaClient } from '@prisma/client';
import { canBePodMember, roleLabel } from '@/lib/roles';
import { literal } from './literal-match';
import { DeskAccessError, isObjectId, type DeskScope, type GuardContext } from './access';
import { assertDeskPlatform } from './agency-setup';
import { recordAudit, type AuditAction } from './audit';
import { DEFAULT_STAFF_SENSITIVITIES, SENSITIVITY_LABELS } from './need-to-know';
import { CLOSED_STATUSES } from './task-filters';
import { returnToQueue } from './task-release';

type Db = PrismaClient;
type Tx = Prisma.TransactionClient;

const TX_OPTIONS = { timeout: 20_000, maxWait: 10_000 };
const OPEN_TASK = { status: { notIn: [...CLOSED_STATUSES] } };

const bad = (message: string) => new DeskAccessError(400, message);
const conflict = (message: string) => new DeskAccessError(409, message);
const notFound = () => new DeskAccessError(404, 'Not found');
const CHANGED_ELSEWHERE = 'Someone else just changed this. Reload and try again.';

const personName = (u: { firstName: string | null; lastName: string | null; email: string }) =>
  [u.firstName, u.lastName].filter(Boolean).join(' ') || u.email;
const PERSON = { id: true, firstName: true, lastName: true, email: true, role: true, isActive: true } as const;

async function inTransaction<T>(db: Db, fn: (tx: Tx) => Promise<T>): Promise<T> {
  try {
    return await db.$transaction(fn, TX_OPTIONS);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && (err.code === 'P2034' || err.code === 'P2002')) throw conflict(CHANGED_ELSEWHERE);
    throw err;
  }
}

function audit(tx: Tx, scope: DeskScope, ctx: GuardContext, action: AuditAction, entityType: string, entityId: string, agencyId: string | null, metadata: Record<string, unknown>) {
  return recordAudit(tx, { actor: { id: scope.userId, role: scope.role }, action, entityType, entityId, agencyId, metadata, ip: ctx.ip, userAgent: ctx.userAgent });
}

/** Returns to the queue any open task whose VA assignee no longer has this pod and agency. */
async function returnUnauthorizedTasks(tx: Tx, podId: string, actorId: string, reason: string, agencyId?: string): Promise<number> {
  const tasks = await tx.task.findMany({
    where: { podId, ...(agencyId ? { agencyId } : {}), assigneeId: { not: null }, assignee: { role: 'DESK_VA' }, ...OPEN_TASK },
    select: { id: true, agencyId: true, status: true, assigneeId: true },
  });
  if (tasks.length === 0) return 0;
  const [members, access] = await Promise.all([
    tx.podMember.findMany({ where: { podId }, select: { userId: true } }),
    tx.agencyPodAccess.findMany({ where: { podId, agencyId: { in: [...new Set(tasks.map((t) => t.agencyId))] } }, select: { agencyId: true, userId: true } }),
  ]);
  const inPod = new Set(members.map((m) => m.userId));
  const stranded = tasks.filter((t) => !inPod.has(t.assigneeId!) || !access.some((a) => a.agencyId === t.agencyId && (!a.userId || a.userId === t.assigneeId)));
  return returnToQueue(tx, stranded, actorId, reason);
}

// ── Pods ──

export async function listPods(db: Db, scope: DeskScope) {
  assertDeskPlatform(scope);
  const [pods, eligible] = await Promise.all([
    db.pod.findMany({
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      include: { members: { select: { user: { select: PERSON } } }, agencyAccess: { select: { agencyId: true } } },
    }),
    db.user.findMany({ where: { role: { in: ['DESK_VA', 'ACCOUNT_MANAGER'] }, isActive: true }, select: PERSON, orderBy: [{ firstName: 'asc' }, { email: 'asc' }] }),
  ]);
  const open = await db.task.groupBy({ by: ['podId'], where: { podId: { in: pods.map((p) => p.id) }, ...OPEN_TASK }, _count: { _all: true } });
  const openByPod = new Map(open.map((o) => [o.podId, o._count._all]));
  const person = (u: { id: string; firstName: string | null; lastName: string | null; email: string; role: string; isActive: boolean }) =>
    ({ id: u.id, name: personName(u), role: u.role, roleLabel: roleLabel(u.role), isActive: u.isActive });
  return {
    pods: pods.map((p) => ({
      id: p.id, code: p.code, name: p.name, description: p.description, isActive: p.isActive,
      members: p.members.map((m) => person(m.user)).sort((a, b) => a.name.localeCompare(b.name)),
      agencies: new Set(p.agencyAccess.map((a) => a.agencyId)).size,
      openTasks: openByPod.get(p.id) ?? 0,
    })),
    eligible: eligible.map(person),
  };
}

function podName(value: unknown): string {
  const name = typeof value === 'string' ? value.trim() : '';
  if (!name) throw bad('Pod name is required.');
  if (name.length > 100) throw bad('Pod name must be 100 characters or fewer.');
  return name;
}

function podDescription(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') throw bad('Description must be text.');
  const text = value.trim();
  if (text.length > 500) throw bad('Description must be 500 characters or fewer.');
  return text || null;
}

async function assertNameFree(db: Db, name: string, exceptId?: string) {
  const same = await db.pod.findFirst({ where: { name: { equals: literal(name), mode: 'insensitive' }, ...(exceptId ? { id: { not: exceptId } } : {}) }, select: { id: true } });
  if (same) throw conflict('Another pod already has this name.');
}

export async function createPod(db: Db, scope: DeskScope, input: { name?: unknown; description?: unknown }, ctx: GuardContext = {}): Promise<{ id: string }> {
  assertDeskPlatform(scope);
  const name = podName(input.name);
  const description = podDescription(input.description);
  await assertNameFree(db, name);
  const last = await db.pod.findFirst({ orderBy: { sortOrder: 'desc' }, select: { sortOrder: true } });
  // The code is a permanent key, so a later rename leaves it alone.
  const slug = name.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'POD';
  const code = `${slug}_${randomBytes(2).toString('hex').toUpperCase()}`;
  return inTransaction(db, async (tx) => {
    const pod = await tx.pod.create({ data: { code, name, description, sortOrder: (last?.sortOrder ?? 0) + 1 }, select: { id: true } });
    await audit(tx, scope, ctx, 'pod.created', 'Pod', pod.id, null, { code, name });
    return pod;
  });
}

async function loadPod(db: Db, podId: string) {
  if (!isObjectId(podId)) throw notFound();
  const pod = await db.pod.findUnique({ where: { id: podId } });
  if (!pod) throw notFound();
  return pod;
}

/** Only the fields present are changed. A pod still in use cannot be switched off. */
export async function updatePod(
  db: Db, scope: DeskScope, podId: string, input: { name?: unknown; description?: unknown; isActive?: unknown }, ctx: GuardContext = {}
): Promise<void> {
  assertDeskPlatform(scope);
  const pod = await loadPod(db, podId);
  const data: Prisma.PodUpdateInput = {};
  if (input.name !== undefined) {
    const name = podName(input.name);
    if (name !== pod.name) { await assertNameFree(db, name, pod.id); data.name = name; }
  }
  if (input.description !== undefined) {
    const description = podDescription(input.description);
    if (description !== (pod.description ?? null)) data.description = description;
  }
  if (input.isActive !== undefined) {
    if (typeof input.isActive !== 'boolean') throw bad('isActive must be true or false.');
    if (input.isActive !== pod.isActive) data.isActive = input.isActive;
    if (input.isActive === false && pod.isActive) {
      const [routes, followUps, open] = await Promise.all([
        db.taskRoutingRule.count({ where: { podId, isActive: true } }),
        db.taskFollowUpRule.count({ where: { podId, isActive: true } }),
        db.task.count({ where: { podId, ...OPEN_TASK } }),
      ]);
      const uses = [
        routes ? `${routes} request type${routes === 1 ? '' : 's'} routed here` : '',
        followUps ? `${followUps} follow-up rule${followUps === 1 ? '' : 's'}` : '',
        open ? `${open} open request${open === 1 ? '' : 's'}` : '',
      ].filter(Boolean);
      if (uses.length) throw conflict(`This pod is still in use: ${uses.join(', ')}. Move these first.`);
    }
  }
  const changed = Object.keys(data);
  if (changed.length === 0) return;
  await inTransaction(db, async (tx) => {
    await tx.pod.update({ where: { id: pod.id }, data });
    await audit(tx, scope, ctx, 'pod.updated', 'Pod', pod.id, null, { changed, ...(data.isActive !== undefined ? { isActive: data.isActive } : {}) });
  });
}

// ── Members ──

export async function addPodMember(db: Db, scope: DeskScope, podId: string, userId: unknown, ctx: GuardContext = {}): Promise<void> {
  assertDeskPlatform(scope);
  const pod = await loadPod(db, podId);
  if (!pod.isActive) throw conflict('This pod is switched off.');
  if (!isObjectId(userId)) throw bad('Choose an active VA or Account Manager.');
  const user = await db.user.findUnique({ where: { id: userId }, select: { role: true, isActive: true } });
  if (!user || !user.isActive || !canBePodMember(user.role)) throw bad('Choose an active VA or Account Manager.');
  if (await db.podMember.findUnique({ where: { podId_userId: { podId, userId } }, select: { id: true } })) throw conflict('Already in this pod.');
  await inTransaction(db, async (tx) => {
    await tx.podMember.create({ data: { podId, userId } });
    await audit(tx, scope, ctx, 'pod.member_added', 'Pod', podId, null, { userId, role: user.role });
  });
}

/**
 * Removes someone from a pod, along with any agency access naming them in it,
 * so adding them back later does not quietly restore that access.
 */
export async function removePodMember(db: Db, scope: DeskScope, podId: string, userId: unknown, ctx: GuardContext = {}): Promise<{ tasksReturned: number }> {
  assertDeskPlatform(scope);
  await loadPod(db, podId);
  if (!isObjectId(userId)) throw notFound();
  return inTransaction(db, async (tx) => {
    const { count } = await tx.podMember.deleteMany({ where: { podId, userId } });
    if (count !== 1) throw conflict('Not in this pod.');
    const named = await tx.agencyPodAccess.deleteMany({ where: { podId, userId } });
    const tasksReturned = await returnUnauthorizedTasks(tx, podId, scope.userId, 'removed_from_pod');
    await audit(tx, scope, ctx, 'pod.member_removed', 'Pod', podId, null, { userId, namedAccessRemoved: named.count, tasksReturned });
    return { tasksReturned };
  });
}

// ── Agency access ──

export type PodAccessMode = 'NONE' | 'WHOLE' | 'NAMED';

export async function getAgencyPodAccess(db: Db, scope: DeskScope, agencyId: string) {
  assertDeskPlatform(scope);
  if (!isObjectId(agencyId)) throw notFound();
  const agency = await db.agency.findUnique({ where: { id: agencyId }, select: { id: true, name: true, deskEnabled: true } });
  if (!agency) throw notFound();
  const [pods, rows] = await Promise.all([
    db.pod.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      select: { id: true, name: true, members: { where: { user: { role: 'DESK_VA' } }, select: { user: { select: PERSON } } } },
    }),
    db.agencyPodAccess.findMany({ where: { agencyId }, select: { podId: true, userId: true } }),
  ]);
  return {
    agency,
    pods: pods.map((p) => {
      const own = rows.filter((r) => r.podId === p.id);
      const whole = own.some((r) => !r.userId);
      return {
        id: p.id, name: p.name,
        mode: (whole ? 'WHOLE' : own.length ? 'NAMED' : 'NONE') as PodAccessMode,
        userIds: whole ? [] : own.map((r) => r.userId!),
        vas: p.members.map((m) => ({ id: m.user.id, name: personName(m.user), isActive: m.user.isActive })),
      };
    }),
  };
}

export async function setAgencyPodAccess(
  db: Db, scope: DeskScope, agencyId: string, input: { podId?: unknown; mode?: unknown; userIds?: unknown }, ctx: GuardContext = {}
): Promise<{ tasksReturned: number }> {
  assertDeskPlatform(scope);
  if (!isObjectId(agencyId) || !(await db.agency.findUnique({ where: { id: agencyId }, select: { id: true } }))) throw notFound();
  if (!isObjectId(input.podId)) throw bad('Choose a pod.');
  const podId = input.podId;
  const pod = await db.pod.findUnique({ where: { id: podId }, select: { isActive: true } });
  if (!pod) throw bad('Choose a pod.');
  if (input.mode !== 'NONE' && input.mode !== 'WHOLE' && input.mode !== 'NAMED') throw bad('Choose how this pod is authorized.');
  const mode = input.mode;
  if (mode !== 'NONE' && !pod.isActive) throw conflict('This pod is switched off.');

  const current = await db.agencyPodAccess.findMany({ where: { agencyId, podId }, select: { userId: true } });
  const currentNamed = current.flatMap((r) => (r.userId ? [r.userId] : []));
  const currentMode: PodAccessMode = current.some((r) => !r.userId) ? 'WHOLE' : current.length ? 'NAMED' : 'NONE';

  let named: string[] = [];
  if (mode === 'NAMED') {
    if (!Array.isArray(input.userIds) || input.userIds.length === 0) throw bad('Name at least one VA, or choose "Not authorized".');
    if (!input.userIds.every(isObjectId)) throw bad('Choose VAs in this pod.');
    named = [...new Set(input.userIds as string[])];
    const members = await db.podMember.findMany({
      where: { podId, userId: { in: named }, user: { role: 'DESK_VA' } },
      select: { userId: true, user: { select: { isActive: true } } },
    });
    if (members.length !== named.length) throw bad('Choose VAs in this pod.');
    // Only newly named people must be active, so someone deactivated later does
    // not stop an admin changing the others.
    if (members.some((m) => !m.user.isActive && !currentNamed.includes(m.userId))) throw bad('Choose active VAs.');
  }

  const sameNames = named.length === currentNamed.length && named.every((id) => currentNamed.includes(id));
  if (mode === currentMode && sameNames) return { tasksReturned: 0 };

  return inTransaction(db, async (tx) => {
    await tx.agencyPodAccess.deleteMany({ where: { agencyId, podId } });
    if (mode === 'WHOLE') await tx.agencyPodAccess.create({ data: { agencyId, podId } });
    if (mode === 'NAMED') await tx.agencyPodAccess.createMany({ data: named.map((userId) => ({ agencyId, podId, userId })) });
    const tasksReturned = await returnUnauthorizedTasks(tx, podId, scope.userId, 'pod_access_changed', agencyId);
    await audit(tx, scope, ctx, 'pod.access_changed', 'Agency', agencyId, agencyId, {
      podId, from: { mode: currentMode, userIds: currentNamed }, to: { mode, userIds: named }, tasksReturned,
    });
    return { tasksReturned };
  });
}

// ── VA sensitive-data permissions ──

/** Categories that need an individual grant; every VA already has the defaults. */
export const GRANTABLE_SENSITIVITIES = (Object.keys(SENSITIVITY_LABELS) as DocumentSensitivity[])
  .filter((s) => !DEFAULT_STAFF_SENSITIVITIES.includes(s));

export async function listVaPermissions(db: Db, scope: DeskScope) {
  assertDeskPlatform(scope);
  const vas = await db.user.findMany({
    where: { role: 'DESK_VA' },
    orderBy: [{ firstName: 'asc' }, { email: 'asc' }],
    select: { ...PERSON, deskPermission: { select: { allowedSensitivities: true } } },
  });
  return vas.map((v) => ({ id: v.id, name: personName(v), isActive: v.isActive, granted: v.deskPermission?.allowedSensitivities ?? [] }));
}

export async function setVaPermissions(db: Db, scope: DeskScope, userId: string, granted: unknown, ctx: GuardContext = {}): Promise<void> {
  assertDeskPlatform(scope);
  if (!isObjectId(userId)) throw notFound();
  const user = await db.user.findUnique({ where: { id: userId }, select: { role: true, deskPermission: { select: { allowedSensitivities: true } } } });
  if (!user || user.role !== 'DESK_VA') throw notFound();
  if (!Array.isArray(granted) || !granted.every((g) => GRANTABLE_SENSITIVITIES.includes(g))) throw bad('Unknown document category.');
  const next = [...new Set(granted as DocumentSensitivity[])];
  const before = user.deskPermission?.allowedSensitivities ?? [];
  if (next.length === before.length && next.every((g) => before.includes(g))) return;
  await inTransaction(db, async (tx) => {
    await tx.deskStaffPermission.upsert({
      where: { userId },
      create: { userId, allowedSensitivities: next, grantedById: scope.userId },
      update: { allowedSensitivities: next, grantedById: scope.userId },
    });
    await audit(tx, scope, ctx, 'permission.changed', 'User', userId, null, { from: before, to: next });
  });
}
