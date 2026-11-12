'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { dayLabel } from '@/lib/desk/account-form';
import {
  DUE_SOON_HOURS, OVERDUE_LIMIT, RENEWAL_WINDOWS, REVIEW_REASON_LABELS, daysLeftLabel, lateBy,
  type RenewalWindow, type ReviewReason,
} from '@/lib/desk/dashboard-view';

type Ref = { id: string; name: string };
interface Dashboard {
  renewalDays: RenewalWindow;
  counts: { open: number; overdue: number; dueSoon: number; waitingOnAgency: number; review: number; unrouted: number; renewals: number; agencies: number };
  agencies: (Ref & { open: number; overdue: number; waitingOnAgency: number; review: number; renewals: number })[];
  review: { id: string; reference: number; title: string; typeLabel: string; statusLabel: string; agency: Ref; reasons: ReviewReason[]; escalationReason: string | null; createdAt: string }[];
  overdue: { id: string; reference: number; title: string; typeLabel: string; statusLabel: string; agency: Ref; assignee: string | null; dueAt: string }[];
  renewals: {
    id: string; policyNumber: string | null; lineOfBusiness: string | null; carrierName: string | null; expirationDate: string; daysLeft: number;
    agency: Ref; insured: Ref; renewalTask: { id: string; reference: number; statusLabel: string } | null;
  }[];
}

const ACCENT = 'var(--brand-primary, #05314c)';
const CARD = 'border border-slate-200 rounded-xl bg-white p-4 sm:p-5 min-w-0';
const H2 = 'text-base font-semibold text-slate-900';
const BUTTON = 'px-3 py-1.5 text-sm rounded-lg font-medium disabled:opacity-50';
const SECONDARY = `${BUTTON} border border-slate-300 bg-white text-slate-700`;
const REASON_BADGE: Record<ReviewReason, string> = {
  ESCALATED: 'bg-red-100 text-red-800',
  QA: 'bg-violet-100 text-violet-800',
  UNROUTED: 'bg-slate-100 text-slate-700',
};

const shown = (rows: number, total: number, what: string) =>
  total > rows ? <p className="text-xs text-slate-500 mt-2">Showing {rows} of {total.toLocaleString('en-US')} {what}.</p> : null;

