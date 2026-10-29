/**
 * The Desk, Module 6: agency Desk profile (AMS, instructions, vault reference)
 * and billing data (plans, allowances, agency plan + overrides, task billing).
 *
 * Verifies the credential guard, type → category mapping, billing month in a
 * time zone, allowance resolution, the seeded plans, and the new models'
 * constraints and delete behaviour. Uses temporary records only.
 * Run with:  npx tsx script/verify-desk-billing.ts
 */
import 'dotenv/config';
import { TaskType } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { amsDisplayName, looksLikeCredential } from '../lib/desk/profile';
import { SERVICE_CATEGORY_BY_TYPE, defaultBilling, billingPeriodOf, resolveAllowance, resolveManagedAccounts } from '../lib/desk/billing';
import { DEFAULT_PLANS } from '../lib/desk/defaults';
import { BILLING_UNCLASSIFIED } from '../lib/desk/task-filters';

let pass = 0, fail = 0;
const ok = (n: string, c: boolean) => { c ? pass++ : fail++; console.log(`  ${c ? '✓' : '✗'} ${n}`); };
const rejects = async (fn: () => Promise<unknown>) => { try { await fn(); return false; } catch { return true; } };

const TAG = `m6test-${Date.now()}`;
const cleanup = { agencyId: '', planIds: [] as string[] };
let ref = 910_000_000 + Math.floor(Math.random() * 1_000_000);

async function wipe() {
  if (cleanup.agencyId) {
    await prisma.task.deleteMany({ where: { agencyId: cleanup.agencyId } });
    const ap = await prisma.agencyDeskPlan.findMany({ where: { agencyId: cleanup.agencyId }, select: { id: true } });
    await prisma.agencyAllowanceOverride.deleteMany({ where: { agencyDeskPlanId: { in: ap.map((a) => a.id) } } });
    await prisma.agencyDeskPlan.deleteMany({ where: { agencyId: cleanup.agencyId } });
    await prisma.agency.deleteMany({ where: { id: cleanup.agencyId } });
  }
  await prisma.deskPlanAllowance.deleteMany({ where: { planId: { in: cleanup.planIds } } });
  await prisma.agencyDeskPlan.deleteMany({ where: { planId: { in: cleanup.planIds } } });
  await prisma.deskPlan.deleteMany({ where: { id: { in: cleanup.planIds } } });
}

