/**
 * The Desk, Module 5: agency-side roles (Owner/Admin, Producer, CSR), book
 * access, and insured account assignment.
 *
 * Verifies the role rules, that agency admins can invite CSRs but not Desk or
 * platform roles, that the settings endpoint is admin-only (it used to block
 * only AGENT, so a CSR would have passed), and the InsuredAssignment model.
 * Invite emails are switched off for the run. Uses temporary records only.
 * Run with:  npx tsx script/verify-desk-agency-roles.ts
 */
import 'dotenv/config';
import { NextRequest } from 'next/server';
import { prisma } from '../lib/prisma';
import { createSession } from '../lib/auth';
import {
  AGENCY_ROLES, isAgencyRole, agencyIdForRole, effectiveBookAccess, roleLabel,
  canBeAssignedToInsured, defaultAssignmentRole,
} from '../lib/roles';
import * as agencyUsersRoute from '../app/api/agency/users/route';
import * as settingsRoute from '../app/api/agency/settings/route';
import * as leadsRoute from '../app/api/leads/route';

// Never send real invite emails from a test run (sendEmail checks this per call).
process.env.RESEND_API_KEY = '';

let pass = 0, fail = 0;
const ok = (n: string, c: boolean) => { c ? pass++ : fail++; console.log(`  ${c ? '✓' : '✗'} ${n}`); };
const rejects = async (fn: () => Promise<unknown>) => { try { await fn(); return false; } catch { return true; } };

const TAG = `m5test-${Date.now()}`;
let agencyId = '';
const tokens: string[] = [];

