/**
 * The Desk, Module 16: internal staff management.
 *
 * Inviting (rules, single-use link, no password sent, email failure), who may
 * manage whom, renaming, resending, deactivating (access gone at once, open
 * work returned, Account Manager cover) and reactivating, plus new work never
 * going to someone who has left. Email goes to a stand-in, so nothing is sent.
 * Uses temporary records only.
 * Run with:  npx tsx script/verify-desk-staff.ts
 */
import 'dotenv/config';
import type { UserRole } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { createSession, getSessionUser } from '../lib/auth';
import { DeskAccessError, resolveDeskScope } from '../lib/desk/access';
import { createTask } from '../lib/desk/tasks';
import {
  canManageRole, deactivateStaff, inviteStaff, listStaff, reactivateStaff, renameStaff, resendStaffInvite, type SendInvite,
} from '../lib/desk/staff';

let pass = 0, fail = 0;
const ok = (n: string, c: boolean) => { c ? pass++ : fail++; console.log(`  ${c ? '✓' : '✗'} ${n}`); };

const TAG = `m16test-${Date.now()}`;
const cleanup = { agencyIds: [] as string[], userIds: [] as string[] };
let ref = 970_000_000 + Math.floor(Math.random() * 1_000_000);
const mail = (n: string) => `${TAG}-${n}@example.test`;

async function wipe() {
  const staff = await prisma.user.findMany({ where: { email: { startsWith: TAG } }, select: { id: true } });
  const userIds = [...new Set([...cleanup.userIds, ...staff.map((s) => s.id)])];
  cleanup.userIds = userIds;
  const agencyId = { in: cleanup.agencyIds };
  await prisma.taskEvent.deleteMany({ where: { agencyId } });
  await prisma.task.deleteMany({ where: { agencyId } });
  await prisma.insuredAccount.deleteMany({ where: { agencyId } });
  await prisma.agencyDeskAssignment.deleteMany({ where: { agencyId } });
  await prisma.deskAuditLog.deleteMany({ where: { OR: [{ agencyId }, { actorId: { in: userIds } }, { entityId: { in: userIds } }] } });
  await prisma.activityEvent.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.inviteToken.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.agency.deleteMany({ where: { id: agencyId } });
}

