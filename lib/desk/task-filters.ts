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

/** Not yet classified for billing (included / overage / non-billable). */
export const BILLING_UNCLASSIFIED: Prisma.TaskWhereInput = {
  OR: [{ billingClass: null }, { billingClass: { isSet: false } }],
};

/**
 * Not restricted to named staff.
 *
 * Relies on an invariant: every task stores restrictedToUserIds (Prisma writes
 * [] on create). No Prisma filter can match a task stored WITHOUT the list —
 * `isEmpty`, `equals: []` and even NOT(...) all skip missing fields, and lists
 * have no `isSet`. backfillTaskLists() (lib/desk/integrity.ts) restores the
 * invariant if a raw write ever breaks it; it runs with `npm run db:seed:desk`.
 */
export const UNRESTRICTED: Prisma.TaskWhereInput = {
  restrictedToUserIds: { isEmpty: true },
};

/**
 * Passes the named-staff restriction for one Desk user: unrestricted, or the
 * user is named. (Operations Managers and the agency's AMs bypass the
 * restriction entirely — the access layer skips this filter for them.)
 */
export function passesRestriction(userId: string): Prisma.TaskWhereInput {
  return { OR: [UNRESTRICTED, { restrictedToUserIds: { has: userId } }] };
}

/** Statuses that mean the work is finished, one way or the other. */
export const CLOSED_STATUSES = ['COMPLETED', 'CANCELLED'] as const;
