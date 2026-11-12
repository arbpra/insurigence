/**
 * Module 33: the agency tracker.
 *
 *   npx tsx script/verify-desk-agency-tracker.ts
 *
 * The tracker's tabs, filters and how history reads to an agency; the counts
 * and "Needs your attention" list (top-level requests only, a producer's own
 * accounts only, nothing internal); the agency's list and request view; a
 * reply that hands the request back; staff refused and logged; the real
 * routes; and what the screens never show. Against the shared database, with
 * temporary agencies, people and requests, all removed at the end.
 */
import 'dotenv/config';
import { readFileSync } from 'fs';
import { NextRequest } from 'next/server';
import type { Prisma, TaskStatus, UserRole } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { createSession } from '../lib/auth';
import { DeskAccessError, resolveDeskScope } from '../lib/desk/access';
import { createInsured } from '../lib/desk/book';
import { agencyTracker, ATTENTION_LIMIT } from '../lib/desk/agency-tracker';
import { getTaskDetail, listTasks, postTaskNote } from '../lib/desk/task-api';
import { changeTaskStatus } from '../lib/desk/tasks';
import { agencyEventTitle, parseTrackerFilters, trackerApiQuery, trackerPageQuery, TRACKER_TABS, type AgencyEvent } from '../lib/desk/tracker-view';
import { GET as trackerRoute } from '../app/api/desk/tracker/route';
import { GET as listRoute } from '../app/api/desk/tasks/route';
import { GET as detailRoute } from '../app/api/desk/tasks/[id]/route';

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, detail = '') => {
  c ? pass++ : fail++;
  console.log(`  ${c ? '✓' : '✗'} ${n}${!c && detail ? `  [${detail}]` : ''}`);
  if (!c && process.env.FAIL_FAST) throw new Error(`stopped at: ${n}`);
};

const TAG = `m33test${Date.now()}`;
const cleanup = { agencyIds: [] as string[], userIds: [] as string[], podIds: [] as string[] };
let ref = 993_000_000 + Math.floor(Math.random() * 1_000_000);
const read = (p: string) => readFileSync(p, 'utf8');
type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any

