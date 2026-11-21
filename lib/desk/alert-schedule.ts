/**
 * How the alert check (lib/desk/alerts.ts) is started (Module 41). Either or both:
 *
 *  - DESK_ALERT_CHECK_MINUTES=15 — the app runs the check itself, every so many
 *    minutes, while it is running (instrumentation.ts). Suits a server that
 *    stays up.
 *  - DESK_CRON_SECRET=<long random text> — a scheduler (the host's cron, a
 *    scheduled job, an uptime pinger) calls GET or POST /api/desk/cron/alerts
 *    with the header "Authorization: Bearer <that text>". Suits hosts that
 *    sleep or run several copies.
 *
 * Running both, or several copies, is safe: no alert is sent twice.
 * Neither is set by default, so a development copy never sends alerts.
 */
import { timingSafeEqual } from 'crypto';

export const CHECK_MINUTES_MIN = 5;
export const CHECK_MINUTES_MAX = 24 * 60;
/** A secret shorter than this is treated as not set: too easy to guess. */
export const CRON_SECRET_MIN = 24;

/** The interval in minutes, or null when the app shouldn't run the check itself. */
export function checkIntervalMinutes(value = process.env.DESK_ALERT_CHECK_MINUTES): number | null {
  const n = Number(value?.trim());
  return value?.trim() && Number.isInteger(n) && n >= CHECK_MINUTES_MIN && n <= CHECK_MINUTES_MAX ? n : null;
}

export const cronSecret = (value = process.env.DESK_CRON_SECRET): string | null =>
  value && value.trim().length >= CRON_SECRET_MIN ? value.trim() : null;

/** Does the request carry the scheduler's secret? Compared in constant time. */
export function isSchedulerRequest(authorization: string | null, secret: string | null = cronSecret()): boolean {
  if (!secret || !authorization?.startsWith('Bearer ')) return false;
  const given = Buffer.from(authorization.slice('Bearer '.length).trim());
  const wanted = Buffer.from(secret);
  return given.length === wanted.length && timingSafeEqual(given, wanted);
}
