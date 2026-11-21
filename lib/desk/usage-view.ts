/**
 * Display helpers for the Usage & audit page (Module 43). No database access,
 * so the page can use them in the browser.
 */

/** "November 2026" from "2026-11". */
export function monthLabel(period: string): string {
  const [y, m] = period.split('-').map(Number);
  if (!y || !m) return period;
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

/**
 * One category's month for the table: what was used against the allowance,
 * and a note for overage, what is left, or no allowance set up.
 */
export function allowanceCell(c: { allowance: number | 'unlimited' | null; included: number; overage: number; pending: number; remaining: number | null }): { used: string; note: string | null } {
  const notes: string[] = [];
  let used: string;
  if (c.allowance === null) {
    used = String(c.included + c.overage);
    notes.push('no allowance set up');
  } else if (c.allowance === 'unlimited') {
    used = `${c.included} (unlimited)`;
  } else {
    used = `${c.included} of ${c.allowance}`;
    if (!c.overage) notes.push(`${c.remaining ?? 0} left`);
  }
  if (c.overage) notes.unshift(`+${c.overage} over`);
  if (c.pending) notes.push(`${c.pending} not yet classified`);
  return { used, note: notes.length ? notes.join(' · ') : null };
}

/** "task.viewed" → "Task viewed"; "follow_up_rule.changed" → "Follow up rule changed". */
export function describeAction(action: string): string {
  const s = action.replace(/[._]/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export interface AuditQuery {
  action: string; agencyId: string; actor: string; entityType: string; entityId: string; from: string; to: string; page: number;
}

/** The audit API's query string for the filters chosen (empty ones left out). */
export function auditQuery(q: AuditQuery): string {
  const p = new URLSearchParams();
  for (const k of ['action', 'agencyId', 'actor', 'entityType', 'entityId', 'from', 'to'] as const) if (q[k].trim()) p.set(k, q[k].trim());
  if (q.page > 1) p.set('page', String(q.page));
  return p.toString();
}
