'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import type { Dashboards } from '@/lib/desk/dashboards';
import { capacityLabel, qaLabel, qaShare } from '@/lib/desk/dashboards-view';
import { ON_TARGET_GOOD, ON_TARGET_POOR, formatBusinessMinutes, onTargetLabel, onTargetShare } from '@/lib/desk/turnaround-view';
import { allowanceCell, monthLabel } from '@/lib/desk/usage-view';
import { ApiError, api } from '@/components/desk/accounts/account-api';

type Virtual = NonNullable<Dashboards['virtual']>;
type Agency = NonNullable<Dashboards['agency']>;
type AllowanceRow = NonNullable<Virtual['allowances']>['agencies'][number];

const PERIODS = [7, 30, 90, 365];
const INPUT = 'border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white min-w-0';
const KIND_LABELS = { VA: 'VA', ACCOUNT_MANAGER: 'Account Manager', OTHER: 'Other' } as const;
const errorText = (err: unknown) => (err instanceof ApiError ? err.message : 'Something went wrong. Try again.');

function tone(share: number | null) {
  if (share === null) return 'text-slate-400';
  return share >= ON_TARGET_GOOD ? 'text-emerald-700' : share >= ON_TARGET_POOR ? 'text-amber-700' : 'text-red-700';
}
const targetTone = (d: { met: number; withTarget: number }) => tone(onTargetShare(d.met, d.withTarget));

function Figure({ label, value, id, className = 'text-slate-900' }: { label: string; value: string; id: string; className?: string }) {
  return (
    <div className="border border-slate-200 rounded-xl bg-white px-4 py-3" data-testid={`desk-dash-${id}`}>
      <span className="block text-xs text-slate-500">{label}</span>
      <span className={`block text-2xl font-semibold ${className}`}>{value}</span>
    </div>
  );
}

interface Col<R> { head: string; cell: (r: R) => React.ReactNode; left?: boolean; className?: (r: R) => string }

