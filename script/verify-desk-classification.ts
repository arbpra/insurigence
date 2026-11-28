/**
 * Module 53: account and request classification.
 *
 * Small Commercial, Middle-Market or Complex / Custom on the account, and per
 * request; the Account Manager sets it; the Senior AM, the Director of Agency
 * Operations and the COO override it, with a reason; VAs and Pod Leaders only
 * flag it. Checked on temporary records in the live database:
 *  - who may set, override and flag, and the permissions' defaults;
 *  - the account: set, overridden (reason required), its history, stale
 *    changes refused, refusals logged, other agencies out of reach;
 *  - a request: its own classification, back to the account's, subtasks and
 *    closed requests refused, the internal history;
 *  - flags: raised, one at a time, settled by a change or dismissed by
 *    someone who may make the change; the Agency Operations count;
 *  - agency users see none of it; reasons stay out of the audit log;
 *  - the routes; nothing left behind.
 */
import 'dotenv/config';
import { NextRequest } from 'next/server';
import type { DeskAgencyReach, DeskDepartment, Prisma, UserRole } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { createSession } from '../lib/auth';
import { DeskAccessError, resolveDeskScope } from '../lib/desk/access';
import { getInsuredOverview } from '../lib/desk/book';
import { classRights, classifyAccount, dismissClassificationFlag, flagClassification, taskClassification } from '../lib/desk/classification';
import { mayChange } from '../lib/desk/classification-view';
import { getDashboards } from '../lib/desk/dashboards';
import { DEFAULT_POSITIONS, PERMISSION_ADDITIONS } from '../lib/desk/permission-catalogue';
import { getTaskDetail } from '../lib/desk/task-api';
import { reviewTask } from '../lib/desk/tasks';
import { eventLines, eventTitle } from '../lib/desk/task-workspace';
import { POST as accountRoute } from '../app/api/desk/insureds/[id]/classification/route';
import { DELETE as unflagRoute, POST as flagRoute } from '../app/api/desk/tasks/[id]/classification/route';
import { POST as reviewRoute } from '../app/api/desk/tasks/[id]/review/route';

process.env.DESK_EMAIL_NOTIFICATIONS = 'off';

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, detail: unknown = '') => {
  c ? pass++ : fail++;
  console.log(`  ${c ? '✓' : '✗'} ${n}${!c && detail !== '' ? `  ${JSON.stringify(detail)}` : ''}`);
};
const section = (s: string) => console.log(`\n${s}`);

const TAG = `m53test${Date.now()}`;
const CTX = { ip: '203.0.113.53', userAgent: 'verify-desk-classification' };
const cleanup = { agencyIds: [] as string[], userIds: [] as string[], podIds: [] as string[] };

