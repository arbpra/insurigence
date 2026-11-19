/**
 * Module 32: the internal task workspace.
 *
 *   npx tsx script/verify-desk-task-workspace.ts
 *
 * The status rules a screen offers (shared with the service), how history
 * reads, the review form; reclassification and billing review through the
 * service and the real routes; and what the workspace offers each person.
 * Against the shared database, with a temporary agency, pod, people and
 * agency-only service-level targets, all removed at the end.
 */
import 'dotenv/config';
import { readFileSync } from 'fs';
import { NextRequest } from 'next/server';
import type { PrismaClient, TaskStatus, UserRole } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { createSession } from '../lib/auth';
import { DeskAccessError, resolveDeskScope } from '../lib/desk/access';
import * as service from '../lib/desk/tasks';
import * as statuses from '../lib/desk/task-statuses';
import { addBusinessMinutes, computeDueAt, loadBusinessCalendar } from '../lib/desk/business-time';
import { eventTitle, reclassifiedLines, reviewBody, type StaffEvent } from '../lib/desk/task-workspace';
import { getTaskDetail } from '../lib/desk/task-api';
import { GET as detailRoute } from '../app/api/desk/tasks/[id]/route';
import { POST as reviewRoute } from '../app/api/desk/tasks/[id]/review/route';

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, detail = '') => {
  c ? pass++ : fail++;
  console.log(`  ${c ? '✓' : '✗'} ${n}${!c && detail ? `  [${detail}]` : ''}`);
  if (!c && process.env.FAIL_FAST) throw new Error(`stopped at: ${n}`);
};

const TAG = `m32test${Date.now()}`;
const cleanup = { agencyIds: [] as string[], userIds: [] as string[], podIds: [] as string[] };
const read = (p: string) => readFileSync(p, 'utf8');

async function wipe() {
  const agencyId = { in: cleanup.agencyIds };
  await prisma.serviceLevelTarget.deleteMany({ where: { agencyId } });
  await prisma.taskEvent.deleteMany({ where: { agencyId } });
  await prisma.task.updateMany({ where: { agencyId }, data: { parentTaskId: null } });
  await prisma.task.deleteMany({ where: { agencyId } });
  await prisma.agencyPodAccess.deleteMany({ where: { OR: [{ agencyId }, { podId: { in: cleanup.podIds } }] } });
  await prisma.agencyDeskAssignment.deleteMany({ where: { agencyId } });
  await prisma.podMember.deleteMany({ where: { podId: { in: cleanup.podIds } } });
  await prisma.pod.deleteMany({ where: { id: { in: cleanup.podIds } } });
  await prisma.deskAuditLog.deleteMany({ where: { OR: [{ agencyId }, { actorId: { in: cleanup.userIds } }] } });
  await prisma.session.deleteMany({ where: { userId: { in: cleanup.userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: cleanup.userIds } } });
  await prisma.agency.deleteMany({ where: { id: agencyId } });
}

