/**
 * The Desk, Module 19: business calendar editor.
 *
 * Who may edit; calendar rules; what a change does to new requests and to open
 * ones; holidays; the seeder leaving an admin's list alone; and business-time
 * arithmetic with hours the seeded calendar never used, across daylight saving.
 *
 * Safety: the Desk calendar is one shared record, so these tests never write
 * to it. Saves go to an in-memory stand-in; holidays use dates in 2099 only. A
 * snapshot of the real calendar and holidays is compared at the end, so a
 * stray write fails this suite even when a guard has been deliberately broken.
 * Run with:  npx tsx script/verify-desk-calendar.ts
 */
import 'dotenv/config';
import type { PrismaClient, UserRole } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { DeskAccessError, resolveDeskScope } from '../lib/desk/access';
import { addBusinessDays, addBusinessHours, addBusinessMinutes, businessMinutesBetween, loadBusinessCalendar, type BusinessCalendar } from '../lib/desk/business-time';
import { addHoliday, getCalendarSetup, isTimeZone, removeHoliday, saveCalendar } from '../lib/desk/calendar-admin';
import { DEFAULT_CALENDAR, DEFAULT_HOLIDAYS, ensureDeskDefaults } from '../lib/desk/defaults';
import { createTask } from '../lib/desk/tasks';

let pass = 0, fail = 0;
const ok = (n: string, c: boolean) => { c ? pass++ : fail++; console.log(`  ${c ? '✓' : '✗'} ${n}`); };

const TAG = `m19test-${Date.now()}`;
const cleanup = { agencyIds: [] as string[], userIds: [] as string[] };
const TEST_HOLIDAY = { startsWith: '2099-' };

async function realSnapshot() {
  const calendar = await prisma.deskCalendar.findUnique({ where: { id: DEFAULT_CALENDAR.id } });
  const holidays = await prisma.deskHoliday.findMany({ where: { date: { not: TEST_HOLIDAY } }, orderBy: { date: 'asc' }, select: { id: true, date: true, name: true } });
  return JSON.stringify({ calendar, holidays });
}

