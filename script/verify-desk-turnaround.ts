/**
 * Module 42: turnaround by pod, person, agency and request type.
 *
 *   npx tsx script/verify-desk-turnaround.ts
 *
 * Each completed request measured in business time from when its clock
 * started to completion, less waiting (finished waits, and one still open at
 * completion); on target against the original commitment, for business-time
 * and expiration-tied targets; requests with no target; the median, average,
 * nine-in-ten and waiting figures; the breakdowns; what is left out
 * (cancelled, open, older, subtasks, agencies with The Desk off); the period,
 * type and agency filters; an Account Manager sees their own agencies only,
 * VAs and agencies are refused and it is logged; nothing private in the
 * answer; the display helpers; the route and the page. Against the shared
 * database with temporary agencies, people, pods and tasks, all removed at
 * the end.
 */
import 'dotenv/config';
import { readFileSync } from 'fs';
import type { Prisma, UserRole } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { DeskAccessError, resolveDeskScope, type DeskScope } from '../lib/desk/access';
import {
  TURNAROUND_DEFAULT_PERIOD, getTurnaround, measureTurnaround, turnaroundOptions, turnaroundStats, type Measured,
} from '../lib/desk/turnaround';
import { formatBusinessMinutes, onTargetLabel } from '../lib/desk/turnaround-view';
import { addBusinessMinutes, addCalendarDays, isBusinessDay, loadBusinessCalendar, zonedInstant, type BusinessCalendar } from '../lib/desk/business-time';
import { itemAllowed } from '../lib/desk/navigation';
import { TASK_TYPE_LABELS } from '../lib/desk/service-levels';

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, detail: unknown = '') => {
  c ? pass++ : fail++;
  console.log(`  ${c ? '✓' : '✗'} ${n}${!c && detail !== '' ? `  [${typeof detail === 'string' ? detail : JSON.stringify(detail)}]` : ''}`);
  if (!c && process.env.FAIL_FAST) throw new Error(`stopped at: ${n}`);
};

const TAG = `m42test${Date.now()}`;
const cleanup = { agencyIds: [] as string[], userIds: [] as string[], podIds: [] as string[] };
type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const read = (p: string) => readFileSync(p, 'utf8');

async function wipe() {
  const agencyId = { in: cleanup.agencyIds };
  await prisma.taskEvent.deleteMany({ where: { agencyId } });
  await prisma.task.updateMany({ where: { agencyId }, data: { parentTaskId: null } });
  await prisma.task.deleteMany({ where: { agencyId } });
  await prisma.agencyPodAccess.deleteMany({ where: { OR: [{ agencyId }, { podId: { in: cleanup.podIds } }] } });
  await prisma.podMember.deleteMany({ where: { podId: { in: cleanup.podIds } } });
  await prisma.pod.deleteMany({ where: { id: { in: cleanup.podIds } } });
  await prisma.agencyDeskAssignment.deleteMany({ where: { agencyId } });
  await prisma.deskAuditLog.deleteMany({ where: { OR: [{ agencyId }, { actorId: { in: cleanup.userIds } }] } });
  await prisma.session.deleteMany({ where: { userId: { in: cleanup.userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: cleanup.userIds } } });
  await prisma.agency.deleteMany({ where: { id: agencyId } });
}

const refused = async (fn: () => Promise<unknown>, status: number) => {
  try { await fn(); return false; } catch (err) { return err instanceof DeskAccessError && err.status === status; }
};