async function wipe() {
  const agencyId = { in: cleanup.agencyIds };
  await prisma.taskDocument.deleteMany({ where: { agencyId } });
  await prisma.taskEvent.deleteMany({ where: { agencyId } });
  await prisma.task.deleteMany({ where: { agencyId, parentTaskId: { not: null } } });
  await prisma.task.deleteMany({ where: { agencyId } });
  await prisma.policy.deleteMany({ where: { agencyId } });
  await prisma.insuredAssignment.deleteMany({ where: { agencyId } });
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

const req = (url: string, token?: string) =>
  new NextRequest(`http://local.test${url}`, { headers: token ? { cookie: `session_token=${token}` } : {} });
const json = async (r: Response) => ({ status: r.status, json: await r.json().catch(() => null) as Json });

function pureLogic() {
  console.log('Tabs and filters');
  const d = parseTrackerFilters({});
  ok('defaults: open tab, page 1, nothing filtered', d.tab === 'open' && d.page === 1 && !d.q && !d.type && !d.mine);
  const odd = parseTrackerFilters({ tab: 'overdue', type: 'NOPE', page: '-3', mine: 'yes', q: ['  a  ', 'b'] });
  ok('anything unknown falls back, never fails', odd.tab === 'open' && odd.type === '' && odd.page === 1 && !odd.mine && odd.q === 'a');
  ok('a long search is cut to 200', parseTrackerFilters({ q: 'x'.repeat(500) }).q.length === 200);
  const f = parseTrackerFilters({ tab: 'completed', q: 'acme', type: 'COI', mine: '1', page: '3' });
  ok('the address round-trips', JSON.stringify(parseTrackerFilters(Object.fromEntries(new URLSearchParams(trackerPageQuery(f).slice(1))))) === JSON.stringify(f));
  ok('the default view has a bare address', trackerPageQuery(d) === '');
  const q = (tab: keyof typeof TRACKER_TABS) => new URLSearchParams(trackerApiQuery({ ...d, tab }));
  ok('needs attention asks for that status only', q('attention').get('status') === 'NEEDS_ATTENTION');
  ok('open: received, in progress and needs attention', q('open').get('status') === 'RECEIVED,IN_PROGRESS,NEEDS_ATTENTION');
  ok('completed: by when it was completed', q('completed').get('status') === 'COMPLETED' && q('completed').get('sort') === 'completed');
  ok('all: no status filter', !q('all').has('status'));
  ok('filters are passed on', new URLSearchParams(trackerApiQuery(f)).toString() === 'status=COMPLETED&sort=completed&q=acme&type=COI&mine=1&page=3&pageSize=25');

  console.log('How history reads to the agency');
  const ev = (o: Partial<AgencyEvent>): AgencyEvent => ({ id: 'e', kind: 'STATUS_CHANGED', actorName: 'Your Desk team', body: null, status: null, statusLabel: null, fromStatus: null, fromStatusLabel: null, createdAt: '', ...o });
  ok('asked for something', agencyEventTitle(ev({ fromStatus: 'IN_PROGRESS', status: 'NEEDS_ATTENTION' })) === 'Your Desk team needs something from you');
  ok('replied: back with the team', agencyEventTitle(ev({ fromStatus: 'NEEDS_ATTENTION', status: 'IN_PROGRESS' })) === 'Back with your Desk team');
  ok('reopened', agencyEventTitle(ev({ fromStatus: 'COMPLETED', status: 'IN_PROGRESS' })) === 'Reopened' && agencyEventTitle(ev({ fromStatus: 'CANCELLED', status: 'RECEIVED' })) === 'Reopened');
  ok('completed and cancelled', agencyEventTitle(ev({ fromStatus: 'IN_PROGRESS', status: 'COMPLETED' })) === 'Completed' && agencyEventTitle(ev({ fromStatus: 'RECEIVED', status: 'CANCELLED' })) === 'Cancelled');
  ok('other moves in plain words', agencyEventTitle(ev({ fromStatus: 'RECEIVED', fromStatusLabel: 'Received', status: 'IN_PROGRESS', statusLabel: 'In progress' })) === 'Received → In progress');
  ok('filed, notes and documents', agencyEventTitle(ev({ kind: 'CREATED' })) === 'Request sent' && agencyEventTitle(ev({ kind: 'NOTE' })) === 'Note' && agencyEventTitle(ev({ kind: 'DOCUMENT_ADDED' })) === 'Document added');
}

(async () => {
  try {
    pureLogic();

    const mkAgency = async (n: string) => { const a = await prisma.agency.create({ data: { name: `${TAG} ${n}`, deskEnabled: true } }); cleanup.agencyIds.push(a.id); return a; };
    const mkUser = async (n: string, role: UserRole, agencyId: string | null = null) => {
      const u = await prisma.user.create({ data: { email: `${TAG}-${n}@example.test`, role, agencyId, firstName: `${TAG}${n}`, passwordHash: 'x', mustChangePassword: false } });
      cleanup.userIds.push(u.id); return u;
    };
    const A = await mkAgency('A');
    const B = await mkAgency('B');
    const admin = await mkUser('admin', 'ADMIN', A.id);
    const producer = await mkUser('producer', 'AGENT', A.id);
    const adminB = await mkUser('adminb', 'ADMIN', B.id);
    const am = await mkUser('am', 'ACCOUNT_MANAGER');
    const va = await mkUser('va', 'DESK_VA');
    await prisma.agencyDeskAssignment.create({ data: { agencyId: A.id, primaryAmId: am.id } });
    const pod = await prisma.pod.create({ data: { code: TAG, name: `${TAG} Secret Pod` } }); cleanup.podIds.push(pod.id);
    await prisma.podMember.create({ data: { podId: pod.id, userId: va.id } });
    await prisma.agencyPodAccess.create({ data: { agencyId: A.id, podId: pod.id } });

    const [sAdmin, sProducer, sB, sAm, sVa] = await Promise.all([admin, producer, adminB, am, va].map((u) => resolveDeskScope(prisma, u.id)));
    const { id: acme } = await createInsured(prisma, sAdmin, { name: `${TAG} Acme` });
    const { id: other } = await createInsured(prisma, sAdmin, { name: `${TAG} Other` });
    const { id: foreign } = await createInsured(prisma, sB, { name: `${TAG} Foreign` });
    await prisma.insuredAssignment.create({ data: { agencyId: A.id, insuredId: acme, userId: producer.id, role: 'PRODUCER' } });

    const hours = (h: number) => new Date(Date.now() - h * 3_600_000);
    const mkTask = (title: string, status: TaskStatus, extra: Partial<Prisma.TaskUncheckedCreateInput> = {}) =>
      prisma.task.create({ data: { reference: ref++, agencyId: A.id, insuredId: acme, type: 'COI', title: `${TAG} ${title}`, status, podId: pod.id, assigneeId: va.id, dueAt: hours(-5), createdById: admin.id, ...extra } });
    const ask = (taskId: string, body: string, at: Date, visibility: 'AGENCY' | 'INTERNAL' = 'AGENCY') =>
      prisma.taskEvent.create({ data: { taskId, agencyId: A.id, actorId: va.id, kind: 'STATUS_CHANGED', visibility, fromStatus: 'IN_PROGRESS', toStatus: 'WAITING_ON_AGENCY', body, createdAt: at } });

    const received = await mkTask('received', 'NEW', { assigneeId: null });
    const working = await mkTask('working', 'IN_PROGRESS');
    const carrier = await mkTask('waiting on carrier', 'WAITING_ON_CARRIER');
    await prisma.taskEvent.create({ data: { taskId: carrier.id, agencyId: A.id, actorId: va.id, kind: 'STATUS_CHANGED', visibility: 'INTERNAL', fromStatus: 'IN_PROGRESS', toStatus: 'WAITING_ON_CARRIER', body: `${TAG} carrier portal down, internal only` } });
    const needOld = await mkTask('needs a signature', 'WAITING_ON_AGENCY', { insuredId: other });
    await ask(needOld.id, 'Please send the signed application.', hours(30));
    const needNew = await mkTask('needs the VIN', 'WAITING_ON_AGENCY');
    await ask(needNew.id, 'An earlier question.', hours(20));
    await ask(needNew.id, 'What is the VIN of the new truck?', hours(2));
    // Due dates the other way round from the newest-first order, so a due-date sort would show.
    const doneOld = await mkTask('done first', 'COMPLETED', { completedAt: hours(48), createdAt: hours(10), dueAt: hours(-50) });
    const doneNew = await mkTask('done last', 'COMPLETED', { completedAt: hours(1), createdAt: hours(60), dueAt: hours(-1) });
    const cancelled = await mkTask('cancelled', 'CANCELLED', { cancelledAt: hours(3) });
    // A subtask is part of its parent's request: never counted or listed on its own.
    await mkTask('subtask waiting', 'WAITING_ON_AGENCY', { parentTaskId: working.id });
    // Another agency's request, waiting on them.
    await prisma.task.create({ data: { reference: ref++, agencyId: B.id, insuredId: foreign, type: 'COI', title: `${TAG} foreign`, status: 'WAITING_ON_AGENCY' } });

    console.log('Counts and "Needs your attention"');
    const t = await agencyTracker(prisma, sAdmin);
    ok('counted by simplified status', t.counts.RECEIVED === 1 && t.counts.IN_PROGRESS === 2 && t.counts.NEEDS_ATTENTION === 2 && t.counts.COMPLETED === 2 && t.counts.CANCELLED === 1, JSON.stringify(t.counts));
    ok('open and total add up', t.counts.open === 5 && t.counts.total === 8);
    ok('subtasks and other agencies left out', t.attention.length === 2 && t.attention.every((a) => !a.title.includes('subtask') && !a.title.includes('foreign')));
    ok('longest waiting first', t.attention[0].id === needOld.id && t.attention[1].id === needNew.id, t.attention.map((a) => a.title).join());
    ok('with what was last asked, and when', t.attention[1].asked === 'What is the VIN of the new truck?' && Math.abs(new Date(t.attention[1].since!).getTime() - hours(2).getTime()) < 120_000);
    ok('and the account', t.attention[0].insured?.id === other && t.attention[1].insured?.name === `${TAG} Acme`);
    const flat = JSON.stringify(t);
    ok('nothing internal: no due date, pod, staff or carrier note', !/dueAt|podId|assignee|Secret Pod|carrier portal/.test(flat) && !flat.includes(va.id));
    ok('listed to a limit, counted in full', ATTENTION_LIMIT === 50);

    const p = await agencyTracker(prisma, sProducer);
    ok('a producer: only their own accounts\' requests', p.counts.total === 7 && p.attention.length === 1 && p.attention[0].id === needNew.id, JSON.stringify(p.counts));
    const b = await agencyTracker(prisma, sB);
    ok('another agency: only theirs', b.counts.total === 1 && b.counts.NEEDS_ATTENTION === 1 && b.attention[0].title === `${TAG} foreign`);

    // An internal ask is not one the agency can read.
    await ask(needOld.id, `${TAG} internal ask`, hours(1), 'INTERNAL');
    ok('an internal entry never becomes the ask', (await agencyTracker(prisma, sAdmin)).attention.find((a) => a.id === needOld.id)?.asked === 'Please send the signed application.');

    console.log('Staff are refused, and it is logged');
    for (const [name, s, u] of [['an Account Manager', sAm, am], ['a VA', sVa, va]] as const) {
      let status = 0;
      try { await agencyTracker(prisma, s, { ip: '203.0.113.7' }); } catch (e) { status = e instanceof DeskAccessError ? e.status : -1; }
      const log = await prisma.deskAuditLog.findFirst({ where: { actorId: u.id, action: 'access.denied' }, orderBy: { createdAt: 'desc' } });
      ok(`${name}: 404, logged`, status === 404 && (log?.metadata as Json)?.op === 'tracker' && log?.ipAddress === '203.0.113.7');
    }

    console.log('The agency\'s list');
    const titles = (r: { rows: { title: string }[] }) => r.rows.map((x) => x.title.replace(`${TAG} `, '')).join('|');
    const attentionList = await listTasks(prisma, sAdmin, { status: 'NEEDS_ATTENTION' });
    ok('needs attention: no subtask', attentionList.total === 2 && !titles(attentionList).includes('subtask'));
    ok('all: top-level only', (await listTasks(prisma, sAdmin, {})).total === 8);
    const completed = await listTasks(prisma, sAdmin, { status: 'COMPLETED', sort: 'completed' });
    ok('completed: latest completed first, not latest sent', titles(completed) === 'done last|done first', titles(completed));
    ok('newest stays the default', titles(await listTasks(prisma, sAdmin, { status: 'COMPLETED' })) === 'done first|done last');
    ok('internal sorts still ignored for an agency', titles(await listTasks(prisma, sAdmin, { status: 'COMPLETED', sort: 'due' })) === 'done first|done last');
    ok('staff can sort by completion too', titles(await listTasks(prisma, sAm, { agencyId: A.id, status: 'COMPLETED', sort: 'completed' })) === 'done last|done first');
    ok('staff still see subtasks', (await listTasks(prisma, sAm, { agencyId: A.id, status: 'WAITING_ON_AGENCY' })).total === 3);
    const rowKeys = Object.keys((await listTasks(prisma, sAdmin, {})).rows[0]);
    ok('rows carry nothing internal', !rowKeys.some((k) => ['dueAt', 'pod', 'assignee', 'accountManager', 'billing', 'slaDueAt', 'escalated', 'lastActivityAt'].includes(k)), rowKeys.join());

    console.log('One request, as the agency sees it');
    const cTask = await prisma.task.create({ data: { reference: ref++, agencyId: A.id, insuredId: acme, type: 'COI', title: `${TAG} history`, status: 'NEW', podId: pod.id, createdById: admin.id } });
    await prisma.taskEvent.create({ data: { taskId: cTask.id, agencyId: A.id, actorId: admin.id, kind: 'CREATED', visibility: 'AGENCY', body: cTask.title, toStatus: 'NEW' } });
    await prisma.task.update({ where: { id: cTask.id }, data: { assigneeId: va.id, status: 'ASSIGNED' } });
    await changeTaskStatus(prisma, sVa, cTask.id, 'IN_PROGRESS');
    await changeTaskStatus(prisma, sVa, cTask.id, 'WAITING_ON_CARRIER', { reason: `${TAG} carrier slow` });
    await changeTaskStatus(prisma, sVa, cTask.id, 'WAITING_ON_AGENCY', { reason: 'Which location is this for?' });
    const detail = await getTaskDetail(prisma, sAdmin, cTask.id) as Json;
    const kinds = detail.events.map((e: AgencyEvent) => agencyEventTitle(e)).join('|');
    ok('the history reads plainly', kinds === 'Request sent|Received → In progress|Your Desk team needs something from you', kinds);
    ok('the question is there, the carrier wait is not', detail.events.at(-1).body === 'Which location is this for?' && !JSON.stringify(detail).includes('carrier slow'));
    ok('each change says where it came from', detail.events[1].fromStatus === 'RECEIVED' && detail.events[1].fromStatusLabel === 'Received');
    ok('the team is one team to the agency', detail.events[1].actorName === 'Your Desk team' && detail.events[0].actorName === `${TAG}admin`);
    ok('no due date, pod or assignee in the view', !['dueAt', 'pod', 'podId', 'assignee', 'assigneeId', 'slaDueAt', 'permissions', 'billing'].some((k) => k in detail));

    console.log('Replying hands it back');
    const before = (await agencyTracker(prisma, sAdmin)).counts.NEEDS_ATTENTION;
    const reply = await postTaskNote(prisma, sAdmin, cTask.id, { body: 'The Main Street location.' });
    ok('the reply resumes the work', reply.resumed && reply.task.status === 'IN_PROGRESS');
    ok('and it leaves "Needs your attention"', (await agencyTracker(prisma, sAdmin)).counts.NEEDS_ATTENTION === before - 1);
    const after = await getTaskDetail(prisma, sAdmin, cTask.id) as Json;
    ok('the history shows the reply and the hand-back', after.events.slice(-2).map((e: AgencyEvent) => agencyEventTitle(e)).join('|') === 'Note|Back with your Desk team');
    const again = await postTaskNote(prisma, sAdmin, cTask.id, { body: 'One more thing.' });
    ok('a later note changes nothing', !again.resumed && again.task.status === 'IN_PROGRESS');

    console.log('The real routes');
    const [tAdmin, tProducer, tAm] = await Promise.all([admin, producer, am].map((u) => createSession(u.id)));
    const r = await json(await trackerRoute(req('/api/desk/tracker', tAdmin)));
    ok('tracker: 200 for the agency', r.status === 200 && r.json.counts.total === 9 && Array.isArray(r.json.attention));
    ok('tracker: a producer sees their part', (await json(await trackerRoute(req('/api/desk/tracker', tProducer)))).json.counts.total === 8);
    ok('tracker: staff, 404', (await trackerRoute(req('/api/desk/tracker', tAm))).status === 404);
    ok('tracker: signed out, 401', (await trackerRoute(req('/api/desk/tracker'))).status === 401);
    const l = await json(await listRoute(req(`/api/desk/tasks?${trackerApiQuery(parseTrackerFilters({ tab: 'completed' }))}`, tAdmin)));
    ok('the list, as the completed tab asks for it', l.status === 200 && l.json.total === 2 && l.json.rows[0].title === `${TAG} done last`);
    const notMine = await detailRoute(req(`/api/desk/tasks/${needOld.id}`, tProducer), { params: Promise.resolve({ id: needOld.id }) });
    ok('a producer can\'t open another account\'s request: 404', notMine.status === 404);

    console.log('A reason meant for the team stays with the team');
    const reopen = await prisma.task.create({ data: { reference: ref++, agencyId: A.id, insuredId: acme, type: 'COI', title: `${TAG} reopened`, status: 'COMPLETED', completedAt: new Date(), podId: pod.id, assigneeId: va.id, createdById: admin.id } });
    await changeTaskStatus(prisma, sAm, reopen.id, 'IN_PROGRESS', { reason: `${TAG} reopen: the VA missed a location` });
    const reopened = await getTaskDetail(prisma, sAdmin, reopen.id) as Json;
    const back = reopened.events.at(-1);
    ok('the agency sees it was reopened, not why', agencyEventTitle(back) === 'Reopened' && back.body === null && !JSON.stringify(reopened).includes('missed a location'));

    console.log('Cancelling before work starts');
    const early = await prisma.task.create({ data: { reference: ref++, agencyId: A.id, insuredId: acme, type: 'COI', title: `${TAG} not needed`, status: 'NEW', podId: pod.id, createdById: admin.id } });
    const noReason = await changeTaskStatus(prisma, sAdmin, early.id, 'CANCELLED').then(() => 0, (e) => (e instanceof DeskAccessError ? e.status : -1));
    ok('a reason is required', noReason === 400, String(noReason));
    await changeTaskStatus(prisma, sAdmin, early.id, 'CANCELLED', { reason: 'Sent twice by mistake' });
    const gone = await getTaskDetail(prisma, sAdmin, early.id) as Json;
    ok('the agency can cancel a received request, and sees why', gone.status === 'CANCELLED' && agencyEventTitle(gone.events.at(-1)) === 'Cancelled' && gone.events.at(-1).body === 'Sent twice by mistake');
    const late = await changeTaskStatus(prisma, sAdmin, cTask.id, 'CANCELLED', { reason: 'x' }).then(() => 0, (e) => (e instanceof DeskAccessError ? e.status : -1));
    ok('not once work has started', late === 403, String(late));

    console.log('What the screens never show');
    const screens = read('app/components/desk/tracker/RequestTracker.tsx') + read('app/components/desk/tracker/AgencyRequest.tsx');
    ok('no due dates, pods, assignees, billing or targets', !/dueAt|dueLabel|\.pod\b|assignee|billing|slaDue|Overdue/i.test(screens));
    const linked = (testId: string) => new RegExp(String.raw`href=\{\`/desk/requests/\$\{t\.id\}\`\}[^>]*data-testid="${testId}"`).test(screens);
    ok('list rows open their own page', linked('desk-tracker-row-open'));
    ok('so do the requests needing attention', linked('desk-tracker-attention-open'));
    ok('replying is offered where the team is waiting', screens.includes("attention ? 'Send reply' : 'Send note'"));
    ok('closed requests point to a new one instead', screens.includes('desk-request-closed') && screens.includes('Send a new request'));
    ok('cancelling is offered only before work starts, with a reason', screens.includes("const cancellable = task.status === 'RECEIVED';") && screens.includes("JSON.stringify({ status: 'CANCELLED', reason: cancelling })"));
    ok('never asks for passwords', screens.includes('Never send passwords or carrier logins'));
    ok('the account page and the sent screen link to the request', read('app/components/desk/accounts/AccountDetail.tsx').includes('href={`/desk/requests/${t.id}`}') && read('app/components/desk/requests/RequestForm.tsx').includes('href={`/desk/requests/${sent.id}`}'));
    ok('the pages are the agency area\'s', read('app/(desk)/desk/requests/page.tsx').includes("deskPageAccess('AGENCY', '/desk/requests')") && read('app/(desk)/desk/requests/[id]/page.tsx').includes("deskPageAccess('AGENCY', '/desk/requests')"));
  } catch (err) {
    fail++;
    console.error(err);
  } finally {
    await wipe();
    const left = await prisma.task.count({ where: { title: { startsWith: TAG } } }) + await prisma.user.count({ where: { email: { startsWith: TAG } } });
    ok('nothing left behind', left === 0);
    await prisma.$disconnect();
    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
  }
})();
