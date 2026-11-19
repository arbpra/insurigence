/**
 * The Desk, Module 9: access layer, part 1 (agency users and Account Managers).
 *
 * Builds two Desk agencies and one without The Desk, each with users, insureds,
 * policies and tasks, then checks what every role can list and open, that
 * everything out of scope is a 404 with an audit entry, submission rules (D4)
 * and who may manage access. Uses temporary records only.
 * Run with:  npx tsx script/verify-desk-access.ts
 */
import 'dotenv/config';
import { randomBytes } from 'crypto';
import type { UserRole } from '@prisma/client';
import { prisma } from '../lib/prisma';
import {
  resolveDeskScope, insuredWhere, policyWhere, taskWhere, scopeAgencyIds,
  getInsuredForScope, getPolicyForScope, getTaskForScope, resolveSubmission,
  canManageAgencyAccess, deskAccessResponse, DeskAccessError, type DeskScope,
} from '../lib/desk/access';

let pass = 0, fail = 0;
const ok = (n: string, c: boolean) => { c ? pass++ : fail++; console.log(`  ${c ? '✓' : '✗'} ${n}`); };
const status = async (fn: () => Promise<unknown>) => {
  try { await fn(); return 200; } catch (e) { return e instanceof DeskAccessError ? e.status : 500; }
};

const TAG = `m9test-${Date.now()}`;
const cleanup = { agencyIds: [] as string[], userIds: [] as string[] };
let ref = 950_000_000 + Math.floor(Math.random() * 1_000_000);

async function wipe() {
  const agencyId = { in: cleanup.agencyIds };
  await prisma.task.updateMany({ where: { agencyId }, data: { parentTaskId: null } });
  await prisma.task.deleteMany({ where: { agencyId } });
  await prisma.policy.deleteMany({ where: { agencyId } });
  await prisma.insuredAssignment.deleteMany({ where: { agencyId } });
  await prisma.insuredAccount.deleteMany({ where: { agencyId } });
  await prisma.agencyDeskAssignment.deleteMany({ where: { agencyId } });
  await prisma.deskAuditLog.deleteMany({ where: { OR: [{ agencyId }, { actorId: { in: cleanup.userIds } }] } });
  await prisma.user.deleteMany({ where: { id: { in: cleanup.userIds } } });
  await prisma.agency.deleteMany({ where: { id: agencyId } });
}

