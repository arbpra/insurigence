/**
 * The Desk, Module 11: business-hours SLA engine.
 *
 * Pure arithmetic on the placeholder calendar (Mon–Fri 9:00–17:00 US Eastern,
 * US federal holidays): time zones and the November daylight-saving change,
 * business hours and days across nights, weekends and holidays, waiting
 * periods, expiration-anchored renewal windows, applying the 11 client
 * targets, due-soon / overdue state, a randomised round-trip check, and
 * loading the live calendar. Writes nothing to the database.
 * Run with:  npx tsx script/verify-desk-business-time.ts
 */
import 'dotenv/config';
import { prisma } from '../lib/prisma';
import {
  type BusinessCalendar, localDateTime, zonedInstant, isoWeekday, addCalendarDays, isBusinessDay,
  businessMinutesBetween, addBusinessMinutes, addBusinessHours, addBusinessDays, nextBusinessMoment,
  activeBusinessMinutes, extendForPause, expirationWindow, computeDueAt, businessMinutesRemaining,
  dueState, loadBusinessCalendar,
} from '../lib/desk/business-time';
import { DEFAULT_CALENDAR, DEFAULT_HOLIDAYS, DEFAULT_SERVICE_LEVELS } from '../lib/desk/defaults';

let pass = 0, fail = 0;
const ok = (n: string, c: boolean) => { c ? pass++ : fail++; console.log(`  ${c ? '✓' : '✗'} ${n}`); };
const throws = (fn: () => unknown) => { try { fn(); return false; } catch { return true; } };

const cal: BusinessCalendar = { ...DEFAULT_CALENDAR, workDays: [...DEFAULT_CALENDAR.workDays], holidays: DEFAULT_HOLIDAYS.map((h) => h.date) };
const TZ = cal.timeZone;
/** A New York wall-clock time, e.g. ny('2026-11-02', '10:00'). */
const ny = (date: string, hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); return zonedInstant(date, h * 60 + m, TZ); };
const iso = (d: Date) => d.toISOString();
const same = (a: Date, b: Date) => a.getTime() === b.getTime();

// Reference dates (checked independently): Fri 30 Oct 2026; Sat 31 Oct; DST ends Sun 1 Nov 2026
// (EDT −4 → EST −5); Mon 2 Nov; Wed 25 Nov; Thanksgiving Thu 26 Nov (holiday); Fri 27 Nov.

