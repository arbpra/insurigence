/**
 * Business-time arithmetic for service-level targets (client answer Q5).
 * Pure: no database access except loadBusinessCalendar, which takes the
 * client as a parameter. Safe for server and browser.
 *
 * All targets run on the Desk calendar: working days and hours in one time
 * zone, minus holidays. Nights, weekends and holidays never count, and a
 * task's waiting periods (on the agency, carrier or insured) are taken out
 * of elapsed time.
 *
 * Time-zone handling uses Intl only (no library). Business hours never fall
 * inside a daylight-saving jump (1–3 a.m.), and conversions re-check the
 * offset, so DST changes are handled.
 */
import type { PrismaClient } from '@prisma/client';
import { DEFAULT_CALENDAR } from './defaults';

export interface BusinessCalendar {
  /** IANA zone, e.g. "America/New_York". */
  timeZone: string;
  /** ISO weekdays that are working days: 1 = Monday … 7 = Sunday. */
  workDays: number[];
  /** Minutes after local midnight, e.g. 540 = 9:00 and 1020 = 17:00. */
  dayStartMinute: number;
  dayEndMinute: number;
  /** Local dates that are not worked, "YYYY-MM-DD". */
  holidays: string[];
}

const MINUTE = 60_000;
/** How far the engine will search for working time before giving up (10 years). */
const MAX_DAYS = 3660;

// ── Calendar dates ("YYYY-MM-DD") ──

/** The local date and minute-of-day of an instant in a time zone. */
export function localDateTime(at: Date, timeZone: string): { date: string; minute: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return { date: `${get('year')}-${get('month')}-${get('day')}`, minute: Number(get('hour')) * 60 + Number(get('minute')) };
}

function dateToUtcMs(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

/** Adds calendar days to a "YYYY-MM-DD" date. */
export function addCalendarDays(date: string, days: number): string {
  return new Date(dateToUtcMs(date) + days * 86_400_000).toISOString().slice(0, 10);
}

/** ISO weekday of a "YYYY-MM-DD" date: 1 = Monday … 7 = Sunday. */
export function isoWeekday(date: string): number {
  const d = new Date(dateToUtcMs(date)).getUTCDay();
  return d === 0 ? 7 : d;
}

/** Offset of a zone from UTC at an instant, in ms (positive east of Greenwich). */
function zoneOffsetMs(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric', hourCycle: 'h23',
  }).formatToParts(at);
  const n = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  const asUtc = Date.UTC(n('year'), n('month') - 1, n('day'), n('hour'), n('minute'), n('second'));
  return asUtc - Math.floor(at.getTime() / 1000) * 1000;
}

/** The instant of a local date and minute-of-day in a zone. */
export function zonedInstant(date: string, minute: number, timeZone: string): Date {
  const wall = dateToUtcMs(date) + minute * MINUTE;
  let guess = wall - zoneOffsetMs(new Date(wall), timeZone);
  // Second pass: the offset at the result can differ across a DST change.
  guess = wall - zoneOffsetMs(new Date(guess), timeZone);
  return new Date(guess);
}

// ── Working days ──

export function isBusinessDay(date: string, cal: BusinessCalendar): boolean {
  return cal.workDays.includes(isoWeekday(date)) && !cal.holidays.includes(date);
}

/** Business minutes in one working day. */
export function workdayMinutes(cal: BusinessCalendar): number {
  return cal.dayEndMinute - cal.dayStartMinute;
}

/** Opening and closing instants of a local date (whether or not it is worked). */
function dayWindow(date: string, cal: BusinessCalendar): { open: number; close: number } {
  return {
    open: zonedInstant(date, cal.dayStartMinute, cal.timeZone).getTime(),
    close: zonedInstant(date, cal.dayEndMinute, cal.timeZone).getTime(),
  };
}

function assertUsable(cal: BusinessCalendar) {
  if (!cal.workDays.length || cal.dayEndMinute <= cal.dayStartMinute) {
    throw new Error('Desk calendar has no working time');
  }
}

// ── Core arithmetic ──

