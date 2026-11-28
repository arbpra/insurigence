/**
 * Display helpers for the department dashboards (Module 52). No database
 * access, so the page can use them in the browser.
 */

/** "92% passed (23 of 25)", or "–" with no QA decisions. */
export function qaLabel(q: { passed: number; sentBack: number }): string {
  const n = q.passed + q.sentBack;
  if (!n) return '–';
  return `${Math.round((q.passed / n) * 100)}% passed (${q.passed} of ${n})`;
}

/** The share passed, for colouring: null with no QA decisions. */
export function qaShare(q: { passed: number; sentBack: number }): number | null {
  const n = q.passed + q.sentBack;
  return n ? q.passed / n : null;
}

/** "2.5 open each · 1 with none", or "Nobody in it". */
export function capacityLabel(c: { people: number; idle: number; openPerPerson: number | null } | null): string {
  if (!c) return '–';
  if (!c.people) return 'Nobody in it';
  const each = `${c.openPerPerson ?? 0} open each`;
  return c.idle ? `${each} · ${c.idle} with none` : each;
}
