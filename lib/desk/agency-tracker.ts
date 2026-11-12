/**
 * The agency's request tracker: how many requests sit at each simplified
 * status, and what the Desk team is waiting on the agency for.
 *
 * Agency users only. Everything is read through taskWhere / taskEventWhere,
 * so a producer sees only their own accounts' requests, and only top-level
 * requests are counted (a subtask is part of its parent's request). No due
 * dates, pods, staff or billing are sent (client answer Q5: targets are
 * internal, not guarantees).
 */
import type { PrismaClient, TaskStatus } from '@prisma/client';
import { DeskAccessError, taskEventWhere, taskWhere, type DeskScope, type GuardContext } from './access';
import { recordAudit } from './audit';
import { TASK_TYPE_LABELS } from './service-levels';
import { agencyStatus, type AgencyStatus } from './task-statuses';
import { TOP_LEVEL } from './task-filters';

type Db = PrismaClient;

/** At most this many requests are listed under "Needs your attention"; the count is always the true total. */
export const ATTENTION_LIMIT = 50;

/** Logged and refused as not found: the tracker is the agency's own page. */
async function agenciesOnly(db: Db, scope: DeskScope, ctx: GuardContext): Promise<void> {
  if (scope.kind === 'AGENCY') return;
  await recordAudit(db, {
    actor: { id: scope.userId, role: scope.role }, action: 'access.denied', entityType: 'Task', entityId: null, agencyId: null,
    metadata: { scope: scope.kind, op: 'tracker' }, ip: ctx.ip, userAgent: ctx.userAgent,
  });
  throw new DeskAccessError(404, 'Not found.');
}

export type TrackerCounts = Record<AgencyStatus, number> & { open: number; total: number };

/**
 * Counts by simplified status, and the requests waiting on the agency, oldest
 * first, each with what the Desk team asked for and since when.
 */
export async function agencyTracker(db: Db, scope: DeskScope, ctx: GuardContext = {}) {
  await agenciesOnly(db, scope, ctx);
  const where = { AND: [taskWhere(scope), TOP_LEVEL] };
  const groups = await db.task.groupBy({ by: ['status'], where, _count: { _all: true } });
  const counts: TrackerCounts = { RECEIVED: 0, IN_PROGRESS: 0, NEEDS_ATTENTION: 0, COMPLETED: 0, CANCELLED: 0, open: 0, total: 0 };
  for (const g of groups) {
    const n = g._count._all;
    counts[agencyStatus(g.status as TaskStatus)] += n;
    counts.total += n;
  }
  counts.open = counts.RECEIVED + counts.IN_PROGRESS + counts.NEEDS_ATTENTION;

  const waiting = await db.task.findMany({
    where: { AND: [where, { status: 'WAITING_ON_AGENCY' }] },
    select: { id: true, reference: true, type: true, title: true, insured: { select: { id: true, name: true } } },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: ATTENTION_LIMIT,
  });
  // What was asked: the latest move to "waiting on agency" the agency can see. Its reason is addressed to them.
  const asks = waiting.length
    ? await db.taskEvent.findMany({
        where: { AND: [taskEventWhere(scope), { taskId: { in: waiting.map((t) => t.id) }, kind: 'STATUS_CHANGED', toStatus: 'WAITING_ON_AGENCY' }] },
        select: { taskId: true, body: true, createdAt: true },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      })
    : [];
  const latest = new Map<string, { body: string | null; createdAt: Date }>();
  for (const a of asks) if (!latest.has(a.taskId)) latest.set(a.taskId, a);

  const attention = waiting
    .map((t) => ({
      id: t.id, reference: t.reference, typeLabel: TASK_TYPE_LABELS[t.type], title: t.title, insured: t.insured,
      asked: latest.get(t.id)?.body ?? null,
      since: latest.get(t.id)?.createdAt ?? null,
    }))
    // Longest waiting first; a request with no recorded ask goes last.
    .sort((a, b) => (a.since?.getTime() ?? Infinity) - (b.since?.getTime() ?? Infinity));

  return { counts, attention };
}
