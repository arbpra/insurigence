/**
 * Editing the Desk's business calendar: time zone, working days, business
 * hours and holidays (client answer Q5, plan detail D2). Super Admin and
 * Operations Managers only; every change is audited.
 *
 * Changes apply from the next calculation. Open requests keep the due date
 * they already have, so a date already set never moves silently. Time waited
 * is measured with the calendar in force when the wait ends.
 */
import { Prisma, type PrismaClient } from '@prisma/client';
import { DeskAccessError, isObjectId, type DeskScope, type GuardContext } from './access';
import { assertDeskPlatform } from './agency-setup';
import { recordAudit } from './audit';
import { addBusinessDays, addBusinessHours, loadBusinessCalendar, nextBusinessMoment, type BusinessCalendar } from './business-time';
import { DEFAULT_CALENDAR } from './defaults';

type Db = PrismaClient;

const TX_OPTIONS = { timeout: 20_000, maxWait: 10_000 };
const LAST_MINUTE_OF_DAY = 23 * 60 + 59;
/** Warn when the holiday list runs out sooner than this. */
const HOLIDAY_RUNWAY_DAYS = 90;

const bad = (message: string) => new DeskAccessError(400, message);
const conflict = (message: string) => new DeskAccessError(409, message);
const CHANGED_ELSEWHERE = 'Someone else just changed the calendar. Reload and try again.';

async function inTransaction<T>(db: Db, fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  try {
    return await db.$transaction(fn, TX_OPTIONS);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2034') throw conflict(CHANGED_ELSEWHERE);
    throw err;
  }
}

const audit = (tx: Prisma.TransactionClient, scope: DeskScope, ctx: GuardContext, action: 'calendar.changed' | 'holiday.added' | 'holiday.removed', entityId: string, metadata: Record<string, unknown>) =>
  recordAudit(tx, { actor: { id: scope.userId, role: scope.role }, action, entityType: 'DeskCalendar', entityId, metadata, ip: ctx.ip, userAgent: ctx.userAgent });

