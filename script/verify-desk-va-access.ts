/**
 * The Desk, Module 10: access layer, part 2 (Desk VAs on a need-to-know basis).
 *
 * Builds three agencies (one without The Desk), temporary pods, six VAs with
 * different memberships and authorisations, and tasks, documents and history
 * on them. Checks that a VA sees a task only through pod × agency
 * authorisation × named restriction × open-or-theirs; reaches accounts and
 * policies only through those tasks; opens sensitive documents only with a
 * grant; and that agency users never see internal documents or history.
 * Uses temporary records only.
 * Run with:  npx tsx script/verify-desk-va-access.ts
 */
import 'dotenv/config';
import type { UserRole } from '@prisma/client';
import { prisma } from '../lib/prisma';
import {
  resolveDeskScope, insuredWhere, policyWhere, taskWhere, documentWhere, taskEventWhere, scopeAgencyIds,
  getTaskForScope, getInsuredForScope, getPolicyForScope, getDocumentForScope, resolveSubmission,
  DeskAccessError, type DeskScope,
} from '../lib/desk/access';

let pass = 0, fail = 0;
const ok = (n: string, c: boolean) => { c ? pass++ : fail++; console.log(`  ${c ? '✓' : '✗'} ${n}`); };
const status = async (fn: () => Promise<unknown>) => {
  try { await fn(); return 200; } catch (e) { return e instanceof DeskAccessError ? e.status : 500; }
};

const TAG = `m10test-${Date.now()}`;
const cleanup = { agencyIds: [] as string[], userIds: [] as string[], podIds: [] as string[] };
let ref = 960_000_000 + Math.floor(Math.random() * 1_000_000);

async function wipe() {
  const agencyId = { in: cleanup.agencyIds };
  await prisma.taskEvent.deleteMany({ where: { agencyId } });
  await prisma.taskDocument.deleteMany({ where: { agencyId } });
  await prisma.task.deleteMany({ where: { agencyId } });
  await prisma.policy.deleteMany({ where: { agencyId } });
  await prisma.insuredAccount.deleteMany({ where: { agencyId } });
  await prisma.agencyPodAccess.deleteMany({ where: { agencyId } });
  await prisma.agencyDeskAssignment.deleteMany({ where: { agencyId } });
  await prisma.podMember.deleteMany({ where: { podId: { in: cleanup.podIds } } });
  await prisma.pod.deleteMany({ where: { id: { in: cleanup.podIds } } });
  await prisma.deskStaffPermission.deleteMany({ where: { userId: { in: cleanup.userIds } } });
  await prisma.deskAuditLog.deleteMany({ where: { OR: [{ agencyId }, { actorId: { in: cleanup.userIds } }] } });
  await prisma.user.deleteMany({ where: { id: { in: cleanup.userIds } } });
  await prisma.agency.deleteMany({ where: { id: agencyId } });
}

