import type { PrismaClient, TaskPriority, TaskStatus, TaskType } from '@prisma/client';
import { ensureDefaultPods, type DefaultPodCode } from './pods';

/**
 * Starting routing: which pod each request type goes to, and its default
 * turnaround. Turnaround values are placeholders until the client confirms
 * targets (open question Q5); admins edit them in Module 11.
 * OTHER has no rule on purpose: it stays unrouted for the AM to triage.
 */
export const DEFAULT_ROUTING: ReadonlyArray<{
  taskType: TaskType;
  pod: DefaultPodCode;
  turnaroundHours: number;
  defaultPriority?: TaskPriority;
}> = [
  { taskType: 'COI', pod: 'SERVICE_AMS', turnaroundHours: 24 },
  { taskType: 'ENDORSEMENT', pod: 'SERVICE_AMS', turnaroundHours: 48 },
  { taskType: 'ACORD', pod: 'SERVICE_AMS', turnaroundHours: 48 },
  { taskType: 'AMS_ENTRY', pod: 'SERVICE_AMS', turnaroundHours: 48 },
  { taskType: 'POLICY_UPDATE', pod: 'SERVICE_AMS', turnaroundHours: 48 },
  { taskType: 'DOCUMENT_UPLOAD', pod: 'SERVICE_AMS', turnaroundHours: 48 },
  { taskType: 'RENEWAL', pod: 'RENEWALS', turnaroundHours: 120 },
  { taskType: 'REMARKETING', pod: 'RENEWALS', turnaroundHours: 120 },
  { taskType: 'LOSS_RUNS', pod: 'RENEWALS', turnaroundHours: 72 },
  { taskType: 'NEW_BUSINESS', pod: 'NEW_BUSINESS', turnaroundHours: 120 },
  { taskType: 'SUBMISSION', pod: 'NEW_BUSINESS', turnaroundHours: 72 },
  { taskType: 'PROPOSAL_PREP', pod: 'NEW_BUSINESS', turnaroundHours: 72 },
  { taskType: 'QA_REVIEW', pod: 'QA', turnaroundHours: 24 },
];

/** Starting follow-ups. The first is the client's own example. */
export const DEFAULT_FOLLOW_UPS: ReadonlyArray<{
  triggerType: TaskType;
  triggerStatus: TaskStatus;
  createType: TaskType;
  titleTemplate: string;
}> = [
  { triggerType: 'RENEWAL', triggerStatus: 'COMPLETED', createType: 'AMS_ENTRY', titleTemplate: 'Update AMS for completed renewal #{reference}' },
  { triggerType: 'NEW_BUSINESS', triggerStatus: 'COMPLETED', createType: 'AMS_ENTRY', titleTemplate: 'Enter new business from #{reference} into AMS' },
];

/**
 * The client's tiers (27 Oct 2026). Allowances are deliberately not seeded:
 * the per-tier numbers are still to come from the client (plan detail D1), and
 * a guessed allowance would misclassify real work as included or overage.
 */
export const DEFAULT_PLANS = [
  { code: 'CORE', name: 'Desk Core', monthlyPriceCents: BigInt(150_000), priceIsStartingAt: false, sortOrder: 1 },
  { code: 'GROWTH', name: 'Desk Growth', monthlyPriceCents: BigInt(250_000), priceIsStartingAt: false, sortOrder: 2 },
  { code: 'COMPLETE', name: 'Desk Complete', monthlyPriceCents: BigInt(400_000), priceIsStartingAt: true, sortOrder: 3 },
] as const;

/**
 * Creates any missing default pod, routing rule, follow-up rule or plan.
 * Create-only: an existing record is never changed, so admin edits survive
 * re-seeding.
 */
export async function ensureDeskDefaults(prisma: PrismaClient) {
  const { created: pods } = await ensureDefaultPods(prisma);
  const podIds = new Map(
    (await prisma.pod.findMany({ select: { id: true, code: true } })).map((p) => [p.code, p.id])
  );

  const routing: string[] = [];
  for (const r of DEFAULT_ROUTING) {
    if (await prisma.taskRoutingRule.findUnique({ where: { taskType: r.taskType }, select: { id: true } })) continue;
    const podId = podIds.get(r.pod);
    if (!podId) throw new Error(`Pod ${r.pod} missing`);
    await prisma.taskRoutingRule.create({
      data: { taskType: r.taskType, podId, turnaroundHours: r.turnaroundHours, defaultPriority: r.defaultPriority ?? 'NORMAL' },
    });
    routing.push(r.taskType);
  }

  const followUps: string[] = [];
  for (const f of DEFAULT_FOLLOW_UPS) {
    const key = { triggerType: f.triggerType, triggerStatus: f.triggerStatus, createType: f.createType };
    if (await prisma.taskFollowUpRule.findUnique({ where: { triggerType_triggerStatus_createType: key }, select: { id: true } })) continue;
    await prisma.taskFollowUpRule.create({ data: { ...key, titleTemplate: f.titleTemplate } });
    followUps.push(`${f.triggerType}→${f.createType}`);
  }

  const plans: string[] = [];
  for (const plan of DEFAULT_PLANS) {
    if (await prisma.deskPlan.findUnique({ where: { code: plan.code }, select: { id: true } })) continue;
    await prisma.deskPlan.create({ data: { ...plan } });
    plans.push(plan.code);
  }

  return { pods, routing, followUps, plans };
}
