'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { TASK_TYPE_LABELS } from '@/lib/desk/service-levels';
import type { AgencyStatus } from '@/lib/desk/task-statuses';
import {
  AGENCY_STATUS_BADGE, TRACKER_PAGE_SIZE, TRACKER_TABS, trackerApiQuery, trackerPageQuery, type TrackerFilters, type TrackerTab,
} from '@/lib/desk/tracker-view';
import { api } from '@/components/desk/accounts/account-api';

interface Row {
  id: string; reference: number; title: string; typeLabel: string;
  status: AgencyStatus; statusLabel: string;
  insured: { id: string; name: string } | null;
  createdAt: string; completedAt: string | null; cancelledAt: string | null;
}
interface ListResult { total: number; page: number; rows: Row[] }
interface Attention { id: string; reference: number; typeLabel: string; title: string; insured: { id: string; name: string } | null; asked: string | null; since: string | null }
interface Tracker {
  counts: Record<AgencyStatus, number> & { open: number; total: number };
  attention: Attention[];
}

const ACCENT = 'var(--brand-primary, #05314c)';
const CARD = 'border border-slate-200 rounded-xl bg-white p-4 sm:p-5 min-w-0';
const INPUT = 'border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white min-w-0';
const BUTTON = 'px-3 py-1.5 text-sm rounded-lg font-medium disabled:opacity-50';
const SECONDARY = `${BUTTON} border border-slate-300 bg-white text-slate-700`;
const SEARCH_DELAY_MS = 300;
const TABS = Object.keys(TRACKER_TABS) as TrackerTab[];

const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { dateStyle: 'medium' }) : '—');

function tabCount(tab: TrackerTab, counts: Tracker['counts'] | undefined): number | null {
  if (!counts) return null;
  if (tab === 'attention') return counts.NEEDS_ATTENTION;
  if (tab === 'open') return counts.open;
  if (tab === 'completed') return counts.COMPLETED;
  return counts.total;
}

/**
 * The agency's requests. What needs them comes first, then the tabs: open,
 * completed, all. Filters live in the address, so a view can be bookmarked.
 * No due dates or staff: those are the Desk team's, not promises (Q5).
 */
