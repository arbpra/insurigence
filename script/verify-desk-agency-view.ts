/**
 * Module 35: the Account Manager's agency pages.
 *
 *   npx tsx script/verify-desk-agency-view.ts
 *
 * The work tabs and address; the list of agencies a manager looks after; one
 * agency's summary (setup, pods, counts, renewals); another AM's agency, one
 * with The Desk off and a VA refused and logged; opening an agency logged;
 * the work and accounts lists the page reads, through the real routes; and
 * the screens. Against the shared database, with temporary agencies, people,
 * a plan, pods, accounts, policies and requests, all removed at the end.
 */
import 'dotenv/config';
import { readFileSync } from 'fs';
import { NextRequest } from 'next/server';
import type { Prisma, UserRole } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { createSession } from '../lib/auth';
import { DeskAccessError, resolveDeskScope } from '../lib/desk/access';
import { agencySummary, managedAgencies } from '../lib/desk/agency-view';
import { managerDashboard } from '../lib/desk/manager-dashboard';
import { agencyWorkAddress, agencyWorkQuery, parseAgencyWork } from '../lib/desk/agency-page-view';
import { GET as listRoute } from '../app/api/desk/agencies/route';
import { GET as summaryRoute } from '../app/api/desk/agencies/[id]/route';
import { GET as tasksRoute } from '../app/api/desk/tasks/route';
import { GET as insuredsRoute } from '../app/api/desk/insureds/route';

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, detail = '') => {
  c ? pass++ : fail++;
  console.log(`  ${c ? '✓' : '✗'} ${n}${!c && detail ? `  [${detail}]` : ''}`);
  if (!c && process.env.FAIL_FAST) throw new Error(`stopped at: ${n}`);
};

const TAG = `m35test${Date.now()}`;
const cleanup = { agencyIds: [] as string[], userIds: [] as string[], podIds: [] as string[], planIds: [] as string[] };
let ref = 997_000_000 + Math.floor(Math.random() * 1_000_000);
const read = (p: string) => readFileSync(p, 'utf8');
type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any

