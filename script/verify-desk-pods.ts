/**
 * The Desk, Module 17: pod management.
 *
 * Creating and editing pods, members, agency authorization (none / whole pod /
 * named VAs), VA sensitive-data permissions, what each change does to real VA
 * access and to tasks a VA can no longer see, and the older Super Admin users
 * route following the same deactivation rules. Uses temporary records only.
 * Run with:  npx tsx script/verify-desk-pods.ts
 */
import 'dotenv/config';
import { NextRequest } from 'next/server';
import type { UserRole } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { createSession } from '../lib/auth';
import { DeskAccessError, resolveDeskScope, taskWhere, type DeskScope } from '../lib/desk/access';
import {
  addPodMember, createPod, getAgencyPodAccess, GRANTABLE_SENSITIVITIES, listPods, listVaPermissions,
  removePodMember, setAgencyPodAccess, setVaPermissions, updatePod,
} from '../lib/desk/pod-admin';
import { DEFAULT_PODS } from '../lib/desk/pods';
import { DELETE as usersDelete, PATCH as usersPatch } from '../app/api/super-admin/users/[userId]/route';

let pass = 0, fail = 0;
const ok = (n: string, c: boolean) => { c ? pass++ : fail++; console.log(`  ${c ? '✓' : '✗'} ${n}`); };

const TAG = `m17test-${Date.now()}`;
const cleanup = { agencyIds: [] as string[], userIds: [] as string[], podIds: [] as string[], ruleIds: [] as string[] };
let ref = 980_000_000 + Math.floor(Math.random() * 1_000_000);

async function wipe() {
  const agencyId = { in: cleanup.agencyIds };
  const podId = { in: cleanup.podIds };
  await prisma.taskEvent.deleteMany({ where: { agencyId } });
  await prisma.task.updateMany({ where: { agencyId }, data: { parentTaskId: null } });
  await prisma.task.deleteMany({ where: { agencyId } });
  await prisma.insuredAccount.deleteMany({ where: { agencyId } });
  await prisma.taskRoutingRule.deleteMany({ where: { id: { in: cleanup.ruleIds } } });
  await prisma.agencyPodAccess.deleteMany({ where: { OR: [{ agencyId }, { podId }] } });
  await prisma.podMember.deleteMany({ where: { podId } });
  await prisma.deskAuditLog.deleteMany({ where: { OR: [{ agencyId }, { actorId: { in: cleanup.userIds } }, { entityId: { in: [...cleanup.podIds, ...cleanup.userIds] } }] } });
  await prisma.deskStaffPermission.deleteMany({ where: { userId: { in: cleanup.userIds } } });
  await prisma.activityEvent.deleteMany({ where: { userId: { in: cleanup.userIds } } });
  await prisma.session.deleteMany({ where: { userId: { in: cleanup.userIds } } });
  await prisma.pod.deleteMany({ where: { OR: [{ id: podId }, { name: { startsWith: TAG } }] } });
  await prisma.user.deleteMany({ where: { id: { in: cleanup.userIds } } });
  await prisma.agency.deleteMany({ where: { id: agencyId } });
}

