import type { PrismaClient, TaskComplexity, TaskPriority, TaskStatus, TaskType } from '@prisma/client';
import { ensureDefaultPods, type DefaultPodCode } from './pods';

/**
 * Starting routing: which pod each request type goes to. Turnaround is not
 * here — it lives in DEFAULT_SERVICE_LEVELS. OTHER has no rule on purpose: it
 * stays unrouted for the AM to triage. Admins edit routing in Module 18.
 */
export const DEFAULT_ROUTING: ReadonlyArray<{
  taskType: TaskType;
  pod: DefaultPodCode;
  defaultPriority?: TaskPriority;
}> = [
  { taskType: 'COI', pod: 'SERVICE_AMS' },
  { taskType: 'ENDORSEMENT', pod: 'SERVICE_AMS' },
  { taskType: 'ACORD', pod: 'SERVICE_AMS' },
  { taskType: 'AMS_ENTRY', pod: 'SERVICE_AMS' },
  { taskType: 'POLICY_UPDATE', pod: 'SERVICE_AMS' },
  { taskType: 'DOCUMENT_UPLOAD', pod: 'SERVICE_AMS' },
  { taskType: 'RENEWAL', pod: 'RENEWALS' },
  { taskType: 'REMARKETING', pod: 'RENEWALS' },
  { taskType: 'LOSS_RUNS', pod: 'RENEWALS' },
  { taskType: 'NEW_BUSINESS', pod: 'NEW_BUSINESS' },
  { taskType: 'SUBMISSION', pod: 'NEW_BUSINESS' },
  { taskType: 'PROPOSAL_PREP', pod: 'NEW_BUSINESS' },
  { taskType: 'QA_REVIEW', pod: 'QA' },
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

type DefaultTarget = {
  taskType: TaskType;
  complexity: TaskComplexity | null;
  note: string;
} & (
  | { kind: 'BUSINESS_TIME'; businessHours?: number; businessDays?: number }
  | { kind: 'BEFORE_EXPIRATION'; opensDaysBeforeExpiration: number; dueDaysBeforeExpiration: number }
);

/**
 * The client's initial internal targets (27 Oct 2026) — internal goals, not
 * customer guarantees. Types the client gave no target for (ACORD, Loss Runs,
 * Proposal Prep, QA Review, Other) get none: those tasks carry no target date
 * until an admin sets one (Module 18).
 */
export const DEFAULT_SERVICE_LEVELS: ReadonlyArray<DefaultTarget> = [
  { taskType: 'COI', complexity: 'STANDARD', kind: 'BUSINESS_TIME', businessHours: 4, note: 'Standard COI' },
  { taskType: 'COI', complexity: 'COMPLEX', kind: 'BUSINESS_TIME', businessDays: 1, note: 'Complex COI' },
  { taskType: 'ENDORSEMENT', complexity: 'STANDARD', kind: 'BUSINESS_TIME', businessDays: 2, note: 'Standard endorsement' },
  { taskType: 'ENDORSEMENT', complexity: 'COMPLEX', kind: 'BUSINESS_TIME', businessDays: 3, note: 'Complex endorsement; time waiting on the carrier is paused' },
  { taskType: 'AMS_ENTRY', complexity: null, kind: 'BUSINESS_TIME', businessDays: 1, note: 'AMS data entry / update' },
  { taskType: 'POLICY_UPDATE', complexity: null, kind: 'BUSINESS_TIME', businessDays: 1, note: 'AMS data entry / update' },
  { taskType: 'SUBMISSION', complexity: null, kind: 'BUSINESS_TIME', businessDays: 2, note: 'New-business submission prep; clock paused while waiting on complete information' },
  { taskType: 'NEW_BUSINESS', complexity: null, kind: 'BUSINESS_TIME', businessDays: 2, note: 'New-business submission prep; clock paused while waiting on complete information' },
  { taskType: 'DOCUMENT_UPLOAD', complexity: null, kind: 'BUSINESS_TIME', businessDays: 1, note: 'Routine document request' },
  { taskType: 'RENEWAL', complexity: null, kind: 'BEFORE_EXPIRATION', opensDaysBeforeExpiration: 120, dueDaysBeforeExpiration: 90, note: 'Renewal outreach begins 90–120 days before expiration' },
  { taskType: 'REMARKETING', complexity: null, kind: 'BEFORE_EXPIRATION', opensDaysBeforeExpiration: 60, dueDaysBeforeExpiration: 45, note: 'Remarketing preparation 45–60 days before expiration' },
];

/** Placeholder calendar until the client confirms hours and zone (plan detail D2). */
export const DEFAULT_CALENDAR = {
  id: 'default',
  timeZone: 'America/New_York',
  workDays: [1, 2, 3, 4, 5],
  dayStartMinute: 9 * 60,
  dayEndMinute: 17 * 60,
};

/**
 * Placeholder holidays (plan detail D2): US federal holidays on their observed
 * dates — a Saturday holiday is observed the Friday before, a Sunday one the
 * Monday after.
 */
export const DEFAULT_HOLIDAYS: ReadonlyArray<{ date: string; name: string }> = [
  { date: '2026-01-01', name: "New Year's Day" },
  { date: '2026-01-19', name: 'Martin Luther King Jr. Day' },
  { date: '2026-02-16', name: "Presidents' Day" },
  { date: '2026-05-25', name: 'Memorial Day' },
  { date: '2026-06-19', name: 'Juneteenth' },
  { date: '2026-07-03', name: 'Independence Day (observed)' },
  { date: '2026-09-07', name: 'Labor Day' },
  { date: '2026-10-12', name: 'Columbus Day' },
  { date: '2026-11-11', name: 'Veterans Day' },
  { date: '2026-11-26', name: 'Thanksgiving Day' },
  { date: '2026-12-25', name: 'Christmas Day' },
  { date: '2027-01-01', name: "New Year's Day" },
  { date: '2027-01-18', name: 'Martin Luther King Jr. Day' },
  { date: '2027-02-15', name: "Presidents' Day" },
  { date: '2027-05-31', name: 'Memorial Day' },
  { date: '2027-06-18', name: 'Juneteenth (observed)' },
  { date: '2027-07-05', name: 'Independence Day (observed)' },
  { date: '2027-09-06', name: 'Labor Day' },
  { date: '2027-10-11', name: 'Columbus Day' },
  { date: '2027-11-11', name: 'Veterans Day' },
  { date: '2027-11-25', name: 'Thanksgiving Day' },
  { date: '2027-12-24', name: 'Christmas Day (observed)' },
  { date: '2027-12-31', name: "New Year's Day 2028 (observed)" },
];

/**
 * Creates any missing default pod, routing rule, follow-up rule, plan,
 * service-level target, calendar or holiday. Create-only: an existing record
 * is never changed, so admin edits survive re-seeding.
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
      data: { taskType: r.taskType, podId, defaultPriority: r.defaultPriority ?? 'NORMAL' },
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

  // Compared in memory: Prisma reads an unset optional field as null, so this
  // matches existing defaults whether their nulls were written or omitted.
  const existingTargets = await prisma.serviceLevelTarget.findMany({
    select: { taskType: true, complexity: true, priority: true, agencyId: true },
  });
  const serviceLevels: string[] = [];
  for (const t of DEFAULT_SERVICE_LEVELS) {
    const exists = existingTargets.some((e) =>
      e.taskType === t.taskType && e.complexity === t.complexity && e.priority === null && e.agencyId === null);
    if (exists) continue;
    // Nulls written explicitly so every default row is stored the same way.
    await prisma.serviceLevelTarget.create({
      data: {
        taskType: t.taskType, complexity: t.complexity, priority: null, agencyId: null, kind: t.kind, note: t.note,
        ...(t.kind === 'BUSINESS_TIME'
          ? { businessHours: t.businessHours ?? null, businessDays: t.businessDays ?? null }
          : { opensDaysBeforeExpiration: t.opensDaysBeforeExpiration, dueDaysBeforeExpiration: t.dueDaysBeforeExpiration }),
      },
    });
    serviceLevels.push(t.complexity ? `${t.taskType}/${t.complexity}` : t.taskType);
  }

  let calendar = false;
  if (!(await prisma.deskCalendar.findUnique({ where: { id: DEFAULT_CALENDAR.id } }))) {
    await prisma.deskCalendar.create({ data: DEFAULT_CALENDAR });
    calendar = true;
  }

  const existingHolidays = new Set((await prisma.deskHoliday.findMany({ select: { date: true } })).map((h) => h.date));
  const holidays = DEFAULT_HOLIDAYS.filter((h) => !existingHolidays.has(h.date));
  if (holidays.length) await prisma.deskHoliday.createMany({ data: [...holidays] });

  return { pods, routing, followUps, plans, serviceLevels, calendar, holidays: holidays.length };
}
