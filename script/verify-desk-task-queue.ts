/**
 * Module 31: the Pod queue and My tasks.
 *
 *   npx tsx script/verify-desk-task-queue.ts
 *
 * The screen rules (filters, address, API query, due labels) on their own;
 * the queue options and "who can take this" through the service and the real
 * routes, against the shared database, using temporary agencies, pods and
 * people removed at the end; and the pick-up / start / release flow as a VA
 * would run it.
 */
import 'dotenv/config';
import { readFileSync } from 'fs';
import { NextRequest } from 'next/server';
import type { UserRole } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { createSession } from '../lib/auth';
import { DeskAccessError, resolveDeskScope } from '../lib/desk/access';
import {
  DEFAULT_QUEUE_FILTERS, DUE_SOON_MS, MINE_VIEWS, dueLabel, hasQueueFilters, lastQueuePage, parseQueueFilters, queueApiQuery, queuePageQuery,
} from '../lib/desk/queue-view';
import { assigneesFor, queueOptions } from '../lib/desk/task-queue';
import { assignTask } from '../lib/desk/tasks';
import { GET as listRoute } from '../app/api/desk/tasks/route';
import { GET as optionsRoute } from '../app/api/desk/queue/route';
import { GET as assigneesRoute } from '../app/api/desk/tasks/[id]/assignees/route';
import { POST as assignRoute } from '../app/api/desk/tasks/[id]/assign/route';
import { POST as statusRoute } from '../app/api/desk/tasks/[id]/status/route';

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, detail = '') => {
  c ? pass++ : fail++;
  console.log(`  ${c ? '✓' : '✗'} ${n}${!c && detail ? `  [${detail}]` : ''}`);
  if (!c && process.env.FAIL_FAST) throw new Error(`stopped at: ${n}`);
};

const TAG = `m31test${Date.now()}`;
const cleanup = { agencyIds: [] as string[], userIds: [] as string[], podIds: [] as string[] };
const read = (p: string) => readFileSync(p, 'utf8');

