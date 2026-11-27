'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import type { TaskStatus } from '@prisma/client';
import { STATUS_LABELS } from '@/lib/desk/task-statuses';
import { PRIORITY_BADGE, dueLabel, type DueTone } from '@/lib/desk/queue-view';
import {
  EMPTY_WORKLOAD_FILTERS, WORKLOAD_SORTS, bulkSummary, hasWorkloadFilters, parseWorkloadFilters,
  workloadApiQuery, workloadPageQuery, type WorkloadFilters, type WorkloadSort,
} from '@/lib/desk/workload-view';
import { ApiError, api } from '@/components/desk/accounts/account-api';

interface Counts { open: number; unassigned: number; overdue: number; waiting: number; escalated: number }
interface Row {
  id: string; reference: number; title: string; typeLabel: string; priority: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
  status: TaskStatus; statusLabel: string;
  agency: { id: string; name: string }; insured: { id: string; name: string } | null;
  pod: { id: string; name: string } | null; assignee: { id: string; name: string } | null;
  dueAt: string | null; waitingSince: string | null; completedAt: string | null;
  escalated: boolean; escalationReason: string | null;
  parent: { id: string; reference: number } | null; followUp: boolean;
}
interface Workload {
  reach: 'ALL' | 'LED_PODS';
  total: Counts;
  pods: ({ id: string; name: string; isActive: boolean } & Counts)[];
  people: ({ id: string; name: string; kind: 'VA' | 'ACCOUNT_MANAGER' | 'OTHER'; isActive: boolean; pods: string[] } & Counts)[];
  agencies: ({ id: string; name: string; deskEnabled: boolean } & Counts)[];
  list: { total: number; page: number; pageSize: number; rows: Row[] };
  alertCheck: { lastRun: { at: string; sent: number; failed: number; error: string | null } | null; scheduled: boolean } | null;
}
interface Person { id: string; name: string; kind: 'VA' | 'ACCOUNT_MANAGER'; lead: boolean; openTasks: number }
type Action =
  | { kind: 'assign'; taskId: string; people: Person[] | null; error: string }
  | { kind: 'pod'; taskId: string }
  | { kind: 'escalate'; taskId: string; reason: string };

const INPUT = 'border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white min-w-0';
const BUTTON = 'px-3 py-1.5 text-sm rounded-lg font-medium disabled:opacity-50';
const SECONDARY = `${BUTTON} border border-slate-300 bg-white text-slate-700`;
const PRIMARY = `${BUTTON} text-white`;
const ACCENT = 'var(--brand-primary, #05314c)';
const SEARCH_DELAY_MS = 300;
const KIND_LABELS = { VA: 'VA', ACCOUNT_MANAGER: 'Account Manager', OTHER: 'Other' } as const;
const TONE: Record<DueTone, string> = {
  overdue: 'text-red-700 font-medium', soon: 'text-amber-700 font-medium', normal: 'text-slate-600',
  waiting: 'text-slate-500', none: 'text-slate-400', closed: 'text-slate-500',
};

const errorText = (err: unknown) => (err instanceof ApiError ? err.message : 'Something went wrong. Try again.');

