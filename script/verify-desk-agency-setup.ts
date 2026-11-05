/**
 * The Desk, Module 15: per-agency Desk setup.
 *
 * Turning The Desk on and off (and the effect on access), primary / backup
 * Account Managers (rules, open work following the change), the AMS profile
 * with the credential guard, plans with price and allowance overrides, late
 * billing classification, audit accuracy, who may do this, and two admins
 * saving at once. Uses temporary records only.
 * Run with:  npx tsx script/verify-desk-agency-setup.ts
 */
import 'dotenv/config';
import type { UserRole } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { DeskAccessError, resolveDeskScope } from '../lib/desk/access';
import { getAgencySetup, listDeskAgencies, setupChecklist, updateAgencySetup, type AgencySetupInput } from '../lib/desk/agency-setup';

let pass = 0, fail = 0;
const ok = (n: string, c: boolean) => { c ? pass++ : fail++; console.log(`  ${c ? '✓' : '✗'} ${n}`); };

const TAG = `m15test-${Date.now()}`;
const cleanup = { agencyIds: [] as string[], userIds: [] as string[], planIds: [] as string[] };
let ref = 960_000_000 + Math.floor(Math.random() * 1_000_000);

async function wipe() {
  const agencyId = { in: cleanup.agencyIds };
  const plans = await prisma.agencyDeskPlan.findMany({ where: { agencyId }, select: { id: true } });
  await prisma.agencyAllowanceOverride.deleteMany({ where: { agencyDeskPlanId: { in: plans.map((p) => p.id) } } });
  await prisma.agencyDeskPlan.deleteMany({ where: { agencyId } });
  await prisma.task.deleteMany({ where: { agencyId } });
  await prisma.insuredAccount.deleteMany({ where: { agencyId } });
  await prisma.agencyDeskAssignment.deleteMany({ where: { agencyId } });
  await prisma.deskAuditLog.deleteMany({ where: { OR: [{ agencyId }, { actorId: { in: cleanup.userIds } }] } });
  for (const id of cleanup.agencyIds) await prisma.deskCounter.deleteMany({ where: { id: { startsWith: `allowance:${id}:` } } });
  await prisma.deskPlanAllowance.deleteMany({ where: { planId: { in: cleanup.planIds } } });
  await prisma.deskPlan.deleteMany({ where: { id: { in: cleanup.planIds } } });
  await prisma.user.deleteMany({ where: { id: { in: cleanup.userIds } } });
  await prisma.agency.deleteMany({ where: { id: agencyId } });
}

