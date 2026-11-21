/**
 * Module 41: overdue alerts and the escalation ladder.
 *
 *   npx tsx script/verify-desk-alerts.ts
 *
 * The rungs in business time (due soon, overdue, escalated) and their
 * edges; who is told at each (the task's Account Manager, the agency's, the
 * Operations Managers); once per due date, again when the date moves; work
 * waiting, closed or without a date left alone; a check that finds work
 * several rungs up; two checks at once; the automatic escalation, never over
 * a manager's; nothing private in an email, nothing for agencies, VAs not
 * told who; the history and the audit; the run record; a manual escalation's
 * email; the schedule's settings, the scheduler route and its secret; the
 * screens. Against the shared database with temporary agencies, people and
 * tasks, all removed at the end. The check is limited to the test agencies,
 * and no email is sent: a stand-in sender takes them.
 */
import 'dotenv/config';
import { readFileSync } from 'fs';
import { NextRequest } from 'next/server';
import type { Prisma, TaskEventKind, UserRole } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { resolveDeskScope } from '../lib/desk/access';
import { getTaskDetail, setTaskEscalation } from '../lib/desk/task-api';
import { setNotificationSender } from '../lib/desk/notifications';
import {
  ALERT_ESCALATE_MINUTES, ALERT_SOON_MINUTES, AUTO_ESCALATION_REASON, lastAlertRun, rungFor, rungSent, runAlertCheck,
} from '../lib/desk/alerts';
import { checkIntervalMinutes, cronSecret, isSchedulerRequest } from '../lib/desk/alert-schedule';
import { addBusinessMinutes, addCalendarDays, isBusinessDay, loadBusinessCalendar, zonedInstant, type BusinessCalendar } from '../lib/desk/business-time';
import { eventLines, eventTitle } from '../lib/desk/task-workspace';
import { getWorkload } from '../lib/desk/workload';
import { GET as cronGet, POST as cronPost } from '../app/api/desk/cron/alerts/route';

// Nothing here may reach a real inbox.
process.env.RESEND_API_KEY = '';
delete process.env.DESK_EMAIL_NOTIFICATIONS;

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, detail: unknown = '') => {
  c ? pass++ : fail++;
  console.log(`  ${c ? '✓' : '✗'} ${n}${!c && detail !== '' ? `  [${typeof detail === 'string' ? detail : JSON.stringify(detail)}]` : ''}`);
  if (!c && process.env.FAIL_FAST) throw new Error(`stopped at: ${n}`);
};

const TAG = `m41test${Date.now()}`;
const JOB = `${TAG}-job`;
const cleanup = { agencyIds: [] as string[], userIds: [] as string[], podIds: [] as string[] };
type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const read = (p: string) => readFileSync(p, 'utf8');

interface Mail { to: string; subject: string; html: string; text?: string }
const outbox: Mail[] = [];
let senderMode: 'ok' | 'throw' = 'ok';
setNotificationSender(async (p) => {
  outbox.push(p);
  if (senderMode === 'throw') throw new Error('provider down');
  return { ok: true, id: `stub-${outbox.length}` };
});
const take = () => outbox.splice(0, outbox.length);
/** Only the test people: the real Operations Managers are told too, and left out of the comparisons. */
const ours = (mails: Mail[]) => mails.map((m) => m.to).filter((t) => t.startsWith(TAG)).map((t) => t.slice(TAG.length + 1).replace('@example.test', '')).sort();

async function wipe() {
  const agencyId = { in: cleanup.agencyIds };
  await prisma.deskNotification.deleteMany({ where: { OR: [{ agencyId }, { recipientId: { in: cleanup.userIds } }] } });
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
  await prisma.deskJobRun.deleteMany({ where: { id: { startsWith: TAG } } });
}

/** A working day with a working day before it, and 11:00 on it. */
function testMorning(cal: BusinessCalendar) {
  let date = '2026-12-02';
  while (!(isBusinessDay(date, cal) && isBusinessDay(addCalendarDays(date, -1), cal))) date = addCalendarDays(date, 1);
  return { date, now: zonedInstant(date, cal.dayStartMinute + 120, cal.timeZone) };
}

