'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import {
  accountApiQuery, accountPageQuery, accountRangeLabel, hasAccountFilters, lastAccountPage, parseAccountFilters,
  type AccountFilters, type AccountStatusFilter,
} from '@/lib/desk/account-form';

interface AccountRow {
  id: string;
  name: string;
  dba: string | null;
  status: 'ACTIVE' | 'INACTIVE';
  contactName: string | null;
  city: string | null;
  state: string | null;
  policyCount: number;
  openTasks: number;
  assignments: { userId: string; name: string; role: string }[];
}

interface ListResult {
  total: number;
  page: number;
  insureds: AccountRow[];
}

const INPUT = 'border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white';
const ACCENT = 'var(--brand-primary, #05314c)';
const PAGER = 'px-3 py-1.5 text-sm border border-slate-300 rounded-lg bg-white text-slate-700 disabled:opacity-50';
const SEARCH_DELAY_MS = 300;

/** The agency's accounts: search, status, "my accounts" and paging, all kept in the address so Back returns here. */
export function AccountList({ wholeBook, canImport }: { wholeBook: boolean; canImport: boolean }) {
  const params = useSearchParams();
  const address = params.toString();
  const filters = useMemo(() => parseAccountFilters(new URLSearchParams(address)), [address]);

  const [search, setSearch] = useState(filters.q);
  const [data, setData] = useState<ListResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  // The last search this box sent. Any other change of address came from Back or Forward.
  const sentSearch = useRef(filters.q);

  // Updates the address without a trip to the server, which would otherwise re-render the page for every filter.
  const go = useCallback((current: AccountFilters, next: Partial<AccountFilters>) => {
    const query = accountPageQuery({ ...current, page: 1, ...next });
    window.history.replaceState(null, '', query ? `/desk/accounts?${query}` : '/desk/accounts');
  }, []);

  useEffect(() => {
    if (filters.q !== sentSearch.current) {
      sentSearch.current = filters.q;
      setSearch(filters.q);
    }
  }, [filters.q]);

  useEffect(() => {
    const q = search.trim();
    if (q === sentSearch.current) return;
    const timer = setTimeout(() => {
      sentSearch.current = q;
      go(filters, { q });
    }, SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [search, filters, go]);

  const apiQuery = accountApiQuery(filters);
  useEffect(() => {
    // Aborting the previous request stops a slow, older search replacing a newer one.
    const request = new AbortController();
    setLoading(true);
    setError('');
    fetch(`/api/desk/insureds?${apiQuery}`, { signal: request.signal })
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error || 'The accounts could not be loaded.');
        setData(body);
        setLoading(false);
      })
      .catch((err) => {
        if (request.signal.aborted) return;
        setError(err instanceof Error ? err.message : 'The accounts could not be loaded.');
        setLoading(false);
      });
    return () => request.abort();
  }, [apiQuery, attempt]);

  // Paged past the end, for instance after accounts were deactivated or from an old link.
  const pastEnd = !!data && data.insureds.length === 0 && data.total > 0 && filters.page > 1;
  const finalPage = data ? lastAccountPage(data.total) : 1;
  useEffect(() => {
    if (pastEnd) go(filters, { page: finalPage });
  }, [pastEnd, finalPage, filters, go]);

  const filtered = hasAccountFilters(filters);
  const rows = data?.insureds ?? [];
  // The page on screen, which stays the old one until the new rows arrive.
  const shownPage = data?.page ?? filters.page;

  return (
    <div data-testid="desk-accounts">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-5">
        <div>
          <h1 className="text-2xl font-bold tracking-tight mb-1" style={{ color: ACCENT }} data-testid="page-title">Accounts</h1>
          <p className="text-sm text-slate-500">{wholeBook ? "Your agency's insured accounts." : 'The accounts assigned to you.'}</p>
        </div>
        <Link href="/desk/accounts/new" className="px-4 py-2 rounded-lg text-sm font-medium text-white" style={{ backgroundColor: ACCENT }} data-testid="desk-accounts-add">Add account</Link>
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-4">
        <input
          type="search" aria-label="Search accounts" placeholder="Search name, contact, policy number…" maxLength={200}
          className={`${INPUT} flex-1 min-w-[220px]`} value={search} onChange={(e) => setSearch(e.target.value)} data-testid="desk-accounts-search"
        />
        <select
          aria-label="Status" className={INPUT} value={filters.status}
          onChange={(e) => go(filters, { status: e.target.value as AccountStatusFilter })} data-testid="desk-accounts-status"
        >
          <option value="ACTIVE">Active</option>
          <option value="INACTIVE">Inactive</option>
          <option value="ALL">All statuses</option>
        </select>
        {/* Someone who sees only their assigned accounts is already looking at "my accounts". */}
        {wholeBook && (
          <label className="flex items-center gap-1.5 text-sm text-slate-700">
            <input type="checkbox" checked={filters.mine} onChange={(e) => go(filters, { mine: e.target.checked })} data-testid="desk-accounts-mine" />
            My accounts
          </label>
        )}
      </div>

      {error && (
        <p className="text-sm text-red-600 mb-4" role="alert" data-testid="desk-accounts-error">
          {error}{' '}
          <button type="button" className="underline" onClick={() => setAttempt((n) => n + 1)} data-testid="desk-accounts-retry">Try again</button>
        </p>
      )}

      {!data && loading && <p className="text-sm text-slate-500" data-testid="desk-accounts-loading">Loading…</p>}

      {data && rows.length === 0 && !pastEnd && !loading && (
        <div className="bg-white border border-slate-200 rounded-xl p-8 text-center" data-testid="desk-accounts-empty">
          {filtered ? (
            <>
              <p className="text-sm text-slate-600 mb-2">No accounts match these filters.</p>
              <button
                type="button" className="text-sm underline text-slate-700" data-testid="desk-accounts-clear"
                onClick={() => { sentSearch.current = ''; setSearch(''); go(filters, { q: '', status: 'ACTIVE', mine: false }); }}
              >Clear filters</button>
            </>
          ) : wholeBook ? (
            <p className="text-sm text-slate-600">
              No accounts yet. Add your first one{canImport ? <>, or <Link href="/desk/import" className="underline">import your book of business</Link></> : ''}.
            </p>
          ) : (
            <p className="text-sm text-slate-600">No accounts are assigned to you yet. You can add one, or ask your agency admin to assign you.</p>
          )}
        </div>
      )}

      {rows.length > 0 && (
        <div className={`bg-white border border-slate-200 rounded-xl overflow-x-auto ${loading ? 'opacity-60' : ''}`} aria-busy={loading}>
          <table className="w-full text-sm" data-testid="desk-accounts-table">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-slate-500 border-b border-slate-200">
                <th scope="col" className="px-4 py-3 font-medium">Account</th>
                <th scope="col" className="px-4 py-3 font-medium">Contact</th>
                <th scope="col" className="px-4 py-3 font-medium">Location</th>
                <th scope="col" className="px-4 py-3 font-medium text-right">Policies</th>
                <th scope="col" className="px-4 py-3 font-medium text-right">Open requests</th>
                <th scope="col" className="px-4 py-3 font-medium">Assigned</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.id} className="border-b border-slate-100 last:border-0" data-testid={`desk-account-${a.id}`}>
                  <td className="px-4 py-3">
                    <Link href={`/desk/accounts/${a.id}`} className="font-medium text-slate-800 hover:underline">{a.name}</Link>
                    {a.status === 'INACTIVE' && <span className="ml-2 text-xs px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">Inactive</span>}
                    {a.dba && <div className="text-xs text-slate-500">DBA {a.dba}</div>}
                  </td>
                  <td className="px-4 py-3 text-slate-600">{a.contactName ?? '—'}</td>
                  <td className="px-4 py-3 text-slate-600">{[a.city, a.state].filter(Boolean).join(', ') || '—'}</td>
                  <td className="px-4 py-3 text-slate-600 text-right">{a.policyCount}</td>
                  <td className="px-4 py-3 text-slate-600 text-right">{a.openTasks}</td>
                  <td className="px-4 py-3 text-slate-600">{a.assignments.map((s) => s.name).join(', ') || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {data && data.total > 0 && !pastEnd && (
        <div className="flex flex-wrap items-center justify-between gap-3 mt-4">
          <p className="text-sm text-slate-500" data-testid="desk-accounts-range">{accountRangeLabel(data.total, shownPage)}</p>
          {finalPage > 1 && (
            <div className="flex items-center gap-2">
              <button type="button" className={PAGER} disabled={filters.page <= 1 || loading} onClick={() => go(filters, { page: filters.page - 1 })} data-testid="desk-accounts-prev">Previous</button>
              <span className="text-sm text-slate-600">Page {shownPage} of {finalPage}</span>
              <button type="button" className={PAGER} disabled={filters.page >= finalPage || loading} onClick={() => go(filters, { page: filters.page + 1 })} data-testid="desk-accounts-next">Next</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
