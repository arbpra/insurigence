/**
 * Service usage (Module 43, client answer Q6): each agency's month against its
 * plan's allowances, from the billing decision recorded on each completed
 * task (Module 13): included, overage or non-billable, in the month it was
 * completed in the Desk time zone. Work completed before the agency had an
 * allowance for its category is shown as not yet classified, never guessed.
 *
 * Operations Managers and the Super Admin only (the routes refuse everyone
 * else first, and log it). Invoicing is a later phase: this shows what would
 * be billed, it bills nothing.
 */
import type { BillingClass, Prisma, PrismaClient, ServiceCategory } from '@prisma/client';
import { can, DeskAccessError, isObjectId, taskWhere, type DeskScope, type GuardContext } from './access';
import { recordAudit } from './audit';
import { SERVICE_CATEGORY_LABELS, billingPeriodOf, resolveAllowance, resolveManagedAccounts } from './billing';
import { loadBusinessCalendar } from './business-time';
import { TASK_TYPE_LABELS } from './service-levels';
import { BILLING_UNCLASSIFIED } from './task-filters';

type Db = PrismaClient;

export const SERVICE_CATEGORIES = Object.keys(SERVICE_CATEGORY_LABELS) as ServiceCategory[];
/** Months offered: this one and the eleven before it. */
export const USAGE_MONTHS = 12;
/** The most tasks listed for one agency's month. */
export const USAGE_TASKS_MAX = 1000;

/** All-agency positions allowing `usage.view` (Module 48); prices only with `billing.prices`. */
function opsOnly(scope: DeskScope) {
  if (scope.kind !== 'PLATFORM' || !can(scope, 'usage.view')) throw new DeskAccessError(403, 'Your position does not include service usage.');
}

const PERIOD = /^(\d{4})-(0[1-9]|1[0-2])$/;

/** "YYYY-MM", or this month in the Desk time zone when none is given. Anything else is refused. */
export function usagePeriod(value: string | null | undefined, now: Date, timeZone: string): string {
  if (!value) return billingPeriodOf(now, timeZone);
  if (!PERIOD.test(value)) throw new DeskAccessError(400, 'Choose a month as YYYY-MM.');
  return value;
}

/** This month and the ones before it, newest first. Pure. */
export function recentPeriods(current: string, count = USAGE_MONTHS): string[] {
  const [y, m] = current.split('-').map(Number);
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  });
}

export interface CategoryUsage {
  category: ServiceCategory;
  label: string;
  /** The monthly allowance: a number, 'unlimited', or null when not set up yet. */
  allowance: number | 'unlimited' | null;
  included: number;
  overage: number;
  /** Of the overage, units not yet invoiced or waived. */
  overageUnbilled: number;
  nonBillable: number;
  /** Completed, billable, but not yet classified (no plan or allowance at the time). */
  pending: number;
  /** Units of the allowance left this month; null when unlimited or not set up. */
  remaining: number | null;
}

type Totals = { units: number; unbilled: number };
const key = (agencyId: string, category: ServiceCategory | null) => `${agencyId}:${category ?? 'SERVICE'}`;

/** One agency's categories for the month, from the tallies. Pure. */
export function categoryUsage(
  agencyId: string,
  plan: { allowances: { category: ServiceCategory; monthlyUnits: number | null }[]; overrides: { category: ServiceCategory; monthlyUnits: number | null }[] } | null,
  tally: Map<string, Partial<Record<BillingClass | 'PENDING', Totals>>>
): CategoryUsage[] {
  return SERVICE_CATEGORIES.map((category) => {
    const t = tally.get(key(agencyId, category)) ?? {};
    const a = plan ? resolveAllowance(category, plan.allowances, plan.overrides) : { configured: false as const };
    const allowance = !a.configured ? null : a.unlimited ? 'unlimited' as const : a.units;
    const included = t.INCLUDED?.units ?? 0;
    return {
      category, label: SERVICE_CATEGORY_LABELS[category], allowance,
      included,
      overage: t.OVERAGE?.units ?? 0,
      overageUnbilled: t.OVERAGE?.unbilled ?? 0,
      nonBillable: t.NON_BILLABLE?.units ?? 0,
      pending: t.PENDING?.units ?? 0,
      remaining: typeof allowance === 'number' ? Math.max(0, allowance - included) : null,
    };
  });
}