(async () => {
  try {
    // ── Fixture ──
    const mkAgency = async (n: string, deskEnabled = true) => {
      const a = await prisma.agency.create({ data: { name: `${TAG} ${n}`, deskEnabled } });
      cleanup.agencyIds.push(a.id); return a;
    };
    const A = await mkAgency('A'), B = await mkAgency('B'), D = await mkAgency('D (no Desk)', false);

    const mkPod = async (code: string, isActive = true) => {
      const p = await prisma.pod.create({ data: { code: `${TAG}-${code}`, name: `${TAG} ${code}`, isActive } });
      cleanup.podIds.push(p.id); return p;
    };
    const P1 = await mkPod('P1'), P2 = await mkPod('P2'), Pold = await mkPod('OLD', false);

    const mkUser = async (n: string, role: UserRole, agencyId: string | null = null) => {
      const u = await prisma.user.create({ data: { email: `${TAG}-${n}@example.test`, role, agencyId } });
      cleanup.userIds.push(u.id); return u;
    };
    const va1 = await mkUser('va1', 'DESK_VA');       // P1 + P2, granted Financial
    const va2 = await mkUser('va2', 'DESK_VA');       // P1
    const va3 = await mkUser('va3', 'DESK_VA');       // P2
    const vaNamed = await mkUser('va-named', 'DESK_VA'); // P1, named for agency B
    const vaNoPod = await mkUser('va-nopod', 'DESK_VA');
    const vaOld = await mkUser('va-old', 'DESK_VA');  // only in an inactive pod
    const adminA = await mkUser('admin-a', 'ADMIN', A.id);
    const am = await mkUser('am', 'ACCOUNT_MANAGER');
    const ops = await mkUser('ops', 'DESK_ADMIN');

    const member = (pod: { id: string }, u: { id: string }) => prisma.podMember.create({ data: { podId: pod.id, userId: u.id } });
    await member(P1, va1); await member(P2, va1); await member(P1, va2); await member(P2, va3);
    await member(P1, vaNamed); await member(Pold, vaOld);
    await prisma.deskStaffPermission.create({ data: { userId: va1.id, allowedSensitivities: ['FINANCIAL'] } });
    await prisma.agencyDeskAssignment.create({ data: { agencyId: A.id, primaryAmId: am.id } });

    // Authorisation. Whole-pod rows leave userId unset (the Module 2 trap).
    await prisma.agencyPodAccess.create({ data: { agencyId: A.id, podId: P1.id } });
    await prisma.agencyPodAccess.create({ data: { agencyId: A.id, podId: Pold.id } });
    await prisma.agencyPodAccess.create({ data: { agencyId: B.id, podId: P1.id, userId: vaNamed.id } }); // B: only vaNamed from P1
    await prisma.agencyPodAccess.create({ data: { agencyId: B.id, podId: P2.id } });
    await prisma.agencyPodAccess.create({ data: { agencyId: D.id, podId: P1.id } });

    const mkInsured = (agencyId: string, name: string) => prisma.insuredAccount.create({ data: { agencyId, name, nameKey: name.toLowerCase() } });
    const iA1 = await mkInsured(A.id, 'A1'), iA2 = await mkInsured(A.id, 'A2'), iA3 = await mkInsured(A.id, 'A3');
    const iB1 = await mkInsured(B.id, 'B1'), iD1 = await mkInsured(D.id, 'D1');
    const mkPolicy = (i: { id: string; agencyId: string }, n: string) => prisma.policy.create({ data: { agencyId: i.agencyId, insuredId: i.id, policyNumber: n } });
    await mkPolicy(iA1, 'A1-GL'); await mkPolicy(iA1, 'A1-AUTO');
    const pA2 = await mkPolicy(iA2, 'A2-GL'); await mkPolicy(iA2, 'A2-UMB');
    await mkPolicy(iA3, 'A3-GL'); await mkPolicy(iB1, 'B1-GL'); await mkPolicy(iD1, 'D1-GL');

    const mkTask = (agencyId: string, title: string, extra: object = {}) =>
      prisma.task.create({ data: { reference: ++ref, agencyId, type: 'COI', title, ...extra } });
    const tCoi = await mkTask(A.id, 'A coi', { podId: P1.id, insuredId: iA1.id });
    await mkTask(A.id, 'A endorsement', { podId: P1.id, insuredId: iA2.id, policyId: pA2.id, type: 'ENDORSEMENT' });
    await mkTask(A.id, 'A pod2 (not authorised)', { podId: P2.id, insuredId: iA3.id });
    const tUnrouted = await mkTask(A.id, 'A unrouted', { insuredId: iA3.id });
    await mkTask(A.id, 'A done by va2', { podId: P1.id, status: 'COMPLETED', assigneeId: va2.id });
    await mkTask(A.id, 'A done by va1', { podId: P1.id, status: 'COMPLETED', assigneeId: va1.id });
    await mkTask(A.id, 'A cancelled', { podId: P1.id, status: 'CANCELLED' });
    const tRestricted = await mkTask(A.id, 'A restricted to va2', { podId: P1.id, restrictedToUserIds: [va2.id], restrictionReason: 'VIP' });
    const tB1 = await mkTask(B.id, 'B pod1', { podId: P1.id, insuredId: iB1.id });
    await mkTask(B.id, 'B pod2', { podId: P2.id });
    await mkTask(D.id, 'D pod1 (no Desk)', { podId: P1.id, insuredId: iD1.id });
    await mkTask(A.id, 'A inactive pod', { podId: Pold.id });

    const mkDoc = (fileName: string, extra: object) =>
      prisma.taskDocument.create({ data: { taskId: tCoi.id, agencyId: A.id, storageKey: `${TAG}/${fileName}`, fileName, fileSize: 1, contentType: 'application/pdf', sensitivity: 'GENERAL', ...extra } });
    const dGeneral = await mkDoc('general.pdf', {});
    const dFinancial = await mkDoc('financial.pdf', { sensitivity: 'FINANCIAL' });
    await mkDoc('personal.pdf', { sensitivity: 'PERSONAL' });
    await mkDoc('removed.pdf', { deletedAt: new Date() });
    await mkDoc('shared.pdf', { visibility: 'AGENCY' });
    await prisma.taskEvent.create({ data: { taskId: tCoi.id, agencyId: A.id, kind: 'NOTE', body: 'internal note' } });
    await prisma.taskEvent.create({ data: { taskId: tCoi.id, agencyId: A.id, kind: 'NOTE', body: 'agency note', visibility: 'AGENCY' } });

    const mine = { agencyId: { in: cleanup.agencyIds } };
    const tasks = async (s: DeskScope) => (await prisma.task.findMany({ where: { AND: [mine, taskWhere(s)] }, orderBy: { reference: 'asc' }, select: { title: true } })).map((r) => r.title).join(' | ');
    const insureds = async (s: DeskScope) => (await prisma.insuredAccount.findMany({ where: { AND: [mine, insuredWhere(s)] }, orderBy: { name: 'asc' }, select: { name: true } })).map((r) => r.name).join(', ');
    const policies = async (s: DeskScope) => (await prisma.policy.findMany({ where: { AND: [mine, policyWhere(s)] }, orderBy: { policyNumber: 'asc' }, select: { policyNumber: true } })).map((r) => r.policyNumber).join(', ');
    const docs = async (s: DeskScope) => (await prisma.taskDocument.findMany({ where: { AND: [mine, documentWhere(s)] }, orderBy: { fileName: 'asc' }, select: { fileName: true } })).map((r) => r.fileName).join(', ');
    const events = async (s: DeskScope) => (await prisma.taskEvent.findMany({ where: { AND: [mine, taskEventWhere(s)] }, orderBy: { body: 'asc' }, select: { body: true } })).map((r) => r.body).join(', ');
    const scope = (u: { id: string }) => resolveDeskScope(prisma, u.id);

    const s1 = await scope(va1), s2 = await scope(va2), s3 = await scope(va3), sNamed = await scope(vaNamed);
    const sNoPod = await scope(vaNoPod), sOld = await scope(vaOld), sAdminA = await scope(adminA), sAm = await scope(am), sOps = await scope(ops);
    const pairs = (s: DeskScope) => s.kind === 'VA'
      ? s.grants.map((g) => `${g.agencyId === A.id ? 'A' : g.agencyId === B.id ? 'B' : 'D'}:${g.podId === P1.id ? 'P1' : g.podId === P2.id ? 'P2' : 'OLD'}`).sort().join(',')
      : `(${s.kind})`;

    console.log('\n━━ What each VA is authorised for ━━');
    ok('VA in pods 1 and 2: A via pod 1, B via pod 2', pairs(s1) === 'A:P1,B:P2');
    ok('VA in pod 1 only: A (B authorised pod 1 for a named VA only)', pairs(s2) === 'A:P1');
    ok('VA named by B: A via whole pod, B by name', pairs(sNamed) === 'A:P1,B:P1');
    ok('VA in pod 2 only: B', pairs(s3) === 'B:P2');
    ok('agency without The Desk grants nothing (D authorised pod 1)', !pairs(s1).includes('D') && !pairs(s2).includes('D'));
    ok('VA in no pod: no grants', pairs(sNoPod) === '');
    ok('VA only in an inactive pod: no grants', pairs(sOld) === '');
    ok('agencies in scope follow the grants', (scopeAgencyIds(s1) as string[]).sort().join() === [A.id, B.id].sort().join());
    ok('document categories: defaults plus individual grants',
      s1.kind === 'VA' && s1.sensitivities.sort().join() === 'FINANCIAL,GENERAL,POLICY' &&
      s2.kind === 'VA' && s2.sensitivities.sort().join() === 'GENERAL,POLICY');

    console.log('\n━━ Tasks a VA sees ━━');
    ok('VA 1: open tasks in authorised pods, plus their own completed one',
      (await tasks(s1)) === 'A coi | A endorsement | A done by va1 | B pod2');
    ok('VA 2: their own completed task and the task restricted to them',
      (await tasks(s2)) === 'A coi | A endorsement | A done by va2 | A restricted to va2');
    ok('named VA: A open tasks and B pod 1', (await tasks(sNamed)) === 'A coi | A endorsement | B pod1');
    ok('VA 3: B pod 2 only', (await tasks(s3)) === 'B pod2');
    ok('no pod / inactive pod: nothing', (await tasks(sNoPod)) === '' && (await tasks(sOld)) === '');
    {
      const all = [s1, s2, s3, sNamed];
      const seen = (await Promise.all(all.map(tasks))).join(' | ');
      ok('no VA sees an unrouted task', !seen.includes('unrouted'));
      ok('no VA sees a pod the agency did not authorise', !seen.includes('not authorised'));
      ok('no VA sees an agency without The Desk', !seen.includes('no Desk'));
      ok('no VA sees someone else\'s finished or cancelled task', !(await tasks(s1)).includes('va2') && !seen.includes('cancelled'));
    }

    console.log('\n━━ Accounts and policies only through tasks ━━');
    ok('VA 1 sees the accounts on their tasks only', (await insureds(s1)) === 'A1, A2');
    ok('an account with no visible task is hidden (A3)', !(await insureds(s2)).includes('A3'));
    ok('named VA also sees the B account', (await insureds(sNamed)) === 'A1, A2, B1');
    ok('policies: all of A1 (COI on the account), only A2-GL (endorsement on that policy)',
      (await policies(s1)) === 'A1-AUTO, A1-GL, A2-GL');
    ok('VA 3 (task with no account) sees no accounts or policies', (await insureds(s3)) === '' && (await policies(s3)) === '');

    console.log('\n━━ Documents and history ━━');
    ok('VA 2: General and Policy only; removed files hidden', (await docs(s2)) === 'general.pdf, shared.pdf');
    ok('VA 1 (granted Financial): also the financial file, never the personal one', (await docs(s1)) === 'financial.pdf, general.pdf, shared.pdf');
    ok('VA 3 (no access to the task): no documents', (await docs(s3)) === '');
    ok('agency admin: only the file shared with the agency', (await docs(sAdminA)) === 'shared.pdf');
    ok('Account Manager and Operations Manager: every category',
      (await docs(sAm)) === 'financial.pdf, general.pdf, personal.pdf, shared.pdf' && (await docs(sOps)) === (await docs(sAm)));
    ok('agency admin sees agency notes, never internal ones', (await events(sAdminA)) === 'agency note');
    ok('VA with access sees both; VA without sees none', (await events(s2)) === 'agency note, internal note' && (await events(s3)) === '');

    console.log('\n━━ Opening one record ━━');
    ok('VA opens a task in their queue', (await status(() => getTaskForScope(prisma, s2, tCoi.id))) === 200);
    ok('VA: unrouted task is 404', (await status(() => getTaskForScope(prisma, s2, tUnrouted.id))) === 404);
    ok('VA: task restricted to someone else is 404', (await status(() => getTaskForScope(prisma, s1, tRestricted.id))) === 404);
    ok('VA: B pod 1 task without being named is 404', (await status(() => getTaskForScope(prisma, s2, tB1.id))) === 404);
    ok('VA opens the account and policy behind their task',
      (await status(() => getInsuredForScope(prisma, s1, iA2.id))) === 200 && (await status(() => getPolicyForScope(prisma, s1, pA2.id))) === 200);
    ok('VA: account with no visible task is 404', (await status(() => getInsuredForScope(prisma, s1, iA3.id))) === 404);
    ok('VA 1 opens the financial file; VA 2 gets 404',
      (await status(() => getDocumentForScope(prisma, s1, dFinancial.id))) === 200 && (await status(() => getDocumentForScope(prisma, s2, dFinancial.id))) === 404);
    {
      const log = await prisma.deskAuditLog.findFirst({ where: { actorId: va2.id, entityType: 'TaskDocument' } });
      ok('the refused financial file is audited with its category', !!log && log.entityId === dFinancial.id && (log.metadata as any)?.sensitivity === 'FINANCIAL');
    }
    ok('agency admin: an internal file is 404',
      (await status(() => getDocumentForScope(prisma, sAdminA, dGeneral.id))) === 404);
    ok('VAs cannot file requests', (await status(() => resolveSubmission(prisma, s1, { insuredId: iA1.id }))) === 404);

    console.log('\n━━ Changes apply on the next request ━━');
    await prisma.task.update({ where: { id: tRestricted.id }, data: { restrictedToUserIds: [va2.id, va1.id] } });
    ok('naming VA 1 on a restricted task lets them see it', (await tasks(await scope(va1))).includes('restricted'));
    await prisma.podMember.deleteMany({ where: { podId: P1.id, userId: va2.id } });
    ok('removing VA 2 from the pod removes all access', (await tasks(await scope(va2))) === '');
    await prisma.pod.update({ where: { id: P2.id }, data: { isActive: false } });
    ok('deactivating pod 2 removes VA 3\'s access', (await tasks(await scope(va3))) === '');
    await prisma.agencyPodAccess.deleteMany({ where: { agencyId: B.id, podId: P1.id, userId: vaNamed.id } });
    ok('withdrawing a named authorisation removes that agency', (await insureds(await scope(vaNamed))) === 'A1, A2');
    await prisma.agency.update({ where: { id: A.id }, data: { deskEnabled: false } });
    ok('switching The Desk off for A removes it from every VA', (await tasks(await scope(va1))) === '' && (await tasks(await scope(vaNamed))) === '');
  } finally {
    await wipe();
    const left = (await prisma.user.count({ where: { id: { in: cleanup.userIds } } })) +
      (await prisma.agency.count({ where: { id: { in: cleanup.agencyIds } } })) +
      (await prisma.pod.count({ where: { id: { in: cleanup.podIds } } }));
    ok('temporary records removed', left === 0);
    console.log(`\n━━ ${pass} passed, ${fail} failed ━━`);
    await prisma.$disconnect();
    process.exit(fail ? 1 : 0);
  }
})();
