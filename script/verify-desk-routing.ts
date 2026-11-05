/**
 * The Desk, Module 18: routing and service-level editor.
 *
 * Who may edit; routing a request type to a pod, unrouting it, default
 * priority; Desk and per-agency targets with their rules; what new requests
 * actually get; open requests left alone; and the seeder not undoing an edit.
 *
 * Safety: writes go only to the Other and Proposal preparation request types,
 * which have nothing seeded, or to temporary agencies. A snapshot of all
 * seeded routing and targets is compared at the end, so a stray write to real
 * data fails this suite even when a guard has been deliberately broken.
 * Run with:  npx tsx script/verify-desk-routing.ts
 */
import 'dotenv/config';
import type { TaskType, UserRole } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { DeskAccessError, resolveDeskScope } from '../lib/desk/access';
import { ensureDeskDefaults } from '../lib/desk/defaults';
import { getRoutingSetup, removeTarget, saveTarget, setRouting } from '../lib/desk/routing-admin';
import { createTask } from '../lib/desk/tasks';
import { COMPLEXITY_LABELS, PRIORITY_LABELS, TASK_TYPE_LABELS } from '../lib/desk/service-levels';

let pass = 0, fail = 0;
const ok = (n: string, c: boolean) => { c ? pass++ : fail++; console.log(`  ${c ? '✓' : '✗'} ${n}`); };

const TAG = `m18test-${Date.now()}`;
const FREE: TaskType = 'OTHER';           // no routing rule and no target is seeded for it
const FREE_TARGET: TaskType = 'PROPOSAL_PREP'; // no target is seeded for it (D5)
const cleanup = { agencyIds: [] as string[], userIds: [] as string[], podIds: [] as string[] };

/** Everything seeded, as text, leaving out what tests may write. */
async function seededSnapshot() {
  const rules = await prisma.taskRoutingRule.findMany({ where: { taskType: { not: FREE } }, orderBy: { taskType: 'asc' } });
  const targets = await prisma.serviceLevelTarget.findMany({ where: { taskType: { notIn: [FREE, FREE_TARGET] }, agencyId: null }, orderBy: { id: 'asc' } });
  return JSON.stringify({ rules, targets });
}

async function wipe() {
  const agencyId = { in: cleanup.agencyIds };
  await prisma.taskEvent.deleteMany({ where: { agencyId } });
  await prisma.task.deleteMany({ where: { agencyId } });
  await prisma.insuredAccount.deleteMany({ where: { agencyId } });
  await prisma.serviceLevelTarget.deleteMany({ where: { OR: [{ agencyId }, { taskType: { in: [FREE, FREE_TARGET] } }] } });
  await prisma.taskRoutingRule.deleteMany({ where: { taskType: FREE } });
  await prisma.deskAuditLog.deleteMany({ where: { OR: [{ agencyId }, { actorId: { in: cleanup.userIds } }] } });
  await prisma.pod.deleteMany({ where: { id: { in: cleanup.podIds } } });
  await prisma.user.deleteMany({ where: { id: { in: cleanup.userIds } } });
  await prisma.agency.deleteMany({ where: { id: agencyId } });
}