async function wipe() {
  const agencyId = { in: cleanup.agencyIds };
  const userId = { in: cleanup.userIds };
  const podId = { in: cleanup.podIds };
  const positions = (await prisma.deskPosition.findMany({ where: { code: { startsWith: TAG } }, select: { id: true } })).map((p) => p.id);
  await prisma.classificationFlag.deleteMany({ where: { agencyId } });
  await prisma.accountClassificationChange.deleteMany({ where: { agencyId } });
  await prisma.accountClassification.deleteMany({ where: { agencyId } });
  await prisma.taskEvent.deleteMany({ where: { agencyId } });
  await prisma.task.deleteMany({ where: { agencyId, parentTaskId: { not: null } } }); // subtasks before their requests
  await prisma.task.deleteMany({ where: { agencyId } });
  await prisma.insuredAccount.deleteMany({ where: { agencyId } });
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

(async () => {
  try {
    const mkAgency = async (n: string) => {
      const a = await prisma.agency.create({ data: { name: `${TAG} ${n}`, deskEnabled: true } });
      cleanup.agencyIds.push(a.id);
      return a;
    };
    const A = await mkAgency('Alpha'), B = await mkAgency('Beta');
    const P = await prisma.pod.create({ data: { code: `${TAG}_P`, name: `${TAG} Service`, sortOrder: 900 } });
    cleanup.podIds.push(P.id);

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
    const va = await person('va', 'DESK_VA'); await hold(va.id, 'VA');
    const owner = await person('owner', 'ADMIN', A.id);
    await prisma.deskReportingLine.create({ data: { userId: am1.id, managerId: sam.id } });
    await prisma.podMember.create({ data: { podId: P.id, userId: lead.id, isLead: true } });
    await prisma.podMember.create({ data: { podId: P.id, userId: va.id } });
    await prisma.agencyPodAccess.create({ data: { agencyId: A.id, podId: P.id } });
    await prisma.agencyDeskAssignment.create({ data: { agencyId: A.id, primaryAmId: am1.id } });
    await prisma.agencyDeskAssignment.create({ data: { agencyId: B.id, primaryAmId: am2.id } });

    const acct = await prisma.insuredAccount.create({ data: { agencyId: A.id, name: `${TAG} Acme Trucking`, nameKey: `${TAG.toLowerCase()} acme trucking` } });
    const acctB = await prisma.insuredAccount.create({ data: { agencyId: B.id, name: `${TAG} Beta Co`, nameKey: `${TAG.toLowerCase()} beta co` } });
    const base = 970_000_000 + (Date.now() % 9_000_000);
    let n = 0;
    const mkTask = (title: string, data: Partial<Prisma.TaskUncheckedCreateInput> = {}) => {
      n += 1;
      return prisma.task.create({ data: {
        reference: base + n, agencyId: A.id, type: 'DOCUMENT_UPLOAD', title: `${TAG} ${title}`, amId: am1.id,
        createdById: owner.id, restrictedToUserIds: [], podId: P.id, status: 'IN_PROGRESS', assigneeId: va.id, insuredId: acct.id, ...data,
      } });
    };
    const t1 = await mkTask('on the account');
    const t2 = await mkTask('no account', { insuredId: null });
    const tDone = await mkTask('completed', { status: 'COMPLETED', completedAt: new Date() });
    const sub = await mkTask('a subtask', { parentTaskId: t1.id });
    const S = (u: { id: string }) => resolveDeskScope(prisma, u.id);
    const [sCoo, sDvo, sDao, sSam, sAm1, sAm2, sLead, sVa, sOwner] = await Promise.all([coo, dvo, dao, sam, am1, am2, lead, va, owner].map(S));
    const denied = (u: { id: string }) => prisma.deskAuditLog.count({ where: { actorId: u.id, action: 'access.denied' } });
    const reload = (id: string) => prisma.task.findUniqueOrThrow({ where: { id } });

    section('Who may set, override and flag');
    {
      const has = (code: string, key: string) => !!DEFAULT_POSITIONS.find((p) => p.code === code)?.permissions.includes(key as never);
      const holders = (key: string) => DEFAULT_POSITIONS.filter((p) => p.permissions.includes(key as never)).map((p) => p.code).join();
      ok('set: the COO, the Director of Agency Operations, the Senior AM and the AM', holders('classification.set') === 'COO,DIRECTOR_AGENCY_OPS,SENIOR_AM,AM', holders('classification.set'));
      ok('override: the COO, the Director of Agency Operations and the Senior AM, not the AM', holders('classification.override') === 'COO,DIRECTOR_AGENCY_OPS,SENIOR_AM', holders('classification.override'));
      ok('flag: every position (a flag changes nothing)', DEFAULT_POSITIONS.every((p) => has(p.code, 'classification.flag')));
      ok('VAs and Pod Leaders only flag', !['VA', 'POD_LEADER', 'DIRECTOR_VIRTUAL_OPS'].some((c) => has(c, 'classification.set') || has(c, 'classification.override')));
      const add = (key: string) => PERMISSION_ADDITIONS.find((a) => a.key === key && a.module === 53)?.codes.join();
      ok('existing positions get them once, the same way', add('classification.set') === 'COO,DIRECTOR_AGENCY_OPS,SENIOR_AM,AM' && add('classification.override') === 'COO,DIRECTOR_AGENCY_OPS,SENIOR_AM'
        && add('classification.flag') === 'COO,DIRECTOR_VIRTUAL_OPS,POD_LEADER,VA,DIRECTOR_AGENCY_OPS,SENIOR_AM,AM');
      const r = (s: typeof sAm1, podId?: string) => classRights(s, A.id, podId);
      ok('in the agency: the AM sets, the Senior AM overrides, the Pod Leader and the VA flag, the agency nothing', r(sAm1).set && !r(sAm1).override && r(sSam).override
        && r(sLead, P.id).flag && !r(sLead, P.id).set && r(sVa, P.id).flag && !r(sVa, P.id).set && !r(sOwner).set && !r(sOwner).flag);
      ok('once set, only those who override may change it', mayChange(r(sAm1), null) && !mayChange(r(sAm1), 'SMALL_COMMERCIAL') && mayChange(r(sSam), 'SMALL_COMMERCIAL'));
    }

    section('The account');
    {
      ok('not classified to begin with', (await getInsuredOverview(prisma, sAm1, acct.id, CTX) as Json).classification.serviceClass === null);
      const c1 = await classifyAccount(prisma, sAm1, acct.id, { serviceClass: 'SMALL_COMMERCIAL' }, CTX) as Json;
      ok('the AM sets it, no reason needed the first time', c1.serviceClass === 'SMALL_COMMERCIAL' && c1.setBy === `${TAG} am1` && c1.history.length === 1 && c1.history[0].from === null);
      const a1 = await prisma.deskAuditLog.findFirst({ where: { action: 'insured.classified', entityId: acct.id }, orderBy: { createdAt: 'desc' } });
      ok('…audited: from, to, not an override', (a1?.metadata as Json)?.from === null && (a1?.metadata as Json)?.to === 'SMALL_COMMERCIAL' && (a1?.metadata as Json)?.override === false);
      ok('…and now it\'s for someone who overrides', !c1.can.change);
      const d0 = await denied(am1);
      ok('the AM can\'t change it, refused and logged', await status(() => classifyAccount(prisma, sAm1, acct.id, { serviceClass: 'MIDDLE_MARKET', reason: 'bigger' }, CTX)) === 403 && (await denied(am1)) === d0 + 1);
      ok('an override needs a reason', await status(() => classifyAccount(prisma, sSam, acct.id, { serviceClass: 'MIDDLE_MARKET' }, CTX)) === 400);
      ok('…nothing changed or an unknown class is refused', await status(() => classifyAccount(prisma, sSam, acct.id, { serviceClass: 'SMALL_COMMERCIAL', reason: 'x' }, CTX)) === 400
        && await status(() => classifyAccount(prisma, sSam, acct.id, { serviceClass: 'HUGE', reason: 'x' }, CTX)) === 400);
      ok('…a stale page is refused', await status(() => classifyAccount(prisma, sSam, acct.id, { serviceClass: 'MIDDLE_MARKET', reason: 'x', version: '2020-01-01T00:00:00.000Z' }, CTX)) === 409);
      const c2 = await classifyAccount(prisma, sSam, acct.id, { serviceClass: 'MIDDLE_MARKET', reason: `${TAG}-secret-reason 12 locations`, version: c1.version }, CTX) as Json;
      ok('the Senior AM overrides it, with a reason kept in its history', c2.serviceClass === 'MIDDLE_MARKET' && c2.history.length === 2 && c2.history[0].reason === `${TAG}-secret-reason 12 locations` && c2.history[0].from === 'SMALL_COMMERCIAL');
      const audits = await prisma.deskAuditLog.findMany({ where: { agencyId: A.id } });
      ok('…audited as an override, the reason not in the audit log', audits.some((a) => a.action === 'insured.classified' && (a.metadata as Json)?.override === true) && !JSON.stringify(audits).includes('secret-reason'));
      for (const [who, s] of [['the Director of Agency Operations', sDao], ['the COO', sCoo]] as const) {
        ok(`${who} may override too`, classRights(s, A.id).override);
      }
      const dv = await denied(va), dl = await denied(lead), dd = await denied(dvo), dw = await denied(owner);
      const refused = await Promise.all([sVa, sLead, sDvo, sOwner].map((s) => status(() => classifyAccount(prisma, s, acct.id, { serviceClass: 'COMPLEX_CUSTOM', reason: 'x' }, CTX))));
      ok('a VA, a Pod Leader, the Director of Virtual Operations and the agency: refused', refused.every((s) => s === 403), refused);
      ok('…each refusal logged', (await denied(va)) === dv + 1 && (await denied(lead)) === dl + 1 && (await denied(dvo)) === dd + 1 && (await denied(owner)) === dw + 1);
      ok('another AM\'s agency is out of reach', await status(() => classifyAccount(prisma, sAm1, acctB.id, { serviceClass: 'SMALL_COMMERCIAL' }, CTX)) === 404);
      const vaView = (await getInsuredOverview(prisma, sVa, acct.id, CTX) as Json).classification;
      ok('a VA sees the classification, not its history or flags', vaView?.serviceClass === 'MIDDLE_MARKET' && vaView.history === undefined && vaView.flags === undefined && vaView.can.flag && !vaView.can.change);
    }

    section('A request');
    {
      const v = await getTaskDetail(prisma, sAm1, t1.id, CTX) as Json;
      ok('a request takes the account\'s', v.classification.serviceClass === 'MIDDLE_MARKET' && v.classification.source === 'ACCOUNT' && v.classification.request === null);
      ok('…the AM may flag it, not change it; the Senior AM may change it', !v.classification.can.change && v.classification.can.flag
        && (await getTaskDetail(prisma, sSam, t1.id, CTX) as Json).classification.can.change);
      const d0 = await denied(am1);
      ok('the AM can\'t give it its own, refused and logged', await status(() => reviewTask(prisma, sAm1, t1.id, { serviceClass: 'COMPLEX_CUSTOM', reason: 'x' }, CTX)) === 403 && (await denied(am1)) === d0 + 1);
      ok('a reason is required', await status(() => reviewTask(prisma, sSam, t1.id, { serviceClass: 'COMPLEX_CUSTOM' }, CTX)) === 400);
      await reviewTask(prisma, sSam, t1.id, { serviceClass: 'COMPLEX_CUSTOM', reason: `${TAG}-why custom pricing` }, CTX);
      const v2 = await getTaskDetail(prisma, sSam, t1.id, CTX) as Json;
      ok('the Senior AM gives the request its own', v2.classification.serviceClass === 'COMPLEX_CUSTOM' && v2.classification.source === 'REQUEST' && v2.classification.account === 'MIDDLE_MARKET');
      const ev = (v2.events as Json[]).filter((e) => e.kind === 'RECLASSIFIED').pop()!;
      ok('…in the internal history, with the reason', ev.body === `${TAG}-why custom pricing` && eventLines(ev as never).includes('Classification: the account\'s (Middle-Market) → Complex / Custom'), eventLines(ev as never));
      const au = await prisma.deskAuditLog.findFirst({ where: { action: 'task.reclassified', entityId: t1.id }, orderBy: { createdAt: 'desc' } });
      ok('…audited without the reason', (au?.metadata as Json)?.to?.serviceClass === 'COMPLEX_CUSTOM' && !JSON.stringify(au).includes('why custom'));
      const vaEv = ((await getTaskDetail(prisma, sVa, t1.id, CTX) as Json).events as Json[]).filter((e) => e.kind === 'RECLASSIFIED').pop()!;
      ok('a VA sees that it was reclassified and why, not the details', vaEv.body === `${TAG}-why custom pricing` && vaEv.details.to === undefined);
      await reviewTask(prisma, sSam, t1.id, { serviceClass: null, reason: 'back to the account' }, CTX);
      ok('back to the account\'s', (await reload(t1.id)).serviceClass === null);
      ok('…not on a request without an account', await status(() => reviewTask(prisma, sSam, t2.id, { serviceClass: null, reason: 'x' }, CTX)) === 400);
      ok('…nor an unknown class', await status(() => reviewTask(prisma, sSam, t1.id, { serviceClass: 'GOLD', reason: 'x' }, CTX)) === 400);
      await reviewTask(prisma, sAm1, t2.id, { serviceClass: 'SMALL_COMMERCIAL', reason: 'first' }, CTX);
      ok('a request with no classification at all: the AM sets it', (await reload(t2.id)).serviceClass === 'SMALL_COMMERCIAL');
      ok('…and it can\'t go back to an account it hasn\'t got', await status(() => reviewTask(prisma, sSam, t2.id, { serviceClass: null, reason: 'x' }, CTX)) === 400
        && (await reload(t2.id)).serviceClass === 'SMALL_COMMERCIAL');
      ok('…and then it\'s for someone who overrides', await status(() => reviewTask(prisma, sAm1, t2.id, { serviceClass: 'MIDDLE_MARKET', reason: 'x' }, CTX)) === 403);
      ok('a subtask takes its request\'s', await status(() => reviewTask(prisma, sSam, sub.id, { serviceClass: 'SMALL_COMMERCIAL', reason: 'x' }, CTX)) === 400
        && (await taskClassification(prisma, sSam, sub)) === null);
      ok('a closed request is refused', await status(() => reviewTask(prisma, sSam, tDone.id, { serviceClass: 'SMALL_COMMERCIAL', reason: 'x' }, CTX)) === 409);
      ok('the other reclassifications still need their own permission (a VA)', await status(() => reviewTask(prisma, sVa, t1.id, { complexity: 'COMPLEX', reason: 'x' }, CTX)) === 403);
    }

    section('Flags');
    {
      ok('a flag needs a reason, a different class, an account to flag, an open request', await status(() => flagClassification(prisma, sVa, t1.id, { target: 'ACCOUNT', suggested: 'COMPLEX_CUSTOM' }, CTX)) === 400
        && await status(() => flagClassification(prisma, sVa, t1.id, { target: 'ACCOUNT', suggested: 'MIDDLE_MARKET', reason: 'x' }, CTX)) === 400
        && await status(() => flagClassification(prisma, sAm1, t2.id, { target: 'ACCOUNT', suggested: 'MIDDLE_MARKET', reason: 'x' }, CTX)) === 400
        && await status(() => flagClassification(prisma, sSam, sub.id, { target: 'REQUEST', suggested: 'COMPLEX_CUSTOM', reason: 'x' }, CTX)) === 400
        && await status(() => flagClassification(prisma, sSam, tDone.id, { target: 'REQUEST', suggested: 'COMPLEX_CUSTOM', reason: 'x' }, CTX)) === 409);
      const sVaNoFlag = { ...sVa, permissions: sVa.permissions.filter((k) => k !== 'classification.flag') } as typeof sVa;
      ok('without the flag permission, refused', await status(() => flagClassification(prisma, sVaNoFlag, t1.id, { target: 'ACCOUNT', suggested: 'COMPLEX_CUSTOM', reason: 'x' }, CTX)) === 403);
      const dw = await denied(owner);
      ok('the agency can\'t flag, refused and logged', await status(() => flagClassification(prisma, sOwner, t1.id, { target: 'ACCOUNT', suggested: 'COMPLEX_CUSTOM', reason: 'x' }, CTX)) === 403 && (await denied(owner)) === dw + 1);
      const f = await flagClassification(prisma, sVa, t1.id, { target: 'ACCOUNT', suggested: 'COMPLEX_CUSTOM', reason: `${TAG}-flag 3 markets` }, CTX) as Json;
      ok('a VA flags the account', f.flag?.target === 'ACCOUNT' && f.flag.suggested === 'COMPLEX_CUSTOM' && f.flag.by === `${TAG} va` && !f.can.flag);
      ok('…changing nothing', (await prisma.accountClassification.findUnique({ where: { insuredId: acct.id } }))?.serviceClass === 'MIDDLE_MARKET');
      ok('…one open flag at a time', await status(() => flagClassification(prisma, sLead, t1.id, { target: 'REQUEST', suggested: 'SMALL_COMMERCIAL', reason: 'x' }, CTX)) === 409);
      const vaEv = ((await getTaskDetail(prisma, sVa, t1.id, CTX) as Json).events as Json[]).filter((e) => e.kind === 'CLASS_FLAGGED').pop()!;
      ok('…in the request\'s history, for the VA too', eventTitle(vaEv as never) === 'Flagged for reclassification' && eventLines(vaEv as never).join() === 'The account: suggested Complex / Custom');
      ok('…audited, without the reason', !!(await prisma.deskAuditLog.findFirst({ where: { action: 'classification.flagged', entityId: t1.id } }))
        && !JSON.stringify(await prisma.deskAuditLog.findMany({ where: { agencyId: A.id } })).includes('flag 3 markets'));
      const acctView = (await getInsuredOverview(prisma, sSam, acct.id, CTX) as Json).classification;
      ok('the account page shows it to those who may change it', acctView.flags.length === 1 && acctView.flags[0].reference === t1.reference);
      const tB = await mkTask('in agency B', { agencyId: B.id, amId: am2.id, insuredId: acctB.id, podId: null, assigneeId: null });
      await flagClassification(prisma, sAm2, tB.id, { target: 'REQUEST', suggested: 'COMPLEX_CUSTOM', reason: 'x' }, CTX);
      const s = await getDashboards(prisma, sSam, {}, CTX) as Json;
      ok('the Agency Operations dashboard counts it', s.agency.awaiting.classFlags === 1);
      ok('…the AM may not dismiss it (the account is set, so it\'s an override)', !(await getTaskDetail(prisma, sAm1, t1.id, CTX) as Json).classification.can.dismiss
        && await status(() => dismissClassificationFlag(prisma, sAm1, t1.id, {}, CTX)) === 403);
      await classifyAccount(prisma, sSam, acct.id, { serviceClass: 'COMPLEX_CUSTOM', reason: 'agreed' }, CTX);
      const settled = await prisma.classificationFlag.findFirst({ where: { taskId: t1.id }, orderBy: { createdAt: 'desc' } });
      ok('changing the account settles it', settled?.outcome === 'CHANGED' && !!settled.closedAt && settled.closedById === sam.id
        && (await getTaskDetail(prisma, sSam, t1.id, CTX) as Json).classification.flag === null);
      const closed = ((await getTaskDetail(prisma, sSam, t1.id, CTX) as Json).events as Json[]).filter((e) => e.kind === 'CLASS_FLAG_CLOSED').pop()!;
      ok('…said in the request\'s history', eventTitle(closed as never) === 'Reclassification flag settled: classification changed');

      await flagClassification(prisma, sLead, t1.id, { target: 'REQUEST', suggested: 'MIDDLE_MARKET', reason: 'one simple certificate' }, CTX);
      ok('a Pod Leader flags this request only', (await prisma.classificationFlag.count({ where: { taskId: t1.id, closedAt: null, target: 'REQUEST' } })) === 1);
      const dis = await dismissClassificationFlag(prisma, sSam, t1.id, { note: 'stays as the account' }, CTX) as Json;
      const gone = await prisma.classificationFlag.findFirst({ where: { taskId: t1.id }, orderBy: { createdAt: 'desc' } });
      ok('the Senior AM dismisses it, with a note', dis.flag === null && gone?.outcome === 'DISMISSED' && gone.closeNote === 'stays as the account' && (await reload(t1.id)).serviceClass === null);
      ok('…audited', !!(await prisma.deskAuditLog.findFirst({ where: { action: 'classification.flag_dismissed', entityId: t1.id } })));
      ok('…nothing left to dismiss', await status(() => dismissClassificationFlag(prisma, sSam, t1.id, {}, CTX)) === 409);
      await flagClassification(prisma, sVa, t1.id, { target: 'REQUEST', suggested: 'SMALL_COMMERCIAL', reason: 'small job' }, CTX);
      await reviewTask(prisma, sSam, t1.id, { serviceClass: 'SMALL_COMMERCIAL', reason: 'agreed' }, CTX);
      ok('changing the request\'s own settles a flag on the request', (await prisma.classificationFlag.findFirst({ where: { taskId: t1.id }, orderBy: { createdAt: 'desc' } }))?.outcome === 'CHANGED');
      ok('…and the dashboard no longer counts any', (await getDashboards(prisma, sSam, {}, CTX) as Json).agency.awaiting.classFlags === 0);
    }

    section('The agency sees none of it');
    {
      await flagClassification(prisma, sVa, t1.id, { target: 'ACCOUNT', suggested: 'MIDDLE_MARKET', reason: 'x' }, CTX);
      const acctView = await getInsuredOverview(prisma, sOwner, acct.id, CTX) as Json;
      const taskView = await getTaskDetail(prisma, sOwner, t1.id, CTX) as Json;
      ok('not on the account page', !('classification' in acctView) && !/serviceClass|SMALL_COMMERCIAL|MIDDLE_MARKET|COMPLEX_CUSTOM/.test(JSON.stringify(acctView)));
      ok('not on the request, nor its history', !('classification' in taskView) && !/serviceClass|SMALL_COMMERCIAL|MIDDLE_MARKET|COMPLEX_CUSTOM|CLASS_FLAG|RECLASSIFIED/.test(JSON.stringify(taskView)));
    }

    section('The routes');
    {
      const req = (url: string, token: string | null, method: string, body?: unknown) => new NextRequest(`http://localhost${url}`, {
        method, headers: { ...(token ? { cookie: `session_token=${token}` } : {}), 'content-type': 'application/json' }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
      const params = (id: string) => ({ params: Promise.resolve({ id }) });
      const [tSam, tAm, tVa] = await Promise.all([createSession(sam.id), createSession(am1.id), createSession(va.id)]);
      const r1 = await accountRoute(req(`/api/desk/insureds/${acct.id}/classification`, tSam, 'POST', { serviceClass: 'SMALL_COMMERCIAL', reason: 'route' }), params(acct.id));
      ok('account: 200 for the Senior AM, with the classification back', r1.status === 200 && ((await r1.json()) as Json).serviceClass === 'SMALL_COMMERCIAL');
      ok('…403 for the AM changing it, 401 signed out, 400 for no body', (await accountRoute(req(`/api/desk/insureds/${acct.id}/classification`, tAm, 'POST', { serviceClass: 'MIDDLE_MARKET', reason: 'x' }), params(acct.id))).status === 403
        && (await accountRoute(req(`/api/desk/insureds/${acct.id}/classification`, null, 'POST', { serviceClass: 'MIDDLE_MARKET' }), params(acct.id))).status === 401
        && (await accountRoute(req(`/api/desk/insureds/${acct.id}/classification`, tSam, 'POST'), params(acct.id))).status === 400);
      // The account change settled the open account flag; a fresh one through the route.
      const r2 = await flagRoute(req(`/api/desk/tasks/${t1.id}/classification`, tVa, 'POST', { target: 'ACCOUNT', suggested: 'COMPLEX_CUSTOM', reason: 'route' }), params(t1.id));
      ok('flag: 200 for the VA', r2.status === 200 && ((await r2.json()) as Json).flag?.suggested === 'COMPLEX_CUSTOM');
      ok('…dismissing: 403 for the VA, 200 for the Senior AM', (await unflagRoute(req(`/api/desk/tasks/${t1.id}/classification`, tVa, 'DELETE', {}), params(t1.id))).status === 403
        && (await unflagRoute(req(`/api/desk/tasks/${t1.id}/classification`, tSam, 'DELETE', { note: 'no' }), params(t1.id))).status === 200);
      const r3 = await reviewRoute(req(`/api/desk/tasks/${t1.id}/review`, tSam, 'POST', { serviceClass: 'MIDDLE_MARKET', reason: 'route' }), params(t1.id));
      ok('a request\'s own, through the reclassification route', r3.status === 200 && (await reload(t1.id)).serviceClass === 'MIDDLE_MARKET');
    }
  } catch (err) {
    console.error(err);
    fail++;
  } finally {
    await wipe();
    const left = await prisma.user.count({ where: { email: { startsWith: TAG } } })
      + await prisma.agency.count({ where: { id: { in: cleanup.agencyIds } } })
      + await prisma.pod.count({ where: { code: { startsWith: TAG } } })
      + await prisma.insuredAccount.count({ where: { agencyId: { in: cleanup.agencyIds } } })
      + await prisma.task.count({ where: { agencyId: { in: cleanup.agencyIds } } })
      + await prisma.taskEvent.count({ where: { agencyId: { in: cleanup.agencyIds } } })
      + await prisma.accountClassification.count({ where: { agencyId: { in: cleanup.agencyIds } } })
      + await prisma.accountClassificationChange.count({ where: { agencyId: { in: cleanup.agencyIds } } })
      + await prisma.classificationFlag.count({ where: { agencyId: { in: cleanup.agencyIds } } })
      + await prisma.deskPosition.count({ where: { code: { startsWith: TAG } } })
      + await prisma.deskAuditLog.count({ where: { OR: [{ actorId: { in: cleanup.userIds } }, { agencyId: { in: cleanup.agencyIds } }] } });
    ok('temporary records removed, audit entries included', left === 0, left);
    console.log(`\n${pass} passed, ${fail} failed`);
    await prisma.$disconnect();
    process.exit(fail ? 1 : 0);
  }
})();
