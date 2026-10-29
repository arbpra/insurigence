/**
 * The Desk, Module 4: task models (Task, TaskEvent, TaskDocument, routing and
 * follow-up rules, reference counter).
 *
 * Verifies the seeded rules, atomic reference numbers under concurrency,
 * task defaults, subtasks, the agency-visible timeline, queue filters for
 * unset fields, and delete protection. Uses temporary records only.
 * Run with:  npx tsx script/verify-desk-tasks.ts
 */
import 'dotenv/config';
import { prisma } from '../lib/prisma';
import { nextSequence } from '../lib/desk/sequence';
import { DEFAULT_ROUTING, DEFAULT_FOLLOW_UPS } from '../lib/desk/defaults';
import { UNROUTED, UNASSIGNED, TOP_LEVEL } from '../lib/desk/task-filters';

let pass = 0, fail = 0;
const ok = (n: string, c: boolean) => { c ? pass++ : fail++; console.log(`  ${c ? '✓' : '✗'} ${n}`); };
const rejects = async (fn: () => Promise<unknown>) => { try { await fn(); return false; } catch { return true; } };

const TAG = `m4test-${Date.now()}`;
const counterName = `${TAG}-counter`;
let agencyId = '';
// Test references live far above any real task number, so they cannot collide.
let ref = 900_000_000 + Math.floor(Math.random() * 1_000_000);
const nextRef = () => ++ref;

async function wipe() {
  if (agencyId) {
    const tasks = await prisma.task.findMany({ where: { agencyId }, select: { id: true } });
    const ids = tasks.map((t) => t.id);
    await prisma.taskEvent.deleteMany({ where: { taskId: { in: ids } } });
    await prisma.taskDocument.deleteMany({ where: { taskId: { in: ids } } });
    await prisma.task.updateMany({ where: { id: { in: ids } }, data: { parentTaskId: null } });
    await prisma.task.deleteMany({ where: { id: { in: ids } } });
    await prisma.policy.deleteMany({ where: { agencyId } });
    await prisma.insuredAccount.deleteMany({ where: { agencyId } });
    await prisma.agency.deleteMany({ where: { id: agencyId } });
  }
  await prisma.$runCommandRaw({ delete: 'DeskCounter', deletes: [{ q: { _id: counterName }, limit: 1 }] });
}

