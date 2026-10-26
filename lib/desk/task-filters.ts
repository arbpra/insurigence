import type { Prisma } from '@prisma/client';

/*
 * Prisma leaves an omitted optional field unset in MongoDB, and `field: null`
 * alone does not match unset. Queue queries for "no pod" / "no assignee" must
 * use these filters, never a bare null (same issue as WHOLE_POD_ACCESS).
 * Combine with other OR filters through AND: { AND: [UNROUTED, {...}] }.
 */

/** Not routed to any pod yet — waiting for AM triage. */
export const UNROUTED: Prisma.TaskWhereInput = {
  OR: [{ podId: null }, { podId: { isSet: false } }],
};

/** In a queue but nobody has picked it up. */
export const UNASSIGNED: Prisma.TaskWhereInput = {
  OR: [{ assigneeId: null }, { assigneeId: { isSet: false } }],
};

/** Top-level tasks only (not subtasks). */
export const TOP_LEVEL: Prisma.TaskWhereInput = {
  OR: [{ parentTaskId: null }, { parentTaskId: { isSet: false } }],
};

/** Statuses that mean the work is finished, one way or the other. */
export const CLOSED_STATUSES = ['COMPLETED', 'CANCELLED'] as const;
