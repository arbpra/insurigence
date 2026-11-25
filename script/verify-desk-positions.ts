/**
 * Module 47: positions and permissions (client, 24 Nov 2026).
 *
 *   npx tsx script/verify-desk-positions.ts
 *
 * The catalogue and the client's default positions (pure); only the Super
 * Admin manages positions (the COO / Operations Manager, an Account Manager
 * and an agency are refused, and the refusal is logged); creating, changing
 * and switching off positions, with every rule and the audit trail; holding
 * and losing positions; what a person may do (the union, ignoring switched-off
 * positions and unknown keys); new and existing staff get the position for
 * their role; the real routes; the screen and its gate. Against the shared
 * database with temporary people, an agency and positions, all removed at the
 * end. The Desk's real positions, if any, are never touched.
 */
import 'dotenv/config';
import { readFileSync } from 'fs';
import { NextRequest } from 'next/server';
import type { UserRole } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { createSession } from '../lib/auth';
import { DeskAccessError, resolveDeskScope } from '../lib/desk/access';
import { DEFAULT_POSITIONS, PERMISSIONS, PERMISSION_KEYS, isPermissionKey } from '../lib/desk/permission-catalogue';
import { addPositionHolder, createPosition, effectivePermissions, listPositions, placeByRole, removePositionHolder, updatePosition } from '../lib/desk/positions';
import { inviteStaff, type SendInvite } from '../lib/desk/staff';
import { itemAllowed, navFor } from '../lib/desk/navigation';
import { GET as listRoute, POST as createRoute } from '../app/api/desk/admin/positions/route';
import { PATCH as patchRoute } from '../app/api/desk/admin/positions/[id]/route';
import { DELETE as unholdRoute, POST as holdRoute } from '../app/api/desk/admin/positions/[id]/holders/route';

process.env.DESK_EMAIL_NOTIFICATIONS = 'off';

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, detail = '') => {
  c ? pass++ : fail++;
  console.log(`  ${c ? '✓' : '✗'} ${n}${!c && detail ? `  [${detail}]` : ''}`);
};
const section = (s: string) => console.log(`\n${s}`);

const TAG = `m47test${Date.now()}`;
const CTX = { ip: '203.0.113.47', userAgent: 'verify-desk-positions' };
const cleanup = { agencyIds: [] as string[], userIds: [] as string[] };
type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any

async function wipe() {
  const userId = { in: cleanup.userIds };
  const positions = await prisma.deskPosition.findMany({ where: { name: { startsWith: TAG } }, select: { id: true } });
  const positionIds = positions.map((p) => p.id);
  await prisma.deskPositionHolder.deleteMany({ where: { OR: [{ userId }, { positionId: { in: positionIds } }] } });
  await prisma.deskPosition.deleteMany({ where: { id: { in: positionIds } } });
  await prisma.deskAuditLog.deleteMany({ where: { OR: [{ actorId: userId }, { entityId: { in: [...positionIds, ...cleanup.userIds] } }] } });
  await prisma.activityEvent.deleteMany({ where: { userId } });
  await prisma.inviteToken.deleteMany({ where: { userId } });
  await prisma.session.deleteMany({ where: { userId } });
  await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.agency.deleteMany({ where: { id: { in: cleanup.agencyIds } } });
}

const refusal = async (fn: () => Promise<unknown>) => {
  try { await fn(); return null; } catch (e) { if (e instanceof DeskAccessError) return e; throw e; }
};
const status = async (fn: () => Promise<unknown>) => (await refusal(fn))?.status ?? 200;

