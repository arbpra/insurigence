/**
 * Module 40: the workload view, reassigning, moving between pods, escalating.
 *
 *   npx tsx script/verify-desk-workload.ts
 *
 * The filters and wording (pure); moving work to a pod (triage, who may, bad
 * input, the holder who can't follow it goes back to the queue, a stale read
 * refused, audited, the history's wording for managers and VAs); escalating
 * and clearing (who may, a reason needed, the reason hidden from VAs and the
 * agency, audited without it, a stale read refused); the workload counts by
 * pod, person and agency and the list behind them; changing several tasks at
 * once (each checked on its own, the answer says which weren't changed and
 * why); the workspace's offers; the real routes; the screens. Against the
 * shared database, with temporary agencies, people, pods and tasks, all
 * removed at the end. Emails are off for this run.
 */
import 'dotenv/config';
import { readFileSync } from 'fs';
import { NextRequest } from 'next/server';
import type { Prisma, Task, TaskEventKind, UserRole } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { createSession } from '../lib/auth';
import { DeskAccessError, resolveDeskScope } from '../lib/desk/access';
import { getTaskDetail, listTasks, setTaskAssignee, setTaskEscalation, setTaskPod } from '../lib/desk/task-api';
import { escalateTask, moveTaskToPod } from '../lib/desk/tasks';
import { eventLines, eventTitle, type StaffEvent } from '../lib/desk/task-workspace';
import { WORKLOAD_BULK_MAX, changeWorkload, getWorkload } from '../lib/desk/workload';
import {
  EMPTY_WORKLOAD_FILTERS, bulkSummary, hasWorkloadFilters, parseWorkloadFilters, workloadApiQuery, workloadPageQuery,
} from '../lib/desk/workload-view';
import { GET as workloadRoute } from '../app/api/desk/workload/route';
import { POST as bulkRoute } from '../app/api/desk/workload/bulk/route';
import { POST as escalationRoute } from '../app/api/desk/tasks/[id]/escalation/route';
import { POST as podRoute } from '../app/api/desk/tasks/[id]/pod/route';

process.env.DESK_EMAIL_NOTIFICATIONS = 'off';

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, detail = '') => {
  c ? pass++ : fail++;
  console.log(`  ${c ? '✓' : '✗'} ${n}${!c && detail ? `  [${detail}]` : ''}`);
  if (!c && process.env.FAIL_FAST) throw new Error(`stopped at: ${n}`);
};

const TAG = `m40test${Date.now()}`;
const cleanup = { agencyIds: [] as string[], userIds: [] as string[], podIds: [] as string[] };
const read = (p: string) => readFileSync(p, 'utf8');
type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const H = 3_600_000;

async function wipe() {
  const agencyId = { in: cleanup.agencyIds };
  await prisma.taskEvent.deleteMany({ where: { agencyId } });
  await prisma.task.updateMany({ where: { agencyId }, data: { parentTaskId: null } });
  await prisma.task.deleteMany({ where: { agencyId } });
  await prisma.insuredAccount.deleteMany({ where: { agencyId } });
  await prisma.agencyPodAccess.deleteMany({ where: { OR: [{ agencyId }, { podId: { in: cleanup.podIds } }] } });
  await prisma.podMember.deleteMany({ where: { podId: { in: cleanup.podIds } } });
  await prisma.pod.deleteMany({ where: { id: { in: cleanup.podIds } } });
  await prisma.agencyDeskAssignment.deleteMany({ where: { agencyId } });
  await prisma.deskAuditLog.deleteMany({ where: { OR: [{ agencyId }, { actorId: { in: cleanup.userIds } }] } });
  await prisma.session.deleteMany({ where: { userId: { in: cleanup.userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: cleanup.userIds } } });
  await prisma.agency.deleteMany({ where: { id: agencyId } });
}

const refusal = async (fn: () => Promise<unknown>) => {
  try { await fn(); return null; } catch (e) { if (e instanceof DeskAccessError) return e; throw e; }
};

