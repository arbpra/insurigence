/**
 * The Desk, Module 23: agency user permissions and assigning staff.
 *
 * Who may change whom, that a change really changes what someone sees, that an
 * agency always keeps an admin, and that bulk assignment stays inside the agency
 * and is all or nothing. Temporary agencies and users only.
 * Run with:  npx tsx script/verify-desk-team.ts
 */
import 'dotenv/config';
import { readFileSync } from 'fs';
import { NextRequest } from 'next/server';
import type { PrismaClient, UserRole } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { createSession } from '../lib/auth';
import { DeskAccessError, resolveDeskScope } from '../lib/desk/access';
import { assignableForInsured, createInsured, getInsured, listInsureds } from '../lib/desk/book';
import { itemAllowed } from '../lib/desk/navigation';
import { bulkAssign, getTeamMember, listTeam, updateTeamMember } from '../lib/desk/team';
import {
  MAX_BULK_ASSIGN, accessSummary, allSelected, bulkDoneMessage, bulkRequestBody, memberAccountsQuery, toggleOne, togglePage,
} from '../lib/desk/team-form';
import { GET as teamRoute } from '../app/api/desk/team/route';
import { GET as memberRoute, PATCH as memberPatchRoute } from '../app/api/desk/team/[userId]/route';
import { POST as bulkRoute } from '../app/api/desk/team/[userId]/assignments/route';
import { GET as assignableRoute } from '../app/api/desk/insureds/[id]/assignments/route';
import { GET as listRoute } from '../app/api/desk/insureds/route';

let pass = 0, fail = 0;
const ok = (n: string, c: boolean) => { c ? pass++ : fail++; console.log(`  ${c ? '✓' : '✗'} ${n}`); };

const TAG = `m23test${Date.now()}`;
const cleanup = { agencyIds: [] as string[], userIds: [] as string[], podIds: [] as string[] };
const read = (p: string) => readFileSync(p, 'utf8');

async function wipe() {
  const agencyId = { in: cleanup.agencyIds };
  await prisma.task.deleteMany({ where: { agencyId } });
  await prisma.insuredAssignment.deleteMany({ where: { agencyId } });
  await prisma.insuredAccount.deleteMany({ where: { agencyId } });
  await prisma.agencyPodAccess.deleteMany({ where: { agencyId } });
  await prisma.podMember.deleteMany({ where: { podId: { in: cleanup.podIds } } });
  await prisma.pod.deleteMany({ where: { id: { in: cleanup.podIds } } });
  await prisma.agencyDeskAssignment.deleteMany({ where: { agencyId } });
  await prisma.deskAuditLog.deleteMany({ where: { OR: [{ agencyId }, { actorId: { in: cleanup.userIds } }] } });
  await prisma.session.deleteMany({ where: { userId: { in: cleanup.userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: cleanup.userIds } } });
  await prisma.agency.deleteMany({ where: { id: agencyId } });
}

