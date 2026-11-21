'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { TASK_TYPE_LABELS } from '@/lib/desk/service-levels';
import { ON_TARGET_GOOD, ON_TARGET_POOR, formatBusinessMinutes, onTargetLabel, onTargetShare } from '@/lib/desk/turnaround-view';
import { ApiError, api } from '@/components/desk/accounts/account-api';

interface Stats {
  completed: number; median: number | null; average: number | null; p90: number | null;
  averageWaited: number | null; withTarget: number; met: number;
}
type Row = { id: string; name: string; isActive?: boolean; kind?: 'VA' | 'ACCOUNT_MANAGER' | 'OTHER' } & Stats;
interface Report {
  period: { days: number; from: string; to: string };
  calendar: { timeZone: string; workdayMinutes: number };
  truncated: boolean;
  total: Stats;
  pods: Row[]; people: Row[]; agencies: Row[]; types: Row[];
  agencyChoices: { id: string; name: string }[];
}

const PERIODS = [7, 30, 90, 365];
const INPUT = 'border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white min-w-0';
const KIND_LABELS = { VA: 'VA', ACCOUNT_MANAGER: 'Account Manager', OTHER: 'Other' } as const;
const errorText = (err: unknown) => (err instanceof ApiError ? err.message : 'Something went wrong. Try again.');

function shareTone(met: number, withTarget: number) {
  const s = onTargetShare(met, withTarget);
  if (s === null) return 'text-slate-400';
  return s >= ON_TARGET_GOOD ? 'text-emerald-700' : s >= ON_TARGET_POOR ? 'text-amber-700' : 'text-red-700';
}

