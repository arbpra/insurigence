/**
 * The account list's filters and the account form's values. Pure, so the
 * browser screens and the server share one set of field limits.
 */

export type TextRule = { label: string; max: number; screen?: boolean };

/** Optional text on an account. `screen`: refused if it reads like a password. */
export const INSURED_TEXT: Record<string, TextRule> = {
  dba: { label: 'DBA name', max: 200 },
  contactName: { label: 'Contact name', max: 200 },
  contactPhone: { label: 'Contact phone', max: 50 },
  website: { label: 'Website', max: 300 },
  addressLine1: { label: 'Address', max: 200 },
  addressLine2: { label: 'Address line 2', max: 200 },
  city: { label: 'City', max: 100 },
  state: { label: 'State', max: 50 },
  postalCode: { label: 'Postal code', max: 20 },
  industry: { label: 'Industry', max: 100 },
  description: { label: 'Description', max: 2000, screen: true },
  notes: { label: 'Notes', max: 5000, screen: true },
  externalRef: { label: 'AMS reference', max: 100 },
};

export const ACCOUNT_NAME_MAX = 200;
export const CONTACT_EMAIL_MAX = 254;

// ── The form ──

export const ACCOUNT_FORM_KEYS = [
  'name', 'dba', 'industry', 'website', 'description',
  'contactName', 'contactEmail', 'contactPhone',
  'addressLine1', 'addressLine2', 'city', 'state', 'postalCode',
  'externalRef', 'notes',
] as const;

export type AccountFormKey = (typeof ACCOUNT_FORM_KEYS)[number];
export type AccountFormValues = Record<AccountFormKey, string>;
type StoredAccount = Partial<Record<AccountFormKey, string | null>>;

export function formFromAccount(account: StoredAccount = {}): AccountFormValues {
  const form = {} as AccountFormValues;
  for (const key of ACCOUNT_FORM_KEYS) form[key] = account[key] ?? '';
  return form;
}

/** What a new account sends: the fields filled in. */
export function newAccountPayload(form: AccountFormValues): Partial<Record<AccountFormKey, string>> {
  const payload: Partial<Record<AccountFormKey, string>> = {};
  for (const key of ACCOUNT_FORM_KEYS) {
    const value = form[key].trim();
    if (value) payload[key] = value;
  }
  return payload;
}

/** What an edit sends: only what changed, with a cleared field as null (a cleared name stays '', which the server refuses). */
export function changedAccountFields(form: AccountFormValues, saved: AccountFormValues): Partial<Record<AccountFormKey, string | null>> {
  const changes: Partial<Record<AccountFormKey, string | null>> = {};
  for (const key of ACCOUNT_FORM_KEYS) {
    const value = form[key].trim();
    const before = saved[key].trim();
    const same = key === 'contactEmail' ? value.toLowerCase() === before.toLowerCase() : value === before;
    if (!same) changes[key] = value || (key === 'name' ? '' : null);
  }
  return changes;
}

// ── Showing an account ──

/**
 * A link for the website field, which is free text. Only http and https: a value
 * such as "javascript:..." would otherwise run in the viewer's session when clicked.
 */
export function websiteHref(value: string | null | undefined): string | null {
  const t = value?.trim();
  if (!t || /\s/.test(t)) return null;
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(t) ? t : `https://${t}`);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
  } catch {
    return null;
  }
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2026-01-31" → "Jan 31, 2026". Read from the text: through a Date it could show the day before. */
export function dayLabel(value: string | null | undefined): string {
  const m = value ? /^(\d{4})-(\d{2})-(\d{2})/.exec(value) : null;
  return m ? `${MONTHS[+m[2] - 1]} ${+m[3]}, ${m[1]}` : '—';
}

/** A moment in time, as the day it was where the viewer is. */
export function localDayLabel(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/** Encoded, so an imported value such as "a@b.test?bcc=x" can't add to the message. */
export function mailtoHref(email: string): string {
  return `mailto:${encodeURIComponent(email).replace(/%40/g, '@')}`;
}

export function fileSizeLabel(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ── The list ──

export type AccountStatusFilter = 'ACTIVE' | 'INACTIVE' | 'ALL';

export interface AccountFilters {
  q: string;
  status: AccountStatusFilter;
  mine: boolean;
  page: number;
}

export const ACCOUNTS_PAGE_SIZE = 25;
const MAX_PAGE = 1_000_000;

export function parseAccountFilters(params: URLSearchParams): AccountFilters {
  const status = params.get('status');
  const page = Number(params.get('page'));
  return {
    q: (params.get('q') ?? '').trim(),
    status: status === 'INACTIVE' || status === 'ALL' ? status : 'ACTIVE',
    mine: params.get('mine') === '1',
    page: Number.isInteger(page) && page >= 1 && page <= MAX_PAGE ? page : 1,
  };
}

/** The page's own address: defaults left out, so a plain link is the plain list. */
export function accountPageQuery(f: AccountFilters): string {
  const p = new URLSearchParams();
  if (f.q) p.set('q', f.q);
  if (f.status !== 'ACTIVE') p.set('status', f.status);
  if (f.mine) p.set('mine', '1');
  if (f.page > 1) p.set('page', String(f.page));
  return p.toString();
}

/** The API's query. It lists every status unless told otherwise, so "All" is the one left out. */
export function accountApiQuery(f: AccountFilters): string {
  const p = new URLSearchParams();
  if (f.q) p.set('q', f.q);
  if (f.status !== 'ALL') p.set('status', f.status);
  if (f.mine) p.set('mine', '1');
  p.set('page', String(f.page));
  p.set('pageSize', String(ACCOUNTS_PAGE_SIZE));
  return p.toString();
}

export const hasAccountFilters = (f: AccountFilters) => !!f.q || f.status !== 'ACTIVE' || f.mine;

export const lastAccountPage = (total: number) => Math.max(1, Math.ceil(total / ACCOUNTS_PAGE_SIZE));

export function accountRangeLabel(total: number, page: number): string {
  if (total === 0) return 'No accounts';
  const first = (page - 1) * ACCOUNTS_PAGE_SIZE + 1;
  const last = Math.min(page * ACCOUNTS_PAGE_SIZE, total);
  const count = total.toLocaleString('en-US');
  return total === 1 ? '1 account' : `${first.toLocaleString('en-US')}–${last.toLocaleString('en-US')} of ${count} accounts`;
}