const refusal = async (fn: () => Promise<unknown>) => {
  try { await fn(); return null; } catch (err) { return err instanceof DeskAccessError ? { status: err.status, message: err.message } : { status: -1, message: String(err) }; }
};

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const req = (url: string, token: string, body?: unknown) =>
  new NextRequest(`http://local.test${url}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { cookie: `session_token=${token}`, 'content-type': 'application/json' },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const json = async (r: Response) => ({ status: r.status, json: await r.json().catch(() => null) as Json });

function rules() {
  console.log('Status moves a screen offers');
  ok('the service and the screens share one set of rules', service.canTransition === statuses.canTransition && service.STATUS_LABELS === statuses.STATUS_LABELS);
  const moves = (s: TaskStatus, o: { manager?: boolean; holdsIt?: boolean; assigned?: boolean }) =>
    statuses.statusMoves(s, { manager: false, holdsIt: false, assigned: true, ...o }).join();
  ok('a VA on someone else\'s work: nothing', moves('IN_PROGRESS', {}) === '');
  ok('a VA on their own assigned work: start, wait or cancel', moves('ASSIGNED', { holdsIt: true }) === 'IN_PROGRESS,WAITING_ON_AGENCY,WAITING_ON_CARRIER,WAITING_ON_INSURED,CANCELLED');
  ok('in progress: wait, QA, complete or cancel', moves('IN_PROGRESS', { holdsIt: true }) === 'WAITING_ON_AGENCY,WAITING_ON_CARRIER,WAITING_ON_INSURED,QA_REVIEW,COMPLETED,CANCELLED');
  ok('a VA never reopens', moves('COMPLETED', { holdsIt: true }) === '' && moves('CANCELLED', { holdsIt: true }) === '');
  ok('a manager reopens', moves('COMPLETED', { manager: true }) === 'IN_PROGRESS' && moves('CANCELLED', { manager: true }) === 'NEW');
  ok('no "start" with nobody on it', moves('WAITING_ON_AGENCY', { manager: true, assigned: false }) === 'WAITING_ON_CARRIER,WAITING_ON_INSURED,CANCELLED');
  const all = Object.keys(statuses.STATUS_LABELS) as TaskStatus[];
  ok('every move offered is one the service accepts', all.every((from) => statuses.statusMoves(from, { manager: true, holdsIt: true, assigned: true }).every((to) => service.canTransition(from, to))));
  ok('a closed request is reopened, not "started"', statuses.moveLabel('COMPLETED', 'IN_PROGRESS') === 'Reopen' && statuses.moveLabel('CANCELLED', 'NEW') === 'Reopen' && statuses.moveLabel('ASSIGNED', 'IN_PROGRESS') === 'Start work');
  ok('reasons: waiting, cancelling, reopening', statuses.needsReason('IN_PROGRESS', 'WAITING_ON_CARRIER') && statuses.needsReason('ASSIGNED', 'CANCELLED') && statuses.needsReason('COMPLETED', 'IN_PROGRESS') && !statuses.needsReason('IN_PROGRESS', 'COMPLETED'));
  ok('the reason box says who will read it', statuses.reasonPrompt('IN_PROGRESS', 'WAITING_ON_AGENCY').includes('They will see this') && statuses.reasonPrompt('IN_PROGRESS', 'WAITING_ON_CARRIER').includes('Desk team only') && statuses.reasonPrompt('COMPLETED', 'IN_PROGRESS').includes('reopened'));

  console.log('How history reads');
  const ev = (o: Partial<StaffEvent>): StaffEvent => ({ id: 'e', kind: 'NOTE', visibility: 'INTERNAL', actorName: 'A', body: null, fromStatus: null, toStatus: null, details: {}, createdAt: '', ...o });
  ok('status changes', eventTitle(ev({ kind: 'STATUS_CHANGED', fromStatus: 'IN_PROGRESS', toStatus: 'WAITING_ON_CARRIER' })) === 'In progress → Waiting on carrier');
  ok('assigning and reassigning', eventTitle(ev({ kind: 'ASSIGNED', assignedTo: 'Vera' })) === 'Assigned to Vera' && eventTitle(ev({ kind: 'ASSIGNED', assignedFrom: 'Vera', assignedTo: 'Leo' })) === 'Reassigned from Vera to Leo');
  ok('notes say who sees them', eventTitle(ev({ visibility: 'AGENCY' })) === 'Note shared with the agency' && eventTitle(ev({})) === 'Internal note');
  ok('documents too', eventTitle(ev({ kind: 'DOCUMENT_ADDED', visibility: 'AGENCY' })).includes('shared') && eventTitle(ev({ kind: 'DOCUMENT_ADDED' })).includes('internal'));
  const lines = reclassifiedLines({ from: { complexity: 'STANDARD', priority: 'NORMAL', billableUnits: 1, nonBillable: false }, to: { complexity: 'COMPLEX', priority: 'URGENT', billableUnits: 3, nonBillable: true }, dueAtFrom: 'x', dueAtTo: 'y' });
  ok('a reclassification lists each change', lines.join('|') === 'Complexity: Standard → Complex|Priority: Normal → Urgent|Billable units: 1 → 3|Non-billable: no → yes|Due date recalculated for the new target', lines.join('|'));

  console.log('The review form');
  const task = { complexity: 'STANDARD' as const, priority: 'NORMAL' as const, billing: { units: 1, nonBillable: false } };
  const form = { complexity: 'STANDARD' as const, priority: 'NORMAL' as const, billableUnits: '1', nonBillable: false, reason: '' };
  const r = (o: object) => reviewBody(task, { ...form, ...o });
  ok('nothing changed: nothing to send', 'problem' in r({ reason: 'x' }) && (r({ reason: 'x' }) as { problem: string }).problem === 'Change something first.');
  ok('a change needs a reason', 'problem' in r({ complexity: 'COMPLEX' }));
  ok('only what changed is sent, with the reason', JSON.stringify(r({ complexity: 'COMPLEX', billableUnits: ' 1 ', reason: ' more locations ' })) === JSON.stringify({ body: { complexity: 'COMPLEX', reason: 'more locations' } }));
  ok('units must be whole, 1 to 50', ['0', '51', '1.5', 'two', ''].every((u) => 'problem' in r({ billableUnits: u, reason: 'x' })) && 'body' in r({ billableUnits: '50', reason: 'x' }));
  ok('no billing shown (a VA): billing never sent', JSON.stringify(reviewBody({ complexity: 'STANDARD', priority: 'NORMAL' }, { ...form, priority: 'HIGH', billableUnits: 'junk', nonBillable: true, reason: 'x' })) === JSON.stringify({ body: { priority: 'HIGH', reason: 'x' } }));
}

(async () => {
  try {
    rules();

    const mkUser = async (n: string, role: UserRole, agencyId: string | null = null) => {
      const u = await prisma.user.create({ data: { email: `${TAG}-${n}@example.test`, role, agencyId, firstName: `${TAG}${n}`, lastName: 'Person', mustChangePassword: false } });
      cleanup.userIds.push(u.id); return u;
    };
    const A = await prisma.agency.create({ data: { name: `${TAG} A`, deskEnabled: true } }); cleanup.agencyIds.push(A.id);
    const admin = await mkUser('admin', 'ADMIN', A.id);
    const am = await mkUser('am', 'ACCOUNT_MANAGER');
    const ops = await mkUser('ops', 'DESK_ADMIN');
    const va = await mkUser('va', 'DESK_VA');
    const va2 = await mkUser('va2', 'DESK_VA');
    const pod = await prisma.pod.create({ data: { code: TAG, name: `${TAG} Pod` } }); cleanup.podIds.push(pod.id);
    await prisma.podMember.createMany({ data: [{ podId: pod.id, userId: va.id }, { podId: pod.id, userId: va2.id }] });
    await prisma.agencyPodAccess.create({ data: { agencyId: A.id, podId: pod.id } });
    await prisma.agencyDeskAssignment.create({ data: { agencyId: A.id, primaryAmId: am.id } });
    // This agency's own targets, which outrank every Desk-wide default.
    const [tStd, tComplex, tUrgent] = await Promise.all([
      prisma.serviceLevelTarget.create({ data: { taskType: 'ENDORSEMENT', agencyId: A.id, businessHours: 8 } }),
      prisma.serviceLevelTarget.create({ data: { taskType: 'ENDORSEMENT', agencyId: A.id, complexity: 'COMPLEX', businessHours: 24 } }),
      prisma.serviceLevelTarget.create({ data: { taskType: 'ENDORSEMENT', agencyId: A.id, priority: 'URGENT', businessHours: 2 } }),
    ]);

    const scope = (u: { id: string }) => resolveDeskScope(prisma, u.id);
    const [sAdmin, sAm, sOps, sVa, sVa2] = await Promise.all([admin, am, ops, va, va2].map(scope));
    const calendar = await loadBusinessCalendar(prisma);

    console.log('Reclassifying');
    const filed = await service.createTask(prisma, sAdmin, { type: 'ENDORSEMENT', title: `${TAG} add a driver` });
    // Routing rules are Desk-wide; keep this request in the temporary pod.
    await prisma.task.update({ where: { id: filed.id }, data: { podId: pod.id } });
    const applied = (filed.slaTarget as { targetId: string; appliedAt: string });
    ok('filed under the agency\'s standard target', applied.targetId === tStd.id && !!filed.dueAt);
    const startAt = new Date(applied.appliedAt);
    const complex = await service.reviewTask(prisma, sAm, filed.id, { complexity: 'COMPLEX', reason: 'Three vehicles and two drivers' });
    const expected = computeDueAt(tComplex, { startAt }, calendar)!.dueAt;
    ok('complex: the complex target, due date worked out from when the clock started', complex.complexity === 'COMPLEX' && (complex.slaTarget as { targetId: string }).targetId === tComplex.id && complex.dueAt?.getTime() === expected.getTime() && complex.slaDueAt?.getTime() === expected.getTime(), `${complex.dueAt?.toISOString()} vs ${expected.toISOString()}`);
    ok('the clock start is kept', (complex.slaTarget as { appliedAt: string }).appliedAt === applied.appliedAt);
    const event = await prisma.taskEvent.findFirst({ where: { taskId: filed.id, kind: 'RECLASSIFIED' } });
    ok('in the internal history, with the reason and what changed', event?.visibility === 'INTERNAL' && event.body === 'Three vehicles and two drivers' && JSON.stringify((event.metadata as Json).to) === '{"complexity":"COMPLEX"}' && !!(event.metadata as Json).dueAtTo);
    const audit = await prisma.deskAuditLog.findFirst({ where: { entityId: filed.id, action: 'task.reclassified' } });
    ok('audited with the facts, not the reason', !!audit && (audit.metadata as Json).targetTo === tComplex.id && !JSON.stringify(audit.metadata).includes('Three vehicles'));

    const urgent = await service.reviewTask(prisma, sOps, filed.id, { priority: 'URGENT', reason: 'Closing tomorrow' });
    ok('urgent outranks complex: the urgent target', (urgent.slaTarget as { targetId: string }).targetId === tUrgent.id && urgent.dueAt?.getTime() === computeDueAt(tUrgent, { startAt }, calendar)!.dueAt.getTime());

    await prisma.task.update({ where: { id: filed.id }, data: { slaPausedMinutes: 90 } });
    const back = await service.reviewTask(prisma, sAm, filed.id, { priority: 'NORMAL', complexity: 'STANDARD', reason: 'Simpler than it looked' });
    const base = computeDueAt(tStd, { startAt }, calendar)!.dueAt;
    ok('time already spent waiting still doesn\'t count', back.dueAt?.getTime() === addBusinessMinutes(base, 90, calendar).getTime() && back.slaDueAt?.getTime() === base.getTime());

    const billing = await service.reviewTask(prisma, sAm, filed.id, { billableUnits: 3, nonBillable: true, reason: 'Three endorsements in one' });
    ok('billing review: units and non-billable, due date untouched', billing.billableUnits === 3 && billing.nonBillable && billing.dueAt?.getTime() === back.dueAt?.getTime());
    const billingEvent = await prisma.taskEvent.findFirst({ where: { taskId: filed.id, kind: 'RECLASSIFIED' }, orderBy: { createdAt: 'desc' } });
    ok('and no due-date line for it', !('dueAtTo' in ((billingEvent?.metadata ?? {}) as object)));

    console.log('What is refused');
    const no = (input: object, s = sAm, id = filed.id) => refusal(() => service.reviewTask(prisma, s, id, input));
    ok('nothing changed: 400', (await no({ billableUnits: 3, reason: 'x' }))?.status === 400);
    ok('no reason: 400', (await no({ billableUnits: 2 }))?.status === 400 && (await no({ billableUnits: 2, reason: '   ' }))?.status === 400);
    ok('a reason over 500 characters: 400', (await no({ billableUnits: 2, reason: 'x'.repeat(501) }))?.status === 400);
    ok('bad values: 400', (await Promise.all([{ complexity: 'HUGE' }, { priority: 'SOON' }, { billableUnits: 0 }, { billableUnits: 51 }, { billableUnits: 1.5 }, { billableUnits: '2' }, { nonBillable: 'yes' }].map((i) => no({ ...i, reason: 'x' })))).every((r) => r?.status === 400));
    const vaTry = await no({ complexity: 'COMPLEX', reason: 'x' }, sVa);
    ok('a VA can\'t: 403', vaTry?.status === 403);
    ok('and the attempt is logged', (await prisma.deskAuditLog.findMany({ where: { action: 'access.denied', actorId: va.id, entityId: filed.id } })).some((l) => (l.metadata as Json)?.op === 'review'));
    ok('nor the agency: 403', (await no({ complexity: 'COMPLEX', reason: 'x' }, sAdmin))?.status === 403);
    const raced = new Proxy(prisma, { get: (t, p) => (p === '$transaction'
      ? async (...args: unknown[]) => { await prisma.task.update({ where: { id: filed.id }, data: { title: `${TAG} add a driver (edited)` } }); return (prisma.$transaction as (...a: unknown[]) => unknown)(...args); }
      : Reflect.get(t, p)) }) as PrismaClient;
    ok('changed by someone else meanwhile: 409, nothing saved', (await refusal(() => service.reviewTask(raced, sAm, filed.id, { billableUnits: 5, reason: 'x' })))?.status === 409 && (await prisma.task.findUniqueOrThrow({ where: { id: filed.id } })).billableUnits === 3);
    const closed = await prisma.task.create({ data: { reference: 950_000_000 + (Date.now() % 40_000_000), agencyId: A.id, podId: pod.id, type: 'COI', title: `${TAG} done`, createdById: admin.id, restrictedToUserIds: [], status: 'COMPLETED', completedAt: new Date() } });
    ok('closed work: 409, reopen first', (await no({ complexity: 'COMPLEX', reason: 'x' }, sAm, closed.id))?.status === 409);

    console.log('What the workspace offers each person');
    const perms = async (s: Awaited<ReturnType<typeof scope>>, id: string) => (await getTaskDetail(prisma, s, id) as Json).permissions;
    const vaNew = await perms(sVa, filed.id);
    ok('a VA on unassigned work: pick up, nothing else', vaNew.pickUp && !vaNew.release && !vaNew.assign && !vaNew.review && vaNew.statusMoves.length === 0);
    await service.assignTask(prisma, sVa, filed.id, va.id);
    const vaHeld = await perms(sVa, filed.id);
    ok('holding it: start, wait, cancel and release', !vaHeld.pickUp && vaHeld.release && vaHeld.statusMoves.join() === 'IN_PROGRESS,WAITING_ON_AGENCY,WAITING_ON_CARRIER,WAITING_ON_INSURED,CANCELLED');
    const other = await perms(sVa2, filed.id);
    ok('a colleague sees it but can\'t change it', !other.pickUp && !other.release && other.statusMoves.length === 0);
    const amPerms = await perms(sAm, filed.id);
    ok('an Account Manager: assign, review and every move', amPerms.assign && amPerms.review && amPerms.statusMoves.includes('IN_PROGRESS') && !amPerms.release);
    const closedPerms = await perms(sAm, closed.id);
    ok('closed: only reopen, no review, no new documents', closedPerms.statusMoves.join() === '' && !closedPerms.review && !closedPerms.assign && !closedPerms.addDocuments, JSON.stringify(closedPerms));
    ok('the agency\'s view has no permissions block', !('permissions' in (await getTaskDetail(prisma, sAdmin, filed.id) as object)));

    console.log('The real routes');
    const [tAm, tVa, tAdmin] = await Promise.all([am, va, admin].map((u) => createSession(u.id)));
    const saved = await json(await reviewRoute(req(`/api/desk/tasks/${filed.id}/review`, tAm, { billableUnits: 2, reason: 'Two changes' }), ctx(filed.id)));
    ok('review: 200, the staff view back', saved.status === 200 && saved.json.billing.units === 2);
    ok('review: a VA, 403', (await reviewRoute(req(`/api/desk/tasks/${filed.id}/review`, tVa, { billableUnits: 4, reason: 'x' }), ctx(filed.id))).status === 403);
    ok('review: the agency, 403', (await reviewRoute(req(`/api/desk/tasks/${filed.id}/review`, tAdmin, { billableUnits: 4, reason: 'x' }), ctx(filed.id))).status === 403);
    ok('review: not JSON, 400', (await reviewRoute(new NextRequest(`http://local.test/api/desk/tasks/${filed.id}/review`, { method: 'POST', headers: { cookie: `session_token=${tAm}` }, body: 'nope' }), ctx(filed.id))).status === 400);
    const detail = await json(await detailRoute(req(`/api/desk/tasks/${filed.id}`, tVa), ctx(filed.id)));
    ok('detail for the VA: permissions, history, no billing', detail.status === 200 && detail.json.permissions.release && detail.json.events.some((e: Json) => e.kind === 'RECLASSIFIED') && !('billing' in detail.json));
    const reclass = detail.json.events.find((e: Json) => e.kind === 'RECLASSIFIED');
    ok('a VA sees that it was reclassified, not the billing details', reclass.body && JSON.stringify(reclass.details) === '{}');
    const agencyDetail = await json(await detailRoute(req(`/api/desk/tasks/${filed.id}`, tAdmin), ctx(filed.id)));
    ok('the agency never sees a reclassification', !agencyDetail.json.events.some((e: Json) => e.kind === 'RECLASSIFIED') && !JSON.stringify(agencyDetail.json).includes('Three vehicles'));

    console.log('The screens');
    const page = read('app/(desk)/desk-ops/tasks/[id]/page.tsx');
    const screen = read('app/components/desk/workspace/TaskWorkspace.tsx');
    ok('a page of the operations area, checked on the server', page.includes("deskPageAccess('OPS', '/desk-ops/my-tasks')") && page.includes('<TaskWorkspace key={id} taskId={id} userId={access.user.id} />'));
    ok('queue and My tasks link to it', read('app/components/desk/queue/TaskQueue.tsx').includes('href={`/desk-ops/tasks/${task.id}`}'));
    ok('only the moves the server allows are offered', screen.includes('p.statusMoves.map((to)'));
    ok('notes are internal unless shared', screen.includes("note.shared ? 'AGENCY' : 'INTERNAL'") && screen.includes("useState({ body: '', shared: false })"));
    ok('documents are internal unless shared, and need a category', screen.includes("upload.shared ? 'AGENCY' : 'INTERNAL'") && screen.includes("sensitivity: ''") && screen.includes('!upload.sensitivity'));
    ok('completing and releasing ask first', screen.includes('Mark #${task.reference} as completed?') && screen.includes('Return #${task.reference} to the Pod queue?'));
    ok('the review sends only what changed', screen.includes("post('review', reviewCheck.body)"));
  } catch (err) {
    console.error(err);
    fail++;
  } finally {
    await wipe().catch((err) => { console.error('cleanup failed', err); fail++; });
    const left = await prisma.user.count({ where: { email: { startsWith: TAG } } }) + await prisma.agency.count({ where: { name: { startsWith: TAG } } }) + await prisma.pod.count({ where: { code: { startsWith: TAG } } });
    ok('temporary records removed', left === 0);
    console.log(`\n${pass} passed, ${fail} failed`);
    await prisma.$disconnect();
    process.exit(fail ? 1 : 0);
  }
})();