/** Turnaround of completed requests, in business time less waiting, against internal targets. */
export function TurnaroundView() {
  const params = useSearchParams();
  const [days, setDays] = useState(() => (PERIODS.includes(Number(params.get('days'))) ? Number(params.get('days')) : 30));
  const [type, setType] = useState(params.get('type') ?? '');
  const [agencyId, setAgencyId] = useState(params.get('agencyId') ?? '');
  const [data, setData] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);

  const query = useMemo(() => {
    const q = new URLSearchParams();
    if (days !== 30) q.set('days', String(days));
    if (type) q.set('type', type);
    if (agencyId) q.set('agencyId', agencyId);
    return q.toString();
  }, [days, type, agencyId]);

  useEffect(() => {
    window.history.replaceState(null, '', query ? `/desk-ops/metrics?${query}` : '/desk-ops/metrics');
    let live = true;
    setLoading(true);
    setError('');
    api<Report>(`/api/desk/turnaround${query ? `?${query}` : ''}`)
      .then((d) => { if (live) setData(d); })
      .catch((err) => { if (live) setError(errorText(err)); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [query, attempt]);

  const day = data?.calendar.workdayMinutes ?? 480;
  const t = (m: number | null) => formatBusinessMinutes(m, day);
  const total = data?.total;

  const figure = (label: string, value: string, id: string, tone = 'text-slate-900') => (
    <div className="border border-slate-200 rounded-xl bg-white px-4 py-3" data-testid={`desk-turnaround-total-${id}`}>
      <span className="block text-xs text-slate-500">{label}</span>
      <span className={`block text-2xl font-semibold ${tone}`}>{value}</span>
    </div>
  );

  return (
    <div className="grid gap-6" data-testid="desk-turnaround">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Turnaround</h1>
        <p className="text-sm text-slate-600">
          How long completed requests took, in business time, with time spent waiting on the agency, carrier or insured taken out.
          Targets are internal: agencies don&rsquo;t see them.
        </p>
        {data && (
          <p className="text-xs text-slate-500 mt-1" data-testid="desk-turnaround-legend">
            Business hours only. A day (d) is one working day of {Math.round((day / 60) * 10) / 10} hours. On target is measured against the target set when the request arrived.
          </p>
        )}
      </div>

      <div className="flex flex-wrap gap-2 items-end" data-testid="desk-turnaround-filters">
        <select className={INPUT} value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="Period" data-testid="desk-turnaround-period">
          {PERIODS.map((d) => <option key={d} value={d}>Completed in the last {d} days</option>)}
        </select>
        <select className={INPUT} value={type} onChange={(e) => setType(e.target.value)} aria-label="Request type" data-testid="desk-turnaround-type">
          <option value="">All request types</option>
          {Object.entries(TASK_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select className={INPUT} value={agencyId} onChange={(e) => setAgencyId(e.target.value)} aria-label="Agency" data-testid="desk-turnaround-agency">
          <option value="">All agencies</option>
          {(data?.agencyChoices ?? []).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        {loading && <span className="text-sm text-slate-500">Loading…</span>}
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800" role="alert">
          {error} <button type="button" className="underline" onClick={() => setAttempt((n) => n + 1)}>Try again</button>
        </div>
      )}
      {data?.truncated && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800" role="status">
          Only the most recent requests are counted here. Choose a shorter period or a request type for the full figures.
        </p>
      )}

      <section className="grid grid-cols-2 sm:grid-cols-5 gap-3" aria-label="All completed requests">
        {figure('Completed', total ? String(total.completed) : '–', 'completed')}
        {figure('Typical (median)', total ? t(total.median) : '–', 'median')}
        {figure('Nine in ten within', total ? t(total.p90) : '–', 'p90')}
        {figure('On target', total ? onTargetLabel(total.met, total.withTarget) : '–', 'on-target', total ? shareTone(total.met, total.withTarget) : undefined)}
        {figure('Waiting, on average', total ? t(total.averageWaited) : '–', 'waited', 'text-slate-600')}
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <Table title="By pod" testId="desk-turnaround-pods" rows={data?.pods ?? []} t={t}
          label={(r) => <>{r.name}{r.isActive === false && <span className="text-xs text-slate-500"> (switched off)</span>}</>} />
        <Table title="By person" testId="desk-turnaround-people" rows={data?.people ?? []} t={t}
          label={(r) => <><span className="block">{r.name}{r.isActive === false && ' (deactivated)'}</span>
            {r.kind && <span className="block text-xs text-slate-500">{KIND_LABELS[r.kind]}</span>}</>} />
        <Table title="By agency" testId="desk-turnaround-agencies" rows={data?.agencies ?? []} t={t} label={(r) => r.name} />
        <Table title="By request type" testId="desk-turnaround-types" rows={data?.types ?? []} t={t} label={(r) => r.name} />
      </div>
    </div>
  );
}

function Table({ title, testId, rows, t, label }: {
  title: string; testId: string; rows: Row[]; t: (m: number | null) => string; label: (r: Row) => React.ReactNode;
}) {
  const cols = ['', 'Completed', 'Median', 'Average', 'Nine in ten', 'Waiting (avg)', 'On target'];
  return (
    <section className="border border-slate-200 rounded-xl bg-white overflow-hidden" data-testid={testId}>
      <h2 className="px-3 py-2 text-sm font-semibold text-slate-800 border-b border-slate-100">{title}</h2>
      <div className="overflow-x-auto max-h-96">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-slate-500"><tr>{cols.map((c, i) => <th key={i} className={`px-3 py-1.5 ${i ? 'text-right' : ''}`}>{c}</th>)}</tr></thead>
          <tbody>
            {!rows.length && <tr><td colSpan={cols.length} className="px-3 py-3 text-slate-500">No requests completed in this period.</td></tr>}
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-slate-100" data-testid={`${testId}-row`}>
                <td className="px-3 py-1.5">{label(r)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{r.completed}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{t(r.median)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{t(r.average)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{t(r.p90)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums text-slate-600">{t(r.averageWaited)}</td>
                <td className={`px-3 py-1.5 text-right tabular-nums ${shareTone(r.met, r.withTarget)}`}>{onTargetLabel(r.met, r.withTarget)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