(async () => {
  console.log('\n━━ Dates and time zones ━━');
  ok('weekdays: 30 Oct Fri, 31 Oct Sat, 1 Nov Sun, 2 Nov Mon',
    isoWeekday('2026-10-30') === 5 && isoWeekday('2026-10-31') === 6 && isoWeekday('2026-11-01') === 7 && isoWeekday('2026-11-02') === 1);
  ok('calendar-day arithmetic across month and year ends',
    addCalendarDays('2026-10-31', 1) === '2026-11-01' && addCalendarDays('2026-12-31', 1) === '2027-01-01' && addCalendarDays('2027-03-01', -1) === '2027-02-28');
  ok('9:00 New York before the clock change is 13:00 UTC (EDT)', iso(ny('2026-10-30', '09:00')) === '2026-10-30T13:00:00.000Z');
  ok('9:00 New York after the clock change is 14:00 UTC (EST)', iso(ny('2026-11-02', '09:00')) === '2026-11-02T14:00:00.000Z');
  ok('3:30 a.m. on the spring clock-change day (8 Mar 2026) is 07:30 UTC (needs the second offset check)',
    iso(zonedInstant('2026-03-08', 3 * 60 + 30, TZ)) === '2026-03-08T07:30:00.000Z');
  ok('UTC instant → New York local date and time (evening rolls back a day)', (() => {
    const l = localDateTime(new Date('2026-11-03T02:30:00Z'), TZ);
    return l.date === '2026-11-02' && l.minute === 21 * 60 + 30;
  })());
  ok('business days: weekdays yes, weekends and holidays no',
    isBusinessDay('2026-11-02', cal) && !isBusinessDay('2026-10-31', cal) && !isBusinessDay('2026-11-26', cal) && !isBusinessDay('2026-12-25', cal));

  console.log('\n━━ Business hours ━━');
  ok('Mon 10:00 + 4 h = Mon 14:00', same(addBusinessHours(ny('2026-11-02', '10:00'), 4, cal), ny('2026-11-02', '14:00')));
  ok('Mon 15:00 + 4 h = Tue 11:00 (overnight does not count)', same(addBusinessHours(ny('2026-11-02', '15:00'), 4, cal), ny('2026-11-03', '11:00')));
  ok('Mon 13:00 + 4 h = Mon 17:00 (ending at closing time stays that day)', same(addBusinessHours(ny('2026-11-02', '13:00'), 4, cal), ny('2026-11-02', '17:00')));
  ok('Mon 20:00 + 4 h = Tue 13:00 (evening request starts next morning)', same(addBusinessHours(ny('2026-11-02', '20:00'), 4, cal), ny('2026-11-03', '13:00')));
  ok('Mon 07:00 + 4 h = Mon 13:00 (early request starts at opening)', same(addBusinessHours(ny('2026-11-02', '07:00'), 4, cal), ny('2026-11-02', '13:00')));
  ok('Fri 15:00 + 4 h = Mon 11:00, across the weekend and the clock change',
    same(addBusinessHours(ny('2026-10-30', '15:00'), 4, cal), ny('2026-11-02', '11:00')) && iso(ny('2026-11-02', '11:00')) === '2026-11-02T16:00:00.000Z');
  ok('Wed 15:00 + 4 h = Fri 11:00, skipping Thanksgiving', same(addBusinessHours(ny('2026-11-25', '15:00'), 4, cal), ny('2026-11-27', '11:00')));
  ok('Christmas Eve 16:00 + 4 h = 28 Dec 12:00 (Christmas Friday and the weekend skipped)',
    same(addBusinessHours(ny('2026-12-24', '16:00'), 4, cal), ny('2026-12-28', '12:00')));

  console.log('\n━━ Business days ━━');
  ok('Mon 10:00 + 1 day = Tue 10:00', same(addBusinessDays(ny('2026-11-02', '10:00'), 1, cal), ny('2026-11-03', '10:00')));
  ok('Fri 16:00 + 1 day = Mon 16:00', same(addBusinessDays(ny('2026-10-30', '16:00'), 1, cal), ny('2026-11-02', '16:00')));
  ok('Saturday request + 1 day = Monday closing time', same(addBusinessDays(ny('2026-10-31', '12:00'), 1, cal), ny('2026-11-02', '17:00')));
  ok('Wed 10:00 + 2 days = Mon 10:00 (Thanksgiving and weekend skipped)', same(addBusinessDays(ny('2026-11-25', '10:00'), 2, cal), ny('2026-11-30', '10:00')));
  ok('clock start: a Saturday request starts Monday 9:00; a Monday 11:00 request starts at once',
    same(nextBusinessMoment(ny('2026-10-31', '12:00'), cal), ny('2026-11-02', '09:00')) &&
    same(nextBusinessMoment(ny('2026-11-02', '11:00'), cal), ny('2026-11-02', '11:00')));

  console.log('\n━━ Counting business time ━━');
  ok('Fri 16:00 → Mon 10:00 = 2 business hours', businessMinutesBetween(ny('2026-10-30', '16:00'), ny('2026-11-02', '10:00'), cal) === 120);
  ok('a normal week = 40 business hours', businessMinutesBetween(ny('2026-11-02', '00:00'), ny('2026-11-09', '00:00'), cal) === 40 * 60);
  ok('Thanksgiving week = 32 business hours', businessMinutesBetween(ny('2026-11-23', '00:00'), ny('2026-11-30', '00:00'), cal) === 32 * 60);
  ok('end before start = 0', businessMinutesBetween(ny('2026-11-03', '10:00'), ny('2026-11-02', '10:00'), cal) === 0);
  ok('a whole weekend = 0', businessMinutesBetween(ny('2026-10-30', '17:00'), ny('2026-11-02', '09:00'), cal) === 0);
  {
    // Randomised round trip: adding N business minutes and counting back gives N.
    let seed = 42;
    const rand = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
    const base = new Date('2026-10-01T00:00:00Z').getTime();
    let bad = 0;
    for (let i = 0; i < 300; i++) {
      const start = new Date(base + Math.floor(rand() * 120 * 86_400_000));
      const minutes = Math.floor(rand() * 6000);
      const due = addBusinessMinutes(start, minutes, cal);
      if (businessMinutesBetween(start, due, cal) !== minutes) bad++;
    }
    ok('300 random requests (Oct–Jan, DST and holidays included): add then count back is exact', bad === 0);
  }
  {
    const t0 = Date.now();
    const yearMinutes = businessMinutesBetween(ny('2026-01-01', '00:00'), ny('2027-01-01', '00:00'), cal);
    const ms = Date.now() - t0;
    const holidaysIn2026 = DEFAULT_HOLIDAYS.filter((h) => h.date.startsWith('2026')).length;
    ok(`a full year = 261 weekdays − ${holidaysIn2026} holidays, counted in ${ms} ms`, yearMinutes === (261 - holidaysIn2026) * 480 && ms < 2000);
  }

  console.log('\n━━ Waiting periods ━━');
  {
    const start = ny('2026-11-02', '09:00'), end = ny('2026-11-04', '09:00'); // 16 business hours
    ok('no pauses: all business time is active', activeBusinessMinutes(start, end, [], cal) === 960);
    ok('waiting Mon 12:00 → Tue 12:00 removes 8 business hours',
      activeBusinessMinutes(start, end, [{ from: ny('2026-11-02', '12:00'), to: ny('2026-11-03', '12:00') }], cal) === 480);
    ok('overlapping waits are not counted twice', activeBusinessMinutes(start, end, [
      { from: ny('2026-11-02', '12:00'), to: ny('2026-11-02', '15:00') },
      { from: ny('2026-11-02', '14:00'), to: ny('2026-11-02', '16:00') },
    ], cal) === 960 - 240);
    ok('a wait still open runs to the end', activeBusinessMinutes(start, end, [{ from: ny('2026-11-03', '09:00'), to: null }], cal) === 480);
    ok('waits outside the period are ignored', activeBusinessMinutes(start, end, [{ from: ny('2026-10-26', '09:00'), to: ny('2026-10-27', '09:00') }], cal) === 960);
    ok('resuming pushes the due time out by the business time waited (2 h)',
      same(extendForPause(ny('2026-11-03', '12:00'), { from: ny('2026-11-02', '15:00'), to: ny('2026-11-02', '17:00') }, cal), ny('2026-11-03', '14:00')));
    ok('waiting only over a weekend does not move the due time',
      same(extendForPause(ny('2026-11-02', '12:00'), { from: ny('2026-10-30', '18:00'), to: ny('2026-11-02', '08:00') }, cal), ny('2026-11-02', '12:00')));
  }

  console.log('\n━━ Renewal and remarketing windows ━━');
  {
    const exp = new Date('2027-03-01T00:00:00Z'); // policy expires Mon 1 Mar 2027
    const renewal = expirationWindow(exp, 120, 90, cal);
    ok('renewal 120–90 days: opens Sun 1 Nov 9:00, due Tue 1 Dec 17:00',
      same(renewal.opensAt!, ny('2026-11-01', '09:00')) && same(renewal.dueAt, ny('2026-12-01', '17:00')));
    ok('a due date on a Sunday moves earlier to Friday (never later)', same(expirationWindow(exp, null, 92, cal).dueAt, ny('2026-11-27', '17:00')));
    ok('a due date on Thanksgiving moves to the Wednesday', same(expirationWindow(exp, null, 95, cal).dueAt, ny('2026-11-25', '17:00')));
    ok('the expiration date is read as a date, not shifted by the time zone',
      same(expirationWindow(new Date('2027-03-01T00:00:00Z'), null, 0, cal).dueAt, ny('2027-03-01', '17:00')));
  }

  console.log('\n━━ Applying the client targets ━━');
  {
    const t = (type: string, complexity?: string) => DEFAULT_SERVICE_LEVELS.find((s) => s.taskType === type && (complexity === undefined || s.complexity === complexity))!;
    const timing = (s: any) => ({ kind: s.kind ?? 'BUSINESS_TIME', businessHours: s.businessHours ?? null, businessDays: s.businessDays ?? null,
      opensDaysBeforeExpiration: s.opensDaysBeforeExpiration ?? null, dueDaysBeforeExpiration: s.dueDaysBeforeExpiration ?? null });
    const at = ny('2026-11-02', '10:00');
    const exp = new Date('2027-03-01T00:00:00Z');
    ok('standard COI (4 business hours): Mon 10:00 → Mon 14:00', same(computeDueAt(timing(t('COI', 'STANDARD')), { startAt: at }, cal)!.dueAt, ny('2026-11-02', '14:00')));
    ok('complex COI (1 business day): Mon 10:00 → Tue 10:00', same(computeDueAt(timing(t('COI', 'COMPLEX')), { startAt: at }, cal)!.dueAt, ny('2026-11-03', '10:00')));
    ok('standard endorsement (2 days): Mon 10:00 → Wed 10:00', same(computeDueAt(timing(t('ENDORSEMENT', 'STANDARD')), { startAt: at }, cal)!.dueAt, ny('2026-11-04', '10:00')));
    const renewal = computeDueAt(timing(t('RENEWAL')), { startAt: at, expirationDate: exp }, cal);
    ok('renewal: due 90 days before expiration, opens at 120', !!renewal && same(renewal.dueAt, ny('2026-12-01', '17:00')) && same(renewal.opensAt!, ny('2026-11-01', '09:00')));
    const remarket = computeDueAt(timing(t('REMARKETING')), { startAt: at, expirationDate: exp }, cal);
    ok('remarketing: due 45 days before expiration (Fri 15 Jan)', !!remarket && same(remarket.dueAt, ny('2027-01-15', '17:00')));
    ok('renewal without a policy expiration: no due date (null, not a guess)', computeDueAt(timing(t('RENEWAL')), { startAt: at }, cal) === null);
    ok('a target with no duration: no due date', computeDueAt({ kind: 'BUSINESS_TIME', businessHours: null, businessDays: null, opensDaysBeforeExpiration: null, dueDaysBeforeExpiration: null }, { startAt: at }, cal) === null);
  }

  console.log('\n━━ On track, due soon, overdue ━━');
  {
    const due = ny('2026-11-02', '14:00');
    ok('3 business hours left: on track', dueState(ny('2026-11-02', '11:00'), due, cal) === 'ON_TRACK');
    ok('1 business hour left: due soon', dueState(ny('2026-11-02', '13:00'), due, cal) === 'DUE_SOON');
    ok('past the due time: overdue', dueState(ny('2026-11-02', '14:01'), due, cal) === 'OVERDUE');
    ok('due Monday 10:00, checked Friday 17:30: only 1 business hour left (weekend not counted)',
      dueState(ny('2026-10-30', '17:30'), ny('2026-11-02', '10:00'), cal) === 'DUE_SOON' && businessMinutesRemaining(ny('2026-10-30', '17:30'), ny('2026-11-02', '10:00'), cal) === 60);
    ok('overdue time counts business minutes since (negative)', businessMinutesRemaining(ny('2026-11-03', '10:00'), due, cal) === -(180 + 60));
  }

  console.log('\n━━ Other calendars and bad input ━━');
  {
    const india: BusinessCalendar = { timeZone: 'Asia/Kolkata', workDays: [1, 2, 3, 4, 5, 6], dayStartMinute: 600, dayEndMinute: 1080, holidays: [] };
    const sat = zonedInstant('2026-10-31', 17 * 60, 'Asia/Kolkata');
    ok('a six-day calendar in another zone: Sat 17:00 IST + 2 h = Mon 11:00 IST',
      same(addBusinessHours(sat, 2, india), zonedInstant('2026-11-02', 11 * 60, 'Asia/Kolkata')) && iso(sat) === '2026-10-31T11:30:00.000Z');
    ok('a calendar with no working days is refused, not looped forever', throws(() => addBusinessHours(new Date(), 1, { ...cal, workDays: [] })));
    ok('closing before opening is refused', throws(() => addBusinessHours(new Date(), 1, { ...cal, dayEndMinute: 500 })));
    ok('negative durations are refused', throws(() => addBusinessMinutes(new Date(), -5, cal)));
  }

  console.log('\n━━ Live calendar ━━');
  {
    const live = await loadBusinessCalendar(prisma);
    ok('the stored calendar loads: Mon–Fri 9:00–17:00 New York',
      live.timeZone === 'America/New_York' && live.workDays.join() === '1,2,3,4,5' && live.dayStartMinute === 540 && live.dayEndMinute === 1020);
    ok(`all ${DEFAULT_HOLIDAYS.length} holidays load`, DEFAULT_HOLIDAYS.every((h) => live.holidays.includes(h.date)));
    ok('the live calendar gives the same answers as the test calendar',
      same(addBusinessHours(ny('2026-11-25', '15:00'), 4, live), ny('2026-11-27', '11:00')));
    const empty = await loadBusinessCalendar({
      deskCalendar: { findUnique: async () => null } as any, deskHoliday: { findMany: async () => [] } as any,
    });
    ok('with nothing stored it falls back to the default hours', empty.timeZone === 'America/New_York' && empty.holidays.length === 0);
  }

  console.log(`\n━━ ${pass} passed, ${fail} failed ━━`);
  await prisma.$disconnect();
  process.exit(fail ? 1 : 0);
})();