(async () => {
  console.log('\n━━ AMS profile ━━');
  ok('AMS names', amsDisplayName('APPLIED_EPIC') === 'Applied Epic' && amsDisplayName('QQCATALYST') === 'QQCatalyst');
  ok('"Other" shows the agency\'s own AMS name, or "Other" if blank',
    amsDisplayName('OTHER', 'NowCerts') === 'NowCerts' && amsDisplayName('OTHER', '  ') === 'Other' && amsDisplayName(null) === null);

  console.log('\n━━ Credential guard ━━');
  const secrets = [
    'Epic password: Summer2026!', 'Carrier portal pwd=abc123', 'PW: tiger', 'Office PIN: 4471',
    'API key: sk-live-9f8e7d', 'Security answer: Fluffy', 'Login jdoe / Password: Hunter2',
    'passcode = 0000', 'Access token: eyJhbGci',
  ];
  const safe = [
    'Logins are stored in 1Password under Desk › Acme.',
    'Reset the password through the carrier portal if locked out.',
    'Ask the agency admin for the password manager entry.',
    'Passport copy required for named drivers.',
    'Compass Insurance policies go to Pod 2.',
    'COIs need additional insured wording from the contract.',
    'Pinned note: always CC the producer.',
  ];
  ok(`refuses all ${secrets.length} credential-like texts`, secrets.every((t) => looksLikeCredential(t) !== null));
  {
    const flagged = safe.filter((t) => looksLikeCredential(t) !== null);
    ok(`allows all ${safe.length} ordinary instructions (no false alarms)`, flagged.length === 0);
    if (flagged.length) console.log('    false alarms:', flagged);
  }
  ok('empty text is fine', looksLikeCredential('') === null && looksLikeCredential(null) === null);

  console.log('\n━━ Billing rules ━━');
  ok('every request type maps to a service category',
    Object.values(TaskType).every((t) => SERVICE_CATEGORY_BY_TYPE[t] !== undefined));
  ok('COI → COI, billable', JSON.stringify(defaultBilling('COI')) === JSON.stringify({ serviceCategory: 'COI', nonBillable: false }));
  ok('Submission and Proposal Prep count as New Business; Loss Runs as Renewal',
    defaultBilling('SUBMISSION').serviceCategory === 'NEW_BUSINESS' && defaultBilling('PROPOSAL_PREP').serviceCategory === 'NEW_BUSINESS' &&
    defaultBilling('LOSS_RUNS').serviceCategory === 'RENEWAL');
  ok('QA review is internal and never billed', defaultBilling('QA_REVIEW').nonBillable === true);
  ok('9:59pm New York on 31 Oct counts toward October (already November in UTC)',
    billingPeriodOf(new Date('2026-11-01T01:59:00Z'), 'America/New_York') === '2026-10' &&
    billingPeriodOf(new Date('2026-11-01T01:59:00Z'), 'UTC') === '2026-11');
  ok('…and the zone matters the other way too (India is ahead)',
    billingPeriodOf(new Date('2026-10-31T19:00:00Z'), 'Asia/Kolkata') === '2026-11');
  {
    const plan = [{ category: 'COI' as const, monthlyUnits: 50 }, { category: 'RENEWAL' as const, monthlyUnits: null }];
    const over = [{ category: 'COI' as const, monthlyUnits: 80 }];
    const r = (c: 'COI' | 'RENEWAL' | 'ENDORSEMENT', o = over) => resolveAllowance(c, plan, o);
    ok('allowance: agency override (80) beats the plan (50)', JSON.stringify(r('COI')) === JSON.stringify({ configured: true, unlimited: false, units: 80 }));
    ok('allowance: plan value used without an override', (r('COI', []) as { units: number }).units === 50);
    ok('allowance: null means unlimited', (r('RENEWAL') as { unlimited: boolean }).unlimited === true);
    ok('allowance: no row anywhere is reported as not configured', r('ENDORSEMENT').configured === false);
  }
  ok('managed accounts: override, else plan, else not configured',
    resolveManagedAccounts({ managedAccounts: 100 }, { managedAccountsOverride: 150 }) === 150 &&
    resolveManagedAccounts({ managedAccounts: 100 }, null) === 100 &&
    resolveManagedAccounts({ managedAccounts: null }) === null);

  console.log('\n━━ Seeded plans ━━');
  const plans = await prisma.deskPlan.findMany({ where: { code: { in: DEFAULT_PLANS.map((p) => p.code) } }, orderBy: { sortOrder: 'asc' } });
  ok('Core $1,500 · Growth $2,500 · Complete from $4,000',
    plans.map((p) => `${p.code}:${p.monthlyPriceCents}:${p.priceIsStartingAt}`).join(' ') ===
    'CORE:150000:false GROWTH:250000:false COMPLETE:400000:true');
  ok('no allowances seeded yet (waiting on the client\'s numbers)',
    (await prisma.deskPlanAllowance.count({ where: { planId: { in: plans.map((p) => p.id) } } })) === 0);
  ok('plan code is unique', await rejects(() => prisma.deskPlan.create({ data: { code: 'CORE', name: 'dup', monthlyPriceCents: BigInt(1) } })));
  ok('follow-up rules are non-billable (backfilled), and the filter finds them',
    (await prisma.taskFollowUpRule.count({ where: { billable: false } })) === (await prisma.taskFollowUpRule.count()));

  console.log('\n━━ Agency profile and plan ━━');
  const testPlan = await prisma.deskPlan.create({ data: { code: `${TAG}-PLAN`, name: 'Test plan', monthlyPriceCents: BigInt(100_000), managedAccounts: 100 } });
  cleanup.planIds.push(testPlan.id);
  await prisma.deskPlanAllowance.create({ data: { planId: testPlan.id, category: 'COI', monthlyUnits: 50 } });
  ok('one allowance row per plan and category',
    await rejects(() => prisma.deskPlanAllowance.create({ data: { planId: testPlan.id, category: 'COI', monthlyUnits: 1 } })));

  const agency = await prisma.agency.create({ data: {
    name: `${TAG} agency`, amsSystem: 'OTHER', amsSystemOther: 'NowCerts',
    deskInstructions: 'Always CC the producer on COIs.', credentialVaultRef: '1Password › Desk › Test Agency',
  } });
  cleanup.agencyId = agency.id;
  ok('profile fields stored', amsDisplayName(agency.amsSystem, agency.amsSystemOther) === 'NowCerts' && agency.credentialVaultRef?.startsWith('1Password') === true);

  const ap = await prisma.agencyDeskPlan.create({ data: { agencyId: agency.id, planId: testPlan.id, startsOn: new Date('2026-11-01'), monthlyPriceCents: BigInt(450_000) } });
  ok('one plan per agency', await rejects(() => prisma.agencyDeskPlan.create({ data: { agencyId: agency.id, planId: testPlan.id, startsOn: new Date() } })));
  await prisma.agencyAllowanceOverride.create({ data: { agencyDeskPlanId: ap.id, category: 'COI', monthlyUnits: 80 } });
  ok('one override per agency and category',
    await rejects(() => prisma.agencyAllowanceOverride.create({ data: { agencyDeskPlanId: ap.id, category: 'COI', monthlyUnits: 1 } })));
  {
    const loaded = await prisma.agencyDeskPlan.findUniqueOrThrow({
      where: { agencyId: agency.id }, include: { plan: { include: { allowances: true } }, allowanceOverrides: true },
    });
    const a = resolveAllowance('COI', loaded.plan.allowances, loaded.allowanceOverrides);
    ok('allowance resolved from stored rows: the agency\'s 80 COIs, not the plan\'s 50', a.configured && !a.unlimited && a.units === 80);
    ok('negotiated price stored on the agency\'s plan', loaded.monthlyPriceCents === BigInt(450_000));
  }
  ok('a plan with agencies on it cannot be deleted', await rejects(() => prisma.deskPlan.delete({ where: { id: testPlan.id } })));

  console.log('\n━━ Task billing fields ━━');
  const t = await prisma.task.create({ data: { reference: ++ref, agencyId: agency.id, type: 'COI', title: 'COI for test', ...defaultBilling('COI') } });
  ok('defaults: standard complexity, 1 unit, billable, not yet classified',
    t.complexity === 'STANDARD' && t.billableUnits === 1 && t.nonBillable === false && t.serviceCategory === 'COI' && t.billingClass === null);
  ok('bare `billingClass: null` misses it; BILLING_UNCLASSIFIED finds it',
    (await prisma.task.count({ where: { id: t.id, billingClass: null } })) === 0 &&
    (await prisma.task.count({ where: { id: t.id, ...BILLING_UNCLASSIFIED } })) === 1);
  await prisma.task.update({ where: { id: t.id }, data: { complexity: 'COMPLEX', billingClass: 'OVERAGE', billingStatus: 'UNBILLED', billingPeriod: '2026-11', billableUnits: 2 } });
  ok('month query: the agency\'s classified work for 2026-11',
    (await prisma.task.count({ where: { agencyId: agency.id, billingPeriod: '2026-11', billingClass: 'OVERAGE' } })) === 1);

  console.log('\n━━ Delete behaviour ━━');
  await prisma.task.deleteMany({ where: { agencyId: agency.id } });
  await prisma.agency.delete({ where: { id: agency.id } });
  ok('deleting an agency removes its plan assignment and overrides',
    (await prisma.agencyDeskPlan.count({ where: { id: ap.id } })) === 0 &&
    (await prisma.agencyAllowanceOverride.count({ where: { agencyDeskPlanId: ap.id } })) === 0);
  cleanup.agencyId = '';
  await prisma.deskPlan.delete({ where: { id: testPlan.id } });
  ok('an unused plan can be deleted, removing its allowances',
    (await prisma.deskPlanAllowance.count({ where: { planId: testPlan.id } })) === 0);
  cleanup.planIds = [];

  await wipe();
  ok('cleaned up',
    (await prisma.agency.count({ where: { name: { startsWith: TAG } } })) === 0 &&
    (await prisma.deskPlan.count({ where: { code: { startsWith: TAG } } })) === 0 &&
    (await prisma.deskPlan.count()) === DEFAULT_PLANS.length);

  console.log(`\n━━ ${pass} passed, ${fail} failed ━━\n`);
  await prisma.$disconnect();
  process.exit(fail ? 1 : 0);
})().catch(async (e) => {
  console.error('ERROR', e);
  await wipe().catch(() => {});
  await prisma.$disconnect();
  process.exit(1);
});