function pureLogic() {
  console.log('Filters and wording');
  const id = 'a'.repeat(24);
  const f = parseWorkloadFilters(new URLSearchParams(`podId=none&assignee=${id}&agencyId=nope&status=QA_REVIEW&escalated=1&sort=activity&page=3&q=fleet`));
  ok('the address is read back, and anything invalid dropped', f.podId === 'none' && f.assignee === id && f.agencyId === '' && f.status === 'QA_REVIEW'
    && f.escalated && !f.overdue && f.sort === 'activity' && f.page === 3 && f.q === 'fleet', JSON.stringify(f));
  ok('an unknown status or sort falls back', parseWorkloadFilters(new URLSearchParams('status=LOST&sort=random&page=-2')).status === ''
    && parseWorkloadFilters(new URLSearchParams('sort=random')).sort === 'due' && parseWorkloadFilters(new URLSearchParams('page=-2')).page === 1);
  ok('the address keeps only what differs from the defaults', workloadPageQuery(EMPTY_WORKLOAD_FILTERS) === '' && workloadPageQuery({ ...EMPTY_WORKLOAD_FILTERS, overdue: true, sort: 'newest' }) === 'overdue=1&sort=newest');
  ok('the API is asked for open work unless closed work is wanted', new URLSearchParams(workloadApiQuery(EMPTY_WORKLOAD_FILTERS)).get('open') === '1'
    && !new URLSearchParams(workloadApiQuery({ ...EMPTY_WORKLOAD_FILTERS, closed: true })).has('open')
    && !new URLSearchParams(workloadApiQuery({ ...EMPTY_WORKLOAD_FILTERS, status: 'COMPLETED' })).has('open')
    && !new URLSearchParams(workloadApiQuery({ ...EMPTY_WORKLOAD_FILTERS, closed: true })).has('closed'));
  ok('filters are noticed, but not the sort or the page', !hasWorkloadFilters({ ...EMPTY_WORKLOAD_FILTERS, sort: 'newest', page: 2 }) && hasWorkloadFilters({ ...EMPTY_WORKLOAD_FILTERS, podId: 'none' }));
  ok('a change to several tasks says what happened', bulkSummary({ done: [{ reference: 1 }, { reference: 2 }], failed: [] }, 'Moved') === 'Moved 2 tasks.'
    && bulkSummary({ done: [{ reference: 1 }], failed: [{ reference: 7, message: 'This task is closed.' }] }, 'Reassigned') === 'Reassigned 1 task. One was not changed. #7: This task is closed.');

  const e = (kind: string, details: Record<string, unknown>) => ({ id: 'x', kind, visibility: 'INTERNAL', actorName: null, body: null, fromStatus: null, toStatus: null, details, createdAt: '' }) as StaffEvent;
  ok('a move reads "Moved to <pod>", from where; routing on arrival as before', eventTitle(e('ROUTED', { toName: 'Pod 2', fromName: 'Pod 1' })) === 'Moved to Pod 2'
    && eventLines(e('ROUTED', { toName: 'Pod 2', fromName: null }))[0] === 'From no pod' && eventTitle(e('ROUTED', { automatic: true })) === 'Routed to a pod');
  ok('a VA, without the details, reads "Moved to another pod"', eventTitle(e('ROUTED', {})) === 'Moved to another pod' && eventLines(e('ROUTED', {})).length === 0);
  ok('an escalation shows its reason to managers', eventLines(e('ESCALATED', { reason: 'Client called twice' }))[0] === 'Reason: Client called twice' && eventLines(e('ESCALATED', {})).length === 0);
}

