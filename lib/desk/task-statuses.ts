/**
 * Task statuses: their labels, the simplified ones agencies see, and which
 * changes are allowed. Pure — safe for server and browser, so a screen offers
 * exactly the moves the task service (lib/desk/tasks.ts) will accept.
 */
import type { TaskStatus } from '@prisma/client';

export const STATUS_LABELS: Record<TaskStatus, string> = {
  NEW: 'New',
  ASSIGNED: 'Assigned',
  IN_PROGRESS: 'In progress',
  WAITING_ON_AGENCY: 'Waiting on agency',
  WAITING_ON_CARRIER: 'Waiting on carrier',
  WAITING_ON_INSURED: 'Waiting on insured',
  QA_REVIEW: 'QA review',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
};

/** The simplified statuses agencies see (build plan 5.4). */
export type AgencyStatus = 'RECEIVED' | 'IN_PROGRESS' | 'NEEDS_ATTENTION' | 'COMPLETED' | 'CANCELLED';

export const AGENCY_STATUS_LABELS: Record<AgencyStatus, string> = {
  RECEIVED: 'Received',
  IN_PROGRESS: 'In progress',
  NEEDS_ATTENTION: 'Needs your attention',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
};

export function agencyStatus(status: TaskStatus): AgencyStatus {
  switch (status) {
    case 'NEW': case 'ASSIGNED': return 'RECEIVED';
    case 'WAITING_ON_AGENCY': return 'NEEDS_ATTENTION';
    case 'COMPLETED': return 'COMPLETED';
    case 'CANCELLED': return 'CANCELLED';
    default: return 'IN_PROGRESS';
  }
}

export const WAITING_STATUSES: readonly TaskStatus[] = ['WAITING_ON_AGENCY', 'WAITING_ON_CARRIER', 'WAITING_ON_INSURED'];
export const CLOSED: readonly TaskStatus[] = ['COMPLETED', 'CANCELLED'];

/**
 * Allowed status changes. Assigning and unassigning (NEW ⇄ ASSIGNED) go
 * through assignTask, not here. Reopening a completed or cancelled task is
 * for Account Managers and Operations Managers only.
 */
export const TRANSITIONS: Record<TaskStatus, readonly TaskStatus[]> = {
  NEW: ['WAITING_ON_AGENCY', 'CANCELLED'],
  ASSIGNED: ['IN_PROGRESS', 'WAITING_ON_AGENCY', 'WAITING_ON_CARRIER', 'WAITING_ON_INSURED', 'CANCELLED'],
  IN_PROGRESS: ['WAITING_ON_AGENCY', 'WAITING_ON_CARRIER', 'WAITING_ON_INSURED', 'QA_REVIEW', 'COMPLETED', 'CANCELLED'],
  WAITING_ON_AGENCY: ['IN_PROGRESS', 'WAITING_ON_CARRIER', 'WAITING_ON_INSURED', 'CANCELLED'],
  WAITING_ON_CARRIER: ['IN_PROGRESS', 'WAITING_ON_AGENCY', 'WAITING_ON_INSURED', 'CANCELLED'],
  WAITING_ON_INSURED: ['IN_PROGRESS', 'WAITING_ON_AGENCY', 'WAITING_ON_CARRIER', 'CANCELLED'],
  QA_REVIEW: ['IN_PROGRESS', 'COMPLETED', 'CANCELLED'],
  COMPLETED: ['IN_PROGRESS'],
  CANCELLED: ['NEW'],
};

export function canTransition(from: TaskStatus, to: TaskStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

/** Statuses that need a reason: what is being waited for, or why it was cancelled. Reopening needs one too. */
export const NEEDS_REASON: readonly TaskStatus[] = [...WAITING_STATUSES, 'CANCELLED'];

export const needsReason = (from: TaskStatus, to: TaskStatus) => NEEDS_REASON.includes(to) || CLOSED.includes(from);

/** What the button for each move says, from the worker's side. */
export const MOVE_LABELS: Record<TaskStatus, string> = {
  NEW: 'Reopen',
  ASSIGNED: 'Assigned',
  IN_PROGRESS: 'Start work',
  WAITING_ON_AGENCY: 'Wait on agency',
  WAITING_ON_CARRIER: 'Wait on carrier',
  WAITING_ON_INSURED: 'Wait on insured',
  QA_REVIEW: 'Send to QA review',
  COMPLETED: 'Complete',
  CANCELLED: 'Cancel request',
};

/** A button's words: moving a closed request back into work is reopening it. */
export const moveLabel = (from: TaskStatus, to: TaskStatus) => (CLOSED.includes(from) ? 'Reopen' : MOVE_LABELS[to]);

/** How each reason box is labelled: the agency sees the reason when it is addressed to them. */
export function reasonPrompt(from: TaskStatus, to: TaskStatus): string {
  if (to === 'WAITING_ON_AGENCY') return 'What do you need from the agency? They will see this.';
  if (to === 'CANCELLED') return 'Why is it being cancelled? The agency will see this.';
  if (to === 'WAITING_ON_CARRIER') return 'What are you waiting for from the carrier? (Desk team only)';
  if (to === 'WAITING_ON_INSURED') return 'What are you waiting for from the insured? (Desk team only)';
  if (CLOSED.includes(from)) return 'Why is it being reopened? (Desk team only)';
  return 'Reason';
}

/**
 * The status moves to offer someone on a task. Only managers reopen; a VA
 * changes status only on work they hold (the service checks both again).
 */
export function statusMoves(status: TaskStatus, opts: { manager: boolean; holdsIt: boolean; assigned: boolean }): TaskStatus[] {
  if (!opts.manager && !opts.holdsIt) return [];
  if (!opts.manager && CLOSED.includes(status)) return [];
  // Work can only be in progress with someone on it: until then, it's assigning, not a status change.
  return TRANSITIONS[status].filter((to) => to !== 'IN_PROGRESS' || opts.assigned);
}
