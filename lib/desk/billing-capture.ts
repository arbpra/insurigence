/**
 * Billing capture at completion (client answer Q6). Invoicing is a later
 * phase; this records, for every completed task, whether it was included in
 * the agency's monthly allowance, an overage, or non-billable, and the month
 * it counted toward.
 *
 * Allowance use is counted with an atomic counter per agency, month and
 * category (DeskCounter, same mechanism as task references), so two tasks
 * completed at the same moment can never both take the last included unit.
 *
 * Until an agency has a plan with an allowance for the category (decision
 * D1), completed work is left unclassified — never guessed — and
 * classifyPendingBilling() sorts it once allowances are set.
 */
import type { BillingClass, BillingStatus, PrismaClient, ServiceCategory, Task } from '@prisma/client';
import { recordAudit } from './audit';
import { billingPeriodOf, resolveAllowance } from './billing';
import { BILLING_UNCLASSIFIED } from './task-filters';

type Db = PrismaClient;

export type BillingReason =
  | 'NON_BILLABLE'      // internal or follow-up work
  | 'UNLIMITED'         // the plan has no cap for this category
  | 'WITHIN_ALLOWANCE'
  | 'OVER_ALLOWANCE'
  | 'NO_PLAN'           // the agency has no Desk plan yet
  | 'NOT_CONFIGURED';   // the plan has no allowance for this category yet (D1)

export interface BillingDecision {
  billingClass: BillingClass | null;
  billingStatus: BillingStatus | null;
  billingPeriod: string;
  reason: BillingReason;
  /** Units taken from the month's allowance counter (to give back on undo). */
  consumed: number;
}

type BillableTask = Pick<Task, 'agencyId' | 'serviceCategory' | 'billableUnits' | 'nonBillable'>;

const counterKey = (agencyId: string, period: string, category: ServiceCategory) => `allowance:${agencyId}:${period}:${category}`;

function counterValue(result: unknown): number | null {
  const doc = (result as { value?: { value?: unknown } | null }).value;
  if (!doc) return null;
  const raw = doc.value;
  return Number(typeof raw === 'object' && raw !== null ? Object.values(raw)[0] : raw);
}

/** Takes `units` from the counter only if that keeps it within `limit`. Atomic. */
async function tryConsume(db: Db, key: string, units: number, limit: number): Promise<boolean> {
  if (units > limit) return false;
  // Make sure the counter exists (a no-op if it does)…
  await db.$runCommandRaw({ findAndModify: 'DeskCounter', query: { _id: key }, update: { $setOnInsert: { value: 0 } }, upsert: true, new: true });
  // …then increment only while there is room; no match means the allowance is used up.
  const result = await db.$runCommandRaw({
    findAndModify: 'DeskCounter', query: { _id: key, value: { $lte: limit - units } }, update: { $inc: { value: units } }, new: true,
  });
  return counterValue(result) !== null;
}

/** Returns units to the month's allowance (a reopened or failed completion). */
export async function giveBack(db: Db, agencyId: string, period: string, category: ServiceCategory, units: number): Promise<void> {
  if (units <= 0) return;
  await db.$runCommandRaw({ findAndModify: 'DeskCounter', query: { _id: counterKey(agencyId, period, category) }, update: { $inc: { value: -units } }, new: true });
}

/** Included units already used this month (for usage views and tests). */
export async function allowanceUsed(db: Db, agencyId: string, period: string, category: ServiceCategory): Promise<number> {
  const row = await db.deskCounter.findUnique({ where: { id: counterKey(agencyId, period, category) } });
  return row?.value ?? 0;
}

/**
 * Classifies one task's work for a billing month. Takes allowance units when
 * the work is included, so callers must give them back (giveBack) if the
 * completion is then not saved.
 */
export async function decideBilling(db: Db, task: BillableTask, period: string): Promise<BillingDecision> {
  const base = { billingPeriod: period, consumed: 0 };
  if (task.nonBillable) return { ...base, billingClass: 'NON_BILLABLE', billingStatus: 'NOT_APPLICABLE', reason: 'NON_BILLABLE' };
  const category = task.serviceCategory ?? 'SERVICE';

  const agencyPlan = await db.agencyDeskPlan.findUnique({
    where: { agencyId: task.agencyId },
    select: { plan: { select: { allowances: { select: { category: true, monthlyUnits: true } } } }, allowanceOverrides: { select: { category: true, monthlyUnits: true } } },
  });
  if (!agencyPlan) return { ...base, billingClass: null, billingStatus: null, reason: 'NO_PLAN' };

  const allowance = resolveAllowance(category, agencyPlan.plan.allowances, agencyPlan.allowanceOverrides);
  if (!allowance.configured) return { ...base, billingClass: null, billingStatus: null, reason: 'NOT_CONFIGURED' };
  if (allowance.unlimited) return { ...base, billingClass: 'INCLUDED', billingStatus: 'NOT_APPLICABLE', reason: 'UNLIMITED' };

  const units = Math.max(0, task.billableUnits);
  // A task is included only if all of its units fit; it is never split.
  if (await tryConsume(db, counterKey(task.agencyId, period, category), units, allowance.units)) {
    return { ...base, consumed: units, billingClass: 'INCLUDED', billingStatus: 'NOT_APPLICABLE', reason: 'WITHIN_ALLOWANCE' };
  }
  return { ...base, billingClass: 'OVERAGE', billingStatus: 'UNBILLED', reason: 'OVER_ALLOWANCE' };
}

/** The billing month a completion counts toward, in the Desk time zone. */
export function completionPeriod(completedAt: Date, timeZone: string): string {
  return billingPeriodOf(completedAt, timeZone);
}

/**
 * Classifies completed work that was left unclassified (no plan or no
 * allowance at the time), oldest completion first, in the month it was
 * completed. Run after allowances are configured (D1). Returns how many
 * tasks were classified; those still without an allowance stay pending.
 */
export async function classifyPendingBilling(db: Db, opts: { agencyId?: string } = {}): Promise<{ classified: number; stillPending: number }> {
  const pending = await db.task.findMany({
    where: {
      AND: [
        BILLING_UNCLASSIFIED,
        { status: 'COMPLETED', nonBillable: false, billingPeriod: { not: null } },
        opts.agencyId ? { agencyId: opts.agencyId } : {},
      ],
    },
    orderBy: { completedAt: 'asc' },
  });
  let classified = 0;
  for (const task of pending) {
    const decision = await decideBilling(db, task, task.billingPeriod!);
    if (!decision.billingClass) continue;
    // Only if still unclassified, so a concurrent run cannot classify it twice.
    const { count } = await db.task.updateMany({
      where: { AND: [{ id: task.id }, BILLING_UNCLASSIFIED] },
      data: { billingClass: decision.billingClass, billingStatus: decision.billingStatus },
    });
    if (count !== 1) {
      await giveBack(db, task.agencyId, task.billingPeriod!, task.serviceCategory ?? 'SERVICE', decision.consumed);
      continue;
    }
    classified++;
    await recordAudit(db, {
      actor: null, action: 'task.billing_classified', entityType: 'Task', entityId: task.id, agencyId: task.agencyId,
      metadata: { reference: task.reference, period: task.billingPeriod, class: decision.billingClass, reason: decision.reason, late: true },
    });
  }
  return { classified, stillPending: pending.length - classified };
}