/** A named zone such as America/New_York; refuses offsets, which ignore daylight saving. */
export function isTimeZone(value: unknown): value is string {
  if (typeof value !== 'string' || !/^(UTC|[A-Za-z_]+(\/[A-Za-z0-9_+-]+)+)$/.test(value)) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

const formatIn = (at: Date, timeZone: string) =>
  new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(at);

/** Worked examples, so an admin can see what the settings mean. */
function examples(cal: BusinessCalendar, now: Date) {
  return {
    now: formatIn(now, cal.timeZone),
    clockStarts: formatIn(nextBusinessMoment(now, cal), cal.timeZone),
    fourHours: formatIn(addBusinessHours(now, 4, cal), cal.timeZone),
    oneDay: formatIn(addBusinessDays(now, 1, cal), cal.timeZone),
  };
}

export async function getCalendarSetup(db: Db, scope: DeskScope, now: Date = new Date()) {
  assertDeskPlatform(scope);
  const [row, holidays, cal] = await Promise.all([
    db.deskCalendar.findUnique({ where: { id: DEFAULT_CALENDAR.id } }),
    db.deskHoliday.findMany({ orderBy: { date: 'asc' }, select: { id: true, date: true, name: true } }),
    loadBusinessCalendar(db),
  ]);
  const lastHoliday = holidays.at(-1)?.date ?? null;
  const runwayEnds = new Date(now.getTime() + HOLIDAY_RUNWAY_DAYS * 86_400_000).toISOString().slice(0, 10);
  return {
    version: row?.updatedAt.toISOString() ?? null,
    timeZone: cal.timeZone,
    workDays: cal.workDays,
    dayStartMinute: cal.dayStartMinute,
    dayEndMinute: cal.dayEndMinute,
    holidays,
    lastHoliday,
    /** The list needs next year's dates soon, or days off would count as worked. */
    holidaysRunningOut: !lastHoliday || lastHoliday < runwayEnds,
    examples: examples(cal, now),
  };
}

export interface CalendarInput {
  /** The `version` the form was loaded with; a later save by someone else is refused. */
  version?: unknown;
  timeZone?: unknown;
  workDays?: unknown;
  dayStartMinute?: unknown;
  dayEndMinute?: unknown;
}

function parseCalendar(input: CalendarInput) {
  if (!isTimeZone(input.timeZone)) throw bad('Choose a valid time zone.');
  const { dayStartMinute, dayEndMinute, workDays } = input;
  const inDay = (m: unknown): m is number => typeof m === 'number' && Number.isInteger(m) && m >= 0 && m <= LAST_MINUTE_OF_DAY;
  if (!inDay(dayStartMinute) || !inDay(dayEndMinute)) throw bad('Choose an opening and a closing time.');
  if (dayEndMinute <= dayStartMinute) throw bad('Closing time must be after opening time on the same day.');
  if (!Array.isArray(workDays) || workDays.length === 0) throw bad('Choose at least one working day.');
  if (!workDays.every((d) => Number.isInteger(d) && d >= 1 && d <= 7)) throw bad('Working days are numbered 1 (Monday) to 7 (Sunday).');
  return { timeZone: input.timeZone, dayStartMinute, dayEndMinute, workDays: [...new Set(workDays as number[])].sort((a, b) => a - b) };
}

/** Saves the calendar. Returns false when nothing changed. */
export async function saveCalendar(db: Db, scope: DeskScope, input: CalendarInput, ctx: GuardContext = {}): Promise<boolean> {
  assertDeskPlatform(scope);
  const next = parseCalendar(input);
  const current = await db.deskCalendar.findUnique({ where: { id: DEFAULT_CALENDAR.id } });
  if (current && input.version !== undefined && input.version !== current.updatedAt.toISOString()) throw conflict(CHANGED_ELSEWHERE);
  const base = current ?? DEFAULT_CALENDAR;
  const describe = (c: { timeZone: string; workDays: number[]; dayStartMinute: number; dayEndMinute: number }) =>
    ({ timeZone: c.timeZone, workDays: c.workDays, dayStartMinute: c.dayStartMinute, dayEndMinute: c.dayEndMinute });
  if (current && JSON.stringify(describe(base)) === JSON.stringify(describe(next))) return false;

  await inTransaction(db, async (tx) => {
    if (current) {
      // Only if nobody saved since this one read it.
      const { count } = await tx.deskCalendar.updateMany({ where: { id: current.id, updatedAt: current.updatedAt }, data: next });
      if (count !== 1) throw conflict(CHANGED_ELSEWHERE);
    } else {
      await tx.deskCalendar.create({ data: { id: DEFAULT_CALENDAR.id, ...next } });
    }
    await audit(tx, scope, ctx, 'calendar.changed', DEFAULT_CALENDAR.id, { from: describe(base), to: next });
  });
  return true;
}

function parseDate(value: unknown): string {
  const m = typeof value === 'string' ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(value) : null;
  if (!m) throw bad('Enter the holiday date.');
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  if (d.toISOString().slice(0, 10) !== value) throw bad('That is not a real date.');
  return value as string;
}

export async function addHoliday(db: Db, scope: DeskScope, input: { date?: unknown; name?: unknown }, ctx: GuardContext = {}): Promise<{ id: string }> {
  assertDeskPlatform(scope);
  const date = parseDate(input.date);
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  if (!name) throw bad('Enter the holiday name.');
  if (name.length > 100) throw bad('Holiday name must be 100 characters or fewer.');
  try {
    return await inTransaction(db, async (tx) => {
      const holiday = await tx.deskHoliday.create({ data: { date, name }, select: { id: true } });
      await audit(tx, scope, ctx, 'holiday.added', holiday.id, { date, name });
      return holiday;
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') throw conflict('That date is already a holiday.');
    throw err;
  }
}

export async function removeHoliday(db: Db, scope: DeskScope, id: unknown, ctx: GuardContext = {}): Promise<void> {
  assertDeskPlatform(scope);
  if (!isObjectId(id)) throw new DeskAccessError(404, 'Not found');
  const holiday = await db.deskHoliday.findUnique({ where: { id } });
  if (!holiday) throw new DeskAccessError(404, 'Not found');
  await inTransaction(db, async (tx) => {
    const { count } = await tx.deskHoliday.deleteMany({ where: { id } });
    if (count !== 1) throw new DeskAccessError(404, 'Not found');
    await audit(tx, scope, ctx, 'holiday.removed', id, { date: holiday.date, name: holiday.name });
  });
}
