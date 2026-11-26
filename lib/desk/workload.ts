/**
 * The workload view (Module 40): all open work across agencies and pods, for
 * Operations Managers and the Super Admin. Counts per pod, per person and per
 * agency, the list of tasks behind them, and changes to several tasks at once.
 *
 * Every change still goes through the task service one task at a time
 * (lib/desk/tasks.ts), so each is checked, recorded and audited as if made
 * from the task itself.
 */
import type { PrismaClient, TaskStatus } from '@prisma/client';
import { can, DeskAccessError, isObjectId, taskWhere, type DeskScope, type GuardContext } from './access';
import { listTasks, setTaskAssignee, setTaskPod, type TaskListOptions } from './task-api';
import { CLOSED_STATUSES } from './task-filters';
import { lastAlertRun } from './alerts';
import { checkIntervalMinutes, cronSecret } from './alert-schedule';

type Db = PrismaClient;

/**
 * Positions that reach every agency and allow `workload.view` (the COO, the
 * Directors) and the Super Admin; the routes refuse everyone else first, and
 * log it. A Pod Leader's view of their own pods comes in Module 51.
 */
function opsOnly(scope: DeskScope) {
  if (scope.kind !== 'PLATFORM' || !can(scope, 'workload.view')) throw new DeskAccessError(403, 'Your position does not include the workload across the Desk.');
}

/** The most tasks one change can cover. */
export const WORKLOAD_BULK_MAX = 50;

export interface Counts { open: number; unassigned: number; overdue: number; waiting: number; escalated: number }

const zero = (): Counts => ({ open: 0, unassigned: 0, overdue: 0, waiting: 0, escalated: 0 });
const nameOf = (p: { firstName: string | null; lastName: string | null; email: string }) =>
  [p.firstName, p.lastName].filter(Boolean).join(' ') || p.email;

type OpenTask = {
  podId: string | null; assigneeId: string | null; agencyId: string;
  dueAt: Date | null; slaPausedAt: Date | null; escalated: boolean; status: TaskStatus;
};

function add(counts: Counts, t: OpenTask, now: Date) {
  counts.open += 1;
  if (!t.assigneeId) counts.unassigned += 1;
  // Waiting work's clock is stopped, so it can't be overdue (as in the queue).
  if (t.slaPausedAt) counts.waiting += 1;
  else if (t.dueAt && t.dueAt < now) counts.overdue += 1;
  if (t.escalated) counts.escalated += 1;
}

