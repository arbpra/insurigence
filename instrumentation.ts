/**
 * Runs once when the server starts (Next.js). Starts the Desk's alert check
 * on a timer when DESK_ALERT_CHECK_MINUTES is set (lib/desk/alert-schedule.ts).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { checkIntervalMinutes } = await import('./lib/desk/alert-schedule');
  const minutes = checkIntervalMinutes();
  if (!minutes) return;
  const [{ default: prisma }, { runAlertCheck }] = await Promise.all([import('./lib/prisma'), import('./lib/desk/alerts')]);
  let running = false;
  const tick = async () => {
    if (running) return; // the last one is still going
    running = true;
    try {
      const r = await runAlertCheck(prisma);
      if (r.dueSoon || r.overdue || r.escalated || r.failed) console.log('[desk/alerts]', JSON.stringify(r));
    } catch (err) {
      console.error('[desk/alerts] scheduled check failed', err);
    } finally {
      running = false;
    }
  };
  console.log(`[desk/alerts] checking every ${minutes} minutes`);
  setTimeout(tick, 60_000).unref?.();
  setInterval(tick, minutes * 60_000).unref?.();
}
