/**
 * Returning tasks to the queue when their assignee can no longer work them
 * (deactivated, moved out of a pod, or the agency's authorization changed).
 * Waiting tasks keep waiting, with the clock still stopped; started work has
 * no owner now, so it starts over as New. Each task's history records it.
 */
import type { Prisma, TaskStatus } from '@prisma/client';

/** Statuses that mean someone is working on it, so they cannot outlast the person. */
const RESTART_STATUSES = ['ASSIGNED', 'IN_PROGRESS', 'QA_REVIEW'] as const satisfies readonly TaskStatus[];

export interface ReleasableTask {
  id: string;
  agencyId: string;
  status: TaskStatus;
  assigneeId: string | null;
}

export async function returnToQueue(
  tx: Prisma.TransactionClient, tasks: ReleasableTask[], actorId: string, reason: string
): Promise<number> {
  if (tasks.length === 0) return 0;
  const restart = new Set<TaskStatus>(RESTART_STATUSES);
  const now = new Date();
  const ids = tasks.map((t) => t.id);
  await tx.task.updateMany({ where: { id: { in: ids }, status: { in: [...RESTART_STATUSES] } }, data: { status: 'NEW', assigneeId: null, lastActivityAt: now } });
  await tx.task.updateMany({ where: { id: { in: ids }, assigneeId: { not: null } }, data: { assigneeId: null, lastActivityAt: now } });
  await tx.taskEvent.createMany({
    data: tasks.map((t) => ({
      taskId: t.id, agencyId: t.agencyId, actorId, kind: 'UNASSIGNED' as const,
      fromStatus: restart.has(t.status) ? t.status : null, toStatus: restart.has(t.status) ? 'NEW' as const : null,
      metadata: { from: t.assigneeId, to: null, automatic: reason },
    })),
  });
  return tasks.length;
}