async function wipe() {
  const agencyId = { in: cleanup.agencyIds };
  await prisma.taskEvent.deleteMany({ where: { agencyId } });
  await prisma.task.updateMany({ where: { agencyId }, data: { parentTaskId: null } });
  await prisma.task.deleteMany({ where: { agencyId } });
  await prisma.policy.deleteMany({ where: { agencyId } });
  await prisma.insuredAssignment.deleteMany({ where: { agencyId } });
  await prisma.insuredAccount.deleteMany({ where: { agencyId } });
  await prisma.agencyDeskPlan.deleteMany({ where: { agencyId } });
  await prisma.deskPlan.deleteMany({ where: { id: { in: cleanup.planIds } } });
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
const status = async (fn: () => Promise<unknown>) => {
  try { await fn(); return 200; } catch (e) { if (e instanceof DeskAccessError) return e.status; throw e; }
};

function pureLogic() {
  console.log('Work tabs and the address');
  const d = parseAgencyWork({});
  ok('defaults: open, every account, page 1', d.view === 'open' && d.account === '' && d.q === '' && d.page === 1);
  const odd = parseAgencyWork({ view: 'mine', account: 'not-an-id', page: '0', q: ['  x ', 'y'] });
  ok('anything unknown falls back', odd.view === 'open' && odd.account === '' && odd.page === 1 && odd.q === 'x');
  const id = 'a'.repeat(24);
  const f = parseAgencyWork({ view: 'completed', account: 'b'.repeat(24), q: 'acme', page: '2' });
  const back = agencyWorkAddress(id, f);
  ok('the address round-trips', JSON.stringify(parseAgencyWork(Object.fromEntries(new URLSearchParams(back.split('?')[1])))) === JSON.stringify(f) && back.startsWith(`/desk-ops/agencies/${id}?`));
  ok('the default view has a bare address', agencyWorkAddress(id, d) === `/desk-ops/agencies/${id}`);
  const q = (view: string) => Object.fromEntries(new URLSearchParams(agencyWorkQuery(id, { ...d, view: view as typeof d.view })));
  ok('every tab is for this agency only', ['open', 'overdue', 'waiting', 'completed'].every((v) => q(v).agencyId === id));
  ok('open: open work, due soonest first', q('open').open === '1' && q('open').sort === 'due');
  ok('overdue', q('overdue').overdue === '1');
  ok('waiting on the agency', q('waiting').status === 'WAITING_ON_AGENCY');
  ok('completed: latest completed first', q('completed').status === 'COMPLETED' && q('completed').sort === 'completed');
  const one = Object.fromEntries(new URLSearchParams(agencyWorkQuery(id, f)));
  ok('one account, a search and a page are passed on', one.insuredId === 'b'.repeat(24) && one.q === 'acme' && one.page === '2' && one.pageSize === '25');
}

(async () => {
  try {
    pureLogic();

    const mkAgency = async (n: string, extra: object = {}) => { const a = await prisma.agency.create({ data: { name: `${TAG} ${n}`, deskEnabled: true, ...extra } }); cleanup.agencyIds.push(a.id); return a; };
    const mkUser = async (n: string, role: UserRole, agencyId: string | null = null) => {
      const u = await prisma.user.create({ data: { email: `${TAG}-${n}@example.test`, role, agencyId, firstName: `${TAG}${n}`, passwordHash: 'x', mustChangePassword: false } });
      cleanup.userIds.push(u.id); return u;
    };
    const A = await mkAgency('Harbor', {
      deskEnabledAt: new Date('2026-03-02T00:00:00Z'), amsSystem: 'APPLIED_EPIC', primaryEmail: 'ops@harbor.test', phone: '555-0100',
      deskInstructions: 'Certificates go out from the shared inbox.\nCopy the producer.', credentialVaultRef: '1Password › Desk › Harbor',
    });
    const B = await mkAgency('Summit');
    const C = await mkAgency('Gamma');
    const D = await mkAgency('Desk off', { deskEnabled: false });
    const am = await mkUser('am', 'ACCOUNT_MANAGER');
    const otherAm = await mkUser('otheram', 'ACCOUNT_MANAGER');
    const ops = await mkUser('ops', 'DESK_ADMIN');
    const va = await mkUser('va', 'DESK_VA');
    const va2 = await mkUser('va2', 'DESK_VA');
    const agencyAdmin = await mkUser('admin', 'ADMIN', A.id);
    await prisma.agencyDeskAssignment.createMany({ data: [
      { agencyId: A.id, primaryAmId: am.id, backupAmId: otherAm.id },
      { agencyId: B.id, primaryAmId: otherAm.id, backupAmId: am.id },
      { agencyId: C.id, primaryAmId: otherAm.id },
      { agencyId: D.id, primaryAmId: am.id },
    ] });
    const plan = await prisma.deskPlan.create({ data: { code: TAG, name: `${TAG} Growth`, monthlyPriceCents: BigInt(150_000), managedAccounts: 3, isActive: false } });
    cleanup.planIds.push(plan.id);
    await prisma.agencyDeskPlan.create({ data: { agencyId: A.id, planId: plan.id, startsOn: new Date('2026-04-01T00:00:00Z') } });
    await prisma.agencyDeskPlan.create({ data: { agencyId: B.id, planId: plan.id, startsOn: new Date('2026-04-01T00:00:00Z'), managedAccountsOverride: 10 } });
    const podWhole = await prisma.pod.create({ data: { code: `${TAG}-1`, name: `${TAG} Pod One` } });
    const podNamed = await prisma.pod.create({ data: { code: `${TAG}-2`, name: `${TAG} Pod Two` } });
    cleanup.podIds.push(podWhole.id, podNamed.id);
    await prisma.podMember.createMany({ data: [{ podId: podWhole.id, userId: va.id }, { podId: podNamed.id, userId: va2.id }] });
    await prisma.agencyPodAccess.createMany({ data: [
      { agencyId: A.id, podId: podWhole.id }, { agencyId: A.id, podId: podNamed.id, userId: va2.id }, { agencyId: B.id, podId: podWhole.id },
    ] });

    const [sAm, sOther, sOps, sVa, sAdmin] = await Promise.all([am, otherAm, ops, va, agencyAdmin].map((u) => resolveDeskScope(prisma, u.id)));
    const ins = (agencyId: string, name: string, status: 'ACTIVE' | 'INACTIVE' = 'ACTIVE') =>
      prisma.insuredAccount.create({ data: { agencyId, name: `${TAG} ${name}`, nameKey: `${TAG} ${name}`.toLowerCase(), status } });
    const acme = await ins(A.id, 'Acme Trucking');
    const bakery = await ins(A.id, 'Corner Bakery');
    await ins(A.id, 'Dental Group');
    await ins(A.id, 'Elm Street Cafe');
    await ins(A.id, 'Closed Garage', 'INACTIVE');
    await ins(B.id, 'Summit Client');

    const hours = (h: number) => new Date(Date.now() + h * 3_600_000);
    const mk = (agencyId: string, title: string, data: Partial<Prisma.TaskUncheckedCreateInput> = {}) =>
      prisma.task.create({ data: { reference: ref++, agencyId, type: 'COI', title: `${TAG} ${title}`, status: 'IN_PROGRESS', podId: podWhole.id, assigneeId: va.id, dueAt: hours(30), restrictedToUserIds: [], ...data } });
    await mk(A.id, 'acme certificate', { insuredId: acme.id });
    const late = await mk(A.id, 'acme endorsement, late', { insuredId: acme.id, dueAt: hours(-6), type: 'ENDORSEMENT' });
    await mk(A.id, 'bakery waiting on agency', { insuredId: bakery.id, status: 'WAITING_ON_AGENCY', slaPausedAt: hours(-2), dueAt: hours(-1) });
    await mk(A.id, 'bakery QA', { insuredId: bakery.id, status: 'QA_REVIEW' });
    await mk(A.id, 'due in an hour', { dueAt: hours(1) });
    await mk(A.id, 'done first', { status: 'COMPLETED', completedAt: hours(-48) });
    await mk(A.id, 'done last', { status: 'COMPLETED', completedAt: hours(-2) });
    await mk(B.id, 'summit open');
    await mk(C.id, 'gamma, late', { dueAt: hours(-9) });

    const today = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate()));
    const inDays = (n: number) => new Date(today.getTime() + n * 86_400_000);
    const p20 = await prisma.policy.create({ data: { agencyId: A.id, insuredId: acme.id, policyNumber: `${TAG}-GL`, lineOfBusiness: 'General liability', carrierName: 'Hartwell', expirationDate: inDays(20) } });
    await prisma.policy.create({ data: { agencyId: A.id, insuredId: bakery.id, policyNumber: `${TAG}-BOP`, expirationDate: inDays(85) } });
    await prisma.policy.create({ data: { agencyId: A.id, insuredId: bakery.id, policyNumber: `${TAG}-LATER`, expirationDate: inDays(120) } });
    // Another of the AM's agencies renewing too, which must not appear on Harbor's page.
    const summitClient = await prisma.insuredAccount.findFirstOrThrow({ where: { agencyId: B.id } });
    await prisma.policy.create({ data: { agencyId: B.id, insuredId: summitClient.id, policyNumber: `${TAG}-SUMMIT`, expirationDate: inDays(30) } });
    const renew = await mk(A.id, 'renew GL', { type: 'RENEWAL', policyId: p20.id, insuredId: acme.id });

    console.log('The agencies a manager looks after');
    const mine = (await managedAgencies(prisma, sAm)).agencies;
    ok('their primary and backup agencies, not another AM\'s or one with the Desk off', mine.map((a) => a.id).sort().join() === [A.id, B.id].sort().join());
    const a = mine.find((x) => x.id === A.id)!;
    const b = mine.find((x) => x.id === B.id)!;
    ok('their role on each', a.yourRole === 'PRIMARY' && b.yourRole === 'BACKUP');
    ok('who the AMs are', a.primaryAm === `${TAG}am` && a.backupAm === `${TAG}otheram` && b.primaryAm === `${TAG}otheram`);
    ok('the plan, and accounts against what it includes (an override wins)', a.plan === `${TAG} Growth` && a.activeAccounts === 4 && a.includedAccounts === 3 && b.includedAccounts === 10 && b.activeAccounts === 1);
    ok('work at a glance', a.open === 6 && a.overdue === 1 && a.waitingOnAgency === 1 && a.review === 1 && b.open === 1, JSON.stringify(a));
    const dash = await managerDashboard(prisma, sAm);
    const dashA = dash.agencies.find((x) => x.id === A.id)!;
    ok('the same figures as the overview', dashA.open === a.open && dashA.overdue === a.overdue && dashA.waitingOnAgency === a.waitingOnAgency && dashA.review === a.review);
    const opsRows = (await managedAgencies(prisma, sOps)).agencies;
    ok('an Operations Manager: every Desk agency, no role of their own', [A.id, B.id, C.id].every((id) => opsRows.some((r) => r.id === id)) && !opsRows.some((r) => r.id === D.id) && opsRows.find((r) => r.id === A.id)?.yourRole === null);
    ok('nothing about pricing', !JSON.stringify(mine).includes('150000') && !JSON.stringify(mine).toLowerCase().includes('price'));

    console.log('One agency');
    const s = await agencySummary(prisma, sAm, A.id, { ip: '203.0.113.5' });
    ok('who looks after it', s.yourRole === 'PRIMARY' && s.primaryAm?.name === `${TAG}am` && s.backupAm?.name === `${TAG}otheram`);
    ok('its setup: AMS, instructions, where logins are kept', s.ams === 'Applied Epic' && s.instructions === 'Certificates go out from the shared inbox.\nCopy the producer.' && s.credentialVaultRef === '1Password › Desk › Harbor', s.ams ?? '');
    ok('its plan, and accounts', s.plan?.name === `${TAG} Growth` && s.plan.since === '2026-04-01' && s.plan.includedAccounts === 3 && s.accounts.active === 4 && s.accounts.inactive === 1);
    ok('its pods: a whole pod, and one with a named person', s.pods.length === 2 && s.pods[0].wholePod && !s.pods[1].wholePod && s.pods[1].people === 1);
    ok('its counts', JSON.stringify(s.counts) === JSON.stringify({ open: 6, overdue: 1, dueSoon: 1, waitingOnAgency: 1, review: 1, unrouted: 0 }), JSON.stringify(s.counts));
    ok('renewals in 90 days, with their requests', s.renewalsTotal === 2 && s.renewals[0].policyNumber === `${TAG}-GL` && s.renewals[0].renewalTask?.id === renew.id && s.renewals[1].renewalTask === null);
    ok('contact details', s.contact.email === 'ops@harbor.test' && s.contact.phone === '555-0100');
    ok('nothing about pricing', !JSON.stringify(s).includes('150000'));
    const viewed = await prisma.deskAuditLog.findFirst({ where: { actorId: am.id, action: 'agency.viewed', entityId: A.id } });
    ok('opening it is logged, with the facts only', !!viewed && viewed.ipAddress === '203.0.113.5' && !JSON.stringify(viewed.metadata).includes('shared inbox') && !JSON.stringify(viewed.metadata).includes('1Password'));
    const summit = await agencySummary(prisma, sAm, B.id);
    ok('as backup AM: their role says so', summit.yourRole === 'BACKUP');
    ok('each agency\'s own renewals, and its own plan override', summit.renewalsTotal === 1 && summit.renewals[0].policyNumber === `${TAG}-SUMMIT` && summit.plan?.includedAccounts === 10);
    ok('an Operations Manager can open any Desk agency', (await agencySummary(prisma, sOps, C.id)).name === `${TAG} Gamma`);

    console.log('Refused, and logged');
    const refused = async (name: string, s_: Awaited<ReturnType<typeof resolveDeskScope>>, userId: string, id: string, op: string, fn: 'summary' | 'list' = 'summary') => {
      const code = await status(() => (fn === 'summary' ? agencySummary(prisma, s_, id) : managedAgencies(prisma, s_)));
      const log = await prisma.deskAuditLog.findFirst({ where: { actorId: userId, action: 'access.denied' }, orderBy: { createdAt: 'desc' } });
      ok(name, code === 404 && (log?.metadata as Json)?.op === op, `${code} ${JSON.stringify(log?.metadata)}`);
    };
    await refused('another AM\'s agency: 404, logged', sAm, am.id, C.id, 'agency');
    ok('and logged against that agency', (await prisma.deskAuditLog.findFirst({ where: { actorId: am.id, action: 'access.denied', entityId: C.id } }))?.entityType === 'Agency');
    await refused('an agency with the Desk off, though assigned: 404', sAm, am.id, D.id, 'agency');
    await refused('no such agency: 404', sAm, am.id, 'f'.repeat(24), 'agency');
    await refused('not an id: 404', sAm, am.id, 'nope', 'agency');
    await refused('the other AM: an agency that isn\'t theirs, 404', sOther, otherAm.id, D.id, 'agency');
    ok('the other AM, as Harbor\'s backup, can open it', (await agencySummary(prisma, sOther, A.id)).yourRole === 'BACKUP');
    await refused('an Operations Manager: an agency with the Desk off, 404', sOps, ops.id, D.id, 'agency');
    await refused('a VA: 404, logged', sVa, va.id, A.id, 'agency');
    await refused('a VA\'s agency list: 404, logged', sVa, va.id, A.id, 'agencies', 'list');
    await refused('an agency admin: 404, logged', sAdmin, agencyAdmin.id, A.id, 'agency');

    console.log('The lists the page reads');
    const [tAm, tVa, tOther] = await Promise.all([am, va, otherAm].map((u) => createSession(u.id)));
    const tasks = async (view: string, extra: object = {}, token = tAm, agencyId = A.id) => {
      const qs = agencyWorkQuery(agencyId, { ...parseAgencyWork({}), view: view as 'open', ...extra });
      return (await tasksRoute(req(`/api/desk/tasks?${qs}`, token))).json() as Promise<Json>;
    };
    const titles = (r: Json) => (r.rows as { title: string }[]).map((t) => t.title.replace(`${TAG} `, '')).join('|');
    const open = await tasks('open');
    ok('open: this agency\'s open work, due soonest first', open.total === 6 && open.rows[0].id === late.id, titles(open));
    ok('overdue', titles(await tasks('overdue')) === 'acme endorsement, late');
    ok('waiting on the agency', titles(await tasks('waiting')) === 'bakery waiting on agency');
    ok('completed: latest completed first', titles(await tasks('completed')) === 'done last|done first');
    ok('one account\'s work', titles(await tasks('open', { account: bakery.id })) === 'bakery QA|bakery waiting on agency' || titles(await tasks('open', { account: bakery.id })) === 'bakery waiting on agency|bakery QA');
    ok('a search', titles(await tasks('open', { q: 'certificate' })) === 'acme certificate');
    ok('another AM\'s agency through the same list: nothing', (await tasks('open', {}, tAm, C.id)).total === 0);
    const accounts = await (await insuredsRoute(req(`/api/desk/insureds?agencyId=${A.id}&status=ACTIVE&pageSize=25`, tAm))).json() as Json;
    ok('accounts: the active ones, with open requests and policies', accounts.total === 4 && accounts.insureds.find((x: Json) => x.id === bakery.id)?.openTasks === 2 && accounts.insureds.find((x: Json) => x.id === bakery.id)?.policyCount === 2);
    ok('inactive ones on request', (await (await insuredsRoute(req(`/api/desk/insureds?agencyId=${A.id}&status=INACTIVE`, tAm))).json() as Json).total === 1);
    ok('another AM\'s agency\'s accounts: none', (await (await insuredsRoute(req(`/api/desk/insureds?agencyId=${C.id}`, tAm))).json() as Json).total === 0);

    console.log('The real routes');
    const list = await listRoute(req('/api/desk/agencies', tAm));
    ok('agencies: 200, theirs', list.status === 200 && ((await list.json()) as Json).agencies.length === 2);
    ok('agencies: a VA, 404', (await listRoute(req('/api/desk/agencies', tVa))).status === 404);
    ok('agencies: signed out, 401', (await listRoute(req('/api/desk/agencies'))).status === 401);
    const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
    const one = await summaryRoute(req(`/api/desk/agencies/${A.id}`, tAm), ctx(A.id));
    ok('one agency: 200', one.status === 200 && ((await one.json()) as Json).name === `${TAG} Harbor`);
    ok('one agency: someone else\'s, 404', (await summaryRoute(req(`/api/desk/agencies/${C.id}`, tAm), ctx(C.id))).status === 404);
    ok('one agency: a backup AM, 200', (await summaryRoute(req(`/api/desk/agencies/${A.id}`, tOther), ctx(A.id))).status === 200);

    console.log('The screens');
    const detail = read('app/components/desk/agencies/AgencyDetail.tsx');
    ok('work and accounts come from the existing lists, for this agency', detail.includes('`/api/desk/tasks?${workQuery}`') && detail.includes('new URLSearchParams({ agencyId, status: accountStatus'));
    ok('an account opens its work', detail.includes('go({ account: account.id })'));
    ok('requests open in the workspace', detail.includes('href={`/desk-ops/tasks/${t.id}`}'));
    ok('logins: a pointer, never kept here', detail.includes('Logins are kept in the password manager:') && detail.includes('Logins are never kept in The Desk.'));
    ok('the overview\'s agencies link here', read('app/components/desk/dashboard/ManagerDashboard.tsx').includes('href={`/desk-ops/agencies/${a.id}`}') && read('app/components/desk/agencies/AgencyList.tsx').includes('href={`/desk-ops/agencies/${a.id}`}'));
    ok('both pages are the Agencies item\'s (managers only)', read('app/(desk)/desk-ops/agencies/page.tsx').includes("deskPageAccess('OPS', '/desk-ops/agencies')") && read('app/(desk)/desk-ops/agencies/[id]/page.tsx').includes("deskPageAccess('OPS', '/desk-ops/agencies')"));
  } catch (err) {
    fail++;
    console.error(err);
  } finally {
    await wipe();
    const left = await prisma.task.count({ where: { title: { startsWith: TAG } } }) + await prisma.user.count({ where: { email: { startsWith: TAG } } }) + await prisma.deskPlan.count({ where: { code: TAG } });
    ok('nothing left behind', left === 0);
    await prisma.$disconnect();
    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
  }
})();