function pureLogic() {
  console.log('The screens\' logic');
  ok('an admin is told they see everything', accessSummary('ADMIN', 'ALL').includes('every account'));
  ok('whole-book access says so', accessSummary('AGENT', 'ALL').includes('whole-book'));
  ok('assigned only says assigning changes what they see', accessSummary('CSR', 'ASSIGNED').includes('only the accounts assigned'));
  const params = (s: string) => new URLSearchParams(s);
  const u = 'a'.repeat(24);
  ok('their accounts, any status', params(memberAccountsQuery(u, 'ASSIGNED', '', 1)).get('assignedTo') === u && !params(memberAccountsQuery(u, 'ASSIGNED', '', 1)).has('status'));
  ok('accounts to add: active ones not theirs', params(memberAccountsQuery(u, 'NOT_ASSIGNED', '', 1)).get('notAssignedTo') === u && params(memberAccountsQuery(u, 'NOT_ASSIGNED', '', 1)).get('status') === 'ACTIVE');
  ok('all accounts: active ones', !params(memberAccountsQuery(u, 'ALL', '', 1)).has('assignedTo') && params(memberAccountsQuery(u, 'ALL', '', 1)).get('status') === 'ACTIVE');
  ok('search and page carried, special characters intact', params(memberAccountsQuery(u, 'ALL', ' A&B (x) ', 3)).get('q') === 'A&B (x)' && params(memberAccountsQuery(u, 'ALL', '', 3)).get('page') === '3');
  const picked = new Set(['x']);
  ok('ticking a page adds to what is ticked', [...togglePage(picked, ['a', 'b'])].sort().join() === 'a,b,x');
  ok('ticking a full page again clears only that page', [...togglePage(new Set(['a', 'b', 'x']), ['a', 'b'])].join() === 'x');
  ok('a part-ticked page fills first', togglePage(new Set(['a']), ['a', 'b']).size === 2);
  ok('one row toggles', toggleOne(new Set(), 'a').has('a') && !toggleOne(new Set(['a']), 'a').has('a'));
  ok('the original is left alone', picked.size === 1);
  ok('an empty page is never "all selected"', !allSelected(new Set(['a']), []));
  ok('ticked rows are sent as ids', JSON.stringify(bulkRequestBody('assign', { kind: 'IDS', ids: ['a'] }, 'SERVICE')) === '{"action":"assign","role":"SERVICE","insuredIds":["a"]}');
  ok('a removal sends no role', !('role' in bulkRequestBody('unassign', { kind: 'IDS', ids: ['a'] }, 'SERVICE')));
  ok('everything in the list is sent as the list', JSON.stringify(bulkRequestBody('unassign', { kind: 'MATCHING', view: 'ASSIGNED', q: ' x ' })) === '{"action":"unassign","matching":{"view":"ASSIGNED","q":"x"}}');
  ok('the result reads properly', bulkDoneMessage('assign', 1) === '1 account assigned.' && bulkDoneMessage('unassign', 1200) === '1,200 accounts removed.' && bulkDoneMessage('assign', 0).includes('already'));

  console.log('The screens');
  ok('the shared logic imports nothing', !/^import /m.test(read('lib/desk/team-form.ts')));
  for (const [p, allowed] of [
    ['app/components/desk/team/TeamList.tsx', /from '(react|next\/link|@\/lib\/desk\/team-form|\.\.\/accounts\/account-api)'/],
    ['app/components/desk/team/MemberAccounts.tsx', /from '(react|next\/link|@\/lib\/desk\/team-form|\.\.\/accounts\/account-api)'/],
    ['app/components/desk/accounts/AssignedStaff.tsx', /from '(react|@\/lib\/desk\/team-form|\.\/account-api)'/],
  ] as const) {
    const imports = read(p).match(/^import [^;]+;/gm) ?? [];
    ok(`${p.split('/').pop()}: browser code, only React, Next and shared logic`, read(p).startsWith("'use client'") && imports.every((i) => allowed.test(i)));
  }
  for (const p of ['app/(desk)/desk/team/page.tsx', 'app/(desk)/desk/team/[id]/page.tsx']) {
    ok(`${p.replace('app/(desk)/desk/', '')} checks access on the server`, read(p).includes("deskPageAccess('AGENCY', '/desk/team')"));
  }
  ok('Team access is for admins', itemAllowed('/desk/team', 'ADMIN') && !itemAllowed('/desk/team', 'AGENT') && !itemAllowed('/desk/team', 'CSR'));
}

