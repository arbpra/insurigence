/**
 * Service-level target selection. Pure — safe for server and browser.
 * The business-time arithmetic (hours, days, holidays, pauses) is in
 * lib/desk/business-time.ts.
 */
import type { SlaTargetKind, TaskComplexity, TaskPriority, TaskType } from '@prisma/client';

export interface TargetLike {
  id: string;
  taskType: TaskType;
  complexity: TaskComplexity | null;
  priority: TaskPriority | null;
  agencyId: string | null;
  kind: SlaTargetKind;
  businessHours: number | null;
  businessDays: number | null;
  opensDaysBeforeExpiration: number | null;
  dueDaysBeforeExpiration: number | null;
  isActive: boolean;
}

/**
 * The most specific active target for a task, or null when none applies.
 * A target matches when each of its complexity / priority / agency is either
 * empty (applies to all) or equal to the task's. Specificity, highest first:
 * the agency's own agreement (4) > priority (2) > complexity (1). So any
 * agency-specific target beats every Desk default, and an "Urgent COI" target
 * applies to every urgent COI even though standard and complex COIs have
 * their own targets; a target naming both priority and complexity beats either.
 */
export function pickServiceLevelTarget<T extends TargetLike>(
  targets: T[],
  task: { type: TaskType; complexity: TaskComplexity; priority: TaskPriority; agencyId: string }
): T | null {
  let best: T | null = null;
  let bestScore = -1;
  for (const t of targets) {
    if (!t.isActive || t.taskType !== task.type) continue;
    if (t.complexity !== null && t.complexity !== task.complexity) continue;
    if (t.priority !== null && t.priority !== task.priority) continue;
    if (t.agencyId !== null && t.agencyId !== task.agencyId) continue;
    const score = (t.agencyId !== null ? 4 : 0) + (t.priority !== null ? 2 : 0) + (t.complexity !== null ? 1 : 0);
    if (score > bestScore) { best = t; bestScore = score; }
  }
  return best;
}

/** The copy of a target stored on the task at creation (Task.slaTarget). */
export function targetSnapshot(t: TargetLike) {
  return {
    targetId: t.id,
    kind: t.kind,
    businessHours: t.businessHours,
    businessDays: t.businessDays,
    opensDaysBeforeExpiration: t.opensDaysBeforeExpiration,
    dueDaysBeforeExpiration: t.dueDaysBeforeExpiration,
  };
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** Plain-English target, e.g. "4 business hours" or "due 90 days before expiration (opens at 120)". */
export function describeTarget(t: Pick<TargetLike, 'kind' | 'businessHours' | 'businessDays' | 'opensDaysBeforeExpiration' | 'dueDaysBeforeExpiration'>): string {
  if (t.kind === 'BEFORE_EXPIRATION') {
    const due = `due ${plural(t.dueDaysBeforeExpiration ?? 0, 'day')} before expiration`;
    return t.opensDaysBeforeExpiration ? `${due} (opens at ${t.opensDaysBeforeExpiration})` : due;
  }
  if (t.businessHours) return plural(t.businessHours, 'business hour');
  if (t.businessDays) return plural(t.businessDays, 'business day');
  return 'no target';
}

/**
 * Checks a target before it is saved (used by the editor in Module 18):
 * business-time targets need exactly one positive duration; expiration targets
 * need a due day, and an opening day no later than it.
 */
export function validateTarget(t: Pick<TargetLike, 'kind' | 'businessHours' | 'businessDays' | 'opensDaysBeforeExpiration' | 'dueDaysBeforeExpiration'>): string | null {
  const pos = (n: number | null) => n !== null && Number.isInteger(n) && n > 0;
  if (t.kind === 'BUSINESS_TIME') {
    if ((t.businessHours !== null) === (t.businessDays !== null)) return 'Set either business hours or business days, not both.';
    if (!pos(t.businessHours ?? t.businessDays)) return 'The duration must be a whole number above zero.';
    return null;
  }
  if (!pos(t.dueDaysBeforeExpiration)) return 'Set how many days before expiration the work is due.';
  if (t.opensDaysBeforeExpiration !== null && (!pos(t.opensDaysBeforeExpiration) || t.opensDaysBeforeExpiration < t.dueDaysBeforeExpiration!)) {
    return 'Work must open on or before its due date (opening days ≥ due days).';
  }
  return null;
}