/** An Account Manager's (or Operations Manager's) overview across their agencies. */
export function ManagerDashboard({ initialWindow }: { initialWindow: RenewalWindow }) {
  const [window_, setWindow] = useState<RenewalWindow>(initialWindow);
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const request = new AbortController();
    setLoading(true);
    setError('');
    fetch(`/api/desk/dashboard?renewals=${window_}`, { signal: request.signal })
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error || 'The overview could not be loaded.');
        setData(body);
        setNow(new Date());
        setLoading(false);
      })
      .catch((err) => {
        if (request.signal.aborted) return;
        setError(err instanceof Error ? err.message : 'The overview could not be loaded.');
        setLoading(false);
      });
    return () => request.abort();
  }, [window_, attempt]);

  function chooseWindow(days: RenewalWindow) {
    setWindow(days);
    try { window.history.replaceState(null, '', days === 60 ? '/desk-ops' : `/desk-ops?renewals=${days}`); } catch { /* address only */ }
  }

  if (error && !data) {
    return (
      <div className={CARD} role="alert" data-testid="desk-dash-error">
        <p className="text-sm text-red-600 mb-2">{error}</p>
        <button type="button" className={SECONDARY} onClick={() => setAttempt((n) => n + 1)}>Try again</button>
      </div>
    );
  }
  if (!data) return <p className="text-sm text-slate-500">Loading…</p>;
  const c = data.counts;

  const tiles: { key: string; label: string; value: number; note: string; tone?: string; href?: string }[] = [
    { key: 'open', label: 'Open requests', value: c.open, note: `across ${c.agencies} ${c.agencies === 1 ? 'agency' : 'agencies'}` },
    { key: 'overdue', label: 'Overdue', value: c.overdue, note: 'past the internal target', tone: c.overdue ? 'text-red-700' : undefined },
    { key: 'soon', label: 'Due soon', value: c.dueSoon, note: `within ${DUE_SOON_HOURS} hours`, tone: c.dueSoon ? 'text-amber-700' : undefined },
    { key: 'waiting', label: 'Waiting on agencies', value: c.waitingOnAgency, note: 'the clock is paused' },
    { key: 'review', label: 'To review', value: c.review, note: c.unrouted ? `${c.unrouted} not routed to a pod` : 'QA, escalations, routing' },
    { key: 'renewals', label: 'Renewals', value: c.renewals, note: `expiring in the next ${data.renewalDays} days` },
  ];

  return (
    <div data-testid="desk-dashboard" aria-busy={loading}>
      <div className="mb-5">
        <h1 className="text-2xl font-bold tracking-tight mb-1" style={{ color: ACCENT }} data-testid="page-title">Overview</h1>
        <p className="text-sm text-slate-500">Due dates here are internal targets. Agencies never see them.</p>
      </div>
      {error && <p className="text-sm text-red-600 mb-4" role="alert">{error}</p>}

      <div className="grid gap-3 grid-cols-2 lg:grid-cols-6 mb-5" data-testid="desk-dash-tiles">
        {tiles.map((t) => (
          <div key={t.key} className={CARD} data-testid={`desk-dash-tile-${t.key}`}>
            <p className="text-sm text-slate-500">{t.label}</p>
            <p className={`text-3xl font-semibold mt-1 ${t.tone ?? 'text-slate-900'}`} data-testid={`desk-dash-count-${t.key}`}>{t.value.toLocaleString('en-US')}</p>
            <p className="text-xs text-slate-500 mt-1">{t.note}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2 mb-4">
        <section className={CARD} data-testid="desk-dash-review">
          <h2 className={`${H2} mb-3`}>To review</h2>
          {data.review.length === 0 ? <p className="text-sm text-slate-500">Nothing needs a manager right now.</p> : (
            <ul className="grid gap-2 list-none p-0">
              {data.review.map((t) => (
                <li key={t.id} className="border border-slate-200 rounded-lg p-3 min-w-0" data-testid="desk-dash-review-item">
                  <Link href={`/desk-ops/tasks/${t.id}`} className="font-medium hover:underline break-words" style={{ color: ACCENT }} data-testid="desk-dash-review-open">
                    <span className="text-slate-400 mr-1">#{t.reference}</span>{t.title}
                  </Link>
                  <p className="text-xs text-slate-500 mt-0.5">{t.agency.name} · {t.typeLabel} · {t.statusLabel}</p>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {t.reasons.map((r) => <span key={r} className={`px-2 py-0.5 rounded-full text-xs font-medium ${REASON_BADGE[r]}`} data-testid="desk-dash-review-reason">{REVIEW_REASON_LABELS[r]}</span>)}
                  </div>
                  {t.escalationReason && <p className="text-sm text-slate-700 mt-1 break-words">{t.escalationReason}</p>}
                </li>
              ))}
            </ul>
          )}
          {shown(data.review.length, c.review, 'items')}
        </section>

        <section className={CARD} data-testid="desk-dash-overdue">
          <h2 className={`${H2} mb-3`}>Most overdue</h2>
          {data.overdue.length === 0 ? <p className="text-sm text-slate-500">Nothing is overdue.</p> : (
            <ul className="grid gap-2 list-none p-0">
              {data.overdue.map((t) => (
                <li key={t.id} className="border border-slate-200 rounded-lg p-3 min-w-0" data-testid="desk-dash-overdue-item">
                  <Link href={`/desk-ops/tasks/${t.id}`} className="font-medium hover:underline break-words" style={{ color: ACCENT }} data-testid="desk-dash-overdue-open">
                    <span className="text-slate-400 mr-1">#{t.reference}</span>{t.title}
                  </Link>
                  <p className="text-xs text-slate-500 mt-0.5">{t.agency.name} · {t.statusLabel} · {t.assignee ?? 'Nobody has it'}</p>
                  <p className="text-sm text-red-700 font-medium mt-0.5" data-testid="desk-dash-overdue-late">{lateBy(t.dueAt, now)} overdue</p>
                </li>
              ))}
            </ul>
          )}
          {c.overdue > OVERDUE_LIMIT && (
            <p className="text-xs text-slate-500 mt-2">Showing the {data.overdue.length} most overdue of {c.overdue}. <Link href="/desk-ops/queue?overdue=1" className="underline">Overdue in the Pod queue</Link></p>
          )}
        </section>
      </div>

      <section className={`${CARD} mb-4`} data-testid="desk-dash-agencies">
        <h2 className={`${H2} mb-3`}>Your agencies</h2>
        {data.agencies.length === 0 ? <p className="text-sm text-slate-500">No agencies are assigned to you yet.</p> : (
          <div className="overflow-x-auto -mx-4 sm:mx-0 px-4 sm:px-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-slate-500 border-b border-slate-200">
                  <th className="py-2 pr-4 font-medium">Agency</th>
                  <th className="py-2 pr-4 font-medium text-right">Open</th>
                  <th className="py-2 pr-4 font-medium text-right">Overdue</th>
                  <th className="py-2 pr-4 font-medium text-right whitespace-nowrap">Waiting on them</th>
                  <th className="py-2 pr-4 font-medium text-right whitespace-nowrap">To review</th>
                  <th className="py-2 font-medium text-right">Renewals</th>
                </tr>
              </thead>
              <tbody>
                {data.agencies.map((a) => (
                  <tr key={a.id} className="border-b border-slate-100 last:border-0" data-testid="desk-dash-agency">
                    <td className="py-2 pr-4 min-w-[10rem] break-words">
                      <Link href={`/desk-ops/agencies/${a.id}`} className="hover:underline" style={{ color: ACCENT }} data-testid="desk-dash-agency-open">{a.name}</Link>
                    </td>
                    <td className="py-2 pr-4 text-right tabular-nums">{a.open}</td>
                    <td className={`py-2 pr-4 text-right tabular-nums ${a.overdue ? 'text-red-700 font-medium' : 'text-slate-500'}`}>{a.overdue}</td>
                    <td className="py-2 pr-4 text-right tabular-nums text-slate-700">{a.waitingOnAgency}</td>
                    <td className="py-2 pr-4 text-right tabular-nums text-slate-700">{a.review}</td>
                    <td className="py-2 text-right tabular-nums text-slate-700">{a.renewals}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {shown(data.agencies.length, c.agencies, 'agencies')}
      </section>

      <section className={CARD} data-testid="desk-dash-renewals">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <h2 className={H2}>Upcoming renewals</h2>
          <div className="flex gap-1" role="group" aria-label="Expiring within">
            {RENEWAL_WINDOWS.map((d) => (
              <button key={d} type="button" aria-pressed={data.renewalDays === d} disabled={loading}
                className={`${BUTTON} border ${window_ === d ? 'text-white border-transparent' : 'border-slate-300 bg-white text-slate-700'}`}
                style={window_ === d ? { backgroundColor: ACCENT } : undefined} onClick={() => chooseWindow(d)} data-testid={`desk-dash-window-${d}`}>
                {d} days
              </button>
            ))}
          </div>
        </div>
        {data.renewals.length === 0 ? <p className="text-sm text-slate-500">No active policies expire in the next {data.renewalDays} days.</p> : (
          <ul className="divide-y divide-slate-100 list-none p-0 -my-2">
            {data.renewals.map((p) => (
              <li key={p.id} className="py-3 flex flex-wrap items-start justify-between gap-x-4 gap-y-1" data-testid="desk-dash-renewal">
                <div className="min-w-[12rem] flex-1">
                  <p className="font-medium text-slate-900 break-words">{p.insured.name}</p>
                  <p className="text-xs text-slate-500 break-words">{p.agency.name} · {[p.policyNumber, p.lineOfBusiness, p.carrierName].filter(Boolean).join(' · ') || 'Policy'}</p>
                </div>
                <div className="sm:text-right text-sm shrink-0">
                  <p className={p.daysLeft <= 14 ? 'text-amber-800 font-medium' : 'text-slate-700'} data-testid="desk-dash-renewal-expiry">{daysLeftLabel(p.daysLeft)} · {dayLabel(p.expirationDate)}</p>
                  {p.renewalTask
                    ? <Link href={`/desk-ops/tasks/${p.renewalTask.id}`} className="text-xs underline text-slate-600" data-testid="desk-dash-renewal-task">Renewal #{p.renewalTask.reference}: {p.renewalTask.statusLabel}</Link>
                    : <p className="text-xs text-amber-800" data-testid="desk-dash-renewal-none">No renewal request yet</p>}
                </div>
              </li>
            ))}
          </ul>
        )}
        {shown(data.renewals.length, c.renewals, 'policies')}
      </section>
    </div>
  );
}
