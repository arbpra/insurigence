/**
 * Module 38: subtasks.
 *
 *   npx tsx script/verify-desk-subtasks.ts
 *
 * Adding a subtask (who may, on which requests, what it inherits and how it
 * is routed and billed), each refusal logged; one level only; the request and
 * its subtasks shown to staff, and never to the agency; the parent completion
 * rule (including a subtask added at the same moment); cancelling a request
 * cancels its open subtasks; a subtask reopens only within an open request;
 * the real route; the screens. Against the shared database, with temporary
 * agencies, people, pods and requests, all removed at the end. Emails are
 * off for this run.
 */
import 'dotenv/config';
import { readFileSync } from 'fs';
import { NextRequest } from 'next/server';
import type { UserRole } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { createSession } from '../lib/auth';
import { DeskAccessError, resolveDeskScope, type DeskScope } from '../lib/desk/access';
import { getTaskDetail, listTasks, setTaskAssignee, setTaskStatus, submitSubtask, submitTask } from '../lib/desk/task-api';
import { eventTitle, type StaffEvent } from '../lib/desk/task-workspace';
import { createSubtask } from '../lib/desk/tasks';
import { POST as subtaskRoute } from '../app/api/desk/tasks/[id]/subtasks/route';

process.env.DESK_EMAIL_NOTIFICATIONS = 'off';

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, detail = '') => {
  c ? pass++ : fail++;
  console.log(`  ${c ? '✓' : '✗'} ${n}${!c && detail ? `  [${detail}]` : ''}`);
  if (!c && process.env.FAIL_FAST) throw new Error(`stopped at: ${n}`);
};

const TAG = `m38test${Date.now()}`;
const cleanup = { agencyIds: [] as string[], userIds: [] as string[], podIds: [] as string[] };
const read = (p: string) => readFileSync(p, 'utf8');
type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any

async function wipe() {
  const agencyId = { in: cleanup.agencyIds };
  await prisma.taskEvent.deleteMany({ where: { agencyId } });
  // Leaves first, so a subtask is never deleted before one of its own (should a
  // fault ever let one be made).
  for (let left = 1; left > 0;) {
    const parents = (await prisma.task.findMany({ where: { agencyId, parentTaskId: { not: null } }, select: { parentTaskId: true } })).map((t) => t.parentTaskId!);
    await prisma.task.deleteMany({ where: { agencyId, id: { notIn: parents } } });
    left = await prisma.task.count({ where: { agencyId } });
  }
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
  console.log('Wording');
  const e = (details: Record<string, unknown>) => ({ id: 'x', kind: 'SUBTASK_CREATED', visibility: 'INTERNAL', actorName: null, body: null, fromStatus: null, toStatus: null, details, createdAt: '' }) as StaffEvent;
  ok('the request\'s history names the subtask', eventTitle(e({ reference: 1042 })) === 'Subtask #1042 added' && eventTitle(e({})) === 'Subtask added');
}