function pureLogic(cal: BusinessCalendar) {
  console.log('The rungs');
  const { date, now } = testMorning(cal);
  const later = (m: number) => addBusinessMinutes(now, m, cal);
  const ago = (m: number) => new Date(now.getTime() - m * 60_000);
  ok('plenty of time: no rung', rungFor(now, later(ALERT_SOON_MINUTES + 1), cal) === 0);
  ok(`${ALERT_SOON_MINUTES / 60} business hours or less left: due soon`, rungFor(now, later(ALERT_SOON_MINUTES), cal) === 1 && rungFor(now, later(1), cal) === 1);
  ok('due this very minute: still due soon, not overdue', rungFor(now, now, cal) === 1);
  ok('a minute past: overdue', rungFor(now, ago(1), cal) === 2);
  const yesterday = zonedInstant(addCalendarDays(date, -1), cal.dayStartMinute + 120, cal.timeZone);
  ok('a working day overdue: escalate', rungFor(now, yesterday, cal) === 3);
  // Business time: due at closing, checked the next morning before opening, is barely overdue.
  const close = zonedInstant(addCalendarDays(date, -1), cal.dayEndMinute, cal.timeZone);
  const beforeOpening = zonedInstant(date, cal.dayStartMinute - 60, cal.timeZone);
  ok('overdue overnight counts no business time: overdue, not escalated', rungFor(beforeOpening, close, cal) === 2);
  const fourHoursIn = zonedInstant(date, cal.dayStartMinute + ALERT_ESCALATE_MINUTES, cal.timeZone);
  ok(`${ALERT_ESCALATE_MINUTES / 60} business hours after that: escalate`, rungFor(fourHoursIn, close, cal) === 3 && rungFor(new Date(fourHoursIn.getTime() - 60_000), close, cal) === 2);
  // Due Monday morning, checked Friday evening: one business hour left, not days.
  ok('due soon across a night: counted in business time', rungFor(zonedInstant(addCalendarDays(date, -1), cal.dayEndMinute - 30, cal.timeZone), zonedInstant(date, cal.dayStartMinute + 30, cal.timeZone), cal) === 1);
  const d = new Date('2026-12-01T15:00:00Z');
  ok('the rung sent counts only for the same due date', rungSent({ dueAt: d, alertDueAt: d, alertLevel: 2 }) === 2
    && rungSent({ dueAt: new Date(d.getTime() + 1), alertDueAt: d, alertLevel: 2 }) === 0
    && rungSent({ dueAt: d, alertDueAt: null, alertLevel: null }) === 0 && rungSent({ dueAt: null, alertDueAt: d, alertLevel: 3 }) === 0);

  console.log('The schedule settings');
  ok('the interval: whole minutes, 5 to 1440; anything else is off', checkIntervalMinutes('15') === 15 && checkIntervalMinutes(' 5 ') === 5 && checkIntervalMinutes('1440') === 1440
    && [undefined, '', '4', '1441', '7.5', 'ten', '-15'].every((v) => checkIntervalMinutes(v) === null));
  const secret = 'a'.repeat(24);
  ok('a secret under 24 characters counts as not set', cronSecret('short') === null && cronSecret('') === null && cronSecret(undefined) === null && cronSecret(` ${secret} `) === secret);
  ok('the scheduler is known by "Bearer <secret>" only', isSchedulerRequest(`Bearer ${secret}`, secret)
    && !isSchedulerRequest(`Bearer ${secret}x`, secret) && !isSchedulerRequest(secret, secret) && !isSchedulerRequest(null, secret)
    && !isSchedulerRequest('Bearer ', secret) && !isSchedulerRequest(`Bearer ${secret}`, null));
}