(async () => {
  try {
    // ── Fixture ──
    const mkAgency = async (n: string, deskEnabled: boolean) => {
      const a = await prisma.agency.create({ data: { name: `${TAG} ${n}`, deskEnabled } });
      cleanup.agencyIds.push(a.id); return a;
    };
    const A = await mkAgency('A', true);
    const B = await mkAgency('B', true);
    const C = await mkAgency('C (no Desk)', false);

    const mkUser = async (n: string, role: UserRole, agencyId: string | null, extra: object = {}) => {
      const u = await prisma.user.create({ data: { email: `${TAG}-${n}@example.test`, role, agencyId, ...extra } });
      cleanup.userIds.push(u.id); return u;
    };
    const adminA = await mkUser('admin-a', 'ADMIN', A.id);
    const producerA = await mkUser('producer-a', 'AGENT', A.id);
    const producerAll = await mkUser('producer-all', 'AGENT', A.id, { bookAccess: 'ALL' });
    const csrA = await mkUser('csr-a', 'CSR', A.id);
    const adminB = await mkUser('admin-b', 'ADMIN', B.id);
    const adminC = await mkUser('admin-c', 'ADMIN', C.id);
    const amA = await mkUser('am-a', 'ACCOUNT_MANAGER', null);
    const amBackupB = await mkUser('am-b', 'ACCOUNT_MANAGER', null);
    const amNone = await mkUser('am-none', 'ACCOUNT_MANAGER', null);
    const opsMgr = await mkUser('ops', 'DESK_ADMIN', null);
    const va = await mkUser('va', 'DESK_VA', null);
    const inactive = await mkUser('inactive', 'ADMIN', A.id, { isActive: false });

    await prisma.agencyDeskAssignment.create({ data: { agencyId: A.id, primaryAmId: amA.id } });
    await prisma.agencyDeskAssignment.create({ data: { agencyId: B.id, primaryAmId: amA.id, backupAmId: amBackupB.id } });
    await prisma.agencyDeskAssignment.create({ data: { agencyId: C.id, primaryAmId: amNone.id } }); // C has no Desk

    const mkInsured = async (agencyId: string, name: string, assigned: { userId: string; role: 'PRODUCER' | 'SERVICE' }[] = []) => {
      const i = await prisma.insuredAccount.create({ data: { agencyId, name, nameKey: name.toLowerCase() } });
      for (const a of assigned) await prisma.insuredAssignment.create({ data: { agencyId, insuredId: i.id, ...a } });
      return i;
    };
    const iProd = await mkInsured(A.id, 'A-producer', [{ userId: producerA.id, role: 'PRODUCER' }]);
    const iShared = await mkInsured(A.id, 'A-shared', [{ userId: producerA.id, role: 'PRODUCER' }, { userId: csrA.id, role: 'SERVICE' }]);
    const iOpen = await mkInsured(A.id, 'A-unassigned');
    const iB = await mkInsured(B.id, 'B-account');
    const iC = await mkInsured(C.id, 'C-account');

    const mkPolicy = (insured: { id: string; agencyId: string }, num: string) =>
      prisma.policy.create({ data: { agencyId: insured.agencyId, insuredId: insured.id, policyNumber: num } });
    const pProd = await mkPolicy(iProd, 'P-PROD');
    const pOpen = await mkPolicy(iOpen, 'P-OPEN');
    const pB = await mkPolicy(iB, 'P-B');

    const mkTask = (agencyId: string, title: string, extra: object = {}) =>
      prisma.task.create({ data: { reference: ++ref, agencyId, type: 'COI', title, ...extra } });
    const tProd = await mkTask(A.id, 'A-producer task', { insuredId: iProd.id });
    const tShared = await mkTask(A.id, 'A-shared task', { insuredId: iShared.id });
    const tOpen = await mkTask(A.id, 'A-unassigned task', { insuredId: iOpen.id });
    const tOwn = await mkTask(A.id, 'A-no-account by producer', { createdById: producerA.id });
    const tOther = await mkTask(A.id, 'A-no-account by admin', { createdById: adminA.id });
    const tRestricted = await mkTask(A.id, 'A-restricted', { insuredId: iOpen.id, restrictedToUserIds: [va.id], restrictionReason: 'VIP' });
    const tB = await mkTask(B.id, 'B task', { insuredId: iB.id });
    await mkTask(C.id, 'C task', { insuredId: iC.id });

    const scope = (u: { id: string }) => resolveDeskScope(prisma, u.id);
    const mine = { agencyId: { in: cleanup.agencyIds } }; // keep the counts to the fixture
    const names = async (s: DeskScope) =>
      (await prisma.insuredAccount.findMany({ where: { AND: [mine, insuredWhere(s)] }, orderBy: { name: 'asc' }, select: { name: true } })).map((r) => r.name).join(', ');
    const policies = async (s: DeskScope) =>
      (await prisma.policy.findMany({ where: { AND: [mine, policyWhere(s)] }, orderBy: { policyNumber: 'asc' }, select: { policyNumber: true } })).map((r) => r.policyNumber).join(', ');
    const tasks = async (s: DeskScope) =>
      (await prisma.task.findMany({ where: { AND: [mine, taskWhere(s)] }, orderBy: { reference: 'asc' }, select: { title: true } })).map((r) => r.title).join(' | ');

    console.log('\n━━ Scope resolution ━━');
    const sAdminA = await scope(adminA), sProd = await scope(producerA), sProdAll = await scope(producerAll), sCsr = await scope(csrA);
    const sAdminB = await scope(adminB), sAdminC = await scope(adminC);
    const sAmA = await scope(amA), sAmB = await scope(amBackupB), sAmNone = await scope(amNone);
    const sOps = await scope(opsMgr), sVa = await scope(va), sInactive = await scope(inactive);
    ok('Owner / Admin: whole book', sAdminA.kind === 'AGENCY' && sAdminA.book === 'ALL');
    ok('Producer and CSR default to assigned accounts', sProd.kind === 'AGENCY' && sProd.book === 'ASSIGNED' && sCsr.kind === 'AGENCY' && sCsr.book === 'ASSIGNED');
    ok('Producer granted the whole book gets it', sProdAll.kind === 'AGENCY' && sProdAll.book === 'ALL');
    ok('agency without The Desk: no access', sAdminC.kind === 'NONE');
    ok('AM covers agencies where primary or backup', sAmA.kind === 'ACCOUNT_MANAGER' && sAmA.agencyIds.sort().join() === [A.id, B.id].sort().join() &&
      sAmB.kind === 'ACCOUNT_MANAGER' && sAmB.agencyIds.join() === B.id);
    ok('AM of an agency without The Desk covers nothing', sAmNone.kind === 'ACCOUNT_MANAGER' && sAmNone.agencyIds.length === 0);
    ok('Operations Manager: platform scope', sOps.kind === 'PLATFORM' && scopeAgencyIds(sOps) === 'ALL');
    ok('Desk VA with no pod: a VA scope with no grants', sVa.kind === 'VA' && sVa.grants.length === 0);
    ok('inactive user: no access', sInactive.kind === 'NONE');
    ok('unknown user id: no access', (await resolveDeskScope(prisma, randomBytes(12).toString('hex'))).kind === 'NONE');

    console.log('\n━━ Insured accounts by role ━━');
    ok('Owner / Admin sees all of A', (await names(sAdminA)) === 'A-producer, A-shared, A-unassigned');
    ok('Producer sees only assigned accounts', (await names(sProd)) === 'A-producer, A-shared');
    ok('CSR sees only the account they service', (await names(sCsr)) === 'A-shared');
    ok('Producer with whole-book access sees all of A', (await names(sProdAll)) === 'A-producer, A-shared, A-unassigned');
    ok('agency B admin sees only B', (await names(sAdminB)) === 'B-account');
    ok('agency without The Desk sees nothing', (await names(sAdminC)) === '');
    ok('AM sees both covered agencies, not C', (await names(sAmA)) === 'A-producer, A-shared, A-unassigned, B-account');
    ok('backup AM sees B only', (await names(sAmB)) === 'B-account');
    ok('Operations Manager sees every agency', (await names(sOps)) === 'A-producer, A-shared, A-unassigned, B-account, C-account');
    ok('VA sees nothing', (await names(sVa)) === '');

    console.log('\n━━ Policies by role ━━');
    ok('Producer sees policies on assigned accounts only', (await policies(sProd)) === 'P-PROD');
    ok('CSR sees none (their account has no policy)', (await policies(sCsr)) === '');
    ok('Owner / Admin sees all of A', (await policies(sAdminA)) === 'P-OPEN, P-PROD');
    ok('backup AM sees B only', (await policies(sAmB)) === 'P-B');

    console.log('\n━━ Tasks by role ━━');
    ok('Owner / Admin sees every A task (named-staff restriction does not apply to agency users)',
      (await tasks(sAdminA)) === 'A-producer task | A-shared task | A-unassigned task | A-no-account by producer | A-no-account by admin | A-restricted');
    ok('Producer: tasks on assigned accounts plus their own submissions',
      (await tasks(sProd)) === 'A-producer task | A-shared task | A-no-account by producer');
    ok('CSR: tasks on the account they service', (await tasks(sCsr)) === 'A-shared task');
    ok('AM sees A and B tasks, including the restricted one', (await tasks(sAmA)) ===
      'A-producer task | A-shared task | A-unassigned task | A-no-account by producer | A-no-account by admin | A-restricted | B task');
    ok('VA and no-Desk agency see no tasks', (await tasks(sVa)) === '' && (await tasks(sAdminC)) === '');

    console.log('\n━━ Opening one record: out of scope is 404 ━━');
    ok('Producer opens an assigned account', (await status(() => getInsuredForScope(prisma, sProd, iProd.id))) === 200);
    ok('Producer: unassigned account in their own agency is 404', (await status(() => getInsuredForScope(prisma, sProd, iOpen.id))) === 404);
    ok('agency A admin: agency B account is 404 (not 403)', (await status(() => getInsuredForScope(prisma, sAdminA, iB.id))) === 404);
    ok('a nonexistent id is the same 404', (await status(() => getInsuredForScope(prisma, sAdminA, randomBytes(12).toString('hex')))) === 404);
    ok('a malformed id is a 404, not a crash', (await status(() => getInsuredForScope(prisma, sAdminA, 'not-an-id'))) === 404);
    ok('policy: Producer opens P-PROD, P-OPEN is 404',
      (await status(() => getPolicyForScope(prisma, sProd, pProd.id))) === 200 && (await status(() => getPolicyForScope(prisma, sProd, pOpen.id))) === 404);
    ok('task: Producer opens their own no-account task, not the admin\'s',
      (await status(() => getTaskForScope(prisma, sProd, tOwn.id))) === 200 && (await status(() => getTaskForScope(prisma, sProd, tOther.id))) === 404);
    ok('task: backup AM of B cannot open an A task', (await status(() => getTaskForScope(prisma, sAmB, tProd.id))) === 404);
    ok('task: AM opens a restricted task in their agency', (await status(() => getTaskForScope(prisma, sAmA, tRestricted.id))) === 200);
    ok('select option returns only the chosen fields', Object.keys(await getInsuredForScope(prisma, sAdminA, iProd.id, {}, { id: true, name: true })).sort().join() === 'id,name');

    console.log('\n━━ Refusals are audited ━━');
    {
      await prisma.deskAuditLog.deleteMany({ where: { actorId: adminA.id } });
      await status(() => getTaskForScope(prisma, sAdminA, tB.id, { ip: '203.0.113.9', userAgent: 'verify' }));
      const log = await prisma.deskAuditLog.findFirst({ where: { actorId: adminA.id, action: 'access.denied' } });
      ok('the refusal is logged with who, what and the record\'s real agency',
        !!log && log.entityType === 'Task' && log.entityId === tB.id && log.agencyId === B.id && log.actorRole === 'ADMIN' && log.ipAddress === '203.0.113.9');
      await status(() => getInsuredForScope(prisma, sAdminA, 'not-an-id'));
      const bad = await prisma.deskAuditLog.findFirst({ where: { actorId: adminA.id, entityType: 'InsuredAccount' } });
      ok('a malformed id is logged too, kept as metadata', !!bad && bad.entityId === null && (bad.metadata as any)?.requestedId === 'not-an-id');
    }

    console.log('\n━━ Submitting work (D4) ━━');
    ok('Producer submits for an assigned account; agency taken from the account',
      (await resolveSubmission(prisma, sProd, { insuredId: iProd.id })).agencyId === A.id);
    ok('Producer cannot submit for an unassigned account (404)', (await status(() => resolveSubmission(prisma, sProd, { insuredId: iOpen.id }))) === 404);
    ok('Producer may submit a general request with no account', (await resolveSubmission(prisma, sProd, {})).agencyId === A.id);
    ok('an agency user cannot redirect a request to another agency',
      (await resolveSubmission(prisma, sAdminA, { agencyId: B.id })).agencyId === A.id);
    ok('a policy fills in its account', (await resolveSubmission(prisma, sProd, { policyId: pProd.id })).insuredId === iProd.id);
    ok('a policy on a different account is refused',
      (await status(() => resolveSubmission(prisma, sAdminA, { insuredId: iShared.id, policyId: pProd.id }))) === 404);
    ok('AM submits for a covered agency', (await resolveSubmission(prisma, sAmA, { agencyId: B.id })).agencyId === B.id);
    ok('AM cannot submit for an agency they do not cover', (await status(() => resolveSubmission(prisma, sAmB, { agencyId: A.id }))) === 404);
    ok('AM must name an agency or an account', (await status(() => resolveSubmission(prisma, sAmA, {}))) === 404);
    ok('Operations Manager cannot file for an agency without The Desk', (await status(() => resolveSubmission(prisma, sOps, { agencyId: C.id }))) === 404);
    ok('VA and no-Desk agency users cannot submit',
      (await status(() => resolveSubmission(prisma, sVa, {}))) === 404 && (await status(() => resolveSubmission(prisma, sAdminC, {}))) === 404);

    console.log('\n━━ Managing access ━━');
    ok('agency admin manages their own agency only', canManageAgencyAccess(sAdminA, A.id) && !canManageAgencyAccess(sAdminA, B.id));
    ok('Producer, CSR and AM cannot', !canManageAgencyAccess(sProdAll, A.id) && !canManageAgencyAccess(sCsr, A.id) && !canManageAgencyAccess(sAmA, A.id));
    ok('Operations Manager can', canManageAgencyAccess(sOps, A.id));

    console.log('\n━━ Changes apply on the next request ━━');
    await prisma.user.update({ where: { id: csrA.id }, data: { bookAccess: 'ALL' } });
    ok('granting the CSR the whole book widens their view at once', (await names(await scope(csrA))) === 'A-producer, A-shared, A-unassigned');
    await prisma.agencyDeskAssignment.update({ where: { agencyId: B.id }, data: { backupAmId: null } });
    ok('removing the backup AM removes their access', (await names(await scope(amBackupB))) === '');
    await prisma.agency.update({ where: { id: B.id }, data: { deskEnabled: false } });
    ok('switching The Desk off for B hides it from its AM', (await names(await scope(amA))) === 'A-producer, A-shared, A-unassigned');

    console.log('\n━━ Route helper ━━');
    {
      const res = deskAccessResponse(new DeskAccessError(404, 'Task 123 belongs to agency X'));
      const body = await res.json();
      ok('404 response is generic (no detail leaks)', res.status === 404 && body.error === 'Not found');
      let rethrown = false;
      try { deskAccessResponse(new Error('db down')); } catch { rethrown = true; }
      ok('other errors are rethrown, not turned into 404s', rethrown);
    }
    void tShared; void tOpen;
  } finally {
    await wipe();
    const left = await prisma.user.count({ where: { id: { in: cleanup.userIds } } }) + await prisma.agency.count({ where: { id: { in: cleanup.agencyIds } } });
    ok('temporary records removed', left === 0);
    console.log(`\n${pass} passed, ${fail} failed`);
    await prisma.$disconnect();
    process.exit(fail ? 1 : 0);
  }
})();
