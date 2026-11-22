/**
 * Module 45: the demo data, and an end-to-end walkthrough of the four views
 * on it, through the real API routes with real sign-ins.
 *
 *  - The seeder: refuses a short password or a second copy; every person and
 *    agency is on the reserved .invalid domain; no email can go to them.
 *  - Each view as its own people: Insurigence Admin, Account Managers,
 *    Pod / VA, and the agency (Owner / Admin, CSR, Producer, the other agency).
 *  - The target workflow end to end: the agency files a request, it's routed
 *    to its pod with the Account Manager attached, a VA picks it up, asks the
 *    agency a question, the agency answers, QA, completed, the agency sees it.
 *  - Removal: everything of the demo goes, nothing else is touched, and an
 *    agency holding someone outside the demo isn't removed at all.
 *
 * Runs on its own domain (m45test<time>.invalid), so a demo someone is
 * showing is never touched. Against the shared database; removed at the end.
 */
import 'dotenv/config';
import { NextRequest } from 'next/server';
import { prisma } from '../lib/prisma';
import { findDemo, removeDemo, seedDemo, demoPassword, DEMO_DOMAIN } from '../lib/desk/demo';
import { isUndeliverableAddress, sendEmail } from '../lib/email/send';
import { resolveDeskScope } from '../lib/desk/access';
import { getAgencySetup } from '../lib/desk/agency-setup';
import { literal } from '../lib/desk/literal-match';

process.env.DESK_EMAIL_NOTIFICATIONS = 'off';
process.env.RESEND_API_KEY = '';