function Table<R extends { id: string }>({ title, testId, rows, cols, empty }: { title: string; testId: string; rows: R[]; cols: Col<R>[]; empty: string }) {
  return (
    <section className="border border-slate-200 rounded-xl bg-white overflow-hidden" data-testid={testId}>
      <h3 className="px-3 py-2 text-sm font-semibold text-slate-800 border-b border-slate-100">{title}</h3>
      <div className="overflow-x-auto max-h-[28rem]">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-slate-500">
            <tr>{cols.map((c, i) => <th key={i} className={`px-3 py-1.5 whitespace-nowrap ${c.left ? '' : 'text-right'}`}>{c.head}</th>)}</tr>
          </thead>
          <tbody>
            {!rows.length && <tr><td colSpan={cols.length} className="px-3 py-3 text-slate-500">{empty}</td></tr>}
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-slate-100" data-testid={`${testId}-row`}>
                {cols.map((c, i) => <td key={i} className={`px-3 py-1.5 ${c.left ? '' : 'text-right tabular-nums'} ${c.className?.(r) ?? ''}`}>{c.cell(r)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/** The department dashboards: Virtual Operations, Agency Operations, or both (the COO). */
export function DepartmentDashboards() {
  const params = useSearchParams();
  const [days, setDays] = useState(() => (PERIODS.includes(Number(params.get('days'))) ? Number(params.get('days')) : 30));
  const [data, setData] = useState<Dashboards | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const query = days === 30 ? '' : `?days=${days}`;
    window.history.replaceState(null, '', `/desk-ops/dashboards${query}`);
    let live = true;
    setLoading(true);
    setError('');
    api<Dashboards>(`/api/desk/dashboards${query}`)
      .then((d) => { if (live) setData(d); })
      .catch((err) => { if (live) setError(errorText(err)); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [days, attempt]);

  const t = (m: number | null) => formatBusinessMinutes(m, data?.calendar.workdayMinutes ?? 480);

  return (
    <div className="grid gap-8" data-testid="desk-dashboards">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Dashboards</h1>
        <p className="text-sm text-slate-600">
          Open work as it stands now; completed work, targets and QA for the period chosen. Counted as on the Workload and Turnaround pages.
          Prices and contract amounts are never shown here.
        </p>
      </div>
      <div className="flex flex-wrap gap-2 items-end">
        <select className={INPUT} value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="Period" data-testid="desk-dash-period">
          {PERIODS.map((d) => <option key={d} value={d}>The last {d} days</option>)}
        </select>
        {loading && <span className="text-sm text-slate-500">Loading…</span>}
      </div>
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800" role="alert">
          {error} <button type="button" className="underline" onClick={() => setAttempt((n) => n + 1)}>Try again</button>
        </div>
      )}
      {data?.virtual && <VirtualOps v={data.virtual} t={t} />}
      {data?.agency && <AgencyOps a={data.agency} t={t} />}
    </div>
  );
}

function Partial({ shown }: { shown: boolean }) {
  if (!shown) return null;
  return (
    <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800" role="status">
      Only the most recent completed requests are counted. Choose a shorter period for the full figures.
    </p>
  );
}

function VirtualOps({ v, t }: { v: Virtual; t: (m: number | null) => string }) {
  const d = v.total.done;
  return (
    <section className="grid gap-4" data-testid="desk-dash-virtual" aria-label="Virtual Operations">
      <div>
        <h2 className="text-lg font-semibold text-slate-900">Virtual Operations</h2>
        <p className="text-sm text-slate-600" data-testid="desk-dash-virtual-reach">
          {v.reach === 'LED_PODS' ? 'The pods you lead, in every agency that authorises them.' : 'Every pod.'}
        </p>
      </div>
      <Partial shown={v.truncated} />
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
        <Figure label="Open" value={String(v.total.open)} id="v-open" />
        <Figure label="Unassigned" value={String(v.total.unassigned)} id="v-unassigned" />
        <Figure label="Overdue" value={String(v.total.overdue)} id="v-overdue" className={v.total.overdue ? 'text-red-700' : 'text-slate-900'} />
        <Figure label="Escalated" value={String(v.total.escalated)} id="v-escalated" />
        <Figure label="Completed" value={String(d.completed)} id="v-completed" />
        <Figure label="On target" value={onTargetLabel(d.met, d.withTarget)} id="v-on-target" className={targetTone(d)} />
        <Figure label="QA" value={qaLabel(v.total.qa)} id="v-qa" className={tone(qaShare(v.total.qa))} />
        <Figure label="In QA review" value={String(v.total.qa.inReview)} id="v-in-review" />
      </div>
      <p className="text-sm text-slate-600" data-testid="desk-dash-capacity">
        <span className="font-medium text-slate-800">Capacity:</span> {v.capacity.people} people in the pods,{' '}
        {v.capacity.openPerPerson ?? 0} open each on average, the busiest holding {v.capacity.busiest}; {v.capacity.idle} with no open work.
      </p>
      <Table title="Pods" testId="desk-dash-pods" rows={v.pods} empty="No pods yet." cols={[
        { head: '', left: true, cell: (p) => <>{p.name}{!p.isActive && <span className="text-xs text-slate-500"> (switched off)</span>}</> },
        { head: 'Open', cell: (p) => p.open },
        { head: 'Unassigned', cell: (p) => p.unassigned },
        { head: 'Overdue', cell: (p) => p.overdue, className: (p) => (p.overdue ? 'text-red-700' : '') },
        { head: 'Waiting', cell: (p) => p.waiting },
        { head: 'Escalated', cell: (p) => p.escalated },
        { head: 'Completed', cell: (p) => p.done.completed },
        { head: 'Median', cell: (p) => t(p.done.median) },
        { head: 'On target', cell: (p) => onTargetLabel(p.done.met, p.done.withTarget), className: (p) => targetTone(p.done) },
        { head: 'QA', cell: (p) => qaLabel(p.qa), className: (p) => tone(qaShare(p.qa)) },
        { head: 'Capacity', cell: (p) => capacityLabel(p.capacity) },
      ]} />
      <Table title="People" testId="desk-dash-people" rows={v.people} empty="Nobody in these pods yet." cols={[
        { head: '', left: true, cell: (p) => <><span className="block">{p.name}{!p.isActive && ' (deactivated)'}</span>
          <span className="block text-xs text-slate-500">{KIND_LABELS[p.kind]}{p.pods.length ? ` · ${p.pods.join(', ')}` : ''}</span></> },
        { head: 'Open', cell: (p) => p.open },
        { head: 'Overdue', cell: (p) => p.overdue, className: (p) => (p.overdue ? 'text-red-700' : '') },
        { head: 'Escalated', cell: (p) => p.escalated },
        { head: 'Completed', cell: (p) => p.done.completed },
        { head: 'Median', cell: (p) => t(p.done.median) },
        { head: 'On target', cell: (p) => onTargetLabel(p.done.met, p.done.withTarget), className: (p) => targetTone(p.done) },
        { head: 'QA', cell: (p) => qaLabel(p.qa), className: (p) => tone(qaShare(p.qa)) },
        { head: 'Sent back', cell: (p) => p.qa.sentBack },
      ]} />
      {v.allowances && (
        <Table title={`Allowances, ${monthLabel(v.allowances.period)} (read-only)`} testId="desk-dash-allowances" rows={v.allowances.agencies} empty="No agencies with The Desk yet." cols={[
          { head: '', left: true, cell: (a) => <><span className="block">{a.name}</span><span className="block text-xs text-slate-500">{a.plan ?? 'No plan yet'}</span></> },
          ...(v.allowances.agencies[0]?.categories ?? []).map((c0, i): Col<AllowanceRow> => ({
            head: c0.label, left: true,
            cell: (a) => {
              const cell = allowanceCell(a.categories[i]);
              return <><span className="block tabular-nums">{cell.used}</span>{cell.note && <span className="block text-xs text-slate-500">{cell.note}</span>}</>;
            },
          })),
        ]} />
      )}
    </section>
  );
}

function AgencyOps({ a, t }: { a: Agency; t: (m: number | null) => string }) {
  const d = a.total.done;
  return (
    <section className="grid gap-4" data-testid="desk-dash-agency" aria-label="Agency Operations">
      <div>
        <h2 className="text-lg font-semibold text-slate-900">Agency Operations</h2>
        <p className="text-sm text-slate-600" data-testid="desk-dash-agency-reach">
          {a.reach === 'IN_REACH' ? 'Your agencies and those of the Account Managers who report to you.' : 'Every agency with The Desk on.'}
        </p>
      </div>
      <Partial shown={a.truncated} />
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
        <Figure label="Agencies" value={String(a.total.agencies)} id="a-agencies" />
        <Figure label="Open" value={String(a.total.open)} id="a-open" />
        <Figure label="Overdue" value={String(a.total.overdue)} id="a-overdue" className={a.total.overdue ? 'text-red-700' : 'text-slate-900'} />
        <Figure label="Waiting on the agency" value={String(a.total.waitingOnAgency)} id="a-waiting" />
        <Figure label="Completed" value={String(d.completed)} id="a-completed" />
        <Figure label="On target" value={onTargetLabel(d.met, d.withTarget)} id="a-on-target" className={targetTone(d)} />
        <Figure label="Typical time (median)" value={t(d.median)} id="a-median" />
      </div>
      <div className="border border-slate-200 rounded-xl bg-white px-4 py-3 text-sm text-slate-700" data-testid="desk-dash-awaiting">
        <span className="font-medium text-slate-800">Awaiting a decision:</span> {a.awaiting.inReview} in QA review, {a.awaiting.escalated} escalated
        {a.awaiting.billing !== null && <>, {a.awaiting.billing} completed {a.awaiting.billing === 1 ? 'unit' : 'units'} awaiting a billing decision (<Link className="underline" href="/desk-ops/usage">Usage</Link>)</>}.
        {a.utilization && <> This month: {a.utilization.overAllowance} {a.utilization.overAllowance === 1 ? 'agency' : 'agencies'} over an allowance, {a.utilization.noPlan} without a plan.</>}
      </div>
      <Table title="Account Managers" testId="desk-dash-managers" rows={a.managers} empty="No agencies in reach." cols={[
        { head: '', left: true, cell: (m) => <>{m.name}{!m.isActive && ' (deactivated)'}</> },
        { head: 'Agencies', cell: (m) => m.agencies },
        { head: 'Open', cell: (m) => m.open },
        { head: 'Overdue', cell: (m) => m.overdue, className: (m) => (m.overdue ? 'text-red-700' : '') },
        { head: 'Escalated', cell: (m) => m.escalated },
        { head: 'Waiting on agency', cell: (m) => m.waitingOnAgency },
        { head: 'In QA review', cell: (m) => m.inReview },
        { head: 'Completed', cell: (m) => m.done.completed },
        { head: 'Median', cell: (m) => t(m.done.median) },
        { head: 'On target', cell: (m) => onTargetLabel(m.done.met, m.done.withTarget), className: (m) => targetTone(m.done) },
      ]} />
      <Table title="Agencies" testId="desk-dash-agencies" rows={a.agencies} empty="No agencies in reach." cols={[
        { head: '', left: true, cell: (r) => <><span className="block">{r.name}</span><span className="block text-xs text-slate-500">{r.am ? r.am.name : 'No Account Manager'}</span></> },
        { head: 'Open', cell: (r) => r.open },
        { head: 'Overdue', cell: (r) => r.overdue, className: (r) => (r.overdue ? 'text-red-700' : '') },
        { head: 'Escalated', cell: (r) => r.escalated },
        { head: 'Waiting on agency', cell: (r) => r.waitingOnAgency },
        { head: 'Completed', cell: (r) => r.done.completed },
        { head: 'On target', cell: (r) => onTargetLabel(r.done.met, r.done.withTarget), className: (r) => targetTone(r.done) },
        ...(a.utilization ? [{
          head: 'This month', left: true,
          cell: (r: Agency['agencies'][number]) => !r.usage ? '–' : (
            <><span className="block">{r.usage.plan ?? 'No plan yet'}</span>
              <span className="block text-xs text-slate-500">{r.usage.included} included{r.usage.overage ? ` · +${r.usage.overage} over` : ''}{r.usage.pending ? ` · ${r.usage.pending} not yet classified` : ''}</span></>
          ),
        }] : []),
      ]} />
    </section>
  );
}