function catalogue() {
  section('The catalogue and the default positions');
  ok('every permission key is unique, with a label and a description',
    new Set(PERMISSION_KEYS).size === PERMISSIONS.length && PERMISSIONS.every((p) => p.label && p.description));
  const codes = DEFAULT_POSITIONS.map((p) => p.code);
  ok('the client\'s seven positions, each code once', codes.join() === 'COO,DIRECTOR_VIRTUAL_OPS,POD_LEADER,VA,DIRECTOR_AGENCY_OPS,SENIOR_AM,AM');
  ok('every default permission is in the catalogue', DEFAULT_POSITIONS.every((p) => p.permissions.every(isPermissionKey)));
  ok('the chart: both Directors report to the COO; Pod Leaders and VAs below Virtual Operations; Senior AMs and AMs below Agency Operations',
    DEFAULT_POSITIONS.map((p) => `${p.code}>${p.reportsTo ?? '-'}`).join() === 'COO>-,DIRECTOR_VIRTUAL_OPS>COO,POD_LEADER>DIRECTOR_VIRTUAL_OPS,VA>POD_LEADER,DIRECTOR_AGENCY_OPS>COO,SENIOR_AM>DIRECTOR_AGENCY_OPS,AM>SENIOR_AM');
  const P = (code: string) => new Set<string>(DEFAULT_POSITIONS.find((p) => p.code === code)!.permissions);
  ok('the COO has every permission', PERMISSION_KEYS.every((k) => P('COO').has(k)));
  ok('only the COO manages plans and pricing', DEFAULT_POSITIONS.filter((p) => (p.permissions as readonly string[]).includes('plans.manage')).map((p) => p.code).join() === 'COO');
  ok('the Director of Virtual Operations: operations, no prices, sensitive documents, document grants or agency setup',
    ['workload.view', 'turnaround.view', 'usage.view', 'pods.manage', 'staff.manage'].every((k) => P('DIRECTOR_VIRTUAL_OPS').has(k))
    && !['billing.prices', 'documents.all_categories', 'documents.grant', 'agencies.setup', 'plans.manage'].some((k) => P('DIRECTOR_VIRTUAL_OPS').has(k)));
  ok('the Director of Agency Operations: agency setup, prices and utilization, but not pods or staff',
    ['agencies.setup', 'billing.prices', 'usage.view'].every((k) => P('DIRECTOR_AGENCY_OPS').has(k)) && !['pods.manage', 'staff.manage', 'plans.manage'].some((k) => P('DIRECTOR_AGENCY_OPS').has(k)));
  ok('a VA only works requests; a Pod Leader also assigns and escalates',
    [...P('VA')].join() === 'requests.work' && ['requests.assign', 'requests.escalate'].every((k) => P('POD_LEADER').has(k)) && !P('POD_LEADER').has('documents.all_categories'));
  ok('reach: COO and Directors all agencies; Senior AM supervised; AM assigned; Pod Leader and VA by pod',
    DEFAULT_POSITIONS.map((p) => p.reach).join() === 'ALL,ALL,POD,POD,ALL,SUPERVISED,ASSIGNED');
  ok('today\'s roles start in COO, VA and AM', DEFAULT_POSITIONS.filter((p) => p.legacyRole).map((p) => `${p.legacyRole}>${p.code}`).join() === 'DESK_ADMIN>COO,DESK_VA>VA,ACCOUNT_MANAGER>AM');
}

