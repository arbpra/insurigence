/**
 * The Desk, Module 28: the Task API.
 *
 * Through the real routes: who can reach what, what each kind of person is shown
 * (above all, that nothing internal reaches an agency), filters that can't be used
 * to learn internal facts, and changes answering with the person's own view.
 * Temporary agencies, users and a temporary pod only.
 * Run with:  npx tsx script/verify-desk-task-api.ts
 */
import 'dotenv/config';
import { readFileSync } from 'fs';
import { NextRequest } from 'next/server';
import type { PrismaClient, UserRole } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { createSession } from '../lib/auth';
import { resolveDeskScope } from '../lib/desk/access';
import { getTaskDetail } from '../lib/desk/task-api';
import { GET as listRoute, POST as createRoute } from '../app/api/desk/tasks/route';
import { GET as detailRoute } from '../app/api/desk/tasks/[id]/route';
import { POST as statusRoute } from '../app/api/desk/tasks/[id]/status/route';
import { POST as assignRoute } from '../app/api/desk/tasks/[id]/assign/route';
import { POST as notesRoute } from '../app/api/desk/tasks/[id]/notes/route';

let pass = 0, fail = 0;
const ok = (n: string, c: boolean) => {
  c ? pass++ : fail++;
  console.log(`  ${c ? '✓' : '✗'} ${n}`);
  // For the deliberate-fault runs: one failed check is the answer, and cleanup still runs.
  if (!c && process.env.FAIL_FAST) throw new Error(`stopped at: ${n}`);
};

const TAG = `m28test${Date.now()}`;
const cleanup = { agencyIds: [] as string[], userIds: [] as string[], podIds: [] as string[] };
const read = (p: string) => readFileSync(p, 'utf8');

async function wipe() {
  const agencyId = { in: cleanup.agencyIds };
  await prisma.taskEvent.deleteMany({ where: { agencyId } });
  await prisma.task.deleteMany({ where: { agencyId } });
  await prisma.policy.deleteMany({ where: { agencyId } });
  await prisma.insuredAssignment.deleteMany({ where: { agencyId } });
  await prisma.insuredAccount.deleteMany({ where: { agencyId } });
  await prisma.agencyPodAccess.deleteMany({ where: { agencyId } });
  await prisma.agencyDeskAssignment.deleteMany({ where: { agencyId } });
  await prisma.podMember.deleteMany({ where: { podId: { in: cleanup.podIds } } });
  await prisma.pod.deleteMany({ where: { id: { in: cleanup.podIds } } });
  await prisma.deskAuditLog.deleteMany({ where: { OR: [{ agencyId }, { actorId: { in: cleanup.userIds } }] } });
  await prisma.session.deleteMany({ where: { userId: { in: cleanup.userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: cleanup.userIds } } });
  await prisma.agency.deleteMany({ where: { id: agencyId } });
}

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const req = (url: string, token: string | null, method = 'GET', body?: unknown) => new NextRequest(`http://local.test${url}`, {
  method, headers: token ? { cookie: `session_token=${token}` } : {}, ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
});
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const answer = async (r: Response) => ({ status: r.status, json: await r.json().catch(() => null) as Json });