/** Counts of open work by pod, person and agency, and one page of the tasks the filters choose. */
export async function getWorkload(db: Db, scope: DeskScope, opts: TaskListOptions = {}) {
  opsOnly(scope);
  const now = new Date();
  const open = await db.task.findMany({
    // Through the access layer: restricted requests only for those who may restrict.
    where: { AND: [{ status: { notIn: [...CLOSED_STATUSES] } }, taskWhere(scope, { counts: true })] },
    select: { podId: true, assigneeId: true, agencyId: true, dueAt: true, slaPausedAt: true, escalated: true, status: true },
  });

  const total = zero();
  const byPod = new Map<string | null, Counts>();
  const byPerson = new Map<string, Counts>();
  const byAgency = new Map<string, Counts>();
  const bucket = <K>(map: Map<K, Counts>, key: K) => map.get(key) ?? map.set(key, zero()).get(key)!;
  for (const t of open) {
    add(total, t, now);
    add(bucket(byPod, t.podId ?? null), t, now);
    add(bucket(byAgency, t.agencyId), t, now);
    if (t.assigneeId) add(bucket(byPerson, t.assigneeId), t, now);
  }

  const [pods, staff, agencies, list, alertRun] = await Promise.all([
    db.pod.findMany({ orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }], select: { id: true, name: true, isActive: true } }),
    // Everyone who works tasks, idle or not, and anyone else still holding open work.
    db.user.findMany({
      where: { OR: [{ role: { in: ['DESK_VA', 'ACCOUNT_MANAGER'] }, isActive: true }, { id: { in: [...byPerson.keys()] } }] },
      select: { id: true, firstName: true, lastName: true, email: true, role: true, isActive: true, podMemberships: { select: { podId: true } } },
    }),
    db.agency.findMany({ where: { id: { in: [...byAgency.keys()] } }, select: { id: true, name: true, deskEnabled: true } }),
    listTasks(db, scope, opts),
    lastAlertRun(db),
  ]);
  const podName = new Map(pods.map((p) => [p.id, p.name]));

  return {
    total,
    // Switched-off pods appear only while they still hold open work.
    pods: [
      ...pods.filter((p) => p.isActive || byPod.has(p.id)).map((p) => ({ id: p.id, name: p.name, isActive: p.isActive, ...(byPod.get(p.id) ?? zero()) })),
      ...(byPod.has(null) ? [{ id: 'none', name: 'No pod yet', isActive: true, ...byPod.get(null)! }] : []),
    ],
    people: staff
      .map((u) => ({
        id: u.id, name: nameOf(u), kind: u.role === 'DESK_VA' ? 'VA' as const : u.role === 'ACCOUNT_MANAGER' ? 'ACCOUNT_MANAGER' as const : 'OTHER' as const,
        isActive: u.isActive,
        pods: u.podMemberships.map((m) => podName.get(m.podId)).filter((n): n is string => !!n),
        ...(byPerson.get(u.id) ?? zero()),
      }))
      // The busiest first, so the people who need help stand out.
      .sort((a, b) => b.open - a.open || b.overdue - a.overdue || a.name.localeCompare(b.name)),
    agencies: agencies
      .map((a) => ({ id: a.id, name: a.name, deskEnabled: a.deskEnabled, ...byAgency.get(a.id)! }))
      .sort((a, b) => b.open - a.open || a.name.localeCompare(b.name)),
    list,
    /** The overdue-alert check (Module 41): when it last ran, and whether a schedule is set up. */
    alertCheck: { lastRun: alertRun, scheduled: !!(checkIntervalMinutes() || cronSecret()) },
  };
}

export interface BulkResult {
  done: { id: string; reference: number }[];
  failed: { id: string; reference: number | null; message: string }[];
}

/**
 * Body: { taskIds, assigneeId } (null to return them to the queue) or { taskIds, podId }.
 * Each task is changed on its own, so one that can't be changed doesn't stop the rest;
 * the answer says which were and why the others weren't.
 */
export async function changeWorkload(db: Db, scope: DeskScope, body: Record<string, unknown>, ctx: GuardContext = {}): Promise<BulkResult> {
  opsOnly(scope);
  const ids = body.taskIds;
  if (!Array.isArray(ids) || !ids.length || ids.some((id) => typeof id !== 'string')) throw new DeskAccessError(400, 'Choose the tasks to change.');
  const unique = [...new Set(ids as string[])];
  if (unique.length > WORKLOAD_BULK_MAX) throw new DeskAccessError(400, `Change at most ${WORKLOAD_BULK_MAX} tasks at a time.`);
  const byPerson = 'assigneeId' in body;
  if (byPerson === 'podId' in body) throw new DeskAccessError(400, 'Choose a person or a pod.');

  const refs = new Map((await db.task.findMany({ where: { AND: [{ id: { in: unique.filter(isObjectId) } }, taskWhere(scope)] }, select: { id: true, reference: true } }))
    .map((t) => [t.id, t.reference]));
  const result: BulkResult = { done: [], failed: [] };
  for (const id of unique) {
    try {
      const view = byPerson
        ? await setTaskAssignee(db, scope, id, { assigneeId: body.assigneeId }, ctx)
        : await setTaskPod(db, scope, id, { podId: body.podId }, ctx);
      result.done.push({ id, reference: view.reference as number });
    } catch (err) {
      if (!(err instanceof DeskAccessError)) throw err;
      result.failed.push({ id, reference: refs.get(id) ?? null, message: err.message });
    }
  }
  return result;
}

export type WorkloadPage = Awaited<ReturnType<typeof getWorkload>>;