async function wipe() {
  const agencyId = { in: cleanup.agencyIds };
  await prisma.taskEvent.deleteMany({ where: { agencyId } });
  await prisma.task.deleteMany({ where: { agencyId } });
  await prisma.insuredAccount.deleteMany({ where: { agencyId } });
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
const req = (url: string, token: string, init: { method?: string; body?: unknown } = {}) =>
  new NextRequest(`http://local.test${url}`, {
    method: init.method ?? 'GET',
    headers: { cookie: `session_token=${token}`, 'content-type': 'application/json' },
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const json = async (r: Response) => ({ status: r.status, json: await r.json().catch(() => null) as Json });

function rules() {
  console.log('Filters and the address');
  const f = (q: string) => parseQueueFilters(new URLSearchParams(q));
  ok('a plain address: soonest due first, all open, page 1', DEFAULT_QUEUE_FILTERS.sort === 'due' && DEFAULT_QUEUE_FILTERS.view === 'open' && DEFAULT_QUEUE_FILTERS.page === 1 && !hasQueueFilters(DEFAULT_QUEUE_FILTERS));
  const id = 'a'.repeat(24);
  const full = f(`q=%20acme%20&pod=${id}&agency=${id}&type=COI&priority=URGENT&overdue=1&sort=newest&view=waiting&page=3`);
  ok('every filter is read back', full.q === 'acme' && full.podId === id && full.agencyId === id && full.type === 'COI' && full.priority === 'URGENT' && full.overdue && full.sort === 'newest' && full.view === 'waiting' && full.page === 3);
  const junk = f('pod=abc&agency=1&type=PIZZA&priority=SOON&sort=random&view=everything&page=-4');
  ok('anything unrecognised falls back to the default', junk.podId === '' && junk.agencyId === '' && junk.type === '' && junk.priority === '' && junk.sort === 'due' && junk.view === 'open' && junk.page === 1);
  ok('"not yet routed" is a pod choice', f('pod=none').podId === 'none');
  ok('a search is trimmed and capped', f(`q=${'x'.repeat(300)}`).q.length === 200);
  ok('the address leaves defaults out', queuePageQuery(DEFAULT_QUEUE_FILTERS, 'queue') === '' && queuePageQuery(DEFAULT_QUEUE_FILTERS, 'mine') === '');
  ok('and round-trips', JSON.stringify(f(queuePageQuery(full, 'mine'))) === JSON.stringify(full));
  ok('the queue\'s address has no "view"', !queuePageQuery(full, 'queue').includes('view='));
  ok('paging', lastQueuePage(0) === 1 && lastQueuePage(25) === 1 && lastQueuePage(26) === 2);

  console.log('What each screen asks the server for');
  const api = (q: string, mode: 'queue' | 'mine') => new URLSearchParams(queueApiQuery(f(q), mode));
  const queue = api('', 'queue');
  ok('queue: open work nobody holds, soonest due first', queue.get('open') === '1' && queue.get('assignee') === 'none' && queue.get('sort') === 'due' && !queue.has('mine'));
  const mine = api('', 'mine');
  ok('my tasks: my open work', mine.get('mine') === '1' && mine.get('open') === '1' && !mine.has('assignee'));
  ok('my tasks by stage', api('view=todo', 'mine').get('status') === 'ASSIGNED' && api('view=waiting', 'mine').get('status') === 'WAITING_ON_AGENCY,WAITING_ON_CARRIER,WAITING_ON_INSURED' && api('view=qa', 'mine').get('status') === 'QA_REVIEW');
  const closed = api('view=closed&overdue=1&sort=due', 'mine');
  ok('completed work: most recent first, never "overdue"', closed.get('status') === 'COMPLETED,CANCELLED' && closed.get('sort') === 'activity' && !closed.has('overdue') && !closed.has('open'));
  ok('every stage is listed once', Object.values(MINE_VIEWS).flatMap((v) => v.statuses).length === new Set(Object.values(MINE_VIEWS).flatMap((v) => v.statuses)).size);
  const filtered = api(`q=acme&pod=none&agency=${id}&type=COI&priority=HIGH&overdue=1&page=2`, 'queue');
  ok('filters pass through', filtered.get('q') === 'acme' && filtered.get('podId') === 'none' && filtered.get('agencyId') === id && filtered.get('type') === 'COI' && filtered.get('priority') === 'HIGH' && filtered.get('overdue') === '1' && filtered.get('page') === '2' && filtered.get('pageSize') === '25');

  console.log('Due dates in a list');
  const now = new Date('2026-11-09T12:00:00Z');
  const at = (ms: number) => new Date(now.getTime() + ms).toISOString();
  const H = 3_600_000;
  const due = (dueAt: string | null, extra: object = {}) => dueLabel({ dueAt, waitingSince: null, status: 'NEW', ...extra }, now);
  ok('overdue', JSON.stringify(due(at(-2 * H))) === JSON.stringify({ text: 'Overdue by 2 hours', tone: 'overdue' }));
  ok('due soon', JSON.stringify(due(at(3 * H))) === JSON.stringify({ text: 'Due in 3 hours', tone: 'soon' }));
  ok('"soon" ends at four hours', due(at(DUE_SOON_MS)).tone === 'soon' && due(at(DUE_SOON_MS + 60_000)).tone === 'normal');
  ok('minutes and days', due(at(20 * 60_000)).text === 'Due in 20 min' && due(at(-50 * H)).text === 'Overdue by 2 days' && due(at(H)).text === 'Due in 1 hour');
  ok('no target', JSON.stringify(due(null)) === JSON.stringify({ text: 'No target', tone: 'none' }));
  const waiting = due(at(-5 * H), { status: 'WAITING_ON_CARRIER', waitingSince: at(-3 * H) });
  ok('waiting work says its clock is stopped, not overdue', waiting.tone === 'waiting' && waiting.text === 'Clock stopped 3 hours ago');
  ok('closed work', due(at(-5 * H), { status: 'COMPLETED' }).text === 'Completed' && due(null, { status: 'CANCELLED' }).tone === 'closed');
}

(async () => {
  try {
    rules();

    const mkAgency = async (n: string) => { const a = await prisma.agency.create({ data: { name: `${TAG} ${n}`, deskEnabled: true } }); cleanup.agencyIds.push(a.id); return a; };
    const mkUser = async (n: string, role: UserRole, agencyId: string | null = null, extra: object = {}) => {
      const u = await prisma.user.create({ data: { email: `${TAG}-${n}@example.test`, role, agencyId, firstName: `${TAG}${n}`, lastName: 'Person', mustChangePassword: false, ...extra } });
      cleanup.userIds.push(u.id); return u;
    };
    const mkPod = async (n: string, extra: object = {}) => { const p = await prisma.pod.create({ data: { code: `${TAG}${n}`, name: `${TAG} ${n}`, ...extra } }); cleanup.podIds.push(p.id); return p; };

    const A = await mkAgency('A'), B = await mkAgency('B');
    const admin = await mkUser('admin', 'ADMIN', A.id);
    const am = await mkUser('am', 'ACCOUNT_MANAGER');
    const amB = await mkUser('amb', 'ACCOUNT_MANAGER');
    const ops = await mkUser('ops', 'DESK_ADMIN');
    const va = await mkUser('va', 'DESK_VA');
    const lead = await mkUser('lead', 'DESK_VA');
    const other = await mkUser('other', 'DESK_VA');
    const gone = await mkUser('gone', 'DESK_VA', null, { isActive: false });
    const pod = await mkPod('One');
    const podB = await mkPod('Two');
    const closedPod = await mkPod('Closed', { isActive: false });
    await prisma.podMember.createMany({ data: [
      { podId: pod.id, userId: va.id }, { podId: pod.id, userId: lead.id, isLead: true }, { podId: pod.id, userId: gone.id },
      { podId: podB.id, userId: other.id },
    ] });
    await prisma.agencyPodAccess.createMany({ data: [{ agencyId: A.id, podId: pod.id }, { agencyId: B.id, podId: podB.id }, { agencyId: A.id, podId: closedPod.id }] });
    await prisma.agencyDeskAssignment.createMany({ data: [{ agencyId: A.id, primaryAmId: am.id }, { agencyId: B.id, primaryAmId: amB.id }] });
    const acme = await prisma.insuredAccount.create({ data: { agencyId: A.id, name: `${TAG} Acme Roofing`, nameKey: `${TAG} acme roofing` } });

    const now = Date.now();
    const H = 3_600_000;
    let n = 0;
    const mkTask = (title: string, data: object = {}, agencyId = A.id) => {
      n += 1;
      return prisma.task.create({ data: {
        reference: 930_000_000 + (Date.now() % 60_000_000) + n, agencyId, type: 'COI', title: `${TAG} ${title}`,
        podId: agencyId === A.id ? pod.id : podB.id, createdById: admin.id, restrictedToUserIds: [], ...data,
      } });
    };
    const carrier = await mkTask('carrier', { status: 'WAITING_ON_CARRIER', slaPausedAt: new Date(now - H), dueAt: new Date(now - 3 * H) });
    const late = await mkTask('late', { dueAt: new Date(now - 2 * H) });
    const fresh = await mkTask('fresh', { dueAt: new Date(now + 6 * H), insuredId: acme.id, priority: 'URGENT' });
    const held = await mkTask('held', { status: 'ASSIGNED', assigneeId: va.id, dueAt: new Date(now + H) });
    const restricted = await mkTask('restricted', { restrictedToUserIds: [lead.id], restrictionReason: 'Sensitive' });
    const unrouted = await mkTask('unrouted', { podId: null });
    const done = await mkTask('done', { status: 'COMPLETED', assigneeId: va.id, completedAt: new Date() });
    const bTask = await mkTask('b work', {}, B.id);

    const scope = (u: { id: string }) => resolveDeskScope(prisma, u.id);
    const [sAdmin, sAm, sOps, sVa, sLead] = await Promise.all([admin, am, ops, va, lead].map(scope));

    console.log('What the queue offers each person');
    const vaOpts = await queueOptions(prisma, sVa);
    ok('VA: their own pod and agency only', vaOpts.pods.map((p) => p.id).join() === pod.id && vaOpts.agencies.map((a) => a.id).join() === A.id);
    ok('VA: picks up, doesn\'t assign', vaOpts.canAssign === false);
    ok('VA: waiting work they may see (not restricted, routed, not held)', vaOpts.counts.waiting === 3, JSON.stringify(vaOpts.counts));
    ok('VA: overdue counts only work whose clock runs', vaOpts.counts.overdue === 1);
    ok('VA: no "not routed" count, and their own work', vaOpts.counts.unrouted === 0 && vaOpts.counts.mine === 1);
    const leadOpts = await queueOptions(prisma, sLead);
    ok('the person a task is restricted to sees it waiting', leadOpts.counts.waiting === 4 && leadOpts.counts.mine === 0);
    const amOpts = await queueOptions(prisma, sAm);
    ok('Account Manager: pods serving their agencies, not closed pods', amOpts.pods.map((p) => p.id).join() === pod.id && amOpts.agencies.map((a) => a.id).join() === A.id);
    ok('Account Manager: assigns, and sees work to route', amOpts.canAssign && amOpts.counts.unrouted === 1 && amOpts.counts.waiting === 5, JSON.stringify(amOpts.counts));
    const opsOpts = await queueOptions(prisma, sOps);
    ok('Operations Manager: every active pod and Desk agency', [pod.id, podB.id].every((id) => opsOpts.pods.some((p) => p.id === id)) && !opsOpts.pods.some((p) => p.id === closedPod.id) && [A.id, B.id].every((id) => opsOpts.agencies.some((a) => a.id === id)));
    ok('an agency user: no queue', (await refusal(() => queueOptions(prisma, sAdmin)))?.status === 404);
    ok('and that attempt is logged', (await prisma.deskAuditLog.findMany({ where: { action: 'access.denied', actorId: admin.id } })).filter((l) => (l.metadata as { op?: string } | null)?.op === 'queue').length === 1);

    console.log('Who a task can go to');
    const forFresh = await assigneesFor(prisma, sAm, fresh.id);
    const names = (r: { people: { id: string }[] }) => r.people.map((p) => p.id);
    ok('pod members and the agency\'s Account Manager', names(forFresh).sort().join() === [va.id, lead.id, am.id].sort().join(), JSON.stringify(forFresh.people.map((p) => p.name)));
    ok('not someone deactivated, nor another pod\'s VA', !names(forFresh).includes(gone.id) && !names(forFresh).includes(other.id));
    ok('VAs first, least busy at the top; the Account Manager last', names(forFresh).join() === [lead.id, va.id, am.id].join());
    const vaRow = forFresh.people.find((p) => p.id === va.id)!;
    ok('with each one\'s open work and the pod lead marked', vaRow.openTasks === 1 && forFresh.people.find((p) => p.id === lead.id)!.lead && vaRow.kind === 'VA' && forFresh.people.at(-1)!.kind === 'ACCOUNT_MANAGER');
    ok('a restricted task: only the person it\'s restricted to, and the Account Manager', names(await assigneesFor(prisma, sAm, restricted.id)).sort().join() === [lead.id, am.id].sort().join());
    ok('work not yet routed: only the Account Manager', names(await assigneesFor(prisma, sAm, unrouted.id)).join() === am.id);
    ok('an Operations Manager sees the same list', names(await assigneesFor(prisma, sOps, fresh.id)).join() === names(forFresh).join());
    ok('it says who holds it now', (await assigneesFor(prisma, sAm, held.id)).assigneeId === va.id);
    ok('a VA can\'t ask: 403', (await refusal(() => assigneesFor(prisma, sVa, fresh.id)))?.status === 403);
    ok('another agency\'s task: 404', (await refusal(() => assigneesFor(prisma, sAm, bTask.id)))?.status === 404);
    ok('closed work: 409', (await refusal(() => assigneesFor(prisma, sAm, done.id)))?.status === 409);
    ok('an agency user: 404', (await refusal(() => assigneesFor(prisma, sAdmin, fresh.id)))?.status === 404);
    const denied = await prisma.deskAuditLog.count({ where: { action: 'access.denied', actorId: admin.id, entityId: fresh.id } });
    ok('and that attempt is logged', denied >= 1);
    // The list and the server's own check agree: everyone offered can be assigned, someone not offered can't.
    ok('someone not offered is refused by the server', (await refusal(() => assignTask(prisma, sAm, fresh.id, other.id)))?.status === 400);
    ok('someone offered is accepted', (await assignTask(prisma, sAm, restricted.id, lead.id)).assigneeId === lead.id);
    await assignTask(prisma, sAm, restricted.id, null);

    console.log('The real routes');
    const [tVa, tLead, tAm, tAdmin] = await Promise.all([va, lead, am, admin].map((u) => createSession(u.id)));
    const list = async (token: string, q: string, mode: 'queue' | 'mine') => {
      const r = await json(await listRoute(req(`/api/desk/tasks?${queueApiQuery(parseQueueFilters(new URLSearchParams(q)), mode)}`, token)));
      return { status: r.status, titles: (r.json?.rows ?? []).map((t: { title: string }) => t.title.replace(`${TAG} `, '')) as string[], json: r.json };
    };
    ok('options: no session, 401', (await optionsRoute(new NextRequest('http://local.test/api/desk/queue'))).status === 401);
    ok('options: a VA, 200', (await json(await optionsRoute(req('/api/desk/queue', tVa)))).json.counts.waiting === 3);
    ok('options: an agency user, 404', (await optionsRoute(req('/api/desk/queue', tAdmin))).status === 404);
    ok('who can take it: Account Manager 200', (await json(await assigneesRoute(req(`/api/desk/tasks/${fresh.id}/assignees`, tAm), ctx(fresh.id)))).json.people.length === 3);
    ok('who can take it: a VA, 403', (await assigneesRoute(req(`/api/desk/tasks/${fresh.id}/assignees`, tVa), ctx(fresh.id))).status === 403);
    ok('who can take it: a bad id, 404', (await assigneesRoute(req('/api/desk/tasks/nope/assignees', tAm), ctx('nope'))).status === 404);

    const vaQueue = await list(tVa, '', 'queue');
    ok('VA queue: soonest due first, then work with no target', vaQueue.titles.join() === 'carrier,late,fresh', vaQueue.titles.join());
    ok('nothing held, restricted, unrouted, closed or from another agency', !['held', 'restricted', 'unrouted', 'done', 'b work'].some((t) => vaQueue.titles.includes(t)));
    ok('the rows carry what the screen shows', (() => { const r = vaQueue.json.rows.find((t: Json) => t.id === fresh.id); return r.priority === 'URGENT' && r.insured.name.endsWith('Acme Roofing') && r.agency.id === A.id && r.pod.id === pod.id && r.typeLabel === 'COI' && 'dueAt' in r; })());
    ok('and no billing or restriction details for a VA', !JSON.stringify(vaQueue.json).includes('billing') && !JSON.stringify(vaQueue.json).includes('restrictedToUserIds'));
    ok('overdue only', (await list(tVa, 'overdue=1', 'queue')).titles.join() === 'late');
    ok('by priority', (await list(tVa, 'priority=URGENT', 'queue')).titles.join() === 'fresh');
    ok('by search', (await list(tVa, 'q=acme', 'queue')).titles.join() === 'fresh');
    ok('newest first', (await list(tVa, 'sort=newest', 'queue')).titles.join() === 'fresh,late,carrier');
    ok('the restricted person sees their task', (await list(tLead, '', 'queue')).titles.includes('restricted'));
    ok('Account Manager: "not yet routed"', (await list(tAm, 'pod=none', 'queue')).titles.join() === 'unrouted');
    ok('VA asking for another pod: nothing', (await list(tVa, `pod=${podB.id}`, 'queue')).titles.length === 0);
    ok('VA asking for another agency: nothing', (await list(tVa, `agency=${B.id}`, 'queue')).titles.length === 0);

    console.log('Picking up, starting, releasing');
    const pick = await json(await assignRoute(req(`/api/desk/tasks/${late.id}/assign`, tVa, { method: 'POST', body: { assigneeId: va.id } }), ctx(late.id)));
    ok('a VA picks up: assigned to them', pick.status === 200 && pick.json.assignee.id === va.id && pick.json.status === 'ASSIGNED');
    ok('it leaves the queue', !(await list(tVa, '', 'queue')).titles.includes('late') && !(await list(tLead, '', 'queue')).titles.includes('late'));
    ok('and is in My tasks, under "To start"', (await list(tVa, '', 'mine')).titles.includes('late') && (await list(tVa, 'view=todo', 'mine')).titles.sort().join() === 'held,late');
    const twice = await json(await assignRoute(req(`/api/desk/tasks/${late.id}/assign`, tLead, { method: 'POST', body: { assigneeId: lead.id } }), ctx(late.id)));
    ok('someone else picking it up too: refused', twice.status === 403 || twice.status === 409, String(twice.status));
    const forOther = await json(await assignRoute(req(`/api/desk/tasks/${fresh.id}/assign`, tVa, { method: 'POST', body: { assigneeId: lead.id } }), ctx(fresh.id)));
    ok('a VA can\'t hand work to someone else', forOther.status === 403);
    const started = await json(await statusRoute(req(`/api/desk/tasks/${late.id}/status`, tVa, { method: 'POST', body: { status: 'IN_PROGRESS' } }), ctx(late.id)));
    ok('start: in progress, under "In progress"', started.status === 200 && started.json.status === 'IN_PROGRESS' && (await list(tVa, 'view=working', 'mine')).titles.join() === 'late');
    const released = await json(await assignRoute(req(`/api/desk/tasks/${late.id}/assign`, tVa, { method: 'POST', body: { assigneeId: null } }), ctx(late.id)));
    ok('release: back in the queue as New, nobody holding it, even once started', released.status === 200 && released.json.assignee === null && released.json.status === 'NEW' && (await list(tLead, '', 'queue')).titles.includes('late'));
    const events = await prisma.taskEvent.findMany({ where: { taskId: late.id }, orderBy: { createdAt: 'asc' } });
    ok('each step is in the history', events.map((e) => e.kind).join() === 'ASSIGNED,STATUS_CHANGED,UNASSIGNED');
    ok('and in the audit log', await prisma.deskAuditLog.count({ where: { entityId: late.id, action: { in: ['task.assigned', 'task.status_changed'] } } }) === 3);
    ok('completed work under "Completed"', (await list(tVa, 'view=closed', 'mine')).titles.join() === 'done');
    ok('my tasks never shows someone else\'s work', !(await list(tLead, 'view=closed', 'mine')).titles.includes('done') && (await list(tLead, '', 'mine')).titles.length === 0);
    const handed = await json(await assignRoute(req(`/api/desk/tasks/${fresh.id}/assign`, tAm, { method: 'POST', body: { assigneeId: lead.id } }), ctx(fresh.id)));
    ok('an Account Manager hands work to a VA', handed.status === 200 && handed.json.assignee.id === lead.id && (await list(tLead, '', 'mine')).titles.join() === 'fresh');
    const counts = await queueOptions(prisma, await scope(lead));
    ok('and the counts follow', counts.counts.mine === 1 && counts.counts.waiting === 3, JSON.stringify(counts.counts));

    console.log('The screens');
    const screen = read('app/components/desk/queue/TaskQueue.tsx');
    for (const [page, mode] of [['queue', 'queue'], ['my-tasks', 'mine']]) {
      const src = read(`app/(desk)/desk-ops/${page}/page.tsx`);
      ok(`${page}: a real page now, checked on the server, for the signed-in person`, !src.includes('DeskPage ') && src.includes(`deskPageAccess('OPS', '/desk-ops/${page}')`) && src.includes(`mode="${mode}"`) && src.includes('userId={access.user.id}'));
    }
    ok('VAs pick up; managers assign from the checked list', screen.includes("mode === 'queue' && !canAssign") && screen.includes('/assignees'));
    ok('releasing asks first', screen.includes('window.confirm(`Return #'));
    ok('a lost race is explained and the list refreshed', screen.includes('err.status === 409') && screen.includes('The list has been refreshed.') && screen.includes('Someone else has already picked up #'));
    ok('waiting work isn\'t shown as overdue on screen either', screen.includes('dueLabel(task, now)'));
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
