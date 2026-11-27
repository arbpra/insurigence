/**
 * Module 51: Virtual Operations tools. Pod Leaders hand work out in the pods
 * they lead, and see those pods' workload; the Director of Virtual Operations
 * marks who leads a pod and chooses which VAs work for an agency in a pod the
 * agency authorises.
 *
 *   npx tsx script/verify-desk-pod-leads.ts
 *
 * Temporary people on test copies of the default positions, temporary pods,
 * agencies and requests. It checks:
 *  - who may mark a Pod Leader, and who may be one;
 *  - a Pod Leader assigns, reassigns, escalates and moves work only in the
 *    pods they lead, and works the others like any member; someone with the
 *    position who leads no pod is a VA; an Account Manager who also leads a
 *    pod keeps their agencies;
 *  - the workload of the pods they lead: counts, people, list and changes
 *    stay inside them;
 *  - the Director names VAs for a pod an agency authorises, but doesn't
 *    authorise pods or take them away (agency setup does);
 *  - the queue, the sidebar, the routes and the audit log.
 *
 * Every temporary record is removed at the end.
 */
import 'dotenv/config';
import { NextRequest } from 'next/server';
import type { DeskAgencyReach, DeskDepartment, Prisma, UserRole } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { createSession } from '../lib/auth';
import { can, DeskAccessError, podLeadScope, resolveDeskScope, scopeIn, taskWhere, type DeskScope } from '../lib/desk/access';
import { DEFAULT_POSITIONS } from '../lib/desk/permission-catalogue';
import { itemAllowed, navAccess, navFor } from '../lib/desk/navigation';
import { getAgencyPodAccess, listPods, setAgencyPodAccess, setPodLead } from '../lib/desk/pod-admin';
import { removeTaskDocument, type DocumentStore } from '../lib/desk/task-documents';
import { getTaskDetail, setTaskAssignee, setTaskEscalation, setTaskPod } from '../lib/desk/task-api';
import { assigneesFor, queueOptions } from '../lib/desk/task-queue';
import { changeWorkload, getWorkload } from '../lib/desk/workload';
import { GET as workloadRoute } from '../app/api/desk/workload/route';
import { POST as bulkRoute } from '../app/api/desk/workload/bulk/route';
import { PATCH as podRoute } from '../app/api/desk/admin/pods/[id]/route';
import { PUT as podAccessRoute } from '../app/api/desk/admin/agencies/[id]/pod-access/route';

process.env.DESK_EMAIL_NOTIFICATIONS = 'off';

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, detail: unknown = '') => {
  c ? pass++ : fail++;
  console.log(`  ${c ? '✓' : '✗'} ${n}${!c && detail !== '' ? `  ${JSON.stringify(detail)}` : ''}`);
};
const section = (s: string) => console.log(`\n${s}`);

const TAG = `m51test${Date.now()}`;
const CTX = { ip: '203.0.113.51', userAgent: 'verify-desk-pod-leads' };
const cleanup = { agencyIds: [] as string[], userIds: [] as string[], podIds: [] as string[] };

