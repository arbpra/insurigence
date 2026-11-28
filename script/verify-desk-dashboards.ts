/**
 * Module 52: the department dashboards. Virtual Operations for the Director
 * of Virtual Operations (every pod) and Pod Leaders (the pods they lead);
 * Agency Operations for the Director of Agency Operations (every agency) and
 * Senior AMs (their own and their team's agencies); both for the COO.
 *
 *   npx tsx script/verify-desk-dashboards.ts
 *
 * Temporary people on test copies of the default positions, temporary pods,
 * agencies and requests. It checks:
 *  - who sees which dashboard, and who sees none (refused and logged);
 *  - the figures for a pod, a person, an agency and an Account Manager: open
 *    work, completed work and targets in the period, QA, capacity, usage;
 *  - each dashboard stays inside its reach: a Pod Leader's pods, a Senior
 *    AM's agencies;
 *  - never prices or request text;
 *  - the sidebar, the route and the period;
 *  - nothing left behind.
 *
 * The COO's and the Directors' dashboards also count the live database's own
 * work, so for them only the temporary pods and agencies are checked exactly.
 */
import 'dotenv/config';
import { NextRequest } from 'next/server';
import type { DeskAgencyReach, DeskDepartment, Prisma, UserRole } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { createSession } from '../lib/auth';
import { can, DeskAccessError, resolveDeskScope, taskWhere, type DeskScope } from '../lib/desk/access';
import { billingPeriodOf } from '../lib/desk/billing';
import { loadBusinessCalendar } from '../lib/desk/business-time';
import { agencyReach, dashboardOptions, getDashboards, virtualReach } from '../lib/desk/dashboards';
import { capacityLabel, qaLabel } from '../lib/desk/dashboards-view';
import { DEFAULT_POSITIONS, PERMISSION_ADDITIONS } from '../lib/desk/permission-catalogue';
import { itemAllowed, navAccess, navFor } from '../lib/desk/navigation';
import { GET as dashboardsRoute } from '../app/api/desk/dashboards/route';

process.env.DESK_EMAIL_NOTIFICATIONS = 'off';

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, detail: unknown = '') => {
  c ? pass++ : fail++;
  console.log(`  ${c ? '✓' : '✗'} ${n}${!c && detail !== '' ? `  ${JSON.stringify(detail)}` : ''}`);
};
const section = (s: string) => console.log(`\n${s}`);

const TAG = `m52test${Date.now()}`;
const CTX = { ip: '203.0.113.52', userAgent: 'verify-desk-dashboards' };
const cleanup = { agencyIds: [] as string[], userIds: [] as string[], podIds: [] as string[] };

async function wipe() {
  const agencyId = { in: cleanup.agencyIds };
  const userId = { in: cleanup.userIds };
  const podId = { in: cleanup.podIds };
  const positions = (await prisma.deskPosition.findMany({ where: { code: { startsWith: TAG } }, select: { id: true } })).map((p) => p.id);
  await prisma.agencyDeskPlan.deleteMany({ where: { agencyId } });
  await prisma.deskPlan.deleteMany({ where: { code: { startsWith: TAG } } });
  await prisma.taskEvent.deleteMany({ where: { agencyId } });
  await prisma.task.deleteMany({ where: { agencyId, parentTaskId: { not: null } } }); // subtasks before their requests
  await prisma.task.deleteMany({ where: { agencyId } });
  await prisma.agencyPodAccess.deleteMany({ where: { OR: [{ agencyId }, { podId }] } });
  await prisma.agencyDeskAssignment.deleteMany({ where: { agencyId } });
  await prisma.deskReportingLine.deleteMany({ where: { OR: [{ userId }, { managerId: userId }] } });
  await prisma.podMember.deleteMany({ where: { OR: [{ podId }, { userId }] } });
  await prisma.pod.deleteMany({ where: { id: podId } });
  await prisma.deskPositionHolder.deleteMany({ where: { OR: [{ userId }, { positionId: { in: positions } }] } });
  await prisma.deskPosition.deleteMany({ where: { id: { in: positions } } });
  await prisma.deskNotification.deleteMany({ where: { OR: [{ agencyId }, { recipientId: userId }] } });
  await prisma.deskAuditLog.deleteMany({ where: { OR: [{ agencyId }, { actorId: userId }, { entityId: userId }, { entityId: podId }] } });
  await prisma.session.deleteMany({ where: { userId } });
  await prisma.user.deleteMany({ where: { OR: [{ id: userId }, { email: { startsWith: TAG } }] } });
  await prisma.agency.deleteMany({ where: { id: agencyId } });
}