(async () => {
  try {
    const mkUser = async (n: string, role: UserRole, agencyId: string | null = null) => {
      const u = await prisma.user.create({ data: { email: `${TAG}-${n}@example.test`, role, agencyId, firstName: n, passwordHash: 'x' } });
      cleanup.userIds.push(u.id); return u;
    };
    const mkAgency = async (n: string) => {
      const a = await prisma.agency.create({ data: { name: `${TAG} ${n}`, deskEnabled: true } });
      cleanup.agencyIds.push(a.id); return a;
    };
    const sa = await mkUser('sa', 'SUPER_ADMIN');
    const ops = await mkUser('ops', 'DESK_ADMIN');
    const am = await mkUser('am', 'ACCOUNT_MANAGER');
    const va1 = await mkUser('va1', 'DESK_VA');
    const va2 = await mkUser('va2', 'DESK_VA');
    const outsider = await mkUser('outsider', 'DESK_VA');
    const A = await mkAgency('A');
    const B = await mkAgency('B');
    const agencyAdmin = await mkUser('admin-a', 'ADMIN', A.id);
    const scope = await resolveDeskScope(prisma, ops.id);
    const CTX = { ip: '203.0.113.5', userAgent: 'verify' };

    const status = async (fn: () => Promise<unknown>) => {
      try { await fn(); return 200; } catch (e) { if (e instanceof DeskAccessError) return e.status; throw e; }
    };
    const message = async (fn: () => Promise<unknown>) => {
      try { await fn(); return ''; } catch (e) { if (e instanceof DeskAccessError) return e.message; throw e; }
    };
    const grants = async (userId: string) => {
      const s = await resolveDeskScope(prisma, userId);
      return s.kind === 'VA' ? s.grants : [];
    };
    const audited = (action: string, entityId: string) => prisma.deskAuditLog.count({ where: { action, entityId } });

    console.log('Who may do this');
    for (const [name, id] of [['agency admin', agencyAdmin.id], ['Account Manager', am.id], ['VA', va1.id]] as const) {
      const s = await resolveDeskScope(prisma, id);
      ok(`${name}: cannot list pods`, await status(() => listPods(prisma, s)) === 403);
      ok(`${name}: cannot create a pod`, await status(() => createPod(prisma, s, { name: `${TAG} no` })) === 403);
      ok(`${name}: cannot change agency access`, await status(() => setAgencyPodAccess(prisma, s, A.id, { podId: 'x', mode: 'NONE' })) === 403);
      ok(`${name}: cannot change VA permissions`, await status(() => setVaPermissions(prisma, s, va1.id, ['FINANCIAL'])) === 403);
    }

    console.log('Pods');
    ok('name required', await status(() => createPod(prisma, scope, { name: '  ' })) === 400);
    ok('overlong name refused', await status(() => createPod(prisma, scope, { name: 'x'.repeat(101) })) === 400);
    const { id: podId } = await createPod(prisma, scope, { name: `${TAG} Pod One`, description: ' Things ' }, CTX);
    cleanup.podIds.push(podId);
    const stored = await prisma.pod.findUniqueOrThrow({ where: { id: podId } });
    ok('created, trimmed, active', stored.isActive && stored.description === 'Things');
    ok('audited', await audited('pod.created', podId) === 1);
    ok('duplicate name refused, ignoring case', await status(() => createPod(prisma, scope, { name: `${TAG} POD ONE` })) === 409);
    const { id: otherPodId } = await createPod(prisma, scope, { name: `${TAG} Pod Two` }, CTX);
    cleanup.podIds.push(otherPodId);
    ok('rename onto another pod refused', await status(() => updatePod(prisma, scope, otherPodId, { name: `${TAG} Pod One` })) === 409);
    await updatePod(prisma, scope, podId, { name: `${TAG} Pod Renamed` }, CTX);
    const renamed = await prisma.pod.findUniqueOrThrow({ where: { id: podId } });
    ok('rename keeps the permanent code', renamed.name === `${TAG} Pod Renamed` && renamed.code === stored.code);
    const before = await audited('pod.updated', podId);
    await updatePod(prisma, scope, podId, { name: `${TAG} Pod Renamed`, description: 'Things', isActive: true }, CTX);
    ok('no change, no audit entry', await audited('pod.updated', podId) === before);
    ok('unknown pod: 404', await status(() => updatePod(prisma, scope, '507f1f77bcf86cd799439011', { name: 'x' })) === 404);
    ok('malformed pod: 404', await status(() => updatePod(prisma, scope, 'nope', { name: 'x' })) === 404);

    console.log('Members');
    ok('agency user refused', await status(() => addPodMember(prisma, scope, podId, agencyAdmin.id)) === 400);
    ok('Operations Manager refused', await status(() => addPodMember(prisma, scope, podId, ops.id)) === 400);
    ok('unknown user refused', await status(() => addPodMember(prisma, scope, podId, '507f1f77bcf86cd799439011')) === 400);
    await addPodMember(prisma, scope, podId, va1.id, CTX);
    await addPodMember(prisma, scope, podId, va2.id, CTX);
    await addPodMember(prisma, scope, podId, am.id, CTX);
    ok('VAs and Account Managers added, audited', await audited('pod.member_added', podId) === 3);
    ok('adding twice refused', await status(() => addPodMember(prisma, scope, podId, va1.id)) === 409);
    const listed = await listPods(prisma, scope);
    const mine = listed.pods.find((p) => p.id === podId)!;
    ok('listed with members and role labels', mine.members.length === 3 && mine.members.some((m) => m.id === am.id && m.roleLabel === 'Account Manager'));
    ok('choices exclude agency users and Operations Managers', !listed.eligible.some((u) => u.id === agencyAdmin.id || u.id === ops.id));

    console.log('Agency access');
    ok('in a pod but no agency authorized: no access', (await grants(va1.id)).length === 0);
    const access = (agencyId: string, mode: string, userIds?: string[], pod = podId) => setAgencyPodAccess(prisma, scope, agencyId, { podId: pod, mode, userIds }, CTX);
    ok('unknown agency: 404', await status(() => access('507f1f77bcf86cd799439011', 'WHOLE')) === 404);
    ok('unknown pod refused', await status(() => access(A.id, 'WHOLE', [], '507f1f77bcf86cd799439011')) === 400);
    ok('unknown mode refused', await status(() => access(A.id, 'SOME')) === 400);
    await access(A.id, 'WHOLE');
    ok('whole pod: both VAs reach the agency', (await grants(va1.id)).some((g) => g.agencyId === A.id) && (await grants(va2.id)).some((g) => g.agencyId === A.id));
    ok('stored as one row with no user', await prisma.agencyPodAccess.count({ where: { agencyId: A.id, podId } }) === 1);
    ok('not the other agency', !(await grants(va1.id)).some((g) => g.agencyId === B.id));
    ok('audited against the agency', await prisma.deskAuditLog.count({ where: { action: 'pod.access_changed', agencyId: A.id } }) === 1);
    let view = (await getAgencyPodAccess(prisma, scope, A.id)).pods.find((p) => p.id === podId)!;
    ok('form reads it back as whole pod', view.mode === 'WHOLE' && view.userIds.length === 0);
    ok('form offers VAs only', view.vas.length === 2 && !view.vas.some((v) => v.id === am.id));
    await access(A.id, 'WHOLE');
    ok('saving unchanged writes nothing', await prisma.deskAuditLog.count({ where: { action: 'pod.access_changed', agencyId: A.id } }) === 1);

    ok('named: needs someone', await status(() => access(A.id, 'NAMED', [])) === 400);
    ok('named: must be in the pod', await status(() => access(A.id, 'NAMED', [outsider.id])) === 400);
    ok('named: Account Manager refused', await status(() => access(A.id, 'NAMED', [am.id])) === 400);
    ok('named: malformed id refused', await status(() => access(A.id, 'NAMED', ['nope'])) === 400);
    await access(A.id, 'NAMED', [va1.id, va1.id]);
    ok('named: only that VA keeps the agency', (await grants(va1.id)).some((g) => g.agencyId === A.id) && !(await grants(va2.id)).some((g) => g.agencyId === A.id));
    ok('named: duplicates collapse, whole-pod row gone', await prisma.agencyPodAccess.count({ where: { agencyId: A.id, podId } }) === 1);
    view = (await getAgencyPodAccess(prisma, scope, A.id)).pods.find((p) => p.id === podId)!;
    ok('form reads it back as named', view.mode === 'NAMED' && view.userIds.join() === va1.id);
    await access(A.id, 'NONE');
    ok('not authorized: access gone', (await grants(va1.id)).length === 0);
    ok('not authorized: no rows left', await prisma.agencyPodAccess.count({ where: { agencyId: A.id, podId } }) === 0);

    console.log('Work follows access');
    const insured = await prisma.insuredAccount.create({ data: { agencyId: A.id, name: `${TAG} i`, nameKey: `${TAG} i` } });
    const mkTask = (data: object) => prisma.task.create({ data: { reference: ref++, agencyId: A.id, insuredId: insured.id, podId, type: 'COI', title: 't', source: 'INTERNAL', createdById: ops.id, restrictedToUserIds: [], ...data } as never });
    const task = (id: string) => prisma.task.findUniqueOrThrow({ where: { id } });
    const canSee = async (userId: string, id: string) => (await prisma.task.count({ where: { AND: [{ id }, taskWhere(await resolveDeskScope(prisma, userId) as DeskScope)] } })) === 1;
    await access(A.id, 'WHOLE');
    const t1 = await mkTask({ status: 'IN_PROGRESS', assigneeId: va1.id });
    const t2 = await mkTask({ status: 'IN_PROGRESS', assigneeId: va2.id });
    const pausedAt = new Date('2026-11-02T15:00:00Z');
    const t3 = await mkTask({ status: 'WAITING_ON_CARRIER', assigneeId: va2.id, slaPausedAt: pausedAt });
    const tDone = await mkTask({ status: 'COMPLETED', assigneeId: va2.id, completedAt: new Date(), billingClass: 'NON_BILLABLE' });
    const tAm = await mkTask({ status: 'IN_PROGRESS', assigneeId: am.id });
    ok('both VAs see their work', await canSee(va1.id, t1.id) && await canSee(va2.id, t2.id));
    let r = await access(A.id, 'NAMED', [va1.id]);
    ok('narrowing to one VA returns the other VA\'s work', r.tasksReturned === 2);
    let t = await task(t2.id);
    ok('in-progress restarts as New', t.status === 'NEW' && t.assigneeId === null);
    t = await task(t3.id);
    ok('waiting stays waiting, clock still stopped', t.status === 'WAITING_ON_CARRIER' && t.assigneeId === null && t.slaPausedAt?.getTime() === pausedAt.getTime());
    t = await task(t1.id);
    ok('the named VA keeps theirs', t.status === 'IN_PROGRESS' && t.assigneeId === va1.id);
    ok('completed work keeps who did it', (await task(tDone.id)).assigneeId === va2.id);
    ok('Account Manager keeps theirs (access is by agency)', (await task(tAm.id)).assigneeId === am.id);
    const events = await prisma.taskEvent.findMany({ where: { taskId: t2.id, kind: 'UNASSIGNED' } });
    ok('task history records why', events.length === 1 && (events[0].metadata as { automatic?: string }).automatic === 'pod_access_changed');
    const log = await prisma.deskAuditLog.findFirstOrThrow({ where: { action: 'pod.access_changed', agencyId: A.id }, orderBy: { createdAt: 'desc' } });
    const meta = log.metadata as { from: { mode: string }; to: { mode: string }; tasksReturned: number };
    ok('audit records before, after and work returned', meta.from.mode === 'WHOLE' && meta.to.mode === 'NAMED' && meta.tasksReturned === 2);

    await prisma.task.update({ where: { id: t2.id }, data: { assigneeId: va1.id, status: 'ASSIGNED' } });
    r = await access(A.id, 'NONE');
    ok('removing the agency returns all VA work', r.tasksReturned === 2 && (await task(t1.id)).assigneeId === null && (await task(t2.id)).assigneeId === null);
    ok('Account Manager\'s work untouched', (await task(tAm.id)).assigneeId === am.id);

    await access(A.id, 'WHOLE');
    await access(B.id, 'NAMED', [va1.id]);
    const t4 = await mkTask({ status: 'IN_PROGRESS', assigneeId: va1.id });
    const r2 = await removePodMember(prisma, scope, podId, va1.id, CTX);
    ok('removing a member returns their work in that pod', r2.tasksReturned === 1 && (await task(t4.id)).assigneeId === null);
    ok('they lose the pod\'s agencies', (await grants(va1.id)).length === 0);
    ok('their named access goes too', await prisma.agencyPodAccess.count({ where: { agencyId: B.id, podId, userId: va1.id } }) === 0);
    await addPodMember(prisma, scope, podId, va1.id, CTX);
    ok('adding them back does not restore named access', !(await grants(va1.id)).some((g) => g.agencyId === B.id));
    ok('but whole-pod access applies again', (await grants(va1.id)).some((g) => g.agencyId === A.id));
    ok('removing someone not in the pod refused', await status(() => removePodMember(prisma, scope, podId, outsider.id)) === 409);
    ok('audited', await audited('pod.member_removed', podId) === 1);
    await prisma.task.update({ where: { id: t4.id }, data: { assigneeId: am.id, status: 'IN_PROGRESS' } });
    const rAm = await removePodMember(prisma, scope, podId, am.id, CTX);
    ok('removing an Account Manager leaves their work with them', rAm.tasksReturned === 0 && (await task(t4.id)).assigneeId === am.id);

    console.log('Switching a pod off');
    // Never aimed at a seeded pod: if the guard ever failed, this write would
    // switch off a real pod in the shared database. The routing count is
    // simulated, on a temporary pod.
    const routed = new Proxy(prisma, {
      get(target, key) {
        const value = Reflect.get(target, key);
        if (key === 'taskRoutingRule') return { count: async () => 2 };
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    ok('refused while request types route to it', (await message(() => updatePod(routed, scope, otherPodId, { isActive: false }))).includes('2 request types routed here'));
    await prisma.pod.update({ where: { id: otherPodId }, data: { isActive: true } });
    ok('refused while requests are open, with the count', /\d+ open requests?/.test(await message(() => updatePod(prisma, scope, podId, { isActive: false }))));
    await updatePod(prisma, scope, otherPodId, { isActive: false }, CTX);
    ok('allowed when unused', !(await prisma.pod.findUniqueOrThrow({ where: { id: otherPodId } })).isActive);
    ok('members cannot be added to it', await status(() => addPodMember(prisma, scope, otherPodId, va1.id)) === 409);
    ok('agencies cannot be authorized for it', await status(() => access(A.id, 'WHOLE', [], otherPodId)) === 409);
    ok('it is not offered for agency access', !(await getAgencyPodAccess(prisma, scope, A.id)).pods.some((p) => p.id === otherPodId));
    await updatePod(prisma, scope, otherPodId, { isActive: true }, CTX);
    ok('can be switched back on', (await prisma.pod.findUniqueOrThrow({ where: { id: otherPodId } })).isActive);

    ok('every seeded pod is still active', await prisma.pod.count({ where: { code: { in: DEFAULT_PODS.map((p) => p.code) }, isActive: true } }) === DEFAULT_PODS.length);

    console.log('VA permissions');
    ok('only categories that need a grant are offered', GRANTABLE_SENSITIVITIES.join() === 'FINANCIAL,PERSONAL');
    const sens = async (id: string) => { const s = await resolveDeskScope(prisma, id); return s.kind === 'VA' ? s.sensitivities : []; };
    ok('before: defaults only', (await sens(va1.id)).sort().join() === 'GENERAL,POLICY');
    await setVaPermissions(prisma, scope, va1.id, ['FINANCIAL'], CTX);
    ok('granted: applies right away', (await sens(va1.id)).includes('FINANCIAL') && !(await sens(va1.id)).includes('PERSONAL'));
    ok('other VAs unaffected', !(await sens(va2.id)).includes('FINANCIAL'));
    const permLog = await prisma.deskAuditLog.findFirstOrThrow({ where: { action: 'permission.changed', entityId: va1.id } });
    ok('audited with before and after', JSON.stringify(permLog.metadata).includes('FINANCIAL') && permLog.actorId === ops.id);
    ok('records who granted it', (await prisma.deskStaffPermission.findUniqueOrThrow({ where: { userId: va1.id } })).grantedById === ops.id);
    await setVaPermissions(prisma, scope, va1.id, ['FINANCIAL'], CTX);
    ok('same again: no entry', await audited('permission.changed', va1.id) === 1);
    await setVaPermissions(prisma, scope, va1.id, [], CTX);
    ok('revoked: applies right away, defaults remain', (await sens(va1.id)).sort().join() === 'GENERAL,POLICY');
    ok('default categories are not grantable', await status(() => setVaPermissions(prisma, scope, va1.id, ['GENERAL'])) === 400);
    ok('unknown category refused', await status(() => setVaPermissions(prisma, scope, va1.id, ['SECRET'])) === 400);
    ok('non-list refused', await status(() => setVaPermissions(prisma, scope, va1.id, 'FINANCIAL')) === 400);
    ok('Account Manager is not a VA here: 404', await status(() => setVaPermissions(prisma, scope, am.id, ['FINANCIAL'])) === 404);
    ok('agency user: 404', await status(() => setVaPermissions(prisma, scope, agencyAdmin.id, ['FINANCIAL'])) === 404);
    ok('list shows VAs only', (await listVaPermissions(prisma, scope)).every((v) => v.id !== am.id && v.id !== ops.id));

    console.log('Older Super Admin users route');
    const saSession = await createSession(sa.id);
    const leaver1 = await mkUser('leaver1', 'DESK_VA');
    const leaver2 = await mkUser('leaver2', 'DESK_VA');
    const usersReq = (id: string, method: string, body?: object) => new NextRequest(`http://localhost/api/super-admin/users/${id}`, {
      method, body: body ? JSON.stringify(body) : undefined, headers: { 'content-type': 'application/json', cookie: `session_token=${saSession}` },
    });
    const params = (userId: string) => ({ params: Promise.resolve({ userId }) });
    await addPodMember(prisma, scope, podId, leaver1.id, CTX);
    const tL1 = await mkTask({ status: 'IN_PROGRESS', assigneeId: leaver1.id });
    const leaverSession = await createSession(leaver1.id);
    const patched = await usersPatch(usersReq(leaver1.id, 'PATCH', { isActive: false }), params(leaver1.id));
    ok('PATCH responds normally', patched.status === 200 && (await patched.json()).user.isActive === false);
    ok('PATCH returns their work to the queue', (await task(tL1.id)).assigneeId === null && (await task(tL1.id)).status === 'NEW');
    ok('PATCH ends their session', await prisma.session.count({ where: { token: leaverSession } }) === 0);
    ok('PATCH is in the Desk audit log', await audited('staff.deactivated', leaver1.id) === 1);
    const enabled = await usersPatch(usersReq(leaver1.id, 'PATCH', { isActive: true }), params(leaver1.id));
    ok('PATCH can reactivate', enabled.status === 200 && (await enabled.json()).user.isActive === true && await audited('staff.reactivated', leaver1.id) === 1);
    const tL2 = await mkTask({ status: 'ASSIGNED', assigneeId: leaver2.id });
    const deleted = await usersDelete(usersReq(leaver2.id, 'DELETE'), params(leaver2.id));
    ok('DELETE does the same', deleted.status === 200 && (await task(tL2.id)).assigneeId === null && await audited('staff.deactivated', leaver2.id) === 1);
    const renamedVia = await usersPatch(usersReq(va2.id, 'PATCH', { firstName: 'Vee' }), params(va2.id));
    ok('other edits still work', renamedVia.status === 200 && (await prisma.user.findUniqueOrThrow({ where: { id: va2.id } })).firstName === 'Vee');
    const agencyUser = await mkUser('agency-user', 'AGENT', A.id);
    const off = await usersPatch(usersReq(agencyUser.id, 'PATCH', { isActive: false }), params(agencyUser.id));
    ok('agency users keep the existing behaviour', off.status === 200 && !(await prisma.user.findUniqueOrThrow({ where: { id: agencyUser.id } })).isActive && await audited('staff.deactivated', agencyUser.id) === 0);
  } catch (e) {
    fail++;
    console.error(e);
  } finally {
    await wipe();
    const left = await prisma.user.count({ where: { email: { startsWith: TAG } } }) + await prisma.agency.count({ where: { id: { in: cleanup.agencyIds } } }) + await prisma.pod.count({ where: { name: { startsWith: TAG } } });
    ok('temporary records removed', left === 0);
    console.log(`\n${pass} passed, ${fail} failed`);
    await prisma.$disconnect();
    process.exit(fail ? 1 : 0);
  }
})();