/** Stands in for the one real calendar record. Every other table is the real one. */
function withFakeCalendar() {
  const store = {
    row: { ...DEFAULT_CALENDAR, workDays: [...DEFAULT_CALENDAR.workDays], updatedAt: new Date('2026-01-01T00:00:00Z') } as (typeof DEFAULT_CALENDAR & { updatedAt: Date }) | null,
    tick: 0,
  };
  const fake = {
    findUnique: async () => store.row && { ...store.row, workDays: [...store.row.workDays] },
    create: async ({ data }: { data: typeof DEFAULT_CALENDAR }) => { store.row = { ...data, updatedAt: new Date() }; return store.row; },
    updateMany: async ({ where, data }: { where: { updatedAt: Date }; data: Partial<typeof DEFAULT_CALENDAR> }) => {
      if (!store.row || store.row.updatedAt.getTime() !== where.updatedAt.getTime()) return { count: 0 };
      store.row = { ...store.row, ...data, updatedAt: new Date(Date.parse('2026-02-01T00:00:00Z') + ++store.tick * 1000) };
      return { count: 1 };
    },
  };
  const wrap = <T extends object>(client: T): T => new Proxy(client, {
    get(target, key) {
      if (key === 'deskCalendar') return fake;
      if (key === '$transaction') {
        return (fn: (tx: unknown) => Promise<unknown>, opts: unknown) => (target as unknown as PrismaClient).$transaction((tx) => fn(wrap(tx)), opts as never);
      }
      const value = Reflect.get(target, key);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  return { db: wrap(prisma) as PrismaClient, store };
}

async function wipe() {
  const agencyId = { in: cleanup.agencyIds };
  await prisma.taskEvent.deleteMany({ where: { agencyId } });
  await prisma.task.updateMany({ where: { agencyId }, data: { parentTaskId: null } });
  await prisma.task.deleteMany({ where: { agencyId } });
  await prisma.insuredAccount.deleteMany({ where: { agencyId } });
  await prisma.deskHoliday.deleteMany({ where: { date: TEST_HOLIDAY } });
  await prisma.deskAuditLog.deleteMany({ where: { OR: [{ agencyId }, { actorId: { in: cleanup.userIds } }] } });
  await prisma.user.deleteMany({ where: { id: { in: cleanup.userIds } } });
  await prisma.agency.deleteMany({ where: { id: agencyId } });
}

const NY: BusinessCalendar = { timeZone: 'America/New_York', workDays: [1, 2, 3, 4, 5, 6, 7], dayStartMinute: 9 * 60, dayEndMinute: 17 * 60, holidays: [] };

(async () => {
  const before = await realSnapshot();
  try {
    const mkUser = async (n: string, role: UserRole, agencyId: string | null = null) => {
      const u = await prisma.user.create({ data: { email: `${TAG}-${n}@example.test`, role, agencyId, firstName: n, passwordHash: 'x' } });
      cleanup.userIds.push(u.id); return u;
    };
    const A = await prisma.agency.create({ data: { name: `${TAG} A`, deskEnabled: true } }); cleanup.agencyIds.push(A.id);
    const ops = await mkUser('ops', 'DESK_ADMIN');
    const am = await mkUser('am', 'ACCOUNT_MANAGER');
    const va = await mkUser('va', 'DESK_VA');
    const admin = await mkUser('admin-a', 'ADMIN', A.id);
    const scope = await resolveDeskScope(prisma, ops.id);
    const CTX = { ip: '203.0.113.6', userAgent: 'verify' };
    const insured = await prisma.insuredAccount.create({ data: { agencyId: A.id, name: `${TAG} i`, nameKey: `${TAG} i` } });

    const status = async (fn: () => Promise<unknown>) => {
      try { await fn(); return 200; } catch (e) { if (e instanceof DeskAccessError) return e.status; throw e; }
    };
    const { db, store } = withFakeCalendar();
    const good = { timeZone: 'America/New_York', workDays: [1, 2, 3, 4, 5], dayStartMinute: 540, dayEndMinute: 1020 };
    const save = (input: object) => saveCalendar(db, scope, { ...good, ...input }, CTX);
    const auditCount = () => prisma.deskAuditLog.count({ where: { action: 'calendar.changed', actorId: ops.id } });

    console.log('Who may do this');
    for (const [name, id] of [['agency admin', admin.id], ['Account Manager', am.id], ['VA', va.id]] as const) {
      const s = await resolveDeskScope(prisma, id);
      ok(`${name}: cannot read`, await status(() => getCalendarSetup(db, s)) === 403);
      ok(`${name}: cannot save`, await status(() => saveCalendar(db, s, good)) === 403);
      ok(`${name}: cannot add a holiday`, await status(() => addHoliday(db, s, { date: '2099-01-01', name: 'x' })) === 403);
      ok(`${name}: cannot remove a holiday`, await status(() => removeHoliday(db, s, '507f1f77bcf86cd799439011')) === 403);
    }

    console.log('Time zones');
    ok('named zones accepted', ['America/New_York', 'Asia/Kolkata', 'America/Argentina/Buenos_Aires', 'UTC'].every(isTimeZone));
    ok('nonsense refused', !isTimeZone('Mars/Olympus') && !isTimeZone('') && !isTimeZone(null));
    ok('fixed offsets refused (they ignore daylight saving)', !isTimeZone('+05:30') && !isTimeZone('Etc') && !isTimeZone('EST'));

    console.log('Calendar rules');
    ok('bad zone refused', await status(() => save({ timeZone: 'Nope/Zone' })) === 400);
    ok('closing before opening refused', await status(() => save({ dayStartMinute: 1020, dayEndMinute: 540 })) === 400);
    ok('closing at opening refused', await status(() => save({ dayStartMinute: 540, dayEndMinute: 540 })) === 400);
    ok('fractional minutes refused', await status(() => save({ dayStartMinute: 540.5 })) === 400);
    ok('negative minutes refused', await status(() => save({ dayStartMinute: -1 })) === 400);
    ok('past midnight refused', await status(() => save({ dayEndMinute: 1440 })) === 400);
    ok('no working days refused', await status(() => save({ workDays: [] })) === 400);
    ok('day 0 refused', await status(() => save({ workDays: [0, 1] })) === 400);
    ok('day 8 refused', await status(() => save({ workDays: [8] })) === 400);
    ok('missing days refused', await status(() => saveCalendar(db, scope, { timeZone: 'UTC', dayStartMinute: 1, dayEndMinute: 2 })) === 400);
    ok('nothing saved by the refusals', store.row?.dayStartMinute === 540 && await auditCount() === 0);

    console.log('Saving');
    ok('same values: reports no change, no entry', await save({}) === false && await auditCount() === 0);
    ok('days in another order count as the same', await save({ workDays: [5, 4, 3, 2, 1, 1] }) === false);
    const loaded = await getCalendarSetup(db, scope, new Date('2026-11-04T15:00:00Z'));
    ok('form shows the current settings', loaded.timeZone === 'America/New_York' && loaded.dayStartMinute === 540 && loaded.workDays.join() === '1,2,3,4,5');
    ok('worked example: 10:00 Wednesday plus 4 hours', loaded.examples.fourHours.includes('2:00') && loaded.examples.fourHours.includes('Nov 4'));
    ok('worked example: plus 1 day', loaded.examples.oneDay.includes('Nov 5'));
    const changed = await save({ version: loaded.version, timeZone: 'Asia/Kolkata', workDays: [6, 1, 2], dayStartMinute: 600, dayEndMinute: 1080 });
    ok('saved', changed && store.row?.timeZone === 'Asia/Kolkata' && store.row.dayStartMinute === 600);
    ok('days stored in order', store.row?.workDays.join() === '1,2,6');
    const log = await prisma.deskAuditLog.findFirstOrThrow({ where: { action: 'calendar.changed', actorId: ops.id } });
    const meta = log.metadata as { from: { timeZone: string }; to: { timeZone: string } };
    ok('audit has before, after and where from', meta.from.timeZone === 'America/New_York' && meta.to.timeZone === 'Asia/Kolkata' && log.ipAddress === CTX.ip);
    ok('a save from an out-of-date form is refused', await status(() => save({ version: loaded.version, dayStartMinute: 480 })) === 409);
    ok('and changed nothing', store.row?.dayStartMinute === 600);
    const fresh = (await getCalendarSetup(db, scope)).version!;
    const racing = await Promise.all([1, 2].map((i) => status(() => save({ version: fresh, dayStartMinute: 600 + i, timeZone: 'Asia/Kolkata', workDays: [1, 2, 6] }))));
    ok('two saves at the same moment: one wins', racing.sort().join() === '200,409');

    // A save landing between this one's read and its write.
    const interleaved = withFakeCalendar();
    const interrupting = new Proxy(interleaved.db, {
      get(target, key) {
        if (key !== 'deskCalendar') { const v = Reflect.get(target, key); return typeof v === 'function' ? v.bind(target) : v; }
        const cal = Reflect.get(target, key) as { findUnique: () => Promise<unknown> };
        return { ...cal, findUnique: async () => { const row = await cal.findUnique(); interleaved.store.row!.updatedAt = new Date('2026-03-01T00:00:00Z'); return row; } };
      },
    });
    ok('a save landing between read and write is not overwritten', await status(() => saveCalendar(interrupting, scope, { ...good, dayStartMinute: 480 })) === 409 && interleaved.store.row?.dayStartMinute === 540);

    const empty = withFakeCalendar();
    empty.store.row = null;
    ok('an unseeded Desk still loads, using the defaults', (await getCalendarSetup(empty.db, scope)).timeZone === DEFAULT_CALENDAR.timeZone);
    ok('and the first save creates the record', await saveCalendar(empty.db, scope, good) === true && empty.store.row !== null);

    console.log('What it does to requests');
    const live = withFakeCalendar();
    await prisma.serviceLevelTarget.findFirstOrThrow({ where: { taskType: 'COI', complexity: 'STANDARD', agencyId: null, isActive: true } });
    const mk = () => createTask(live.db, scope, { type: 'COI', title: 'x', insuredId: insured.id, complexity: 'STANDARD' }, CTX);
    const open = await mk();
    await saveCalendar(live.db, scope, { ...good, dayStartMinute: 60, dayEndMinute: 120, workDays: [1, 2, 3, 4, 5, 6, 7] }, CTX);
    const stillOpen = await prisma.task.findUniqueOrThrow({ where: { id: open.id } });
    ok('an open request keeps its due date', stillOpen.dueAt?.getTime() === open.dueAt?.getTime());
    const after = await mk();
    ok('a new request uses the new hours', after.dueAt?.getTime() !== open.dueAt?.getTime());
    const local = new Intl.DateTimeFormat('en-GB', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(after.dueAt!);
    ok('and lands inside them', local >= '01:00' && local <= '02:00');

    console.log('Holidays');
    const addH = (input: object) => addHoliday(db, scope, input, CTX);
    ok('date required', await status(() => addH({ name: 'x' })) === 400);
    ok('impossible date refused', await status(() => addH({ date: '2099-02-30', name: 'x' })) === 400);
    ok('wrong format refused', await status(() => addH({ date: '01/02/2099', name: 'x' })) === 400);
    ok('name required', await status(() => addH({ date: '2099-01-02', name: '  ' })) === 400);
    ok('overlong name refused', await status(() => addH({ date: '2099-01-02', name: 'x'.repeat(101) })) === 400);
    const h1 = await addH({ date: '2099-07-04', name: ' Test Day ' });
    const stored = await prisma.deskHoliday.findUniqueOrThrow({ where: { id: h1.id } });
    ok('added, name trimmed', stored.date === '2099-07-04' && stored.name === 'Test Day');
    ok('audited', await prisma.deskAuditLog.count({ where: { action: 'holiday.added', entityId: h1.id, actorId: ops.id } }) === 1);
    ok('same date twice: clear message', await status(() => addH({ date: '2099-07-04', name: 'Again' })) === 409);
    ok('listed, in date order', (await getCalendarSetup(db, scope)).holidays.at(-1)?.date === '2099-07-04');
    await addH({ date: '2099-01-02', name: 'Earlier' });
    const list = (await getCalendarSetup(db, scope)).holidays.map((h) => h.date);
    ok('stays in date order', list.indexOf('2099-01-02') < list.indexOf('2099-07-04'));
    // Every day is a working day here, so the only reason to skip the 4th is the holiday.
    const cal7 = await loadBusinessCalendar(db);
    const dayBefore = new Date('2099-07-03T20:59:00Z'); // 16:59 in New York, one minute before closing
    const overHoliday = addBusinessMinutes(dayBefore, 2, { ...cal7, timeZone: 'America/New_York', workDays: [1, 2, 3, 4, 5, 6, 7], dayStartMinute: 540, dayEndMinute: 1020 });
    ok('the arithmetic skips it', overHoliday.toISOString().slice(0, 10) === '2099-07-05');
    await removeHoliday(db, scope, h1.id, CTX);
    ok('removed, audited with what it was', await prisma.deskHoliday.count({ where: { id: h1.id } }) === 0
      && JSON.stringify((await prisma.deskAuditLog.findFirstOrThrow({ where: { action: 'holiday.removed', entityId: h1.id } })).metadata).includes('2099-07-04'));
    ok('removing twice: 404', await status(() => removeHoliday(db, scope, h1.id)) === 404);
    ok('malformed id: 404', await status(() => removeHoliday(db, scope, 'nope')) === 404);
    await prisma.deskHoliday.deleteMany({ where: { date: TEST_HOLIDAY } });

    console.log('Running out of holidays');
    const withLast = (last: string) => getCalendarSetup(db, scope, new Date(new Date(`${last}T12:00:00Z`).getTime() - 30 * 86_400_000));
    const realLast = (await prisma.deskHoliday.findFirst({ orderBy: { date: 'desc' } }))?.date ?? '2026-01-01';
    ok('warns when the list ends within 90 days', (await withLast(realLast)).holidaysRunningOut === true);
    ok('quiet when well covered', (await getCalendarSetup(db, scope, new Date(new Date(`${realLast}T12:00:00Z`).getTime() - 200 * 86_400_000))).holidaysRunningOut === false);

    console.log('Seeder leaves an admin\'s list alone');
    let created: unknown[] = [];
    const seedWith = (count: number) => new Proxy(prisma, {
      get(target, key) {
        if (key === 'deskHoliday') return { count: async () => count, createMany: async ({ data }: { data: unknown[] }) => { created = data; return { count: data.length }; } };
        const value = Reflect.get(target, key);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    await ensureDeskDefaults(seedWith(5));
    ok('a holiday list that exists is not added to', created.length === 0);
    await ensureDeskDefaults(seedWith(0));
    ok('an empty list gets the defaults', created.length === DEFAULT_HOLIDAYS.length);

    console.log('Hours the seeded calendar never used');
    const at = (iso: string) => new Date(iso);
    // 8 March 2026: New York clocks jump from 2:00 to 3:00.
    const inGap = { ...NY, dayStartMinute: 2 * 60 + 30, dayEndMinute: 6 * 60 };
    const dst = addBusinessHours(at('2026-03-08T04:00:00Z'), 1, inGap);
    ok('opening inside the daylight-saving jump still gives a valid time', !Number.isNaN(dst.getTime()) && dst > at('2026-03-08T04:00:00Z'));
    ok('and a due date a day later is sensible', addBusinessDays(at('2026-03-07T12:00:00Z'), 1, inGap) > at('2026-03-07T12:00:00Z'));
    const fall = { ...NY, dayStartMinute: 60, dayEndMinute: 180 };
    const fallDue = addBusinessMinutes(at('2026-11-01T04:00:00Z'), 30, fall);
    ok('hours inside the autumn repeated hour still give a valid time', !Number.isNaN(fallDue.getTime()) && fallDue > at('2026-11-01T04:00:00Z'));
    const round = (cal: BusinessCalendar, startIso: string) => {
      const start = at(startIso);
      return [15, 60, 240, 600, 2400].every((m) => {
        const due = addBusinessMinutes(start, m, cal);
        return due > start && Math.abs(businessMinutesBetween(start, due, cal) - m) <= 60;
      });
    };
    ok('nearly round the clock: minutes add up across the spring change', round({ ...NY, dayStartMinute: 0, dayEndMinute: 1439 }, '2026-03-07T12:00:00Z'));
    ok('nearly round the clock: minutes add up across the autumn change', round({ ...NY, dayStartMinute: 0, dayEndMinute: 1439 }, '2026-10-31T12:00:00Z'));
    ok('a one-minute day still finishes', addBusinessMinutes(at('2026-11-04T12:00:00Z'), 5, { ...NY, dayStartMinute: 540, dayEndMinute: 541 }) > at('2026-11-04T12:00:00Z'));
    ok('a one-day working week still finishes', addBusinessDays(at('2026-11-04T12:00:00Z'), 3, { ...NY, workDays: [1] }) > at('2026-11-16T00:00:00Z'));
    ok('zones far from New York work', addBusinessHours(at('2026-11-04T00:00:00Z'), 4, { ...NY, timeZone: 'Asia/Kolkata' }) > at('2026-11-04T00:00:00Z'));
    ok('zones with half-hour daylight saving work', addBusinessHours(at('2026-10-04T00:00:00Z'), 4, { ...NY, timeZone: 'Australia/Lord_Howe' }) > at('2026-10-04T00:00:00Z'));
  } catch (e) {
    fail++;
    console.error(e);
  } finally {
    await wipe();
    ok('the real calendar and holidays are exactly as they were', await realSnapshot() === before);
    const left = await prisma.user.count({ where: { email: { startsWith: TAG } } }) + await prisma.agency.count({ where: { id: { in: cleanup.agencyIds } } }) + await prisma.deskHoliday.count({ where: { date: TEST_HOLIDAY } });
    ok('temporary records removed', left === 0);
    console.log(`\n${pass} passed, ${fail} failed`);
    await prisma.$disconnect();
    process.exit(fail ? 1 : 0);
  }
})();
