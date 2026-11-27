/**
 * Module 48: The Desk's access decided by positions, not fixed roles.
 *
 *   npx tsx script/verify-desk-position-access.ts
 *
 * Temporary people whose positions differ from their roles (a "VA" role
 * holding the Director of Virtual Operations position, an Account Manager who
 * is also a Pod Leader, someone with no position, someone whose only position
 * is switched off) against temporary agencies, a pod, accounts, requests and
 * documents. It checks:
 *  - what each scope becomes;
 *  - what each person sees: restricted requests, books, policies and
 *    sensitive documents;
 *  - what each person may do: assign, escalate, restrict, reclassify, file
 *    requests, messages;
 *  - Desk setup and oversight routes by permission;
 *  - the sidebar and area gates;
 *  - that a position change applies on the next request.
 *
 * Every temporary record is removed at the end.
 */
import 'dotenv/config';
import { NextRequest } from 'next/server';
import type { DeskAgencyReach, DeskDepartment, Prisma, UserRole } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { createSession } from '../lib/auth';
import { can, DeskAccessError, documentWhere, insuredWhere, policyWhere, resolveDeskScope, resolveSubmission, taskWhere, type DeskScope } from '../lib/desk/access';
import { meetsNeed } from '../lib/desk/admin-api';
import { DEFAULT_POSITIONS, type PermissionKey } from '../lib/desk/permission-catalogue';
import { gateArea, itemAllowed, navAccess, navFor, otherAreaLinks } from '../lib/desk/navigation';
import { getTaskDetail } from '../lib/desk/task-api';
import { queueOptions } from '../lib/desk/task-queue';
import { assignTask, escalateTask, restrictTask, reviewTask } from '../lib/desk/tasks';
import { messageInbox } from '../lib/desk/messages';
import { changeWorkload, getWorkload } from '../lib/desk/workload';
import { getAgencySetup, updateAgencySetup } from '../lib/desk/agency-setup';
import { getAgencyPodAccess, setAgencyPodAccess } from '../lib/desk/pod-admin';
import { canManagePerson, deactivateStaff, invitableRoles, inviteStaff, listStaff, reactivateStaff, renameStaff } from '../lib/desk/staff';
import { getAgencyUsage, getUsage } from '../lib/desk/usage';
import { agencySummary, managedAgencies } from '../lib/desk/agency-view';
import { managerDashboard } from '../lib/desk/manager-dashboard';
import { addPositionHolder, removePositionHolder, updatePosition } from '../lib/desk/positions';
import { PATCH as agencyPatch } from '../app/api/desk/admin/agencies/[id]/route';
import { GET as podAccessRoute, PUT as podAccessPut } from '../app/api/desk/admin/agencies/[id]/pod-access/route';
import { GET as staffRoute } from '../app/api/desk/admin/staff/route';
import { GET as podsRoute } from '../app/api/desk/admin/pods/route';
import { GET as agencyRoute } from '../app/api/desk/admin/agencies/[id]/route';
import { GET as vaPermRoute } from '../app/api/desk/admin/va-permissions/route';
import { GET as auditRoute } from '../app/api/desk/audit/route';
import { GET as workloadRoute } from '../app/api/desk/workload/route';

process.env.DESK_EMAIL_NOTIFICATIONS = 'off';

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, detail = '') => {
  c ? pass++ : fail++;
  console.log(`  ${c ? '✓' : '✗'} ${n}${!c && detail ? `  [${detail}]` : ''}`);
};
const section = (s: string) => console.log(`\n${s}`);

const TAG = `m48test${Date.now()}`;
const CTX = { ip: '203.0.113.48', userAgent: 'verify-desk-position-access' };
const cleanup = { agencyIds: [] as string[], userIds: [] as string[], podIds: [] as string[] };
type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any

async function wipe() {
  const agencyId = { in: cleanup.agencyIds };
  const userId = { in: cleanup.userIds };
  const positions = (await prisma.deskPosition.findMany({ where: { name: { startsWith: TAG } }, select: { id: true } })).map((p) => p.id);
  await prisma.taskDocument.deleteMany({ where: { agencyId } });
  await prisma.taskEvent.deleteMany({ where: { agencyId } });
  await prisma.task.updateMany({ where: { agencyId }, data: { parentTaskId: null } });
  await prisma.task.deleteMany({ where: { agencyId } });
  await prisma.policy.deleteMany({ where: { agencyId } });
  await prisma.insuredAccount.deleteMany({ where: { agencyId } });
  await prisma.agencyPodAccess.deleteMany({ where: { OR: [{ agencyId }, { podId: { in: cleanup.podIds } }] } });
  await prisma.podMember.deleteMany({ where: { podId: { in: cleanup.podIds } } });
  await prisma.pod.deleteMany({ where: { id: { in: cleanup.podIds } } });
  await prisma.agencyDeskAssignment.deleteMany({ where: { agencyId } });
  await prisma.agencyAllowanceOverride.deleteMany({ where: { agencyDeskPlan: { is: { agencyId } } } });
  await prisma.agencyDeskPlan.deleteMany({ where: { agencyId } });
  await prisma.deskPlan.deleteMany({ where: { code: { startsWith: TAG } } });
  await prisma.inviteToken.deleteMany({ where: { userId } });
  await prisma.activityEvent.deleteMany({ where: { userId } });
  await prisma.deskPositionHolder.deleteMany({ where: { OR: [{ userId }, { positionId: { in: positions } }] } });
  await prisma.deskPosition.deleteMany({ where: { id: { in: positions } } });
  await prisma.deskStaffPermission.deleteMany({ where: { userId } });
  await prisma.deskNotification.deleteMany({ where: { OR: [{ agencyId }, { recipientId: userId }] } });
  await prisma.deskAuditLog.deleteMany({ where: { OR: [{ agencyId }, { actorId: userId }] } });
  await prisma.session.deleteMany({ where: { userId } });
  await prisma.user.deleteMany({ where: { OR: [{ id: userId }, { email: { startsWith: TAG } }] } });
  await prisma.agency.deleteMany({ where: { id: agencyId } });
}