(async () => {
  try {
    catalogue();

    const agency = await prisma.agency.create({ data: { name: `${TAG} Harbor`, deskEnabled: true } });
    cleanup.agencyIds.push(agency.id);
    const person = async (n: string, role: UserRole, extra: { agencyId?: string; isActive?: boolean } = {}) => {
      const u = await prisma.user.create({ data: { email: `${TAG}-${n}@example.test`, firstName: TAG, lastName: n, role, passwordHash: `secret-${TAG}`, mustChangePassword: false, isActive: extra.isActive ?? true, agencyId: extra.agencyId ?? null } });
      cleanup.userIds.push(u.id);
      return u;
    };
    const [root, ops, am, va, va2, gone, owner] = [
      await person('root', 'SUPER_ADMIN'), await person('ops', 'DESK_ADMIN'), await person('am', 'ACCOUNT_MANAGER'),
      await person('va', 'DESK_VA'), await person('va2', 'DESK_VA'), await person('gone', 'DESK_VA', { isActive: false }),
      await person('owner', 'ADMIN', { agencyId: agency.id }),
    ];
    const [sRoot, sOps, sAm, sOwner] = await Promise.all([root, ops, am, owner].map((u) => resolveDeskScope(prisma, u.id)));

    section('Who may manage positions');
    ok('the Super Admin lists them', await status(() => listPositions(prisma, sRoot, CTX)) === 200);
    const opsRefused = await refusal(() => listPositions(prisma, sOps, CTX));
    ok('the COO / Operations Manager is refused (403): nobody widens their own access', opsRefused?.status === 403 && /Super Admin/.test(opsRefused.message));
    ok('…and the refusal is logged', (await prisma.deskAuditLog.count({ where: { actorId: ops.id, action: 'access.denied', entityType: 'DeskPosition' } })) === 1);
    ok('an Account Manager and an agency Owner are refused', await status(() => createPosition(prisma, sAm, { name: `${TAG} x` }, CTX)) === 403 && await status(() => listPositions(prisma, sOwner, CTX)) === 403);

    section('Creating a position');
    const base = { department: 'VIRTUAL_OPERATIONS', reach: 'POD', permissions: ['requests.work', 'requests.assign', 'requests.assign'] };
    const alpha = await createPosition(prisma, sRoot, { ...base, name: `  ${TAG}   Alpha `, description: ' Leads the trial pod. ' }, CTX);
    const A = await prisma.deskPosition.findUniqueOrThrow({ where: { id: alpha.id } });
    ok('created with a tidy name, a code from it, the permissions in catalogue order, no duplicates',
      A.name === `${TAG} Alpha` && A.code === `${TAG.toUpperCase()}_ALPHA` && A.permissions.join() === 'requests.work,requests.assign' && A.description === 'Leads the trial pod.' && !A.isSystem && A.isActive);
    const created = await prisma.deskAuditLog.findFirst({ where: { action: 'position.created', entityId: alpha.id } });
    ok('audited: who, what and the request context', created?.actorId === root.id && (created?.metadata as Json)?.reach === 'POD' && created?.ipAddress === CTX.ip && created?.userAgent === CTX.userAgent);
    const bads: [string, Record<string, unknown>][] = [
      ['no name', { ...base, name: ' ' }],
      ['a name too long', { ...base, name: 'x'.repeat(81) }],
      ['an unknown department', { ...base, name: `${TAG} b`, department: 'SALES' }],
      ['an unknown reach', { ...base, name: `${TAG} b`, reach: 'EVERYTHING' }],
      ['an unknown permission', { ...base, name: `${TAG} b`, permissions: ['requests.work', 'positions.manage'] }],
      ['permissions not a list', { ...base, name: `${TAG} b`, permissions: 'requests.work' }],
      ['reporting to nothing that exists', { ...base, name: `${TAG} b`, reportsToId: '0123456789abcdef01234567' }],
    ];
    for (const [label, input] of bads) ok(`${label}: refused (400)`, await status(() => createPosition(prisma, sRoot, input, CTX)) === 400);
    ok('managing positions is not a permission anyone can be given', !isPermissionKey('positions.manage'));
    ok('the same name again, in other capitals: refused (409)', await status(() => createPosition(prisma, sRoot, { ...base, name: `${TAG} ALPHA` }, CTX)) === 409);
    const beta = await createPosition(prisma, sRoot, { name: `${TAG} Beta`, department: 'AGENCY_OPERATIONS', reach: 'ASSIGNED', permissions: ['accounts.view'], reportsToId: alpha.id }, CTX);
    ok('a second one reporting to the first', (await prisma.deskPosition.findUniqueOrThrow({ where: { id: beta.id } })).reportsToId === alpha.id);

    section('Changing a position');
    await updatePosition(prisma, sRoot, alpha.id, { name: `${TAG} Alpha Lead`, permissions: ['requests.work', 'requests.escalate'], reach: 'ALL' }, CTX);
    const A2 = await prisma.deskPosition.findUniqueOrThrow({ where: { id: alpha.id } });
    ok('renamed, permissions and reach changed', A2.name === `${TAG} Alpha Lead` && A2.permissions.join() === 'requests.work,requests.escalate' && A2.reach === 'ALL');
    const upd = await prisma.deskAuditLog.findFirst({ where: { action: 'position.updated', entityId: alpha.id } });
    const ch = (upd?.metadata as Json)?.changes;
    ok('audited as removed and added permissions, with the old and new reach', ch?.permissions?.from?.join() === 'requests.assign' && ch?.permissions?.to?.join() === 'requests.escalate' && ch?.reach?.from === 'POD' && ch?.reach?.to === 'ALL');
    ok('reporting to itself: refused', await status(() => updatePosition(prisma, sRoot, alpha.id, { reportsToId: alpha.id }, CTX)) === 400);
    const loop = await refusal(() => updatePosition(prisma, sRoot, alpha.id, { reportsToId: beta.id }, CTX));
    ok('a loop (Alpha under Beta, which is under Alpha): refused', loop?.status === 400 && /loop/.test(loop.message));
    ok('nothing to change: 409', await status(() => updatePosition(prisma, sRoot, alpha.id, { name: `${TAG} Alpha Lead`, reach: 'ALL' }, CTX)) === 409);
    ok('another position\'s name: 409', await status(() => updatePosition(prisma, sRoot, beta.id, { name: `${TAG} alpha lead` }, CTX)) === 409);
    ok('an unknown position: not found', await status(() => updatePosition(prisma, sRoot, '0123456789abcdef01234567', { name: 'x y' }, CTX)) === 404);
    ok('the COO can\'t change one', await status(() => updatePosition(prisma, sOps, alpha.id, { name: `${TAG} mine` }, CTX)) === 403);

    section('Holding positions');
    await addPositionHolder(prisma, sRoot, alpha.id, { userId: va.id }, CTX);
    ok('a VA given a position', (await prisma.deskPositionHolder.count({ where: { userId: va.id, positionId: alpha.id } })) === 1);
    ok('audited, with the person', (await prisma.deskAuditLog.findFirst({ where: { action: 'position.holder_added', entityId: alpha.id } }))?.metadata && ((await prisma.deskAuditLog.findFirst({ where: { action: 'position.holder_added', entityId: alpha.id } }))!.metadata as Json).userId === va.id);
    ok('the same again: 409', await status(() => addPositionHolder(prisma, sRoot, alpha.id, { userId: va.id }, CTX)) === 409);
    ok('an agency user can\'t hold one (400)', await status(() => addPositionHolder(prisma, sRoot, alpha.id, { userId: owner.id }, CTX)) === 400);
    ok('nor the Super Admin, who is above positions (400)', await status(() => addPositionHolder(prisma, sRoot, alpha.id, { userId: root.id }, CTX)) === 400);
    ok('no person chosen: 400', await status(() => addPositionHolder(prisma, sRoot, alpha.id, {}, CTX)) === 400);
    await addPositionHolder(prisma, sRoot, beta.id, { userId: va.id }, CTX);
    ok('one person can hold two positions', (await prisma.deskPositionHolder.count({ where: { userId: va.id } })) === 2);
    await removePositionHolder(prisma, sRoot, beta.id, va.id, CTX);
    ok('taking one away while they keep another', (await prisma.deskPositionHolder.count({ where: { userId: va.id } })) === 1
      && !!(await prisma.deskAuditLog.findFirst({ where: { action: 'position.holder_removed', entityId: beta.id } })));
    const last = await refusal(() => removePositionHolder(prisma, sRoot, alpha.id, va.id, CTX));
    ok('taking away an active person\'s only position: refused, they would lose The Desk', last?.status === 409 && /only position/.test(last.message));
    await addPositionHolder(prisma, sRoot, alpha.id, { userId: gone.id }, CTX);
    ok('a deactivated person can lose their last one', await status(() => removePositionHolder(prisma, sRoot, alpha.id, gone.id, CTX)) === 200);
    ok('removing what they don\'t hold: not found', await status(() => removePositionHolder(prisma, sRoot, beta.id, va.id, CTX)) === 404);

    section('Switching a position off');
    const held = await refusal(() => updatePosition(prisma, sRoot, alpha.id, { isActive: false }, CTX));
    ok('not while someone holds it', held?.status === 409 && /hold/.test(held.message));
    const above = await refusal(() => updatePosition(prisma, sRoot, alpha.id, { isActive: 'no' }, CTX));
    ok('isActive must be true or false', above?.status === 400);
    await addPositionHolder(prisma, sRoot, beta.id, { userId: va2.id }, CTX);
    const gamma = await createPosition(prisma, sRoot, { name: `${TAG} Gamma`, department: 'EXECUTIVE', reach: 'ALL', permissions: [] }, CTX);
    await updatePosition(prisma, sRoot, beta.id, { reportsToId: gamma.id }, CTX);
    await addPositionHolder(prisma, sRoot, gamma.id, { userId: va2.id }, CTX);
    await removePositionHolder(prisma, sRoot, gamma.id, va2.id, CTX);
    const reports = await refusal(() => updatePosition(prisma, sRoot, gamma.id, { isActive: false }, CTX));
    ok('not while an active position reports to it', reports?.status === 409 && /report/.test(reports.message));
    await updatePosition(prisma, sRoot, beta.id, { reportsToId: null }, CTX);
    await updatePosition(prisma, sRoot, gamma.id, { isActive: false }, CTX);
    ok('switched off once it is empty', !(await prisma.deskPosition.findUniqueOrThrow({ where: { id: gamma.id } })).isActive);
    ok('nobody can be given a switched-off position', await status(() => addPositionHolder(prisma, sRoot, gamma.id, { userId: va2.id }, CTX)) === 409);

    section('What a person may do');
    await addPositionHolder(prisma, sRoot, beta.id, { userId: va.id }, CTX);
    const e1 = await effectivePermissions(prisma, va.id);
    ok('the union of their positions, and every reach they give',
      [...e1.permissions].sort().join() === 'accounts.view,requests.escalate,requests.work' && [...e1.reaches].sort().join() === 'ALL,ASSIGNED' && e1.positions.length === 2);
    await prisma.deskPosition.update({ where: { id: beta.id }, data: { permissions: ['accounts.view', 'bogus.permission'] } });
    ok('an unknown key in the database is ignored', ![...(await effectivePermissions(prisma, va.id)).permissions].includes('bogus.permission' as never));
    ok('…and not listed on the screen', !(await listPositions(prisma, sRoot, CTX)).positions.find((p) => p.id === beta.id)!.permissions.includes('bogus.permission' as never));
    await prisma.deskPosition.update({ where: { id: alpha.id }, data: { isActive: false } });
    const e2 = await effectivePermissions(prisma, va.id);
    ok('a switched-off position gives nothing', [...e2.permissions].join() === 'accounts.view' && [...e2.reaches].join() === 'ASSIGNED');
    await prisma.deskPosition.update({ where: { id: alpha.id }, data: { isActive: true } });
    ok('the Super Admin has everything', (await effectivePermissions(prisma, root.id)).permissions.size === PERMISSION_KEYS.length);
    ok('an agency user and a deactivated person have nothing',
      (await effectivePermissions(prisma, owner.id)).permissions.size === 0 && (await effectivePermissions(prisma, gone.id)).permissions.size === 0);

    section('Staff get the position for their role');
    const seat = await prisma.deskPosition.create({ data: { code: `${TAG}_SEAT`, name: `${TAG} Seat`, department: 'VIRTUAL_OPERATIONS', reach: 'POD', permissions: ['requests.work'], legacyRole: 'DESK_VA', sortOrder: -1000 } });
    const fresh = await person('fresh', 'DESK_VA');
    ok('a VA without a position is given the VA one', await placeByRole(prisma, fresh, null) && (await prisma.deskPositionHolder.count({ where: { userId: fresh.id, positionId: seat.id } })) === 1);
    ok('only once', !(await placeByRole(prisma, fresh, null)));
    ok('never an agency user', !(await placeByRole(prisma, owner, null)));
    const send: SendInvite = async () => ({ ok: true, id: 'stub' });
    await inviteStaff(prisma, sRoot, { email: `${TAG}-invited@example.test`, firstName: 'New', lastName: 'Hire', role: 'DESK_VA' }, CTX, send);
    const invited = await prisma.user.findUniqueOrThrow({ where: { email: `${TAG}-invited@example.test` } });
    cleanup.userIds.push(invited.id);
    ok('an invited VA starts with it', (await prisma.deskPositionHolder.count({ where: { userId: invited.id, positionId: seat.id } })) === 1);
    ok('…recorded on the invite', ((await prisma.deskAuditLog.findFirst({ where: { action: 'staff.invited', entityId: invited.id } }))?.metadata as Json)?.positionGiven === true);
    const seed = readFileSync('script/seed-desk.ts', 'utf8');
    ok('npm run db:seed:desk creates the positions and places existing staff', /ensureDefaultPositions\(prisma\)/.test(seed));

    section('The routes');
    const [tRoot, tOps] = await Promise.all([createSession(root.id), createSession(ops.id)]);
    const req = (url: string, method: string, token: string | null, body?: unknown) => new NextRequest(`http://local.test${url}`, {
      method, headers: { ...(token ? { cookie: `session_token=${token}` } : {}), 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
    });
    const p = (id: string) => ({ params: Promise.resolve({ id }) });
    const listed = await listRoute(req('/api/desk/admin/positions', 'GET', tRoot));
    const lj = await listed.json() as Json;
    ok('GET lists positions and staff for the Super Admin', listed.status === 200 && lj.positions.some((x: Json) => x.id === alpha.id) && lj.staff.some((s: Json) => s.id === va.id));
    ok('GET for the COO: 403', (await listRoute(req('/api/desk/admin/positions', 'GET', tOps))).status === 403);
    const made = await createRoute(req('/api/desk/admin/positions', 'POST', tRoot, { name: `${TAG} Delta`, department: 'EXECUTIVE', reach: 'ALL', permissions: ['audit.view'] }));
    const delta = await made.json() as Json;
    ok('POST creates (201)', made.status === 201 && !!delta.id);
    ok('PATCH changes it', (await patchRoute(req(`/api/desk/admin/positions/${delta.id}`, 'PATCH', tRoot, { permissions: ['audit.view', 'usage.view'] }), p(delta.id))).status === 200);
    ok('holders: POST adds (201), DELETE removes',
      (await holdRoute(req(`/api/desk/admin/positions/${delta.id}/holders`, 'POST', tRoot, { userId: va2.id }), p(delta.id))).status === 201
      && (await unholdRoute(req(`/api/desk/admin/positions/${delta.id}/holders?userId=${va2.id}`, 'DELETE', tRoot), p(delta.id))).status === 200);
    ok('broken JSON: 400; the COO: 403; signed out: 401',
      (await createRoute(req('/api/desk/admin/positions', 'POST', tRoot, '{oops'))).status === 400
      && (await holdRoute(req(`/api/desk/admin/positions/${delta.id}/holders`, 'POST', tOps, { userId: va2.id }), p(delta.id))).status === 403
      && (await patchRoute(req(`/api/desk/admin/positions/${delta.id}`, 'PATCH', null, {}), p(delta.id))).status === 401);

    section('The screen');
    const ui = readFileSync('app/components/desk/admin/PositionManager.tsx', 'utf8');
    const page = readFileSync('app/(main)/super-admin/desk/positions/page.tsx', 'utf8');
    ok('only the Super Admin sees Positions in Desk setup, and the page checks it too',
      navFor('ADMIN', 'SUPER_ADMIN').some((i) => i.href === '/super-admin/desk/positions') && !navFor('ADMIN', 'DESK_ADMIN').some((i) => i.href === '/super-admin/desk/positions')
      && !itemAllowed('/super-admin/desk/positions', 'DESK_ADMIN') && /deskPageAccess\('ADMIN', '\/super-admin\/desk\/positions'\)/.test(page));
    ok('it edits name, department, reach, reporting line and every permission in the catalogue',
      ['desk-position-name', 'desk-position-department', 'desk-position-reach', 'desk-position-reports-to', 'desk-position-perm-'].every((t) => ui.includes(t)) && /PERMISSIONS\.filter/.test(ui));
    ok('it says when open work went back to the queue', /went back to the queue/.test(ui) && (ui.match(/api<Released>/g) ?? []).length === 3);
    ok('it adds and removes holders, and switches positions off', ['desk-position-holder-add', 'desk-position-holder-remove', 'desk-position-toggle'].every((t) => ui.includes(t)));
    ok('it says a position never opens another agency\'s data or sensitive documents by itself', /never opens another agency/.test(ui) && /Reporting lines give no access/.test(ui));
  } catch (err) {
    console.error(err);
    fail++;
  } finally {
    await wipe().catch((err) => { console.error('cleanup failed', err); fail++; });
    const left = await prisma.user.count({ where: { email: { contains: TAG } } }) + await prisma.deskPosition.count({ where: { name: { startsWith: TAG } } }) + await prisma.agency.count({ where: { name: { startsWith: TAG } } });
    ok('cleaned up', left === 0, String(left));
    console.log(`\n━━ ${pass} passed, ${fail} failed ━━`);
    await prisma.$disconnect();
    process.exit(fail ? 1 : 0);
  }
})();