function pureLogic(cal: BusinessCalendar) {
  console.log('Measuring one request');
  let day = '2026-12-07';
  while (!isBusinessDay(day, cal)) day = addCalendarDays(day, 1);
  const start = zonedInstant(day, cal.dayStartMinute + 60, cal.timeZone);
  const at = (m: number) => addBusinessMinutes(start, m, cal);
  const bt = (applied = start, dueIn: number | null = 240) => ({ slaTarget: { kind: 'BUSINESS_TIME', appliedAt: applied.toISOString() }, slaDueAt: dueIn === null ? null : addBusinessMinutes(applied, dueIn, cal) });
  const base = { createdAt: start, slaPausedMinutes: 0, slaPausedAt: null };
  const m1 = measureTurnaround({ ...base, ...bt(), completedAt: at(120) }, cal);
  ok('worked in business time, no waiting: within its target', m1.worked === 120 && m1.waited === 0 && m1.met === true, m1);
  // Overnight: completed the next morning counts the business minutes only.
  const close = zonedInstant(day, cal.dayEndMinute - 30, cal.timeZone);
  let next = addCalendarDays(day, 1);
  while (!isBusinessDay(next, cal)) next = addCalendarDays(next, 1);
  const m2 = measureTurnaround({ ...base, createdAt: close, slaTarget: null, slaDueAt: null, completedAt: zonedInstant(next, cal.dayStartMinute + 30, cal.timeZone) }, cal);
  ok('across a night (or weekend): business minutes only, an hour', m2.worked === 60 && m2.met === null, m2);
  const m3 = measureTurnaround({ ...base, ...bt(), slaPausedMinutes: 400, completedAt: at(500) }, cal);
  ok('waiting taken out: done after the original due time, but within it once waiting is taken out', m3.worked === 100 && m3.waited === 400 && m3.met === true, m3);
  const m4 = measureTurnaround({ ...base, ...bt(), slaPausedMinutes: 300, completedAt: at(600) }, cal);
  ok('over the target even with waiting taken out: missed', m4.worked === 300 && m4.met === false, m4);
  ok('exactly on the target: met', measureTurnaround({ ...base, ...bt(), completedAt: at(240) }, cal).met === true
    && measureTurnaround({ ...base, ...bt(), completedAt: at(241) }, cal).met === false);
  const late = new Date(start.getTime() - 2 * 86_400_000);
  const m5 = measureTurnaround({ ...base, createdAt: late, ...bt(start, 120), completedAt: at(60) }, cal);
  ok('the clock started later (complete information): measured from then', m5.worked === 60 && m5.met === true, m5);
  const m6 = measureTurnaround({ ...base, ...bt(), slaPausedAt: at(30), completedAt: at(90) }, cal);
  ok('completed while still waiting: that wait counts too', m6.worked === 30 && m6.waited === 60, m6);
  const exp = { slaTarget: { kind: 'BEFORE_EXPIRATION', appliedAt: start.toISOString() }, slaDueAt: at(300) };
  const m7 = measureTurnaround({ ...base, ...exp, slaPausedMinutes: 1000, completedAt: at(1200) }, cal);
  ok('an expiration-tied target: missed when done after its date, whatever the waiting', m7.worked === 200 && m7.met === false, m7);
  ok('…met when done by its date', measureTurnaround({ ...base, ...exp, completedAt: at(60) }, cal).met === true);
  ok('no target: measured, not counted for or against', measureTurnaround({ ...base, slaTarget: null, slaDueAt: null, completedAt: at(30) }, cal).met === null);
  ok('waiting recorded beyond the time taken never makes it negative', measureTurnaround({ ...base, ...bt(), slaPausedMinutes: 999, completedAt: at(50) }, cal).worked === 0);
  ok('a broken start date falls back to when the request arrived', measureTurnaround({ ...base, slaTarget: { kind: 'BUSINESS_TIME', appliedAt: 'nonsense' }, slaDueAt: null, completedAt: at(45) }, cal).worked === 45);

  console.log('The figures');
  const ms = (xs: number[], met: (boolean | null)[] = [], waited: number[] = []) => xs.map((w, i): Measured => ({ worked: w, waited: waited[i] ?? 0, met: met[i] ?? null }));
  const odd = turnaroundStats(ms([30, 10, 20]));
  ok('the median of an odd number: the middle one', odd.median === 20 && odd.average === 20 && odd.completed === 3, odd);
  const even = turnaroundStats(ms([10, 20, 30, 41]));
  ok('the median of an even number: halfway between the two in the middle', even.median === 25, even);
  const ten = turnaroundStats(ms([1, 2, 3, 4, 5, 6, 7, 8, 9, 100]));
  ok('nine in ten were done within: the ninth of ten', ten.p90 === 9, ten);
  ok('…and of one, that one', turnaroundStats(ms([7])).p90 === 7);
  const tg = turnaroundStats(ms([1, 2, 3, 4], [true, false, null, true], [10, 0, 20, 30]));
  ok('on target: of those with a target only; waiting averaged over all', tg.withTarget === 3 && tg.met === 2 && tg.averageWaited === 15, tg);
  const none = turnaroundStats([]);
  ok('none completed: no figures, not zeros', none.completed === 0 && none.median === null && none.average === null && none.p90 === null && none.withTarget === 0);

  console.log('Showing the figures');
  ok('minutes, hours, working days', formatBusinessMinutes(45, 480) === '45 min' && formatBusinessMinutes(60, 480) === '1 h' && formatBusinessMinutes(200, 480) === '3 h 20 min'
    && formatBusinessMinutes(480, 480) === '1 d' && formatBusinessMinutes(1140, 480) === '2 d 3 h' && formatBusinessMinutes(null, 480) === '–' && formatBusinessMinutes(0, 480) === '0 min',
  [formatBusinessMinutes(200, 480), formatBusinessMinutes(1140, 480)]);
  ok('a working day is the calendar\'s, not 24 hours', formatBusinessMinutes(600, 600) === '1 d' && formatBusinessMinutes(600, 480) === '1 d 2 h');
  ok('on target as a share and a count; a dash without targets', onTargetLabel(46, 50) === '92% (46 of 50)' && onTargetLabel(0, 0) === '–' && onTargetLabel(0, 3) === '0% (0 of 3)');

  console.log('The choices');
  ok('the period: 7, 30, 90 or 365 days; 30 by default', turnaroundOptions({}).days === TURNAROUND_DEFAULT_PERIOD && TURNAROUND_DEFAULT_PERIOD === 30 && turnaroundOptions({ days: '90' }).days === 90);
  const bad = (p: Record<string, string>) => { try { turnaroundOptions(p); return false; } catch (err) { return err instanceof DeskAccessError && err.status === 400; } };
  ok('any other period, an unknown type or a malformed agency is refused, not guessed', bad({ days: '31' }) && bad({ days: 'all' }) && bad({ type: 'NOPE' }) && bad({ agencyId: 'x' }));
  ok('a known type and agency are taken', turnaroundOptions({ type: 'COI', agencyId: '6affb786458046fc5be689d4' }).type === 'COI');
}