/** Business minutes between two instants (0 if end is not after start). */
export function businessMinutesBetween(start: Date, end: Date, cal: BusinessCalendar): number {
  const from = start.getTime(), to = end.getTime();
  if (to <= from) return 0;
  let date = localDateTime(start, cal.timeZone).date;
  const last = localDateTime(end, cal.timeZone).date;
  let total = 0;
  for (; date <= last; date = addCalendarDays(date, 1)) {
    if (!isBusinessDay(date, cal)) continue;
    const { open, close } = dayWindow(date, cal);
    const overlap = Math.min(close, to) - Math.max(open, from);
    if (overlap > 0) total += overlap;
  }
  return Math.round(total / MINUTE);
}

/**
 * The instant `minutes` business minutes after `start`. Time outside business
 * hours does not count, so work arriving in the evening starts the next
 * working morning. Ending exactly at closing time stays on that day.
 * With 0 minutes, returns the next business moment (start itself if within hours).
 */
export function addBusinessMinutes(start: Date, minutes: number, cal: BusinessCalendar): Date {
  assertUsable(cal);
  if (minutes < 0) throw new Error('minutes must not be negative');
  let remaining = minutes * MINUTE;
  let date = localDateTime(start, cal.timeZone).date;
  for (let i = 0; i < MAX_DAYS; i++, date = addCalendarDays(date, 1)) {
    if (!isBusinessDay(date, cal)) continue;
    const { open, close } = dayWindow(date, cal);
    const from = Math.max(open, start.getTime());
    if (from >= close) continue; // already past today's closing time
    if (remaining <= close - from) return new Date(from + remaining);
    remaining -= close - from;
  }
  throw new Error('No working time found within ten years; check the Desk calendar');
}

/** When the clock actually starts for work arriving at `at`. */
export function nextBusinessMoment(at: Date, cal: BusinessCalendar): Date {
  return addBusinessMinutes(at, 0, cal);
}

export function addBusinessHours(start: Date, hours: number, cal: BusinessCalendar): Date {
  return addBusinessMinutes(start, hours * 60, cal);
}

/**
 * Adds business days as whole working days of time: work received Monday
 * 10:00 with a 1-day target is due Tuesday 10:00; received Friday 16:00, due
 * Monday 16:00; received Saturday, due Monday at closing time.
 */
export function addBusinessDays(start: Date, days: number, cal: BusinessCalendar): Date {
  return addBusinessMinutes(start, days * workdayMinutes(cal), cal);
}

// ── Waiting periods ──

export interface Pause {
  from: Date;
  /** Null while still waiting. */
  to: Date | null;
}

/** Sorted, merged pauses clipped to [start, end]. */
function mergedPauses(pauses: Pause[], start: Date, end: Date): { from: number; to: number }[] {
  const s = start.getTime(), e = end.getTime();
  const spans = pauses
    .map((p) => ({ from: Math.max(p.from.getTime(), s), to: Math.min((p.to ?? end).getTime(), e) }))
    .filter((p) => p.to > p.from)
    .sort((a, b) => a.from - b.from);
  const out: { from: number; to: number }[] = [];
  for (const p of spans) {
    const prev = out[out.length - 1];
    if (prev && p.from <= prev.to) prev.to = Math.max(prev.to, p.to);
    else out.push({ ...p });
  }
  return out;
}

/**
 * Business minutes a task has been actively worked between start and end,
 * excluding its waiting periods. Overlapping or still-open pauses are
 * handled; an open pause runs to `end`.
 */
export function activeBusinessMinutes(start: Date, end: Date, pauses: Pause[], cal: BusinessCalendar): number {
  const total = businessMinutesBetween(start, end, cal);
  const waited = mergedPauses(pauses, start, end)
    .reduce((sum, p) => sum + businessMinutesBetween(new Date(p.from), new Date(p.to), cal), 0);
  return Math.max(0, total - waited);
}

/**
 * The due time after a waiting period ends: the original due time pushed out
 * by the business minutes spent waiting (used when a task resumes, Module 13).
 */
export function extendForPause(dueAt: Date, pause: { from: Date; to: Date }, cal: BusinessCalendar): Date {
  const waited = businessMinutesBetween(pause.from, pause.to, cal);
  return waited > 0 ? addBusinessMinutes(dueAt, waited, cal) : dueAt;
}

// ── Expiration-anchored targets (renewals, remarketing) ──

/**
 * A policy expiration is a date, not a moment: stored as midnight UTC of
 * that date, so its UTC calendar date is the expiration date.
 */
export function expirationDateOf(expiration: Date): string {
  return expiration.toISOString().slice(0, 10);
}