(async () => {
  try {
    pureLogic();

    const mkAgency = async (n: string) => { const a = await prisma.agency.create({ data: { name: `${TAG} ${n}`, deskEnabled: true } }); cleanup.agencyIds.push(a.id); return a; };
    const mkUser = async (n: string, role: UserRole, agencyId: string | null = null, extra: object = {}) => {
      const u = await prisma.user.create({ data: { email: `${TAG}-${n}@example.test`, role, agencyId, firstName: n, passwordHash: `secret-${TAG}`, mustChangePassword: false, ...extra } });
      cleanup.userIds.push(u.id); return u;
    };
    const A = await mkAgency('A');
    const B = await mkAgency('B');
    const admin = await mkUser('admin', 'ADMIN', A.id);
    const admin2 = await mkUser('admin2', 'ADMIN', A.id);
    const producer = await mkUser('producer', 'AGENT', A.id);
    const csr = await mkUser('csr', 'CSR', A.id);
    const invited = await mkUser('invited', 'AGENT', A.id, { passwordHash: null });
    const left = await mkUser('left', 'AGENT', A.id, { isActive: false });
    const adminB = await mkUser('admin-b', 'ADMIN', B.id);
    const producerB = await mkUser('producer-b', 'AGENT', B.id);
    const am = await mkUser('am', 'ACCOUNT_MANAGER');
    const ops = await mkUser('ops', 'DESK_ADMIN');
    const va = await mkUser('va', 'DESK_VA');
    await prisma.agencyDeskAssignment.create({ data: { agencyId: A.id, primaryAmId: am.id } });
    const pod = await prisma.pod.create({ data: { code: `${TAG}-POD`, name: `${TAG} Pod` } }); cleanup.podIds.push(pod.id);
    await prisma.podMember.create({ data: { podId: pod.id, userId: va.id } });
    await prisma.agencyPodAccess.create({ data: { agencyId: A.id, podId: pod.id } });

    const scopeOf = (id: string) => resolveDeskScope(prisma, id);
    const sAdmin = await scopeOf(admin.id);
    const sAdmin2 = await scopeOf(admin2.id);
    const sB = await scopeOf(adminB.id);
    const sAm = await scopeOf(am.id);
    const sOps = await scopeOf(ops.id);
    const sVa = await scopeOf(va.id);
    const CTX = { ip: '203.0.113.23', userAgent: 'verify' };
    const refusal = async (fn: () => Promise<unknown>) => {
      try { await fn(); return null; } catch (e) { if (e instanceof DeskAccessError) return e; throw e; }
    };
    const status = async (fn: () => Promise<unknown>) => (await refusal(fn))?.status ?? 200;
    const roleOf = async (id: string) => (await prisma.user.findUniqueOrThrow({ where: { id } })).role;
    const logged = (action: string, entityId: string) => prisma.deskAuditLog.count({ where: { action, entityId } });
    const assignedTo = async (userId: string) => (await prisma.insuredAssignment.findMany({ where: { userId } })).map((a) => a.insuredId).sort();

    const mkAccount = async (n: string, scope = sAdmin) => (await createInsured(prisma, scope, { name: `${TAG} ${n}` }, CTX)).id;
    const acme = await mkAccount('Acme');
    const beta = await mkAccount('Beta (East)');
    const gamma = await mkAccount('Gamma');
    const foreign = await mkAccount('Foreign', sB);

    console.log('Reading the team');
    const team = await listTeam(prisma, sAdmin, {}, CTX);
    const row = (id: string) => team.members.find((m) => m.id === id)!;
    ok('everyone in the agency, inactive included', [admin, admin2, producer, csr, invited, left].every((u) => !!row(u.id)));
    ok('no other agency\'s people', !row(adminB.id));
    ok('no Desk staff', !row(am.id) && !row(va.id));
    ok('no password or hash', !JSON.stringify(team).includes('passwordHash') && !JSON.stringify(team).includes('secret-'));
    ok('a pending invite shows, without the password', row(invited.id).inviteAccepted === false && row(producer.id).inviteAccepted === true);
    ok('what each one sees', row(admin.id).bookAccess === 'ALL' && row(producer.id).bookAccess === 'ASSIGNED');
    ok('the viewer is marked', row(admin.id).isSelf && !row(admin2.id).isSelf);
    ok('a Producer cannot read it: 403', await status(async () => listTeam(prisma, await scopeOf(producer.id))) === 403);
    ok('and that is logged', await prisma.deskAuditLog.count({ where: { action: 'access.denied', actorId: producer.id, entityType: 'User' } }) === 1);
    ok('nor a CSR', await status(async () => listTeam(prisma, await scopeOf(csr.id))) === 403);
    ok('nor an Account Manager (Q3)', await status(() => listTeam(prisma, sAm, { agencyId: A.id })) === 403);
    ok('nor a VA', await status(() => listTeam(prisma, sVa, { agencyId: A.id })) === 403);
    ok('an agency admin can\'t ask for another agency', (await listTeam(prisma, sB, { agencyId: A.id })).members.every((m) => m.id !== admin.id));
    ok('an Operations Manager names the agency', await status(() => listTeam(prisma, sOps)) === 400 && (await listTeam(prisma, sOps, { agencyId: A.id })).members.length === 6);
    ok('one person: assigned count', (await getTeamMember(prisma, sAdmin, producer.id)).assignedAccounts === 0);
    ok('another agency\'s person: 404', await status(() => getTeamMember(prisma, sAdmin, adminB.id)) === 404);
    ok('Desk staff are not team members: 404', await status(() => getTeamMember(prisma, sOps, va.id)) === 404);
    ok('a bad id: 404', await status(() => getTeamMember(prisma, sAdmin, 'nope')) === 404);

    console.log('Book access changes what someone sees');
    await bulkAssign(prisma, sAdmin, producer.id, { action: 'assign', insuredIds: [acme] }, CTX);
    const names = async (id: string) => (await listInsureds(prisma, await scopeOf(id), { q: TAG, pageSize: 100 })).insureds.map((i) => i.id).sort();
    ok('assigned only: just their account', (await names(producer.id)).join() === acme);
    ok('another account is 404 to them', await status(async () => getInsured(prisma, await scopeOf(producer.id), beta)) === 404);
    await updateTeamMember(prisma, sAdmin, producer.id, { bookAccess: 'ALL' }, CTX);
    ok('whole book granted: they see it at once', (await names(producer.id)).length === 3);
    const permLog = await prisma.deskAuditLog.findFirstOrThrow({ where: { action: 'permission.changed', entityId: producer.id } });
    const meta = permLog.metadata as { bookAccess: { from: string; to: string }; role: { from: string; to: string } };
    ok('logged, who, from and to', permLog.actorId === admin.id && permLog.agencyId === A.id && permLog.ipAddress === CTX.ip && meta.bookAccess.from === 'ASSIGNED' && meta.bookAccess.to === 'ALL' && meta.role.to === 'AGENT');
    await updateTeamMember(prisma, sAdmin, producer.id, { bookAccess: 'ALL' }, CTX);
    ok('same again: no entry', await logged('permission.changed', producer.id) === 1);
    await updateTeamMember(prisma, sAdmin, producer.id, { bookAccess: 'ASSIGNED' }, CTX);
    ok('narrowed: they lose the rest at once', (await names(producer.id)).join() === acme);

    console.log('Roles');
    await updateTeamMember(prisma, sAdmin, csr.id, { role: 'AGENT' }, CTX);
    ok('a role can change', await roleOf(csr.id) === 'AGENT');
    await updateTeamMember(prisma, sAdmin, csr.id, { role: 'CSR' }, CTX);
    for (const r of ['SUPER_ADMIN', 'DESK_ADMIN', 'ACCOUNT_MANAGER', 'DESK_VA', 'nonsense', 5, null]) {
      ok(`role ${JSON.stringify(r)} refused`, await status(() => updateTeamMember(prisma, sAdmin, csr.id, { role: r })) === 400);
    }
    ok('and unchanged', await roleOf(csr.id) === 'CSR');
    ok('bad book access refused', await status(() => updateTeamMember(prisma, sAdmin, csr.id, { bookAccess: 'SOME' })) === 400);
    await updateTeamMember(prisma, sAdmin, csr.id, { agencyId: B.id, isActive: false, email: 'x@y.test', passwordHash: 'x', bookAccess: 'ALL' }, CTX);
    const csrRow = await prisma.user.findUniqueOrThrow({ where: { id: csr.id } });
    ok('nothing else can be set through it', csrRow.agencyId === A.id && csrRow.isActive && csrRow.email === csr.email && csrRow.passwordHash === csr.passwordHash && csrRow.bookAccess === 'ALL');
    await updateTeamMember(prisma, sAdmin, csr.id, { role: 'ADMIN' }, CTX);
    ok('an admin stores no book access', (await prisma.user.findUniqueOrThrow({ where: { id: csr.id } })).bookAccess === null);
    ok('an admin can\'t be limited', await status(() => updateTeamMember(prisma, sAdmin, csr.id, { bookAccess: 'ASSIGNED' })) === 400);
    await updateTeamMember(prisma, sAdmin, csr.id, { role: 'CSR' }, CTX);
    ok('demoted: back to assigned only, the old grant does not return', (await getTeamMember(prisma, sAdmin, csr.id)).bookAccess === 'ASSIGNED');
    await updateTeamMember(prisma, sAdmin, csr.id, { role: 'ADMIN', bookAccess: 'ALL' }, CTX);
    await updateTeamMember(prisma, sAdmin, csr.id, { role: 'AGENT', bookAccess: 'ALL' }, CTX);
    ok('role and book access together', (await getTeamMember(prisma, sAdmin, csr.id)).bookAccess === 'ALL' && await roleOf(csr.id) === 'AGENT');
    await updateTeamMember(prisma, sAdmin, csr.id, { role: 'CSR', bookAccess: 'ASSIGNED' }, CTX);

    console.log('Who may change whom');
    const selfRefusal = await refusal(() => updateTeamMember(prisma, sAdmin, admin.id, { role: 'AGENT' }));
    ok('not yourself', selfRefusal?.status === 403 && selfRefusal.message.includes('your own'));
    ok('and that is logged', await prisma.deskAuditLog.count({ where: { action: 'access.denied', actorId: admin.id, entityId: admin.id } }) === 1);
    ok('another agency: 404', await status(() => updateTeamMember(prisma, sB, producer.id, { bookAccess: 'ALL' })) === 404);
    ok('and that is logged', await prisma.deskAuditLog.count({ where: { action: 'access.denied', actorId: adminB.id, entityId: producer.id } }) === 1);
    ok('a Producer: 404', await status(async () => updateTeamMember(prisma, await scopeOf(producer.id), csr.id, { bookAccess: 'ALL' })) === 404);
    ok('a Producer can\'t widen themselves', await status(async () => updateTeamMember(prisma, await scopeOf(producer.id), producer.id, { bookAccess: 'ALL' })) === 404);
    ok('an Account Manager: 404 (Q3)', await status(() => updateTeamMember(prisma, sAm, producer.id, { bookAccess: 'ALL' })) === 404);
    ok('a VA: 404', await status(() => updateTeamMember(prisma, sVa, producer.id, { bookAccess: 'ALL' })) === 404);
    ok('Desk staff can\'t be targeted', await status(() => updateTeamMember(prisma, sOps, va.id, { role: 'ADMIN' })) === 404);
    ok('an Operations Manager may', await status(() => updateTeamMember(prisma, sOps, csr.id, { bookAccess: 'ASSIGNED' })) === 200);
    ok('someone inactive: refused', await status(() => updateTeamMember(prisma, sAdmin, left.id, { bookAccess: 'ALL' })) === 409);
    const fresh = await getTeamMember(prisma, sAdmin, producer.id);
    await prisma.user.update({ where: { id: producer.id }, data: { lastActivityAt: new Date() } });
    const stale = await refusal(() => updateTeamMember(prisma, sAdmin, producer.id, { version: fresh.version, bookAccess: 'ALL' }));
    ok('an out-of-date screen is refused with its code', stale?.status === 409 && stale.code === 'CHANGED_ELSEWHERE');
    ok('and changes nothing', (await getTeamMember(prisma, sAdmin, producer.id)).bookAccess === 'ASSIGNED');

    console.log('An agency keeps an admin');
    const lastRefusal = await refusal(() => updateTeamMember(prisma, sOps, adminB.id, { role: 'AGENT' }));
    ok('the only admin can\'t be demoted', lastRefusal?.status === 409 && lastRefusal.code === 'LAST_ADMIN');
    ok('and stays one', await roleOf(adminB.id) === 'ADMIN');
    const formerAdminB = await mkUser('former-b', 'ADMIN', B.id, { isActive: false });
    ok('an inactive admin doesn\'t count', (await refusal(() => updateTeamMember(prisma, sOps, adminB.id, { role: 'AGENT' })))?.code === 'LAST_ADMIN');
    ok('that one is refused as inactive, not as last', await status(() => updateTeamMember(prisma, sOps, formerAdminB.id, { role: 'AGENT' })) === 409);
    let leftWithAdmin = true, oneFailed = true;
    for (let trial = 0; trial < 3; trial++) {
      const results = await Promise.allSettled([
        updateTeamMember(prisma, sAdmin, admin2.id, { role: 'AGENT' }),
        updateTeamMember(prisma, sAdmin2, admin.id, { role: 'AGENT' }),
      ]);
      const admins = await prisma.user.count({ where: { agencyId: A.id, role: 'ADMIN', isActive: true, id: { in: [admin.id, admin2.id] } } });
      if (admins < 1) leftWithAdmin = false;
      if (results.every((r) => r.status === 'fulfilled')) oneFailed = false;
      await prisma.user.updateMany({ where: { id: { in: [admin.id, admin2.id] } }, data: { role: 'ADMIN', bookAccess: null } });
    }
    ok('two admins demoting each other at once: one remains', leftWithAdmin);
    ok('the other is refused', oneFailed);
    const results = await Promise.allSettled([
      updateTeamMember(prisma, sOps, admin2.id, { role: 'AGENT' }),
      updateTeamMember(prisma, sOps, admin.id, { role: 'AGENT' }),
    ]);
    ok('two managers demoting the last two at once: one remains', await prisma.user.count({ where: { id: { in: [admin.id, admin2.id] }, role: 'ADMIN' } }) >= 1 && results.some((r) => r.status === 'rejected'));
    await prisma.user.updateMany({ where: { id: { in: [admin.id, admin2.id] } }, data: { role: 'ADMIN', bookAccess: null } });
    await updateTeamMember(prisma, sAdmin, admin2.id, { role: 'AGENT' }, CTX);
    ok('someone demoted a moment ago can\'t act on an old session', await status(() => updateTeamMember(prisma, sAdmin2, csr.id, { bookAccess: 'ALL' })) === 403);
    await prisma.user.update({ where: { id: admin2.id }, data: { role: 'ADMIN', bookAccess: null } });

    console.log('Assigning in bulk');
    const bulk = (input: object, scope = sAdmin, who = csr.id) => bulkAssign(prisma, scope, who, input as Record<string, unknown>, CTX);
    const entries = () => prisma.deskAuditLog.count({ where: { action: 'insured.assigned', entityType: 'User', entityId: csr.id } });
    const r1 = await bulk({ action: 'assign', insuredIds: [acme, beta, acme] });
    ok('several at once, repeats ignored', r1.changed === 2 && (await assignedTo(csr.id)).join() === [acme, beta].sort().join());
    ok('a CSR defaults to Service', (await prisma.insuredAssignment.findMany({ where: { userId: csr.id } })).every((a) => a.role === 'SERVICE' && a.agencyId === A.id && a.createdById === admin.id));
    const bulkLog = await prisma.deskAuditLog.findFirstOrThrow({ where: { action: 'insured.assigned', entityType: 'User', entityId: csr.id } });
    const bulkMeta = bulkLog.metadata as { count: number; insuredIds: string[]; action: string };
    ok('one log entry, naming the accounts', await entries() === 1 && bulkMeta.count === 2 && bulkMeta.insuredIds.includes(beta) && bulkMeta.action === 'assign' && bulkLog.ipAddress === CTX.ip);
    ok('they can now see them', (await names(csr.id)).length === 2);
    ok('the same again changes nothing', (await bulk({ action: 'assign', insuredIds: [acme, beta] })).changed === 0 && await entries() === 1);
    ok('a different role is a change', (await bulk({ action: 'assign', insuredIds: [acme], role: 'PRODUCER' })).changed === 1 && (await prisma.insuredAssignment.findFirstOrThrow({ where: { userId: csr.id, insuredId: acme } })).role === 'PRODUCER');
    ok('a bad role refused', await status(() => bulk({ action: 'assign', insuredIds: [acme], role: 'BOSS' })) === 400);
    ok('a bad action refused', await status(() => bulk({ action: 'delete', insuredIds: [acme] })) === 400);
    ok('no accounts refused', await status(() => bulk({ action: 'assign', insuredIds: [] })) === 400 && await status(() => bulk({ action: 'assign' })) === 400);
    ok('malformed ids refused', await status(() => bulk({ action: 'assign', insuredIds: ['nope'] })) === 400 && await status(() => bulk({ action: 'assign', insuredIds: [{ $ne: null }] })) === 400);
    ok('too many refused', await status(() => bulk({ action: 'assign', insuredIds: Array.from({ length: MAX_BULK_ASSIGN + 1 }, (_, i) => i.toString(16).padStart(24, '0')) })) === 400);
    ok('both forms at once refused', await status(() => bulk({ action: 'assign', insuredIds: [acme], matching: { view: 'ALL' } })) === 400);

    const before = await assignedTo(csr.id);
    ok('another agency\'s account in the list: 404', await status(() => bulk({ action: 'assign', insuredIds: [gamma, foreign] })) === 404);
    ok('and nothing at all changes', (await assignedTo(csr.id)).join() === before.join());
    ok('and it isn\'t assigned', await prisma.insuredAssignment.count({ where: { insuredId: foreign } }) === 0);
    ok('and that is logged', await prisma.deskAuditLog.count({ where: { action: 'access.denied', entityId: csr.id, actorId: admin.id } }) >= 1);
    ok('another agency\'s person: 404', await status(() => bulk({ action: 'assign', insuredIds: [acme] }, sAdmin, producerB.id)) === 404);
    ok('a Producer may not: 404', await status(async () => bulk({ action: 'assign', insuredIds: [acme] }, await scopeOf(producer.id))) === 404);
    ok('another agency\'s admin may not: 404', await status(() => bulk({ action: 'assign', insuredIds: [foreign] }, sB)) === 404);
    ok('a VA may not: 404', await status(() => bulk({ action: 'assign', insuredIds: [acme] }, sVa)) === 404);
    ok('an Account Manager may, as with one account', await status(() => bulk({ action: 'assign', insuredIds: [gamma] }, sAm)) === 200);
    ok('someone inactive can\'t be given accounts', await status(() => bulk({ action: 'assign', insuredIds: [acme] }, sAdmin, left.id)) === 400);
    await prisma.insuredAssignment.create({ data: { agencyId: A.id, insuredId: acme, userId: left.id, role: 'PRODUCER' } });
    ok('but can have them removed', (await bulk({ action: 'unassign', insuredIds: [acme] }, sAdmin, left.id)).changed === 1);
    const r2 = await bulk({ action: 'unassign', insuredIds: [acme, gamma] });
    ok('removing several', r2.changed === 2 && (await assignedTo(csr.id)).join() === beta);
    ok('they lose sight of those at once', (await names(csr.id)).join() === beta);
    ok('removing what isn\'t assigned changes nothing, and adds no entry', await (async () => { const n = await entries(); const r = await bulk({ action: 'unassign', insuredIds: [acme] }); return r.changed === 0 && await entries() === n; })());

    console.log('Everything in a list');
    const before2 = await assignedTo(producer.id);
    const r3 = await bulk({ action: 'assign', matching: { view: 'NOT_ASSIGNED', q: '(east)' } }, sAdmin, producer.id);
    ok('a search with a bracket matches as text', r3.changed === 1 && (await assignedTo(producer.id)).includes(beta));
    ok('a wildcard matches nothing', (await bulk({ action: 'assign', matching: { view: 'ALL', q: '.*' } }, sAdmin, producer.id)).total === 0);
    const r4 = await bulk({ action: 'assign', matching: { view: 'ALL', q: TAG } }, sAdmin, producer.id);
    ok('never another agency\'s accounts, even searching for them', r4.total === 3 && await prisma.insuredAssignment.count({ where: { insuredId: foreign } }) === 0);
    const asManager = await bulk({ action: 'assign', matching: { view: 'ALL', q: TAG } }, sOps, producer.id);
    ok('someone who sees every agency still stays in that person\'s', asManager.total === 3 && await prisma.insuredAssignment.count({ where: { insuredId: foreign } }) === 0);
    ok('and can\'t name another agency\'s account', await status(() => bulk({ action: 'assign', insuredIds: [foreign] }, sOps, producer.id)) === 404);
    const r5 = await bulk({ action: 'unassign', matching: { view: 'ASSIGNED', q: '' } }, sAdmin, producer.id);
    ok('removing everything assigned', r5.changed === 3 && (await assignedTo(producer.id)).length === 0);
    ok('an unknown list refused', await status(() => bulk({ action: 'assign', matching: { view: 'EVERYONE' } })) === 400);
    ok('a non-text search refused', await status(() => bulk({ action: 'assign', matching: { view: 'ALL', q: { $ne: 1 } } })) === 400);
    await bulk({ action: 'assign', insuredIds: before2 }, sAdmin, producer.id);
    const huge = new Proxy(prisma, { get(target, key) {
      if (key === 'insuredAccount') return new Proxy(target.insuredAccount, { get(t, k) { return k === 'count' ? async () => MAX_BULK_ASSIGN + 1 : Reflect.get(t, k); } });
      return Reflect.get(target, key);
    } }) as PrismaClient;
    const tooBig = await refusal(() => bulkAssign(huge, sAdmin, csr.id, { action: 'assign', matching: { view: 'ALL' } }));
    ok('over the limit: refused, saying to narrow it', tooBig?.status === 400 && tooBig.message.includes('narrow'));

    console.log('The list and the account page');
    const listed = async (opts: object, scope = sAdmin) => (await listInsureds(prisma, scope, { q: TAG, pageSize: 100, ...opts })).insureds.map((i) => i.id);
    ok('assigned to someone', (await listed({ assignedTo: csr.id })).join() === beta);
    ok('not assigned to someone', !(await listed({ notAssignedTo: csr.id })).includes(beta) && (await listed({ notAssignedTo: csr.id })).length === 2);
    ok('a malformed id lists nothing, not everything', (await listed({ assignedTo: 'nope' })).length === 0 && (await listed({ notAssignedTo: 'nope' })).length === 0);
    // The VA must really see accounts here, or a refusal and an empty book look the same.
    const firstRef = 993_000_000 + Math.floor(Math.random() * 1_000_000);
    await prisma.task.createMany({ data: [beta, acme].map((insuredId, i) => ({ reference: firstRef + i, agencyId: A.id, insuredId, podId: pod.id, type: 'COI' as const, title: `${TAG} VA work ${i}`, status: 'NEW' as const, restrictedToUserIds: [] })) });
    ok('a VA sees the accounts their work is on', (await listed({}, sVa)).sort().join() === [beta, acme].sort().join());
    ok('a VA can\'t learn who an account is assigned to', (await listed({ assignedTo: csr.id }, sVa)).length === 0);
    ok('nor who it is not assigned to', (await listed({ notAssignedTo: csr.id }, sVa)).length === 0);
    ok('naming someone elsewhere shows nothing of theirs', (await listed({ assignedTo: producerB.id })).length === 0);
    const people = await assignableForInsured(prisma, sAdmin, acme, CTX);
    ok('the people to choose from: active, this agency', people.some((p) => p.id === csr.id) && !people.some((p) => p.id === left.id || p.id === adminB.id || p.id === am.id));
    ok('with who they default to, and no password', people.find((p) => p.id === csr.id)!.defaultRole === 'SERVICE' && !JSON.stringify(people).includes('secret-'));
    ok('a Producer can\'t list them: 403', await status(async () => assignableForInsured(prisma, await scopeOf(csr.id), beta)) === 403);
    ok('another agency: 404', await status(() => assignableForInsured(prisma, sB, acme)) === 404);

    console.log('Over HTTP');
    const req = (url: string, token: string | null, method = 'GET', body?: object) => new NextRequest(`http://local.test${url}`, { method, headers: token ? { cookie: `session_token=${token}` } : {}, ...(body ? { body: JSON.stringify(body) } : {}) });
    const tAdmin = await createSession(admin.id);
    const tProducer = await createSession(producer.id);
    const tB = await createSession(adminB.id);
    const ctx = (userId: string) => ({ params: Promise.resolve({ userId }) });
    const res = await teamRoute(req('/api/desk/team', tAdmin));
    const text = await res.text();
    ok('the team: 200, with no password or hash', res.status === 200 && !text.includes('passwordHash') && !text.includes('secret-'));
    ok('a Producer: 403', (await teamRoute(req('/api/desk/team', tProducer))).status === 403);
    ok('not signed in: 401', (await teamRoute(req('/api/desk/team', null))).status === 401);
    const mem = await memberRoute(req(`/api/desk/team/${csr.id}`, tAdmin), ctx(csr.id));
    const memBody = await mem.json();
    ok('one person: 200', mem.status === 200 && memBody.id === csr.id && !('passwordHash' in memBody));
    const res404 = await memberRoute(req(`/api/desk/team/${csr.id}`, tB), ctx(csr.id));
    ok('another agency: a bare 404', res404.status === 404 && JSON.stringify(await res404.json()) === '{"error":"Not found"}');
    const saved = await memberPatchRoute(req(`/api/desk/team/${csr.id}`, tAdmin, 'PATCH', { version: memBody.version, bookAccess: 'ALL' }), ctx(csr.id));
    ok('a save returns the person', saved.status === 200 && (await saved.json()).bookAccess === 'ALL');
    const staleHttp = await memberPatchRoute(req(`/api/desk/team/${csr.id}`, tAdmin, 'PATCH', { version: memBody.version, bookAccess: 'ASSIGNED' }), ctx(csr.id));
    ok('an old version: 409 with its code', staleHttp.status === 409 && (await staleHttp.json()).code === 'CHANGED_ELSEWHERE');
    ok('a bad body: 400', (await memberPatchRoute(new NextRequest(`http://local.test/x`, { method: 'PATCH', headers: { cookie: `session_token=${tAdmin}` }, body: '[]' }), ctx(csr.id))).status === 400);
    const bulkRes = await bulkRoute(req(`/api/desk/team/${csr.id}/assignments`, tAdmin, 'POST', { action: 'assign', insuredIds: [gamma] }), ctx(csr.id));
    ok('bulk: says how many changed', bulkRes.status === 200 && (await bulkRes.json()).changed === 1);
    ok('bulk by a Producer: 404', (await bulkRoute(req(`/api/desk/team/${csr.id}/assignments`, tProducer, 'POST', { action: 'assign', insuredIds: [gamma] }), ctx(csr.id))).status === 404);
    ok('the people to assign: 200', (await assignableRoute(req(`/api/desk/insureds/${acme}/assignments`, tAdmin), { params: Promise.resolve({ id: acme }) })).status === 200);
    const listRes = await listRoute(req(`/api/desk/insureds?assignedTo=${csr.id}&q=${TAG}`, tAdmin));
    ok('the list filter reaches the query', (await listRes.json()).total === 2);
  } catch (err) {
    console.error(err);
    fail++;
  } finally {
    await wipe().catch((err) => { console.error('cleanup failed', err); fail++; });
    const leftOver = await prisma.agency.count({ where: { name: { contains: TAG } } }) + await prisma.user.count({ where: { email: { contains: TAG } } }) + await prisma.pod.count({ where: { code: { contains: TAG } } });
    ok('nothing left behind', leftOver === 0);
    await prisma.$disconnect();
    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
  }
})();