(async () => {
  try {
    const mkAgency = async (n: string, deskEnabled = true) => { const a = await prisma.agency.create({ data: { name: `${TAG} ${n}`, deskEnabled } }); cleanup.agencyIds.push(a.id); return a; };
    const mkUser = async (n: string, role: UserRole, agencyId: string | null = null, extra: object = {}) => {
      const u = await prisma.user.create({ data: { email: `${TAG}-${n}@example.test`, role, agencyId, firstName: `${TAG}${n}`, lastName: 'Person', mustChangePassword: false, ...extra } });
      cleanup.userIds.push(u.id); return u;
    };
    const A = await mkAgency('A'), B = await mkAgency('B'), Off = await mkAgency('Off', false);
    const admin = await mkUser('admin', 'ADMIN', A.id);
    const colleague = await mkUser('colleague', 'ADMIN', A.id);
    const producer = await mkUser('producer', 'AGENT', A.id, { bookAccess: 'ASSIGNED' });
    const adminB = await mkUser('adminb', 'ADMIN', B.id);
    const adminOff = await mkUser('adminoff', 'ADMIN', Off.id);
    const am = await mkUser('am', 'ACCOUNT_MANAGER');
    const ops = await mkUser('ops', 'DESK_ADMIN');
    const va = await mkUser('va', 'DESK_VA');
    const va2 = await mkUser('vatwo', 'DESK_VA');
    const vaOut = await mkUser('vaout', 'DESK_VA');
    const gone = await mkUser('gone', 'DESK_VA');
    const pod = await prisma.pod.create({ data: { code: TAG, name: `${TAG} Pod Secret` } }); cleanup.podIds.push(pod.id);
    const pod2 = await prisma.pod.create({ data: { code: `${TAG}b`, name: `${TAG} Other Pod` } }); cleanup.podIds.push(pod2.id);
    await prisma.podMember.createMany({ data: [{ podId: pod.id, userId: va.id }, { podId: pod.id, userId: va2.id }, { podId: pod2.id, userId: vaOut.id }] });
    await prisma.agencyPodAccess.create({ data: { agencyId: A.id, podId: pod.id } });
    await prisma.agencyDeskAssignment.create({ data: { agencyId: A.id, primaryAmId: am.id } });
    const account = (agencyId: string, name: string) => prisma.insuredAccount.create({ data: { agencyId, name, nameKey: name.toLowerCase() } });
    const acme = await account(A.id, `${TAG} Acme Roofing`);
    const zen = await account(A.id, `${TAG} Zen Bakery`);
    const bAccount = await account(B.id, `${TAG} B Client`);
    const offAccount = await account(Off.id, `${TAG} Off Client`);
    await prisma.insuredAssignment.create({ data: { agencyId: A.id, insuredId: acme.id, userId: producer.id, role: 'PRODUCER' } });
    const policy = await prisma.policy.create({ data: { agencyId: A.id, insuredId: acme.id, policyNumber: `${TAG}-P1`, lineOfBusiness: 'GL', carrierName: 'Carrier X' } });
    const zenPolicy = await prisma.policy.create({ data: { agencyId: A.id, insuredId: zen.id, policyNumber: `${TAG}-P2` } });

    const [tAdmin, tColleague, tProducer, tB, tOff, tAm, tOps, tVa, tVa2, tVaOut] = await Promise.all([admin, colleague, producer, adminB, adminOff, am, ops, va, va2, vaOut].map((u) => createSession(u.id)));
    const list = async (token: string, query = '') => answer(await listRoute(req(`/api/desk/tasks?${query}`, token)));
    const create = async (token: string, body: unknown) => answer(await createRoute(req('/api/desk/tasks', token, 'POST', body)));
    const detail = async (token: string | null, id: string) => answer(await detailRoute(req(`/api/desk/tasks/${id}`, token), ctx(id)));
    const status = async (token: string, id: string, body: unknown) => answer(await statusRoute(req(`/x`, token, 'POST', body), ctx(id)));
    const assign = async (token: string, id: string, body: unknown) => answer(await assignRoute(req(`/x`, token, 'POST', body), ctx(id)));
    const note = async (token: string, id: string, body: unknown) => answer(await notesRoute(req(`/x`, token, 'POST', body), ctx(id)));
    const titles = (r: { json: Json }) => (r.json.rows as { title: string }[]).map((t) => t.title.replace(`${TAG} `, '')).sort().join();
    /** Staff with whole-database reach must be narrowed, as the database is shared. */
    const inA = `agencyId=${A.id}`;
    const denials = (entityId: string) => prisma.deskAuditLog.count({ where: { action: 'access.denied', entityId } });

    console.log('Who can reach it');
    {
      const id = '0'.repeat(24);
      ok('list needs a session', (await listRoute(req('/x', null))).status === 401);
      ok('create needs a session', (await createRoute(req('/x', null, 'POST', {}))).status === 401);
      ok('detail needs a session', (await detailRoute(req('/x', null), ctx(id))).status === 401);
      ok('status needs a session', (await statusRoute(req('/x', null, 'POST', {}), ctx(id))).status === 401);
      ok('assign needs a session', (await assignRoute(req('/x', null, 'POST', {}), ctx(id))).status === 401);
      ok('notes need a session', (await notesRoute(req('/x', null, 'POST', {}), ctx(id))).status === 401);
      ok('an agency without The Desk: 403', (await list(tOff)).status === 403);
    }

    console.log('Filing a request');
    const first = await create(tAdmin, { type: 'COI', title: `${TAG} coi for acme`, description: 'Needs a certificate', insuredId: acme.id, policyId: policy.id });
    {
      ok('agency: 201', first.status === 201);
      ok('answer is the agency view', first.json.status === 'RECEIVED' && first.json.statusLabel === 'Received' && first.json.typeLabel === 'COI');
      ok('names the account and policy', first.json.insured?.name === acme.name && first.json.policy?.policyNumber === `${TAG}-P1`);
      const saved = await prisma.task.findUniqueOrThrow({ where: { id: first.json.id } });
      ok('marked as from the agency', saved.source === 'AGENCY' && saved.createdById === admin.id && saved.agencyId === A.id);
      ok('the Account Manager attached', saved.amId === am.id);
      const sneaky = await create(tAdmin, { type: 'OTHER', title: `${TAG} sneaky`, agencyId: B.id, status: 'COMPLETED', source: 'AI', assigneeId: va.id, podId: pod.id, nonBillable: true });
      const sneakySaved = await prisma.task.findUniqueOrThrow({ where: { id: sneaky.json.id } });
      ok('the agency comes from the user, not the request', sneakySaved.agencyId === A.id);
      ok('status, source and staff can\'t be set by filing', sneakySaved.status === 'NEW' && sneakySaved.source === 'AGENCY' && !sneakySaved.assigneeId && sneakySaved.podId !== pod.id && !sneakySaved.nonBillable);
      await prisma.taskEvent.deleteMany({ where: { taskId: sneakySaved.id } }); await prisma.task.delete({ where: { id: sneakySaved.id } });

      ok('not JSON: 400', (await create(tAdmin, 'not json')).status === 400);
      ok('a list: 400', (await create(tAdmin, [])).status === 400);
      ok('no type: 400', (await create(tAdmin, { title: 'x' })).status === 400);
      ok('an unknown type: 400', (await create(tAdmin, { type: 'constructor', title: 'x' })).status === 400);
      ok('no title: 400', (await create(tAdmin, { type: 'OTHER' })).status === 400);
      ok('a title that isn\'t text: 400', (await create(tAdmin, { type: 'OTHER', title: { a: 1 } })).status === 400);
      ok('an account that isn\'t text: 404, not a crash', (await create(tAdmin, { type: 'OTHER', title: 'x', insuredId: { a: 1 } })).status === 404);
      ok('another agency\'s account: 404', (await create(tAdmin, { type: 'OTHER', title: 'x', insuredId: bAccount.id })).status === 404);
      ok('an account they aren\'t assigned: 404', (await create(tProducer, { type: 'OTHER', title: 'x', insuredId: zen.id })).status === 404);
      ok('a policy on another account: 404', (await create(tAdmin, { type: 'OTHER', title: 'x', insuredId: acme.id, policyId: zenPolicy.id })).status === 404);
      ok('a VA doesn\'t file: 404', (await create(tVa, { type: 'OTHER', title: 'x' })).status === 404);
      ok('Account Manager, an agency they don\'t cover: 404', (await create(tAm, { type: 'OTHER', title: 'x', agencyId: B.id })).status === 404);
      const filed = await create(tAm, { type: 'OTHER', title: `${TAG} filed by am`, agencyId: A.id });
      ok('Account Manager, their agency: 201 and marked internal', filed.status === 201 && (await prisma.task.findUniqueOrThrow({ where: { id: filed.json.id } })).source === 'INTERNAL');
      ok('and sees the staff view', filed.json.status === 'NEW' && 'billing' in filed.json);
      await prisma.taskEvent.deleteMany({ where: { taskId: filed.json.id } }); await prisma.task.delete({ where: { id: filed.json.id } });
      ok('Operations Manager, an agency without The Desk: 404', (await create(tOps, { type: 'OTHER', title: 'x', agencyId: Off.id })).status === 404);
      ok('nor through that agency\'s account', (await create(tOps, { type: 'OTHER', title: 'x', insuredId: offAccount.id })).status === 404);
      ok('none of those added a request there', await prisma.task.count({ where: { agencyId: Off.id } }) === 0);
    }

    // A small book: straight to the database for status and pod, through the API only where that's what's tested.
    let n = 0;
    const mkTask = async (title: string, data: object = {}, agencyId = A.id) => {
      n += 1;
      return prisma.task.create({ data: { reference: 900_000_000 + (Date.now() % 90_000_000) + n, agencyId, type: 'OTHER', title: `${TAG} ${title}`, podId: pod.id, createdById: admin.id, restrictedToUserIds: [], ...data } });
    };
    const now = Date.now();
    const hour = 3_600_000;
    await prisma.task.update({ where: { id: first.json.id }, data: { podId: pod.id } });
    const tNew = await mkTask('new', { priority: 'HIGH' });
    const tAssigned = await mkTask('assigned', { status: 'ASSIGNED', assigneeId: va.id, dueAt: new Date(now + 5 * hour) });
    const tCarrier = await mkTask('carrier', { status: 'WAITING_ON_CARRIER', assigneeId: va.id, slaPausedAt: new Date(now - hour), dueAt: new Date(now - 2 * hour) });
    const tAgency = await mkTask('needs agency', { status: 'WAITING_ON_AGENCY', insuredId: zen.id, type: 'ENDORSEMENT', dueAt: new Date(now + 3 * hour) });
    const tQa = await mkTask('qa', { status: 'QA_REVIEW', assigneeId: va2.id, insuredId: acme.id, dueAt: new Date(now - 3 * hour) });
    const tDone = await mkTask('done', { status: 'COMPLETED', assigneeId: va2.id, dueAt: new Date(now - 9 * hour), completedAt: new Date(now) });
    const tDoneMine = await mkTask('done mine', { status: 'COMPLETED', assigneeId: va.id });
    const tRestricted = await mkTask('restricted', { restrictedToUserIds: [va2.id], restrictionReason: 'Restriction secret' });
    const tUnrouted = await mkTask('unrouted', { podId: null });
    const tPod2 = await mkTask('other pod', { podId: pod2.id });
    const tProducers = await mkTask('producer sent', { createdById: producer.id });
    const tB2 = await mkTask('b task', {}, B.id);
    void tNew; void tDone; void tDoneMine; void tPod2; void tProducers; void tUnrouted;

    console.log('Lists show only what each person may see');
    const everyA = 'assigned,carrier,coi for acme,done,done mine,needs agency,new,other pod,producer sent,qa,restricted,unrouted';
    {
      ok('agency admin: their whole agency', titles(await list(tAdmin)) === everyA);
      ok('another agency: only theirs', titles(await list(tB)) === 'b task');
      ok('assigned-only: their accounts and what they sent', titles(await list(tProducer)) === 'coi for acme,producer sent,qa');
      ok('Account Manager: their agencies', titles(await list(tAm)) === everyA);
      ok('Account Manager can\'t reach another agency by asking', titles(await list(tAm, `agencyId=${B.id}`)) === '');
      ok('Operations Manager: any agency', titles(await list(tOps, inA)) === everyA && titles(await list(tOps, `agencyId=${B.id}`)) === 'b task');
      ok('VA: their pod, open, plus what they closed; no restricted task', titles(await list(tVa)) === 'assigned,carrier,coi for acme,done mine,needs agency,new,producer sent,qa');
      ok('the VA named on a restriction sees it', titles(await list(tVa2)).includes('restricted'));
      ok('VA in a pod the agency hasn\'t authorized: nothing', titles(await list(tVaOut)) === '');
      ok('a VA can\'t reach beyond their scope by asking', titles(await list(tVa, `podId=${pod2.id}`)) === '' && titles(await list(tVa, `agencyId=${B.id}`)) === '');
    }

    console.log('Filters');
    {
      ok('open only', !titles(await list(tAdmin, 'open=1')).includes('done'));
      ok('staff: internal status', titles(await list(tOps, `${inA}&status=WAITING_ON_CARRIER`)) === 'carrier');
      ok('staff: several', titles(await list(tOps, `${inA}&status=WAITING_ON_CARRIER,QA_REVIEW`)) === 'carrier,qa');
      ok('staff: agency words aren\'t statuses', (await list(tOps, 'status=RECEIVED')).status === 400);
      ok('agency: Needs your attention', titles(await list(tAdmin, 'status=NEEDS_ATTENTION')) === 'needs agency');
      ok('agency: In progress takes in every internal stage behind it', titles(await list(tAdmin, 'status=IN_PROGRESS')) === 'carrier,qa');
      ok('agency: an internal status is refused, so it can\'t be used to find one', (await list(tAdmin, 'status=WAITING_ON_CARRIER')).status === 400);
      ok('a name that isn\'t a status: 400', (await list(tOps, 'status=constructor')).status === 400);
      ok('type', titles(await list(tAdmin, 'type=ENDORSEMENT')) === 'needs agency');
      ok('bad type: 400', (await list(tAdmin, 'type=NOPE')).status === 400);
      ok('priority', titles(await list(tAdmin, 'priority=HIGH')) === 'new');
      ok('bad priority: 400', (await list(tAdmin, 'priority=NOPE')).status === 400);
      ok('account', titles(await list(tAdmin, `insuredId=${zen.id}`)) === 'needs agency');
      ok('another agency\'s account finds nothing', titles(await list(tAdmin, `insuredId=${bAccount.id}`)) === '');
      ok('bad account: 400, not a crash', (await list(tAdmin, 'insuredId=abc')).status === 400);
      ok('search: title', titles(await list(tAdmin, 'q=NEEDS+AGENCY')) === 'needs agency');
      ok('search: account name', titles(await list(tAdmin, 'q=Zen+Bak')) === 'needs agency');
      const ref = (await prisma.task.findUniqueOrThrow({ where: { id: tQa.id } })).reference;
      ok('search: number, with or without #', titles(await list(tAdmin, `q=${ref}`)) === 'qa' && titles(await list(tAdmin, `q=%23${ref}`)) === 'qa');
      ok('search: another agency\'s number finds nothing', titles(await list(tAdmin, `q=${tB2.reference}`)) === '');
      ok('search: another agency\'s client finds nothing', titles(await list(tAdmin, 'q=B+Client')) === '');
      ok('search: special characters are plain text', (await list(tAdmin, 'q=(')).status === 200);
      ok('search: .* matches nothing', titles(await list(tAdmin, 'q=.*')) === '');
      ok('mine, agency: their accounts and what they sent', titles(await list(tProducer, 'mine=1')) === 'coi for acme,producer sent,qa');
      ok('mine, agency admin: narrows the whole book', !titles(await list(tColleague, 'mine=1')).length);
      ok('mine, VA: what they hold', titles(await list(tVa, 'mine=1')) === 'assigned,carrier,done mine');
      ok('pod', titles(await list(tOps, `${inA}&podId=${pod2.id}`)) === 'other pod');
      ok('no pod', titles(await list(tOps, `${inA}&podId=none`)) === 'unrouted');
      ok('bad pod: 400', (await list(tOps, 'podId=abc')).status === 400);
      ok('bad agency: 400', (await list(tOps, 'agencyId=abc')).status === 400);
      ok('assigned to me', titles(await list(tVa, 'assignee=me')) === 'assigned,carrier,done mine');
      ok('assigned to someone', titles(await list(tOps, `${inA}&assignee=${va2.id}`)) === 'done,qa');
      ok('nobody on it', titles(await list(tVa, 'assignee=none')) === 'coi for acme,needs agency,new,producer sent');
      ok('bad person: 400', (await list(tOps, 'assignee=abc')).status === 400);
      ok('overdue: not waiting, not closed', titles(await list(tOps, `${inA}&overdue=1`)) === 'qa');
    }

    console.log('An agency can\'t learn internal facts through filters');
    {
      const all = titles(await list(tAdmin));
      for (const [what, query] of [['pod', `podId=${pod2.id}`], ['no pod', 'podId=none'], ['assignee', `assignee=${va.id}`], ['nobody assigned', 'assignee=none'], ['overdue', 'overdue=1'], ['agency', `agencyId=${B.id}`]]) {
        ok(`${what}: no effect on an agency's list`, titles(await list(tAdmin, query)) === all);
      }
      const order = (r: { json: Json }) => (r.json.rows as { id: string }[]).map((t) => t.id).join();
      ok('sorting by due date has no effect', order(await list(tAdmin, 'sort=due')) === order(await list(tAdmin)));
      ok('nor by activity', order(await list(tAdmin, 'sort=activity')) === order(await list(tAdmin)));
    }

    console.log('Order and paging');
    {
      const order = (r: { json: Json }) => (r.json.rows as { title: string }[]).map((t) => t.title.replace(`${TAG} `, ''));
      const open = `${inA}&status=ASSIGNED,WAITING_ON_CARRIER,WAITING_ON_AGENCY,QA_REVIEW,NEW`;
      const due = order(await list(tOps, `${open}&sort=due`));
      ok('due: soonest first', due.slice(0, 4).join() === 'qa,carrier,needs agency,assigned');
      ok('due: no date comes last', due.length === 10 && due.slice(4).every((t) => !['qa', 'carrier', 'needs agency', 'assigned'].includes(t)));
      const a = order(await list(tOps, `${open}&sort=due&pageSize=3&page=1`));
      const b = order(await list(tOps, `${open}&sort=due&pageSize=3&page=2`));
      const c = order(await list(tOps, `${open}&sort=due&pageSize=3&page=3`));
      const d = order(await list(tOps, `${open}&sort=due&pageSize=3&page=4`));
      const e = order(await list(tOps, `${open}&sort=due&pageSize=3&page=5`));
      ok('due: pages join up across the dated and undated parts', [...a, ...b, ...c, ...d].join() === due.join() && a.length === 3 && b.length === 3);
      ok('due: past the end is empty', e.length === 0);
      await prisma.task.update({ where: { id: tNew.id }, data: { lastActivityAt: new Date(now + hour) } });
      ok('activity: latest first', order(await list(tOps, `${inA}&sort=activity`))[0] === 'new');
      const newest = await list(tOps, inA);
      const stamps = (newest.json.rows as { createdAt: string }[]).map((t) => t.createdAt);
      ok('newest first by default', stamps.every((s, i) => i === 0 || stamps[i - 1] >= s));
      ok('a bad sort: 400', (await list(tOps, 'sort=password')).status === 400);
      const sized = await list(tAdmin, 'pageSize=2&page=2');
      ok('total counts every match; a page holds its size', sized.json.total === 12 && sized.json.rows.length === 2 && sized.json.page === 2);
      ok('page size has a limit', (await list(tAdmin, 'pageSize=5000')).json.pageSize === 100);
      ok('nonsense page numbers fall back', (await list(tAdmin, 'page=abc&pageSize=-3')).json.page === 1 && (await list(tAdmin, 'pageSize=-3')).json.pageSize === 1);
      ok('lists leave out the details text', !JSON.stringify((await list(tAdmin)).json).includes('Needs a certificate'));
    }

    console.log('Opening a request');
    {
      const opened = await detail(tAdmin, first.json.id);
      ok('details included', opened.status === 200 && opened.json.description === 'Needs a certificate');
      const log = await prisma.deskAuditLog.findFirst({ where: { action: 'task.viewed', entityId: first.json.id, actorId: admin.id } });
      ok('opening is logged', !!log);
      ok('with no client text', !!log && !JSON.stringify(log.metadata).includes('certificate') && !JSON.stringify(log.metadata).includes(TAG));
      const before = await denials(tB2.id);
      ok('another agency: 404', (await detail(tAdmin, tB2.id)).status === 404);
      ok('and the attempt logged', await denials(tB2.id) === before + 1);
      ok('assigned-only, not theirs: 404', (await detail(tProducer, tAgency.id)).status === 404);
      ok('VA, restricted task: 404', (await detail(tVa, tRestricted.id)).status === 404);
      ok('VA, someone else\'s closed task: 404', (await detail(tVa, tDone.id)).status === 404);
      ok('VA, no pod: 404', (await detail(tVa, tUnrouted.id)).status === 404);
      ok('a bad id: 404', (await detail(tAdmin, 'abc')).status === 404);
      ok('no session: 401', (await detail(null, first.json.id)).status === 401);
      const scope = await resolveDeskScope(prisma, admin.id);
      const noLog = new Proxy(prisma, { get(target, key) {
        if (key === 'deskAuditLog') return { create: async () => { throw new Error('log down'); } };
        const value = Reflect.get(target, key);
        return typeof value === 'function' ? value.bind(target) : value;
      } }) as PrismaClient;
      const refused = await getTaskDetail(noLog, scope, first.json.id).then(() => false, () => true);
      ok('if it can\'t be logged, it doesn\'t open', refused);
    }

    console.log('The agency\'s view of one request');
    {
      const id = first.json.id;
      await assign(tAm, id, { assigneeId: va.id });
      await status(tVa, id, { status: 'IN_PROGRESS' });
      await note(tVa, id, { body: 'Internal note secret' });
      await note(tVa, id, { body: 'Shared with you', visibility: 'AGENCY' });
      await note(tColleague, id, { body: 'From a colleague' });
      await status(tVa, id, { status: 'WAITING_ON_CARRIER', reason: 'Carrier reason secret' });
      await status(tVa, id, { status: 'WAITING_ON_AGENCY', reason: 'Please send the certificate holder' });
      await prisma.task.update({ where: { id }, data: { restrictionReason: 'Restriction secret', escalated: true, escalationReason: 'Escalation secret' } });
      await prisma.taskEvent.create({ data: { taskId: id, agencyId: A.id, actorId: gone.id, kind: 'STATUS_CHANGED', visibility: 'AGENCY', fromStatus: 'WAITING_ON_AGENCY', toStatus: 'WAITING_ON_CARRIER', body: 'Second carrier secret', metadata: { billing: { class: 'INCLUDED' } } } });
      await prisma.taskEvent.create({ data: { taskId: id, agencyId: A.id, actorId: va.id, kind: 'STATUS_CHANGED', visibility: 'AGENCY', fromStatus: 'COMPLETED', toStatus: 'IN_PROGRESS', body: 'Reopen secret' } });
      await prisma.task.update({ where: { id }, data: { status: 'WAITING_ON_AGENCY' } });
      const view = (await detail(tColleague, id)).json;
      const text = JSON.stringify(view);
      for (const hidden of ['podId', 'Pod Secret', '"pod"', 'assignee', 'accountManager', `${TAG}va`, `${TAG}am`, 'dueAt', 'slaDueAt', 'slaTarget', 'slaPaused', 'waitingSince', 'overdue', 'lastActivityAt', 'restricted', 'Restriction secret', 'billing', 'nonBillable', 'escalat', 'Escalation secret', 'WAITING_ON', 'QA_REVIEW', 'INTERNAL', 'visibility', 'details', 'metadata', 'Internal note secret', 'Carrier reason secret', 'Second carrier secret', 'Reopen secret', '"source"']) {
        ok(`nothing internal: ${hidden}`, !text.includes(hidden));
      }
      const events = view.events as { kind: string; body: string | null; actorName: string; statusLabel: string | null }[];
      ok('simplified status', view.status === 'NEEDS_ATTENTION' && view.statusLabel === 'Needs your attention');
      ok('shared notes shown', events.some((e) => e.body === 'Shared with you'));
      ok('what\'s needed from them is shown', events.some((e) => e.body === 'Please send the certificate holder' && e.statusLabel === 'Needs your attention'));
      ok('a status change whose reason is withheld still shows', events.some((e) => e.kind === 'STATUS_CHANGED' && e.body === null && e.statusLabel === 'In progress'));
      ok('colleagues by name', events.some((e) => e.body === 'From a colleague' && e.actorName === `${TAG}colleague Person`));
      ok('staff as one team', events.find((e) => e.body === 'Shared with you')?.actorName === 'Your Desk team');
      ok('the history runs oldest first', events[0].kind === 'CREATED');
      ok('count matches what they can see', view.eventsTotal === events.length);
      const internal = await prisma.taskEvent.count({ where: { taskId: id, visibility: 'INTERNAL' } });
      ok('there really were internal entries to hide', internal >= 2);

      const asAnswer = JSON.stringify([(await list(tColleague, `q=${first.json.reference}`)).json]);
      for (const hidden of ['pod', 'assignee', 'dueAt', 'billing', 'WAITING_ON', 'escalat']) ok(`nor in a list: ${hidden}`, !asAnswer.toLowerCase().includes(hidden.toLowerCase()));
    }

    console.log('What staff see');
    {
      const id = first.json.id;
      const viewVa = (await detail(tVa, id)).json;
      const textVa = JSON.stringify(viewVa);
      ok('VA: internal status and notes', viewVa.status === 'WAITING_ON_AGENCY' && textVa.includes('Internal note secret') && textVa.includes('Carrier reason secret'));
      ok('VA: pod, people and dates', viewVa.pod?.name === pod.name && viewVa.assignee?.id === va.id && viewVa.accountManager?.id === am.id && 'dueAt' in viewVa);
      ok('VA: policy details for the work', viewVa.policy?.carrierName === 'Carrier X');
      for (const hidden of ['billing', 'restrictedToUserIds', 'restrictionReason', 'Restriction secret', 'escalationReason', 'Escalation secret', 'slaTarget', 'slaDueAt', 'nonBillable']) {
        ok(`VA isn't shown: ${hidden}`, !textVa.includes(hidden));
      }
      const viewAm = (await detail(tAm, id)).json;
      ok('Account Manager: billing, restriction and escalation', 'billing' in viewAm && viewAm.restrictionReason === 'Restriction secret' && viewAm.escalationReason === 'Escalation secret' && 'slaDueAt' in viewAm);
      ok('Account Manager: an event\'s full details', (viewAm.events as { details: { billing?: unknown } }[]).some((e) => e.details.billing));
      ok('VA: an event\'s billing details left out', !(viewVa.events as { details: { billing?: unknown } }[]).some((e) => e.details.billing));
      const assigned = (viewAm.events as { kind: string; assignedTo?: string; assignedFrom?: string | null }[]).find((e) => e.kind === 'ASSIGNED');
      ok('assignments read as names', assigned?.assignedTo === `${TAG}va Person` && assigned?.assignedFrom === null);
      ok('a person\'s name, not their id, in the history', !!(viewAm.events as { actorName: string }[]).find((e) => e.actorName === `${TAG}va Person`));

      await prisma.taskEvent.create({ data: { taskId: tNew.id, agencyId: A.id, actorId: null, kind: 'ROUTED', metadata: { podId: pod.id, automatic: true } } });
      await prisma.taskEvent.create({ data: { taskId: tNew.id, agencyId: A.id, actorId: '0'.repeat(24), kind: 'NOTE', body: 'Old note' } });
      await prisma.taskEvent.create({ data: { taskId: tNew.id, agencyId: A.id, actorId: va.id, kind: 'NOTE', body: 'With clock', metadata: { clock: { resumed: true }, automatic: 'x', other: 'y' } } });
      const fresh = (await detail(tVa, tNew.id)).json.events as { body: string | null; actorName: string; details: Record<string, unknown> }[];
      ok('automatic steps read as The Desk', fresh[0].actorName === 'The Desk');
      ok('someone since removed reads as a former user', fresh.find((e) => e.body === 'Old note')?.actorName === 'Former user');
      const withClock = fresh.find((e) => e.body === 'With clock')!;
      ok('VA: only chosen event details reach them', 'clock' in withClock.details && 'automatic' in withClock.details && !('other' in withClock.details));

      const view = (await list(tVa, `q=${first.json.reference}`)).json.rows[0];
      ok('VA lists are the VA view too', view.status === 'WAITING_ON_AGENCY' && !('billing' in view));
      const rows = (await list(tOps, `${inA}&q=qa`)).json.rows[0];
      ok('overdue marked', rows.overdue === true);
      ok('a wait isn\'t overdue', (await list(tOps, `${inA}&status=WAITING_ON_CARRIER`)).json.rows[0].overdue === false);
      ok('finished work isn\'t overdue', (await list(tOps, `${inA}&q=done&assignee=${va2.id}`)).json.rows[0].overdue === false);
      ok('a future date isn\'t overdue', (await list(tOps, `${inA}&status=ASSIGNED&assignee=${va.id}`)).json.rows.every((r: { overdue: boolean; title: string }) => !r.overdue));
      ok('waiting since shown', !!(await list(tOps, `${inA}&status=WAITING_ON_CARRIER`)).json.rows[0].waitingSince);
    }

    console.log('A long history');
    {
      const long = await mkTask('long');
      const start = Date.now() - 1_000_000;
      await prisma.taskEvent.createMany({ data: Array.from({ length: 503 }, (_, i) => ({ taskId: long.id, agencyId: A.id, kind: 'NOTE' as const, visibility: 'AGENCY' as const, body: `n${i}`, createdAt: new Date(start + i * 1000) })) });
      const view = (await detail(tAdmin, long.id)).json;
      ok('keeps the latest 500, oldest of them first', view.events.length === 500 && view.events[0].body === 'n3' && view.events[499].body === 'n502');
      ok('and says how many there are', view.eventsTotal === 503);
    }

    console.log('Changing status');
    {
      const t = await mkTask('flow', { status: 'NEW' });
      const refusedBefore = await denials(t.id);
      ok('agency, other than cancel: 403', (await status(tAdmin, t.id, { status: 'IN_PROGRESS' })).status === 403);
      ok('and logged', await denials(t.id) === refusedBefore + 1);
      ok('another agency: 404', (await status(tB, t.id, { status: 'CANCELLED', reason: 'x' })).status === 404);
      ok('a VA who hasn\'t picked it up: 403', (await status(tVa, t.id, { status: 'CANCELLED', reason: 'x' })).status === 403);
      ok('not JSON: 400', (await status(tAm, t.id, 'nope')).status === 400);
      ok('a list: 400', (await status(tAm, t.id, [])).status === 400);
      ok('no status: 400', (await status(tAm, t.id, {})).status === 400);
      ok('an unknown status: 400', (await status(tAm, t.id, { status: 'constructor' })).status === 400);
      ok('a reason that isn\'t text: 400', (await status(tAm, t.id, { status: 'CANCELLED', reason: { a: 1 } })).status === 400);
      ok('cancelling with no reason: 400', (await status(tAdmin, t.id, { status: 'CANCELLED' })).status === 400);
      ok('a move that isn\'t allowed: 409', (await status(tAm, t.id, { status: 'COMPLETED' })).status === 409);
      const cancelled = await status(tAdmin, t.id, { status: 'CANCELLED', reason: 'Client changed their mind' });
      ok('agency can cancel before work starts', cancelled.status === 200);
      ok('and gets the agency view back', cancelled.json.status === 'CANCELLED' && cancelled.json.statusLabel === 'Cancelled' && !JSON.stringify(cancelled.json).includes('podId') && !('pod' in cancelled.json));
      ok('their own reason shows in their history', ((await detail(tAdmin, t.id)).json.events as { body: string }[]).some((e) => e.body === 'Client changed their mind'));
      const reopened = await status(tAm, t.id, { status: 'NEW', reason: 'Opened again' });
      ok('Account Manager reopens, with the staff view back', reopened.status === 200 && reopened.json.status === 'NEW' && 'billing' in reopened.json);
    }

    console.log('Assigning');
    {
      const t = await mkTask('to assign');
      ok('no person given: 400, and not read as unassign', (await assign(tAm, t.id, {})).status === 400);
      ok('nonsense: 400', (await assign(tAm, t.id, { assigneeId: 'abc' })).status === 400);
      ok('not text: 400', (await assign(tAm, t.id, { assigneeId: { a: 1 } })).status === 400);
      ok('a list: 400', (await assign(tAm, t.id, [])).status === 400);
      ok('agency: 403', (await assign(tAdmin, t.id, { assigneeId: va.id })).status === 403);
      ok('another agency: 404', (await assign(tB, t.id, { assigneeId: va.id })).status === 404);
      ok('someone not authorized: 400', (await assign(tAm, t.id, { assigneeId: vaOut.id })).status === 400);
      ok('an agency user: 400', (await assign(tAm, t.id, { assigneeId: admin.id })).status === 400);
      ok('an unknown person: 400', (await assign(tAm, t.id, { assigneeId: '0'.repeat(24) })).status === 400);
      ok('VA can\'t give it to someone else: 403', (await assign(tVa, t.id, { assigneeId: va2.id })).status === 403);
      const picked = await assign(tVa, t.id, { assigneeId: va.id });
      ok('VA picks it up', picked.status === 200 && picked.json.assignee?.id === va.id && picked.json.status === 'ASSIGNED');
      ok('another VA can\'t take it', (await assign(tVa2, t.id, { assigneeId: va2.id })).status === 403);
      ok('picked up twice: 409', (await assign(tVa, t.id, { assigneeId: va.id })).status === 409);
      const released = await assign(tVa, t.id, { assigneeId: null });
      ok('VA releases it', released.status === 200 && released.json.assignee === null && released.json.status === 'NEW');
      const given = await assign(tAm, t.id, { assigneeId: va2.id });
      ok('Account Manager assigns', given.status === 200 && given.json.assignee?.id === va2.id && 'billing' in given.json);
    }

    console.log('Notes');
    {
      const t = await mkTask('notes', { status: 'WAITING_ON_AGENCY', assigneeId: va.id, slaPausedAt: new Date(now - hour) });
      ok('empty: 400', (await note(tAdmin, t.id, { body: '  ' })).status === 400);
      ok('not text: 400', (await note(tAdmin, t.id, { body: 5 })).status === 400);
      ok('a list: 400', (await note(tAdmin, t.id, [])).status === 400);
      ok('another agency: 404', (await note(tB, t.id, { body: 'x' })).status === 404);
      ok('staff, a bad choice: 400', (await note(tVa, t.id, { body: 'x', visibility: 'PUBLIC' })).status === 400);
      const staffNote = await note(tVa, t.id, { body: 'Internal by default' });
      ok('staff: internal by default', staffNote.status === 201 && (await prisma.taskEvent.findFirstOrThrow({ where: { taskId: t.id, body: 'Internal by default' } })).visibility === 'INTERNAL');
      ok('and not resumed', staffNote.json.resumed === false);
      const reply = await note(tAdmin, t.id, { body: 'Here it is', visibility: 'INTERNAL' });
      ok('agency: always shared, whatever is asked', (await prisma.taskEvent.findFirstOrThrow({ where: { taskId: t.id, body: 'Here it is' } })).visibility === 'AGENCY');
      ok('a reply restarts waiting work', reply.status === 201 && reply.json.resumed === true && (await prisma.task.findUniqueOrThrow({ where: { id: t.id } })).status === 'IN_PROGRESS');
      ok('and the answer is the agency view', reply.json.task.status === 'IN_PROGRESS' && !('assignee' in reply.json.task) && !JSON.stringify(reply.json).includes('dueAt'));
      const noted = await prisma.deskAuditLog.findFirst({ where: { action: 'task.note_added', entityId: t.id } });
      ok('logged without the text', !!noted && !JSON.stringify(noted.metadata).includes('Here it is'));
    }

    console.log('The routes');
    for (const p of ['route.ts', '[id]/route.ts', '[id]/status/route.ts', '[id]/assign/route.ts', '[id]/notes/route.ts']) {
      const text = read(`app/api/desk/tasks/${p}`);
      ok(`${p}: goes through the views, never the raw service`, text.includes("from '@/lib/desk/task-api'") && !text.includes('desk/tasks\''));
    }
  } catch (err) {
    console.error(err);
    fail++;
  } finally {
    try {
      await wipe();
      const left = await prisma.user.count({ where: { email: { startsWith: TAG } } }) + await prisma.agency.count({ where: { name: { startsWith: TAG } } }) + await prisma.pod.count({ where: { code: { startsWith: TAG } } });
      ok('nothing left behind', left === 0);
    } catch (err) {
      console.error('cleanup failed', err);
      fail++;
    }
    console.log(`\n${pass} passed, ${fail} failed`);
    await prisma.$disconnect();
    process.exit(fail ? 1 : 0);
  }
})();