function req(url: string, token: string, init: { method?: string; body?: unknown } = {}) {
  return new NextRequest(new URL(url, 'http://localhost'), {
    method: init.method ?? 'GET',
    headers: { cookie: `session_token=${token}`, 'content-type': 'application/json' },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
}

async function wipe() {
  await prisma.session.deleteMany({ where: { token: { in: tokens } } });
  if (!agencyId) return;
  const users = await prisma.user.findMany({ where: { agencyId }, select: { id: true } });
  const ids = users.map((u) => u.id);
  await prisma.inviteToken.deleteMany({ where: { userId: { in: ids } } });
  await prisma.session.deleteMany({ where: { userId: { in: ids } } });
  await prisma.insuredAssignment.deleteMany({ where: { agencyId } });
  await prisma.insuredAccount.deleteMany({ where: { agencyId } });
  await prisma.activityEvent.deleteMany({ where: { agencyId } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  await prisma.agency.deleteMany({ where: { id: agencyId } });
}

(async () => {
  console.log('\n━━ Role rules ━━');
  ok('agency roles are Owner/Admin, Producer, CSR',
    AGENCY_ROLES.join(',') === 'ADMIN,AGENT,CSR' && isAgencyRole('CSR'));
  ok('labels: AGENT shows as "Producer", ADMIN as "Owner / Admin", DESK_ADMIN as "Operations Manager"',
    roleLabel('AGENT') === 'Producer' && roleLabel('ADMIN') === 'Owner / Admin' && roleLabel('DESK_ADMIN') === 'Operations Manager');
  ok('a CSR must belong to an agency', !agencyIdForRole('CSR', null).ok && agencyIdForRole('CSR', 'a1').ok);
  ok('Owner/Admin always sees the whole book, even if a value is stored',
    effectiveBookAccess('ADMIN', 'ASSIGNED') === 'ALL' && effectiveBookAccess('ADMIN', null) === 'ALL');
  ok('Producer and CSR default to assigned accounts only',
    effectiveBookAccess('AGENT', null) === 'ASSIGNED' && effectiveBookAccess('CSR', undefined) === 'ASSIGNED');
  ok('…and see the whole book when the admin grants it',
    effectiveBookAccess('AGENT', 'ALL') === 'ALL' && effectiveBookAccess('CSR', 'ALL') === 'ALL');
  ok('book access does not apply to Desk staff or Super Admin',
    ['DESK_VA', 'ACCOUNT_MANAGER', 'DESK_ADMIN', 'SUPER_ADMIN'].every((r) => effectiveBookAccess(r, 'ALL') === null));
  ok('only agency users can be assigned to an insured',
    ['ADMIN', 'AGENT', 'CSR'].every(canBeAssignedToInsured) &&
    !['DESK_VA', 'ACCOUNT_MANAGER', 'DESK_ADMIN', 'SUPER_ADMIN'].some(canBeAssignedToInsured));
  ok('default assignment: CSR → service, others → producer',
    defaultAssignmentRole('CSR') === 'SERVICE' && defaultAssignmentRole('AGENT') === 'PRODUCER');

  const agency = await prisma.agency.create({ data: { name: `${TAG} agency` } });
  agencyId = agency.id;
  const mkUser = (role: 'ADMIN' | 'AGENT' | 'CSR', n: string, extra: Record<string, unknown> = {}) =>
    prisma.user.create({ data: { email: `${TAG}-${n}@example.test`, role, agencyId, isActive: true, mustChangePassword: false, ...extra } });
  const admin = await mkUser('ADMIN', 'admin');
  const producer = await mkUser('AGENT', 'producer');
  const adminToken = await createSession(admin.id); tokens.push(adminToken);
  const producerToken = await createSession(producer.id); tokens.push(producerToken);

  console.log('\n━━ Agency admin invites (POST /api/agency/users) ━━');
  let csrId = '';
  {
    const res = await agencyUsersRoute.POST(req('/api/agency/users', adminToken, { method: 'POST',
      body: { email: `${TAG}-csr@example.test`, firstName: 'Casey', lastName: 'Service', role: 'CSR' } }));
    const body = await res.json();
    csrId = body.user?.id ?? '';
    ok('a CSR can be invited', res.status === 201 && body.user?.role === 'CSR');
    ok('…into the inviting admin\'s own agency',
      (await prisma.user.findUniqueOrThrow({ where: { id: csrId } })).agencyId === agencyId);
    ok('…and no email was sent during the test', body.emailSent === false);
  }
  for (const role of ['SUPER_ADMIN', 'ACCOUNT_MANAGER', 'DESK_VA', 'DESK_ADMIN']) {
    const res = await agencyUsersRoute.POST(req('/api/agency/users', adminToken, { method: 'POST',
      body: { email: `${TAG}-${role.toLowerCase()}@example.test`, firstName: 'X', lastName: 'Y', role } }));
    ok(`an agency admin cannot create role: ${roleLabel(role)}`, res.status === 400);
  }
  ok('a Producer cannot invite anyone',
    (await agencyUsersRoute.POST(req('/api/agency/users', producerToken, { method: 'POST',
      body: { email: `${TAG}-x@example.test`, firstName: 'X', lastName: 'Y', role: 'AGENT' } }))).status === 403);

  console.log('\n━━ Agency settings are admin-only ━━');
  await prisma.user.update({ where: { id: csrId }, data: { passwordHash: 'x' } });
  const csrToken = await createSession(csrId); tokens.push(csrToken);
  const patch = (token: string) => settingsRoute.PATCH(req('/api/agency/settings', token, { method: 'PATCH', body: { placementNotes: `${TAG} note` } }));
  ok('CSR cannot change agency settings (the old AGENT-only block would have let them)', (await patch(csrToken)).status === 403);
  ok('Producer cannot change agency settings', (await patch(producerToken)).status === 403);
  ok('Owner/Admin can', (await patch(adminToken)).status === 200);
  ok('CSR can still read settings, like a Producer',
    (await settingsRoute.GET(req('/api/agency/settings', csrToken))).status === 200);
  ok('CSR uses the agency\'s existing tools (leads) like a Producer',
    (await leadsRoute.GET(req('/api/leads', csrToken))).status === 200);

  console.log('\n━━ Book access storage ━━');
  ok('a user created without book access reads as unset → role default',
    effectiveBookAccess(producer.role, (await prisma.user.findUniqueOrThrow({ where: { id: producer.id } })).bookAccess) === 'ASSIGNED');
  await prisma.user.update({ where: { id: csrId }, data: { bookAccess: 'ALL' } });
  ok('admin-granted ALL is stored and honoured',
    effectiveBookAccess('CSR', (await prisma.user.findUniqueOrThrow({ where: { id: csrId } })).bookAccess) === 'ALL');

  console.log('\n━━ Insured assignments ━━');
  const producer2 = await mkUser('AGENT', 'producer2');
  const mkInsured = (name: string) => prisma.insuredAccount.create({ data: { agencyId, name, nameKey: name.toLowerCase() } });
  const acme = await mkInsured('Acme Roofing');
  const bolt = await mkInsured('Bolt Electric');
  await mkInsured('Unassigned Co');
  const assign = (insuredId: string, userId: string, role: 'PRODUCER' | 'SERVICE') =>
    prisma.insuredAssignment.create({ data: { agencyId, insuredId, userId, role, createdById: admin.id } });
  await assign(acme.id, producer.id, 'PRODUCER');
  await assign(acme.id, producer2.id, 'PRODUCER');
  await assign(acme.id, csrId, 'SERVICE');
  await assign(bolt.id, producer.id, 'PRODUCER');
  ok('several producers and a CSR on one account',
    (await prisma.insuredAssignment.count({ where: { insuredId: acme.id } })) === 3);
  ok('the same person cannot be assigned twice to one account',
    await rejects(() => assign(acme.id, producer.id, 'SERVICE')));
  {
    const mine = await prisma.insuredAssignment.findMany({ where: { agencyId, userId: producer.id }, select: { insuredId: true } });
    ok('"my accounts" lookup returns exactly the producer\'s two accounts',
      mine.length === 2 && mine.every((m) => [acme.id, bolt.id].includes(m.insuredId)));
  }
  ok('insured → assignments relation',
    (await prisma.insuredAccount.findUniqueOrThrow({ where: { id: acme.id }, include: { assignments: true } })).assignments.length === 3);
  await prisma.user.delete({ where: { id: producer2.id } });
  ok('deleting a user removes their assignments',
    (await prisma.insuredAssignment.count({ where: { userId: producer2.id } })) === 0);
  await prisma.insuredAccount.delete({ where: { id: bolt.id } });
  ok('deleting an insured removes its assignments',
    (await prisma.insuredAssignment.count({ where: { insuredId: bolt.id } })) === 0);

  await wipe();
  ok('cleaned up',
    (await prisma.agency.count({ where: { name: { startsWith: TAG } } })) === 0 &&
    (await prisma.user.count({ where: { email: { startsWith: TAG } } })) === 0 &&
    (await prisma.session.count({ where: { token: { in: tokens } } })) === 0 &&
    (await prisma.activityEvent.count({ where: { agencyId } })) === 0);

  console.log(`\n━━ ${pass} passed, ${fail} failed ━━\n`);
  await prisma.$disconnect();
  process.exit(fail ? 1 : 0);
})().catch(async (e) => {
  console.error('ERROR', e);
  await wipe().catch(() => {});
  await prisma.$disconnect();
  process.exit(1);
});
