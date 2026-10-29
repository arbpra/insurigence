/**
 * Billing classification helpers. Pure — safe for server and browser.
 * The Desk tracks billable activity now; invoicing is a later phase.
 */
import type { ServiceCategory, TaskType } from '@prisma/client';

/** Which allowance bucket each request type counts toward. */
export const SERVICE_CATEGORY_BY_TYPE: Record<TaskType, ServiceCategory> = {
  COI: 'COI',
  ENDORSEMENT: 'ENDORSEMENT',
  RENEWAL: 'RENEWAL',
  REMARKETING: 'REMARKETING',
  NEW_BUSINESS: 'NEW_BUSINESS',
  SUBMISSION: 'NEW_BUSINESS',
  PROPOSAL_PREP: 'NEW_BUSINESS',
  LOSS_RUNS: 'RENEWAL',
  ACORD: 'SERVICE',
  AMS_ENTRY: 'SERVICE',
  POLICY_UPDATE: 'SERVICE',
  DOCUMENT_UPLOAD: 'SERVICE',
  QA_REVIEW: 'SERVICE',
  OTHER: 'SERVICE',
};

export const SERVICE_CATEGORY_LABELS: Record<ServiceCategory, string> = {
  COI: 'COIs',
  ENDORSEMENT: 'Endorsements',
  RENEWAL: 'Renewals',
  REMARKETING: 'Remarketing credits',
  NEW_BUSINESS: 'New business',
  SERVICE: 'General service',
};

/** Types that are internal quality work, never billed to the agency. */
const NON_BILLABLE_TYPES: ReadonlySet<TaskType> = new Set<TaskType>(['QA_REVIEW']);

export function defaultBilling(type: TaskType): { serviceCategory: ServiceCategory; nonBillable: boolean } {
  return { serviceCategory: SERVICE_CATEGORY_BY_TYPE[type], nonBillable: NON_BILLABLE_TYPES.has(type) };
}

/**
 * "YYYY-MM" of a moment in the given time zone. A task completed at 9pm
 * New York time on 31 October counts toward October even though it is already
 * November in UTC.
 */
export function billingPeriodOf(at: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit' }).formatToParts(at);
  const y = parts.find((p) => p.type === 'year')?.value;
  const m = parts.find((p) => p.type === 'month')?.value;
  return `${y}-${m}`;
}

type AllowanceRow = { category: ServiceCategory; monthlyUnits: number | null };

/**
 * The monthly allowance that applies to an agency for one category.
 *  - an agency override wins over the plan;
 *  - monthlyUnits null means unlimited;
 *  - no row anywhere means the allowance is not configured yet (the caller
 *    decides how to treat that — see Module 13).
 */
export function resolveAllowance(
  category: ServiceCategory,
  planAllowances: AllowanceRow[],
  agencyOverrides: AllowanceRow[] = []
): { configured: false } | { configured: true; unlimited: boolean; units: number } {
  const row = agencyOverrides.find((r) => r.category === category) ?? planAllowances.find((r) => r.category === category);
  if (!row) return { configured: false };
  if (row.monthlyUnits === null) return { configured: true, unlimited: true, units: Infinity };
  return { configured: true, unlimited: false, units: row.monthlyUnits };
}

/** Managed accounts included: agency override, else plan, else not configured (null). */
export function resolveManagedAccounts(
  plan: { managedAccounts: number | null },
  agencyPlan?: { managedAccountsOverride: number | null } | null
): number | null {
  return agencyPlan?.managedAccountsOverride ?? plan.managedAccounts;
}
