/**
 * The Desk, Module 1: internal staff roles.
 *
 * Verifies the role rules, Super Admin user create/update, and that Desk staff
 * (no agencyId) are denied by every existing agency-data API.
 * Writes to the database; removes everything it creates.
 * Run with:  npx tsx script/verify-desk-roles.ts
 */
import 'dotenv/config';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import prisma from '../lib/prisma';
import { createSession } from '../lib/auth';
import { isRole, isAgencyRole, isDeskRole, roleLabel, agencyIdForRole, USER_ROLES } from '../lib/roles';
import * as usersRoute from '../app/api/super-admin/users/route';
import * as userRoute from '../app/api/super-admin/users/[userId]/route';
import * as leadsRoute from '../app/api/leads/route';
import * as leadRoute from '../app/api/leads/[id]/route';
import * as quoteOptionsRoute from '../app/api/leads/[id]/quote-options/route';
import * as proposalRoute from '../app/api/proposals/[id]/route';
import * as settingsRoute from '../app/api/agency/settings/route';
import * as agencyUsersRoute from '../app/api/agency/users/route';
import * as intakeSubmitRoute from '../app/api/intake/submit/route';

let passed = 0;
async function t(name: string, fn: () => Promise<void> | void) {
  try { await fn(); passed++; console.log('  ✓', name); }
  catch (e) { console.log('  ✗', name); throw e; }
}

const TAG = `m1test-${Date.now()}`;
const createdUserIds: string[] = [];
const tokens: string[] = [];