export function RequestTracker({ initial }: { initial: TrackerFilters }) {
  const [filters, setFilters] = useState(initial);
  const [search, setSearch] = useState(initial.q);
  const [tracker, setTracker] = useState<Tracker | null>(null);
  const [data, setData] = useState<ListResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const sentSearch = useRef(initial.q);

  const go = useCallback((next: Partial<TrackerFilters>) => {
    setFilters((current) => {
      const f = { ...current, page: 1, ...next };
      window.history.replaceState(null, '', `/desk/requests${trackerPageQuery(f)}`);
      return f;
    });
  }, []);

  useEffect(() => {
    const q = search.trim();
    if (q === sentSearch.current) return;
    const timer = setTimeout(() => {
      sentSearch.current = q;
      go({ q });
    }, SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [search, go]);

  useEffect(() => {
    api<Tracker>('/api/desk/tracker').then(setTracker).catch(() => setTracker(null));
  }, [attempt]);

  const apiQuery = trackerApiQuery(filters);
  useEffect(() => {
    const request = new AbortController();
    setLoading(true);
    setError('');
    fetch(`/api/desk/tasks?${apiQuery}`, { signal: request.signal })
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error || 'Your requests could not be loaded.');
        setData(body);
        setLoading(false);
      })
      .catch((err) => {
        if (request.signal.aborted) return;
        setError(err instanceof Error ? err.message : 'Your requests could not be loaded.');
        setLoading(false);
      });
    return () => request.abort();
  }, [apiQuery, attempt]);

  // A page past the end (requests completed meanwhile, say): go to the last one.
  const lastPage = data ? Math.max(1, Math.ceil(data.total / TRACKER_PAGE_SIZE)) : 1;
  const pastEnd = !!data && data.rows.length === 0 && data.total > 0 && filters.page > 1;
  useEffect(() => {
    if (pastEnd) go({ page: lastPage });
  }, [pastEnd, lastPage, go]);

  const counts = tracker?.counts;
  const attention = tracker?.attention ?? [];
  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;
  const page = data?.page ?? filters.page;
  const filtered = !!(filters.q || filters.type || filters.mine);

  return (
    <div data-testid="desk-tracker">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-5">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight mb-1" style={{ color: ACCENT }} data-testid="page-title">Requests</h1>
          <p className="text-sm text-slate-500" data-testid="desk-tracker-summary">
            {counts
              ? <>{counts.open} open{counts.NEEDS_ATTENTION ? <>, <span className="text-amber-800 font-medium">{counts.NEEDS_ATTENTION} {counts.NEEDS_ATTENTION === 1 ? 'needs' : 'need'} your attention</span></> : null}. {counts.COMPLETED} completed.</>
              : 'Everything you have sent to your Desk team.'}
          </p>
        </div>
        <Link href="/desk/requests/new" className="px-4 py-2 rounded-lg text-sm font-medium text-white" style={{ backgroundColor: ACCENT }} data-testid="desk-tracker-new">New request</Link>
      </div>

      {attention.length > 0 && (
        <section className="border border-amber-300 bg-amber-50 rounded-xl p-4 sm:p-5 mb-5 min-w-0" data-testid="desk-tracker-attention">
          <h2 className="text-base font-semibold text-amber-900 mb-1">Needs your attention</h2>
          <p className="text-sm text-amber-900 mb-3">{counts?.NEEDS_ATTENTION === 1 ? "Your Desk team is waiting on you for this request. Open it to reply or add what's needed." : "Your Desk team is waiting on you for these requests. Open one to reply or add what's needed."}</p>
          <ul className="grid gap-2 list-none p-0">
            {attention.map((t) => (
              <li key={t.id} className="bg-white border border-amber-200 rounded-lg p-3 min-w-0" data-testid="desk-tracker-attention-item">
                <Link href={`/desk/requests/${t.id}`} className="font-medium underline break-words" style={{ color: ACCENT }} data-testid="desk-tracker-attention-open">
                  #{t.reference} {t.title}
                </Link>
                <p className="text-xs text-slate-500 mt-0.5">{t.typeLabel}{t.insured ? ` · ${t.insured.name}` : ''}{t.since ? ` · asked ${day(t.since)}` : ''}</p>
                {t.asked && <p className="text-sm text-slate-800 mt-1 whitespace-pre-wrap break-words line-clamp-3" data-testid="desk-tracker-attention-asked">{t.asked}</p>}
              </li>
            ))}
          </ul>
          {counts && counts.NEEDS_ATTENTION > attention.length && (
            <p className="text-xs text-amber-900 mt-2">Showing the {attention.length} waiting longest. <button type="button" className="underline" onClick={() => go({ tab: 'attention' })}>See all {counts.NEEDS_ATTENTION}</button></p>
          )}
        </section>
      )}

      <div className="flex flex-wrap gap-2 mb-4" role="tablist" aria-label="Show" data-testid="desk-tracker-tabs">
        {TABS.map((tab) => {
          const n = tabCount(tab, counts);
          const active = filters.tab === tab;
          return (
            <button key={tab} type="button" role="tab" aria-selected={active}
              className={`${BUTTON} border ${active ? 'text-white border-transparent' : 'border-slate-300 bg-white text-slate-700'}`}
              style={active ? { backgroundColor: ACCENT } : undefined}
              onClick={() => go({ tab })} data-testid={`desk-tracker-tab-${tab}`}>
              {TRACKER_TABS[tab].label}{n !== null ? ` (${n})` : ''}
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap gap-2 mb-4">
        <input type="search" aria-label="Search" placeholder="Search by title, account or #number" className={`${INPUT} flex-1 min-w-[12rem]`}
          value={search} onChange={(e) => setSearch(e.target.value)} data-testid="desk-tracker-search" />
        <select aria-label="Request type" className={INPUT} value={filters.type} onChange={(e) => go({ type: e.target.value })} data-testid="desk-tracker-type">
          <option value="">All types</option>
          {Object.entries(TASK_TYPE_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <label className="flex items-center gap-2 text-sm text-slate-700 px-1">
          <input type="checkbox" checked={filters.mine} onChange={(e) => go({ mine: e.target.checked })} data-testid="desk-tracker-mine" />
          Mine only
        </label>
        {filtered && <button type="button" className={SECONDARY} onClick={() => { sentSearch.current = ''; setSearch(''); go({ q: '', type: '', mine: false }); }} data-testid="desk-tracker-clear">Clear</button>}
      </div>

      <section className={CARD} data-testid="desk-tracker-list" aria-busy={loading}>
        {error ? (
          <div role="alert">
            <p className="text-sm text-red-600 mb-2">{error}</p>
            <button type="button" className={SECONDARY} onClick={() => setAttempt((n) => n + 1)}>Try again</button>
          </div>
        ) : !data ? (
          <p className="text-sm text-slate-500">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-slate-600" data-testid="desk-tracker-empty">
            {filtered ? 'No requests match these filters.'
              : filters.tab === 'attention' ? 'Nothing needs your attention right now.'
              : filters.tab === 'completed' ? 'No completed requests yet.'
              : filters.tab === 'open' ? <>No open requests. <Link href="/desk/requests/new" className="underline">Send one</Link>.</>
              : 'No requests yet.'}
          </p>
        ) : (
          <ul className="divide-y divide-slate-100 list-none p-0 -my-2">
            {rows.map((t) => (
              <li key={t.id} className="py-3 flex flex-wrap items-start justify-between gap-x-4 gap-y-1" data-testid="desk-tracker-row" data-status={t.status}>
                <div className="min-w-[14rem] flex-1">
                  <Link href={`/desk/requests/${t.id}`} className="font-medium underline-offset-2 hover:underline break-words" style={{ color: ACCENT }} data-testid="desk-tracker-row-open">
                    <span className="text-slate-400 mr-1">#{t.reference}</span>{t.title}
                  </Link>
                  <p className="text-xs text-slate-500 mt-0.5">{t.typeLabel}{t.insured ? ` · ${t.insured.name}` : ''}</p>
                </div>
                <div className="sm:text-right text-xs text-slate-500 shrink-0">
                  <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${AGENCY_STATUS_BADGE[t.status]}`} data-testid="desk-tracker-row-status">{t.statusLabel}</span>
                  <p className="mt-1" data-testid="desk-tracker-row-date">
                    {t.status === 'COMPLETED' && t.completedAt ? `Completed ${day(t.completedAt)}` : t.status === 'CANCELLED' && t.cancelledAt ? `Cancelled ${day(t.cancelledAt)}` : `Sent ${day(t.createdAt)}`}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {data && total > TRACKER_PAGE_SIZE && (
        <div className="flex flex-wrap items-center justify-between gap-2 mt-3 text-sm text-slate-600" data-testid="desk-tracker-pages">
          <span>{(page - 1) * TRACKER_PAGE_SIZE + 1}–{Math.min(page * TRACKER_PAGE_SIZE, total)} of {total.toLocaleString('en-US')}</span>
          <div className="flex gap-2">
            <button type="button" className={SECONDARY} disabled={page <= 1 || loading} onClick={() => go({ page: page - 1 })} data-testid="desk-tracker-prev">Previous</button>
            <button type="button" className={SECONDARY} disabled={page >= lastPage || loading} onClick={() => go({ page: page + 1 })} data-testid="desk-tracker-next">Next</button>
          </div>
        </div>
      )}
    </div>
  );
}