(async () => {
  try {
    pureLogic();

    const mkAgency = async (n: string) => { const a = await prisma.agency.create({ data: { name: `${TAG} ${n}`, deskEnabled: true } }); cleanup.agencyIds.push(a.id); return a; };
    const mkUser = async (n: string, role: UserRole, agencyId: string | null = null) => {
      const u = await prisma.user.create({ data: { email: `${TAG}-${n}@example.test`, role, agencyId, firstName: `${TAG}${n}`, passwordHash: 'x', mustChangePassword: false } });
      cleanup.userIds.push(u.id); return u;
    };
    const mkPod = async (n: string, sortOrder = 900) => { const p = await prisma.pod.create({ data: { code: `${TAG}${n}`, name: `${TAG} ${n}`, sortOrder } }); cleanup.podIds.push(p.id); return p; };
    const A = await mkAgency('Harbor');
    const B = await mkAgency('Basin');
    const owner = await mkUser('owner', 'ADMIN', A.id);
    const am = await mkUser('am', 'ACCOUNT_MANAGER');
    const amB = await mkUser('amb', 'ACCOUNT_MANAGER');
    const ops = await mkUser('ops', 'DESK_ADMIN');
    const va = await mkUser('va', 'DESK_VA');
    const va2 = await mkUser('va2', 'DESK_VA');
    const idle = await mkUser('idle', 'DESK_VA');
    const gone = await mkUser('gone', 'DESK_VA');
    await prisma.agencyDeskAssignment.createMany({ data: [{ agencyId: A.id, primaryAmId: am.id }, { agencyId: B.id, primaryAmId: amB.id }] });
    const P1 = await mkPod('One', 901);
    const P2 = await mkPod('Two', 902);
    const P3 = await mkPod('Three', 903);
    const Off = await mkPod('Off', 904);
    const OffIdle = await mkPod('OffIdle', 905);
    await prisma.pod.updateMany({ where: { id: { in: [Off.id, OffIdle.id] } }, data: { isActive: false } });
    // va works Harbor in Pod One only; va2 works Harbor in Pod Two and Basin in Pod One.
    await prisma.podMember.createMany({ data: [{ podId: P1.id, userId: va.id }, { podId: P2.id, userId: va2.id }, { podId: P1.id, userId: va2.id }, { podId: P1.id, userId: idle.id }] });
    await prisma.agencyPodAccess.createMany({ data: [
      { agencyId: A.id, podId: P1.id, userId: va.id }, { agencyId: A.id, podId: P2.id, userId: va2.id }, { agencyId: B.id, podId: P1.id, userId: va2.id },
      { agencyId: A.id, podId: P1.id, userId: idle.id },
    ] });
    const acme = await prisma.insuredAccount.create({ data: { agencyId: A.id, name: `${TAG} Acme Trucking`, nameKey: `${TAG} acme trucking` } });
    const scope = (u: { id: string }) => resolveDeskScope(prisma, u.id);
    const [sOwner, sAm, sAmB, sOps, sVa, sVa2] = await Promise.all([owner, am, amB, ops, va, va2].map(scope));
    ok('the test VAs work where intended', sVa.kind === 'VA' && sVa.grants.length === 1 && sVa2.kind === 'VA' && sVa2.grants.length === 2, JSON.stringify([sVa, sVa2]));
    const row = (id: string) => prisma.task.findUniqueOrThrow({ where: { id } });
    const now = Date.now();
    let n = 0;
    const mkTask = (title: string, data: Partial<Prisma.TaskUncheckedCreateInput> = {}) => {
      n += 1;
      return prisma.task.create({ data: {
        reference: 940_000_000 + (now % 50_000_000) + n, agencyId: A.id, type: 'OTHER', title: `${TAG} ${title}`, amId: am.id,
        createdById: am.id, restrictedToUserIds: [], insuredId: acme.id, ...data,
      } });
    };
    const audits = (entityId: string, action: string) => prisma.deskAuditLog.findMany({ where: { entityId, action }, orderBy: { createdAt: 'asc' } });
    const eventsOf = (taskId: string, kind: string) => prisma.taskEvent.findMany({ where: { taskId, kind: kind as TaskEventKind }, orderBy: { createdAt: 'asc' } });

    // ── Moving to a pod ──
    console.log('Moving work to a pod');
    const triage = await mkTask('no pod yet');
    const moved = await setTaskPod(prisma, sOps, triage.id, { podId: P1.id }) as Json;
    ok('an Operations Manager places work no pod had', moved.pod?.id === P1.id && (await row(triage.id)).podId === P1.id);
    const routedEvents = await eventsOf(triage.id, 'ROUTED');
    const ev = routedEvents.at(-1)!;
    ok('its history: moved, by whom, from where to where, internal', !!ev && ev.actorId === ops.id && ev.visibility === 'INTERNAL'
      && (ev.metadata as Json).toName === P1.name && (ev.metadata as Json).from === null && ev.body === null, JSON.stringify(ev));
    const routedAudit = (await audits(triage.id, 'task.routed')).at(-1);
    ok('audited', (routedAudit?.metadata as Json)?.to === P1.id && (routedAudit?.metadata as Json)?.from === null && routedAudit?.actorId === ops.id);
    const vaDetail = await getTaskDetail(prisma, sVa, triage.id) as Json;
    const vaEvent = vaDetail.events.find((x: Json) => x.kind === 'ROUTED');
    const opsEvent = (await getTaskDetail(prisma, sOps, triage.id) as Json).events.find((x: Json) => x.kind === 'ROUTED');
    ok('managers read where it went; a VA, only that it moved (Q4)', eventTitle(opsEvent) === `Moved to ${P1.name}` && eventTitle(vaEvent) === 'Moved to another pod' && !('toName' in vaEvent.details));
    ok('the AM moves their own agency\'s work', (await setTaskPod(prisma, sAm, triage.id, { podId: P2.id }) as Json).pod?.id === P2.id);

    console.log('Moving: refused');
    const r = {
      same: await refusal(() => setTaskPod(prisma, sOps, triage.id, { podId: P2.id })),
      off: await refusal(() => setTaskPod(prisma, sOps, triage.id, { podId: Off.id })),
      unknown: await refusal(() => setTaskPod(prisma, sOps, triage.id, { podId: 'b'.repeat(24) })),
      notId: await refusal(() => setTaskPod(prisma, sOps, triage.id, { podId: 'Pod 1' })),
      none: await refusal(() => setTaskPod(prisma, sOps, triage.id, { podId: null })),
    };
    ok('the same pod: 409; a pod that is off: 409', r.same?.status === 409 && r.same.message === 'The task is already in this pod.' && r.off?.status === 409 && r.off.message === 'That pod is switched off.');
    ok('an unknown pod, not an id, or none: 400', r.unknown?.status === 400 && r.notId?.status === 400 && r.none?.status === 400);
    const vaMove = await refusal(() => setTaskPod(prisma, sVa2, triage.id, { podId: P1.id }));
    ok('a VA can\'t move work: 403, logged', vaMove?.status === 403 && !!(await prisma.deskAuditLog.findFirst({ where: { actorId: va2.id, action: 'access.denied', entityId: triage.id } })));
    const ownerMove = await refusal(() => setTaskPod(prisma, sOwner, triage.id, { podId: P1.id }));
    const otherAm = await refusal(() => setTaskPod(prisma, sAmB, triage.id, { podId: P1.id }));
    ok('nor the agency (403), nor another agency\'s AM (404)', ownerMove?.status === 403 && otherAm?.status === 404);
    const closed = await mkTask('closed', { podId: P1.id, status: 'CANCELLED', cancelledAt: new Date() });
    ok('closed work stays where it is: 409', (await refusal(() => setTaskPod(prisma, sOps, closed.id, { podId: P2.id })))?.status === 409);
    ok('nothing refused was moved', (await row(triage.id)).podId === P2.id && (await row(closed.id)).podId === P1.id);

    console.log('Moving: the person holding it');
    const held = await mkTask('held by va', { podId: P1.id, status: 'IN_PROGRESS', assigneeId: va.id, startedAt: new Date() });
    await setTaskPod(prisma, sOps, held.id, { podId: P2.id });
    const heldRow = await row(held.id);
    ok('a VA who can\'t work it in the new pod loses it: back to that pod\'s queue, as New', heldRow.podId === P2.id && heldRow.assigneeId === null && heldRow.status === 'NEW', JSON.stringify([heldRow.assigneeId, heldRow.status]));
    const released = (await eventsOf(held.id, 'UNASSIGNED')).at(-1);
    ok('its history says so, and the audit names who lost it', (released?.metadata as Json)?.automatic === 'moved_pod' && (released?.metadata as Json)?.from === va.id
      && ((await audits(held.id, 'task.routed')).at(-1)?.metadata as Json)?.released === va.id);
    const lost = await mkTask('held by va2', { podId: P2.id, status: 'ASSIGNED', assigneeId: va2.id });
    await setTaskPod(prisma, sOps, lost.id, { podId: P1.id });
    ok('working another agency in that pod is not enough: authorisation is per agency', (await row(lost.id)).assigneeId === null && (await row(lost.id)).status === 'NEW');
    const amHeld = await mkTask('held by am', { podId: P1.id, status: 'IN_PROGRESS', assigneeId: am.id, startedAt: new Date() });
    await setTaskPod(prisma, sOps, amHeld.id, { podId: P3.id });
    ok('an Account Manager holding it keeps it, in any pod', (await row(amHeld.id)).assigneeId === am.id && (await row(amHeld.id)).status === 'IN_PROGRESS');
    const vaKeeps = await mkTask('va keeps', { podId: P2.id, status: 'ASSIGNED', assigneeId: va.id });
    await setTaskPod(prisma, sOps, vaKeeps.id, { podId: P1.id });
    ok('a VA who can work it there keeps it', (await row(vaKeeps.id)).assigneeId === va.id && (await row(vaKeeps.id)).status === 'ASSIGNED');

    console.log('Moving: changed by someone else meanwhile');
    const race = await mkTask('race', { podId: P1.id });
    const before = await row(race.id);
    await setTaskPod(prisma, sOps, race.id, { podId: P2.id });
    type FindFirst = (a: unknown) => Promise<Task | null>;
    const staleAs = (taskId: string, stale: Task) => new Proxy(prisma, { get(t, k) {
      const v = Reflect.get(t, k);
      if (k !== 'task') return typeof v === 'function' ? v.bind(t) : v;
      return new Proxy(t.task, { get(tt, kk) {
        const fn = Reflect.get(tt, kk);
        if (kk !== 'findFirst') return typeof fn === 'function' ? fn.bind(tt) : fn;
        return async (a: unknown) => { const found = await (fn as FindFirst).call(tt, a); return found?.id === taskId ? stale : found; };
      } });
    } }) as typeof prisma;
    const raced = await refusal(() => moveTaskToPod(staleAs(race.id, before), sOps, race.id, P3.id));
    ok('a move made from an old read: 409, and the other move stands', raced?.status === 409 && (await row(race.id)).podId === P2.id, raced?.message);

    // ── Escalation ──
    console.log('Escalating');
    const esc = await mkTask('needs a manager', { podId: P1.id, status: 'ASSIGNED', assigneeId: va.id });
    const REASON = `${TAG} The client called twice about the certificate`;
    const escView = await setTaskEscalation(prisma, sAm, esc.id, { escalate: true, reason: `  ${REASON}  ` }) as Json;
    const escRow = await row(esc.id);
    ok('the AM escalates, with a reason', escView.escalated === true && escRow.escalated && !!escRow.escalatedAt && escRow.escalationReason === REASON && escView.escalationReason === REASON);
    const escEvent = (await eventsOf(esc.id, 'ESCALATED')).at(-1)!;
    ok('its history: internal, the reason in the details, not the text a VA reads', escEvent?.visibility === 'INTERNAL' && escEvent.body === null && (escEvent.metadata as Json).reason === REASON && escEvent.actorId === am.id);
    const escAudit = (await audits(esc.id, 'task.escalated')).at(-1);
    ok('audited, without the reason', (escAudit?.metadata as Json)?.escalated === true && !JSON.stringify(escAudit?.metadata).includes('called twice'));
    const vaEsc = await getTaskDetail(prisma, sVa, esc.id) as Json;
    ok('a VA sees that it is escalated, never why (Q4)', vaEsc.escalated === true && !('escalationReason' in vaEsc) && !JSON.stringify(vaEsc).includes('called twice')
      && eventTitle(vaEsc.events.find((x: Json) => x.kind === 'ESCALATED')) === 'Escalated');
    const amEsc = await getTaskDetail(prisma, sAm, esc.id) as Json;
    ok('managers read the reason in the history', eventLines(amEsc.events.find((x: Json) => x.kind === 'ESCALATED'))[0] === `Reason: ${REASON}`);
    const agencyTask = await mkTask('agency sees', { podId: P1.id });
    await setTaskEscalation(prisma, sOps, agencyTask.id, { escalate: true, reason: `${TAG} internal only` });
    const agencyView = await getTaskDetail(prisma, sOwner, agencyTask.id) as Json;
    ok('the agency sees nothing of it', !('escalated' in agencyView) && !JSON.stringify(agencyView).includes('internal only') && !agencyView.events.some((x: Json) => x.kind === 'ESCALATED'));
    ok('listed as escalated, with the reason for managers', (await listTasks(prisma, sOps, { escalated: true, agencyId: A.id })).rows.map((x: Json) => x.id).sort().join() === [esc.id, agencyTask.id].sort().join()
      && (await listTasks(prisma, sOps, { escalated: true, agencyId: A.id })).rows.every((x: Json) => typeof x.escalationReason === 'string'));

    console.log('Escalating: refused');
    const e1 = await refusal(() => setTaskEscalation(prisma, sOps, esc.id, { escalate: true, reason: 'again' }));
    const plain = await mkTask('plain', { podId: P1.id });
    const e2 = await refusal(() => setTaskEscalation(prisma, sOps, plain.id, { escalate: true, reason: '   ' }));
    const e3 = await refusal(() => setTaskEscalation(prisma, sOps, plain.id, { escalate: true, reason: 'x'.repeat(501) }));
    const e4 = await refusal(() => setTaskEscalation(prisma, sOps, plain.id, { escalate: 'yes', reason: 'why' }));
    const e5 = await refusal(() => setTaskEscalation(prisma, sOps, plain.id, { escalate: false }));
    ok('already escalated: 409; not escalated, so nothing to clear: 409', e1?.status === 409 && e1.message === 'This task is already escalated.' && e5?.status === 409 && e5.message === 'This task is not escalated.');
    ok('no reason, too long a reason, or not yes or no: 400', e2?.status === 400 && e3?.status === 400 && e4?.status === 400);
    const e6 = await refusal(() => setTaskEscalation(prisma, sVa, plain.id, { escalate: true, reason: 'help' }));
    ok('a VA can\'t escalate: 403, logged', e6?.status === 403 && !!(await prisma.deskAuditLog.findFirst({ where: { actorId: va.id, action: 'access.denied', entityId: plain.id } })));
    ok('nor the agency', (await refusal(() => setTaskEscalation(prisma, sOwner, plain.id, { escalate: true, reason: 'help' })))?.status === 403);
    ok('closed work: 409', (await refusal(() => setTaskEscalation(prisma, sOps, closed.id, { escalate: true, reason: 'late' })))?.status === 409);
    ok('nothing refused was escalated', !(await row(plain.id)).escalated && !(await row(closed.id)).escalated);
    const staleEsc = await refusal(() => escalateTask(staleAs(esc.id, { ...escRow, escalated: false }), sOps, esc.id, { escalate: true, reason: 'twice' }));
    ok('escalated from an old read, after someone else did: 409, the first reason stands', staleEsc?.status === 409 && (await row(esc.id)).escalationReason === REASON, staleEsc?.message);

    console.log('Clearing an escalation');
    const cleared = await setTaskEscalation(prisma, sOps, esc.id, { escalate: false, reason: `${TAG} Sorted with the client` }) as Json;
    const clearedRow = await row(esc.id);
    ok('an Operations Manager clears it', cleared.escalated === false && !clearedRow.escalated && clearedRow.escalatedAt === null && clearedRow.escalationReason === null);
    const de = (await eventsOf(esc.id, 'DEESCALATED')).at(-1);
    ok('its history keeps both, with the reasons', !!de && (de.metadata as Json).reason === `${TAG} Sorted with the client` && (await eventsOf(esc.id, 'ESCALATED')).length === 1);
    ok('audited', ((await audits(esc.id, 'task.escalated')).at(-1)?.metadata as Json)?.escalated === false);
    ok('it can be escalated again', (await setTaskEscalation(prisma, sOps, esc.id, { escalate: true, reason: 'Back again' }) as Json).escalated === true);

    // ── The workload ──
    console.log('The workload: counts');
    const overdue = await mkTask('overdue', { podId: P3.id, dueAt: new Date(now - 2 * H) });
    const waiting = await mkTask('waiting', { podId: P3.id, status: 'WAITING_ON_CARRIER', slaPausedAt: new Date(now - H), dueAt: new Date(now - 3 * H), assigneeId: va2.id });
    const orphan = await mkTask('in a pod that is off', { podId: Off.id, assigneeId: gone.id, status: 'ASSIGNED' });
    await prisma.user.update({ where: { id: gone.id }, data: { isActive: false } });
    const basin = await mkTask('basin', { agencyId: B.id, podId: P1.id, insuredId: null, amId: amB.id });
    const unrouted = await mkTask('still no pod');
    const w = await getWorkload(prisma, sOps, { open: true });
    const pod = (id: string) => w.pods.find((p) => p.id === id);
    const person = (id: string) => w.people.find((p) => p.id === id);
    // What this run made in each pod: Three holds amHeld (AM), overdue, waiting (va2).
    ok('by pod: open, unassigned, overdue, waiting, escalated', JSON.stringify(pod(P3.id) && { ...pod(P3.id), id: 0, name: 0, isActive: 0 })
      === JSON.stringify({ id: 0, name: 0, isActive: 0, open: 3, unassigned: 1, overdue: 1, waiting: 1, escalated: 0 }), JSON.stringify(pod(P3.id)));
    ok('waiting work is never counted overdue (its clock is stopped)', pod(P3.id)?.overdue === 1);
    ok('a pod that is off shows while it holds open work; one with none doesn\'t', pod(Off.id)?.isActive === false && pod(Off.id)?.open === 1 && !pod(OffIdle.id));
    ok('work no pod has is a row of its own', (w.pods.find((p) => p.id === 'none')?.open ?? 0) >= 1);
    ok('by person: what each holds', person(va.id)?.open === 2 && person(va2.id)?.open === 1 && person(va2.id)?.waiting === 1 && person(am.id)?.open === 1, JSON.stringify([person(va.id), person(va2.id), person(am.id)]));
    ok('idle people are listed too, with nothing', person(idle.id)?.open === 0 && person(idle.id)?.kind === 'VA' && person(idle.id)?.pods.includes(P1.name) === true);
    ok('someone deactivated still holding work is listed, marked', person(gone.id)?.isActive === false && person(gone.id)?.open === 1);
    ok('the busiest first', w.people.findIndex((p) => p.id === va.id) < w.people.findIndex((p) => p.id === va2.id) && w.people.findIndex((p) => p.id === va2.id) < w.people.findIndex((p) => p.id === idle.id));
    const harbor = w.agencies.find((a) => a.id === A.id);
    const openHarbor = await prisma.task.count({ where: { agencyId: A.id, status: { notIn: ['COMPLETED', 'CANCELLED'] } } });
    ok('by agency, matching what is open', harbor?.open === openHarbor && harbor.escalated === 2 && harbor.overdue === 1 && w.agencies.find((a) => a.id === B.id)?.open === 1, JSON.stringify(harbor));
    const totalOpen = await prisma.task.count({ where: { status: { notIn: ['COMPLETED', 'CANCELLED'] } } });
    ok('the total is all open work, every agency', w.total.open === totalOpen && w.total.open === w.pods.reduce((s, p) => s + p.open, 0));

    console.log('The workload: the list');
    const ids = (rows: Json[]) => rows.map((x) => x.id).sort().join();
    ok('by pod', ids((await getWorkload(prisma, sOps, { open: true, podId: P3.id })).list.rows) === ids([amHeld, overdue, waiting]));
    ok('nobody has it, in a pod', ids((await getWorkload(prisma, sOps, { open: true, podId: P3.id, assignee: 'none' })).list.rows) === ids([overdue]));
    ok('no pod yet, for an agency', (await getWorkload(prisma, sOps, { open: true, podId: 'none', agencyId: A.id })).list.rows.some((x: Json) => x.id === unrouted.id));
    ok('overdue, and escalated', ids((await getWorkload(prisma, sOps, { open: true, overdue: true, agencyId: A.id })).list.rows) === ids([overdue])
      && (await getWorkload(prisma, sOps, { open: true, escalated: true, agencyId: A.id })).list.rows.length === 2);
    ok('closed work only when asked', !(await getWorkload(prisma, sOps, { open: true, agencyId: A.id })).list.rows.some((x: Json) => x.id === closed.id)
      && (await getWorkload(prisma, sOps, { agencyId: A.id, status: 'CANCELLED' })).list.rows.some((x: Json) => x.id === closed.id));
    const basinRow = (await getWorkload(prisma, sOps, { open: true, agencyId: B.id })).list.rows[0] as Json;
    ok('rows carry what the screen shows', basinRow?.id === basin.id && basinRow.agency.id === B.id && basinRow.pod.id === P1.id && basinRow.escalated === false && 'escalationReason' in basinRow, JSON.stringify(basinRow));

    console.log('The workload: who may');
    for (const [name, s] of [['an Account Manager', sAm], ['a VA', sVa], ['the agency', sOwner]] as const) {
      ok(`${name}: refused`, (await refusal(() => getWorkload(prisma, s, {})))?.status === 403 && (await refusal(() => changeWorkload(prisma, s, { taskIds: [plain.id], podId: P2.id })))?.status === 403);
    }

    console.log('Changing several at once');
    const b1 = await mkTask('bulk one', { podId: P1.id });
    const b2 = await mkTask('bulk two', { podId: P1.id, status: 'ASSIGNED', assigneeId: idle.id });
    const b3 = await mkTask('bulk elsewhere', { podId: P3.id });
    const auditsBefore = await prisma.deskAuditLog.count({ where: { action: 'task.assigned', actorId: ops.id } });
    const res = await changeWorkload(prisma, sOps, { taskIds: [b1.id, b2.id, b3.id, closed.id, 'c'.repeat(24), b1.id], assigneeId: va.id });
    ok('each that can be is assigned', ids(res.done) === ids([b1, b2]) && (await row(b1.id)).assigneeId === va.id && (await row(b2.id)).assigneeId === va.id, JSON.stringify(res));
    const why = new Map(res.failed.map((x) => [x.id, x]));
    ok('the rest say why, by number', why.get(b3.id)?.message === 'That person is not authorised for this agency, pod or task.' && why.get(b3.id)?.reference === b3.reference
      && why.get(closed.id)?.message === 'This task is closed.' && why.get('c'.repeat(24))?.reference === null && res.failed.length === 3, JSON.stringify(res.failed));
    ok('a task listed twice is changed once', res.done.filter((x) => x.id === b1.id).length === 1);
    ok('each change audited on its own', (await prisma.deskAuditLog.count({ where: { action: 'task.assigned', actorId: ops.id } })) - auditsBefore === 2);
    const back = await changeWorkload(prisma, sOps, { taskIds: [b1.id, b2.id], assigneeId: null });
    ok('back to the queue', back.done.length === 2 && (await row(b1.id)).assigneeId === null && (await row(b2.id)).status === 'NEW');
    const movedAll = await changeWorkload(prisma, sOps, { taskIds: [b1.id, b2.id, b3.id], podId: P2.id });
    ok('moved to a pod, together', movedAll.done.length === 3 && (await prisma.task.count({ where: { id: { in: [b1.id, b2.id, b3.id] }, podId: P2.id } })) === 3);
    const bad = await Promise.all([
      refusal(() => changeWorkload(prisma, sOps, { taskIds: [], podId: P1.id })),
      refusal(() => changeWorkload(prisma, sOps, { taskIds: [b1.id] })),
      refusal(() => changeWorkload(prisma, sOps, { taskIds: [b1.id], podId: P1.id, assigneeId: null })),
      refusal(() => changeWorkload(prisma, sOps, { taskIds: Array.from({ length: WORKLOAD_BULK_MAX + 1 }, (_, i) => i.toString(16).padStart(24, '0')), podId: P1.id })),
      refusal(() => changeWorkload(prisma, sOps, { taskIds: [42], podId: P1.id })),
    ]);
    ok('no tasks, neither or both of a person and a pod, too many, not ids: 400', bad.every((x) => x?.status === 400), bad.map((x) => x?.status).join());

    console.log('The workspace');
    const amOffers = await getTaskDetail(prisma, sAm, plain.id) as Json;
    const vaOffers = await getTaskDetail(prisma, sVa, vaKeeps.id) as Json;
    ok('managers are offered escalating and moving, with the pods that are on', amOffers.permissions.escalate && amOffers.permissions.movePod
      && amOffers.pods.some((p: Json) => p.id === P2.id) && !amOffers.pods.some((p: Json) => p.id === Off.id));
    ok('VAs are offered neither, and not the pods', !vaOffers.permissions.escalate && !vaOffers.permissions.movePod && !('pods' in vaOffers));
    ok('closed work offers neither', !(await getTaskDetail(prisma, sOps, closed.id) as Json).permissions.escalate);

    console.log('The real routes');
    const tOps = await createSession(ops.id);
    const tAm = await createSession(am.id);
    const tVa = await createSession(va.id);
    const req = (url: string, method: string, token: string, body?: unknown) => new NextRequest(`http://local.test${url}`, {
      method, headers: { cookie: `session_token=${token}`, 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
    });
    const params = (id: string) => ({ params: Promise.resolve({ id }) });
    const wl = await workloadRoute(req(`/api/desk/workload?podId=${P3.id}&open=1`, 'GET', tOps));
    const wlBody = await wl.json() as Json;
    ok('GET the workload: counts and the list', wl.status === 200 && wlBody.list.rows.length === 3 && Array.isArray(wlBody.pods) && Array.isArray(wlBody.people));
    ok('an AM or a VA: 403, logged', (await workloadRoute(req('/api/desk/workload', 'GET', tAm))).status === 403 && (await workloadRoute(req('/api/desk/workload', 'GET', tVa))).status === 403
      && !!(await prisma.deskAuditLog.findFirst({ where: { actorId: va.id, action: 'access.denied', entityType: 'DeskSetup' } })));
    ok('a bad filter: 400', (await workloadRoute(req('/api/desk/workload?status=LOST', 'GET', tOps))).status === 400);
    const bulkRes = await bulkRoute(req('/api/desk/workload/bulk', 'POST', tOps, { taskIds: [b1.id], podId: P1.id }));
    ok('POST several: what was done', bulkRes.status === 200 && ((await bulkRes.json()) as Json).done[0]?.reference === b1.reference);
    ok('not JSON: 400; an AM: 403', (await bulkRoute(req('/api/desk/workload/bulk', 'POST', tOps, 'nope'))).status === 400
      && (await bulkRoute(req('/api/desk/workload/bulk', 'POST', tAm, { taskIds: [b1.id], podId: P2.id }))).status === 403);
    const escRes = await escalationRoute(req(`/api/desk/tasks/${plain.id}/escalation`, 'POST', tAm, { escalate: true, reason: 'Via the route' }), params(plain.id));
    ok('POST escalation, as the AM', escRes.status === 200 && ((await escRes.json()) as Json).escalated === true);
    const escList = ((await (await workloadRoute(req(`/api/desk/workload?escalated=1&open=1&q=${encodeURIComponent(TAG)}`, 'GET', tOps))).json()) as Json).list.rows as Json[];
    ok('GET escalated work only', escList.length > 0 && escList.every((r) => r.escalated === true) && escList.some((r) => r.id === plain.id), escList.map((r) => [r.reference, r.escalated]));
    ok('as a VA: 403', (await escalationRoute(req(`/api/desk/tasks/${plain.id}/escalation`, 'POST', tVa, { escalate: false }), params(plain.id))).status === 403);
    const podRes = await podRoute(req(`/api/desk/tasks/${plain.id}/pod`, 'POST', tAm, { podId: P3.id }), params(plain.id));
    ok('POST a pod, as the AM', podRes.status === 200 && ((await podRes.json()) as Json).pod?.id === P3.id);
    ok('not JSON: 400', (await podRoute(req(`/api/desk/tasks/${plain.id}/pod`, 'POST', tAm, 'nope'), params(plain.id))).status === 400);

    console.log('The screens');
    const page = read('app/(desk)/desk-ops/workload/page.tsx');
    const view = read('app/components/desk/workload/WorkloadView.tsx');
    ok('the Workload page is the workload view, behind the page gate', page.includes('<WorkloadView />') && page.includes("deskPageAccess('OPS', '/desk-ops/workload')"));
    ok('it reads the workload and changes tasks through the routes', view.includes('`/api/desk/workload?${workloadApiQuery(filters)}`') && view.includes("'/api/desk/workload/bulk'")
      && view.includes('/escalation`') && view.includes('/pod`') && view.includes('/assign`') && view.includes('/assignees`'));
    ok('counts by pod, person and agency open the tasks behind them', view.includes('testId="desk-workload-pods"')
      && view.includes('testId="desk-workload-people"') && view.includes('testId="desk-workload-agencies"') && view.includes("go({ podId: filters.podId === p.id ? '' : p.id })"));
    ok('the escalation form says the reason is internal', view.includes('the agency and VAs don&apos;t see the reason'));
    ok('several can be chosen and changed together', view.includes('data-testid="desk-workload-bulk"') && view.includes('bulkSummary(r, verb)'));
    const ws = read('app/components/desk/workspace/TaskWorkspace.tsx');
    ok('the workspace offers escalating and moving to those allowed', ws.includes('{p.escalate && (task.escalated') && ws.includes('{p.movePod && <button') && ws.includes("post('pod', { podId: pod.id })")
      && ws.includes("post('escalation', { escalate: true, reason: escalation.reason })") && ws.includes('const lines = eventLines(e);'));
  } catch (err) {
    fail++;
    console.error(err);
  } finally {
    await wipe();
    const left = await prisma.user.count({ where: { email: { startsWith: TAG } } }) + await prisma.task.count({ where: { title: { startsWith: TAG } } })
      + await prisma.pod.count({ where: { code: { startsWith: TAG } } }) + await prisma.agency.count({ where: { name: { startsWith: TAG } } });
    ok('nothing left behind', left === 0);
    await prisma.$disconnect();
    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
  }
})();