const status = async (fn: () => Promise<unknown>) => {
  try { await fn(); return 200; } catch (e) { if (e instanceof DeskAccessError) return e.status; throw e; }
};

(async () => {
  try {
    const A = await prisma.agency.create({ data: { name: `${TAG} Harbor`, deskEnabled: true } });
    const B = await prisma.agency.create({ data: { name: `${TAG} Basin`, deskEnabled: true } });
    cleanup.agencyIds.push(A.id, B.id);
    const P = await prisma.pod.create({ data: { code: `${TAG}-P`, name: `${TAG} Pod` } });
    cleanup.podIds.push(P.id);
    await prisma.agencyPodAccess.create({ data: { agencyId: A.id, podId: P.id } });

    const person = async (n: string, role: UserRole, extra: { agencyId?: string } = {}) => {
      const u = await prisma.user.create({ data: { email: `${TAG}-${n}@example.test`, firstName: TAG, lastName: n, role, passwordHash: `secret-${TAG}`, mustChangePassword: false, isActive: true, agencyId: extra.agencyId ?? null } });
      cleanup.userIds.push(u.id);
      return u;
    };
    // Test copies of the client's default positions, so the real ones are never touched.
    const positionIds = new Map<string, string>();
    for (const [i, d] of DEFAULT_POSITIONS.entries()) {
      const p = await prisma.deskPosition.create({ data: { code: `${TAG}_${d.code}`, name: `${TAG} ${d.name}`, department: d.department as DeskDepartment, reach: d.reach as DeskAgencyReach, permissions: [...d.permissions], sortOrder: 900 + i } });
      positionIds.set(d.code, p.id);
    }
    const hold = (userId: string, ...codes: string[]) => Promise.all(codes.map((c) => prisma.deskPositionHolder.create({ data: { userId, positionId: positionIds.get(c)! } })));

    const coo = await person('coo', 'DESK_ADMIN'); await hold(coo.id, 'COO');
    const dvo = await person('dvo', 'DESK_VA'); await hold(dvo.id, 'DIRECTOR_VIRTUAL_OPS');
    const dao = await person('dao', 'ACCOUNT_MANAGER'); await hold(dao.id, 'DIRECTOR_AGENCY_OPS');
    const am = await person('am', 'ACCOUNT_MANAGER'); await hold(am.id, 'AM');
    const amPod = await person('ampod', 'ACCOUNT_MANAGER'); await hold(amPod.id, 'AM', 'POD_LEADER');
    const lead = await person('lead', 'DESK_VA'); await hold(lead.id, 'POD_LEADER');
    const va = await person('va', 'DESK_VA'); await hold(va.id, 'VA');
    const bare = await person('bare', 'DESK_VA');
    const off = await person('off', 'DESK_VA');
    const offPos = await prisma.deskPosition.create({ data: { code: `${TAG}_OFF`, name: `${TAG} Off`, department: 'VIRTUAL_OPERATIONS', reach: 'POD', permissions: ['requests.work'], isActive: false } });
    await prisma.deskPositionHolder.create({ data: { userId: off.id, positionId: offPos.id } });
    const owner = await person('owner', 'ADMIN', { agencyId: A.id });
    // The Pod Leaders lead the pod (Module 51: their position hands work out only there).
    for (const u of [amPod, lead, va, bare]) await prisma.podMember.create({ data: { podId: P.id, userId: u.id, isLead: u === amPod || u === lead } });
    await prisma.agencyDeskAssignment.create({ data: { agencyId: A.id, primaryAmId: am.id } });
    await prisma.agencyDeskAssignment.create({ data: { agencyId: B.id, primaryAmId: amPod.id } });

    const accA = await prisma.insuredAccount.create({ data: { agencyId: A.id, name: `${TAG} Acme`, nameKey: `${TAG} acme` } });
    const quiet = await prisma.insuredAccount.create({ data: { agencyId: A.id, name: `${TAG} Quiet`, nameKey: `${TAG} quiet` } });
    const polQuiet = await prisma.policy.create({ data: { agencyId: A.id, insuredId: quiet.id, policyNumber: `${TAG}-Q1`, status: 'ACTIVE' } as Prisma.PolicyUncheckedCreateInput });
    const now = Date.now();
    let n = 0;
    const mkTask = (title: string, data: Partial<Prisma.TaskUncheckedCreateInput> = {}) => {
      n += 1;
      return prisma.task.create({ data: {
        reference: 930_000_000 + (now % 29_000_000) + n, agencyId: A.id, type: 'DOCUMENT_UPLOAD', title: `${TAG} ${title}`, amId: am.id,
        createdById: owner.id, restrictedToUserIds: [], insuredId: accA.id, podId: P.id, status: 'NEW', ...data,
      } });
    };
    const t1 = await mkTask('Open work');
    const t2 = await mkTask('Restricted work', { restrictedToUserIds: [va.id], restrictionReason: 'Litigation' });
    const t3 = await mkTask('To restrict');
    const tB = await mkTask('Basin work', { agencyId: B.id, insuredId: null, podId: null, amId: amPod.id });
    const doc = (sensitivity: 'GENERAL' | 'FINANCIAL') => prisma.taskDocument.create({ data: { taskId: t1.id, agencyId: A.id, storageKey: `desk/${TAG}/${sensitivity}`, fileName: `${sensitivity}.pdf`, fileSize: 1000, contentType: 'application/pdf', visibility: 'INTERNAL', sensitivity, uploadedById: am.id } });
    const dGen = await doc('GENERAL');
    const dFin = await doc('FINANCIAL');

    const S = async (u: { id: string }) => resolveDeskScope(prisma, u.id);
    const [sCoo, sDvo, sDao, sAm, sAmPod, sLead, sVa, sBare, sOff, sOwner] = await Promise.all([coo, dvo, dao, am, amPod, lead, va, bare, off, owner].map(S));
    const sees = async (s: DeskScope, id: string) => (await prisma.task.count({ where: { AND: [{ id }, taskWhere(s)] } })) === 1;

    section('What each scope becomes');
    ok('the COO and both Directors reach every agency, whatever their role (the Director here has the VA role)', sCoo.kind === 'PLATFORM' && sDvo.kind === 'PLATFORM' && sDao.kind === 'PLATFORM');
    ok('an Account Manager reaches their agencies', sAm.kind === 'ACCOUNT_MANAGER' && sAm.agencyIds.join() === A.id);
    ok('an AM who is also a Pod Leader: their agency, plus pod work for the agencies that authorise the pod',
      sAmPod.kind === 'ACCOUNT_MANAGER' && sAmPod.agencyIds.join() === B.id && sAmPod.grants.some((g) => g.agencyId === A.id && g.podId === P.id) && can(sAmPod, 'requests.assign'));
    ok('a Pod Leader and a VA reach by pod', sLead.kind === 'VA' && sVa.kind === 'VA' && can(sLead, 'requests.assign') && !can(sVa, 'requests.assign'));
    ok('someone with no position yet gets their role\'s default (a VA)', sBare.kind === 'VA' && sBare.permissions.join() === 'requests.work' && sBare.grants.length === 1);
    ok('someone whose only position is switched off has no Desk access', sOff.kind === 'NONE' && sOff.reason === 'no active position');
    ok('Financial and Personal documents: the COO and AM by permission; the Director of Virtual Operations and VAs only General and Policy',
      sCoo.kind === 'PLATFORM' && sCoo.sensitivities.length === 4 && sAm.kind === 'ACCOUNT_MANAGER' && sAm.sensitivities.length === 4
      && sDvo.kind === 'PLATFORM' && sDvo.sensitivities.join() === 'GENERAL,POLICY' && sVa.kind === 'VA' && sVa.sensitivities.join() === 'GENERAL,POLICY');

    section('Restricted requests (Q4)');
    ok('the named VA sees it', await sees(sVa, t2.id));
    ok('those who may restrict see it: the COO, the Director of Agency Operations, the agency\'s AM', await sees(sCoo, t2.id) && await sees(sDao, t2.id) && await sees(sAm, t2.id));
    ok('reaching every agency isn\'t enough: the Director of Virtual Operations doesn\'t see it', !(await sees(sDvo, t2.id)) && await sees(sDvo, t1.id));
    ok('nor a Pod Leader, nor the AM–Pod Leader through the pod', !(await sees(sLead, t2.id)) && !(await sees(sAmPod, t2.id)) && await sees(sAmPod, t1.id));

    section('Books and documents');
    const seesAccount = async (s: DeskScope, id: string) => (await prisma.insuredAccount.count({ where: { AND: [{ id }, insuredWhere(s)] } })) === 1;
    const seesPolicy = async (s: DeskScope, id: string) => (await prisma.policy.count({ where: { AND: [{ id }, policyWhere(s)] } })) === 1;
    ok('the COO and the AM open any account of the agency, even one with no requests', await seesAccount(sCoo, quiet.id) && await seesAccount(sAm, quiet.id) && await seesPolicy(sAm, polQuiet.id));
    ok('the Director of Virtual Operations reaches books only through requests', await seesAccount(sDvo, accA.id) && !(await seesAccount(sDvo, quiet.id)) && !(await seesPolicy(sDvo, polQuiet.id)));
    ok('the AM–Pod Leader: their own agency\'s books, and the other only through pod work', await seesAccount(sAmPod, accA.id) && !(await seesAccount(sAmPod, quiet.id)));
    const seesDoc = async (s: DeskScope, id: string) => (await prisma.taskDocument.count({ where: { AND: [{ id }, documentWhere(s)] } })) === 1;
    ok('a Financial document: the COO and the AM yes; the Director of Virtual Operations and the VA no', await seesDoc(sCoo, dFin.id) && await seesDoc(sAm, dFin.id) && !(await seesDoc(sDvo, dFin.id)) && !(await seesDoc(sVa, dFin.id)));
    ok('a General one: all of them', await seesDoc(sDvo, dGen.id) && await seesDoc(sVa, dGen.id));

    section('What each may do');
    ok('a Pod Leader hands work to a VA in their pod', await status(() => assignTask(prisma, sLead, t1.id, va.id, CTX)) === 200
      && (await prisma.task.findUniqueOrThrow({ where: { id: t1.id } })).assigneeId === va.id);
    ok('a VA can\'t hand it on to someone else (403)', await status(() => assignTask(prisma, sVa, t1.id, bare.id, CTX)) === 403);
    ok('work can\'t be given to an all-agency position (they oversee, not hold)', await status(() => assignTask(prisma, sLead, t1.id, dvo.id, CTX)) === 400);
    ok('the Director of Virtual Operations escalates, but can\'t restrict or reclassify (403)',
      await status(() => escalateTask(prisma, sDvo, t1.id, { escalate: true, reason: `${TAG} needs a hand` }, CTX)) === 200
      && await status(() => restrictTask(prisma, sDvo, t1.id, { userIds: [va.id], reason: 'x' }, CTX)) === 403
      && await status(() => reviewTask(prisma, sDvo, t1.id, { complexity: 'COMPLEX' }, CTX)) === 403);
    ok('the Director of Agency Operations restricts', await status(() => restrictTask(prisma, sDao, t3.id, { userIds: [va.id], reason: `${TAG} sensitive` }, CTX)) === 200);
    ok('filing a request for an agency: the AM yes; the Director of Virtual Operations and a Pod Leader no (not found)',
      await status(() => resolveSubmission(prisma, sAm, { agencyId: A.id }, CTX)) === 200
      && await status(() => resolveSubmission(prisma, sDvo, { agencyId: A.id }, CTX)) === 404
      && await status(() => resolveSubmission(prisma, sLead, { agencyId: A.id }, CTX)) === 404);
    ok('agency messages: the Director of Agency Operations yes; the Director of Virtual Operations and a VA no',
      await status(() => messageInbox(prisma, sDao, CTX)) === 200 && await status(() => messageInbox(prisma, sDvo, CTX)) === 404 && await status(() => messageInbox(prisma, sVa, CTX)) === 404);
    const detailDvo = await getTaskDetail(prisma, sDvo, t1.id, CTX) as Json;
    const detailCoo = await getTaskDetail(prisma, sCoo, t1.id, CTX) as Json;
    ok('the workspace offers the Director of Virtual Operations what their position allows, and no more',
      detailDvo.permissions.assign && detailDvo.permissions.escalate && !detailDvo.permissions.restrict && !detailDvo.permissions.review);
    ok('…and leaves out who is named, why, and billing; the COO sees them',
      !('restrictedToUserIds' in detailDvo) && !('billing' in detailDvo) && 'slaDueAt' in detailDvo
      && 'restrictedToUserIds' in detailCoo && 'billing' in detailCoo);
    ok('the queue: a Pod Leader may assign; the AM–Pod Leader filters by both agencies',
      (await queueOptions(prisma, sLead, CTX)).canAssign && (await queueOptions(prisma, sAmPod, CTX)).agencies.map((a) => a.id).sort().join() === [A.id, B.id].sort().join());

    section('Desk setup and oversight, by permission');
    ok('the Director of Virtual Operations: staff, pods and operating rules; not agency setup, document grants or the audit log',
      meetsNeed(sDvo, ['staff.manage']) && meetsNeed(sDvo, ['pods.manage']) && meetsNeed(sDvo, ['settings.operations'])
      && !meetsNeed(sDvo, ['agencies.setup']) && !meetsNeed(sDvo, ['documents.grant']) && !meetsNeed(sDvo, ['audit.view']));
    ok('the Director of Agency Operations: agency setup, not pods or staff', meetsNeed(sDao, ['agencies.setup']) && !meetsNeed(sDao, ['pods.manage']) && !meetsNeed(sDao, ['staff.manage']));
    ok('positions: only the Super Admin, not the COO', !meetsNeed(sCoo, 'SUPER_ADMIN'));
    const [tDvo, tDao, tLead, tVa] = await Promise.all([createSession(dvo.id), createSession(dao.id), createSession(lead.id), createSession(va.id)]);
    const req = (url: string, token: string) => new NextRequest(`http://local.test${url}`, { headers: { cookie: `session_token=${token}` } });
    const p = (id: string) => ({ params: Promise.resolve({ id }) });
    ok('routes: pods 200 for the Director of Virtual Operations, 403 for the Director of Agency Operations',
      (await podsRoute(req('/api/desk/admin/pods', tDvo))).status === 200 && (await podsRoute(req('/api/desk/admin/pods', tDao))).status === 403);
    ok('routes: an agency\'s setup 403 for the Director of Virtual Operations, 200 for the Director of Agency Operations',
      (await agencyRoute(req(`/api/desk/admin/agencies/${A.id}`, tDvo), p(A.id))).status === 403 && (await agencyRoute(req(`/api/desk/admin/agencies/${A.id}`, tDao), p(A.id))).status === 200);
    ok('routes: VA document permissions and the audit log are refused to the Director of Virtual Operations',
      (await vaPermRoute(req('/api/desk/admin/va-permissions', tDvo))).status === 403 && (await auditRoute(req('/api/desk/audit', tDvo))).status === 403);
    ok('routes: the workload for the Director of Virtual Operations, and for a Pod Leader their pod (Module 51); a VA is refused',
      (await workloadRoute(req('/api/desk/workload', tDvo))).status === 200 && (await workloadRoute(req('/api/desk/workload', tLead))).status === 200
      && (await workloadRoute(req('/api/desk/workload', tVa))).status === 403);
    ok('a refusal is logged with what the route needed', ((await prisma.deskAuditLog.findFirst({ where: { actorId: dao.id, action: 'access.denied', entityType: 'DeskSetup' }, orderBy: { createdAt: 'desc' } }))?.metadata as Json)?.needs?.includes?.('pods.manage'));
    const wl = await getWorkload(prisma, sDvo, {}) as Json;
    ok('the workload leaves out restricted requests for someone who can\'t restrict', !JSON.stringify(wl).includes(t2.id));
    const openIn = (where: Prisma.TaskWhereInput = {}) => prisma.task.count({ where: { agencyId: A.id, status: { notIn: ['COMPLETED', 'CANCELLED'] }, ...where } });
    const countedIn = async (s: DeskScope) => ((await getWorkload(prisma, s, {})) as Json).agencies.find((a: Json) => a.id === A.id)?.open;
    const [allOpen, plainOpen] = [await openIn(), await openIn({ restrictedToUserIds: { isEmpty: true } })];
    const counted = [await countedIn(sDvo), await countedIn(sCoo)];
    ok('…and from the counts; those who may restrict have them counted', plainOpen < allOpen && counted[0] === plainOpen && counted[1] === allOpen,
      [plainOpen, allOpen, ...counted].join());

    section('Sidebar and areas');
    const labels = (area: 'OPS' | 'ADMIN', s: DeskScope) => navFor(area, navAccess(s)).map((i) => i.label);
    ok('Director of Virtual Operations: queue, workload and turnaround; no Agencies or Messages', ['Pod queue', 'Workload', 'Turnaround', 'Usage & audit'].every((l) => labels('OPS', sDvo).includes(l)) && !labels('OPS', sDvo).includes('Agencies') && !labels('OPS', sDvo).includes('Messages'));
    ok('…Desk setup: Staff, Pods and the operating rules; not Agencies or Positions', ['Staff', 'Pods', 'Routing & targets', 'Business calendar', 'Follow-up rules'].every((l) => labels('ADMIN', sDvo).includes(l)) && !labels('ADMIN', sDvo).includes('Agencies') && !labels('ADMIN', sDvo).includes('Positions'));
    ok('Pod Leader: queue, My tasks, and the Workload of the pod they lead (Module 51); a VA no Workload', labels('OPS', sLead).includes('Pod queue') && labels('OPS', sLead).includes('Workload') && !labels('OPS', sVa).includes('Workload'));
    ok('Desk setup opens for the Directors, not for an AM or a VA', gateArea('ADMIN', dvo.role, sDvo).ok && gateArea('ADMIN', dao.role, sDao).ok && !gateArea('ADMIN', am.role, sAm).ok && !gateArea('ADMIN', va.role, sVa).ok);
    ok('the Directors get links between Desk Operations and Desk setup; a VA doesn\'t', otherAreaLinks('OPS', navAccess(sDvo)).some((l) => l.href === '/super-admin/desk') && !otherAreaLinks('OPS', navAccess(sVa)).length);
    ok('a page is refused if the position doesn\'t allow it', !itemAllowed('/super-admin/desk/agencies', navAccess(sDvo)) && itemAllowed('/super-admin/desk/agencies', navAccess(sDao)));
    ok('a bare role still reads as its default position (Operations Manager → COO)', navFor('ADMIN', 'DESK_ADMIN').length === 7 && navFor('OPS', 'DESK_VA').map((i) => i.label).join() === 'Overview,Pod queue,My tasks');

    section('Plan, price and allowances (pricing decisions)');
    const plan = await prisma.deskPlan.create({ data: { code: `${TAG}-PLAN`, name: `${TAG} Plan`, monthlyPriceCents: BigInt(123_400), sortOrder: 990, isActive: false } as Prisma.DeskPlanUncheckedCreateInput });
    await prisma.agencyDeskPlan.create({ data: { agencyId: A.id, planId: plan.id, startsOn: new Date('2026-11-01'), monthlyPriceCents: BigInt(98_700), notes: `${TAG} agreed discount` } });
    const planInput = { planId: plan.id, startsOn: '2026-11-01', monthlyPriceCents: 55_500, managedAccountsOverride: null, notes: null, overrides: [] };
    const storedPrice = async () => Number((await prisma.agencyDeskPlan.findUniqueOrThrow({ where: { agencyId: A.id } })).monthlyPriceCents);
    const noPrices = { ...sDao, permissions: (sDao as Json).permissions.filter((k: string) => k !== 'billing.prices') } as DeskScope;
    ok('the Director of Agency Operations sees the plan and its price but can\'t change them', await (async () => {
      const v = await getAgencySetup(prisma, sDao, A.id);
      return !v.canChangePlan && v.plan?.monthlyPriceCents === 98_700;
    })());
    ok('changing the price: refused (403), and the price stands', await status(() => updateAgencySetup(prisma, sDao, A.id, { plan: planInput }, CTX)) === 403 && await storedPrice() === 98_700);
    ok('removing the plan: refused', await status(() => updateAgencySetup(prisma, sDao, A.id, { plan: null }, CTX)) === 403 && await storedPrice() === 98_700);
    ok('sending the plan unchanged is refused too, so it can\'t confirm a price', await status(() => updateAgencySetup(prisma, sDao, A.id, { plan: { ...planInput, monthlyPriceCents: 98_700, notes: `${TAG} agreed discount` } }, CTX)) === 403);
    ok('the refusal is logged', !!(await prisma.deskAuditLog.findFirst({ where: { actorId: dao.id, action: 'access.denied', entityType: 'Agency', entityId: A.id } })));
    ok('through the route: 403 as well', (await agencyPatch(new NextRequest(`http://local.test/api/desk/admin/agencies/${A.id}`, { method: 'PATCH', headers: { cookie: `session_token=${tDao}` }, body: JSON.stringify({ plan: planInput }) }), p(A.id))).status === 403);
    ok('the rest of the setup still saves, and leaves the plan alone', await status(() => updateAgencySetup(prisma, sDao, A.id, { deskInstructions: `${TAG} call first` }, CTX)) === 200 && await storedPrice() === 98_700);
    const hidden = await getAgencySetup(prisma, noPrices, A.id);
    ok('without the price permission, prices and the agreement notes are left out', hidden.plan?.monthlyPriceCents === null && hidden.plan.notes === null && hidden.options.plans.every((x) => x.monthlyPriceCents === null) && !JSON.stringify(hidden).includes('98700') && !JSON.stringify(hidden).includes('123400'));
    ok('plans.manage without the price permission can\'t overwrite a price it can\'t see', await status(() => updateAgencySetup(prisma, { ...noPrices, permissions: [...(noPrices as Json).permissions, 'plans.manage'] } as DeskScope, A.id, { plan: planInput }, CTX)) === 403);
    ok('the COO changes it', await status(() => updateAgencySetup(prisma, sCoo, A.id, { plan: planInput }, CTX)) === 200 && await storedPrice() === 55_500);
    ok('usage: prices for the Director of Agency Operations, none for the Director of Virtual Operations', await (async () => {
      const [a, v] = await Promise.all([getUsage(prisma, sDao, {}), getUsage(prisma, sDvo, {})]);
      return a.showsPrices && a.agencies.find((x) => x.id === A.id)?.plan?.monthlyPriceCents === 55_500 && !v.showsPrices && v.agencies.every((x) => !x.plan || x.plan.monthlyPriceCents === null);
    })());

    section('Which agencies a pod may work for');
    ok('the Director of Virtual Operations sees it: can name VAs, not authorize pods (Module 51)', (await getAgencyPodAccess(prisma, sDvo, A.id)).canChange === false && (await getAgencyPodAccess(prisma, sDvo, A.id)).canName === true && (await podAccessRoute(req(`/api/desk/admin/agencies/${A.id}/pod-access`, tDvo), p(A.id))).status === 200);
    ok('but can\'t authorize a pod for an agency (403), by the service or the route', await status(() => setAgencyPodAccess(prisma, sDvo, B.id, { podId: P.id, mode: 'WHOLE' }, CTX)) === 403
      && (await podAccessPut(new NextRequest(`http://local.test/api/desk/admin/agencies/${B.id}/pod-access`, { method: 'PUT', headers: { cookie: `session_token=${tDvo}` }, body: JSON.stringify({ podId: P.id, mode: 'WHOLE' }) }), p(B.id))).status === 403
      && (await prisma.agencyPodAccess.count({ where: { agencyId: B.id } })) === 0);
    ok('the Director of Agency Operations can', (await getAgencyPodAccess(prisma, sDao, B.id)).canChange && await status(() => setAgencyPodAccess(prisma, sDao, B.id, { podId: P.id, mode: 'WHOLE' }, CTX)) === 200
      && (await prisma.agencyPodAccess.count({ where: { agencyId: B.id, podId: P.id } })) === 1);
    ok('…and reaches the Pods page for it', itemAllowed('/super-admin/desk/pods', navAccess(sDao)));
    await prisma.agencyPodAccess.deleteMany({ where: { agencyId: B.id } });

    section('Who manages whom');
    const root = await person('root', 'SUPER_ADMIN');
    const sRoot = await S(root);
    const dvo2 = await person('dvo2', 'DESK_VA'); await hold(dvo2.id, 'DIRECTOR_VIRTUAL_OPS');
    const spare = await person('spare', 'DESK_VA'); await hold(spare.id, 'VA');
    const rows = await listStaff(prisma, sDvo, { q: TAG });
    const may = (id: string) => rows.find((r) => r.id === id)?.canManage;
    ok('the Director of Virtual Operations manages VAs and Pod Leaders', may(spare.id) === true && may(lead.id) === true && may(bare.id) === true);
    ok('not the COO, the other Director, an Account Manager, a fellow Director or themselves',
      [coo.id, dao.id, am.id, amPod.id, dvo2.id, dvo.id].every((id) => may(id) === false));
    const msgPos = await prisma.deskPosition.create({ data: { code: `${TAG}_MSG`, name: `${TAG} Correspondence`, department: 'AGENCY_OPERATIONS', reach: 'ALL', permissions: ['requests.work', 'messages.agency'] } });
    const msgs = await person('msgs', 'DESK_VA');
    await prisma.deskPositionHolder.create({ data: { userId: msgs.id, positionId: msgPos.id } });
    const fewer = { role: 'DESK_VA', permissions: ['requests.work', 'messages.agency'] as PermissionKey[] };
    ok('nor someone with fewer permissions, one of which the Director lacks; the COO has both, so may',
      !canManagePerson(sDvo, fewer) && canManagePerson(sCoo, fewer)
      && (await listStaff(prisma, sDvo, { q: `${TAG}-msgs` })).find((r) => r.id === msgs.id)?.canManage === false
      && await status(() => deactivateStaff(prisma, sDvo, msgs.id, CTX)) === 403);
    ok('a role doesn\'t decide it: the other Director has the VA role here, and is still refused', dvo2.role === 'DESK_VA' && await status(() => deactivateStaff(prisma, sDvo, dvo2.id, CTX)) === 403);
    ok('deactivating, reactivating or renaming someone above: refused (403), nothing changed',
      await status(() => deactivateStaff(prisma, sDvo, dao.id, CTX)) === 403 && await status(() => reactivateStaff(prisma, sDvo, coo.id, CTX)) === 403 && await status(() => renameStaff(prisma, sDvo, am.id, { firstName: 'X', lastName: 'Y' }, CTX)) === 403
      && (await prisma.user.findUniqueOrThrow({ where: { id: dao.id } })).isActive && (await prisma.user.findUniqueOrThrow({ where: { id: am.id } })).firstName === TAG);
    ok('refusals are logged against the person', (await prisma.deskAuditLog.count({ where: { actorId: dvo.id, action: 'access.denied', entityType: 'User', entityId: dao.id } })) === 1);
    ok('they invite VAs only; the COO invites Account Managers and VAs; the Super Admin all three',
      (await invitableRoles(prisma, sDvo)).join() === 'DESK_VA' && (await invitableRoles(prisma, sCoo)).sort().join() === 'ACCOUNT_MANAGER,DESK_VA' && (await invitableRoles(prisma, sRoot)).length === 3);
    let sent = 0;
    const noSend = async () => { sent += 1; return { ok: true }; };
    ok('inviting an Account Manager: refused, no account made', await status(() => inviteStaff(prisma, sDvo, { email: `${TAG}-new@example.test`, firstName: 'N', lastName: 'P', role: 'ACCOUNT_MANAGER' }, CTX, noSend as never)) === 403
      && (await prisma.user.count({ where: { email: `${TAG}-new@example.test` } })) === 0 && sent === 0);
    ok('the staff page is told what it may offer', (await (await staffRoute(req('/api/desk/admin/staff', tDvo))).json()).inviteRoles.join() === 'DESK_VA');
    ok('the COO doesn\'t manage another holder of the COO position, whatever their role', !canManagePerson(sCoo, { role: 'ACCOUNT_MANAGER', permissions: (sCoo as Json).permissions }) && canManagePerson(sRoot, { role: 'DESK_ADMIN', permissions: (sCoo as Json).permissions }));
    ok('managing a VA works', await status(() => deactivateStaff(prisma, sDvo, spare.id, CTX)) === 200 && await status(() => reactivateStaff(prisma, sDvo, spare.id, CTX)) === 200);

    section('Titles, references and agency pages');
    const [hid, seen] = [
      await mkTask('Secret completed', { status: 'COMPLETED', completedAt: new Date('2026-10-15T15:00:00Z'), billingPeriod: '2026-10', billableUnits: 1, restrictedToUserIds: [va.id] }),
      await mkTask('Plain completed', { status: 'COMPLETED', completedAt: new Date('2026-10-15T16:00:00Z'), billingPeriod: '2026-10', billableUnits: 1 }),
    ];
    const lineOf = async (s: DeskScope) => (await getAgencyUsage(prisma, s, A.id, { period: '2026-10' }, CTX)).tasks;
    const dvoLines = await lineOf(sDvo);
    ok('usage: a restricted request still counts, without its title', dvoLines.length === 2 && dvoLines.find((t) => t.id === hid.id)?.title === null && !JSON.stringify(dvoLines).includes('Secret') && dvoLines.find((t) => t.id === seen.id)?.title?.includes('Plain') === true);
    ok('…and with it for those who may restrict', (await lineOf(sDao)).find((t) => t.id === hid.id)?.title?.includes('Secret') === true);
    const bulk = await changeWorkload(prisma, sDvo, { taskIds: [t2.id], assigneeId: va.id }, CTX);
    ok('a bulk change on a request they can\'t see gives away no reference number', bulk.done.length === 0 && bulk.failed[0]?.reference === null);
    ok('…but names one they can see', (await changeWorkload(prisma, sDvo, { taskIds: [tB.id], podId: 'nope' }, CTX)).failed[0]?.reference === tB.reference);
    const deniedBefore = await prisma.deskAuditLog.count({ where: { actorId: dvo.id, action: 'access.denied', entityType: 'Agency' } });
    ok('agency pages (contacts, where logins are kept): not for the Director of Virtual Operations, and logged',
      await status(() => managedAgencies(prisma, sDvo, CTX)) === 404 && await status(() => agencySummary(prisma, sDvo, A.id, CTX)) === 404
      && (await prisma.deskAuditLog.count({ where: { actorId: dvo.id, action: 'access.denied', entityType: 'Agency' } })) === deniedBefore + 2);
    ok('…still for the Director of Agency Operations and the AM', await status(() => managedAgencies(prisma, sDao, CTX)) === 200 && await status(() => agencySummary(prisma, sAm, A.id, CTX)) === 200);
    // Renewals on the overview: on active accounts only, through requests for those who don't open books.
    const soon = new Date(Date.now() + 20 * 86_400_000);
    const mkPolicy = (insuredId: string, n: string) => prisma.policy.create({ data: { agencyId: A.id, insuredId, policyNumber: `${TAG}-${n}`, status: 'ACTIVE', expirationDate: soon } as Prisma.PolicyUncheckedCreateInput });
    const gone = await prisma.insuredAccount.create({ data: { agencyId: A.id, name: `${TAG} Gone`, nameKey: `${TAG} gone`, status: 'INACTIVE' } });
    const [pAcme, pQuiet, pGone, pDirect] = [await mkPolicy(accA.id, 'R1'), await mkPolicy(quiet.id, 'R2'), await mkPolicy(gone.id, 'R3'), await mkPolicy(quiet.id, 'R4')];
    await mkTask('On an inactive account', { insuredId: gone.id });
    await mkTask('About one policy', { insuredId: quiet.id, policyId: pDirect.id });
    const renewalsFor = async (s: DeskScope) => {
      const ids = new Set((await managerDashboard(prisma, s, { renewalDays: 60 }, CTX)).renewals.map((r) => r.id));
      return [pAcme, pQuiet, pGone, pDirect].map((x) => (ids.has(x.id) ? 1 : 0)).join('');
    };
    ok('the overview works for someone who reaches books only through requests: those renewals, on active accounts', await renewalsFor(sDvo) === '1001', await renewalsFor(sDvo));
    ok('…and for an AM who is also a Pod Leader', await renewalsFor(sAmPod) === '1001', await renewalsFor(sAmPod));
    ok('…and the AM and the Director of Agency Operations: every renewal on an active account', await renewalsFor(sAm) === '1101' && await renewalsFor(sDao) === '1101');
    ok('the overview links to agency pages only for those who can open them', !(await managerDashboard(prisma, sDvo, {}, CTX)).opensAgencies && (await managerDashboard(prisma, sAm, {}, CTX)).opensAgencies);

    section('A position change never strands work');
    const holderOf = async (id: string) => prisma.task.findUniqueOrThrow({ where: { id }, select: { assigneeId: true, status: true } });
    const keeper = await person('keeper', 'DESK_VA'); await hold(keeper.id, 'VA', 'POD_LEADER');
    await prisma.podMember.create({ data: { podId: P.id, userId: keeper.id } });
    const k1 = await mkTask('Held, started', { assigneeId: keeper.id, status: 'IN_PROGRESS' });
    const k2 = await mkTask('Held, waiting', { assigneeId: keeper.id, status: 'WAITING_ON_AGENCY' });
    const r1 = await removePositionHolder(prisma, sRoot, positionIds.get('POD_LEADER')!, keeper.id, CTX);
    ok('losing one of two positions that still covers the work: nothing moves', r1.tasksReturned === 0 && (await holderOf(k1.id)).assigneeId === keeper.id);
    await addPositionHolder(prisma, sRoot, positionIds.get('AM')!, { userId: keeper.id }, CTX);
    const r2 = await removePositionHolder(prisma, sRoot, positionIds.get('VA')!, keeper.id, CTX);
    const [h1, h2] = [await holderOf(k1.id), await holderOf(k2.id)];
    ok('moved from VA to Account Manager: their pod work goes back to the queue', r2.tasksReturned === 2 && h1.assigneeId === null && h2.assigneeId === null);
    ok('…started work starts over, waiting work keeps waiting', h1.status === 'NEW' && h2.status === 'WAITING_ON_AGENCY');
    const ev = await prisma.taskEvent.findFirst({ where: { taskId: k1.id, kind: 'UNASSIGNED' } });
    ok('…and each request\'s history and the audit log say so', (ev?.metadata as Json)?.automatic === 'position_changed' && ev?.actorId === root.id
      && ((await prisma.deskAuditLog.findFirst({ where: { actorId: root.id, action: 'position.holder_removed' }, orderBy: { createdAt: 'desc' } }))?.metadata as Json)?.tasksReturned === 2);
    const solo = await prisma.deskPosition.create({ data: { code: `${TAG}_SOLO`, name: `${TAG} Solo`, department: 'VIRTUAL_OPERATIONS', reach: 'POD', permissions: ['requests.work'] } });
    const w = await person('worker', 'DESK_VA');
    await prisma.podMember.create({ data: { podId: P.id, userId: w.id } });
    const w1 = await mkTask('Worker holds', { assigneeId: w.id, status: 'ASSIGNED' });
    const w2 = await mkTask('Finished by worker', { assigneeId: w.id, status: 'COMPLETED', completedAt: new Date() });
    const other = await mkTask('Someone else holds', { assigneeId: bare.id, status: 'ASSIGNED' });
    ok('a first position that covers the same work moves nothing', (await addPositionHolder(prisma, sRoot, solo.id, { userId: w.id }, CTX)).tasksReturned === 0);
    ok('renaming a position moves nothing', (await updatePosition(prisma, sRoot, solo.id, { description: 'Renamed' }, CTX)).tasksReturned === 0 && (await holderOf(w1.id)).assigneeId === w.id);
    const r3 = await updatePosition(prisma, sRoot, solo.id, { permissions: ['messages.agency'] }, CTX);
    ok('a position that stops working requests returns its holders\' open work; finished work stays theirs', r3.tasksReturned === 1 && (await holderOf(w1.id)).assigneeId === null && (await holderOf(w2.id)).assigneeId === w.id);
    ok('other people\'s work is untouched', (await holderOf(other.id)).assigneeId === bare.id);

    section('A change applies on the next request');
    const leadPos = positionIds.get('POD_LEADER')!;
    await prisma.deskPosition.update({ where: { id: leadPos }, data: { permissions: ['requests.work'] } });
    const sLead2 = await S(lead);
    ok('Pod Leader loses "assign": they can no longer hand work out', !can(sLead2, 'requests.assign') && await status(() => assignTask(prisma, sLead2, t1.id, bare.id, CTX)) === 403);
    await prisma.deskPositionHolder.deleteMany({ where: { userId: va.id } });
    await prisma.deskPositionHolder.create({ data: { userId: va.id, positionId: positionIds.get('AM')! } });
    const sVa2 = await S(va);
    ok('a VA given the Account Manager position instead: no longer pod-bound', sVa2.kind === 'ACCOUNT_MANAGER' && can(sVa2, 'accounts.view'));
    ok('agency users are untouched', sOwner.kind === 'AGENCY' && !can(sOwner, 'requests.work' as PermissionKey));
    void tB;
  } catch (err) {
    console.error(err);
    fail++;
  } finally {
    await wipe().catch((err) => { console.error('cleanup failed', err); fail++; });
    const left = await prisma.user.count({ where: { email: { contains: TAG } } }) + await prisma.deskPosition.count({ where: { name: { startsWith: TAG } } })
      + await prisma.agency.count({ where: { name: { startsWith: TAG } } }) + await prisma.pod.count({ where: { code: { startsWith: TAG } } });
    ok('cleaned up', left === 0, String(left));
    console.log(`\n━━ ${pass} passed, ${fail} failed ━━`);
    await prisma.$disconnect();
    process.exit(fail ? 1 : 0);
  }
})();