/** All work across agencies and pods, for Operations Managers: who has what, and changes to it. */
export function WorkloadView() {
  const params = useSearchParams();
  const address = params.toString();
  const filters = useMemo(() => parseWorkloadFilters(new URLSearchParams(address)), [address]);
  const [data, setData] = useState<Workload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [actionError, setActionError] = useState('');
  const [busy, setBusy] = useState(false);
  const [action, setAction] = useState<Action | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkPerson, setBulkPerson] = useState('');
  const [bulkPod, setBulkPod] = useState('');
  const [search, setSearch] = useState(filters.q);
  const [attempt, setAttempt] = useState(0);
  const sentSearch = useRef(filters.q);
  const now = useMemo(() => new Date(), [data]); // eslint-disable-line react-hooks/exhaustive-deps

  const go = useCallback((next: Partial<WorkloadFilters>) => {
    const query = workloadPageQuery({ ...filters, page: 1, ...next });
    window.history.replaceState(null, '', query ? `/desk-ops/workload?${query}` : '/desk-ops/workload');
  }, [filters]);

  useEffect(() => {
    let live = true;
    setLoading(true);
    setError('');
    api<Workload>(`/api/desk/workload?${workloadApiQuery(filters)}`)
      .then((d) => { if (live) { setData(d); setSelected(new Set()); } })
      .catch((err) => { if (live) setError(errorText(err)); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [filters, attempt]);

  // The search box waits for a pause in typing before it changes the address.
  useEffect(() => {
    if (search === sentSearch.current) return;
    const t = setTimeout(() => { sentSearch.current = search; go({ q: search }); }, SEARCH_DELAY_MS);
    return () => clearTimeout(t);
  }, [search, go]);

  const refresh = () => setAttempt((n) => n + 1);
  const done = (text: string) => { setNotice(text); setActionError(''); setAction(null); refresh(); };

  async function run(fn: () => Promise<string>) {
    setBusy(true);
    setActionError('');
    setNotice('');
    try { done(await fn()); } catch (err) { setActionError(errorText(err)); } finally { setBusy(false); }
  }

  async function openAssign(taskId: string) {
    setAction({ kind: 'assign', taskId, people: null, error: '' });
    try {
      const r = await api<{ people: Person[] }>(`/api/desk/tasks/${taskId}/assignees`);
      setAction((a) => (a?.kind === 'assign' && a.taskId === taskId ? { ...a, people: r.people } : a));
    } catch (err) {
      setAction((a) => (a?.kind === 'assign' && a.taskId === taskId ? { ...a, people: [], error: errorText(err) } : a));
    }
  }

  const post = (url: string, body: unknown) => api<{ reference?: number }>(url, { method: 'POST', body: JSON.stringify(body) });
  const assign = (row: Row, assigneeId: string | null) => run(async () => {
    await post(`/api/desk/tasks/${row.id}/assign`, { assigneeId });
    return assigneeId ? `#${row.reference} reassigned.` : `#${row.reference} is back in the queue.`;
  });
  const movePod = (row: Row, podId: string) => run(async () => {
    await post(`/api/desk/tasks/${row.id}/pod`, { podId });
    return `#${row.reference} moved.`;
  });
  const escalate = (row: Row, escalateIt: boolean, reason: string) => run(async () => {
    await post(`/api/desk/tasks/${row.id}/escalation`, { escalate: escalateIt, reason });
    return escalateIt ? `#${row.reference} escalated.` : `#${row.reference}: escalation cleared.`;
  });
  const bulk = (body: Record<string, unknown>, verb: string) => run(async () => {
    const r = await api<{ done: { reference: number }[]; failed: { reference: number | null; message: string }[] }>(
      '/api/desk/workload/bulk', { method: 'POST', body: JSON.stringify({ taskIds: [...selected], ...body }) });
    return bulkSummary(r, verb);
  });

  const rows = data?.list.rows ?? [];
  const activePods = (data?.pods ?? []).filter((p) => p.isActive && p.id !== 'none');
  const assignable = (data?.people ?? []).filter((p) => p.isActive && p.kind !== 'OTHER');
  const lastPage = data ? Math.max(1, Math.ceil(data.list.total / data.list.pageSize)) : 1;
  const allChosen = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  // A figure with filters behind it opens them; Waiting has none, since several statuses wait.
  const figure = (label: string, value: number | undefined, next: Partial<WorkloadFilters> | null, id: string, tone = 'text-slate-900') => {
    const inner = <><span className="block text-xs text-slate-500">{label}</span><span className={`block text-2xl font-semibold ${tone}`}>{value ?? '–'}</span></>;
    const box = 'text-left border border-slate-200 rounded-xl bg-white px-4 py-3';
    return next
      ? <button type="button" onClick={() => go({ ...EMPTY_WORKLOAD_FILTERS, ...next })} data-testid={`desk-workload-total-${id}`} className={`${box} hover:border-slate-400`}>{inner}</button>
      : <div className={box} data-testid={`desk-workload-total-${id}`}>{inner}</div>;
  };

  return (
    <div className="grid gap-6" data-testid="desk-workload">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Workload</h1>
        <p className="text-sm text-slate-600" data-testid="desk-workload-reach">
          {data?.reach === 'LED_PODS' ? 'Open work in the pods you lead.' : 'All open work across agencies and pods.'} Choose a figure or a row to see the tasks behind it.
        </p>
        {data?.alertCheck && <AlertCheckLine check={data.alertCheck} />}
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800" role="alert">
          {error} <button type="button" className="underline" onClick={refresh}>Try again</button>
        </div>
      )}

      <section className="grid grid-cols-2 sm:grid-cols-5 gap-3" aria-label="Open work">
        {figure('Open', data?.total.open, {}, 'open')}
        {figure('Nobody has it', data?.total.unassigned, { assignee: 'none' }, 'unassigned')}
        {figure('Overdue', data?.total.overdue, { overdue: true }, 'overdue', 'text-red-700')}
        {figure('Waiting', data?.total.waiting, null, 'waiting', 'text-slate-600')}
        {figure('Escalated', data?.total.escalated, { escalated: true }, 'escalated', 'text-amber-700')}
      </section>

      <div className="grid gap-6 lg:grid-cols-3">
        <Table title="By pod" testId="desk-workload-pods" cols={['Pod', 'Open', 'Nobody has it', 'Overdue', 'Escalated']}
          rows={(data?.pods ?? []).map((p) => ({
            id: p.id, chosen: filters.podId === p.id, onPick: () => go({ podId: filters.podId === p.id ? '' : p.id }),
            cells: [<>{p.name}{!p.isActive && <span className="text-xs text-slate-500"> (switched off)</span>}</>, p.open, p.unassigned, p.overdue, p.escalated],
          }))} />
        <Table title="By person" testId="desk-workload-people" cols={['Person', 'Open', 'Overdue', 'Escalated']}
          rows={(data?.people ?? []).map((p) => ({
            id: p.id, chosen: filters.assignee === p.id, onPick: () => go({ assignee: filters.assignee === p.id ? '' : p.id }),
            cells: [
              <><span className="block">{p.name}{!p.isActive && ' (deactivated)'}</span>
                <span className="block text-xs text-slate-500">{KIND_LABELS[p.kind]}{p.pods.length ? ` · ${p.pods.join(', ')}` : ''}</span></>,
              p.open, p.overdue, p.escalated,
            ],
          }))} />
        <Table title="By agency" testId="desk-workload-agencies" cols={['Agency', 'Open', 'Overdue', 'Escalated']}
          rows={(data?.agencies ?? []).map((a) => ({
            id: a.id, chosen: filters.agencyId === a.id, onPick: () => go({ agencyId: filters.agencyId === a.id ? '' : a.id }),
            cells: [<>{a.name}{!a.deskEnabled && <span className="text-xs text-slate-500"> (The Desk off)</span>}</>, a.open, a.overdue, a.escalated],
          }))} />
      </div>

      <section className="grid gap-3" aria-label="Tasks">
        <div className="flex flex-wrap gap-2 items-end" data-testid="desk-workload-filters">
          <input className={`${INPUT} w-56`} placeholder="Search title, account or #number" value={search}
            onChange={(e) => setSearch(e.target.value)} aria-label="Search" data-testid="desk-workload-search" />
          <select className={INPUT} value={filters.podId} onChange={(e) => go({ podId: e.target.value })} aria-label="Pod" data-testid="desk-workload-pod">
            <option value="">All pods</option>
            {(data?.pods ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <select className={INPUT} value={filters.assignee} onChange={(e) => go({ assignee: e.target.value })} aria-label="Person" data-testid="desk-workload-person">
            <option value="">Anyone</option>
            <option value="none">Nobody has it</option>
            {(data?.people ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <select className={INPUT} value={filters.agencyId} onChange={(e) => go({ agencyId: e.target.value })} aria-label="Agency" data-testid="desk-workload-agency">
            <option value="">All agencies</option>
            {(data?.agencies ?? []).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
          <select className={INPUT} value={filters.status} onChange={(e) => go({ status: e.target.value as TaskStatus | '' })} aria-label="Status" data-testid="desk-workload-status">
            <option value="">Any status</option>
            {(Object.keys(STATUS_LABELS) as TaskStatus[]).map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
          </select>
          <label className="text-sm text-slate-700 flex items-center gap-1"><input type="checkbox" checked={filters.overdue} onChange={(e) => go({ overdue: e.target.checked })} /> Overdue</label>
          <label className="text-sm text-slate-700 flex items-center gap-1"><input type="checkbox" checked={filters.escalated} onChange={(e) => go({ escalated: e.target.checked })} data-testid="desk-workload-escalated" /> Escalated</label>
          <label className="text-sm text-slate-700 flex items-center gap-1"><input type="checkbox" checked={filters.closed} onChange={(e) => go({ closed: e.target.checked })} /> Include closed</label>
          <select className={INPUT} value={filters.sort} onChange={(e) => go({ sort: e.target.value as WorkloadSort })} aria-label="Sort">
            {(Object.keys(WORKLOAD_SORTS) as WorkloadSort[]).map((s) => <option key={s} value={s}>{WORKLOAD_SORTS[s]}</option>)}
          </select>
          {hasWorkloadFilters(filters) && (
            <button type="button" className={SECONDARY} onClick={() => { setSearch(''); sentSearch.current = ''; go(EMPTY_WORKLOAD_FILTERS); }}>Clear filters</button>
          )}
        </div>

        {notice && <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-800" role="status" data-testid="desk-workload-notice">{notice}</p>}
        {actionError && <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800" role="alert" data-testid="desk-workload-error">{actionError}</p>}

        {selected.size > 0 && (
          <div className="flex flex-wrap gap-2 items-center rounded-lg border border-slate-300 bg-slate-50 px-3 py-2" data-testid="desk-workload-bulk">
            <span className="text-sm font-medium text-slate-800">{selected.size} chosen</span>
            <select className={INPUT} value={bulkPerson} onChange={(e) => setBulkPerson(e.target.value)} aria-label="Assign the chosen tasks to" data-testid="desk-workload-bulk-person">
              <option value="">Assign to…</option>
              <option value="none">Nobody: back to the queue</option>
              {assignable.map((p) => <option key={p.id} value={p.id}>{p.name} ({KIND_LABELS[p.kind]}, {p.open} open)</option>)}
            </select>
            <button type="button" className={SECONDARY} disabled={busy || !bulkPerson} data-testid="desk-workload-bulk-assign"
              onClick={() => bulk({ assigneeId: bulkPerson === 'none' ? null : bulkPerson }, bulkPerson === 'none' ? 'Returned' : 'Reassigned')}>Assign</button>
            <select className={INPUT} value={bulkPod} onChange={(e) => setBulkPod(e.target.value)} aria-label="Move the chosen tasks to" data-testid="desk-workload-bulk-pod">
              <option value="">Move to pod…</option>
              {activePods.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <button type="button" className={SECONDARY} disabled={busy || !bulkPod} data-testid="desk-workload-bulk-move"
              onClick={() => bulk({ podId: bulkPod }, 'Moved')}>Move</button>
            <button type="button" className="text-sm underline text-slate-600" onClick={() => setSelected(new Set())}>Clear</button>
          </div>
        )}

        <div className="overflow-x-auto border border-slate-200 rounded-xl bg-white">
          <table className="w-full text-sm" data-testid="desk-workload-tasks">
            <thead className="bg-slate-50 text-left text-xs text-slate-500">
              <tr>
                <th className="px-3 py-2 w-8">
                  <input type="checkbox" aria-label="Choose every task on this page" checked={allChosen}
                    onChange={() => setSelected(allChosen ? new Set() : new Set(rows.map((r) => r.id)))} />
                </th>
                <th className="px-3 py-2">Task</th><th className="px-3 py-2">Agency</th><th className="px-3 py-2">Pod</th>
                <th className="px-3 py-2">Who has it</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Due</th><th className="px-3 py-2">Change</th>
              </tr>
            </thead>
            <tbody>
              {!loading && !rows.length && (
                <tr><td colSpan={8} className="px-3 py-6 text-center text-slate-500" data-testid="desk-workload-empty">
                  {hasWorkloadFilters(filters) ? 'No tasks match these filters.' : 'No open work.'}
                </td></tr>
              )}
              {rows.map((row) => {
                const due = dueLabel(row, now);
                const open = row.status !== 'COMPLETED' && row.status !== 'CANCELLED';
                const mine = action && action.taskId === row.id ? action : null;
                return (
                  <tr key={row.id} className="border-t border-slate-100 align-top" data-testid="desk-workload-row">
                    <td className="px-3 py-2">
                      <input type="checkbox" aria-label={`Choose #${row.reference}`} checked={selected.has(row.id)} disabled={!open} onChange={() => toggle(row.id)} />
                    </td>
                    <td className="px-3 py-2 min-w-[14rem]">
                      <Link href={`/desk-ops/tasks/${row.id}`} className="font-medium text-slate-900 hover:underline">#{row.reference} {row.title}</Link>
                      <span className="block text-xs text-slate-500">
                        {row.parent && <>{row.followUp ? 'Follow-up to' : 'Subtask of'} #{row.parent.reference} · </>}
                        {row.typeLabel}{row.insured ? ` · ${row.insured.name}` : ''}
                        {PRIORITY_BADGE[row.priority] && <span className="ml-1 text-red-700">{PRIORITY_BADGE[row.priority]}</span>}
                      </span>
                      {row.escalated && (
                        <span className="block text-xs text-amber-800 mt-0.5" data-testid="desk-workload-escalation">
                          Escalated{row.escalationReason ? `: ${row.escalationReason}` : ''}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2">{row.agency.name}</td>
                    <td className="px-3 py-2">{row.pod?.name ?? <span className="text-amber-700">No pod yet</span>}</td>
                    <td className="px-3 py-2">{row.assignee?.name ?? <span className="text-slate-500">Nobody</span>}</td>
                    <td className="px-3 py-2">{row.statusLabel}</td>
                    <td className={`px-3 py-2 ${TONE[due.tone]}`}>{due.text}</td>
                    <td className="px-3 py-2 min-w-[11rem]">
                      {open && !mine && (
                        <div className="flex flex-wrap gap-1">
                          <button type="button" className={SECONDARY} disabled={busy} onClick={() => openAssign(row.id)} data-testid="desk-workload-reassign">Reassign</button>
                          <button type="button" className={SECONDARY} disabled={busy} onClick={() => setAction({ kind: 'pod', taskId: row.id })} data-testid="desk-workload-move">Move</button>
                          {row.escalated
                            ? <button type="button" className={SECONDARY} disabled={busy} onClick={() => escalate(row, false, '')} data-testid="desk-workload-deescalate">Clear escalation</button>
                            : <button type="button" className={SECONDARY} disabled={busy} onClick={() => setAction({ kind: 'escalate', taskId: row.id, reason: '' })} data-testid="desk-workload-escalate">Escalate</button>}
                        </div>
                      )}
                      {mine?.kind === 'assign' && (
                        <div className="grid gap-1" data-testid="desk-workload-assign-picker">
                          {mine.people === null && <span className="text-slate-500">Finding who can take it…</span>}
                          {mine.error && <span className="text-red-700">{mine.error}</span>}
                          {mine.people && !mine.people.length && !mine.error && <span className="text-slate-500">Nobody is authorised for this agency in its pod.</span>}
                          {mine.people?.map((p) => (
                            <button key={p.id} type="button" className={`${SECONDARY} text-left`} disabled={busy || p.id === row.assignee?.id} onClick={() => assign(row, p.id)}>
                              {p.name} <span className="text-xs text-slate-500">({KIND_LABELS[p.kind]}{p.lead ? ', lead' : ''}, {p.openTasks} open)</span>
                            </button>
                          ))}
                          {row.assignee && <button type="button" className={SECONDARY} disabled={busy} onClick={() => assign(row, null)}>Back to the queue</button>}
                          <button type="button" className="text-xs underline text-slate-600 text-left" onClick={() => setAction(null)}>Cancel</button>
                        </div>
                      )}
                      {mine?.kind === 'pod' && (
                        <div className="grid gap-1" data-testid="desk-workload-pod-picker">
                          {activePods.filter((p) => p.id !== row.pod?.id).map((p) => (
                            <button key={p.id} type="button" className={`${SECONDARY} text-left`} disabled={busy} onClick={() => movePod(row, p.id)}>{p.name}</button>
                          ))}
                          {row.assignee && <span className="text-xs text-slate-500">If {row.assignee.name} can&apos;t work it there, it goes back to that pod&apos;s queue.</span>}
                          <button type="button" className="text-xs underline text-slate-600 text-left" onClick={() => setAction(null)}>Cancel</button>
                        </div>
                      )}
                      {mine?.kind === 'escalate' && (
                        <form className="grid gap-1" data-testid="desk-workload-escalate-form"
                          onSubmit={(e) => { e.preventDefault(); escalate(row, true, mine.reason); }}>
                          <textarea className={INPUT} rows={2} maxLength={500} placeholder="Why does it need a manager?" value={mine.reason} aria-label="Reason"
                            onChange={(e) => setAction({ ...mine, reason: e.target.value })} data-testid="desk-workload-escalate-reason" />
                          <span className="text-xs text-slate-500">Internal: the agency and VAs don&apos;t see the reason.</span>
                          <div className="flex gap-1">
                            <button type="submit" className={PRIMARY} style={{ background: ACCENT }} disabled={busy || !mine.reason.trim()}>Escalate</button>
                            <button type="button" className={SECONDARY} onClick={() => setAction(null)}>Cancel</button>
                          </div>
                        </form>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between text-sm text-slate-600">
          <span data-testid="desk-workload-count">{loading ? 'Loading…' : `${data?.list.total ?? 0} ${data?.list.total === 1 ? 'task' : 'tasks'}`}</span>
          {lastPage > 1 && (
            <span className="flex gap-2 items-center">
              <button type="button" className={SECONDARY} disabled={filters.page <= 1} onClick={() => go({ page: filters.page - 1 })}>Previous</button>
              Page {filters.page} of {lastPage}
              <button type="button" className={SECONDARY} disabled={filters.page >= lastPage} onClick={() => go({ page: filters.page + 1 })}>Next</button>
            </span>
          )}
        </div>
      </section>
    </div>
  );
}

function Table({ title, testId, cols, rows }: {
  title: string; testId: string; cols: string[];
  rows: { id: string; chosen: boolean; onPick: () => void; cells: React.ReactNode[] }[];
}) {
  return (
    <section className="border border-slate-200 rounded-xl bg-white overflow-hidden" data-testid={testId}>
      <h2 className="px-3 py-2 text-sm font-semibold text-slate-800 border-b border-slate-100">{title}</h2>
      <div className="overflow-x-auto max-h-80">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-slate-500"><tr>{cols.map((c, i) => <th key={c} className={`px-3 py-1.5 ${i ? 'text-right' : ''}`}>{c}</th>)}</tr></thead>
          <tbody>
            {!rows.length && <tr><td colSpan={cols.length} className="px-3 py-3 text-slate-500">Nothing open.</td></tr>}
            {rows.map((r) => (
              <tr key={r.id} className={`border-t border-slate-100 ${r.chosen ? 'bg-sky-50' : ''}`} data-testid={`${testId}-row`}>
                {r.cells.map((c, i) => (
                  <td key={i} className={`px-3 py-1.5 ${i ? 'text-right tabular-nums' : ''}`}>
                    {i ? c : <button type="button" className="text-left hover:underline" onClick={r.onPick} aria-pressed={r.chosen}>{c}</button>}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/** When the overdue-alert check last ran (Module 41), so a stopped schedule is noticed. */
function AlertCheckLine({ check }: { check: NonNullable<Workload['alertCheck']> }) {
  const run = check.lastRun;
  const text = run
    ? `Overdue alerts: last checked ${new Date(run.at).toLocaleString()}; ${run.sent === 0 ? 'nothing new to send' : `${run.sent} ${run.sent === 1 ? 'alert' : 'alerts'} sent`}.`
    : 'Overdue alerts: the check has not run yet.';
  return (
    <p className={`text-xs mt-1 ${run?.failed || !check.scheduled ? 'text-amber-700' : 'text-slate-500'}`} data-testid="desk-workload-alert-check">
      {text}
      {!!run?.failed && ` ${run.failed} could not be checked${run.error ? ` (${run.error})` : ''}.`}
      {!check.scheduled && ' No schedule is set up, so alerts are not being sent.'}
    </p>
  );
}