function req(url: string, token: string, init: { method?: string; body?: unknown } = {}) {
  return new NextRequest(new URL(url, 'http://localhost'), {
    method: init.method ?? 'GET',
    headers: { cookie: `session_token=${token}`, 'content-type': 'application/json' },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
}
const p = <T>(v: T) => ({ params: Promise.resolve(v) });

async function main() {
  console.log('Unit — lib/roles');
  await t('seven roles, all recognised', () => {
    assert.equal(USER_ROLES.length, 7);
    for (const r of USER_ROLES) assert.ok(isRole(r));
    assert.ok(!isRole('OWNER')); assert.ok(!isRole(undefined)); assert.ok(!isRole(''));
  });
  await t('groups are disjoint', () => {
    for (const r of USER_ROLES) assert.ok(!(isAgencyRole(r) && isDeskRole(r)));
    assert.ok(!isAgencyRole('SUPER_ADMIN') && !isDeskRole('SUPER_ADMIN'));
  });
  await t('labels', () => {
    assert.equal(roleLabel('ACCOUNT_MANAGER'), 'Account Manager');
    assert.equal(roleLabel('UNKNOWN'), 'UNKNOWN');
  });
  await t('agency roles require agencyId', () => {
    assert.equal(agencyIdForRole('AGENT', null).ok, false);
    assert.equal(agencyIdForRole('ADMIN', '').ok, false);
    assert.deepEqual(agencyIdForRole('AGENT', 'a1'), { ok: true, agencyId: 'a1' });
  });
  await t('non-agency roles are forced to null agencyId', () => {
    for (const r of ['SUPER_ADMIN', 'DESK_ADMIN', 'ACCOUNT_MANAGER', 'DESK_VA'] as const)
      assert.deepEqual(agencyIdForRole(r, 'a1'), { ok: true, agencyId: null });
  });

  // ---- Integration ----
  const superAdmin = await prisma.user.findFirstOrThrow({ where: { role: 'SUPER_ADMIN', isActive: true } });
  const agency = await prisma.agency.findFirstOrThrow();
  const saToken = await createSession(superAdmin.id); tokens.push(saToken);

  console.log('Integration — Super Admin user create (POST /api/super-admin/users)');
  let amId = '';
  await t('Account Manager created with agencyId supplied → stored as null', async () => {
    const res = await usersRoute.POST(req('/api/super-admin/users', saToken, { method: 'POST',
      body: { email: `${TAG}-am@example.test`, role: 'ACCOUNT_MANAGER', agencyId: agency.id } }));
    assert.equal(res.status, 201);
    const { user } = await res.json();
    createdUserIds.push(user.id); amId = user.id;
    assert.equal(user.role, 'ACCOUNT_MANAGER');
    assert.equal(user.agencyId, null);
  });
  await t('Agent without agency → 400', async () => {
    const res = await usersRoute.POST(req('/api/super-admin/users', saToken, { method: 'POST',
      body: { email: `${TAG}-x@example.test`, role: 'AGENT' } }));
    assert.equal(res.status, 400);
  });
  await t('Unknown role → 400 (was a 500 before)', async () => {
    const res = await usersRoute.POST(req('/api/super-admin/users', saToken, { method: 'POST',
      body: { email: `${TAG}-y@example.test`, role: 'OWNER', agencyId: agency.id } }));
    assert.equal(res.status, 400);
  });

  console.log('Integration — role change (PATCH /api/super-admin/users/[id])');
  let agentId = '';
  await t('setup: agent in agency', async () => {
    const res = await usersRoute.POST(req('/api/super-admin/users', saToken, { method: 'POST',
      body: { email: `${TAG}-agent@example.test`, role: 'AGENT', agencyId: agency.id } }));
    assert.equal(res.status, 201);
    const { user } = await res.json();
    createdUserIds.push(user.id); agentId = user.id;
    assert.equal(user.agencyId, agency.id);
  });
  await t('Agent → Desk VA with no agencyId sent clears the old agency', async () => {
    const res = await userRoute.PATCH(req(`/api/super-admin/users/${agentId}`, saToken, { method: 'PATCH',
      body: { role: 'DESK_VA' } }), p({ userId: agentId }));
    assert.equal(res.status, 200);
    const { user } = await res.json();
    assert.equal(user.role, 'DESK_VA');
    assert.equal(user.agencyId, null);
  });
  await t('Desk VA → Agent without agency → 400, user unchanged', async () => {
    const res = await userRoute.PATCH(req(`/api/super-admin/users/${agentId}`, saToken, { method: 'PATCH',
      body: { role: 'AGENT' } }), p({ userId: agentId }));
    assert.equal(res.status, 400);
    const u = await prisma.user.findUniqueOrThrow({ where: { id: agentId } });
    assert.equal(u.role, 'DESK_VA');
  });
  await t('isActive-only PATCH still works and leaves role alone', async () => {
    const res = await userRoute.PATCH(req(`/api/super-admin/users/${agentId}`, saToken, { method: 'PATCH',
      body: { isActive: true } }), p({ userId: agentId }));
    assert.equal(res.status, 200);
    assert.equal((await res.json()).user.role, 'DESK_VA');
  });

  console.log('Integration — Desk staff get NO agency data through existing APIs');
  const amToken = await createSession(amId);
  const lead = await prisma.lead.findFirst({ where: { agencyId: agency.id } });
  const proposal = await prisma.proposal.findFirst();

  await t('lead list → 403', async () => {
    assert.equal((await leadsRoute.GET(req('/api/leads', amToken))).status, 403);
  });
  await t('lead list with ?agencyId= → still 403', async () => {
    assert.equal((await leadsRoute.GET(req(`/api/leads?agencyId=${agency.id}`, amToken))).status, 403);
  });
  if (lead) {
    await t('archive a lead → 404 and lead untouched', async () => {
      const before = lead.archivedAt ?? null;
      const res = await leadRoute.PATCH(req(`/api/leads/${lead.id}`, amToken, { method: 'PATCH', body: { archived: true } }), p({ id: lead.id }));
      assert.equal(res.status, 404);
      const after = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
      assert.equal(after.archivedAt ?? null, before);
    });
    await t('lead quote options → denied', async () => {
      const res = await quoteOptionsRoute.GET(req(`/api/leads/${lead.id}/quote-options`, amToken), p({ id: lead.id }));
      assert.ok([403, 404].includes(res.status), String(res.status));
    });
  } else console.log('  - no lead in DB, lead checks skipped');
  if (proposal) {
    await t('proposal → denied', async () => {
      const res = await proposalRoute.GET(req(`/api/proposals/${proposal.id}`, amToken), p({ id: proposal.id }));
      assert.ok([403, 404].includes(res.status), String(res.status));
    });
  }
  await t('agency settings with ?agencyId= → 403', async () => {
    assert.equal((await settingsRoute.GET(req(`/api/agency/settings?agencyId=${agency.id}`, amToken))).status, 403);
  });
  await t('agency team list → 403', async () => {
    assert.equal((await agencyUsersRoute.GET(req('/api/agency/users', amToken))).status, 403);
  });
  await t('internal intake submit → 403', async () => {
    const res = await intakeSubmitRoute.POST(req('/api/intake/submit', amToken, { method: 'POST', body: {} }));
    assert.ok([400, 403].includes(res.status), String(res.status));
  });
  await t('Super Admin user list → 403', async () => {
    assert.equal((await usersRoute.GET(req('/api/super-admin/users', amToken))).status, 403);
  });

  console.log(`\n${passed} passed`);
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(async () => {
    // Clean up everything this run created.
    await prisma.session.deleteMany({ where: { token: { in: tokens } } });
    if (createdUserIds.length) {
      await prisma.session.deleteMany({ where: { userId: { in: createdUserIds } } });
      await prisma.activityEvent.deleteMany({ where: { userId: { in: createdUserIds } } });
      // USER_CREATED events are logged under the acting Super Admin, so match on the email.
      await prisma.$runCommandRaw({ delete: 'ActivityEvent', deletes: [{ q: { 'metadata.email': { $regex: `^${TAG}` } }, limit: 0 }] });
      await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    }
    const left = await prisma.user.count({ where: { email: { startsWith: TAG } } });
    const events: any = await prisma.$runCommandRaw({ count: 'ActivityEvent', query: { 'metadata.email': { $regex: `^${TAG}` } } });
    console.log('cleanup — test users left:', left, '· test events left:', events.n);
    await prisma.$disconnect();
  });