/** Every agency with The Desk on (or with work counted in the month): its plan and its month. */
export async function getUsage(db: Db, scope: DeskScope, opts: { period?: string | null; now?: Date } = {}) {
  opsOnly(scope);
  return usageReport(db, scope, opts);
}

/**
 * The report itself, for the agencies given (all when none are given). The
 * caller decides who may read it: the Usage page above, and the dashboards
 * (Module 52), which leave prices out.
 */
export async function usageReport(db: Db, scope: DeskScope, opts: { period?: string | null; now?: Date; agencyIds?: readonly string[] } = {}) {
  const only: Prisma.TaskWhereInput = opts.agencyIds ? { agencyId: { in: [...opts.agencyIds] } } : {};
  const now = opts.now ?? new Date();
  const cal = await loadBusinessCalendar(db);
  const period = usagePeriod(opts.period, now, cal.timeZone);
  const completed: Prisma.TaskWhereInput = { status: 'COMPLETED', billingPeriod: period, ...only };

  const [classified, pending] = await Promise.all([
    db.task.groupBy({
      by: ['agencyId', 'serviceCategory', 'billingClass', 'billingStatus'],
      where: { AND: [completed, { billingClass: { in: ['INCLUDED', 'OVERAGE', 'NON_BILLABLE'] } }] },
      _sum: { billableUnits: true },
    }),
    db.task.groupBy({
      by: ['agencyId', 'serviceCategory'],
      where: { AND: [completed, BILLING_UNCLASSIFIED, { nonBillable: false }] },
      _sum: { billableUnits: true },
    }),
  ]);
  const tally = new Map<string, Partial<Record<BillingClass | 'PENDING', Totals>>>();
  const add = (agencyId: string, category: ServiceCategory | null, cls: BillingClass | 'PENDING', units: number, unbilled: number) => {
    const row = tally.get(key(agencyId, category)) ?? tally.set(key(agencyId, category), {}).get(key(agencyId, category))!;
    const t = row[cls] ?? (row[cls] = { units: 0, unbilled: 0 });
    t.units += units;
    t.unbilled += unbilled;
  };
  for (const g of classified) {
    const units = g._sum.billableUnits ?? 0;
    add(g.agencyId, g.serviceCategory, g.billingClass!, units, g.billingClass === 'OVERAGE' && g.billingStatus === 'UNBILLED' ? units : 0);
  }
  for (const g of pending) add(g.agencyId, g.serviceCategory, 'PENDING', g._sum.billableUnits ?? 0, 0);

  const withWork = [...new Set([...classified, ...pending].map((g) => g.agencyId))];
  const agencies = await db.agency.findMany({
    where: { AND: [{ OR: [{ deskEnabled: true }, { id: { in: withWork } }] }, opts.agencyIds ? { id: { in: [...opts.agencyIds] } } : {}] },
    select: {
      id: true, name: true, deskEnabled: true,
      deskPlan: {
        select: {
          monthlyPriceCents: true, managedAccountsOverride: true,
          plan: { select: { name: true, monthlyPriceCents: true, priceIsStartingAt: true, managedAccounts: true, allowances: { select: { category: true, monthlyUnits: true } } } },
          allowanceOverrides: { select: { category: true, monthlyUnits: true } },
        },
      },
    },
  });
  const accounts = await db.insuredAccount.groupBy({ by: ['agencyId'], where: { status: 'ACTIVE', agencyId: { in: agencies.map((a) => a.id) } }, _count: { _all: true } });
  const active = new Map(accounts.map((r) => [r.agencyId, r._count._all]));

  const rows = agencies.map((a) => {
    const p = a.deskPlan;
    const categories = categoryUsage(a.id, p ? { allowances: p.plan.allowances, overrides: p.allowanceOverrides } : null, tally);
    const sum = (f: keyof Pick<CategoryUsage, 'included' | 'overage' | 'overageUnbilled' | 'nonBillable' | 'pending'>) => categories.reduce((s, c) => s + c[f], 0);
    const price = p ? (p.monthlyPriceCents ?? (p.plan.priceIsStartingAt ? null : p.plan.monthlyPriceCents)) : null;
    return {
      id: a.id, name: a.name, deskEnabled: a.deskEnabled,
      plan: p ? { name: p.plan.name, monthlyPriceCents: price === null || !can(scope, 'billing.prices') ? null : Number(price) } : null,
      managedAccounts: { active: active.get(a.id) ?? 0, included: p ? resolveManagedAccounts(p.plan, p) : null },
      categories,
      totals: { included: sum('included'), overage: sum('overage'), overageUnbilled: sum('overageUnbilled'), nonBillable: sum('nonBillable'), pending: sum('pending') },
    };
  });
  // Those over their allowance first, then those with work waiting to be classified, then by name.
  rows.sort((x, y) => Number(y.totals.overage > 0) - Number(x.totals.overage > 0) || Number(y.totals.pending > 0) - Number(x.totals.pending > 0) || x.name.localeCompare(y.name));

  return {
    period,
    showsPrices: can(scope, 'billing.prices'),
    periods: recentPeriods(billingPeriodOf(now, cal.timeZone)),
    timeZone: cal.timeZone,
    agencies: rows,
    totals: {
      agencies: rows.length,
      overAllowance: rows.filter((r) => r.totals.overage > 0).length,
      overageUnbilled: rows.reduce((s, r) => s + r.totals.overageUnbilled, 0),
      pending: rows.reduce((s, r) => s + r.totals.pending, 0),
      noPlan: rows.filter((r) => !r.plan).length,
    },
  };
}

