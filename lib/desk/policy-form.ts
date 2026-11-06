/**
 * The policy form's values and field limits. Pure, so the browser screens and
 * the server share one set of rules. Premiums are handled in whole cents and
 * dates as YYYY-MM-DD text, so neither rounding nor time zones can change them.
 */
import type { TextRule } from './account-form';

export const POLICY_TEXT: Record<string, TextRule> = {
  policyNumber: { label: 'Policy number', max: 100 },
  lineOfBusiness: { label: 'Line of business', max: 100 },
  carrierName: { label: 'Carrier', max: 200 },
  notes: { label: 'Notes', max: 2000, screen: true },
  externalRef: { label: 'AMS reference', max: 100 },
};

export const MAX_PREMIUM_CENTS = 100_000_000_000; // $1 billion: anything above is a typing error

export const NO_POLICY_DETAILS = 'Enter a policy number, line of business or carrier.';

export type PolicyStatusValue = 'ACTIVE' | 'PENDING' | 'EXPIRED' | 'CANCELLED';

export const POLICY_STATUS_LABELS: Record<PolicyStatusValue, string> = {
  ACTIVE: 'Active',
  PENDING: 'Pending',
  EXPIRED: 'Expired',
  CANCELLED: 'Cancelled',
};

export interface StoredPolicy {
  policyNumber?: string | null;
  lineOfBusiness?: string | null;
  carrierName?: string | null;
  effectiveDate?: string | null;
  expirationDate?: string | null;
  premiumCents?: number | null;
  status?: PolicyStatusValue;
  externalRef?: string | null;
  notes?: string | null;
}

export interface PolicyFormValues {
  policyNumber: string;
  lineOfBusiness: string;
  carrierName: string;
  effectiveDate: string;
  expirationDate: string;
  premium: string;
  status: PolicyStatusValue;
  externalRef: string;
  notes: string;
}

/** 123456 → "1234.56", as typed into the form. */
function centsToInput(cents: number): string {
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;
}

export function formFromPolicy(policy: StoredPolicy = {}): PolicyFormValues {
  return {
    policyNumber: policy.policyNumber ?? '',
    lineOfBusiness: policy.lineOfBusiness ?? '',
    carrierName: policy.carrierName ?? '',
    effectiveDate: policy.effectiveDate ?? '',
    expirationDate: policy.expirationDate ?? '',
    premium: policy.premiumCents === null || policy.premiumCents === undefined ? '' : centsToInput(policy.premiumCents),
    status: policy.status ?? 'ACTIVE',
    externalRef: policy.externalRef ?? '',
    notes: policy.notes ?? '',
  };
}

/** "$1,250.50" → 125050 cents; empty → null. Worked out from the digits, never through a fraction. */
export function parsePremium(text: string): { cents: number | null } | { error: string } {
  const t = text.trim();
  if (!t) return { cents: null };
  const m = /^\$?\s*(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?$/.exec(t);
  if (!m) return { error: 'Premium must be an amount in dollars, such as 1250.50.' };
  const dollars = m[1].replace(/,/g, '');
  if (dollars.length > 10) return { error: 'Premium is too large.' };
  const cents = Number(dollars) * 100 + Number((m[2] ?? '').padEnd(2, '0'));
  if (cents > MAX_PREMIUM_CENTS) return { error: 'Premium is too large.' };
  return { cents };
}

const TEXT_KEYS = ['policyNumber', 'lineOfBusiness', 'carrierName', 'effectiveDate', 'expirationDate', 'externalRef', 'notes'] as const;

/**
 * What to send: only what differs from the saved policy (or from a blank one,
 * when adding), with a cleared field as null. A form that names no policy at all
 * is refused here as well as on the server.
 */
export function policyChanges(form: PolicyFormValues, saved?: StoredPolicy): { changes: Record<string, string | number | null> } | { error: string } {
  if (!form.policyNumber.trim() && !form.lineOfBusiness.trim() && !form.carrierName.trim()) return { error: NO_POLICY_DETAILS };
  const premium = parsePremium(form.premium);
  if ('error' in premium) return premium;

  const before = formFromPolicy(saved);
  const changes: Record<string, string | number | null> = {};
  for (const key of TEXT_KEYS) {
    const value = form[key].trim();
    if (value !== before[key].trim()) changes[key] = value || null;
  }
  if (premium.cents !== (saved?.premiumCents ?? null)) changes.premiumCents = premium.cents;
  if (form.status !== before.status) changes.status = form.status;
  return { changes };
}

/** The dirty check for the form: true once anything differs from where it started. */
export function policyFormDirty(form: PolicyFormValues, saved?: StoredPolicy): boolean {
  const before = formFromPolicy(saved);
  return (Object.keys(before) as (keyof PolicyFormValues)[]).some((k) => form[k].trim() !== before[k].trim());
}

export function premiumLabel(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return '—';
  const whole = Math.floor(cents / 100).toLocaleString('en-US');
  return `$${whole}.${String(cents % 100).padStart(2, '0')}`;
}