async function wipe() {
  const agencyId = { in: cleanup.agencyIds };
  const userId = { in: cleanup.userIds };
  const podId = { in: cleanup.podIds };
  const positions = (await prisma.deskPosition.findMany({ where: { code: { startsWith: TAG } }, select: { id: true } })).map((p) => p.id);
  await prisma.taskDocument.deleteMany({ where: { agencyId } });
  await prisma.taskEvent.deleteMany({ where: { agencyId } });
  await prisma.task.deleteMany({ where: { agencyId } });
  await prisma.agencyPodAccess.deleteMany({ where: { OR: [{ agencyId }, { podId }] } });
  await prisma.agencyDeskAssignment.deleteMany({ where: { agencyId } });
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

(async () => {
  try {
    const mkAgency = async (n: string) => {
      const a = await prisma.agency.create({ data: { name: `${TAG} ${n}`, deskEnabled: true } });
      cleanup.agencyIds.push(a.id);
      return a;
    };
    const A = await mkAgency('Alpha'), B = await mkAgency('Beta');
    const mkPod = async (n: string) => {
      const p = await prisma.pod.create({ data: { code: `${TAG}_${n}`, name: `${TAG} ${n}`, sortOrder: 900 } });
      cleanup.podIds.push(p.id);
      return p;
    };
    const P = await mkPod('Service'), Q = await mkPod('Renewals'), Z = await mkPod('Spare');

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
    const lead = await person('lead', 'DESK_VA'); await hold(lead.id, 'POD_LEADER');
    const idle = await person('idle', 'DESK_VA'); await hold(idle.id, 'POD_LEADER'); // the position, but leads no pod
    const amLead = await person('amlead', 'ACCOUNT_MANAGER'); await hold(amLead.id, 'AM', 'POD_LEADER');
    const am = await person('am', 'ACCOUNT_MANAGER'); await hold(am.id, 'AM');
    const va1 = await person('va1', 'DESK_VA'); await hold(va1.id, 'VA');
    const va2 = await person('va2', 'DESK_VA'); await hold(va2.id, 'VA');
    const qOnly = await person('qonly', 'DESK_VA'); await hold(qOnly.id, 'VA');
    const owner = await person('owner', 'ADMIN', A.id);

    const member = (podId: string, userId: string) => prisma.podMember.create({ data: { podId, userId } });
    for (const u of [lead, idle, amLead, va1, va2]) await member(P.id, u.id);
    for (const u of [lead, amLead, va1, qOnly]) await member(Q.id, u.id);
    await member(Z.id, va1.id);
    // Alpha authorises the Service and Renewals pods; Beta (amLead's own agency) the Service pod.
    await prisma.agencyPodAccess.createMany({ data: [{ agencyId: A.id, podId: P.id }, { agencyId: A.id, podId: Q.id }, { agencyId: B.id, podId: P.id }] });
    await prisma.agencyDeskAssignment.create({ data: { agencyId: A.id, primaryAmId: am.id } });
    await prisma.agencyDeskAssignment.create({ data: { agencyId: B.id, primaryAmId: amLead.id } });

    const base = 950_000_000 + (Date.now() % 29_000_000);
    let n = 0;
    const mkTask = (title: string, data: Partial<Prisma.TaskUncheckedCreateInput> = {}) => {
      n += 1;
      return prisma.task.create({ data: {
        reference: base + n, agencyId: A.id, type: 'DOCUMENT_UPLOAD', title: `${TAG} ${title}`, amId: am.id,
        createdById: owner.id, restrictedToUserIds: [], podId: P.id, status: 'NEW', ...data,
      } });
    };
    const tP = await mkTask('Service work');
    const tP2 = await mkTask('More service work');
    const tQ = await mkTask('Renewal work', { podId: Q.id });
    const tB = await mkTask('Beta service work', { agencyId: B.id, amId: amLead.id });
    const tBnone = await mkTask('Beta, no pod yet', { agencyId: B.id, amId: amLead.id, podId: null });
    const S = (u: { id: string }) => resolveDeskScope(prisma, u.id);
    const sees = async (s: DeskScope, id: string) => (await prisma.task.count({ where: { AND: [{ id }, taskWhere(s)] } })) === 1;

    section('Leading a pod');
    {
      const [sDvo, sLead, sAm, sCoo] = await Promise.all([S(dvo), S(lead), S(am), S(coo)]);
      ok('before: the Pod Leader leads nothing, so their position hands nothing out', sLead.kind === 'VA' && sLead.leads.length === 0 && !can(sLead, 'requests.assign') && !can(sLead, 'requests.escalate') && !can(sLead, 'workload.view') && can(sLead, 'requests.work'));
      ok('an Account Manager can\'t mark a Pod Leader', await status(() => setPodLead(prisma, sAm, P.id, { userId: lead.id, isLead: true }, CTX)) === 403);
      ok('…nor can the Pod Leader mark themselves', await status(() => setPodLead(prisma, sLead, P.id, { userId: lead.id, isLead: true }, CTX)) === 403);
      ok('a VA can\'t lead a pod (their position hands nothing out)', await status(() => setPodLead(prisma, sDvo, P.id, { userId: va1.id, isLead: true }, CTX)) === 400);
      ok('only a member leads', await status(() => setPodLead(prisma, sDvo, Z.id, { userId: lead.id, isLead: true }, CTX)) === 400);
      ok('isLead must be true or false', await status(() => setPodLead(prisma, sDvo, P.id, { userId: lead.id, isLead: 'yes' }, CTX)) === 400);
      ok('the Director of Virtual Operations marks the Pod Leader', await status(() => setPodLead(prisma, sDvo, P.id, { userId: lead.id, isLead: true }, CTX)) === 200);
      ok('…and the COO an Account Manager who also leads', await status(() => setPodLead(prisma, sCoo, P.id, { userId: amLead.id, isLead: true }, CTX)) === 200);
      const entry = await prisma.deskAuditLog.findFirst({ where: { actorId: dvo.id, action: 'pod.lead_changed', entityId: P.id } });
      ok('…recorded in the audit log', (entry?.metadata as Json)?.userId === lead.id && (entry?.metadata as Json)?.isLead === true);
      const pods = await listPods(prisma, sDvo);
      const members = pods.pods.find((p) => p.id === P.id)!.members;
      const m = (id: string) => members.find((x) => x.id === id)!;
      ok('the Pods page shows who leads, and who could', m(lead.id).isLead && m(amLead.id).isLead && !m(idle.id).isLead && m(idle.id).canLead && !m(va1.id).canLead);
      ok('…leaders listed first', members[0].isLead && members[1].isLead);
      const sLead2 = await S(lead);
      ok('after: they lead the Service pod, and their position applies there', sLead2.kind === 'VA' && sLead2.leads.join() === P.id && can(sLead2, 'requests.assign') && can(sLead2, 'workload.view'));
      ok('a pod switched off isn\'t led', await (async () => {
        await prisma.pod.update({ where: { id: P.id }, data: { isActive: false } });
        const off = await S(lead);
        await prisma.pod.update({ where: { id: P.id }, data: { isActive: true } });
        return off.kind === 'VA' && off.leads.length === 0 && !can(off, 'requests.assign');
      })());
      ok('…and nobody is made its leader while it is off', await (async () => {
        await prisma.pod.update({ where: { id: P.id }, data: { isActive: false } });
        const r = await status(() => setPodLead(prisma, sDvo, P.id, { userId: idle.id, isLead: true }, CTX));
        await prisma.pod.update({ where: { id: P.id }, data: { isActive: true } });
        return r === 409;
      })());
      // Marked as leader directly (as the demo data does) without a position that hands work out: nothing more.
      await prisma.podMember.updateMany({ where: { podId: P.id, userId: va2.id }, data: { isLead: true } });
      const sVa2 = await S(va2);
      ok('a VA marked as leader without the position gets nothing more', sVa2.kind === 'VA' && !can(sVa2, 'requests.assign') && !can(sVa2, 'workload.view') && podLeadScope(sVa2) !== null && !can(podLeadScope(sVa2)!, 'workload.view'));
      ok('…no workload', await status(() => getWorkload(prisma, sVa2, {})) === 403);
      const tVa2 = await createSession(va2.id);
      const deniedVa2 = () => prisma.deskAuditLog.count({ where: { actorId: va2.id, action: 'access.denied', entityType: 'DeskSetup' } });
      const dv2 = await deniedVa2();
      ok('…nor through the route, which logs the refusal', (await workloadRoute(new NextRequest('http://localhost/api/desk/workload', { headers: { cookie: `session_token=${tVa2}` } }))).status === 403 && (await deniedVa2()) === dv2 + 1);
      ok('…nor in the sidebar', !navFor('OPS', navAccess(sVa2)).some((i) => i.label === 'Workload'));
      await prisma.podMember.updateMany({ where: { podId: P.id, userId: va2.id }, data: { isLead: false } });
    }

    section('A Pod Leader hands work out in the pods they lead, and only there');
    {
      const [sLead, sIdle] = await Promise.all([S(lead), S(idle)]);
      ok('they see both pods\' work (leading changes what they may do, not what they see)', await sees(sLead, tP.id) && await sees(sLead, tQ.id));
      ok('someone with the position who leads no pod sees the same work', await sees(sIdle, tP.id));
      ok('in the pod they lead: assign', await status(() => setTaskAssignee(prisma, sLead, tP.id, { assigneeId: va1.id }, CTX)) === 200);
      ok('…reassign', await status(() => setTaskAssignee(prisma, sLead, tP.id, { assigneeId: va2.id }, CTX)) === 200);
      ok('…escalate', await status(() => setTaskEscalation(prisma, sLead, tP.id, { escalate: true, reason: 'Waiting on the carrier' }, CTX)) === 200);
      ok('…and see who can take it', await status(() => assigneesFor(prisma, sLead, tP.id, CTX)) === 200);
      ok('in a pod they don\'t lead: no assigning', await status(() => setTaskAssignee(prisma, sLead, tQ.id, { assigneeId: va1.id }, CTX)) === 403);
      ok('…no escalating', await status(() => setTaskEscalation(prisma, sLead, tQ.id, { escalate: true, reason: 'x' }, CTX)) === 403);
      ok('…no list of who can take it', await status(() => assigneesFor(prisma, sLead, tQ.id, CTX)) === 403);
      ok('…but they pick it up, and let it go, like any member', await status(() => setTaskAssignee(prisma, sLead, tQ.id, { assigneeId: lead.id }, CTX)) === 200
        && await status(() => setTaskAssignee(prisma, sLead, tQ.id, { assigneeId: null }, CTX)) === 200);
      ok('…and each refusal is logged', (await prisma.deskAuditLog.count({ where: { actorId: lead.id, action: 'access.denied', entityId: tQ.id } })) >= 2);
      const perms = async (id: string) => ((await getTaskDetail(prisma, sLead, id, CTX)) as Json).permissions;
      const [pP, pQ] = [await perms(tP.id), await perms(tQ.id)];
      ok('the workspace offers handing out where they lead', pP.assign && pP.escalate && pP.movePod && !pP.pickUp);
      ok('…and picking up where they don\'t', !pQ.assign && !pQ.escalate && !pQ.movePod && pQ.pickUp);
      // Files: someone who hands work out removes anyone's; a member, only their own.
      const mkDoc = (taskId: string, n: string) => prisma.taskDocument.create({ data: { taskId, agencyId: A.id, storageKey: `desk/${TAG}/${n}`, fileName: `${n}.pdf`, fileSize: 1000, contentType: 'application/pdf', visibility: 'INTERNAL', sensitivity: 'GENERAL', uploadedById: am.id } });
      const [docP, docQ] = [await mkDoc(tP.id, 'p'), await mkDoc(tQ.id, 'q')];
      const removable = async (taskId: string, docId: string) => (((await getTaskDetail(prisma, sLead, taskId, CTX)) as Json).documents as Json[]).find((d) => d.id === docId)?.canRemove;
      ok('files: they may remove someone else\'s where they lead, not where they don\'t', await removable(tP.id, docP.id) === true && await removable(tQ.id, docQ.id) === false);
      const store: DocumentStore = { configured: () => true, put: async () => {}, link: async () => '', remove: async () => {} };
      ok('…and the server agrees', await status(() => removeTaskDocument(prisma, sLead, docQ.id, CTX, store)) === 403 && await status(() => removeTaskDocument(prisma, sLead, docP.id, CTX, store)) === 200);
      ok('moving work to a pod they don\'t lead: refused', await status(() => setTaskPod(prisma, sLead, tP2.id, { podId: Q.id }, CTX)) === 403);
      ok('…nor out of one', await status(() => setTaskPod(prisma, sLead, tQ.id, { podId: P.id }, CTX)) === 403);
      await setPodLead(prisma, await S(dvo), Q.id, { userId: lead.id, isLead: true }, CTX);
      ok('leading both, they move work between them', await status(async () => setTaskPod(prisma, await S(lead), tP2.id, { podId: Q.id }, CTX)) === 200
        && await status(async () => setTaskPod(prisma, await S(lead), tP2.id, { podId: P.id }, CTX)) === 200);
      ok('…but never to a pod they don\'t lead', await status(async () => setTaskPod(prisma, await S(lead), tP2.id, { podId: Z.id }, CTX)) === 403);
      await setPodLead(prisma, await S(dvo), Q.id, { userId: lead.id, isLead: false }, CTX);
      ok('without the position\'s pod to lead: nothing handed out anywhere', await status(() => setTaskAssignee(prisma, sIdle, tP2.id, { assigneeId: va1.id }, CTX)) === 403
        && await status(() => setTaskEscalation(prisma, sIdle, tP2.id, { escalate: true, reason: 'x' }, CTX)) === 403);
      const q = await queueOptions(prisma, sLead, CTX) as Json;
      ok('the queue says where they hand work out', q.canAssign === true && q.assignIn?.pods?.join() === P.id && q.assignIn?.agencies?.length === 0);
      ok('…and someone who leads nothing assigns nowhere', (await queueOptions(prisma, sIdle, CTX) as Json).canAssign === false);
      const sAmLead = await S(amLead);
      ok('an AM who also leads: their own agency, whatever the pod', sAmLead.kind === 'ACCOUNT_MANAGER' && await status(() => setTaskAssignee(prisma, sAmLead, tBnone.id, { assigneeId: amLead.id }, CTX)) === 200);
      ok('…in another agency, the pod they lead', await status(() => setTaskAssignee(prisma, sAmLead, tP2.id, { assigneeId: va1.id }, CTX)) === 200);
      ok('…but not a pod they only belong to', await status(() => setTaskAssignee(prisma, sAmLead, tQ.id, { assigneeId: va1.id }, CTX)) === 403);
      const qa = await queueOptions(prisma, sAmLead, CTX) as Json;
      ok('…and the queue says so', qa.assignIn?.agencies?.join() === B.id && qa.assignIn?.pods?.join() === P.id);
      ok('…narrowing twice gives nothing back in a pod they don\'t lead', !can(scopeIn(scopeIn(sAmLead, A.id, Q.id), A.id), 'requests.assign') && can(scopeIn(scopeIn(sAmLead, A.id, P.id), A.id), 'requests.assign'));
      const sorted = (p: Iterable<string>) => [...p].sort().join();
      const asLead = podLeadScope(sAmLead);
      ok('…as a Pod Leader they act with the Pod Leader\'s permissions, not their own', sAmLead.kind === 'ACCOUNT_MANAGER' && asLead !== null && sorted(asLead.permissions) === sorted(sAmLead.pod.permissions)
        && can(sAmLead, 'requests.restrict') && !can(asLead, 'requests.restrict'));
      ok('…and so does the sidebar', sAmLead.kind === 'ACCOUNT_MANAGER' && sorted(navAccess(sAmLead).leadPermissions ?? []) === sorted(sAmLead.pod.permissions));
      await setPodLead(prisma, await S(dvo), P.id, { userId: lead.id, isLead: false }, CTX);
      const sAfter = await S(lead);
      ok('once they stop leading, the position hands nothing out', !can(sAfter, 'requests.assign') && await status(() => setTaskAssignee(prisma, sAfter, tP.id, { assigneeId: va1.id }, CTX)) === 403);
      ok('…and the work they handed out stays where it is', (await prisma.task.findUniqueOrThrow({ where: { id: tP.id } })).assigneeId === va2.id);
      await setPodLead(prisma, await S(dvo), P.id, { userId: lead.id, isLead: true }, CTX);
    }

    section('The workload of the pods they lead');
    {
      const [sLead, sIdle, sVa, sAmLead, sCoo] = await Promise.all([S(lead), S(idle), S(va1), S(amLead), S(coo)]);
      const wl = await getWorkload(prisma, sLead, {}) as Json;
      const rows = (wl.list.rows as Json[]).map((r) => r.id);
      ok('only the pods they lead', wl.reach === 'LED_PODS' && wl.pods.length === 1 && wl.pods[0].id === P.id);
      ok('…their open work, in every agency that authorises the pod', rows.includes(tP.id) && rows.includes(tP2.id) && rows.includes(tB.id) && wl.total.open === 3);
      ok('…not the other pod\'s, nor work with no pod', !rows.includes(tQ.id) && !rows.includes(tBnone.id));
      const people = (wl.people as Json[]).map((p) => p.id);
      ok('…the pod\'s people, not someone only in the other pod', people.includes(va1.id) && people.includes(va2.id) && !people.includes(qOnly.id));
      ok('…and no alert-check details (those are for oversight)', wl.alertCheck === null);
      ok('asking for the other pod shows nothing', ((await getWorkload(prisma, sLead, { podId: Q.id })) as Json).list.total === 0);
      ok('someone who leads no pod: refused', await status(() => getWorkload(prisma, sIdle, {})) === 403);
      ok('…and a VA', await status(() => getWorkload(prisma, sVa, {})) === 403);
      const wa = await getWorkload(prisma, sAmLead, {}) as Json;
      const waRows = (wa.list.rows as Json[]).map((r) => r.id);
      ok('an AM who also leads: their pod\'s work, not their agency\'s other work', wa.reach === 'LED_PODS' && waRows.includes(tP.id) && waRows.includes(tB.id) && !waRows.includes(tBnone.id) && !waRows.includes(tQ.id));
      const all = await getWorkload(prisma, sCoo, {}) as Json;
      ok('the COO still sees everything, alert check included', all.reach === 'ALL' && all.alertCheck !== null && all.pods.length > 1);
      const bulk = await changeWorkload(prisma, sLead, { taskIds: [tP.id, tQ.id], assigneeId: va1.id }, CTX);
      ok('a change to several: done in their pod', bulk.done.map((d) => d.id).join() === tP.id);
      ok('…refused outside it, without its reference', bulk.failed.length === 1 && bulk.failed[0].id === tQ.id && bulk.failed[0].reference === null);
      ok('…and nothing changed there', (await prisma.task.findUniqueOrThrow({ where: { id: tQ.id } })).assigneeId === null);
      ok('moving several to another pod: only to one they lead', (await changeWorkload(prisma, sLead, { taskIds: [tP2.id], podId: Q.id }, CTX)).failed.length === 1);
      ok('someone who leads no pod can\'t change several', await status(() => changeWorkload(prisma, sIdle, { taskIds: [tP.id], assigneeId: va1.id }, CTX)) === 403);
    }

    section('The Director names VAs within authorised agencies');
    {
      const [sDvo, sDao] = await Promise.all([S(dvo), S(dao)]);
      const view = await getAgencyPodAccess(prisma, sDvo, A.id);
      ok('they may name VAs, not authorise pods', view.canChange === false && view.canName === true);
      ok('…an Account Manager neither', await status(async () => getAgencyPodAccess(prisma, await S(am), A.id)) === 403);
      const before = (await prisma.task.findUniqueOrThrow({ where: { id: tP.id } })).assigneeId;
      const r = await setAgencyPodAccess(prisma, sDvo, A.id, { podId: P.id, mode: 'NAMED', userIds: [va2.id] }, CTX);
      ok('naming VAs in a pod the agency authorises', (await getAgencyPodAccess(prisma, sDvo, A.id)).pods.find((p) => p.id === P.id)?.mode === 'NAMED');
      ok('…work held by someone no longer named goes back to the queue', before === va1.id && r.tasksReturned === 2
        && (await prisma.task.findUniqueOrThrow({ where: { id: tP.id } })).assigneeId === null && (await prisma.task.findUniqueOrThrow({ where: { id: tP2.id } })).assigneeId === null);
      ok('…the VA no longer named sees none of the agency\'s work in that pod', !(await sees(await S(va1), tP.id)) && await sees(await S(va2), tP.id));
      ok('…recorded', (await prisma.deskAuditLog.count({ where: { actorId: dvo.id, action: 'pod.access_changed', agencyId: A.id } })) === 1);
      ok('back to the whole pod', await status(() => setAgencyPodAccess(prisma, sDvo, A.id, { podId: P.id, mode: 'WHOLE' }, CTX)) === 200);
      const denied = () => prisma.deskAuditLog.count({ where: { actorId: dvo.id, action: 'access.denied', agencyId: A.id } });
      const d0 = await denied();
      ok('authorising a new pod for the agency: refused', await status(() => setAgencyPodAccess(prisma, sDvo, A.id, { podId: Z.id, mode: 'WHOLE' }, CTX)) === 403);
      ok('…or naming VAs in a pod it doesn\'t authorise', await status(() => setAgencyPodAccess(prisma, sDvo, A.id, { podId: Z.id, mode: 'NAMED', userIds: [va1.id] }, CTX)) === 403);
      ok('…taking a pod away: refused', await status(() => setAgencyPodAccess(prisma, sDvo, A.id, { podId: Q.id, mode: 'NONE' }, CTX)) === 403);
      ok('…each logged', (await denied()) === d0 + 3);
      ok('…and nothing changed', (await prisma.agencyPodAccess.count({ where: { agencyId: A.id } })) === 2);
      ok('agency setup still authorises and removes pods', await status(() => setAgencyPodAccess(prisma, sDao, A.id, { podId: Z.id, mode: 'WHOLE' }, CTX)) === 200
        && await status(() => setAgencyPodAccess(prisma, sDao, A.id, { podId: Z.id, mode: 'NONE' }, CTX)) === 200);
    }

    section('The sidebar and the routes');
    {
      const [sLead, sIdle, sVa, sAmLead, sCoo, sAm] = await Promise.all([S(lead), S(idle), S(va1), S(amLead), S(coo), S(am)]);
      const labels = (s: DeskScope) => navFor('OPS', navAccess(s)).map((i) => i.label);
      ok('the Workload for a Pod Leader who leads', labels(sLead).includes('Workload') && itemAllowed('/desk-ops/workload', navAccess(sLead)));
      ok('…and an AM who also leads', labels(sAmLead).includes('Workload'));
      ok('…not for someone who leads no pod, a VA or an Account Manager', !labels(sIdle).includes('Workload') && !labels(sVa).includes('Workload') && !labels(sAm).includes('Workload') && !itemAllowed('/desk-ops/workload', navAccess(sIdle)));
      ok('…still for the COO', labels(sCoo).includes('Workload'));
      const tok = (u: { id: string }) => createSession(u.id);
      const req = (path: string, method: string, token: string | null, body?: unknown) => new NextRequest(`http://localhost${path}`, {
        method, headers: { 'Content-Type': 'application/json', ...(token ? { cookie: `session_token=${token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}),
      });
      const [tLead, tIdle, tDvo, tVa] = await Promise.all([tok(lead), tok(idle), tok(dvo), tok(va1)]);
      const page = await workloadRoute(req('/api/desk/workload', 'GET', tLead));
      ok('workload: 200 for the Pod Leader, their pods only', page.status === 200 && ((await page.json()) as Json).reach === 'LED_PODS');
      const deniedIdle = () => prisma.deskAuditLog.count({ where: { actorId: idle.id, action: 'access.denied', entityType: 'DeskSetup' } });
      const di = await deniedIdle();
      ok('…403 for someone who leads no pod, and logged', (await workloadRoute(req('/api/desk/workload', 'GET', tIdle))).status === 403 && (await deniedIdle()) === di + 1);
      ok('…403 for a VA', (await workloadRoute(req('/api/desk/workload', 'GET', tVa))).status === 403);
      ok('…401 signed out', (await workloadRoute(req('/api/desk/workload', 'GET', null))).status === 401);
      const b = await bulkRoute(req('/api/desk/workload/bulk', 'POST', tLead, { taskIds: [tQ.id], assigneeId: va1.id }));
      ok('bulk: the Pod Leader is let in, and refused per task outside their pods', b.status === 200 && ((await b.json()) as Json).failed.length === 1);
      ok('…403 for someone who leads no pod', (await bulkRoute(req('/api/desk/workload/bulk', 'POST', tIdle, { taskIds: [tP.id], assigneeId: va1.id }))).status === 403);
      const p = (id: string) => ({ params: Promise.resolve({ id }) });
      ok('pods: the Director marks a leader (200)', (await podRoute(req(`/api/desk/admin/pods/${P.id}`, 'PATCH', tDvo, { action: 'setLead', userId: idle.id, isLead: true }), p(P.id))).status === 200);
      ok('…and unmarks (200)', (await podRoute(req(`/api/desk/admin/pods/${P.id}`, 'PATCH', tDvo, { action: 'setLead', userId: idle.id, isLead: false }), p(P.id))).status === 200);
      ok('…a Pod Leader can\'t (403)', (await podRoute(req(`/api/desk/admin/pods/${P.id}`, 'PATCH', tLead, { action: 'setLead', userId: lead.id, isLead: true }), p(P.id))).status === 403);
      ok('agency pod access: the Director names VAs (200)', (await podAccessRoute(req(`/api/desk/admin/agencies/${A.id}/pod-access`, 'PUT', tDvo, { podId: Q.id, mode: 'NAMED', userIds: [qOnly.id] }), p(A.id))).status === 200);
      ok('…but can\'t authorise a pod (403)', (await podAccessRoute(req(`/api/desk/admin/agencies/${A.id}/pod-access`, 'PUT', tDvo, { podId: Z.id, mode: 'WHOLE' }), p(A.id))).status === 403);
      ok('…nor can a Pod Leader (403)', (await podAccessRoute(req(`/api/desk/admin/agencies/${A.id}/pod-access`, 'PUT', tLead, { podId: Q.id, mode: 'WHOLE' }), p(A.id))).status === 403);
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
      + await prisma.agencyPodAccess.count({ where: { OR: [{ podId: { in: cleanup.podIds } }, { agencyId: { in: cleanup.agencyIds } }] } })
      + await prisma.task.count({ where: { agencyId: { in: cleanup.agencyIds } } })
      + await prisma.deskPosition.count({ where: { code: { startsWith: TAG } } })
      + await prisma.deskAuditLog.count({ where: { OR: [{ actorId: { in: cleanup.userIds } }, { agencyId: { in: cleanup.agencyIds } }, { entityId: { in: [...cleanup.userIds, ...cleanup.podIds] } }] } })
      + await prisma.deskNotification.count({ where: { recipientId: { in: cleanup.userIds } } });
    ok('temporary records removed, audit entries included', left === 0, left);
    console.log(`\n${pass} passed, ${fail} failed`);
    await prisma.$disconnect();
    process.exit(fail ? 1 : 0);
  }
})();