/** The latest business day on or before `date`. */
function businessDayOnOrBefore(date: string, cal: BusinessCalendar): string {
  for (let i = 0; i < MAX_DAYS; i++, date = addCalendarDays(date, -1)) {
    if (isBusinessDay(date, cal)) return date;
  }
  throw new Error('No working day found; check the Desk calendar');
}

/**
 * Renewal-style window, counted in calendar days before expiration: work
 * opens at the start of business `opensDays` before, and is due at closing
 * time `dueDays` before. A due date on a weekend or holiday moves earlier,
 * to the previous working day, never later.
 */
export function expirationWindow(
  expiration: Date,
  opensDays: number | null,
  dueDays: number,
  cal: BusinessCalendar
): { opensAt: Date | null; dueAt: Date } {
  const exp = expirationDateOf(expiration);
  const dueDate = businessDayOnOrBefore(addCalendarDays(exp, -dueDays), cal);
  const dueAt = zonedInstant(dueDate, cal.dayEndMinute, cal.timeZone);
  const opensAt = opensDays !== null ? zonedInstant(addCalendarDays(exp, -opensDays), cal.dayStartMinute, cal.timeZone) : null;
  return { opensAt, dueAt };
}

// ── Applying a target ──

/** The fields of a Task.slaTarget snapshot the engine needs. */
export interface TargetTiming {
  kind: 'BUSINESS_TIME' | 'BEFORE_EXPIRATION';
  businessHours: number | null;
  businessDays: number | null;
  opensDaysBeforeExpiration: number | null;
  dueDaysBeforeExpiration: number | null;
}

/**
 * The due time a target gives a task, or null when it cannot be set:
 * no duration on the target, or an expiration target without a policy
 * expiration date. `startAt` is when the clock starts (the request arriving,
 * or "complete information" received for new-business submissions).
 */
export function computeDueAt(
  target: TargetTiming,
  input: { startAt: Date; expirationDate?: Date | null },
  cal: BusinessCalendar
): { dueAt: Date; opensAt: Date | null } | null {
  if (target.kind === 'BEFORE_EXPIRATION') {
    if (!input.expirationDate || target.dueDaysBeforeExpiration === null) return null;
    return expirationWindow(input.expirationDate, target.opensDaysBeforeExpiration, target.dueDaysBeforeExpiration, cal);
  }
  if (target.businessHours) return { dueAt: addBusinessHours(input.startAt, target.businessHours, cal), opensAt: null };
  if (target.businessDays) return { dueAt: addBusinessDays(input.startAt, target.businessDays, cal), opensAt: null };
  return null;
}

export type DueState = 'ON_TRACK' | 'DUE_SOON' | 'OVERDUE';

/**
 * Business minutes left before `dueAt` (negative once overdue, counting the
 * business minutes since). The basis for alerts in Module 41.
 */
export function businessMinutesRemaining(now: Date, dueAt: Date, cal: BusinessCalendar): number {
  return now <= dueAt ? businessMinutesBetween(now, dueAt, cal) : -businessMinutesBetween(dueAt, now, cal);
}

/**
 * On track, due soon (within `soonMinutes` business minutes, default two
 * business hours) or overdue. Overdue means the due time has passed, even
 * outside business hours.
 */
export function dueState(now: Date, dueAt: Date, cal: BusinessCalendar, soonMinutes = 120): DueState {
  if (now.getTime() > dueAt.getTime()) return 'OVERDUE';
  return businessMinutesRemaining(now, dueAt, cal) <= soonMinutes ? 'DUE_SOON' : 'ON_TRACK';
}

// ── Loading ──

/** The Desk calendar and holidays from the database, or the defaults if not set up. */
export async function loadBusinessCalendar(db: Pick<PrismaClient, 'deskCalendar' | 'deskHoliday'>): Promise<BusinessCalendar> {
  const [row, holidays] = await Promise.all([
    db.deskCalendar.findUnique({ where: { id: DEFAULT_CALENDAR.id } }),
    db.deskHoliday.findMany({ select: { date: true } }),
  ]);
  const base = row ?? DEFAULT_CALENDAR;
  return {
    timeZone: base.timeZone,
    workDays: [...base.workDays],
    dayStartMinute: base.dayStartMinute,
    dayEndMinute: base.dayEndMinute,
    holidays: holidays.map((h) => h.date),
  };
}