let pass = 0, fail = 0;
const started = Date.now();
const section = (name: string) => console.log(`${name}  (${Math.round((Date.now() - started) / 1000)} s)`);
const ok = (n: string, c: boolean, detail?: unknown) => {
  c ? pass++ : fail++;
  console.log(`  ${c ? '✓' : '✗'} ${n}${!c && detail !== undefined ? `  ${JSON.stringify(detail).slice(0, 400)}` : ''}`);
  if (!c && process.env.FAIL_FAST) throw new Error(`stopped at: ${n}`);
};
type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any
type Handler = (req: NextRequest, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;

const DOMAIN = `m45test${Date.now()}.invalid`;
/** The demo's ids, for a cleanup that doesn't rely on the removal being tested. */
const captured = { userIds: [] as string[], agencyIds: [] as string[] };
const PASSWORD = demoPassword();

async function route(path: string): Promise<Record<string, Handler>> {
  return import(`../app/api/${path}/route`);
}
async function call(path: string, method: string, token: string | null, opts: { params?: Record<string, string>; body?: unknown; query?: string } = {}) {
  const handlers = await route(path);
  let url = `/api/${path}`;
  for (const [k, v] of Object.entries(opts.params ?? {})) url = url.replace(`[${k}]`, v);
  const headers: Record<string, string> = { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.45' };
  if (token) headers.cookie = `session_token=${token}`;
  const req = new NextRequest(`http://local.test${url}${opts.query ? `?${opts.query}` : ''}`, {
    method, headers, ...(opts.body === undefined ? {} : { body: JSON.stringify(opts.body) }),
  });
  try {
    const res = await handlers[method](req, { params: Promise.resolve(opts.params ?? {}) });
    const text = await res.text();
    let json: Json = null;
    try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, text, json, headers: res.headers };
  } catch (err) {
    return { status: 599, text: `THREW ${String((err as Error)?.message ?? err)}`, json: null, headers: new Headers() };
  }
}

/** What the rest of the database holds, so removal can be shown to touch nothing else. */
async function snapshot() {
  const notDemo = { not: { endsWith: literal(DOMAIN) } };
  const [agencies, users, tasks, pods, members, rules, followUps, plans, targets] = await Promise.all([
    prisma.agency.count({ where: { OR: [{ primaryEmail: null }, { primaryEmail: notDemo }] } }),
    prisma.user.count({ where: { email: notDemo } }),
    prisma.task.count(), prisma.pod.findMany({ select: { id: true, name: true, isActive: true }, orderBy: { id: 'asc' } }),
    prisma.podMember.count(), prisma.taskRoutingRule.findMany({ select: { taskType: true, podId: true, isActive: true }, orderBy: { taskType: 'asc' } }),
    prisma.taskFollowUpRule.count(), prisma.deskPlan.findMany({ select: { code: true, monthlyPriceCents: true }, orderBy: { code: 'asc' } }),
    prisma.serviceLevelTarget.count(),
  ]);
  return JSON.stringify({ agencies, users, tasks, pods, members, rules, followUps, plans: plans.map((p) => [p.code, String(p.monthlyPriceCents)]), targets });
}

(async () => {
  const before = await snapshot();
  const tasksBefore = await prisma.task.count();
  try {
    section('The reserved addresses');
    for (const [addr, expected] of [
      [`olivia.ops@${DEMO_DOMAIN}`, true], ['a@b.invalid', true], ['a@example.com', true], ['a@mail.example.org', true], ['a@x.test', true], ['A@HOST.LOCALHOST', true],
      ['a@gmail.com', false], ['a@invalid.com', false], ['a@notexample.com', false], ['a@example.co', false], ['a@testing.io', false],
    ] as const) ok(`${addr}: ${expected ? 'never emailed' : 'emailed as usual'}`, isUndeliverableAddress(addr) === expected);
    {
      // Even with a key configured, a reserved address is skipped before anything is sent.
      process.env.RESEND_API_KEY = 're_m45_not_a_real_key';
      const r = await sendEmail({ to: `hannah.owner@${DOMAIN}`, subject: 'x', html: 'x' });
      process.env.RESEND_API_KEY = '';
      ok('an email to a demo address is skipped, even with email configured', r.ok === false && r.skipped === true, r);
    }

    section('Seeding');
    {
      const short = await seedDemo(prisma, { password: 'short', domain: DOMAIN }).then(() => 'seeded', (e: Error) => e.message);
      ok('a short password is refused, before anything is written', /12 characters/.test(short) && (await findDemo(prisma, DOMAIN)).users.length === 0, short);
    }
    const t0 = Date.now();
    const seeded = await seedDemo(prisma, { password: PASSWORD, domain: DOMAIN });
    console.log(`  (seeded in ${Math.round((Date.now() - t0) / 1000)} s)`);
    const again = await seedDemo(prisma, { password: PASSWORD, domain: DOMAIN }).then(() => 'seeded', (e: Error) => e.message);
    ok('a second copy is refused', /already exists/.test(again), again);

    const demo = await findDemo(prisma, DOMAIN);
    const agencies = await prisma.agency.findMany({ where: { id: { in: demo.agencies.map((a) => a.id) } } });
    const harbor = agencies.find((a) => a.name.startsWith('Harbor'))!, summit = agencies.find((a) => a.name.startsWith('Summit'))!;
    const users = await prisma.user.findMany({ where: { id: { in: demo.users.map((u) => u.id) } } });
    captured.userIds = users.map((u) => u.id); captured.agencyIds = agencies.map((a) => a.id);
    const U = (local: string) => users.find((u) => u.email === `${local}@${DOMAIN}`)!;
    ok('two agencies with The Desk on, and ten people', agencies.length === 2 && agencies.every((a) => a.deskEnabled) && users.length === 10);
    ok('every person and agency is on the reserved domain', users.every((u) => u.email.endsWith(`@${DOMAIN}`)) && agencies.every((a) => a.primaryEmail?.endsWith(`@${DOMAIN}`)));
    ok('one login for every role in the four views', ['DESK_ADMIN', 'ACCOUNT_MANAGER', 'DESK_VA', 'ADMIN', 'CSR', 'AGENT'].every((r) => users.some((u) => u.role === r)) && seeded.logins.length === 10);
    ok('no demo person has a Super Admin role', users.every((u) => u.role !== 'SUPER_ADMIN'));
    ok('nobody is asked to change the password on first sign-in', users.every((u) => !u.mustChangePassword && u.isActive));
    const accounts = await prisma.insuredAccount.count({ where: { agencyId: { in: [harbor.id, summit.id] } } });
    const policies = await prisma.policy.count({ where: { agencyId: { in: [harbor.id, summit.id] } } });
    ok('books: 7 accounts and 12 policies', accounts === 7 && policies === 12, { accounts, policies });
    const tasks = await prisma.task.findMany({ where: { agencyId: { in: [harbor.id, summit.id] } }, include: { pod: true } });
    const T = (title: string) => tasks.find((t) => t.title.startsWith(title))!;
    const statuses = new Set(tasks.map((t) => t.status));
    ok('requests at every stage', ['NEW', 'ASSIGNED', 'IN_PROGRESS', 'WAITING_ON_AGENCY', 'WAITING_ON_CARRIER', 'COMPLETED', 'CANCELLED'].every((s) => statuses.has(s as never)), [...statuses]);
    ok('each routed to its pod, with the agency\'s Account Manager', tasks.every((t) => t.podId && t.amId === (t.agencyId === harbor.id ? U('marcus.am').id : U('priya.am').id)));
    ok('the renewal\'s completion created its follow-up for Pod 1', tasks.some((t) => t.followUpRuleId && t.parentTaskId === T('Cedar Lane Dental BOP renewal').id && t.pod?.code === 'SERVICE_AMS'));
    ok('a team subtask, an escalation, an overdue request, a restricted one', tasks.some((t) => t.parentTaskId && !t.followUpRuleId) && T('Quote umbrella').escalated
      && T('Quote umbrella').slaDueAt! < new Date() && T('File the coverage dispute').restrictedToUserIds.length === 1);
    ok('the history and the audit log are real', (await prisma.taskEvent.count({ where: { agencyId: harbor.id } })) > 20 && (await prisma.deskAuditLog.count({ where: { agencyId: harbor.id } })) > 20);
    {
      const ops = await resolveDeskScope(prisma, U('olivia.ops').id);
      const setups = await Promise.all([harbor, summit].map((a) => getAgencySetup(prisma, ops, a.id)));
      ok('both agencies\' setup checklists are complete', setups.every((s: Json) => s.checklist.every((i: Json) => i.done)), setups.map((s: Json) => s.checklist));
    }
    ok('each agency authorises only the demo VAs, by name', (await prisma.agencyPodAccess.findMany({ where: { agencyId: { in: [harbor.id, summit.id] } } })).every((a) => a.userId && users.some((u) => u.id === a.userId)));

    section('Signing in');
    const tok: Record<string, string> = {};
    for (const u of users) {
      const r = await call('auth/login', 'POST', null, { body: { email: u.email, password: PASSWORD } });
      const cookie = r.headers.get('set-cookie') ?? '';
      tok[u.email.split('@')[0]] = /session_token=([^;]+)/.exec(cookie)?.[1] ?? '';
    }
    ok('every demo login signs in with the demo password', Object.values(tok).length === 10 && Object.values(tok).every(Boolean), Object.keys(tok).filter((k) => !tok[k]));
    const wrong = await call('auth/login', 'POST', null, { body: { email: `hannah.owner@${DOMAIN}`, password: `${PASSWORD}x` } });
    ok('…and not with a wrong one', wrong.status === 401, wrong.status);

    const list = async (who: string, query = 'pageSize=100') => (await call('desk/tasks', 'GET', tok[who], { query })).json?.rows as Json[] ?? [];
    const titles = (rows: Json[]) => rows.map((r) => r.title as string);
    const has = (rows: Json[], t: string) => titles(rows).some((x) => x.startsWith(t));

    section('Insurigence Admin (Olivia, Operations Manager)');
    {
      const ag = await call('desk/admin/agencies', 'GET', tok['olivia.ops']);
      ok('the agency setup list shows both demo agencies', ag.status === 200 && ag.text.includes(harbor.id) && ag.text.includes(summit.id), ag.status);
      const usage = await call('desk/usage', 'GET', tok['olivia.ops']);
      ok('usage shows both agencies against their plans', usage.status === 200 && usage.text.includes(harbor.id) && usage.text.includes(summit.id), usage.status);
      const work = await call('desk/workload', 'GET', tok['olivia.ops']);
      ok('workload shows each VA\'s open work', work.status === 200 && ['diego.va', 'grace.va', 'liam.va'].every((v) => work.text.includes(U(v).id)), work.status);
      const turn = await call('desk/turnaround', 'GET', tok['olivia.ops']);
      ok('turnaround answers', turn.status === 200, turn.status);
      const audit = await call('desk/audit', 'GET', tok['olivia.ops'], { query: `agencyId=${harbor.id}` });
      ok('the audit log shows the demo\'s activity', audit.status === 200 && audit.text.includes('task.created'), audit.status);
      const staff = await call('desk/admin/staff', 'GET', tok['olivia.ops']);
      ok('staff lists the Desk team', staff.status === 200 && ['marcus.am', 'diego.va'].every((v) => staff.text.includes(U(v).id)), staff.status);
      const all = await list('olivia.ops');
      ok('every open and closed request of both agencies', tasks.filter((t) => !t.parentTaskId).every((t) => all.some((r) => r.id === t.id)));
    }

    section('Account Managers (Marcus: Harbor, backup for Summit; Priya: the reverse)');
    {
      const dash = await call('desk/dashboard', 'GET', tok['marcus.am']);
      ok('the dashboard answers, with the escalated request', dash.status === 200 && dash.text.includes(T('Quote umbrella').id), dash.status);
      const managed = await call('desk/agencies', 'GET', tok['marcus.am']);
      ok('his agencies: both', managed.status === 200 && managed.text.includes(harbor.id) && managed.text.includes(summit.id), managed.status);
      const page = await call('desk/agencies/[id]', 'GET', tok['marcus.am'], { params: { id: harbor.id } });
      ok('Harbor\'s page opens for him', page.status === 200 && page.text.includes('Harbor & Pine'), page.status);
      const mine = await list('marcus.am');
      ok('the restricted request is there for the Account Manager', has(mine, 'File the coverage dispute'));
      const thread = await call('desk/messages/[agencyId]', 'GET', tok['marcus.am'], { params: { agencyId: harbor.id } });
      ok('the agency\'s conversation is there', thread.status === 200 && thread.text.includes('onboarding two new commercial accounts'), thread.status);
      const priya = await call('desk/agencies', 'GET', tok['priya.am']);
      ok('Priya\'s agencies: both too', priya.status === 200 && priya.text.includes(harbor.id) && priya.text.includes(summit.id), priya.status);
    }

    section('Pod / VA');
    {
      const diego = await list('diego.va'), grace = await list('grace.va'), liam = await list('liam.va');
      ok('Diego (Pod 1): both agencies\' service work, and the request restricted to him', ['Certificate for Portland', 'Add 2026 Ford Transit', 'Certificate for Burlington', 'File the coverage dispute'].every((t) => has(diego, t)), titles(diego));
      ok('…not renewals or new business', !has(diego, 'Greenleaf Landscaping renewal') && !has(diego, 'Quote umbrella'));
      ok('Grace (Renewals): the renewals, not Pod 1\'s work or the restricted request', has(grace, 'Greenleaf Landscaping renewal') && !has(grace, 'Certificate for Portland') && !has(grace, 'File the coverage dispute') && !has(grace, 'Certificate for Burlington'), titles(grace));
      ok('Liam (New Business): the umbrella quote only', has(liam, 'Quote umbrella') && liam.every((r) => r.title.startsWith('Quote umbrella')), titles(liam));
      const queue = await call('desk/queue', 'GET', tok['diego.va']);
      ok('Diego\'s queue answers', queue.status === 200, queue.status);
      const detail = await call('desk/tasks/[id]', 'GET', tok['diego.va'], { params: { id: T('Certificate for Portland').id } });
      ok('Diego\'s request page shows his internal note', detail.status === 200 && detail.text.includes('CG 20 26'));
      const out = await call('desk/tasks/[id]', 'GET', tok['grace.va'], { params: { id: T('Certificate for Portland').id } });
      ok('Grace can\'t open Pod 1\'s request', out.status === 404, out.status);
    }

    section('The agency');
    {
      const hannah = await list('hannah.owner');
      const top = tasks.filter((t) => t.agencyId === harbor.id && !t.parentTaskId);
      ok('Hannah (Owner / Admin): every Harbor request', top.every((t) => hannah.some((r) => r.id === t.id)), top.length);
      ok('…not the team\'s subtasks or follow-ups, nor Summit\'s work', hannah.length === top.length && !has(hannah, 'Request 5-year loss runs') && !has(hannah, 'Certificate for Burlington'), titles(hannah));
      const pages = await Promise.all(top.map((t) => call('desk/tasks/[id]', 'GET', tok['hannah.owner'], { params: { id: t.id } })));
      const text = pages.map((p) => p.text).join('\n');
      ok('her request pages open', pages.every((p) => p.status === 200), pages.map((p) => p.status));
      ok('she sees the question asked of her, and the note shared with her', text.includes('send the VIN') && text.includes('you will have it today'));
      ok('…not internal notes, the carrier reason, the restriction or the escalation', !text.includes('CG 20 26') && !text.includes('Keystone underwriting') && !text.includes('Open litigation') && !text.includes('Board meeting moved up'));
      ok('…not targets, the Desk staff\'s names or pods (Q5)', !/"(slaDueAt|dueAt)"/.test(text) && !text.includes('Diego') && !text.includes('Santos') && !text.includes(T('Certificate for Portland').podId!));
      const nina = await list('nina.producer');
      ok('Nina (Producer): requests on her accounts only', has(nina, 'Certificate for Portland') && has(nina, 'Quote umbrella') && !has(nina, 'Greenleaf Landscaping renewal') && !has(nina, 'Loss runs for Cedar Lane'), titles(nina));
      const ninaBook = await call('desk/insureds', 'GET', tok['nina.producer']);
      ok('…and only her two accounts in the book', ninaBook.status === 200 && ninaBook.text.includes('Bayside Marine') && ninaBook.text.includes('Northwind') && !ninaBook.text.includes('Cedar Lane'));
      const carlos = await list('carlos.csr');
      ok('Carlos (CSR with the whole book): every Harbor request', top.every((t) => carlos.some((r) => r.id === t.id)));
      const sam = await list('sam.owner');
      ok('Sam (the other agency): only Summit\'s requests', sam.length === 2 && has(sam, 'Certificate for Burlington') && !has(sam, 'Certificate for Portland'), titles(sam));
      const cross = await call('desk/tasks/[id]', 'GET', tok['sam.owner'], { params: { id: T('Certificate for Portland').id } });
      ok('…and can\'t open Harbor\'s', cross.status === 404);
      const tracker = await call('desk/tracker', 'GET', tok['hannah.owner']);
      ok('her tracker shows the request waiting on her, with the question', tracker.status === 200 && tracker.text.includes(T('Add 2026 Ford Transit').id) && tracker.text.includes('send the VIN'), tracker.status);
      const thread = await call('desk/messages/[agencyId]', 'GET', tok['hannah.owner'], { params: { agencyId: harbor.id } });
      ok('…and her conversation with the Desk', thread.status === 200 && thread.text.includes('make sure Pod 1 has capacity'), thread.status);
    }

    section('The workflow, end to end');
    {
      const bistro = await prisma.insuredAccount.findFirstOrThrow({ where: { agencyId: harbor.id, name: 'Harbor View Bistro' }, include: { policies: true } });
      const filed = await call('desk/tasks', 'POST', tok['hannah.owner'], { body: { type: 'COI', title: 'Certificate for Old Port Festival', insuredId: bistro.id, policyId: bistro.policies[0].id } });
      ok('the agency files a certificate request', filed.status === 201, filed.text.slice(0, 200));
      const id = filed.json?.id as string;
      const row = await prisma.task.findUniqueOrThrow({ where: { id }, include: { pod: true } });
      ok('routed to Pod 1 with Marcus attached and its target set', row.pod?.code === 'SERVICE_AMS' && row.amId === U('marcus.am').id && !!row.slaDueAt && row.status === 'NEW');
      ok('it\'s in Diego\'s list, not Grace\'s', has(await list('diego.va'), 'Certificate for Old Port') && !has(await list('grace.va'), 'Certificate for Old Port'));
      const step = async (who: string, sub: string, body: unknown) => call(`desk/tasks/[id]/${sub}`, 'POST', tok[who], { params: { id }, body });
      const pick = await step('diego.va', 'assign', { assigneeId: U('diego.va').id });
      ok('Diego picks it up', pick.status === 200, pick.text.slice(0, 200));
      ok('…starts work', (await step('diego.va', 'status', { status: 'IN_PROGRESS' })).status === 200);
      ok('…and asks the agency a question', (await step('diego.va', 'status', { status: 'WAITING_ON_AGENCY', reason: 'Which festival dates should the certificate cover?' })).status === 200);
      const seen = await call('desk/tasks/[id]', 'GET', tok['hannah.owner'], { params: { id } });
      ok('Hannah sees the question', seen.text.includes('Which festival dates'));
      const answer = await step('hannah.owner', 'notes', { body: 'June 12 to 14, 2027.' });
      ok('her answer puts it back to work', answer.status === 201 && (await prisma.task.findUniqueOrThrow({ where: { id } })).status === 'IN_PROGRESS', answer.text.slice(0, 200));
      ok('Diego sends it to QA', (await step('diego.va', 'status', { status: 'QA_REVIEW' })).status === 200);
      const done = await step('marcus.am', 'status', { status: 'COMPLETED' });
      ok('Marcus completes it', done.status === 200, done.text.slice(0, 200));
      const final = await prisma.task.findUniqueOrThrow({ where: { id } });
      ok('closed, with its time and billing recorded', final.status === 'COMPLETED' && !!final.completedAt && !!final.billingPeriod, { billingPeriod: final.billingPeriod });
      const agencyView = await call('desk/tasks/[id]', 'GET', tok['hannah.owner'], { params: { id } });
      ok('the agency sees the work completed, with its history', agencyView.status === 200 && /Completed/.test(agencyView.text) && agencyView.text.includes('June 12 to 14'));
      const events = await prisma.taskEvent.count({ where: { taskId: id } });
      const logged = await prisma.deskAuditLog.count({ where: { entityId: id } });
      ok('every step is in the history and the audit log', events >= 6 && logged >= 6, { events, logged });
      // The waiting endorsement: the Producer answers her own request.
      const vin = await call('desk/tasks/[id]/notes', 'POST', tok['nina.producer'], { params: { id: T('Add 2026 Ford Transit').id }, body: { body: 'VIN 1FTBR3X89PKA00000, garaged at 12 Wharf St.' } });
      ok('Nina answers the question on her endorsement, and it resumes', vin.status === 201 && (await prisma.task.findUniqueOrThrow({ where: { id: T('Add 2026 Ford Transit').id } })).status === 'IN_PROGRESS', vin.text.slice(0, 200));
    }

    section('Removal');
    {
      const outsider = await prisma.user.create({ data: { email: `${DOMAIN.replace('.invalid', '')}-outsider@insurigence.test`, role: 'CSR', agencyId: harbor.id } });
      const refused = await removeDemo(prisma, DOMAIN).then(() => 'removed', (e: Error) => e.message);
      ok('an agency holding someone outside the demo isn\'t removed', /aren't part of the demo/.test(refused) && (await prisma.agency.count({ where: { id: harbor.id } })) === 1, refused);
      await prisma.user.delete({ where: { id: outsider.id } });
      const other = await removeDemo(prisma, `m45other${Date.now()}.invalid`);
      ok('removing another domain\'s demo removes nothing of this one', other.agencies === 0 && other.users === 0 && (await findDemo(prisma, DOMAIN)).users.length === 10);
      // The domain's dots are matched literally: "x" in place of the dot is someone else.
      // Taken before removal: deleting a person only blanks the person on their sign-in history, so it is found by id.
      const eventIds = (await prisma.activityEvent.findMany({ where: { OR: [{ agencyId: { in: [harbor.id, summit.id] } }, { userId: { in: users.map((u) => u.id) } }] }, select: { id: true } })).map((e) => e.id);
      ok('the sign-ins left a history to remove', eventIds.length > 0, eventIds.length);
      const lookalike = await prisma.user.create({ data: { email: `lookalike@${DOMAIN.replace(/\.invalid$/, 'xinvalid')}`, role: 'CSR' } });
      const r = await removeDemo(prisma, DOMAIN);
      ok('removal takes the agencies, people and requests', r.agencies === 2 && r.users === 10 && r.tasks === tasks.length + 1, r);
      ok('…not someone on a lookalike domain', (await prisma.user.count({ where: { id: lookalike.id } })) === 1);
      await prisma.user.delete({ where: { id: lookalike.id } }).catch(() => undefined);
      const ids = { in: [harbor.id, summit.id] }, people = { in: users.map((u) => u.id) };
      const left = await Promise.all([
        prisma.insuredAccount.count({ where: { agencyId: ids } }), prisma.policy.count({ where: { agencyId: ids } }), prisma.task.count({ where: { agencyId: ids } }),
        prisma.taskEvent.count({ where: { agencyId: ids } }), prisma.deskAuditLog.count({ where: { OR: [{ agencyId: ids }, { actorId: people }] } }),
        prisma.deskMessage.count({ where: { agencyId: ids } }), prisma.podMember.count({ where: { userId: people } }), prisma.agencyPodAccess.count({ where: { agencyId: ids } }),
        prisma.session.count({ where: { userId: people } }), prisma.activityEvent.count({ where: { OR: [{ id: { in: eventIds } }, { userId: people }] } }), prisma.agencyDeskPlan.count({ where: { agencyId: ids } }),
      ]);
      ok('…and everything tied to them', left.every((n) => n === 0), left);
      ok('nothing else in the database changed', (await snapshot()) === before && (await prisma.task.count()) === tasksBefore);
    }
  } catch (err) {
    console.error(err);
    fail += 1;
  } finally {
    await new Promise((r) => setTimeout(r, 1500)); // the login's activity entry is written after it answers
    await removeDemo(prisma, DOMAIN).catch((e) => { console.error('cleanup failed', e); fail += 1; });
    // Belt and braces: anything tied to the demo's ids, whether or not removal took it.
    const people = { in: captured.userIds }, ids = { in: captured.agencyIds };
    await prisma.podMember.deleteMany({ where: { userId: people } });
    await prisma.agencyPodAccess.deleteMany({ where: { OR: [{ userId: people }, { agencyId: ids }] } });
    await prisma.deskAuditLog.deleteMany({ where: { OR: [{ actorId: people }, { agencyId: ids }] } });
    await prisma.activityEvent.deleteMany({ where: { OR: [{ userId: people }, { agencyId: ids }] } });
    await prisma.session.deleteMany({ where: { userId: people } });
    const left = await findDemo(prisma, DOMAIN);
    if (left.agencies.length || left.users.length) { console.error('left behind', left); fail += 1; }
    console.log(`\n${pass} passed, ${fail} failed`);
    await prisma.$disconnect();
    process.exit(fail ? 1 : 0);
  }
})();