const BILLING_LABELS: Record<BillingClass | 'PENDING', string> = {
  INCLUDED: 'Included', OVERAGE: 'Overage', NON_BILLABLE: 'Non-billable', PENDING: 'Not yet classified',
};

/** One agency's completed work in the month, task by task. Opening it is logged. */
export async function getAgencyUsage(db: Db, scope: DeskScope, agencyId: string, opts: { period?: string | null; now?: Date } = {}, ctx: GuardContext = {}) {
  opsOnly(scope);
  if (!isObjectId(agencyId)) throw new DeskAccessError(404, 'Agency not found.');
  const now = opts.now ?? new Date();
  const cal = await loadBusinessCalendar(db);
  const period = usagePeriod(opts.period, now, cal.timeZone);
  const agency = await db.agency.findUnique({ where: { id: agencyId }, select: { id: true, name: true } });
  if (!agency) throw new DeskAccessError(404, 'Agency not found.');
  const tasks = await db.task.findMany({
    where: { agencyId, status: 'COMPLETED', billingPeriod: period },
    select: { id: true, reference: true, type: true, title: true, completedAt: true, serviceCategory: true, billableUnits: true, billingClass: true, billingStatus: true, nonBillable: true },
    orderBy: { completedAt: 'asc' },
    take: USAGE_TASKS_MAX + 1,
  });
  const truncated = tasks.length > USAGE_TASKS_MAX;
  if (truncated) tasks.length = USAGE_TASKS_MAX;
  // Every line counts toward the bill; a request the person may not see is listed without its title.
  const visible = new Set((await db.task.findMany({ where: { AND: [{ id: { in: tasks.map((t) => t.id) } }, taskWhere(scope)] }, select: { id: true } })).map((t) => t.id));
  await recordAudit(db, {
    actor: { id: scope.userId, role: scope.role }, action: 'usage.viewed', entityType: 'Agency', entityId: agency.id, agencyId: agency.id,
    metadata: { period }, ip: ctx.ip, userAgent: ctx.userAgent,
  });
  return {
    agency, period, truncated,
    tasks: tasks.map((t) => {
      const cls: BillingClass | 'PENDING' = t.billingClass ?? (t.nonBillable ? 'NON_BILLABLE' : 'PENDING');
      return {
        id: t.id, reference: t.reference, title: visible.has(t.id) ? t.title : null, typeLabel: TASK_TYPE_LABELS[t.type],
        completedAt: t.completedAt?.toISOString() ?? null,
        category: SERVICE_CATEGORY_LABELS[t.serviceCategory ?? 'SERVICE'],
        units: t.billableUnits, billing: cls, billingLabel: BILLING_LABELS[cls],
        invoice: t.billingClass === 'OVERAGE' ? t.billingStatus : null,
      };
    }),
  };
}

export type UsageReport = Awaited<ReturnType<typeof getUsage>>;