(async () => {
  console.log('\n━━ Seeded rules ━━');
  const pods = new Map((await prisma.pod.findMany()).map((p) => [p.id, p.code]));
  const rules = await prisma.taskRoutingRule.findMany();
  ok('every default routing rule exists, active, pointing at the right pod',
    DEFAULT_ROUTING.every((d) => rules.some((r) =>
      r.taskType === d.taskType && r.isActive && pods.get(r.podId) === d.pod)));
  ok('OTHER has no rule (stays unrouted for AM triage)', !rules.some((r) => r.taskType === 'OTHER'));
  ok('one rule per type', await rejects(() => prisma.taskRoutingRule.create({ data: { taskType: 'COI', podId: rules[0].podId } })));
  const fus = await prisma.taskFollowUpRule.findMany();
  ok('default follow-ups exist (Renewal → AMS entry, New business → AMS entry)',
    DEFAULT_FOLLOW_UPS.every((d) => fus.some((f) => f.triggerType === d.triggerType && f.createType === d.createType && f.isActive)));
  ok('duplicate follow-up rejected', await rejects(() => prisma.taskFollowUpRule.create({
    data: { triggerType: 'RENEWAL', triggerStatus: 'COMPLETED', createType: 'AMS_ENTRY', titleTemplate: 'x' } })));

  console.log('\n━━ Reference counter ━━');
  ok('first value is 1', (await nextSequence(prisma, counterName)) === 1);
  {
    const values = await Promise.all(Array.from({ length: 25 }, () => nextSequence(prisma, counterName)));
    const sorted = [...values].sort((a, b) => a - b);
    ok('25 simultaneous calls get 25 distinct, consecutive numbers (2–26)',
      new Set(values).size === 25 && sorted[0] === 2 && sorted[24] === 26);
  }

  console.log('\n━━ Task ━━');
  const agency = await prisma.agency.create({ data: { name: `${TAG} agency` } });
  agencyId = agency.id;
  const insured = await prisma.insuredAccount.create({ data: { agencyId, name: 'Task Test Co', nameKey: 'task test' } });
  const policy = await prisma.policy.create({ data: { agencyId, insuredId: insured.id, policyNumber: 'P-1' } });
  const coiRule = rules.find((r) => r.taskType === 'COI')!;

  const parent = await prisma.task.create({ data: {
    reference: nextRef(), agencyId, insuredId: insured.id, policyId: policy.id,
    type: 'RENEWAL', title: 'Renewal for Task Test Co',
  } });
  ok('defaults: NEW, NORMAL, source AGENCY, not escalated, activity time set',
    parent.status === 'NEW' && parent.priority === 'NORMAL' && parent.source === 'AGENCY' &&
    parent.escalated === false && parent.lastActivityAt instanceof Date);
  ok('reference number is unique',
    await rejects(() => prisma.task.create({ data: { reference: parent.reference, agencyId, type: 'COI', title: 'dup' } })));

  const child = await prisma.task.create({ data: {
    reference: nextRef(), agencyId, insuredId: insured.id, parentTaskId: parent.id,
    type: 'AMS_ENTRY', title: 'Update AMS', podId: coiRule.podId, source: 'SYSTEM',
  } });
  {
    const withKids = await prisma.task.findUniqueOrThrow({ where: { id: parent.id }, include: { subtasks: true } });
    const withParent = await prisma.task.findUniqueOrThrow({ where: { id: child.id }, include: { parent: true } });
    ok('subtask linked both ways', withKids.subtasks.length === 1 && withParent.parent?.id === parent.id);
  }

  console.log('\n━━ Queue filters (unset fields) ━━');
  ok('bare `podId: null` MISSES a task created without a pod (the trap)',
    (await prisma.task.count({ where: { agencyId, podId: null } })) === 0);
  ok('UNROUTED finds it', (await prisma.task.count({ where: { agencyId, ...UNROUTED } })) === 1);
  ok('UNASSIGNED finds both unassigned tasks', (await prisma.task.count({ where: { agencyId, ...UNASSIGNED } })) === 2);
  ok('TOP_LEVEL excludes the subtask', (await prisma.task.count({ where: { agencyId, ...TOP_LEVEL } })) === 1);
  ok('filters combine through AND (routed AND unassigned → the subtask only)',
    (await prisma.task.count({ where: { agencyId, podId: coiRule.podId, AND: [UNASSIGNED] } })) === 1);

  console.log('\n━━ TaskEvent / TaskDocument ━━');
  await prisma.taskEvent.create({ data: { taskId: parent.id, agencyId, kind: 'CREATED', visibility: 'AGENCY', toStatus: 'NEW' } });
  const internalNote = await prisma.taskEvent.create({ data: { taskId: parent.id, agencyId, kind: 'NOTE', body: 'Carrier is slow, chase Friday' } });
  ok('events default to INTERNAL', internalNote.visibility === 'INTERNAL');
  ok('agency timeline (AGENCY only) excludes the internal note',
    (await prisma.taskEvent.findMany({ where: { taskId: parent.id, visibility: 'AGENCY' } })).every((e) => e.kind !== 'NOTE'));
  const doc = await prisma.taskDocument.create({ data: {
    taskId: parent.id, agencyId, storageKey: `agencies/${agencyId}/tasks/x/a.pdf`, fileName: 'a.pdf', fileSize: 10, contentType: 'application/pdf' } });
  ok('documents default to INTERNAL', doc.visibility === 'INTERNAL');
  await prisma.taskDocument.update({ where: { id: doc.id }, data: { deletedAt: new Date() } });
  ok('soft-deleted document kept for history but excluded from the live list',
    (await prisma.taskDocument.count({ where: { taskId: parent.id } })) === 1 &&
    (await prisma.taskDocument.count({ where: { taskId: parent.id, deletedAt: { isSet: false } } })) === 0);

  console.log('\n━━ Delete protection ━━');
  ok('an insured with tasks cannot be deleted', await rejects(() => prisma.insuredAccount.delete({ where: { id: insured.id } })));
  ok('a policy with tasks cannot be deleted', await rejects(() => prisma.policy.delete({ where: { id: policy.id } })));
  ok('…and both are still there',
    (await prisma.insuredAccount.count({ where: { id: insured.id } })) === 1 && (await prisma.policy.count({ where: { id: policy.id } })) === 1);
  ok('a task with subtasks cannot be deleted', await rejects(() => prisma.task.delete({ where: { id: parent.id } })));
  await prisma.task.delete({ where: { id: child.id } });
  await prisma.task.delete({ where: { id: parent.id } });
  ok('deleting a task removes its events and documents',
    (await prisma.taskEvent.count({ where: { taskId: parent.id } })) === 0 && (await prisma.taskDocument.count({ where: { taskId: parent.id } })) === 0);
  await prisma.insuredAccount.delete({ where: { id: insured.id } });
  ok('once its tasks are gone the insured can be deleted (policy cascades)',
    (await prisma.policy.count({ where: { id: policy.id } })) === 0);

  await wipe();
  const counterLeft: any = await prisma.$runCommandRaw({ count: 'DeskCounter', query: { _id: counterName } });
  ok('cleaned up', (await prisma.agency.count({ where: { name: { startsWith: TAG } } })) === 0 && counterLeft.n === 0);

  console.log(`\n━━ ${pass} passed, ${fail} failed ━━\n`);
  await prisma.$disconnect();
  process.exit(fail ? 1 : 0);
})().catch(async (e) => {
  console.error('ERROR', e);
  await wipe().catch(() => {});
  await prisma.$disconnect();
  process.exit(1);
});
