/**
 * The manager overview's limits and wording. Pure — safe for server and browser.
 */

/** "Due soon" means due within this many hours (as on the Pod queue). */
export const DUE_SOON_HOURS = 4;
export const RENEWAL_WINDOWS = [30, 60, 90] as const;
export type RenewalWindow = (typeof RENEWAL_WINDOWS)[number];

/** How many rows each list shows; every list also gets its true total. */
export const REVIEW_LIMIT = 25;
export const OVERDUE_LIMIT = 10;
export const RENEWAL_LIMIT = 50;
export const AGENCY_LIMIT = 100;

export type ReviewReason = 'ESCALATED' | 'QA' | 'UNROUTED';
export const REVIEW_REASON_LABELS: Record<ReviewReason, string> = {
  ESCALATED: 'Escalated',
  QA: 'QA review',
  UNROUTED: 'Not routed to a pod',
};

export const isRenewalWindow = (v: unknown): v is RenewalWindow => (RENEWAL_WINDOWS as readonly unknown[]).includes(v);

/** The renewal window from the address; anything else falls back to 60 days. */
export function parseRenewalWindow(value: string | string[] | undefined): RenewalWindow {
  const n = Number(Array.isArray(value) ? value[0] : value);
  return isRenewalWindow(n) ? n : 60;
}

/** "Expires today", "in 1 day", "in 12 days". */
export function daysLeftLabel(days: number): string {
  if (days <= 0) return 'Expires today';
  return days === 1 ? 'Expires tomorrow' : `Expires in ${days} days`;
}

/** How late something is, roughly: "45 min", "3 h", "2 days". */
export function lateBy(dueAt: string | Date, now: Date): string {
  const minutes = Math.max(0, Math.floor((now.getTime() - new Date(dueAt).getTime()) / 60_000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} h`;
  return `${Math.floor(hours / 24)} days`;
}
