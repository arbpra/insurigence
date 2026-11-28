/**
 * The internal task workspace: how each history entry reads, and what a
 * reclassification sends. Pure — safe for server and browser.
 */
import type { ServiceClass } from '@prisma/client';
import { SERVICE_CLASS_LABELS, classLabel } from './classification-view';
import type { TaskComplexity, TaskEventKind, TaskPriority, TaskStatus } from '@prisma/client';
import { COMPLEXITY_LABELS, PRIORITY_LABELS } from './service-levels';
import { STATUS_LABELS } from './task-statuses';

export const NOTE_MAX = 5_000;
export const REVIEW_REASON_MAX = 500;
export const MAX_UNITS = 50;
/** A subtask's title, as for any request (lib/desk/tasks.ts). */
export const SUBTASK_TITLE_MAX = 200;

export interface StaffEvent {
  id: string;
  kind: TaskEventKind;
  visibility: 'INTERNAL' | 'AGENCY';
  actorName: string | null;
  body: string | null;
  fromStatus: TaskStatus | null;
  toStatus: TaskStatus | null;
  assignedFrom?: string | null;
  assignedTo?: string | null;
  details: Record<string, unknown>;
  createdAt: string;
}

const yesNo = (v: unknown) => (v ? 'yes' : 'no');

/** One line per field a reclassification changed, e.g. "Complexity: Standard → Complex". */
export function reclassifiedLines(details: Record<string, unknown>): string[] {
  const from = (details.from ?? {}) as Record<string, unknown>;
  const to = (details.to ?? {}) as Record<string, unknown>;
  const lines: string[] = [];
  if ('complexity' in to) lines.push(`Complexity: ${COMPLEXITY_LABELS[from.complexity as TaskComplexity] ?? from.complexity} → ${COMPLEXITY_LABELS[to.complexity as TaskComplexity] ?? to.complexity}`);
  if ('priority' in to) lines.push(`Priority: ${PRIORITY_LABELS[from.priority as TaskPriority] ?? from.priority} → ${PRIORITY_LABELS[to.priority as TaskPriority] ?? to.priority}`);
  if ('billableUnits' in to) lines.push(`Billable units: ${from.billableUnits} → ${to.billableUnits}`);
  if ('nonBillable' in to) lines.push(`Non-billable: ${yesNo(from.nonBillable)} → ${yesNo(to.nonBillable)}`);
  if ('serviceClass' in to) {
    const label = (c: unknown) => (c ? SERVICE_CLASS_LABELS[c as ServiceClass] ?? String(c) : `the account's (${classLabel(details.accountClass as ServiceClass | null)})`);
    lines.push(`Classification: ${label(from.serviceClass)} → ${label(to.serviceClass)}`);
  }
  if ('dueAtTo' in details) lines.push(details.dueAtTo ? 'Due date recalculated for the new target' : 'No service-level target applies any more');
  return lines;
}

/** Managers only: who is named, why, and what followed. */
export function restrictedLines(details: Record<string, unknown>): string[] {
  const lines: string[] = [];
  if (Array.isArray(details.names) && details.names.length) lines.push(`Only: ${details.names.join(', ')}, with the Account Managers and Operations Managers`);
  if (typeof details.reason === 'string') lines.push(`Reason: ${details.reason}`);
  if (typeof details.subtasks === 'number' && details.subtasks > 0 && typeof details.onRequest !== 'number') lines.push(`Applied to ${details.subtasks} ${details.subtasks === 1 ? 'subtask' : 'subtasks'} too`);
  if (typeof details.released === 'number' && details.released > 0) lines.push(`${details.released} ${details.released === 1 ? 'piece of work' : 'pieces of work'} went back to the queue: the person holding it isn't named`);
  return lines;
}

/** The lines under a history entry's headline, from its details (managers see them all; VAs only a few). */
export function eventLines(e: StaffEvent): string[] {
  if (e.kind === 'RECLASSIFIED') return reclassifiedLines(e.details);
  if (e.kind === 'CLASS_FLAGGED' && typeof e.details.suggested === 'string') {
    return [`${e.details.target === 'ACCOUNT' ? 'The account' : 'This request'}: suggested ${SERVICE_CLASS_LABELS[e.details.suggested as ServiceClass] ?? e.details.suggested}`];
  }
  if ((e.kind === 'ESCALATED' || e.kind === 'DEESCALATED') && typeof e.details.reason === 'string') return [`Reason: ${e.details.reason}`];
  if (e.kind === 'ALERTED' && typeof e.details.sentTo === 'number') {
    const n = e.details.sentTo;
    return [n === 0 ? 'Nobody could be emailed' : `Emailed ${n} ${n === 1 ? 'person' : 'people'}`];
  }
  if (e.kind === 'RESTRICTED') return restrictedLines(e.details);
  if (e.kind === 'ROUTED' && typeof e.details.toName === 'string') return [`From ${typeof e.details.fromName === 'string' ? e.details.fromName : 'no pod'}`];
  return [];
}