const status = async (fn: () => Promise<unknown>) => {
  try { await fn(); return 200; } catch (e) { if (e instanceof DeskAccessError) return e.status; throw e; }
};
type Json = Record<string, any>;
const DAY = 86_400_000;

(async () => {
  try {
    const now = new Date();
    const ago = (days: number) => new Date(now.getTime() - days * DAY);
    const cal = await loadBusinessCalendar(prisma);
    const period = billingPeriodOf(now, cal.timeZone);

    const mkAgency = async (n: string, deskEnabled = true) => {
      const a = await prisma.agency.create({ data: { name: `${TAG} ${n}`, deskEnabled } });
      cleanup.agencyIds.push(a.id);
      return a;
    };
    const A = await mkAgency('Alpha'), B = await mkAgency('Beta'), Off = await mkAgency('Off', false);
    const mkPod = async (n: string) => {
      const p = await prisma.pod.create({ data: { code: `${TAG}_${n}`, name: `${TAG} ${n}`, sortOrder: 900 } });
      cleanup.podIds.push(p.id);
      return p;
    };
    const P = await mkPod('Service'), Q = await mkPod('Renewals');

    const person = async (n: string, role: UserRole, agencyId: string | null = null) => {
      const u = await prisma.user.create({ data: { email: `${TAG}-${n}@example.test`, firstName: TAG, lastName: n, role, passwordHash: `secret-${TAG}`, mustChangePassword: false, isActive: true, agencyId } });
      cleanup.userIds.push(u.id);
      return u;
    };
    const ids = new Map<string, string>();
    for (const [i, d] of DEFAULT_POSITIONS.entries()) {
      const p = await prisma.deskPosition.create({ data: { code: `${TAG}_${d.code}`, name: `${TAG} ${d.name}`, department: d.department as DeskDepartment, reach: d.reach as DeskAgencyReach, permissions: [...d.permissions], sortOrder: 900 + i } });
      ids.set(d.code, p.id);
    }
    const hold = (userId: string, ...codes: string[]) => Promise.all(codes.map((c) => prisma.deskPositionHolder.create({ data: { userId, positionId: ids.get(c)! } })));

    const coo = await person('coo', 'DESK_ADMIN'); await hold(coo.id, 'COO');
    const dvo = await person('dvo', 'DESK_VA'); await hold(dvo.id, 'DIRECTOR_VIRTUAL_OPS');
    const dao = await person('dao', 'ACCOUNT_MANAGER'); await hold(dao.id, 'DIRECTOR_AGENCY_OPS');
    const sam = await person('sam', 'ACCOUNT_MANAGER'); await hold(sam.id, 'SENIOR_AM');
    const am1 = await person('am1', 'ACCOUNT_MANAGER'); await hold(am1.id, 'AM');
    const am2 = await person('am2', 'ACCOUNT_MANAGER'); await hold(am2.id, 'AM');
    const lead = await person('lead', 'DESK_VA'); await hold(lead.id, 'POD_LEADER');
    const idle = await person('idle', 'DESK_VA'); await hold(idle.id, 'POD_LEADER'); // the position, but leads no pod
    const va1 = await person('va1', 'DESK_VA'); await hold(va1.id, 'VA');
    const va2 = await person('va2', 'DESK_VA'); await hold(va2.id, 'VA');
    const vaQ = await person('vaq', 'DESK_VA'); await hold(vaQ.id, 'VA');
    const amLead = await person('amlead', 'ACCOUNT_MANAGER'); await hold(amLead.id, 'AM', 'POD_LEADER'); // an Account Manager who leads the other pod
    const owner = await person('owner', 'ADMIN', A.id);

    await prisma.deskReportingLine.create({ data: { userId: am1.id, managerId: sam.id } });
    const member = (podId: string, userId: string, isLead = false) => prisma.podMember.create({ data: { podId, userId, isLead } });
    await member(P.id, lead.id, true);
    for (const u of [idle, va1, va2]) await member(P.id, u.id);
    await member(Q.id, vaQ.id);
    await member(Q.id, amLead.id, true);
    // Beta is on a priced plan, so a price would show if it leaked.
    const plan = await prisma.deskPlan.create({ data: { code: `${TAG}_PLAN`, name: `${TAG} Plan`, monthlyPriceCents: BigInt(123_400) } });
    await prisma.agencyDeskPlan.create({ data: { agencyId: B.id, planId: plan.id, startsOn: ago(40), monthlyPriceCents: BigInt(99_900) } });
    await prisma.agencyPodAccess.createMany({ data: [{ agencyId: A.id, podId: P.id }, { agencyId: A.id, podId: Q.id }, { agencyId: B.id, podId: P.id }] });
    await prisma.agencyDeskAssignment.create({ data: { agencyId: A.id, primaryAmId: am1.id } });
    await prisma.agencyDeskAssignment.create({ data: { agencyId: B.id, primaryAmId: am2.id } });

    const base = 960_000_000 + (Date.now() % 29_000_000);
    let n = 0;
    const mkTask = (title: string, data: Partial<Prisma.TaskUncheckedCreateInput> = {}) => {
      n += 1;
      return prisma.task.create({ data: {
        reference: base + n, agencyId: A.id, type: 'DOCUMENT_UPLOAD', title: `${TAG} confidential-title ${title}`, amId: am1.id,
        createdById: owner.id, restrictedToUserIds: [], podId: P.id, status: 'NEW', ...data,
      } });
    };
    // Open work in the Service pod.
    const t1 = await mkTask('overdue, escalated', { status: 'IN_PROGRESS', assigneeId: va1.id, dueAt: ago(1), escalated: true });
    await mkTask('Beta, unassigned', { agencyId: B.id, amId: am2.id });
    await mkTask('waiting', { status: 'WAITING_ON_AGENCY', assigneeId: va2.id, slaPausedAt: ago(1), dueAt: ago(2) });
    await mkTask('in QA', { status: 'QA_REVIEW', assigneeId: va1.id });
    await mkTask('a subtask', { status: 'IN_PROGRESS', assigneeId: va2.id, parentTaskId: t1.id });
    const tQ = await mkTask('renewals', { podId: Q.id, assigneeId: vaQ.id, status: 'ASSIGNED' });
    await mkTask('switched-off agency', { agencyId: Off.id, assigneeId: va1.id, status: 'IN_PROGRESS' });
    // Completed work.
    const c1 = await mkTask('met its target', {
      status: 'COMPLETED', assigneeId: va1.id, createdAt: ago(6), completedAt: ago(2), slaDueAt: ago(-20),
      billingPeriod: period, billingClass: 'INCLUDED', billingStatus: 'NOT_APPLICABLE', serviceCategory: 'SERVICE', billableUnits: 1,
    });
    const c2 = await mkTask('missed its target', {
      status: 'COMPLETED', assigneeId: va2.id, createdAt: ago(8), completedAt: ago(1), slaDueAt: new Date(ago(8).getTime() + 60_000),
      billingPeriod: period, billingClass: null, billingStatus: null, serviceCategory: 'SERVICE', billableUnits: 1,
    });
    await mkTask('no target, renewals', { status: 'COMPLETED', podId: Q.id, assigneeId: vaQ.id, createdAt: ago(5), completedAt: ago(3) });
    await mkTask('long ago', { status: 'COMPLETED', assigneeId: va1.id, createdAt: ago(70), completedAt: ago(60) });
    await mkTask('switched-off agency, completed this month', {
      agencyId: Off.id, status: 'COMPLETED', createdAt: ago(3), completedAt: ago(2),
      billingPeriod: period, billingClass: null, billingStatus: null, serviceCategory: 'SERVICE', billableUnits: 1,
    });
    await mkTask('a finished subtask', { status: 'COMPLETED', assigneeId: va1.id, parentTaskId: t1.id, createdAt: ago(5), completedAt: ago(2) });
    // QA decisions: one passed, two sent back (one of them in the other pod), one long ago.
    const qaEvent = (taskId: string, toStatus: 'COMPLETED' | 'IN_PROGRESS', at: Date) => prisma.taskEvent.create({ data: { taskId, agencyId: A.id, actorId: lead.id, kind: 'STATUS_CHANGED', fromStatus: 'QA_REVIEW', toStatus, createdAt: at } });
    await qaEvent(c1.id, 'COMPLETED', ago(2));
    await qaEvent(t1.id, 'IN_PROGRESS', ago(3));
    await qaEvent(tQ.id, 'IN_PROGRESS', ago(3));
    await qaEvent(t1.id, 'IN_PROGRESS', ago(50));

    const S = (u: { id: string }) => resolveDeskScope(prisma, u.id);
    const pod = (d: Json, id: string) => (d.virtual.pods as Json[]).find((p) => p.id === id);
    const who = (d: Json, id: string) => (d.virtual.people as Json[]).find((p) => p.id === id);
    const agency = (d: Json, id: string) => (d.agency.agencies as Json[]).find((a) => a.id === id);
    const manager = (d: Json, id: string) => (d.agency.managers as Json[]).find((m) => m.id === id);

    section('Who sees which dashboard');
    {
      const [sCoo, sDvo, sDao, sSam, sLead, sIdle, sAm, sVa, sOwner] = await Promise.all([S(coo), S(dvo), S(dao), S(sam), S(lead), S(idle), S(am1), S(va1), S(owner)]);
      ok('the COO: both', !!virtualReach(sCoo) && !!agencyReach(sCoo));
      ok('the Director of Virtual Operations: Virtual Operations only', !!virtualReach(sDvo) && !agencyReach(sDvo));
      ok('the Director of Agency Operations: Agency Operations only', !virtualReach(sDao) && !!agencyReach(sDao));
      ok('a Senior AM: Agency Operations, for their reach', !virtualReach(sSam) && agencyReach(sSam)?.agencyIds?.join() === A.id);
      ok('a Pod Leader: Virtual Operations, for the pods they lead', virtualReach(sLead)?.pods?.join() === P.id && !agencyReach(sLead));
      ok('the position without a pod to lead: none', !virtualReach(sIdle) && !agencyReach(sIdle) && !can(sIdle, 'dashboard.virtual_ops'));
      ok('an Account Manager, a VA and an agency user: none', [sAm, sVa, sOwner].every((s) => !virtualReach(s) && !agencyReach(s)));
      const denied = () => prisma.deskAuditLog.count({ where: { actorId: { in: [idle.id, am1.id, va1.id, owner.id] }, action: 'access.denied' } });
      const d0 = await denied();
      const refused = await Promise.all([sIdle, sAm, sVa, sOwner].map((s) => status(() => getDashboards(prisma, s, {}, CTX))));
      ok('…refused', refused.every((s) => s === 403), refused);
      ok('…and each refusal logged', (await denied()) === d0 + 4);
      const plId = ids.get('POD_LEADER')!;
      const plPerms = (await prisma.deskPosition.findUniqueOrThrow({ where: { id: plId } })).permissions;
      await prisma.deskPosition.update({ where: { id: plId }, data: { permissions: plPerms.filter((p) => p !== 'dashboard.virtual_ops') } });
      const sNo = await S(lead);
      ok('a Pod Leader whose position no longer has it: none, refused', !virtualReach(sNo) && await status(() => getDashboards(prisma, sNo, {}, CTX)) === 403);
      await prisma.deskPosition.update({ where: { id: plId }, data: { permissions: plPerms } });
      const add = (key: string) => PERMISSION_ADDITIONS.find((a) => a.key === key)?.codes.join();
      ok('existing positions get them once: COO, Director and Pod Leader; COO, Director and Senior AM', add('dashboard.virtual_ops') === 'COO,DIRECTOR_VIRTUAL_OPS,POD_LEADER' && add('dashboard.agency_ops') === 'COO,DIRECTOR_AGENCY_OPS,SENIOR_AM');
      const has = (code: string, key: string) => !!DEFAULT_POSITIONS.find((p) => p.code === code)?.permissions.includes(key as never);
      ok('…and new ones by default; not the Account Manager or the VA', has('COO', 'dashboard.virtual_ops') && has('COO', 'dashboard.agency_ops') && has('POD_LEADER', 'dashboard.virtual_ops') && has('SENIOR_AM', 'dashboard.agency_ops')
        && !has('DIRECTOR_VIRTUAL_OPS', 'dashboard.agency_ops') && !has('DIRECTOR_AGENCY_OPS', 'dashboard.virtual_ops') && !['AM', 'VA'].some((c) => has(c, 'dashboard.virtual_ops') || has(c, 'dashboard.agency_ops')));
    }

    section('Virtual Operations: the figures');
    {
      const d = await getDashboards(prisma, await S(coo), {}, CTX) as Json;
      const p = pod(d, P.id);
      ok('every pod for the COO', d.virtual.reach === 'ALL' && !!p && !!pod(d, Q.id));
      ok('open work in the pod, subtasks included, as on the Workload page (a switched-off agency\'s too, still held)', p.open === 6 && p.unassigned === 1 && p.overdue === 1 && p.waiting === 1 && p.escalated === 1, p);
      ok('completed in the period: requests only, not subtasks, not long ago', p.done.completed === 2, p.done);
      ok('…targets: one met of two', p.done.withTarget === 2 && p.done.met === 1);
      ok('QA: in review, passed and sent back, in the period', p.qa.inReview === 1 && p.qa.passed === 1 && p.qa.sentBack === 1, p.qa);
      ok('capacity: four people, two with no open work, 1.5 open each', p.capacity.people === 4 && p.capacity.idle === 2 && p.capacity.openPerPerson === 1.5, p.capacity);
      ok('…shown as such', capacityLabel(p.capacity) === '1.5 open each · 2 with none' && qaLabel(p.qa) === '50% passed (1 of 2)');
      const v1 = who(d, va1.id), v2 = who(d, va2.id);
      ok('a VA: their open work, completed work, target and QA', v1.open === 3 && v1.overdue === 1 && v1.done.completed === 1 && v1.done.met === 1 && v1.qa.passed === 1 && v1.qa.sentBack === 1 && v1.qa.inReview === 1, v1);
      ok('…another', v2.open === 2 && v2.waiting === 1 && v2.done.completed === 1 && v2.done.met === 0 && v2.qa.passed === 0, v2);
      ok('…with their pods', v1.pods.includes(P.name) && who(d, vaQ.id).pods.join() === Q.name);
      const q = pod(d, Q.id);
      ok('the other pod: its own figures', q.open === 1 && q.done.completed === 1 && q.done.withTarget === 0 && q.qa.sentBack === 1 && q.capacity.people === 2 && q.capacity.idle === 1, q);
      const d90 = await getDashboards(prisma, await S(coo), { days: 90 }, CTX) as Json;
      ok('a longer period counts older work and QA', pod(d90, P.id).done.completed === 3 && pod(d90, P.id).qa.sentBack === 2 && pod(d90, P.id).open === 6);
      const allow = (d.virtual.allowances?.agencies as Json[] | undefined)?.find((a) => a.id === A.id);
      ok('allowances, read-only: the month\'s use for the agency', !!allow && allow.totals.included === 1 && allow.totals.pending === 1 && allow.plan === null, allow);
      const allowB = (d.virtual.allowances?.agencies as Json[] | undefined)?.find((a) => a.id === B.id);
      ok('…the plan\'s name for an agency on a plan', allowB?.plan === `${TAG} Plan`, allowB);
      ok('…never a price', !/price|cents/i.test(JSON.stringify(d.virtual)));
    }

    section('Virtual Operations: a Pod Leader\'s pods');
    {
      const d = await getDashboards(prisma, await S(lead), {}, CTX) as Json;
      ok('only the pod they lead', d.virtual.reach === 'LED_PODS' && d.virtual.pods.length === 1 && d.virtual.pods[0].id === P.id);
      const p = pod(d, P.id);
      ok('…with the same figures, less work for an agency that never authorised the pod', p.open === 5 && p.done.completed === 2 && p.done.met === 1 && p.qa.passed === 1 && p.qa.sentBack === 1 && p.capacity.people === 4 && p.capacity.openPerPerson === 1.3, p);
      const sLead = await S(lead);
      ok('…counted, but someone else\'s completed request still doesn\'t open for them', (await prisma.task.count({ where: { AND: [{ id: c2.id }, taskWhere(sLead)] } })) === 0);
      await prisma.task.update({ where: { id: c2.id }, data: { restrictedToUserIds: [va2.id] } });
      const r = await getDashboards(prisma, sLead, {}, CTX) as Json;
      ok('…and a request restricted to someone else stays out of their figures', pod(r, P.id).done.completed === 1 && who(r, va2.id).done.completed === 0);
      await prisma.task.update({ where: { id: c2.id }, data: { restrictedToUserIds: [] } });
      ok('…the totals are the pod\'s', d.virtual.total.open === 5 && d.virtual.total.done.completed === 2 && d.virtual.total.qa.sentBack === 1);
      ok('…its people, not the other pod\'s', !!who(d, va1.id) && !!who(d, idle.id) && !who(d, vaQ.id));
      ok('…no allowances, and no Agency Operations', d.virtual.allowances === null && d.agency === null);
      ok('the Director of Virtual Operations sees allowances, not Agency Operations', await (async () => {
        const x = await getDashboards(prisma, await S(dvo), {}, CTX) as Json;
        return x.virtual.reach === 'ALL' && x.virtual.allowances !== null && x.agency === null && !/price|cents/i.test(JSON.stringify(x));
      })());
    }

    section('Agency Operations');
    {
      const d = await getDashboards(prisma, await S(dao), {}, CTX) as Json;
      ok('every agency with The Desk on for the Director', d.agency.reach === 'ALL' && !!agency(d, A.id) && !!agency(d, B.id) && !agency(d, Off.id) && d.virtual === null);
      const a = agency(d, A.id);
      ok('an agency: its open work, waiting on it, in QA review', a.open === 5 && a.overdue === 1 && a.escalated === 1 && a.waitingOnAgency === 1 && a.inReview === 1, a);
      ok('…completed and targets', a.done.completed === 3 && a.done.withTarget === 2 && a.done.met === 1, a.done);
      ok('…its Account Manager', a.am?.id === am1.id);
      ok('…and this month\'s use', a.usage?.included === 1 && a.usage?.pending === 1 && a.usage?.plan === null, a.usage);
      const m1 = manager(d, am1.id), m2 = manager(d, am2.id);
      ok('Account Managers: the work of the agencies they are primary for', m1.agencies === 1 && m1.open === 5 && m1.overdue === 1 && m1.done.completed === 3 && m2.agencies === 1 && m2.open === 1 && m2.done.completed === 0, { m1, m2 });
      ok('awaiting a decision: QA, escalations, billing', d.agency.awaiting.inReview >= 1 && d.agency.awaiting.escalated >= 1 && d.agency.awaiting.billing >= 1);
      ok('…never a price', !/price|cents/i.test(JSON.stringify(d)));
      const rows = d.agency.agencies as Json[];
      ok('the totals are those of the agencies shown: no work or use of a switched-off agency', d.agency.total.open === rows.reduce((n, r) => n + r.open, 0)
        && d.agency.utilization.pending === rows.reduce((n, r) => n + (r.usage?.pending ?? 0), 0), { open: d.agency.total.open, pending: d.agency.utilization.pending });

      const s = await getDashboards(prisma, await S(sam), {}, CTX) as Json;
      ok('a Senior AM: their team\'s agency, not another', s.agency.reach === 'IN_REACH' && s.agency.agencies.length === 1 && s.agency.agencies[0].id === A.id && s.agency.total.agencies === 1);
      ok('…with the same figures', agency(s, A.id).open === 5 && agency(s, A.id).done.completed === 3 && s.agency.total.open === 5);
      ok('…the Account Managers of those agencies only', s.agency.managers.length === 1 && s.agency.managers[0].id === am1.id);
      ok('…usage of those agencies only', s.agency.utilization?.pending === 1 && s.agency.awaiting.billing === 1 && s.agency.awaiting.inReview === 1);
      ok('…and no Virtual Operations', s.virtual === null);

      const c = await getDashboards(prisma, await S(coo), {}, CTX) as Json;
      ok('the COO: both on one page, with the same agency figures', !!c.virtual && agency(c, A.id).open === 5 && agency(c, A.id).done.completed === 3);
      ok('no request text anywhere', !JSON.stringify([d, s, c]).includes('confidential-title'));
    }

    section('The period, the sidebar and the route');
    {
      ok('periods: 7, 30, 90 or 365 days', dashboardOptions({}).days === 30 && dashboardOptions({ days: '90' }).days === 90 && await status(async () => dashboardOptions({ days: '5' })) === 400);
      const [sCoo, sDvo, sDao, sSam, sLead, sIdle, sAm, sVa] = await Promise.all([S(coo), S(dvo), S(dao), S(sam), S(lead), S(idle), S(am1), S(va1)]);
      const shows = (s: DeskScope) => navFor('OPS', navAccess(s)).some((i) => i.label === 'Dashboards');
      ok('in the sidebar for the COO, both Directors, a Senior AM and a Pod Leader who leads', [sCoo, sDvo, sDao, sSam, sLead].every(shows));
      ok('…not for the position without a pod, an Account Manager or a VA', ![sIdle, sAm, sVa].some(shows) && !itemAllowed('/desk-ops/dashboards', navAccess(sIdle)));
      const req = (token: string | null, query = '') => new NextRequest(`http://localhost/api/desk/dashboards${query}`, { headers: token ? { cookie: `session_token=${token}` } : {} });
      const [tCoo, tLead, tIdle, tAm, tAmLead] = await Promise.all([createSession(coo.id), createSession(lead.id), createSession(idle.id), createSession(am1.id), createSession(amLead.id)]);
      const r = await dashboardsRoute(req(tCoo, '?days=7'));
      const body = r.status === 200 ? await r.json() as Json : null;
      ok('route: 200 for the COO, with the period asked for', body?.period?.days === 7 && !!body.virtual && !!body.agency);
      const rl = await dashboardsRoute(req(tLead));
      ok('…200 for the Pod Leader, their pods only', rl.status === 200 && ((await rl.json()) as Json).virtual.reach === 'LED_PODS');
      const ra = await dashboardsRoute(req(tAmLead));
      const ba = ra.status === 200 ? await ra.json() as Json : null;
      ok('…200 for an Account Manager who leads a pod: that pod, no agencies', ba?.virtual?.reach === 'LED_PODS' && ba.virtual.pods.length === 1 && ba.virtual.pods[0].id === Q.id && ba.agency === null, ra.status);
      const deniedIdle = () => prisma.deskAuditLog.count({ where: { actorId: idle.id, action: 'access.denied', entityType: 'DeskSetup' } });
      const di = await deniedIdle();
      ok('…403 for the position without a pod, logged', (await dashboardsRoute(req(tIdle))).status === 403 && (await deniedIdle()) === di + 1);
      ok('…403 for an Account Manager', (await dashboardsRoute(req(tAm))).status === 403);
      ok('…400 for a period not offered', (await dashboardsRoute(req(tCoo, '?days=5'))).status === 400);
      ok('…401 signed out', (await dashboardsRoute(req(null))).status === 401);
    }
  } catch (err) {
    console.error(err);
    fail++;
  } finally {
    await wipe();
    const left = await prisma.user.count({ where: { email: { startsWith: TAG } } })
      + await prisma.agency.count({ where: { id: { in: cleanup.agencyIds } } })
      + await prisma.pod.count({ where: { code: { startsWith: TAG } } })
      + await prisma.podMember.count({ where: { OR: [{ podId: { in: cleanup.podIds } }, { userId: { in: cleanup.userIds } }] } })
      + await prisma.task.count({ where: { agencyId: { in: cleanup.agencyIds } } })
      + await prisma.taskEvent.count({ where: { agencyId: { in: cleanup.agencyIds } } })
      + await prisma.deskReportingLine.count({ where: { OR: [{ userId: { in: cleanup.userIds } }, { managerId: { in: cleanup.userIds } }] } })
      + await prisma.deskPosition.count({ where: { code: { startsWith: TAG } } })
      + await prisma.deskPlan.count({ where: { code: { startsWith: TAG } } })
      + await prisma.agencyDeskPlan.count({ where: { agencyId: { in: cleanup.agencyIds } } })
      + await prisma.deskAuditLog.count({ where: { OR: [{ actorId: { in: cleanup.userIds } }, { agencyId: { in: cleanup.agencyIds } }] } });
    ok('temporary records removed, audit entries included', left === 0, left);
    console.log(`\n${pass} passed, ${fail} failed`);
    await prisma.$disconnect();
    process.exit(fail ? 1 : 0);
  }
})();