(async () => {
  try {
    const cal = await loadBusinessCalendar(prisma);
    pureLogic(cal);
    const { date, now } = testMorning(cal);
    const hoursLater = (h: number) => new Date(now.getTime() + h * 3_600_000);

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
    const left = await mkUser('left', 'ACCOUNT_MANAGER');
    const ops = await mkUser('ops', 'DESK_ADMIN');
    const va = await mkUser('va', 'DESK_VA');
    await prisma.user.update({ where: { id: left.id }, data: { isActive: false } });
    // Harbor's AM is am; Basin's is amB; Cove has none.
    await prisma.agencyDeskAssignment.createMany({ data: [{ agencyId: A.id, primaryAmId: am.id }, { agencyId: B.id, primaryAmId: amB.id }] });
    const pod = await prisma.pod.create({ data: { code: `${TAG}P`, name: `${TAG} Pod`, sortOrder: 990 } });
    cleanup.podIds.push(pod.id);
    await prisma.podMember.create({ data: { podId: pod.id, userId: va.id } });
    await prisma.agencyPodAccess.create({ data: { agencyId: A.id, podId: pod.id, userId: va.id } });
    const scope = (u: { id: string }) => resolveDeskScope(prisma, u.id);
    const [sOwner, sAm, sOps, sVa] = await Promise.all([owner, am, ops, va].map(scope));
    const realRunBefore = JSON.stringify(await prisma.deskJobRun.findUnique({ where: { id: 'alerts' } }));
    const realOps = await prisma.user.count({ where: { role: 'DESK_ADMIN', isActive: true, id: { not: ops.id } } });

    const base = Date.now() % 40_000_000;
    let n = 0;
    const mkTask = (title: string, data: Partial<Prisma.TaskUncheckedCreateInput> = {}) => {
      n += 1;
      return prisma.task.create({ data: {
        reference: 955_000_000 + base + n, agencyId: A.id, type: 'COI', title: `${TAG} ${title}`, description: `${TAG} secret details`,
        amId: am.id, createdById: owner.id, status: 'IN_PROGRESS', assigneeId: va.id, podId: pod.id, restrictedToUserIds: [], ...data,
      } });
    };
    const row = (id: string) => prisma.task.findUniqueOrThrow({ where: { id } });
    const eventsOf = (taskId: string, kind: TaskEventKind) => prisma.taskEvent.findMany({ where: { taskId, kind }, orderBy: { createdAt: 'asc' } });
    const check = (at: Date, agencyIds = cleanup.agencyIds) => runAlertCheck(prisma, { now: at, agencyIds, jobId: JOB });
    const yesterday = zonedInstant(addCalendarDays(date, -1), cal.dayStartMinute + 120, cal.timeZone);

    const far = await mkTask('far', { dueAt: addBusinessMinutes(now, 600, cal) });
    const soon = await mkTask('soon', { dueAt: addBusinessMinutes(now, 60, cal) });
    const late = await mkTask('late', { dueAt: new Date(now.getTime() - 30 * 60_000) });
    const long = await mkTask('long', { dueAt: yesterday });
    const manual = await mkTask('manual', { dueAt: yesterday, escalated: true, escalatedAt: yesterday, escalationReason: `${TAG} the carrier is stuck` });
    const waiting = await mkTask('waiting', { dueAt: yesterday, status: 'WAITING_ON_CARRIER', slaPausedAt: yesterday });
    const done = await mkTask('done', { dueAt: yesterday, status: 'COMPLETED', completedAt: yesterday });
    const cancelled = await mkTask('cancelled', { dueAt: yesterday, status: 'CANCELLED', cancelledAt: yesterday });
    const undated = await mkTask('undated');
    const noAm = await mkTask('agency am', { dueAt: new Date(now.getTime() - 30 * 60_000), amId: null });
    const wrongAm = await mkTask('wrong am', { dueAt: new Date(now.getTime() - 30 * 60_000), amId: amB.id });
    const goneAm = await mkTask('gone am', { agencyId: B.id, dueAt: new Date(now.getTime() - 30 * 60_000), amId: left.id });
    const nobody = await mkTask('nobody', { agencyId: C.id, dueAt: new Date(now.getTime() - 30 * 60_000), amId: null });

    // ── The first check ──
    console.log('The first check');
    take();
    const r1 = await check(now);
    const mails1 = take();
    ok('it ran, and counted what it did', r1.ran && r1.dueSoon === 1 && r1.overdue === 5 && r1.escalated === 2 && r1.autoEscalated === 1 && r1.failed === 0, r1);
    ok('it looked only at work due soon or sooner, still open and not waiting', r1.checked === 8, r1.checked);
    const byTask = (t: { reference: number }) => mails1.filter((m) => m.subject.includes(`#${t.reference} `));
    ok('due soon: the task\'s Account Manager', ours(byTask(soon)).join() === 'am' && byTask(soon).length === 1 && byTask(soon)[0].subject === `Request #${soon.reference} is due soon`, byTask(soon).map((m) => m.to));
    ok('overdue: the task\'s Account Manager', ours(byTask(late)).join() === 'am' && byTask(late).length === 1 && byTask(late)[0].subject === `Request #${late.reference} is overdue`);
    ok('no AM on the task: the agency\'s', ours(byTask(noAm)).join() === 'am' && byTask(noAm).length === 1);
    ok('the task\'s AM can\'t open it (another agency\'s): the agency\'s AM instead', ours(byTask(wrongAm)).join() === 'am' && byTask(wrongAm).length === 1, ours(byTask(wrongAm)));
    ok('the task\'s AM has left: the agency\'s instead', ours(byTask(goneAm)).join() === 'amb' && byTask(goneAm).length === 1, ours(byTask(goneAm)));
    ok('no AM anywhere: the Operations Managers', ours(byTask(nobody)).join() === 'ops' && byTask(nobody).length === 1 + realOps);
    ok('long overdue, first seen now: the Operations Managers, and the AM too, as nobody told them it was overdue',
      ours(byTask(long)).join() === 'am,ops' && byTask(long).length === 2 + realOps && byTask(long).every((m) => m.subject === `Request #${long.reference} is escalated: overdue`), ours(byTask(long)));
    ok('nothing for work with time left, waiting, closed or with no date', [far, waiting, done, cancelled, undated].every((t) => byTask(t).length === 0));
    ok('the VA holding it is not emailed; nor the agency', !mails1.some((m) => m.to.includes('-va@') || m.to.includes('-owner@')));
    const all = mails1.map((m) => m.subject + m.html + (m.text ?? '')).join(' ');
    ok('no title, request text or reason in an email (Q4)', ['far', 'soon', 'late', 'long', 'manual', 'agency am', 'wrong am', 'gone am', 'nobody'].every((x) => !all.includes(`${TAG} ${x}`))
      && !all.includes('secret details') && !all.includes('stuck') && all.includes(`${TAG} Harbor`));
    ok('no due date or time in an email', !/\b(AM|PM)\b|\d{1,2}:\d{2}|Dec(ember)?\s\d/.test(mails1.map((m) => m.text ?? '').join(' ')));
    ok('the email says the target is internal, and links to the task', byTask(late)[0].text?.includes('internal target') === true && byTask(late)[0].html.includes(`/desk-ops/tasks/${late.id}`));

    const tl = await row(long.id);
    ok('long overdue: escalated automatically, with the reason', tl.escalated && tl.escalationReason === AUTO_ESCALATION_REASON && tl.escalatedAt?.getTime() === now.getTime() && tl.alertLevel === 3 && tl.alertDueAt?.getTime() === yesterday.getTime());
    const tm = await row(manual.id);
    ok('a manager\'s escalation is kept as it was, reason and time', tm.escalated && tm.escalationReason === `${TAG} the carrier is stuck` && tm.escalatedAt?.getTime() === yesterday.getTime() && tm.alertLevel === 3);
    ok('…and no second "escalated" in its history', (await eventsOf(manual.id, 'ESCALATED')).length === 0 && (await eventsOf(long.id, 'ESCALATED')).length === 1);
    ok('each task remembers the rung, for its due date', (await row(soon.id)).alertLevel === 1 && (await row(late.id)).alertLevel === 2 && (await row(far.id)).alertLevel === null);
    ok('the clock is not touched: last activity stays', (await row(long.id)).lastActivityAt.getTime() === long.lastActivityAt.getTime());

    const ev = (await eventsOf(late.id, 'ALERTED'))[0];
    ok('its history: an internal alert, by nobody, and how many were told', !!ev && ev.actorId === null && ev.visibility === 'INTERNAL' && ev.body === null
      && (ev.metadata as Json).automatic === 'overdue' && (ev.metadata as Json).sentTo === 1, ev);
    const esc = (await eventsOf(long.id, 'ESCALATED'))[0];
    ok('the automatic escalation in the history, the reason in the details', esc.actorId === null && esc.body === null && (esc.metadata as Json).automatic === 'overdue' && (esc.metadata as Json).reason === AUTO_ESCALATION_REASON);
    const audit = await prisma.deskAuditLog.findMany({ where: { entityId: long.id }, orderBy: { createdAt: 'asc' } });
    ok('audited: the alert and the escalation, by nobody, without a reason', audit.some((a) => a.action === 'task.alerted' && a.actorId === null && (a.metadata as Json).rung === 'escalated')
      && audit.some((a) => a.action === 'task.escalated' && a.actorId === null && (a.metadata as Json).automatic === 'overdue' && !('reason' in (a.metadata as Json))), audit.map((a) => a.action));
    const recorded = await prisma.deskNotification.findMany({ where: { taskId: { in: [soon.id, late.id, long.id] } } });
    ok('each email recorded, by kind', recorded.filter((x) => x.event === 'TASK_DUE_SOON').length === 1 && recorded.filter((x) => x.event === 'TASK_OVERDUE').length === 1
      && recorded.filter((x) => x.event === 'TASK_ESCALATED').length === 2 + realOps && recorded.every((x) => x.status === 'SENT'));

    console.log('What each person sees');
    const opsView = (await getTaskDetail(prisma, sOps, long.id) as Json).events;
    const vaView = (await getTaskDetail(prisma, sVa, long.id) as Json).events;
    const opsAlert = opsView.find((e: Json) => e.kind === 'ALERTED');
    const vaAlert = vaView.find((e: Json) => e.kind === 'ALERTED');
    ok('managers read the rung and how many were told', eventTitle(opsAlert) === 'Escalation alert sent to the Operations Managers' && eventLines(opsAlert).join() === `Emailed ${2 + realOps} people`, eventLines(opsAlert));
    ok('a VA reads that an alert went out, not to how many (Q4)', eventTitle(vaAlert) === 'Escalation alert sent to the Operations Managers' && !('sentTo' in vaAlert.details) && eventLines(vaAlert).length === 0);
    const vaEsc = vaView.find((e: Json) => e.kind === 'ESCALATED');
    ok('a VA reads "escalated automatically", never why', eventTitle(vaEsc) === 'Escalated automatically: overdue' && !('reason' in vaEsc.details) && eventLines(vaEsc).length === 0);
    ok('the other rungs\' titles', eventTitle({ kind: 'ALERTED', details: { automatic: 'due_soon' } } as Json) === 'Due-soon alert sent'
      && eventTitle({ kind: 'ALERTED', details: { automatic: 'overdue' } } as Json) === 'Overdue alert sent'
      && eventLines({ kind: 'ALERTED', details: { sentTo: 0 } } as Json).join() === 'Nobody could be emailed' && eventLines({ kind: 'ALERTED', details: { sentTo: 1 } } as Json).join() === 'Emailed 1 person');
    const agencyView = await getTaskDetail(prisma, sOwner, long.id) as Json;
    ok('the agency sees no alert and no escalation (Q5)', !agencyView.events.some((e: Json) => ['ALERTED', 'ESCALATED'].includes(e.kind)) && !('escalated' in agencyView) && !JSON.stringify(agencyView).includes('verdue'), Object.keys(agencyView));

    // ── Again, and later ──
    console.log('Once per rung');
    const r2 = await check(now);
    ok('the same check again: nothing new is sent', r2.ran && r2.dueSoon + r2.overdue + r2.escalated === 0 && take().length === 0, r2);
    const r3 = await check(hoursLater(1.5));
    const mails3 = take();
    ok('later: due soon has become overdue, and the AM is told', ours(mails3.filter((m) => m.subject.includes(`#${soon.reference} `))).join() === 'am' && (await row(soon.id)).alertLevel === 2, r3);
    ok('…nothing else moved up a rung yet', r3.overdue === 1 && r3.escalated === 0 && mails3.length === 1, mails3.map((m) => m.subject));
    const r4 = await check(hoursLater(5));
    const mails4 = take();
    const lateMails = mails4.filter((m) => m.subject.includes(`#${late.reference} `));
    ok('overdue long enough: the Operations Managers, not the AM again (they were told)', ours(lateMails).join() === 'ops' && lateMails.length === 1 + realOps, ours(lateMails));
    ok('…and escalated automatically', (await row(late.id)).escalated && (await row(late.id)).alertLevel === 3 && r4.autoEscalated >= 1);
    const r5 = await check(hoursLater(30));
    const mails5 = take();
    ok('a day later, only the task that had time left climbs: straight to escalated, the AM told too', r5.escalated === 1 && r5.dueSoon + r5.overdue === 0
      && mails5.every((m) => m.subject === `Request #${far.reference} is escalated: overdue`) && ours(mails5).join() === 'am,ops' && (await row(far.id)).alertLevel === 3, r5);
    const r5b = await check(hoursLater(30));
    ok('…then nothing more is sent for any of them', r5b.dueSoon + r5b.overdue + r5b.escalated === 0 && take().length === 0, r5b);

    console.log('A new due date starts again');
    await prisma.task.update({ where: { id: long.id }, data: { dueAt: addBusinessMinutes(now, 600, cal) } });
    ok('moved well out: nothing yet', (await check(now)).dueSoon === 0 && take().length === 0);
    await prisma.task.update({ where: { id: long.id }, data: { dueAt: addBusinessMinutes(now, 30, cal) } });
    const r6 = await check(now);
    const mails6 = take();
    ok('moved close: due soon again, to the AM', r6.dueSoon === 1 && ours(mails6).join() === 'am' && (await row(long.id)).alertLevel === 1, r6);
    ok('…it is still escalated from before: the ladder does not clear an escalation', (await row(long.id)).escalated);
    await prisma.task.update({ where: { id: waiting.id }, data: { status: 'IN_PROGRESS', slaPausedAt: null, dueAt: new Date(now.getTime() - 10 * 60_000) } });
    const r7 = await check(now);
    ok('a wait ended and its date is past: overdue, to the AM', r7.overdue === 1 && ours(take()).join() === 'am' && (await row(waiting.id)).alertLevel === 2, r7);

    console.log('Two checks at once');
    const twin = await mkTask('twin', { dueAt: new Date(now.getTime() - 30 * 60_000) });
    take();
    const [ra, rb] = await Promise.all([check(now), check(now)]);
    const twinMails = take().filter((m) => m.subject.includes(`#${twin.reference} `));
    ok('one alert, sent once', ra.overdue + rb.overdue === 1 && twinMails.length === 1 && (await eventsOf(twin.id, 'ALERTED')).length === 1, [ra.overdue, rb.overdue, twinMails.length]);

    // The same database, with one call swapped: a check that read the task before another check climbed it, or a write that fails.
    const swapped = (model: 'task' | 'taskEvent', method: string, fn: (...a: unknown[]) => unknown) => new Proxy(prisma, {
      get(target, prop) {
        const v = Reflect.get(target, prop, target);
        if (prop === model) return new Proxy(v as object, { get(m, p) { const f = Reflect.get(m, p, m); return p === method ? fn : typeof f === 'function' ? f.bind(m) : f; } });
        return typeof v === 'function' ? v.bind(target) : v;
      },
    }) as typeof prisma;
    const stale = await mkTask('stale', { dueAt: new Date(now.getTime() - 30 * 60_000) });
    const staleRead = await prisma.task.findMany({ where: { id: stale.id } });
    await check(now);
    take();
    const rStale = await runAlertCheck(swapped('task', 'findMany', async () => staleRead), { now, agencyIds: cleanup.agencyIds, jobId: JOB });
    ok('a check working from an older read sends nothing: the task already climbed', rStale.overdue === 0 && take().length === 0 && (await eventsOf(stale.id, 'ALERTED')).length === 1, rStale);
    const brittle = await mkTask('brittle', { dueAt: new Date(now.getTime() - 30 * 60_000) });
    const rBrittle = await runAlertCheck(swapped('taskEvent', 'update', async () => { throw new Error(`${TAG} write failed`); }), { now, agencyIds: cleanup.agencyIds, jobId: JOB });
    take();
    const brittleEv = (await eventsOf(brittle.id, 'ALERTED'))[0];
    ok('if noting how many were told fails, the history still says which rung, and the run counts the failure',
      rBrittle.failed === 1 && rBrittle.overdue === 1 && (brittleEv?.metadata as Json)?.automatic === 'overdue', [rBrittle, brittleEv?.metadata]);

    console.log('When sending fails');
    const flaky = await mkTask('flaky', { dueAt: new Date(now.getTime() - 30 * 60_000) });
    senderMode = 'throw';
    const r8 = await check(now);
    senderMode = 'ok';
    take();
    const flakyNote = await prisma.deskNotification.findFirst({ where: { taskId: flaky.id } });
    ok('the check carries on, the rung is kept, and the failure is recorded', r8.ran && r8.failed === 0 && (await row(flaky.id)).alertLevel === 2 && flakyNote?.status === 'FAILED' && flakyNote.error === 'provider down', flakyNote);
    ok('…and it is not retried, so nobody is emailed twice', (await check(now)).overdue === 0);

    console.log('Switched off');
    const quiet = await mkTask('quiet', { dueAt: new Date(now.getTime() - 30 * 60_000) });
    process.env.DESK_EMAIL_NOTIFICATIONS = 'off';
    const off = await check(now);
    delete process.env.DESK_EMAIL_NOTIFICATIONS;
    ok('nothing runs while notifications are off, so no alert is used up', !off.ran && /switched off/.test(off.reason ?? '') && (await row(quiet.id)).alertLevel === null && take().length === 0, off);
    ok('it is sent once they are on again', (await check(now)).overdue === 1 && take().length === 1);

    console.log('The run record');
    const run = await lastAlertRun(prisma, JOB);
    ok('when it last ran and how many alerts, counts only', !!run && !run.error && run.failed === 0 && typeof run.sent === 'number' && Object.keys(run).sort().join() === 'at,error,failed,sent', run);
    const jobRow = await prisma.deskJobRun.findUniqueOrThrow({ where: { id: JOB } });
    ok('the record holds counts only, nothing about any task', Object.keys(jobRow.result as Json).sort().join() === 'autoEscalated,checked,dueSoon,emails,escalated,failed,overdue,ran'
      && !JSON.stringify(jobRow).includes(late.id) && !JSON.stringify(jobRow).includes(TAG + ' '), jobRow.result);
    ok('the real run record is untouched by these checks', JSON.stringify(await prisma.deskJobRun.findUnique({ where: { id: 'alerts' } })) === realRunBefore);
    const wl = await getWorkload(prisma, sOps, {}) as Json;
    ok('the Workload page is told when the check last ran, and if a schedule is set up', 'alertCheck' in wl && 'scheduled' in wl.alertCheck && 'lastRun' in wl.alertCheck, wl.alertCheck);

    console.log('Escalating by hand');
    const byHand = await mkTask('by hand', { dueAt: addBusinessMinutes(now, 600, cal) });
    take();
    await setTaskEscalation(prisma, sAm, byHand.id, { escalate: true, reason: `${TAG} customer upset` });
    const handMails = take();
    ok('by the AM: the Operations Managers are told, not the AM', ours(handMails).join() === 'ops' && handMails.length === 1 + realOps && handMails[0].subject === `Request #${byHand.reference} was escalated`, ours(handMails));
    ok('…without the reason', !handMails.some((m) => (m.html + (m.text ?? '')).includes('upset')));
    await setTaskEscalation(prisma, sOps, byHand.id, { escalate: false });
    ok('clearing it emails nobody', take().length === 0);
    await setTaskEscalation(prisma, sOps, byHand.id, { escalate: true, reason: 'again' });
    const opsMails = take();
    ok('by an Operations Manager: the AM and the other Operations Managers, not them', ours(opsMails).join() === 'am' && opsMails.length === 1 + realOps, ours(opsMails));

    console.log('The scheduler route');
    const req = (method: string, auth?: string) => new NextRequest('http://local.test/api/desk/cron/alerts', { method, headers: auth ? { authorization: auth } : {} });
    const saved = process.env.DESK_CRON_SECRET;
    delete process.env.DESK_CRON_SECRET;
    const r503 = await cronPost(req('POST', 'Bearer x'));
    ok('no secret set up: 503, nothing runs', r503.status === 503);
    process.env.DESK_CRON_SECRET = `${TAG}-secret-long-enough`;
    ok('no or the wrong secret: 401', (await cronPost(req('POST'))).status === 401 && (await cronGet(req('GET', 'Bearer nope'))).status === 401);
    // Run with notifications off, so the real check touches nothing in the shared database.
    process.env.DESK_EMAIL_NOTIFICATIONS = 'off';
    const r200 = await cronGet(req('GET', `Bearer ${TAG}-secret-long-enough`));
    const b200 = await r200.json() as Json;
    const p200 = await cronPost(req('POST', `Bearer ${TAG}-secret-long-enough`));
    delete process.env.DESK_EMAIL_NOTIFICATIONS;
    if (saved === undefined) delete process.env.DESK_CRON_SECRET; else process.env.DESK_CRON_SECRET = saved;
    ok('the right secret: the check runs, by GET or POST, and answers with counts', r200.status === 200 && b200.ran === false && 'checked' in b200 && p200.status === 200, b200);

    console.log('The code');
    const mw = read('middleware.ts');
    ok('the route is reachable without a session; the route checks its own secret', mw.includes("'/api/desk/cron',") && read('app/api/desk/cron/alerts/route.ts').includes('isSchedulerRequest(request.headers.get(\'authorization\'))'));
    const inst = read('instrumentation.ts');
    ok('the app runs the check itself only when an interval is set, on the server, never two at once', inst.includes("process.env.NEXT_RUNTIME !== 'nodejs'") && inst.includes('if (!minutes) return;') && inst.includes('if (running) return;'));
    ok('a one-off run for a host\'s scheduler', read('script/desk-alert-check.ts').includes('runAlertCheck(prisma)'));
    const view = read('app/components/desk/workload/WorkloadView.tsx');
    ok('the Workload page says when the check last ran, and warns when no schedule is set up', view.includes('data-testid="desk-workload-alert-check"') && view.includes('No schedule is set up'));
    ok('a manual escalation emails through the API', read('lib/desk/task-api.ts').includes('await notifyEscalated(db, task, scope.userId);'));
  } catch (err) {
    fail++;
    console.error(err);
  } finally {
    await wipe();
    const leftUsers = await prisma.user.count({ where: { email: { startsWith: TAG } } });
    const leftTasks = await prisma.task.count({ where: { title: { startsWith: TAG } } });
    const leftJobs = await prisma.deskJobRun.count({ where: { id: { startsWith: TAG } } });
    const leftAgencies = await prisma.agency.count({ where: { name: { startsWith: TAG } } });
    ok('nothing left behind', leftUsers + leftTasks + leftJobs + leftAgencies === 0, [leftUsers, leftTasks, leftJobs, leftAgencies]);
    await prisma.$disconnect();
    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
  }
})();