/** The headline of a history entry. The body (a note, a reason, a file name) is shown under it. */
export function eventTitle(e: StaffEvent): string {
  switch (e.kind) {
    case 'CREATED': return e.details.automatic === 'follow_up' ? 'Created by a follow-up rule' : 'Request filed';
    case 'STATUS_CHANGED':
      return e.fromStatus && e.toStatus ? `${STATUS_LABELS[e.fromStatus]} → ${STATUS_LABELS[e.toStatus]}` : 'Status changed';
    case 'ASSIGNED':
      return e.assignedFrom ? `Reassigned from ${e.assignedFrom} to ${e.assignedTo ?? 'someone'}` : `Assigned to ${e.assignedTo ?? 'someone'}`;
    case 'UNASSIGNED':
      // Automatic: the holder lost access (moved pod, a restriction, an agency's authorisation); they didn't release it.
      if (e.details.automatic && e.assignedFrom) return `Back to the queue: ${e.assignedFrom} no longer has access`;
      return e.assignedFrom ? `Released by ${e.assignedFrom}, back to the queue` : 'Back to the queue';
    case 'ROUTED':
      if (typeof e.details.toName === 'string') return `Moved to ${e.details.toName}`;
      return e.details.automatic ? 'Routed to a pod' : 'Moved to another pod';
    case 'PRIORITY_CHANGED': return 'Priority changed';
    case 'DUE_DATE_CHANGED': return 'Due date changed';
    case 'NOTE': return e.visibility === 'AGENCY' ? 'Note shared with the agency' : 'Internal note';
    case 'DOCUMENT_ADDED': return e.visibility === 'AGENCY' ? 'Document added, shared with the agency' : 'Document added, internal';
    case 'DOCUMENT_REMOVED': return 'Document removed';
    case 'ESCALATED': return e.details.automatic === 'overdue' ? 'Escalated automatically: overdue' : 'Escalated';
    case 'ALERTED':
      return e.details.automatic === 'due_soon' ? 'Due-soon alert sent'
        : e.details.automatic === 'overdue' ? 'Overdue alert sent'
          : e.details.automatic === 'escalated' ? 'Escalation alert sent to the Operations Managers' : 'Alert sent';
    case 'DEESCALATED': return 'Escalation cleared';
    case 'SUBTASK_CREATED': {
      const what = e.details.followUp === true ? 'Follow-up' : 'Subtask';
      const verb = e.details.followUp === true ? 'created' : 'added';
      return typeof e.details.reference === 'number' ? `${what} #${e.details.reference} ${verb}` : `${what} ${verb}`;
    }
    case 'RECLASSIFIED': return 'Reclassified';
    case 'CLASS_FLAGGED': return 'Flagged for reclassification';
    case 'CLASS_FLAG_CLOSED': return e.details.outcome === 'DISMISSED' ? 'Reclassification flag dismissed' : 'Reclassification flag settled: classification changed';
    case 'RESTRICTED': {
      // VAs get no details: they learn access changed, not who is named or why.
      if (!Array.isArray(e.details.to)) return 'Access restriction changed';
      const where = typeof e.details.onRequest === 'number' ? ` (set on request #${e.details.onRequest})` : '';
      if (!e.details.to.length) return `Restriction lifted${where}`;
      return `${Array.isArray(e.details.from) && e.details.from.length ? 'Restriction changed' : 'Restricted to named people'}${where}`;
    }
    default: return 'Updated';
  }
}

export interface ReviewState {
  complexity: TaskComplexity;
  priority: TaskPriority;
  billableUnits: string;
  nonBillable: boolean;
  reason: string;
}

/**
 * What the review form sends: only the fields that differ from the task, and
 * the reason. Null with a message when there is nothing to send yet.
 */
export function reviewBody(
  task: { complexity: TaskComplexity; priority: TaskPriority; billing?: { units: number; nonBillable: boolean } | null },
  form: ReviewState,
): { body: Record<string, unknown> } | { problem: string } {
  const body: Record<string, unknown> = {};
  if (form.complexity !== task.complexity) body.complexity = form.complexity;
  if (form.priority !== task.priority) body.priority = form.priority;
  if (task.billing) {
    const units = Number(form.billableUnits);
    if (!/^\d+$/.test(form.billableUnits.trim()) || units < 1 || units > MAX_UNITS) return { problem: `Billable units must be a whole number from 1 to ${MAX_UNITS}.` };
    if (units !== task.billing.units) body.billableUnits = units;
    if (form.nonBillable !== task.billing.nonBillable) body.nonBillable = form.nonBillable;
  }
  if (!Object.keys(body).length) return { problem: 'Change something first.' };
  const reason = form.reason.trim();
  if (!reason) return { problem: 'Say why, for the history.' };
  if (reason.length > REVIEW_REASON_MAX) return { problem: `Keep the reason to ${REVIEW_REASON_MAX} characters.` };
  return { body: { ...body, reason } };
}
