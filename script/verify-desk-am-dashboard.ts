/**
 * Module 34: the Account Manager's overview.
 *
 *   npx tsx script/verify-desk-am-dashboard.ts
 *
 * The counts (open, overdue, due soon, waiting on agencies, to review,
 * renewals), the lists and their order, each agency's row, upcoming renewals
 * with their renewal requests, an AM limited to their own agencies, VAs and
 * agencies refused and logged, the real route, and the screens. Against the
 * shared database, with temporary agencies, people, accounts, policies and
 * requests, all removed at the end.
 */
import 'dotenv/config';
import { readFileSync } from 'fs';
import { NextRequest } from 'next/server';
import type { Prisma, UserRole } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { createSession } from '../lib/auth';
import { DeskAccessError, resolveDeskScope } from '../lib/desk/access';
import { managerDashboard } from '../lib/desk/manager-dashboard';
import { daysLeftLabel, lateBy, parseRenewalWindow } from '../lib/desk/dashboard-view';
import { GET as dashboardRoute } from '../app/api/desk/dashboard/route';

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, detail = '') => {
  c ? pass++ : fail++;
  console.log(`  ${c ? '✓' : '✗'} ${n}${!c && detail ? `  [${detail}]` : ''}`);
  if (!c && process.env.FAIL_FAST) throw new Error(`stopped at: ${n}`);
};

const TAG = `m34test${Date.now()}`;
const cleanup = { agencyIds: [] as string[], userIds: [] as string[], podIds: [] as string[] };
let ref = 995_000_000 + Math.floor(Math.random() * 1_000_000);
const read = (p: string) => readFileSync(p, 'utf8');
type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any