(async () => {
  try {
    const cal = await loadBusinessCalendar(prisma);
    pureLogic(cal);

    // "Now": a working afternoon; the work started on a working morning five days before.
    let today = '2026-12-16';
    while (!isBusinessDay(today, cal)) today = addCalendarDays(today, 1);
    const now = zonedInstant(today, cal.dayStartMinute + 360, cal.timeZone);
    let startDay = addCalendarDays(today, -5);
    while (!isBusinessDay(startDay, cal)) startDay = addCalendarDays(startDay, 1);
    const start = zonedInstant(startDay, cal.dayStartMinute + 60, cal.timeZone);
    const at = (m: number, from = start) => addBusinessMinutes(from, m, cal);

    const mkAgency = async (n: string) => { const a = await prisma.agency.create({ data: { name: `${TAG} ${n}`, deskEnabled: true } }); cleanup.agencyIds.push(a.id); return a; };
    const mkUser = async (n: string, role: UserRole, agencyId: string | null = null) => {
      const u = await prisma.user.create({ data: { email: `${TAG}-${n}@example.test`, role, agencyId, firstName: `${TAG}${n}`, passwordHash: 'x', mustChangePassword: false } });
      cleanup.userIds.push(u.id); return u;
    };
    const A = await mkAgency('Harbor');
    const B = await mkAgency('Basin');
    const C = await mkAgency('Cove');
    const owner = await mkUser('owner', 'ADMIN', A.id);
    const am = await mkUser('am', 'ACCOUNT_MANAGER');
    const amB = await mkUser('amb', 'ACCOUNT_MANAGER');
    const ops = await mkUser('ops', 'DESK_ADMIN');
    const va1 = await mkUser('vaone', 'DESK_VA');
    const va2 = await mkUser('vatwo', 'DESK_VA');
    // am manages Harbor and Cove; amB manages Basin.
    await prisma.agencyDeskAssignment.createMany({ data: [{ agencyId: A.id, primaryAmId: am.id }, { agencyId: C.id, primaryAmId: am.id }, { agencyId: B.id, primaryAmId: amB.id }] });
    const mkPod = async (n: string, i: number) => { const p = await prisma.pod.create({ data: { code: `${TAG}${n}`, name: `${TAG} ${n}`, sortOrder: 990 + i } }); cleanup.podIds.push(p.id); return p; };
    const P1 = await mkPod('North', 1);
    const P2 = await mkPod('South', 2);
    await prisma.podMember.createMany({ data: [{ podId: P1.id, userId: va1.id }, { podId: P2.id, userId: va2.id }] });
    await prisma.agencyPodAccess.createMany({ data: [{ agencyId: A.id, podId: P1.id }, { agencyId: A.id, podId: P2.id }] });

    const base = Date.now() % 40_000_000;
    let n = 0;
    const target = (dueIn: number | null, kind = 'BUSINESS_TIME', applied = start) => ({
      slaTarget: { kind, appliedAt: applied.toISOString() } as Prisma.InputJsonValue,
      slaDueAt: dueIn === null ? null : addBusinessMinutes(applied, dueIn, cal),
    });
    const mkTask = (title: string, data: Partial<Prisma.TaskUncheckedCreateInput>) => {
      n += 1;
      return prisma.task.create({ data: {
        reference: 956_000_000 + base + n, agencyId: A.id, type: 'COI', title: `${TAG} ${title}`, description: `${TAG} secret details`,
        amId: am.id, createdById: owner.id, status: 'COMPLETED', createdAt: start, restrictedToUserIds: [], ...data,
      } });
    };
    // Harbor's completed requests: [worked, waited, met] noted on each.
    const t1 = await mkTask('t1', { podId: P1.id, assigneeId: va1.id, ...target(240), completedAt: at(120) }); // 120, 0, met
    await mkTask('t2', { podId: P1.id, assigneeId: va1.id, ...target(240), slaPausedMinutes: 300, completedAt: at(600) }); // 300, 300, missed
    await mkTask('t3', { podId: P2.id, assigneeId: va2.id, type: 'ENDORSEMENT', ...target(240), slaPausedMinutes: 400, completedAt: at(500) }); // 100, 400, met
    await mkTask('t4', { podId: P2.id, assigneeId: va2.id, type: 'RENEWAL', ...target(300, 'BEFORE_EXPIRATION'), completedAt: at(60) }); // 60, 0, met
    await mkTask('t5', { podId: P2.id, assigneeId: va2.id, type: 'RENEWAL', ...target(300, 'BEFORE_EXPIRATION'), slaPausedMinutes: 1000, completedAt: at(1200) }); // 200, 1000, missed
    await mkTask('t6', { type: 'OTHER', completedAt: at(30) }); // 30, 0, no target; no pod, nobody assigned
    const early = new Date(start.getTime() - 2 * 86_400_000);
    await mkTask('t7', { podId: P1.id, assigneeId: va1.id, createdAt: early, ...target(120), completedAt: at(60) }); // 60, 0, met (clock started later)
    await mkTask('t8', { podId: P2.id, assigneeId: va2.id, type: 'ENDORSEMENT', ...target(240), slaPausedAt: at(30), completedAt: at(90) }); // 30, 60, met
    // Left out at 30 days.
    await mkTask('cancelled', { status: 'CANCELLED', cancelledAt: at(10), completedAt: at(10), podId: P1.id, assigneeId: va1.id });
    await mkTask('open', { status: 'IN_PROGRESS', podId: P1.id, assigneeId: va1.id });
    await mkTask('subtask', { parentTaskId: t1.id, podId: P1.id, assigneeId: va1.id, ...target(240), completedAt: at(30) });
    const old = zonedInstant(addCalendarDays(today, -45), cal.dayStartMinute + 60, cal.timeZone);
    await mkTask('older', { podId: P1.id, assigneeId: va1.id, createdAt: old, ...target(240, 'BUSINESS_TIME', old), completedAt: addBusinessMinutes(old, 90, cal) });
    await mkTask('after now', { podId: P1.id, assigneeId: va1.id, completedAt: new Date(now.getTime() + 3_600_000) });
    // Other agencies.
    await mkTask('basin', { agencyId: B.id, amId: amB.id, ...target(240), completedAt: at(45) });
    await mkTask('cove', { agencyId: C.id, ...target(240), completedAt: at(45) });
    await prisma.agency.update({ where: { id: C.id }, data: { deskEnabled: false } });

    const scope = (u: { id: string }) => resolveDeskScope(prisma, u.id);
    const [sAm, sAmB, sOps, sVa, sOwner] = await Promise.all([am, amB, ops, va1, owner].map(scope));
    const report = (s: DeskScope, o: Parameters<typeof getTurnaround>[2] = {}) => getTurnaround(prisma, s, { now, ...o });

    console.log('The report, for an Account Manager');
    const r = await report(sAm);
    const tot = r.total;
    ok('their completed requests in the last 30 days, and only those', tot.completed === 8, tot);
    ok('typical (median), average and nine in ten, in business minutes worked', tot.median === 80 && tot.average === 113 && tot.p90 === 300, tot);
    ok('on target: 5 of the 7 with a target', tot.withTarget === 7 && tot.met === 5, tot);
    ok('waiting, on average: shown, and taken out of the times', tot.averageWaited === 220, tot.averageWaited);
    const row = (rows: Json[], name: string) => rows.find((x) => x.name === name);
    const p1 = row(r.pods, `${TAG} North`), p2 = row(r.pods, `${TAG} South`), np = row(r.pods, 'No pod');
    ok('by pod: each pod\'s requests, and those with no pod', p1?.completed === 3 && p2?.completed === 4 && np?.completed === 1 && r.pods.length === 3, r.pods.map((x: Json) => [x.name, x.completed]));
    ok('…with its own figures', p1.median === 120 && p1.met === 2 && p1.withTarget === 3 && p2.median === 80 && p2.met === 3 && p2.withTarget === 4 && np.withTarget === 0, [p1, p2]);
    ok('…the busiest first', r.pods[0].name === `${TAG} South`);
    const v1 = row(r.people, `${TAG}vaone`), v2 = row(r.people, `${TAG}vatwo`);
    ok('by person: each VA, and the requests nobody was assigned', v1?.completed === 3 && v1.kind === 'VA' && v2?.completed === 4 && row(r.people, 'Nobody assigned')?.completed === 1, r.people.map((x: Json) => [x.name, x.completed]));
    ok('…measured by who completed it (the assignee), with their figures', v1.average === 160 && v2.average === 98 && v2.averageWaited === 365, [v1, v2]);
    ok('by agency: only theirs; Basin isn\'t theirs and Cove has The Desk off', r.agencies.length === 1 && r.agencies[0].name === `${TAG} Harbor` && r.agencies[0].completed === 8, r.agencies.map((x: Json) => x.name));
    const ty = (k: string) => r.types.find((x: Json) => x.id === k);
    ok('by request type, with plain names', ty('COI')?.completed === 3 && ty('COI')?.name === TASK_TYPE_LABELS.COI && ty('ENDORSEMENT')?.name === TASK_TYPE_LABELS.ENDORSEMENT, r.types.map((x: Json) => [x.name, x.completed]));
    ok('…each type its own figures', ty('ENDORSEMENT')?.completed === 2 && ty('RENEWAL')?.completed === 2 && ty('RENEWAL')?.met === 1 && ty('OTHER')?.withTarget === 0, r.types);
    ok('left out: cancelled, still open, subtasks, older, and anything after the period', !r.types.some((x: Json) => x.completed > 3) && tot.completed === 8);
    ok('the agencies they may filter by: their own with The Desk on', r.agencyChoices.map((a) => a.name).join() === `${TAG} Harbor`, r.agencyChoices);
    ok('the period and the calendar, to read the figures by', r.period.days === 30 && r.period.to === now.toISOString() && r.calendar.workdayMinutes > 0 && !r.truncated);

    console.log('Choosing');
    ok('90 days: the older request too', (await report(sAm, { days: 90 })).total.completed === 9);
    ok('7 days: only this week\'s', (await report(sAm, { days: 7 })).total.completed === 8);
    const coi = await report(sAm, { type: 'COI' });
    ok('one request type', coi.total.completed === 3 && coi.types.length === 1, coi.total);
    ok('another Account Manager\'s agency, asked for by id: nothing', (await report(sAm, { agencyId: B.id })).total.completed === 0);
    ok('their own agency, by id', (await report(sAm, { agencyId: A.id })).total.completed === 8);

    console.log('Who may see it');
    const rB = await report(sAmB);
    ok('the other Account Manager: their own agency only', rB.total.completed === 1 && rB.agencies.map((a) => a.name).join() === `${TAG} Basin`, rB.agencies);
    const rOps = await report(sOps, { agencyId: B.id });
    ok('an Operations Manager: any agency', rOps.total.completed === 1 && (await report(sOps, { agencyId: A.id })).total.completed === 8);
    const rOpsAll = await report(sOps);
    ok('…and all of them together; the agency switched off still left out', [A.id, B.id].every((id) => rOpsAll.agencies.some((a) => a.id === id)) && !rOpsAll.agencies.some((a) => a.id === C.id)
      && rOpsAll.agencyChoices.some((a) => a.id === B.id));
    ok('…and offered every agency to filter by, except those with The Desk off', rOpsAll.agencyChoices.some((a) => a.id === A.id) && !rOpsAll.agencyChoices.some((a) => a.id === C.id));
    ok('a VA is refused, as if there were nothing here (Q4)', await refused(() => report(sVa), 404));
    ok('an agency user is refused: targets are internal (Q5)', await refused(() => report(sOwner), 404));
    const denied = await prisma.deskAuditLog.findMany({ where: { actorId: { in: [va1.id, owner.id] }, action: 'access.denied' } });
    ok('…and each refusal is logged', denied.length === 2 && denied.every((d) => (d.metadata as Json).op === 'turnaround'), denied.map((d) => d.metadata));
    const text = JSON.stringify(r);
    ok('counts and times only: no request titles, text or references', !text.includes(`${TAG} t1`) && !text.includes('secret details') && !text.includes(String(t1.reference)) && !text.includes('"title"'));

    console.log('The code');
    const route = read('app/api/desk/turnaround/route.ts');
    ok('the route: any signed-in Desk user, then the managers-only check; the choices read strictly', route.includes('deskUserRequest(prisma, request)') && route.includes('turnaroundOptions(') && route.includes('getTurnaround(prisma, scope, opts, ctx)'));
    ok('the report refuses non-managers before reading anything', read('lib/desk/turnaround.ts').includes("await managersOnly(db, scope, ctx, 'turnaround');"));
    ok('the Turnaround page: Account and Operations Managers, not VAs or agencies', ['ACCOUNT_MANAGER', 'DESK_ADMIN', 'SUPER_ADMIN'].every((role) => itemAllowed('/desk-ops/metrics', role))
      && !['DESK_VA', 'ADMIN'].some((role) => itemAllowed('/desk-ops/metrics', role)));
    const page = read('app/(desk)/desk-ops/metrics/page.tsx');
    const view = read('app/components/desk/turnaround/TurnaroundView.tsx');
    ok('the page is built (no longer a placeholder), and checks access first', page.includes('<TurnaroundView />') && page.includes("deskPageAccess('OPS', '/desk-ops/metrics')") && !page.includes('DeskPage '));
    ok('the screen: period, type and agency; figures; the four breakdowns', ['desk-turnaround-period', 'desk-turnaround-type', 'desk-turnaround-agency', 'desk-turnaround-total-${id}', "'on-target'", "'p90'", "'waited'",
      'desk-turnaround-pods', 'desk-turnaround-people', 'desk-turnaround-agencies', 'desk-turnaround-types'].every((id) => view.includes(id)));
    ok('…and says the times are business time less waiting, and the targets internal', view.includes('waiting on the agency, carrier or insured taken out') && view.includes('Targets are internal'));
  } catch (err) {
    fail++;
    console.error(err);
  } finally {
    await wipe();
    const leftUsers = await prisma.user.count({ where: { email: { startsWith: TAG } } });
    const leftTasks = await prisma.task.count({ where: { title: { startsWith: TAG } } });
    const leftAgencies = await prisma.agency.count({ where: { name: { startsWith: TAG } } });
    const leftPods = await prisma.pod.count({ where: { code: { startsWith: TAG } } });
    ok('nothing left behind', leftUsers + leftTasks + leftAgencies + leftPods === 0, [leftUsers, leftTasks, leftAgencies, leftPods]);
    await prisma.$disconnect();
    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
  }
})();