(async () => {
  try {
    const mkUser = async (n: string, role: UserRole, agencyId: string | null = null, extra: object = {}) => {
      const u = await prisma.user.create({ data: { email: mail(n), role, agencyId, firstName: n, lastName: 'Test', passwordHash: 'x', ...extra } });
      cleanup.userIds.push(u.id); return u;
    };
    const mkAgency = async (n: string, deskEnabled = true) => {
      const a = await prisma.agency.create({ data: { name: `${TAG} ${n}`, deskEnabled } });
      cleanup.agencyIds.push(a.id); return a;
    };
    const sa = await mkUser('sa', 'SUPER_ADMIN');
    const ops = await mkUser('ops', 'DESK_ADMIN');
    const otherOps = await mkUser('other-ops', 'DESK_ADMIN');
    const amUser = await mkUser('am', 'ACCOUNT_MANAGER');
    const vaUser = await mkUser('va', 'DESK_VA');
    const A = await mkAgency('A');
    const adminA = await mkUser('admin-a', 'ADMIN', A.id);

    const saScope = await resolveDeskScope(prisma, sa.id);
    const opsScope = await resolveDeskScope(prisma, ops.id);
    const CTX = { ip: '203.0.113.7', userAgent: 'verify' };

    const sent: { to: string; subject: string; html: string; text?: string }[] = [];
    const send: SendInvite = async (m) => { sent.push(m); return { ok: true, id: 'stub' }; };
    const failing: SendInvite = async () => ({ ok: false, error: 'Mailbox unavailable' });

    const status = async (fn: () => Promise<unknown>) => {
      try { await fn(); return 200; } catch (e) { if (e instanceof DeskAccessError) return e.status; throw e; }
    };
    const invite = (input: object, scope = opsScope, sender = send) => inviteStaff(prisma, scope, input, CTX, sender);
    const good = (n: string, role = 'DESK_VA') => ({ email: mail(n), firstName: 'New', lastName: 'Person', role });
    const auditCount = (action: string, entityId: string) => prisma.deskAuditLog.count({ where: { action, entityId } });

    console.log('Who may manage whom');
    ok('Super Admin: all three roles', ['ACCOUNT_MANAGER', 'DESK_VA', 'DESK_ADMIN'].every((r) => canManageRole(saScope, r)));
    ok('Operations Manager: AMs and VAs', canManageRole(opsScope, 'ACCOUNT_MANAGER') && canManageRole(opsScope, 'DESK_VA'));
    ok('Operations Manager: not their peers', !canManageRole(opsScope, 'DESK_ADMIN'));
    ok('nobody manages agency users here', !canManageRole(saScope, 'ADMIN') && !canManageRole(saScope, 'SUPER_ADMIN'));
    for (const [name, id] of [['agency admin', adminA.id], ['Account Manager', amUser.id], ['VA', vaUser.id]] as const) {
      const scope = await resolveDeskScope(prisma, id);
      ok(`${name}: cannot list`, await status(() => listStaff(prisma, scope)) === 403);
      ok(`${name}: cannot invite`, await status(() => invite(good('nope'), scope)) === 403);
      ok(`${name}: cannot deactivate`, await status(() => deactivateStaff(prisma, scope, vaUser.id)) === 403);
    }
    ok('Operations Manager cannot invite an Operations Manager', await status(() => invite(good('nope', 'DESK_ADMIN'))) === 403);
    ok('Operations Manager cannot deactivate a peer', await status(() => deactivateStaff(prisma, opsScope, otherOps.id)) === 403);
    ok('Operations Manager cannot rename a peer', await status(() => renameStaff(prisma, opsScope, otherOps.id, { firstName: 'a', lastName: 'b' })) === 403);
    ok('nothing was created by the refusals', await prisma.user.count({ where: { email: mail('nope') } }) === 0);

    console.log('Invite rules');
    ok('agency roles refused', await status(() => invite(good('nope', 'ADMIN'))) === 400);
    ok('Super Admin role refused, even for a Super Admin', await status(() => invite(good('nope', 'SUPER_ADMIN'), saScope)) === 400);
    ok('bad email refused', await status(() => invite({ ...good('x'), email: 'not-an-email' })) === 400);
    ok('name required', await status(() => invite({ ...good('x'), firstName: '  ' })) === 400);
    ok('overlong name refused', await status(() => invite({ ...good('x'), lastName: 'y'.repeat(101) })) === 400);
    ok('email already used', await status(() => invite({ ...good('x'), email: mail('va') })) === 409);
    ok('same email in another case', await status(() => invite({ ...good('x'), email: mail('va').toUpperCase() })) === 409);

    console.log('Inviting');
    let r = await invite({ ...good('nina', 'ACCOUNT_MANAGER'), email: `  ${mail('nina').toUpperCase()} ` });
    const nina = await prisma.user.findUniqueOrThrow({ where: { id: r.id } });
    ok('created with a tidy email and the right role', nina.email === mail('nina') && nina.role === 'ACCOUNT_MANAGER');
    ok('belongs to no agency', nina.agencyId === null);
    ok('no password set', nina.passwordHash === null);
    ok('reported as emailed, with no link returned', r.emailSent && r.acceptUrl === undefined);
    const token = await prisma.inviteToken.findFirstOrThrow({ where: { userId: nina.id } });
    ok('link lasts about 72 hours', Math.abs(token.expiresAt.getTime() - Date.now() - 72 * 3_600_000) < 60_000);
    ok('email goes to them, with the link', sent.at(-1)!.to === mail('nina') && sent.at(-1)!.html.includes(`/invite/${token.token}`));
    ok('email names the team, not an agency', sent.at(-1)!.subject.includes('The Insurigence Desk'));
    ok('audited with who did it', await prisma.deskAuditLog.count({ where: { action: 'staff.invited', entityId: nina.id, actorId: ops.id, ipAddress: CTX.ip } }) === 1);
    const log = await prisma.deskAuditLog.findFirstOrThrow({ where: { action: 'staff.invited', entityId: nina.id } });
    ok('the link never reaches the audit log', !JSON.stringify(log.metadata).includes(token.token));
    ok('Super Admin can invite an Operations Manager', (await invite(good('olive', 'DESK_ADMIN'), saScope)).emailSent);
    r = await invite(good('failmail'), opsScope, failing);
    ok('email failure: invite still exists, link handed to the admin', !r.emailSent && r.emailError === 'Mailbox unavailable' && !!r.acceptUrl?.includes('/invite/'));
    ok('duplicate invites at the same moment: one succeeds',
      (await Promise.all([1, 2].map(() => status(() => invite(good('race')))))).sort().join() === '200,409');

    console.log('Resending');
    const oldToken = token.token;
    r = await resendStaffInvite(prisma, opsScope, nina.id, CTX, send);
    const tokens = await prisma.inviteToken.findMany({ where: { userId: nina.id } });
    ok('a new link replaces the old one', r.emailSent && tokens.length === 1 && tokens[0].token !== oldToken);
    ok('audited', await auditCount('staff.invite_resent', nina.id) === 1);
    ok('refused once the account is set up', await status(() => resendStaffInvite(prisma, opsScope, vaUser.id, CTX, send)) === 409);
    ok('agency user is not found here', await status(() => resendStaffInvite(prisma, opsScope, adminA.id, CTX, send)) === 404);

    console.log('List');
    const list = await listStaff(prisma, saScope, { q: TAG });
    const row = (id: string) => list.find((s) => s.id === id)!;
    ok('only Desk staff are listed', !list.some((s) => s.id === sa.id || s.id === adminA.id));
    ok('invite state: pending', row(nina.id).invite === 'PENDING');
    ok('invite state: accepted', row(vaUser.id).invite === 'ACCEPTED');
    await prisma.inviteToken.updateMany({ where: { userId: nina.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    ok('invite state: expired', (await listStaff(prisma, saScope, { q: mail('nina') }))[0].invite === 'EXPIRED');
    ok('role filter', (await listStaff(prisma, saScope, { q: TAG, role: 'DESK_ADMIN' })).every((s) => s.role === 'DESK_ADMIN'));
    ok('a role outside the Desk shows Desk staff only', !(await listStaff(prisma, saScope, { q: TAG, role: 'ADMIN' })).some((s) => s.role === 'ADMIN'));
    ok('no password data in the list', !JSON.stringify(list).includes('passwordHash'));
    const opsRows = await listStaff(prisma, opsScope, { q: TAG });
    ok('Operations Manager sees peers as read-only', opsRows.find((s) => s.id === otherOps.id)!.canManage === false);
    ok('marks the viewer', opsRows.find((s) => s.id === ops.id)!.isSelf);

    console.log('Renaming');
    await renameStaff(prisma, opsScope, vaUser.id, { firstName: ' Vera ', lastName: 'Ames' }, CTX);
    const renamed = await prisma.user.findUniqueOrThrow({ where: { id: vaUser.id } });
    ok('saved and trimmed', renamed.firstName === 'Vera' && renamed.lastName === 'Ames');
    ok('audited', await auditCount('staff.updated', vaUser.id) === 1);
    await renameStaff(prisma, opsScope, vaUser.id, { firstName: 'Vera', lastName: 'Ames' }, CTX);
    ok('no change, no entry', await auditCount('staff.updated', vaUser.id) === 1);
    ok('blank refused', await status(() => renameStaff(prisma, opsScope, vaUser.id, { firstName: '', lastName: 'x' })) === 400);

    // ── Deactivation fixture ──
    const leaving = await mkUser('leaving', 'ACCOUNT_MANAGER');
    const backup = await mkUser('backup', 'ACCOUNT_MANAGER');
    const leavingVa = await mkUser('leaving-va', 'DESK_VA');
    const B = await mkAgency('B');
    const C = await mkAgency('C');
    const D = await mkAgency('D (no Desk)', false);
    await prisma.agencyDeskAssignment.create({ data: { agencyId: A.id, primaryAmId: leaving.id, backupAmId: backup.id } });
    await prisma.agencyDeskAssignment.create({ data: { agencyId: B.id, primaryAmId: leaving.id } });
    await prisma.agencyDeskAssignment.create({ data: { agencyId: C.id, primaryAmId: backup.id, backupAmId: leaving.id } });
    await prisma.agencyDeskAssignment.create({ data: { agencyId: D.id, primaryAmId: leaving.id } });
    const insuredA = await prisma.insuredAccount.create({ data: { agencyId: A.id, name: `${TAG} i`, nameKey: `${TAG} i` } });
    const insuredB = await prisma.insuredAccount.create({ data: { agencyId: B.id, name: `${TAG} j`, nameKey: `${TAG} j` } });
    const mkTask = (status: string, extra: object = {}) => prisma.task.create({ data: { reference: ref++, agencyId: A.id, insuredId: insuredA.id, type: 'COI', title: 't', status, source: 'INTERNAL', createdById: ops.id, restrictedToUserIds: [], ...extra } as never });
    const inProgress = await mkTask('IN_PROGRESS', { assigneeId: leavingVa.id, startedAt: new Date() });
    const assigned = await mkTask('ASSIGNED', { assigneeId: leavingVa.id });
    const qa = await mkTask('QA_REVIEW', { assigneeId: leavingVa.id });
    const pausedAt = new Date('2026-11-02T15:00:00Z');
    const waiting = await mkTask('WAITING_ON_CARRIER', { assigneeId: leavingVa.id, slaPausedAt: pausedAt });
    const completed = await mkTask('COMPLETED', { assigneeId: leavingVa.id, completedAt: new Date() });
    const underAmA = await mkTask('NEW', { amId: leaving.id });
    const underAmB = await prisma.task.create({ data: { reference: ref++, agencyId: B.id, insuredId: insuredB.id, type: 'COI', title: 't', status: 'NEW', source: 'INTERNAL', createdById: ops.id, restrictedToUserIds: [], amId: leaving.id } });
    const task = (id: string) => prisma.task.findUniqueOrThrow({ where: { id } });

    console.log('Deactivating a VA');
    const session = await createSession(leavingVa.id);
    ok('signed in before', !!(await getSessionUser(session)));
    const pendingInvite = await invite(good('unaccepted'));
    const vaResult = await deactivateStaff(prisma, opsScope, leavingVa.id, CTX);
    ok('reports 4 tasks returned', vaResult.tasksReturned === 4);
    ok('session ended right away', await prisma.session.count({ where: { userId: leavingVa.id } }) === 0 && !(await getSessionUser(session)));
    ok('Desk access gone', (await resolveDeskScope(prisma, leavingVa.id)).kind === 'NONE');
    let t = await task(inProgress.id);
    ok('in-progress work returns to the queue', t.status === 'NEW' && t.assigneeId === null);
    t = await task(assigned.id);
    ok('assigned work returns to the queue', t.status === 'NEW' && t.assigneeId === null);
    t = await task(qa.id);
    ok('QA work returns to the queue', t.status === 'NEW' && t.assigneeId === null);
    t = await task(waiting.id);
    ok('waiting work keeps waiting, clock still stopped', t.status === 'WAITING_ON_CARRIER' && t.assigneeId === null && t.slaPausedAt?.getTime() === pausedAt.getTime());
    t = await task(completed.id);
    ok('completed work keeps who did it', t.status === 'COMPLETED' && t.assigneeId === leavingVa.id);
    const events = await prisma.taskEvent.findMany({ where: { taskId: inProgress.id, kind: 'UNASSIGNED' } });
    ok('task history records it', events.length === 1 && events[0].actorId === ops.id && events[0].fromStatus === 'IN_PROGRESS' && events[0].toStatus === 'NEW');
    const waitEvents = await prisma.taskEvent.findMany({ where: { taskId: waiting.id, kind: 'UNASSIGNED' } });
    ok('history shows no status change on waiting work', waitEvents.length === 1 && waitEvents[0].toStatus === null);
    ok('audited with the count', await prisma.deskAuditLog.count({ where: { action: 'staff.deactivated', entityId: leavingVa.id, actorId: ops.id } }) === 1);
    ok('deactivating twice refused', await status(() => deactivateStaff(prisma, opsScope, leavingVa.id)) === 409);
    ok('a Super Admin is not managed here', await status(() => deactivateStaff(prisma, saScope, sa.id)) === 404);
    ok('an Operations Manager cannot remove themselves', await status(() => deactivateStaff(prisma, opsScope, ops.id)) === 403);
    ok('agency user is not found here', await status(() => deactivateStaff(prisma, saScope, adminA.id)) === 404);
    const pendingUser = pendingInvite.id;
    await deactivateStaff(prisma, opsScope, pendingUser, CTX);
    ok('an unused invite link stops working', await prisma.inviteToken.count({ where: { userId: pendingUser } }) === 0);

    console.log('Deactivating an Account Manager');
    const amResult = await deactivateStaff(prisma, opsScope, leaving.id, CTX);
    ok('agency with a backup is not flagged', !amResult.agenciesWithoutAm.includes(`${TAG} A`));
    ok('agency with nobody left is flagged', amResult.agenciesWithoutAm.includes(`${TAG} B`));
    ok('agency where they were only backup is not flagged', !amResult.agenciesWithoutAm.includes(`${TAG} C`));
    ok('agency without The Desk is not flagged', !amResult.agenciesWithoutAm.includes(`${TAG} D (no Desk)`));
    ok('open work moves to the backup', (await task(underAmA.id)).amId === backup.id);
    ok('open work with nobody left has no AM', (await task(underAmB.id)).amId === null);
    const row2 = await prisma.agencyDeskAssignment.findUniqueOrThrow({ where: { agencyId: A.id } });
    ok('assignment stays on record', row2.primaryAmId === leaving.id);

    console.log('New work skips someone who has left');
    const creator = await resolveDeskScope(prisma, ops.id);
    const viaBackup = await createTask(prisma, creator, { type: 'COI', title: 'new', insuredId: insuredA.id }, CTX);
    ok('goes to the active backup', viaBackup.amId === backup.id);
    const viaNobody = await createTask(prisma, creator, { type: 'COI', title: 'new', insuredId: insuredB.id }, CTX);
    ok('or to no Account Manager, never to them', viaNobody.amId === null);

    console.log('Reactivating');
    await reactivateStaff(prisma, opsScope, leaving.id, CTX);
    const back = await resolveDeskScope(prisma, leaving.id);
    ok('assignments come back with them', back.kind === 'ACCOUNT_MANAGER' && back.agencyIds.includes(A.id) && back.agencyIds.includes(B.id));
    ok('audited', await auditCount('staff.reactivated', leaving.id) === 1);
    ok('reactivating twice refused', await status(() => reactivateStaff(prisma, opsScope, leaving.id)) === 409);
    ok('Operations Manager cannot reactivate a peer', await status(() => reactivateStaff(prisma, opsScope, otherOps.id)) === 403);
    ok('resend refused while inactive', await status(() => resendStaffInvite(prisma, opsScope, pendingUser, CTX, send)) === 409);
    await reactivateStaff(prisma, opsScope, pendingUser, CTX);
    r = await resendStaffInvite(prisma, opsScope, pendingUser, CTX, send);
    ok('reactivated before accepting: a new invite can go out', r.emailSent && await prisma.inviteToken.count({ where: { userId: pendingUser } }) === 1);
  } catch (e) {
    fail++;
    console.error(e);
  } finally {
    await wipe();
    const left = await prisma.user.count({ where: { email: { startsWith: TAG } } }) + await prisma.agency.count({ where: { id: { in: cleanup.agencyIds } } });
    ok('temporary records removed', left === 0);
    console.log(`\n${pass} passed, ${fail} failed`);
    await prisma.$disconnect();
    process.exit(fail ? 1 : 0);
  }
})();
