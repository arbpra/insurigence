/**
 * The agency page's work tabs and filters, and how they become the address
 * and the task-list query. Pure — safe for server and browser. The server
 * applies access rules to every query.
 */

export const AGENCY_WORK_PAGE_SIZE = 25;
export const AGENCY_ACCOUNTS_PAGE_SIZE = 25;

/** The work tabs, and what each asks the task list for. */
export const AGENCY_WORK_VIEWS = {
  open: { label: 'Open', query: { open: '1', sort: 'due' } },
  overdue: { label: 'Overdue', query: { overdue: '1', sort: 'due' } },
  waiting: { label: 'Waiting on agency', query: { status: 'WAITING_ON_AGENCY', sort: 'due' } },
  completed: { label: 'Completed', query: { status: 'COMPLETED', sort: 'completed' } },
} as const satisfies Record<string, { label: string; query: Record<string, string> }>;
export type AgencyWorkView = keyof typeof AGENCY_WORK_VIEWS;

export interface AgencyWorkFilters {
  view: AgencyWorkView;
  /** An account's id, to see only its work; '' for all. */
  account: string;
  q: string;
  page: number;
}

const ID = /^[a-f0-9]{24}$/i;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';

/** Reads the address. Anything unrecognised falls back to the default rather than failing. */
export function parseAgencyWork(params: Record<string, string | string[] | undefined>): AgencyWorkFilters {
  const view = first(params.view);
  const account = first(params.account);
  const page = Math.trunc(Number(first(params.page)));
  return {
    view: Object.hasOwn(AGENCY_WORK_VIEWS, view) ? (view as AgencyWorkView) : 'open',
    account: ID.test(account) ? account : '',
    q: first(params.q).trim().slice(0, 200),
    page: page >= 1 && page <= 10_000 ? page : 1,
  };
}

/** The page's own address for a set of filters (defaults left out). */
export function agencyWorkAddress(agencyId: string, f: AgencyWorkFilters): string {
  const p = new URLSearchParams();
  if (f.view !== 'open') p.set('view', f.view);
  if (f.account) p.set('account', f.account);
  if (f.q) p.set('q', f.q);
  if (f.page > 1) p.set('page', String(f.page));
  const s = p.toString();
  return `/desk-ops/agencies/${agencyId}${s ? `?${s}` : ''}`;
}

/** What the page asks the task list for: always this agency, plus the tab and filters. */
export function agencyWorkQuery(agencyId: string, f: AgencyWorkFilters): string {
  const p = new URLSearchParams({ agencyId, ...AGENCY_WORK_VIEWS[f.view].query });
  if (f.account) p.set('insuredId', f.account);
  if (f.q) p.set('q', f.q);
  p.set('page', String(f.page));
  p.set('pageSize', String(AGENCY_WORK_PAGE_SIZE));
  return p.toString();
}

export const AM_ROLE_LABELS = { PRIMARY: 'You are the primary Account Manager', BACKUP: 'You are the backup Account Manager' } as const;