async function wipe() {
  const agencyId = { in: cleanup.agencyIds };
  await prisma.taskEvent.deleteMany({ where: { agencyId } });
  await prisma.task.deleteMany({ where: { agencyId } });
  await prisma.policy.deleteMany({ where: { agencyId } });
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
const status = async (fn: () => Promise<unknown>) => {
  try { await fn(); return 200; } catch (e) { if (e instanceof DeskAccessError) return e.status; throw e; }
};

function pureLogic() {
  console.log('Wording');
  ok('renewal window from the address, 60 by default', parseRenewalWindow('30') === 30 && parseRenewalWindow('90') === 90 && parseRenewalWindow(undefined) === 60 && parseRenewalWindow('45') === 60 && parseRenewalWindow(['90', '30']) === 90);
  ok('days left', daysLeftLabel(0) === 'Expires today' && daysLeftLabel(1) === 'Expires tomorrow' && daysLeftLabel(12) === 'Expires in 12 days');
  const now = new Date('2026-11-10T12:00:00Z');
  ok('how late', lateBy('2026-11-10T11:15:00Z', now) === '45 min' && lateBy('2026-11-10T09:00:00Z', now) === '3 h' && lateBy('2026-11-07T12:00:00Z', now) === '3 days');
  ok('never "late" by a negative amount', lateBy('2026-11-10T13:00:00Z', now) === '0 min');
}

(async () => {
  try {
    pureLogic();

    const mkAgency = async (n: string, deskEnabled = true) => { const a = await prisma.agency.create({ data: { name: `${TAG} ${n}`, deskEnabled } }); cleanup.agencyIds.push(a.id); return a; };
    const mkUser = async (n: string, role: UserRole, agencyId: string | null = null) => {
      const u = await prisma.user.create({ data: { email: `${TAG}-${n}@example.test`, role, agencyId, firstName: `${TAG}${n}`, passwordHash: 'x', mustChangePassword: false } });
      cleanup.userIds.push(u.id); return u;
    };
    // Named to sort last, so "busiest first" can't pass by being alphabetical.
    const A = await mkAgency('Zeta');
    const B = await mkAgency('Beta');
    const C = await mkAgency('Gamma (someone else\'s)');
    const D = await mkAgency('Delta (Desk off)', false);
    const am = await mkUser('am', 'ACCOUNT_MANAGER');
    const otherAm = await mkUser('otheram', 'ACCOUNT_MANAGER');
    const ops = await mkUser('ops', 'DESK_ADMIN');
    const va = await mkUser('va', 'DESK_VA');
    const agencyAdmin = await mkUser('admin', 'ADMIN', A.id);
    await prisma.agencyDeskAssignment.createMany({ data: [
      { agencyId: A.id, primaryAmId: am.id },
      { agencyId: B.id, primaryAmId: otherAm.id, backupAmId: am.id },
      { agencyId: C.id, primaryAmId: otherAm.id },
      { agencyId: D.id, primaryAmId: am.id },
    ] });
    const pod = await prisma.pod.create({ data: { code: TAG, name: `${TAG} Pod` } }); cleanup.podIds.push(pod.id);
    await prisma.podMember.create({ data: { podId: pod.id, userId: va.id } });
    await prisma.agencyPodAccess.createMany({ data: [A, B, C].map((a) => ({ agencyId: a.id, podId: pod.id })) });

    const [sAm, sOther, sOps, sVa, sAdmin] = await Promise.all([am, otherAm, ops, va, agencyAdmin].map((u) => resolveDeskScope(prisma, u.id)));
    const hours = (h: number) => new Date(Date.now() + h * 3_600_000);
    const mk = (agencyId: string, title: string, data: Partial<Prisma.TaskUncheckedCreateInput> = {}) =>
      prisma.task.create({ data: { reference: ref++, agencyId, type: 'COI', title: `${TAG} ${title}`, status: 'IN_PROGRESS', podId: pod.id, assigneeId: va.id, dueAt: hours(48), restrictedToUserIds: [], ...data } });

    await mk(A.id, 'normal');
    const lateA = await mk(A.id, 'late five hours', { dueAt: hours(-5) });
    await mk(A.id, 'late but waiting on carrier', { status: 'WAITING_ON_CARRIER', dueAt: hours(-10), slaPausedAt: hours(-11) });
    await mk(A.id, 'due in an hour', { dueAt: hours(1) });
    await mk(A.id, 'waiting on agency', { status: 'WAITING_ON_AGENCY', dueAt: hours(-3), slaPausedAt: hours(-4) });
    const qa = await mk(A.id, 'in QA', { status: 'QA_REVIEW', createdAt: hours(-30) });
    const escalated = await mk(A.id, 'escalated', { escalated: true, escalationReason: 'Client called twice', createdAt: hours(-2) });
    const unrouted = await mk(A.id, 'not routed', { status: 'NEW', podId: null, assigneeId: null, createdAt: hours(-50) });
    await mk(A.id, 'done but was late', { status: 'COMPLETED', completedAt: hours(-1), dueAt: hours(-20) });
    const lateB = await mk(B.id, 'late one hour', { dueAt: hours(-1) });
    await mk(C.id, 'someone else\'s, late', { dueAt: hours(-30) });
    await mk(D.id, 'Desk off, late', { dueAt: hours(-30) });

    // Policies: calendar days at midnight UTC.
    const today = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate()));
    const inDays = (n: number) => new Date(today.getTime() + n * 86_400_000);
    const mkInsured = (agencyId: string, name: string, extra: object = {}) => prisma.insuredAccount.create({ data: { agencyId, name: `${TAG} ${name}`, nameKey: `${TAG} ${name}`.toLowerCase(), ...extra } });
    const acme = await mkInsured(A.id, 'Acme');
    const closedShop = await mkInsured(A.id, 'Closed Shop', { status: 'INACTIVE' });
    const bravo = await mkInsured(B.id, 'Bravo');
    const gamma = await mkInsured(C.id, 'Gamma Co');
    const pol = (agencyId: string, insuredId: string, number: string, expires: Date | null, extra: object = {}) =>
      prisma.policy.create({ data: { agencyId, insuredId, policyNumber: `${TAG}-${number}`, lineOfBusiness: 'General liability', carrierName: 'Hartwell', expirationDate: expires, ...extra } });
    const p10 = await pol(A.id, acme.id, 'P10', inDays(10));
    const p45 = await pol(A.id, acme.id, 'P45', inDays(45));
    await pol(A.id, acme.id, 'P60', inDays(60)); // the window's last day
    await pol(B.id, bravo.id, 'P75', inDays(75));
    await pol(A.id, acme.id, 'P0', inDays(0));
    await pol(A.id, acme.id, 'EXPIRED-YESTERDAY', inDays(-1));
    await pol(A.id, acme.id, 'CANCELLED', inDays(5), { status: 'CANCELLED' });
    await pol(A.id, closedShop.id, 'INACTIVE-ACCOUNT', inDays(5));
    await pol(A.id, acme.id, 'NO-DATE', null);
    await pol(C.id, gamma.id, 'OTHERS', inDays(5));
    const renewal10 = await mk(A.id, 'renew P10', { type: 'RENEWAL', policyId: p10.id, insuredId: acme.id, createdAt: hours(-200) });
    await mk(A.id, 'renew P45, cancelled', { type: 'RENEWAL', policyId: p45.id, insuredId: acme.id, status: 'CANCELLED', cancelledAt: hours(-1), createdAt: hours(-200) });

    console.log('An Account Manager\'s counts');
    const d = await managerDashboard(prisma, sAm);
    const c = d.counts;
    // A: normal, late, waiting-carrier, due soon, waiting-agency, QA, escalated, unrouted, renew P10 = 9; B: late = 1.
    ok('open requests: their agencies only, open only', c.open === 10, String(c.open));
    ok('overdue: late and not waiting', c.overdue === 2, String(c.overdue));
    ok('due soon: within four hours', c.dueSoon === 1, String(c.dueSoon));
    ok('waiting on agencies', c.waitingOnAgency === 1);
    ok('to review: QA, escalated, not routed', c.review === 3 && c.unrouted === 1, `${c.review}/${c.unrouted}`);
    ok('renewals in 60 days: today, 10, 45 and the 60th day', c.renewals === 4, String(c.renewals));
    ok('two agencies: primary and backup, not one with the Desk off', c.agencies === 2 && d.agencies.map((a) => a.id).sort().join() === [A.id, B.id].sort().join());

    console.log('The lists');
    ok('to review: escalations first, then oldest', d.review.map((t) => t.id).join() === [escalated.id, unrouted.id, qa.id].join(), d.review.map((t) => t.title).join());
    ok('each with why', JSON.stringify(d.review.map((t) => t.reasons)) === JSON.stringify([['ESCALATED'], ['UNROUTED'], ['QA']]) && d.review[0].escalationReason === 'Client called twice');
    ok('most overdue first, with who has it', d.overdue.map((t) => t.id).join() === [lateA.id, lateB.id].join() && d.overdue[0].assignee === `${TAG}va`);
    const a = d.agencies.find((x) => x.id === A.id)!;
    const b = d.agencies.find((x) => x.id === B.id)!;
    ok('agency rows add up', a.open === 9 && a.overdue === 1 && a.waitingOnAgency === 1 && a.review === 3 && a.renewals === 4 && b.open === 1 && b.overdue === 1 && b.renewals === 0, JSON.stringify([a, b]));
    ok('agencies needing most attention first, not by name', d.agencies[0].id === A.id && d.agencies[0].name > d.agencies[1].name);

    console.log('Renewals');
    ok('soonest first, the window\'s edges right', d.renewals.map((p) => p.policyNumber).join() === [`${TAG}-P0`, `${TAG}-P10`, `${TAG}-P45`, `${TAG}-P60`].join(), d.renewals.map((p) => p.policyNumber).join());
    ok('days left and the calendar day', d.renewals[1].daysLeft === 10 && d.renewals[1].expirationDate === inDays(10).toISOString().slice(0, 10) && d.renewals[0].daysLeft === 0);
    ok('with its renewal request', d.renewals[1].renewalTask?.id === renewal10.id && d.renewals[1].renewalTask.statusLabel === 'In progress');
    ok('a cancelled renewal request doesn\'t count', d.renewals[2].renewalTask === null);
    ok('expired, cancelled, inactive accounts and other agencies left out', !d.renewals.some((p) => /EXPIRED|CANCELLED|INACTIVE|OTHERS|NO-DATE/.test(p.policyNumber ?? '')));
    const d30 = await managerDashboard(prisma, sAm, { renewalDays: '30' });
    const d90 = await managerDashboard(prisma, sAm, { renewalDays: 90 });
    ok('30 days: today and 10', d30.counts.renewals === 2 && d30.renewalDays === 30);
    ok('90 days: adds the backup agency\'s 75', d90.counts.renewals === 5 && d90.renewals.at(-1)?.policyNumber === `${TAG}-P75`);
    ok('another window: 400', await status(() => managerDashboard(prisma, sAm, { renewalDays: '45' })) === 400 && await status(() => managerDashboard(prisma, sAm, { renewalDays: 'all' })) === 400);

    console.log('Each manager sees their own');
    const o = await managerDashboard(prisma, sOther);
    ok('the other AM: Beta and Gamma, not Alpha', o.agencies.map((x) => x.id).sort().join() === [B.id, C.id].sort().join() && o.counts.overdue === 2);
    ok('nothing from Alpha in any list', !JSON.stringify(o).includes(A.id));
    const p = await managerDashboard(prisma, sOps, { renewalDays: 90 });
    const has = (id: string) => p.agencies.some((x) => x.id === id);
    ok('an Operations Manager: every Desk agency', has(A.id) && has(B.id) && has(C.id) && !has(D.id));
    ok('and at least everything the AMs see', p.counts.open >= 11 && p.counts.overdue >= 3);
    ok('a Desk-off agency\'s work never counted', !JSON.stringify(p).includes('Desk off, late'));

    console.log('Refused, and logged');
    for (const [name, s, u] of [['a VA', sVa, va], ['an agency admin', sAdmin, agencyAdmin]] as const) {
      const code = await status(() => managerDashboard(prisma, s, {}, { ip: '203.0.113.8' }));
      const log = await prisma.deskAuditLog.findFirst({ where: { actorId: u.id, action: 'access.denied' }, orderBy: { createdAt: 'desc' } });
      ok(`${name}: 404, logged`, code === 404 && (log?.metadata as Json)?.op === 'dashboard' && log?.ipAddress === '203.0.113.8');
    }

    console.log('The real route');
    const [tAm, tVa] = await Promise.all([am, va].map((u) => createSession(u.id)));
    const r = await dashboardRoute(req('/api/desk/dashboard', tAm));
    const body = await r.json() as Json;
    ok('200, 60 days by default', r.status === 200 && body.renewalDays === 60 && body.counts.open === 10);
    ok('?renewals=90', (await (await dashboardRoute(req('/api/desk/dashboard?renewals=90', tAm))).json() as Json).counts.renewals === 5);
    ok('a bad window: 400', (await dashboardRoute(req('/api/desk/dashboard?renewals=7', tAm))).status === 400);
    ok('a VA: 404', (await dashboardRoute(req('/api/desk/dashboard', tVa))).status === 404);
    ok('signed out: 401', (await dashboardRoute(req('/api/desk/dashboard'))).status === 401);

    console.log('The screens');
    const page = read('app/(desk)/desk-ops/page.tsx');
    ok('a VA gets their own overview, managers the dashboard', page.includes("access.scope.kind === 'VA'") && page.includes('<VaOverview />') && page.includes('<ManagerDashboard'));
    const va_ = read('app/components/desk/dashboard/VaOverview.tsx');
    ok('the VA overview reads only the queue\'s own counts', va_.includes("'/api/desk/queue'") && !va_.includes('/api/desk/dashboard'));
    const dash = read('app/components/desk/dashboard/ManagerDashboard.tsx');
    ok('requests open in the workspace', (dash.match(/href=\{`\/desk-ops\/tasks\/\$\{/g) ?? []).length === 3);
    ok('says targets are internal', dash.includes('Due dates here are internal targets. Agencies never see them.'));
    ok('the renewal window is kept in the address', dash.includes("days === 60 ? '/desk-ops' : `/desk-ops?renewals=${days}`"));
  } catch (err) {
    fail++;
    console.error(err);
  } finally {
    await wipe();
    const left = await prisma.task.count({ where: { title: { startsWith: TAG } } }) + await prisma.user.count({ where: { email: { startsWith: TAG } } }) + await prisma.policy.count({ where: { policyNumber: { startsWith: TAG } } });
    ok('nothing left behind', left === 0);
    await prisma.$disconnect();
    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
  }
})();