(async () => {
  try {
    pureLogic();

    const mkAgency = async (n: string) => { const a = await prisma.agency.create({ data: { name: `${TAG} ${n}`, deskEnabled: true } }); cleanup.agencyIds.push(a.id); return a; };
    const mkUser = async (n: string, role: UserRole, agencyId: string | null = null) => {
      const u = await prisma.user.create({ data: { email: `${TAG}-${n}@example.test`, role, agencyId, firstName: `${TAG}${n}`, passwordHash: 'x', mustChangePassword: false } });
      cleanup.userIds.push(u.id); return u;
    };
    const mkPod = async (n: string) => { const p = await prisma.pod.create({ data: { code: `${TAG}${n}`, name: `${TAG} ${n}` } }); cleanup.podIds.push(p.id); return p; };
    const A = await mkAgency('Harbor');
    const B = await mkAgency('Summit');
    const owner = await mkUser('owner', 'ADMIN', A.id);
    const am = await mkUser('am', 'ACCOUNT_MANAGER');
    const otherAm = await mkUser('otheram', 'ACCOUNT_MANAGER');
    const ops = await mkUser('ops', 'DESK_ADMIN');
    const va = await mkUser('va', 'DESK_VA');
    const va2 = await mkUser('va2', 'DESK_VA');
    await prisma.agencyDeskAssignment.createMany({ data: [{ agencyId: A.id, primaryAmId: am.id }, { agencyId: B.id, primaryAmId: otherAm.id }] });
    const P1 = await mkPod('One');
    const P2 = await mkPod('Two');
    await prisma.podMember.createMany({ data: [{ podId: P1.id, userId: va.id }, { podId: P2.id, userId: va2.id }] });
    await prisma.agencyPodAccess.createMany({ data: [{ agencyId: A.id, podId: P1.id }, { agencyId: A.id, podId: P2.id }] });
    const acme = await prisma.insuredAccount.create({ data: { agencyId: A.id, name: `${TAG} Acme Trucking`, nameKey: `${TAG} acme trucking` } });
    const scope = (u: { id: string }) => resolveDeskScope(prisma, u.id);
    const [sOwner, sAm, sOther, sOps, sVa, sVa2] = await Promise.all([owner, am, otherAm, ops, va, va2].map(scope));

    /** A request from the agency, in pod One, held by the VA. */
    const request = async (title: string, extra: object = {}) => {
      const view = await submitTask(prisma, sOwner, { type: 'COI', title: `${TAG} ${title}`, insuredId: acme.id, ...extra }) as Json;
      await prisma.task.update({ where: { id: view.id }, data: { podId: P1.id } });
      await setTaskAssignee(prisma, sAm, view.id, { assigneeId: va.id });
      return view.id as string;
    };
    const sub = (s: DeskScope, parentId: string, title: string, type = 'OTHER', extra: object = {}) =>
      submitSubtask(prisma, s, parentId, { type, title: `${TAG} ${title}`, ...extra }) as Promise<Json>;
    const row = (id: string) => prisma.task.findUniqueOrThrow({ where: { id } });

    console.log('Adding a subtask');
    const R1 = await request('Renewal paperwork', { priority: 'URGENT' });
    await prisma.task.update({ where: { id: R1 }, data: { restrictedToUserIds: [va.id], restrictionReason: 'VIP' } });
    const s1 = await sub(sAm, R1, 'Update the AMS', 'OTHER', { description: 'Policy number changed' });
    const s1Row = await row(s1.id);
    const r1Row = await row(R1);
    ok('the AM adds one: it belongs to the request', s1Row.parentTaskId === R1 && s1.parent?.reference === r1Row.reference);
    ok('the agency, account and policy come from the request', s1Row.agencyId === A.id && s1Row.insuredId === acme.id && s1Row.policyId === r1Row.policyId);
    ok('a type with no routing rule: the request\'s pod', s1Row.podId === P1.id);
    ok('the request\'s priority, and its need-to-know restriction', s1Row.priority === 'URGENT' && s1Row.restrictedToUserIds.join() === va.id && s1Row.restrictionReason === 'VIP');
    ok('internal and non-billable, filed by the AM', s1Row.source === 'INTERNAL' && s1Row.nonBillable === true && s1Row.createdById === am.id && s1Row.status === 'NEW');
    const qaRule = await prisma.taskRoutingRule.findFirst({ where: { taskType: 'QA_REVIEW', isActive: true, pod: { isActive: true } } });
    const sQa = await sub(sAm, R1, 'Check the certificate', 'QA_REVIEW');
    ok('a type with a routing rule goes to that pod', (await row(sQa.id)).podId === (qaRule?.podId ?? P1.id));
    const sVaMade = await sub(sVa, R1, 'Ask the carrier', 'OTHER');
    ok('the VA who holds the request can add one', (await row(sVaMade.id)).createdById === va.id);
    const subEvents = await prisma.taskEvent.findMany({ where: { taskId: s1.id } });
    ok('the subtask\'s history is internal', subEvents.some((e) => e.kind === 'CREATED') && subEvents.every((e) => e.visibility === 'INTERNAL'), subEvents.map((e) => `${e.kind}:${e.visibility}`).join());
    const parentEvent = await prisma.taskEvent.findFirst({ where: { taskId: R1, kind: 'SUBTASK_CREATED', body: `${TAG} Update the AMS` } });
    ok('the request\'s history records it, internally', !!parentEvent && parentEvent.visibility === 'INTERNAL' && (parentEvent.metadata as Json).subtaskId === s1.id && (parentEvent.metadata as Json).reference === s1Row.reference);
    const audit = await prisma.deskAuditLog.findFirst({ where: { action: 'task.created', entityId: s1.id } });
    ok('audited, with its request', (audit?.metadata as Json)?.parentTaskId === R1 && (audit?.metadata as Json)?.parentReference === r1Row.reference);

    console.log('Who may, and where');
    const R2 = await request('Endorsement');
    await setTaskAssignee(prisma, sAm, R2, { assigneeId: null });
    const notHeld = await refusal(() => sub(sVa, R2, 'nope'));
    ok('a VA who doesn\'t hold the request: 403, logged', notHeld?.status === 403
      && !!(await prisma.deskAuditLog.findFirst({ where: { actorId: va.id, action: 'access.denied', entityId: R2 } })));
    const byAgency = await refusal(() => sub(sOwner, R2, 'nope'));
    ok('the agency: 403, logged', byAgency?.status === 403 && byAgency.message === 'Subtasks are added by the Desk team.'
      && !!(await prisma.deskAuditLog.findFirst({ where: { actorId: owner.id, action: 'access.denied', entityId: R2 } })));
    ok('another agency\'s AM: not found', (await refusal(() => sub(sOther, R2, 'nope')))?.status === 404);
    ok('an Operations Manager can', !!(await sub(sOps, R2, 'Ops subtask')).id);
    ok('a subtask of a subtask: refused', (await refusal(() => sub(sAm, s1.id, 'nope')))?.status === 400);
    ok('no type, an unknown type, no title: refused', (await refusal(() => sub(sAm, R2, 'x', 'NOPE')))?.status === 400
      && (await refusal(() => submitSubtask(prisma, sAm, R2, { type: 'OTHER', title: '  ' })))?.status === 400
      && (await refusal(() => submitSubtask(prisma, sAm, R2, { title: 'x' })))?.status === 400);
    ok('nothing was added by anyone refused', await prisma.task.count({ where: { title: `${TAG} nope` } }) === 0);

    console.log('Shown to staff, never to the agency');
    const amView = await getTaskDetail(prisma, sAm, R1) as Json;
    ok('the request lists its subtasks, oldest first', amView.subtasks.map((s: Json) => s.id).join() === [s1.id, sQa.id, sVaMade.id].join());
    ok('with type, status and who has it', amView.subtasks[0].typeLabel === 'Other' && amView.subtasks[0].statusLabel === 'New' && amView.subtasks[0].assignee === null);
    ok('how many are open, and the AM may add more', amView.openSubtasks === 3 && amView.permissions.addSubtask === true);
    ok('Complete isn\'t offered while subtasks are open', !amView.permissions.statusMoves.includes('COMPLETED'));
    const vaView = await getTaskDetail(prisma, sVa, R1) as Json;
    ok('the VA sees the ones in their pods; the rest only as a count', vaView.subtasks.length === (qaRule ? 2 : 3) && vaView.hiddenSubtasks === (qaRule ? 1 : 0) && vaView.openSubtasks === 3);
    ok('the VA holding it may add subtasks; on one nobody holds, not offered', vaView.permissions.addSubtask === true
      && (await getTaskDetail(prisma, sVa, R2) as Json).permissions.addSubtask === false);
    const subView = await getTaskDetail(prisma, sAm, s1.id) as Json;
    ok('a subtask names its request, and can\'t have its own', subView.parentRequest.canOpen && subView.parentRequest.id === R1 && subView.parentRequest.title === `${TAG} Renewal paperwork`
      && subView.parentRequest.reference === r1Row.reference && subView.permissions.addSubtask === false && !('subtasks' in subView));
    await prisma.task.update({ where: { id: sVaMade.id }, data: { podId: P2.id, restrictedToUserIds: [] } });
    const va2View = await getTaskDetail(prisma, sVa2, sVaMade.id) as Json;
    ok('a VA who can open the subtask but not its request: the number only', va2View.parentRequest.canOpen === false && va2View.parentRequest.title === null && va2View.parentRequest.id === null && va2View.parentRequest.reference === r1Row.reference);
    ok('the agency can\'t open a subtask, even by its address', (await refusal(() => getTaskDetail(prisma, sOwner, s1.id)))?.status === 404);
    const ownerView = await getTaskDetail(prisma, sOwner, R1) as Json;
    ok('the agency\'s request shows no subtasks or their history', !('subtasks' in ownerView) && !JSON.stringify(ownerView).includes('Update the AMS') && !ownerView.events.some((e: Json) => e.kind === 'SUBTASK_CREATED'));
    const agencyList = await listTasks(prisma, sOwner, { pageSize: 100 }) as Json;
    ok('nor in the agency\'s list', agencyList.rows.length > 0 && !agencyList.rows.some((r: Json) => r.id === s1.id));
    const staffList = await listTasks(prisma, sAm, { pageSize: 100 }) as Json;
    const s1Listed = staffList.rows.find((r: Json) => r.id === s1.id);
    ok('staff lists show a subtask with its request\'s number', s1Listed?.parent?.reference === r1Row.reference && staffList.rows.find((r: Json) => r.id === R1)?.parent === null);

    console.log('The parent completion rule');
    await setTaskStatus(prisma, sVa, R1, { status: 'IN_PROGRESS' });
    const inProgress = (await getTaskDetail(prisma, sVa, R1) as Json).permissions.statusMoves as string[];
    ok('in progress with open subtasks: other moves offered, Complete not', inProgress.length > 0 && !inProgress.includes('COMPLETED'), inProgress.join());
    const early = await refusal(() => setTaskStatus(prisma, sVa, R1, { status: 'COMPLETED' }));
    const r1After = await row(R1);
    ok('completing a request with open subtasks: 409, and why', early?.status === 409 && early.code === 'OPEN_SUBTASKS' && early.message === 'Finish or cancel its 3 open subtasks first.', early?.message);
    ok('nothing changed, nothing counted toward the plan', r1After.status === 'IN_PROGRESS' && !r1After.billingClass && !r1After.completedAt);
    await setTaskAssignee(prisma, sAm, s1.id, { assigneeId: va.id });
    await setTaskStatus(prisma, sVa, s1.id, { status: 'IN_PROGRESS' });
    await setTaskStatus(prisma, sVa, s1.id, { status: 'COMPLETED' });
    ok('a completed subtask is non-billable', (await row(s1.id)).billingClass === 'NON_BILLABLE');
    await setTaskStatus(prisma, sAm, sQa.id, { status: 'CANCELLED', reason: 'Not needed' });
    ok('one open left: told so', (await refusal(() => setTaskStatus(prisma, sVa, R1, { status: 'COMPLETED' })))?.message === 'Finish or cancel its open subtask first.');
    await setTaskStatus(prisma, sAm, sVaMade.id, { status: 'CANCELLED', reason: 'Done by phone' });
    ok('Complete is offered again', (await getTaskDetail(prisma, sVa, R1) as Json).permissions.statusMoves.includes('COMPLETED'));
    await setTaskStatus(prisma, sVa, R1, { status: 'COMPLETED' });
    ok('all closed: the request completes', (await row(R1)).status === 'COMPLETED');
    // A request closed while a subtask was being added: the first read still says open,
    // so only the check inside the save can refuse it.
    type FindFirst = (a: unknown) => Promise<{ id: string } | null>;
    const stale = new Proxy(prisma, { get(t, k) {
      const v = Reflect.get(t, k);
      if (k !== 'task') return typeof v === 'function' ? v.bind(t) : v;
      return new Proxy(t.task, { get(tt, kk) {
        const f = Reflect.get(tt, kk);
        if (kk !== 'findFirst') return typeof f === 'function' ? f.bind(tt) : f;
        return async (a: unknown) => { const found = await (f as FindFirst).call(tt, a); return found?.id === R1 ? { ...found, status: 'IN_PROGRESS' } : found; };
      } });
    } }) as typeof prisma;
    const raced = await refusal(() => createSubtask(stale, sAm, R1, { type: 'OTHER', title: `${TAG} nope` }));
    ok('closed while a subtask was being added: 409, nothing added', raced?.status === 409 && await prisma.task.count({ where: { title: `${TAG} nope` } }) === 0, raced?.message);

    console.log('Closed requests');
    ok('no subtask on a closed request', (await refusal(() => sub(sAm, R1, 'late')))?.status === 409);
    const reopenSub = await refusal(() => setTaskStatus(prisma, sAm, s1.id, { status: 'IN_PROGRESS', reason: 'redo' }));
    ok('a subtask reopens only within an open request', reopenSub?.status === 409 && reopenSub.message === `Request #${r1Row.reference} is closed. Reopen it first.`);
    await setTaskStatus(prisma, sAm, R1, { status: 'IN_PROGRESS', reason: 'Agency asked for a change' });
    await setTaskStatus(prisma, sAm, s1.id, { status: 'IN_PROGRESS', reason: 'redo' });
    ok('reopen the request, then the subtask', (await row(s1.id)).status === 'IN_PROGRESS');

    console.log('Cancelling a request');
    const R3 = await request('Cancel me');
    const c1 = await sub(sAm, R3, 'piece one');
    const c2 = await sub(sAm, R3, 'piece two');
    const c3 = await sub(sAm, R3, 'piece three');
    await setTaskAssignee(prisma, sAm, c2.id, { assigneeId: va.id });
    await setTaskStatus(prisma, sVa, c2.id, { status: 'IN_PROGRESS' });
    await setTaskStatus(prisma, sAm, c3.id, { status: 'CANCELLED', reason: 'dup' });
    await setTaskAssignee(prisma, sAm, c1.id, { assigneeId: va.id });
    await setTaskStatus(prisma, sVa, c1.id, { status: 'IN_PROGRESS' });
    await setTaskStatus(prisma, sVa, c1.id, { status: 'COMPLETED' });
    const c4 = await sub(sAm, R3, 'piece four');
    await setTaskStatus(prisma, sAm, R3, { status: 'CANCELLED', reason: 'Agency withdrew it' });
    const [k1, k2, k3, k4] = await Promise.all([c1, c2, c3, c4].map((c) => row(c.id)));
    ok('its open subtasks are cancelled with it', k2.status === 'CANCELLED' && k4.status === 'CANCELLED' && !!k2.cancelledAt);
    ok('finished ones are left as they were', k1.status === 'COMPLETED' && k3.status === 'CANCELLED');
    const cascade = await prisma.taskEvent.findFirst({ where: { taskId: c2.id, kind: 'STATUS_CHANGED', toStatus: 'CANCELLED' } });
    ok('each says why, internally', cascade?.body === `Request #${(await row(R3)).reference} was cancelled.` && cascade.visibility === 'INTERNAL' && (cascade.metadata as Json).automatic === 'parent_cancelled' && cascade.fromStatus === 'IN_PROGRESS');
    const cancelAudit = (await prisma.deskAuditLog.findMany({ where: { action: 'task.status_changed', entityId: R3 } })).find((l) => (l.metadata as Json)?.to === 'CANCELLED');
    ok('audited with the subtasks it cancelled', JSON.stringify((cancelAudit?.metadata as Json)?.subtasksCancelled?.slice().sort()) === JSON.stringify([c2.id, c4.id].sort()));
    const R4 = await request('Agency cancels');
    await setTaskAssignee(prisma, sAm, R4, { assigneeId: null });
    const a1 = await sub(sAm, R4, 'agency cancel piece');
    await setTaskStatus(prisma, sOwner, R4, { status: 'CANCELLED', reason: 'Not needed after all' });
    ok('the agency cancelling its request cancels the team\'s subtasks too', (await row(a1.id)).status === 'CANCELLED');

    console.log('A subtask added while the request completes');
    let consistent = true, bothOk = 0;
    for (let i = 0; i < 3; i++) {
      const Rc = await request(`Race ${i}`);
      await setTaskStatus(prisma, sVa, Rc, { status: 'IN_PROGRESS' });
      const [made, done] = await Promise.allSettled([sub(sAm, Rc, `race piece ${i}`), setTaskStatus(prisma, sVa, Rc, { status: 'COMPLETED' })]);
      if (made.status === 'fulfilled' && done.status === 'fulfilled') bothOk++;
      const p = await row(Rc);
      const open = await prisma.task.count({ where: { parentTaskId: Rc, status: { notIn: ['COMPLETED', 'CANCELLED'] } } });
      if (p.status === 'COMPLETED' && open > 0) consistent = false;
    }
    ok('never a completed request with an open subtask', consistent && bothOk === 0, `both succeeded ${bothOk}×`);

    console.log('The real route');
    const tAm = await createSession(am.id);
    const tOwner = await createSession(owner.id);
    const ctx = { params: Promise.resolve({ id: R2 }) };
    const post = (token: string, body: unknown) => subtaskRoute(new NextRequest(`http://local.test/api/desk/tasks/${R2}/subtasks`, {
      method: 'POST', headers: { cookie: `session_token=${token}`, 'content-type': 'application/json' }, body: typeof body === 'string' ? body : JSON.stringify(body),
    }), ctx);
    const made = await post(tAm, { type: 'OTHER', title: `${TAG} via the route` });
    ok('POST …/subtasks: 201, the subtask', made.status === 201 && ((await made.json()) as Json).parent?.id === R2);
    ok('the agency: 403; not JSON: 400', (await post(tOwner, { type: 'OTHER', title: 'x' })).status === 403 && (await post(tAm, 'nope')).status === 400);

    console.log('The screens');
    const ws = read('app/components/desk/workspace/TaskWorkspace.tsx');
    ok('the workspace lists subtasks and adds them', ws.includes("post('subtasks'") && ws.includes('data-testid="desk-task-subtasks"') && ws.includes('{p.addSubtask && !subtask'));
    ok('it explains the completion rule and the cascade', ws.includes('finished or cancelled.') && ws.includes('will be cancelled too.'));
    ok('a subtask links to its request, or names it when it\'s another team\'s', ws.includes('href={`/desk-ops/tasks/${task.parentRequest.id}`}') && ws.includes('handled by another team'));
    ok('queue rows say which request a subtask is part of', read('app/components/desk/queue/TaskQueue.tsx').includes("{task.followUp ? 'Follow-up to' : 'Subtask of'} #{task.parent.reference}"));
  } catch (err) {
    fail++;
    console.error(err);
  } finally {
    await wipe();
    const left = await prisma.user.count({ where: { email: { startsWith: TAG } } }) + await prisma.task.count({ where: { title: { startsWith: TAG } } })
      + await prisma.pod.count({ where: { code: { startsWith: TAG } } });
    ok('nothing left behind', left === 0);
    await prisma.$disconnect();
    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
  }
})();
