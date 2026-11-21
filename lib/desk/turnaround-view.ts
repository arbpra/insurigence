/**
 * Display helpers for the Turnaround page (Module 42). No database access, so
 * the page can use them in the browser.
 */

/**
 * Business minutes as people read them: "45 min", "3 h 20 min", or in working
 * days once a request took a day or more ("2 d 3 h": a day is one working
 * day of the Desk calendar, not 24 hours).
 */
export function formatBusinessMinutes(minutes: number | null, workdayMinutes: number): string {
  if (minutes === null) return '–';
  const m = Math.max(0, Math.round(minutes));
  if (m < 60) return `${m} min`;
  const day = workdayMinutes > 0 ? workdayMinutes : 480;
  if (m >= day) {
    const d = Math.floor(m / day);
    const h = Math.round((m - d * day) / 60);
    return h ? `${d} d ${h} h` : `${d} d`;
  }
  const h = Math.floor(m / 60);
  const rest = m - h * 60;
  return rest ? `${h} h ${rest} min` : `${h} h`;
}

/** "92% (46 of 50)", or a dash when none of the requests had a target. */
export function onTargetLabel(met: number, withTarget: number): string {
  if (!withTarget) return '–';
  return `${Math.round((met / withTarget) * 100)}% (${met} of ${withTarget})`;
}

/** The share met, for colouring: null with no targets. */
export function onTargetShare(met: number, withTarget: number): number | null {
  return withTarget ? met / withTarget : null;
}

/** Below this share met, the figure is shown as a concern; below the lower one, as a problem. */
export const ON_TARGET_GOOD = 0.9;
export const ON_TARGET_POOR = 0.75;