(async () => {
  const before = await seededSnapshot();
  try {
    const mkUser = async (n: string, role: UserRole, agencyId: string | null = null) => {
      const u = await prisma.user.create({ data: { email: `${TAG}-${n}@example.test`, role, agencyId, firstName: n, passwordHash: 'x' } });
      cleanup.userIds.push(u.id); return u;
    };
    const A = await prisma.agency.create({ data: { name: `${TAG} A`, deskEnabled: true } }); cleanup.agencyIds.push(A.id);
    const B = await prisma.agency.create({ data: { name: `${TAG} B`, deskEnabled: true } }); cleanup.agencyIds.push(B.id);
    const ops = await mkUser('ops', 'DESK_ADMIN');
    const am = await mkUser('am', 'ACCOUNT_MANAGER');
    const va = await mkUser('va', 'DESK_VA');
    const admin = await mkUser('admin-a', 'ADMIN', A.id);
    const scope = await resolveDeskScope(prisma, ops.id);
    const CTX = { ip: '203.0.113.8', userAgent: 'verify' };
    const podA = await prisma.pod.create({ data: { code: `${TAG}-A`, name: `${TAG} Pod A` } }); cleanup.podIds.push(podA.id);
    const podB = await prisma.pod.create({ data: { code: `${TAG}-B`, name: `${TAG} Pod B` } }); cleanup.podIds.push(podB.id);
    const podOff = await prisma.pod.create({ data: { code: `${TAG}-OFF`, name: `${TAG} Pod Off`, isActive: false } }); cleanup.podIds.push(podOff.id);
    const insured = await prisma.insuredAccount.create({ data: { agencyId: A.id, name: `${TAG} i`, nameKey: `${TAG} i` } });
    const insuredB = await prisma.insuredAccount.create({ data: { agencyId: B.id, name: `${TAG} j`, nameKey: `${TAG} j` } });

    const status = async (fn: () => Promise<unknown>) => {
      try { await fn(); return 200; } catch (e) { if (e instanceof DeskAccessError) return e.status; throw e; }
    };
    const rule = () => prisma.taskRoutingRule.findUnique({ where: { taskType: FREE } });
    const row = async (type: TaskType, agencyId: string | null = null) => (await getRoutingSetup(prisma, scope, agencyId)).types.find((t) => t.type === type)!;
    const newTask = (input: object) => createTask(prisma, scope, { type: FREE, title: 'x', insuredId: insured.id, ...input }, CTX);
    const audits = (action: string) => prisma.deskAuditLog.count({ where: { action, actorId: ops.id } });

    console.log('Who may do this');
    for (const [name, id] of [['agency admin', admin.id], ['Account Manager', am.id], ['VA', va.id]] as const) {
      const s = await resolveDeskScope(prisma, id);
      ok(`${name}: cannot read`, await status(() => getRoutingSetup(prisma, s)) === 403);
      ok(`${name}: cannot change routing`, await status(() => setRouting(prisma, s, { taskType: FREE, podId: podA.id })) === 403);
      ok(`${name}: cannot save a target`, await status(() => saveTarget(prisma, s, { taskType: FREE, kind: 'BUSINESS_TIME', businessDays: 1 })) === 403);
      ok(`${name}: cannot remove a target`, await status(() => removeTarget(prisma, s, '507f1f77bcf86cd799439011')) === 403);
    }

    console.log('What the editor shows');
    const setup = await getRoutingSetup(prisma, scope);
    ok('every request type is listed, with a label', setup.types.length === Object.keys(TASK_TYPE_LABELS).length && setup.types.every((t) => t.label));
    ok('labels exist for priority and complexity', Object.keys(PRIORITY_LABELS).length === 4 && Object.keys(COMPLEXITY_LABELS).length === 2);
    const coi = setup.types.find((t) => t.type === 'COI')!;
    ok('seeded routing shows its pod', coi.podName?.startsWith('Pod 1') === true);
    ok('client target reads correctly', coi.effective.standard?.description === '4 business hours' && coi.effective.complex?.description === '1 business day');
    ok('Other starts unrouted, with no target', setup.types.find((t) => t.type === FREE)!.podId === null && setup.types.find((t) => t.type === FREE)!.effective.standard === null);
    ok('switched-off pods are not offered', !setup.pods.some((p) => p.id === podOff.id));
    ok('unknown agency: 404', await status(() => getRoutingSetup(prisma, scope, '507f1f77bcf86cd799439011')) === 404);
    ok('malformed agency: 404', await status(() => getRoutingSetup(prisma, scope, 'nope')) === 404);

    console.log('Routing');
    ok('unknown type refused', await status(() => setRouting(prisma, scope, { taskType: 'NOPE', podId: podA.id })) === 400);
    ok('unknown pod refused', await status(() => setRouting(prisma, scope, { taskType: FREE, podId: '507f1f77bcf86cd799439011' })) === 400);
    ok('malformed pod refused', await status(() => setRouting(prisma, scope, { taskType: FREE, podId: 'x' })) === 400);
    ok('switched-off pod refused', await status(() => setRouting(prisma, scope, { taskType: FREE, podId: podOff.id })) === 409);
    ok('unknown priority refused', await status(() => setRouting(prisma, scope, { taskType: FREE, podId: podA.id, defaultPriority: 'NOPE' })) === 400);
    ok('priority with no pod and no rule refused', await status(() => setRouting(prisma, scope, { taskType: FREE, podId: null, defaultPriority: 'HIGH' })) === 400);
    ok('nothing created by the refusals', await rule() === null);
    const countBefore = await audits('routing.changed');
    await setRouting(prisma, scope, { taskType: FREE, podId: null }, CTX);
    ok('already unrouted: nothing happens', await rule() === null && await audits('routing.changed') === countBefore);

    const unroutedTask = await newTask({});
    ok('before: a new request is unrouted', unroutedTask.podId === null);
    await setRouting(prisma, scope, { taskType: FREE, podId: podA.id, defaultPriority: 'HIGH' }, CTX);
    ok('saved', (await rule())?.podId === podA.id && (await rule())?.defaultPriority === 'HIGH');
    ok('audited', await audits('routing.changed') === countBefore + 1);
    const routed = await newTask({});
    ok('new request goes to the pod, at the default priority', routed.podId === podA.id && routed.priority === 'HIGH');
    ok('an explicit priority still wins', (await newTask({ priority: 'LOW' })).priority === 'LOW');
    const c = await audits('routing.changed');
    await setRouting(prisma, scope, { taskType: FREE, podId: podA.id, defaultPriority: 'HIGH' }, CTX);
    ok('same again: no entry', await audits('routing.changed') === c);

    await setRouting(prisma, scope, { taskType: FREE, podId: podB.id }, CTX);
    ok('priority is kept when only the pod changes', (await rule())?.defaultPriority === 'HIGH');
    ok('new requests go to the new pod', (await newTask({})).podId === podB.id);
    ok('open requests stay where they were', (await prisma.task.findUniqueOrThrow({ where: { id: routed.id } })).podId === podA.id);

    await setRouting(prisma, scope, { taskType: FREE, podId: null }, CTX);
    ok('unrouting keeps the record, switched off', (await rule())?.isActive === false);
    ok('new requests are unrouted', (await newTask({})).podId === null);
    ok('shown as unrouted', (await row(FREE)).podId === null);
    await ensureDeskDefaults(prisma);
    ok('the seeder does not undo it', (await rule())?.isActive === false);
    await setRouting(prisma, scope, { taskType: FREE, podId: podA.id }, CTX);
    ok('routing it again switches it back on', (await rule())?.isActive === true && (await newTask({})).podId === podA.id);
    await prisma.pod.update({ where: { id: podA.id }, data: { isActive: false } });
    ok('a pod switched off later shows as unrouted', (await row(FREE)).podId === null);
    await prisma.pod.update({ where: { id: podA.id }, data: { isActive: true } });

    console.log('Target rules');
    const t = (extra: object) => saveTarget(prisma, scope, { taskType: FREE, kind: 'BUSINESS_TIME', ...extra }, CTX);
    ok('unknown type refused', await status(() => t({ taskType: 'NOPE', businessDays: 1 })) === 400);
    ok('unknown kind refused', await status(() => t({ kind: 'NOPE', businessDays: 1 })) === 400);
    ok('a duration is required', await status(() => t({})) === 400);
    ok('hours and days together refused', await status(() => t({ businessHours: 1, businessDays: 1 })) === 400);
    ok('zero refused', await status(() => t({ businessDays: 0 })) === 400);
    ok('fractions refused', await status(() => t({ businessHours: 1.5 })) === 400);
    ok('absurdly long refused', await status(() => t({ businessDays: 731 })) === 400);
    ok('expiration target needs a due day', await status(() => t({ kind: 'BEFORE_EXPIRATION' })) === 400);
    ok('opening after due refused', await status(() => t({ kind: 'BEFORE_EXPIRATION', opensDaysBeforeExpiration: 30, dueDaysBeforeExpiration: 45 })) === 400);
    ok('unknown complexity refused', await status(() => t({ complexity: 'NOPE', businessDays: 1 })) === 400);
    ok('unknown priority refused', await status(() => t({ priority: 'NOPE', businessDays: 1 })) === 400);
    ok('unknown agency refused', await status(() => t({ agencyId: '507f1f77bcf86cd799439011', businessDays: 1 })) === 400);
    ok('overlong note refused', await status(() => t({ businessDays: 1, note: 'x'.repeat(301) })) === 400);

    console.log('Desk targets');
    const { id: deskId } = await t({ businessDays: 2, note: ' D5 placeholder ' });
    ok('saved, note trimmed', (await prisma.serviceLevelTarget.findUniqueOrThrow({ where: { id: deskId } })).note === 'D5 placeholder');
    ok('shown on the type', (await row(FREE)).targets.length === 1 && (await row(FREE)).effective.standard?.description === '2 business days');
    ok('same combination twice refused', await status(() => t({ businessDays: 3 })) === 409);
    const firstDue = (await newTask({})).dueAt;
    ok('new request gets a due date', !!firstDue);
    const open = await newTask({});
    const snapshotBefore = JSON.stringify(open.slaTarget);
    await saveTarget(prisma, scope, { id: deskId, kind: 'BUSINESS_TIME', businessHours: 4 }, CTX);
    ok('edited', (await row(FREE)).effective.standard?.description === '4 business hours');
    const reread = await prisma.task.findUniqueOrThrow({ where: { id: open.id } });
    ok('open requests keep the target they started with', JSON.stringify(reread.slaTarget) === snapshotBefore && reread.dueAt?.getTime() === open.dueAt?.getTime());
    ok('new requests get the new one', ((await newTask({})).slaTarget as { businessHours: number }).businessHours === 4);
    const log = await prisma.deskAuditLog.findFirstOrThrow({ where: { action: 'service_level.changed', entityId: deskId }, orderBy: { createdAt: 'desc' } });
    const meta = log.metadata as { from: string; to: string };
    ok('audit reads as before and after', meta.from === '2 business days' && meta.to === '4 business hours' && log.ipAddress === CTX.ip);
    const entries = await prisma.deskAuditLog.count({ where: { action: 'service_level.changed', entityId: deskId } });
    await saveTarget(prisma, scope, { id: deskId, kind: 'BUSINESS_TIME', businessHours: 4, note: 'D5 placeholder' }, CTX);
    ok('same again: no entry', await prisma.deskAuditLog.count({ where: { action: 'service_level.changed', entityId: deskId } }) === entries);
    ok('editing an unknown target: 404', await status(() => saveTarget(prisma, scope, { id: '507f1f77bcf86cd799439011', kind: 'BUSINESS_TIME', businessDays: 1 })) === 404);
    await saveTarget(prisma, scope, { id: deskId, kind: 'BEFORE_EXPIRATION', dueDaysBeforeExpiration: 30, opensDaysBeforeExpiration: 60, businessHours: 4 }, CTX);
    const changedKind = await prisma.serviceLevelTarget.findUniqueOrThrow({ where: { id: deskId } });
    ok('changing the kind clears the old values', changedKind.businessHours === null && changedKind.dueDaysBeforeExpiration === 30);
    await saveTarget(prisma, scope, { id: deskId, kind: 'BUSINESS_TIME', businessDays: 2 }, CTX);

    const { id: urgentId } = await t({ priority: 'URGENT', businessHours: 1 });
    ok('a priority target applies only to that priority', ((await newTask({ priority: 'URGENT' })).slaTarget as { targetId: string }).targetId === urgentId
      && ((await newTask({ priority: 'NORMAL' })).slaTarget as { targetId: string }).targetId === deskId);
    const { id: complexId } = await t({ complexity: 'COMPLEX', businessDays: 5 });
    const shown = await row(FREE);
    ok('standard and complex can differ', shown.effective.standard?.description === '2 business days' && shown.effective.complex?.description === '5 business days');
    ok('a complex request gets the complex target', ((await newTask({ complexity: 'COMPLEX' })).slaTarget as { targetId: string }).targetId === complexId);

    console.log('Agency agreements');
    const { id: agreementId } = await t({ agencyId: A.id, businessHours: 8 });
    ok('shown in the agency view', (await row(FREE, A.id)).targets.map((x) => x.id).join() === agreementId);
    ok('not listed with the Desk targets', !(await row(FREE)).targets.some((x) => x.id === agreementId));
    ok('agency view says it comes from the agreement', (await row(FREE, A.id)).effective.standard?.fromAgreement === true);
    ok('agency without one uses the Desk default', (await row(FREE, B.id)).effective.standard?.fromAgreement === false);
    ok('it beats the Desk default for that agency', ((await newTask({})).slaTarget as { targetId: string }).targetId === agreementId);
    const bTask = await newTask({ insuredId: insuredB.id });
    ok('another agency is unaffected', (bTask.slaTarget as { targetId: string }).targetId === deskId);
    ok('audited against the agency', await prisma.deskAuditLog.count({ where: { action: 'service_level.changed', entityId: agreementId, agencyId: A.id } }) === 1);
    ok('same combination for another agency is fine', await status(() => t({ agencyId: B.id, businessHours: 9 })) === 200);
    ok('same combination for the same agency refused', await status(() => t({ agencyId: A.id, businessHours: 9 })) === 409);

    console.log('Removing');
    await removeTarget(prisma, scope, agreementId, CTX);
    ok('switched off, not deleted', (await prisma.serviceLevelTarget.findUniqueOrThrow({ where: { id: agreementId } })).isActive === false);
    ok('no longer shown', (await row(FREE, A.id)).targets.every((x) => x.id !== agreementId));
    ok('new requests fall back to the Desk default', ((await newTask({})).slaTarget as { targetId: string }).targetId === deskId);
    ok('removing twice: 404', await status(() => removeTarget(prisma, scope, agreementId)) === 404);
    ok('editing a removed target: 404', await status(() => saveTarget(prisma, scope, { id: agreementId, kind: 'BUSINESS_TIME', businessDays: 1 })) === 404);
    ok('malformed id: 404', await status(() => removeTarget(prisma, scope, 'nope')) === 404);
    const again = await t({ agencyId: A.id, businessHours: 6 });
    ok('adding it again reuses the record, with the new values', again.id === agreementId && (await prisma.serviceLevelTarget.findUniqueOrThrow({ where: { id: agreementId } })).businessHours === 6);
    await removeTarget(prisma, scope, deskId, CTX);
    await removeTarget(prisma, scope, urgentId, CTX);
    await removeTarget(prisma, scope, complexId, CTX);
    await ensureDeskDefaults(prisma);
    ok('the seeder does not bring back a removed target', !(await prisma.serviceLevelTarget.findUniqueOrThrow({ where: { id: deskId } })).isActive);

    console.log('Entering a missing client target (D5)');
    ok('Proposal preparation starts with none', (await row(FREE_TARGET)).effective.standard === null);
    await saveTarget(prisma, scope, { taskType: FREE_TARGET, kind: 'BUSINESS_TIME', businessDays: 3 }, CTX);
    ok('and can be given one', (await row(FREE_TARGET)).effective.standard?.description === '3 business days');
  } catch (e) {
    fail++;
    console.error(e);
  } finally {
    await wipe();
    ok('seeded routing and targets are exactly as they were', await seededSnapshot() === before);
    const left = await prisma.user.count({ where: { email: { startsWith: TAG } } }) + await prisma.agency.count({ where: { id: { in: cleanup.agencyIds } } })
      + await prisma.pod.count({ where: { id: { in: cleanup.podIds } } }) + await prisma.taskRoutingRule.count({ where: { taskType: FREE } })
      + await prisma.serviceLevelTarget.count({ where: { taskType: { in: [FREE, FREE_TARGET] } } });
    ok('temporary records removed', left === 0);
    console.log(`\n${pass} passed, ${fail} failed`);
    await prisma.$disconnect();
    process.exit(fail ? 1 : 0);
  }
})();