(async () => {
  try {
    const mkAgency = async (n: string, deskEnabled = false) => {
      const a = await prisma.agency.create({ data: { name: `${TAG} ${n}`, deskEnabled } });
      cleanup.agencyIds.push(a.id); return a;
    };
    const mkUser = async (n: string, role: UserRole, agencyId: string | null = null, extra: object = {}) => {
      const u = await prisma.user.create({ data: { email: `${TAG}-${n}@example.test`, role, agencyId, firstName: n, ...extra } });
      cleanup.userIds.push(u.id); return u;
    };
    const mkPlan = async (code: string, extra: object = {}, allowance?: number | null) => {
      const p = await prisma.deskPlan.create({ data: { code: `${TAG}-${code}`, name: `${TAG} ${code}`, monthlyPriceCents: BigInt(150_000), ...extra } });
      cleanup.planIds.push(p.id);
      if (allowance !== undefined) await prisma.deskPlanAllowance.create({ data: { planId: p.id, category: 'COI', monthlyUnits: allowance } });
      return p;
    };
    const A = await mkAgency('Alpha');
    const B = await mkAgency('Bravo', true);
    const sa = await mkUser('sa', 'SUPER_ADMIN');
    const ops = await mkUser('ops', 'DESK_ADMIN');
    const am1 = await mkUser('am1', 'ACCOUNT_MANAGER');
    const am2 = await mkUser('am2', 'ACCOUNT_MANAGER');
    const am3 = await mkUser('am3', 'ACCOUNT_MANAGER');
    const amGone = await mkUser('am-gone', 'ACCOUNT_MANAGER', null, { isActive: false });
    const vaUser = await mkUser('va', 'DESK_VA');
    const adminA = await mkUser('admin-a', 'ADMIN', A.id);
    const core = await mkPlan('CORE');
    const complete = await mkPlan('COMPLETE', { priceIsStartingAt: true, monthlyPriceCents: BigInt(400_000) });
    const retired = await mkPlan('OLD', { isActive: false });
    const limited = await mkPlan('LTD', {}, 1);

    const opsScope = await resolveDeskScope(prisma, ops.id);
    const saScope = await resolveDeskScope(prisma, sa.id);
    const save = (agencyId: string, input: AgencySetupInput) => updateAgencySetup(prisma, opsScope, agencyId, input, { ip: '203.0.113.9', userAgent: 'verify' });
    const status = async (fn: () => Promise<unknown>) => {
      try { await fn(); return 200; } catch (e) { if (e instanceof DeskAccessError) return e.status; throw e; }
    };
    const message = async (fn: () => Promise<unknown>) => {
      try { await fn(); return ''; } catch (e) { if (e instanceof DeskAccessError) return e.message; throw e; }
    };
    const audits = (agencyId: string) => prisma.deskAuditLog.findMany({ where: { agencyId, action: 'agency.desk_updated' }, orderBy: { createdAt: 'desc' } });
    const auditMeta = (row: { metadata: unknown }) => row.metadata as Record<string, any>;

    console.log('Who may do this');
    for (const [name, id] of [['agency admin', adminA.id], ['Account Manager', am1.id], ['VA', vaUser.id]] as const) {
      const scope = await resolveDeskScope(prisma, id);
      ok(`${name}: cannot list`, await status(() => listDeskAgencies(prisma, scope)) === 403);
      ok(`${name}: cannot read`, await status(() => getAgencySetup(prisma, scope, A.id)) === 403);
      ok(`${name}: cannot save`, await status(() => updateAgencySetup(prisma, scope, A.id, { deskEnabled: true })) === 403);
    }
    ok('nothing was changed by the refused saves', (await prisma.agency.findUnique({ where: { id: A.id } }))!.deskEnabled === false);
    ok('Super Admin can read', await status(() => getAgencySetup(prisma, saScope, A.id)) === 200);
    ok('Operations Manager can read', await status(() => getAgencySetup(prisma, opsScope, A.id)) === 200);
    ok('unknown agency: 404', await status(() => getAgencySetup(prisma, opsScope, '507f1f77bcf86cd799439011')) === 404);
    ok('malformed id: 404', await status(() => getAgencySetup(prisma, opsScope, 'nope')) === 404);
    ok('saving an unknown agency: 404', await status(() => save('507f1f77bcf86cd799439011', { deskEnabled: true })) === 404);

    console.log('List');
    const rows = await listDeskAgencies(prisma, opsScope, { q: TAG });
    ok('search finds both, sorted by name', rows.map((r) => r.name).join() === `${TAG} Alpha,${TAG} Bravo`);
    ok('search ignores case', (await listDeskAgencies(prisma, opsScope, { q: TAG.toUpperCase() })).length === 2);
    ok('filter: on', (await listDeskAgencies(prisma, opsScope, { q: TAG, desk: 'on' })).map((r) => r.name).join() === `${TAG} Bravo`);
    ok('filter: off', (await listDeskAgencies(prisma, opsScope, { q: TAG, desk: 'off' })).map((r) => r.name).join() === `${TAG} Alpha`);

    console.log('Turning The Desk on');
    const beforeOn = await resolveDeskScope(prisma, adminA.id);
    ok('agency admin has no Desk access before', beforeOn.kind === 'NONE');
    let result = await save(A.id, { deskEnabled: true });
    ok('saved as on, with the date', result.setup.deskEnabled && !!result.setup.deskEnabledAt);
    ok('agency admin has access right away', (await resolveDeskScope(prisma, adminA.id)).kind === 'AGENCY');
    ok('checklist lists what is still missing', result.setup.checklist.filter((c) => !c.done).length === 4);
    let log = (await audits(A.id))[0];
    ok('audited with actor, change, IP', log.actorId === ops.id && auditMeta(log).deskEnabled.to === true && log.ipAddress === '203.0.113.9');

    console.log('Account Managers');
    ok('must exist', await status(() => save(A.id, { primaryAmId: '507f1f77bcf86cd799439011' })) === 400);
    ok('must be an Account Manager (VA refused)', await status(() => save(A.id, { primaryAmId: vaUser.id })) === 400);
    ok('must be an Account Manager (agency user refused)', await status(() => save(A.id, { primaryAmId: adminA.id })) === 400);
    ok('must be active', await status(() => save(A.id, { primaryAmId: amGone.id })) === 400);
    ok('malformed id refused', await status(() => save(A.id, { primaryAmId: 'x' })) === 400);
    ok('backup needs a primary', await status(() => save(A.id, { backupAmId: am2.id })) === 400);
    result = await save(A.id, { primaryAmId: am1.id, backupAmId: am2.id });
    ok('primary and backup saved', result.setup.primaryAm?.id === am1.id && result.setup.backupAm?.id === am2.id);
    ok('same person twice refused', await status(() => save(A.id, { backupAmId: am1.id })) === 400);
    const am1Scope = await resolveDeskScope(prisma, am1.id);
    const am2Scope = await resolveDeskScope(prisma, am2.id);
    ok('both can now see the agency', am1Scope.kind === 'ACCOUNT_MANAGER' && am1Scope.agencyIds.includes(A.id) && am2Scope.kind === 'ACCOUNT_MANAGER' && am2Scope.agencyIds.includes(A.id));
    ok('list shows them', (await listDeskAgencies(prisma, opsScope, { q: `${TAG} Alpha` }))[0].primaryAm === 'am1');

    const insured = await prisma.insuredAccount.create({ data: { agencyId: A.id, name: `${TAG} insured`, nameKey: `${TAG} insured` } });
    const mkTask = (data: object) => prisma.task.create({ data: { reference: ref++, agencyId: A.id, insuredId: insured.id, type: 'COI', title: 't', source: 'INTERNAL', createdById: ops.id, restrictedToUserIds: [], ...data } as never });
    const open = await mkTask({ status: 'IN_PROGRESS', amId: am1.id, assigneeId: am1.id });
    const openOther = await mkTask({ status: 'NEW', amId: null });
    const done = await mkTask({ status: 'COMPLETED', amId: am1.id, completedAt: new Date(), billingClass: 'NON_BILLABLE' });
    result = await save(A.id, { primaryAmId: am3.id });
    const amOf = async (id: string) => (await prisma.task.findUnique({ where: { id } }))!.amId;
    ok('open work moves to the new primary', await amOf(open.id) === am3.id && await amOf(openOther.id) === am3.id);
    ok('completed work keeps who handled it', await amOf(done.id) === am1.id);
    ok('tells the admin about work still assigned to the person removed', result.notices.some((n) => n.includes('1 open request is still assigned')));
    log = (await audits(A.id))[0];
    ok('audit records the change and how much moved', auditMeta(log).accountManagers.from.primary === am1.id && auditMeta(log).accountManagers.to.primary === am3.id && auditMeta(log).openTasksMoved === 2);
    const am1After = await resolveDeskScope(prisma, am1.id);
    ok('the person removed loses access', am1After.kind === 'ACCOUNT_MANAGER' && !am1After.agencyIds.includes(A.id));
    result = await save(A.id, { backupAmId: null });
    ok('removing the backup leaves open work alone', await amOf(open.id) === am3.id && result.setup.backupAm === null);
    await prisma.user.update({ where: { id: am3.id }, data: { isActive: false } });
    result = await save(A.id, { deskInstructions: 'Call before noon.' });
    ok('an AM deactivated later does not block other changes', result.setup.deskInstructions === 'Call before noon.');
    ok('checklist flags the inactive AM', result.setup.checklist.find((c) => c.key === 'am')!.done === false);
    ok('form still offers them so they can be replaced', result.setup.options.accountManagers.some((m) => m.id === am3.id && !m.isActive));
    await prisma.user.update({ where: { id: am3.id }, data: { isActive: true } });
    ok('checklist rule', setupChecklist({ primaryAm: { isActive: true }, plan: {}, amsSystem: 'AMS360', counts: { podsAuthorized: 1 } }).every((c) => c.done));

    console.log('Agency profile');
    result = await save(A.id, { amsSystem: 'APPLIED_EPIC' });
    ok('AMS saved', result.setup.amsSystem === 'APPLIED_EPIC');
    ok('unknown AMS refused', await status(() => save(A.id, { amsSystem: 'NOPE' as never })) === 400);
    ok('"Other" needs a name', await status(() => save(A.id, { amsSystem: 'OTHER', amsSystemOther: '  ' })) === 400);
    result = await save(A.id, { amsSystem: 'OTHER', amsSystemOther: ' NowCerts ' });
    ok('"Other" keeps the trimmed name', result.setup.amsSystemOther === 'NowCerts');
    result = await save(A.id, { amsSystem: 'HAWKSOFT', amsSystemOther: 'leftover' });
    ok('leaving "Other" clears the name', result.setup.amsSystem === 'HAWKSOFT' && result.setup.amsSystemOther === null);
    for (const [field, input] of [
      ['instructions', { deskInstructions: 'Epic password: hunter2' }],
      ['instructions (pwd=)', { deskInstructions: 'pwd=abc123' }],
      ['vault location', { credentialVaultRef: 'password: hunter2' }],
      ['AMS name', { amsSystem: 'OTHER', amsSystemOther: 'pin: 1234' }],
    ] as [string, AgencySetupInput][]) {
      ok(`credential refused in ${field}`, (await message(() => save(A.id, input))).includes('Credentials are never stored'));
    }
    ok('refused text was not saved', !(await prisma.agency.findUnique({ where: { id: A.id } }))!.deskInstructions?.includes('hunter2'));
    result = await save(A.id, { deskInstructions: 'Logins are in 1Password. Reset the password via the portal.', credentialVaultRef: '1Password › Desk › Alpha' });
    ok('ordinary mentions allowed', result.setup.credentialVaultRef === '1Password › Desk › Alpha');
    log = (await audits(A.id))[0];
    ok('audit lists the fields changed', auditMeta(log).changed.join() === 'deskInstructions,credentialVaultRef');
    ok('audit does not contain the text', !JSON.stringify(log.metadata).includes('1Password'));
    ok('too-long instructions refused', await status(() => save(A.id, { deskInstructions: 'x'.repeat(5001) })) === 400);
    result = await save(A.id, { deskInstructions: '   ' });
    ok('blank text clears the field', result.setup.deskInstructions === null);

    console.log('Plan');
    const plan = (extra: object = {}) => ({ plan: { planId: core.id, startsOn: '2026-11-01', ...extra } });
    ok('start date required', await status(() => save(A.id, plan({ startsOn: '' }))) === 400);
    ok('impossible date refused', await status(() => save(A.id, plan({ startsOn: '2026-02-30' }))) === 400);
    ok('unknown plan refused', await status(() => save(A.id, plan({ planId: '507f1f77bcf86cd799439011' }))) === 400);
    ok('a plan no longer offered refused', await status(() => save(A.id, plan({ planId: retired.id }))) === 400);
    ok('negative price refused', await status(() => save(A.id, plan({ monthlyPriceCents: -1 }))) === 400);
    ok('fractional cents refused', await status(() => save(A.id, plan({ monthlyPriceCents: 10.5 }))) === 400);
    ok('"from" plan needs the agreed price', (await message(() => save(A.id, plan({ planId: complete.id })))).includes('agreed monthly price'));
    result = await save(A.id, plan());
    ok('plan saved', result.setup.plan?.planId === core.id && result.setup.plan.startsOn === '2026-11-01' && result.setup.plan.monthlyPriceCents === null);
    result = await save(A.id, plan({ planId: complete.id, monthlyPriceCents: 525_000, managedAccountsOverride: 400, notes: 'Agreed Nov.' }));
    ok('agreed price saved and returned as a plain number', result.setup.plan?.monthlyPriceCents === 525_000 && JSON.stringify(result.setup).length > 0);
    ok('managed accounts and notes saved', result.setup.plan?.managedAccountsOverride === 400 && result.setup.plan?.notes === 'Agreed Nov.');
    ok('still one plan per agency', await prisma.agencyDeskPlan.count({ where: { agencyId: A.id } }) === 1);
    ok('credential refused in plan notes', (await message(() => save(A.id, plan({ notes: 'password: x1' })))).includes('Credentials'));

    console.log('Allowance overrides');
    const withOverrides = (overrides: unknown) => plan({ planId: complete.id, monthlyPriceCents: 525_000, managedAccountsOverride: 400, notes: 'Agreed Nov.', overrides });
    ok('unknown category refused', await status(() => save(A.id, withOverrides([{ category: 'NOPE', monthlyUnits: 1 }]))) === 400);
    ok('negative units refused', await status(() => save(A.id, withOverrides([{ category: 'COI', monthlyUnits: -1 }]))) === 400);
    ok('fractional units refused', await status(() => save(A.id, withOverrides([{ category: 'COI', monthlyUnits: 1.5 }]))) === 400);
    ok('same category twice refused', await status(() => save(A.id, withOverrides([{ category: 'COI', monthlyUnits: 1 }, { category: 'COI', monthlyUnits: 2 }]))) === 400);
    result = await save(A.id, withOverrides([{ category: 'COI', monthlyUnits: 50 }, { category: 'RENEWAL', monthlyUnits: null }]));
    const byCat = Object.fromEntries(result.setup.plan!.overrides.map((o) => [o.category, o.monthlyUnits]));
    ok('units and unlimited saved', byCat.COI === 50 && byCat.RENEWAL === null);
    result = await save(A.id, withOverrides([{ category: 'ENDORSEMENT', monthlyUnits: 5 }]));
    ok('a save replaces the whole set', result.setup.plan!.overrides.map((o) => o.category).join() === 'ENDORSEMENT');

    console.log('Saving without changes');
    const countBefore = (await audits(A.id)).length;
    const s = result.setup;
    result = await save(A.id, {
      version: s.version, deskEnabled: s.deskEnabled, primaryAmId: s.primaryAm?.id ?? null, backupAmId: s.backupAm?.id ?? null,
      amsSystem: s.amsSystem, amsSystemOther: s.amsSystemOther, deskInstructions: s.deskInstructions, credentialVaultRef: s.credentialVaultRef,
      plan: { planId: s.plan!.planId, startsOn: s.plan!.startsOn, monthlyPriceCents: s.plan!.monthlyPriceCents, managedAccountsOverride: s.plan!.managedAccountsOverride, notes: s.plan!.notes, overrides: s.plan!.overrides },
    });
    ok('re-saving the form unchanged writes no audit entry', (await audits(A.id)).length === countBefore);
    ok('and does not bump the version', result.setup.version === s.version);

    console.log('Removing the plan');
    result = await save(A.id, { plan: null });
    ok('plan gone', result.setup.plan === null);
    ok('its overrides gone too', await prisma.agencyAllowanceOverride.count({ where: { category: 'ENDORSEMENT', monthlyUnits: 5, agencyDeskPlan: { agencyId: A.id } } }) === 0);
    const noPlanCount = (await audits(A.id)).length;
    await save(A.id, { plan: null });
    ok('removing again changes nothing', (await audits(A.id)).length === noPlanCount);

    console.log('Waiting billing is classified once a plan applies');
    const pending = (day: string) => mkTask({ status: 'COMPLETED', completedAt: new Date(`2026-10-${day}T15:00:00Z`), billingPeriod: '2026-10', serviceCategory: 'COI', billableUnits: 1, nonBillable: false });
    const pendingTask = await pending('15');
    const pendingTask2 = await pending('16');
    ok('counted as waiting', (await getAgencySetup(prisma, opsScope, A.id)).counts.pendingBilling === 2);
    result = await save(A.id, { plan: { planId: core.id, startsOn: '2026-10-01' } });
    ok('a plan with no allowance leaves them waiting', result.setup.counts.pendingBilling === 2 && result.notices.length === 0);
    result = await save(A.id, { plan: { planId: limited.id, startsOn: '2026-10-01' } });
    const cls = async (id: string) => (await prisma.task.findUnique({ where: { id } }))!.billingClass;
    ok('oldest included, next is overage (allowance of 1)', await cls(pendingTask.id) === 'INCLUDED' && await cls(pendingTask2.id) === 'OVERAGE');
    ok('admin told how many', result.notices.some((n) => n.includes('2 completed requests were classified')));
    ok('none left waiting', result.setup.counts.pendingBilling === 0);

    console.log('Turning The Desk off');
    const refused = await message(() => save(A.id, { deskEnabled: false }));
    ok('refused while work is open, with the count', refused.includes('2 open requests'));
    ok('still on', (await prisma.agency.findUnique({ where: { id: A.id } }))!.deskEnabled === true);
    result = await save(A.id, { deskEnabled: false, confirmDisable: true });
    ok('allowed once confirmed; date cleared', !result.setup.deskEnabled && result.setup.deskEnabledAt === null);
    ok('agency user loses access right away', (await resolveDeskScope(prisma, adminA.id)).kind === 'NONE');
    const am3Scope = await resolveDeskScope(prisma, am3.id);
    ok('Account Manager loses it too', am3Scope.kind === 'ACCOUNT_MANAGER' && !am3Scope.agencyIds.includes(A.id));
    ok('agency with no open work needs no confirmation', await status(() => save(B.id, { deskEnabled: false })) === 200);

    console.log('Two admins at once');
    const fresh = await getAgencySetup(prisma, opsScope, B.id);
    await save(B.id, { version: fresh.version, deskInstructions: 'First admin.' });
    ok('a save from an out-of-date form is refused', await status(() => save(B.id, { version: fresh.version, deskInstructions: 'Second admin.' })) === 409);
    ok('the first save stands', (await prisma.agency.findUnique({ where: { id: B.id } }))!.deskInstructions === 'First admin.');
    const racing = await getAgencySetup(prisma, opsScope, B.id);
    const outcomes = await Promise.all(['Racer one.', 'Racer two.'].map((t) => status(() => save(B.id, { version: racing.version, deskInstructions: t }))));
    ok('two saves at the same moment: exactly one wins', outcomes.filter((c) => c === 200).length === 1 && outcomes.filter((c) => c === 409).length === 1);
    // Forces the gap the version check alone cannot see: another save lands
    // after this one has read the agency and before it writes.
    let interrupted = false;
    const interrupting = new Proxy(prisma, {
      get(target, key) {
        const value = Reflect.get(target, key);
        if (key !== 'agency') return typeof value === 'function' ? value.bind(target) : value;
        return new Proxy(target.agency, {
          get(agency, method) {
            const fn = Reflect.get(agency, method) as (...args: unknown[]) => unknown;
            if (method !== 'findUnique') return typeof fn === 'function' ? fn.bind(agency) : fn;
            return async (args: unknown) => {
              const row = await fn.call(agency, args);
              if (!interrupted) {
                interrupted = true;
                await prisma.agency.update({ where: { id: B.id }, data: { deskInstructions: 'Landed in between.' } });
              }
              return row;
            };
          },
        });
      },
    });
    const latest = await getAgencySetup(prisma, opsScope, B.id);
    ok('a save landing between read and write is not overwritten',
      await status(() => updateAgencySetup(interrupting, opsScope, B.id, { version: latest.version, deskInstructions: 'Overwrites it.' })) === 409
      && (await prisma.agency.findUnique({ where: { id: B.id } }))!.deskInstructions === 'Landed in between.');
  } catch (e) {
    fail++;
    console.error(e);
  } finally {
    await wipe();
    const left = await prisma.user.count({ where: { id: { in: cleanup.userIds } } }) + await prisma.agency.count({ where: { id: { in: cleanup.agencyIds } } }) + await prisma.deskPlan.count({ where: { id: { in: cleanup.planIds } } });
    ok('temporary records removed', left === 0);
    console.log(`\n${pass} passed, ${fail} failed`);
    await prisma.$disconnect();
    process.exit(fail ? 1 : 0);
  }
})();
