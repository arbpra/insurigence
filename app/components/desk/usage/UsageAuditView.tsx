'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { ApiError, api } from '@/components/desk/accounts/account-api';
import { allowanceCell, auditQuery, describeAction, monthLabel, type AuditQuery } from '@/lib/desk/usage-view';

interface Category {
  category: string; label: string; allowance: number | 'unlimited' | null;
  included: number; overage: number; overageUnbilled: number; nonBillable: number; pending: number; remaining: number | null;
}
interface AgencyRow {
  id: string; name: string; deskEnabled: boolean;
  plan: { name: string; monthlyPriceCents: number | null } | null;
  managedAccounts: { active: number; included: number | null };
  categories: Category[];
  totals: { included: number; overage: number; overageUnbilled: number; nonBillable: number; pending: number };
}
interface Usage {
  period: string; showsPrices: boolean; periods: string[]; timeZone: string; agencies: AgencyRow[];
  totals: { agencies: number; overAllowance: number; overageUnbilled: number; pending: number; noPlan: number };
}
interface AgencyTasks {
  agency: { id: string; name: string }; period: string; truncated: boolean;
  tasks: { id: string; reference: number; title: string | null; typeLabel: string; completedAt: string | null; category: string; units: number; billing: string; billingLabel: string; invoice: string | null }[];
}
interface AuditRow {
  id: string; at: string; action: string;
  actor: { id: string; name: string; email: string | null; role: string | null } | null;
  entityType: string; entityId: string | null; agency: { id: string; name: string } | null;
  metadata: unknown; ip: string | null; userAgent: string | null;
}
interface AuditPage {
  total: number; page: number; pageSize: number; rows: AuditRow[];
  choices: { actions: string[]; groups: string[]; agencies: { id: string; name: string }[] };
}

const INPUT = 'border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white min-w-0';
const SECONDARY = 'px-3 py-1.5 text-sm rounded-lg font-medium border border-slate-300 bg-white text-slate-700 disabled:opacity-50';
const errorText = (err: unknown) => (err instanceof ApiError ? err.message : 'Something went wrong. Try again.');
const money = (cents: number | null) => (cents === null ? 'Price set per agency' : `$${(cents / 100).toLocaleString('en-US')}/month`);
const when = (iso: string) => new Date(iso).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });

/** Service usage against plan allowances, and the audit log: Operations Managers only. */
export function UsageAuditView({ tabs }: { tabs: ('usage' | 'audit')[] }) {
  const params = useSearchParams();
  const asked = params.get('tab') === 'audit' ? 'audit' : 'usage';
  const [tab, setTab] = useState<'usage' | 'audit'>(tabs.includes(asked) ? asked : tabs[0]);
  const choose = (t: 'usage' | 'audit') => {
    setTab(t);
    window.history.replaceState(null, '', t === 'audit' ? '/desk-ops/usage?tab=audit' : '/desk-ops/usage');
  };
  return (
    <div className="grid gap-6" data-testid="desk-usage">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Usage &amp; audit</h1>
        <p className="text-sm text-slate-600">Each agency&rsquo;s monthly usage against its plan, and the record of everything done in The Desk.</p>
      </div>
      <div className="flex gap-2 border-b border-slate-200" role="tablist">
        {tabs.map((t) => (
          <button key={t} type="button" role="tab" aria-selected={tab === t} data-testid={`desk-usage-tab-${t}`} onClick={() => choose(t)}
            className={`px-3 py-2 text-sm font-medium -mb-px border-b-2 ${tab === t ? 'border-slate-800 text-slate-900' : 'border-transparent text-slate-500'}`}>
            {t === 'usage' ? 'Usage' : 'Audit log'}
          </button>
        ))}
      </div>
      {tab === 'usage' ? <UsageTab /> : <AuditTab />}
    </div>
  );
}

function UsageTab() {
  const [period, setPeriod] = useState('');
  const [data, setData] = useState<Usage | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<string | null>(null);
  const [detail, setDetail] = useState<AgencyTasks | null>(null);
  const [detailError, setDetailError] = useState('');

  useEffect(() => {
    let live = true;
    setLoading(true);
    setError('');
    api<Usage>(`/api/desk/usage${period ? `?period=${period}` : ''}`)
      .then((d) => { if (live) { setData(d); setOpen(null); setDetail(null); } })
      .catch((err) => { if (live) setError(errorText(err)); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [period]);

  async function toggle(id: string) {
    if (open === id) { setOpen(null); setDetail(null); return; }
    setOpen(id);
    setDetail(null);
    setDetailError('');
    try { setDetail(await api<AgencyTasks>(`/api/desk/usage/${id}?period=${data?.period ?? ''}`)); } catch (err) { setDetailError(errorText(err)); }
  }

  const categories = data?.agencies[0]?.categories.map((c) => c.label) ?? [];
  const figure = (label: string, value: number | undefined, id: string, tone = 'text-slate-900') => (
    <div className="border border-slate-200 rounded-xl bg-white px-4 py-3" data-testid={`desk-usage-total-${id}`}>
      <span className="block text-xs text-slate-500">{label}</span>
      <span className={`block text-2xl font-semibold ${tone}`}>{value ?? '–'}</span>
    </div>
  );

  return (
    <section className="grid gap-4" aria-label="Usage">
      <div className="flex flex-wrap gap-2 items-end">
        <select className={INPUT} value={data?.period ?? period} onChange={(e) => setPeriod(e.target.value)} aria-label="Month" data-testid="desk-usage-month">
          {(data?.periods ?? []).map((p) => <option key={p} value={p}>{monthLabel(p)}</option>)}
        </select>
        {loading && <span className="text-sm text-slate-500">Loading…</span>}
      </div>
      <p className="text-xs text-slate-500">
        Work counts toward the month it was completed in ({data?.timeZone ?? 'the Desk time zone'}). Usage is tracked here; invoicing is not part of The Desk yet.
        Managed accounts are the agency&rsquo;s active accounts today.
      </p>
      {error && <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800" role="alert">{error}</p>}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {figure('Agencies', data?.totals.agencies, 'agencies')}
        {figure('Over an allowance', data?.totals.overAllowance, 'over', 'text-red-700')}
        {figure('Overage units not yet invoiced', data?.totals.overageUnbilled, 'unbilled', 'text-amber-700')}
        {figure('Not yet classified', data?.totals.pending, 'pending', 'text-slate-600')}
      </div>

      <div className="overflow-x-auto border border-slate-200 rounded-xl bg-white">
        <table className="w-full text-sm" data-testid="desk-usage-agencies">
          <thead className="bg-slate-50 text-left text-xs text-slate-500">
            <tr>
              <th className="px-3 py-2">Agency</th><th className="px-3 py-2">Plan</th><th className="px-3 py-2 text-right">Managed accounts</th>
              {categories.map((c) => <th key={c} className="px-3 py-2 text-right">{c}</th>)}
              <th className="px-3 py-2 text-right">Non-billable</th>
            </tr>
          </thead>
          <tbody>
            {data && !data.agencies.length && <tr><td colSpan={4 + categories.length} className="px-3 py-3 text-slate-500">No agencies have The Desk switched on.</td></tr>}
            {(data?.agencies ?? []).map((a) => (
              <AgencyLine key={a.id} a={a} showsPrices={!!data?.showsPrices} open={open === a.id} onToggle={() => toggle(a.id)} detail={open === a.id ? detail : null} detailError={open === a.id ? detailError : ''} cols={4 + categories.length} />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function AgencyLine({ a, showsPrices, open, onToggle, detail, detailError, cols }: {
  a: AgencyRow; showsPrices: boolean; open: boolean; onToggle: () => void; detail: AgencyTasks | null; detailError: string; cols: number;
}) {
  const over = a.managedAccounts.included !== null && a.managedAccounts.active > a.managedAccounts.included;
  return (
    <>
      <tr className="border-t border-slate-100 align-top" data-testid="desk-usage-agency-row">
        <td className="px-3 py-2">
          <button type="button" className="text-left font-medium hover:underline" onClick={onToggle} aria-expanded={open}>{a.name}</button>
          {!a.deskEnabled && <span className="block text-xs text-slate-500">The Desk off</span>}
          {a.totals.pending > 0 && <span className="block text-xs text-amber-700">{a.totals.pending} not yet classified</span>}
        </td>
        <td className="px-3 py-2">{a.plan ? <><span className="block">{a.plan.name}</span>{showsPrices && <span className="block text-xs text-slate-500">{money(a.plan.monthlyPriceCents)}</span>}</> : <span className="text-amber-700">No plan</span>}</td>
        <td className={`px-3 py-2 text-right tabular-nums ${over ? 'text-red-700 font-medium' : ''}`}>
          {a.managedAccounts.active}{a.managedAccounts.included !== null ? ` of ${a.managedAccounts.included}` : ''}
        </td>
        {a.categories.map((c) => {
          const cell = allowanceCell(c);
          return (
            <td key={c.category} className="px-3 py-2 text-right tabular-nums" data-testid={`desk-usage-cell-${c.category}`}>
              <span className="block">{cell.used}</span>
              {cell.note && <span className={`block text-xs ${c.overage ? 'text-red-700 font-medium' : 'text-slate-500'}`}>{cell.note}</span>}
            </td>
          );
        })}
        <td className="px-3 py-2 text-right tabular-nums text-slate-600">{a.totals.nonBillable}</td>
      </tr>
      {open && (
        <tr className="bg-slate-50" data-testid="desk-usage-detail">
          <td colSpan={cols} className="px-3 py-3">
            {detailError && <p className="text-sm text-red-700" role="alert">{detailError}</p>}
            {!detail && !detailError && <p className="text-sm text-slate-500">Loading…</p>}
            {detail && (
              <div className="grid gap-2">
                {!detail.tasks.length && <p className="text-sm text-slate-500">Nothing completed this month.</p>}
                {detail.truncated && <p className="text-sm text-amber-700">Only the first {detail.tasks.length} are listed.</p>}
                {detail.tasks.length > 0 && (
                  <table className="w-full text-sm">
                    <thead className="text-left text-xs text-slate-500"><tr><th className="py-1">Request</th><th>Type</th><th>Counts toward</th><th>Completed</th><th className="text-right">Units</th><th>Billing</th></tr></thead>
                    <tbody>
                      {detail.tasks.map((t) => (
                        <tr key={t.id} className="border-t border-slate-200">
                          <td className="py-1">{t.title === null ? <span className="text-slate-500">#{t.reference} (restricted)</span> : <Link className="hover:underline" href={`/desk-ops/tasks/${t.id}`}>#{t.reference} {t.title}</Link>}</td>
                          <td>{t.typeLabel}</td><td>{t.category}</td><td>{t.completedAt ? when(t.completedAt) : '–'}</td>
                          <td className="text-right tabular-nums">{t.units}</td>
                          <td className={t.billing === 'OVERAGE' ? 'text-red-700' : t.billing === 'PENDING' ? 'text-amber-700' : ''}>
                            {t.billingLabel}{t.invoice && t.invoice !== 'UNBILLED' ? ` (${t.invoice.toLowerCase()})` : ''}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

const EMPTY: AuditQuery = { action: '', agencyId: '', actor: '', entityType: '', entityId: '', from: '', to: '', page: 1 };

function AuditTab() {
  const [draft, setDraft] = useState<AuditQuery>(EMPTY);
  const [query, setQuery] = useState<AuditQuery>(EMPTY);
  const [data, setData] = useState<AuditPage | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [shown, setShown] = useState<string | null>(null);
  const q = useMemo(() => auditQuery(query), [query]);

  useEffect(() => {
    let live = true;
    setLoading(true);
    setError('');
    api<AuditPage>(`/api/desk/audit${q ? `?${q}` : ''}`)
      .then((d) => { if (live) setData(d); })
      .catch((err) => { if (live) setError(errorText(err)); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [q]);

  const set = (k: keyof AuditQuery) => (e: { target: { value: string } }) => setDraft((d) => ({ ...d, [k]: e.target.value }));
  const lastPage = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const exportQ = auditQuery({ ...query, page: 1 });

  return (
    <section className="grid gap-4" aria-label="Audit log">
      <form className="flex flex-wrap gap-2 items-end" data-testid="desk-audit-filters" onSubmit={(e) => { e.preventDefault(); setQuery({ ...draft, page: 1 }); }}>
        <select className={INPUT} value={draft.action} onChange={set('action')} aria-label="Action" data-testid="desk-audit-action">
          <option value="">Any action</option>
          <optgroup label="Everything about">{(data?.choices.groups ?? []).map((g) => <option key={g} value={g}>{g}</option>)}</optgroup>
          <optgroup label="One action">{(data?.choices.actions ?? []).map((a) => <option key={a} value={a}>{describeAction(a)}</option>)}</optgroup>
        </select>
        <select className={INPUT} value={draft.agencyId} onChange={set('agencyId')} aria-label="Agency" data-testid="desk-audit-agency">
          <option value="">Any agency</option>
          {(data?.choices.agencies ?? []).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        <input className={`${INPUT} w-44`} placeholder="Who (name, email or system)" value={draft.actor} onChange={set('actor')} aria-label="Who" data-testid="desk-audit-actor" />
        <input className={`${INPUT} w-32`} placeholder="Record type" value={draft.entityType} onChange={set('entityType')} aria-label="Record type" />
        <input className={`${INPUT} w-56`} placeholder="Record id" value={draft.entityId} onChange={set('entityId')} aria-label="Record id" />
        <label className="text-xs text-slate-500">From<input type="date" className={`${INPUT} block`} value={draft.from} onChange={set('from')} data-testid="desk-audit-from" /></label>
        <label className="text-xs text-slate-500">To<input type="date" className={`${INPUT} block`} value={draft.to} onChange={set('to')} data-testid="desk-audit-to" /></label>
        <button type="submit" className={SECONDARY} data-testid="desk-audit-apply">Show</button>
        <button type="button" className={SECONDARY} onClick={() => { setDraft(EMPTY); setQuery(EMPTY); }}>Clear</button>
        <a className={SECONDARY} href={`/api/desk/audit?${exportQ ? `${exportQ}&` : ''}format=csv`} data-testid="desk-audit-export">Download CSV</a>
        {loading && <span className="text-sm text-slate-500">Loading…</span>}
      </form>
      <p className="text-xs text-slate-500">Newest first. Times in your browser&rsquo;s time zone; dates filter by the Desk time zone. Reading and downloading the log are recorded in it too. The download holds up to 5,000 entries.</p>
      {error && <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800" role="alert">{error}</p>}

      <div className="overflow-x-auto border border-slate-200 rounded-xl bg-white">
        <table className="w-full text-sm" data-testid="desk-audit-rows">
          <thead className="bg-slate-50 text-left text-xs text-slate-500">
            <tr><th className="px-3 py-2">When</th><th className="px-3 py-2">Who</th><th className="px-3 py-2">Action</th><th className="px-3 py-2">Record</th><th className="px-3 py-2">Agency</th><th className="px-3 py-2">From</th></tr>
          </thead>
          <tbody>
            {data && !data.rows.length && <tr><td colSpan={6} className="px-3 py-3 text-slate-500">Nothing matches.</td></tr>}
            {(data?.rows ?? []).map((r) => (
              <AuditLine key={r.id} r={r} open={shown === r.id} onToggle={() => setShown(shown === r.id ? null : r.id)} />
            ))}
          </tbody>
        </table>
      </div>
      {data && data.total > data.pageSize && (
        <div className="flex gap-2 items-center text-sm text-slate-600" data-testid="desk-audit-pages">
          <button type="button" className={SECONDARY} disabled={query.page <= 1} onClick={() => setQuery((x) => ({ ...x, page: x.page - 1 }))}>Newer</button>
          <span>Page {data.page} of {lastPage} ({data.total.toLocaleString('en-US')} entries)</span>
          <button type="button" className={SECONDARY} disabled={query.page >= lastPage} onClick={() => setQuery((x) => ({ ...x, page: x.page + 1 }))}>Older</button>
        </div>
      )}
    </section>
  );
}

function AuditLine({ r, open, onToggle }: { r: AuditRow; open: boolean; onToggle: () => void }) {
  return (
    <>
      <tr className="border-t border-slate-100 align-top" data-testid="desk-audit-row">
        <td className="px-3 py-2 whitespace-nowrap">{when(r.at)}</td>
        <td className="px-3 py-2">{r.actor ? <><span className="block">{r.actor.name}</span><span className="block text-xs text-slate-500">{r.actor.role ?? ''}</span></> : <span className="text-slate-500">System</span>}</td>
        <td className="px-3 py-2"><button type="button" className={`text-left hover:underline ${r.action === 'access.denied' ? 'text-red-700' : ''}`} onClick={onToggle} aria-expanded={open}>{describeAction(r.action)}</button></td>
        <td className="px-3 py-2"><span className="block">{r.entityType}</span>{r.entityId && <span className="block text-xs text-slate-500 font-mono">{r.entityId}</span>}</td>
        <td className="px-3 py-2">{r.agency?.name ?? '–'}</td>
        <td className="px-3 py-2 text-xs text-slate-500">{r.ip ?? '–'}</td>
      </tr>
      {open && (
        <tr className="bg-slate-50" data-testid="desk-audit-details">
          <td colSpan={6} className="px-3 py-2">
            <pre className="text-xs whitespace-pre-wrap break-all text-slate-700">{JSON.stringify(r.metadata ?? {}, null, 2)}</pre>
            {r.userAgent && <p className="text-xs text-slate-500 mt-1 break-all">Browser: {r.userAgent}</p>}
          </td>
        </tr>
      )}
    </>
  );
}
