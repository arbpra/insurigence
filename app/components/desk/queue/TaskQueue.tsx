'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import type { TaskPriority, TaskStatus } from '@prisma/client';
import { COMPLEXITY_LABELS, PRIORITY_LABELS, TASK_TYPE_LABELS } from '@/lib/desk/service-levels';
import {
  MINE_VIEWS, PRIORITY_BADGE, QUEUE_PAGE_SIZE, QUEUE_SORTS, dueLabel, hasQueueFilters, lastQueuePage, parseQueueFilters,
  queueApiQuery, queuePageQuery, type DueTone, type MineView, type QueueFilters, type QueueMode, type QueueSort,
} from '@/lib/desk/queue-view';
import { ApiError, api } from '@/components/desk/accounts/account-api';

interface Row {
  id: string;
  reference: number;
  title: string;
  typeLabel: string;
  priority: TaskPriority;
  complexity: 'STANDARD' | 'COMPLEX';
  status: TaskStatus;
  statusLabel: string;
  agency: { id: string; name: string };
  insured: { id: string; name: string } | null;
  pod: { id: string; name: string } | null;
  assignee: { id: string; name: string } | null;
  dueAt: string | null;
  waitingSince: string | null;
  completedAt: string | null;
}
interface ListResult { total: number; page: number; rows: Row[] }
interface Options {
  canAssign: boolean;
  pods: { id: string; name: string }[];
  agencies: { id: string; name: string }[];
  counts: { waiting: number; overdue: number; unrouted: number; mine: number };
}
interface Person { id: string; name: string; kind: 'VA' | 'ACCOUNT_MANAGER'; lead: boolean; openTasks: number }

const INPUT = 'border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white min-w-0';
const ACCENT = 'var(--brand-primary, #05314c)';
const BUTTON = 'px-3 py-1.5 text-sm rounded-lg font-medium disabled:opacity-50';
const SECONDARY = `${BUTTON} border border-slate-300 bg-white text-slate-700`;
const SEARCH_DELAY_MS = 300;

const TONE: Record<DueTone, string> = {
  overdue: 'text-red-700 font-medium',
  soon: 'text-amber-700 font-medium',
  normal: 'text-slate-600',
  waiting: 'text-slate-500',
  none: 'text-slate-400',
  closed: 'text-slate-500',
};

const HREF: Record<QueueMode, string> = { queue: '/desk-ops/queue', mine: '/desk-ops/my-tasks' };

/** The Pod queue (open work nobody holds) or My tasks (the person's own), with filters kept in the address. */
export function TaskQueue({ mode, userId }: { mode: QueueMode; userId: string }) {
  const params = useSearchParams();
  const address = params.toString();
  const filters = useMemo(() => parseQueueFilters(new URLSearchParams(address)), [address]);

  const [options, setOptions] = useState<Options | null>(null);
  const [search, setSearch] = useState(filters.q);
  const [data, setData] = useState<ListResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState<{ text: string; link?: boolean } | null>(null);
  const [actionError, setActionError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [picking, setPicking] = useState<{ taskId: string; people: Person[] | null; error: string } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const sentSearch = useRef(filters.q);
  const now = useMemo(() => new Date(), [data]); // eslint-disable-line react-hooks/exhaustive-deps

  const go = useCallback((current: QueueFilters, next: Partial<QueueFilters>) => {
    const query = queuePageQuery({ ...current, page: 1, ...next }, mode);
    window.history.replaceState(null, '', query ? `${HREF[mode]}?${query}` : HREF[mode]);
  }, [mode]);

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

  // The filter choices and counts, refreshed after each pick-up or hand-over.
  useEffect(() => {
    api<Options>('/api/desk/queue').then(setOptions).catch(() => setOptions(null));
  }, [attempt]);

  const apiQuery = queueApiQuery(filters, mode);
  useEffect(() => {
    const request = new AbortController();
    setLoading(true);
    setError('');
    fetch(`/api/desk/tasks?${apiQuery}`, { signal: request.signal })
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error || 'The work could not be loaded.');
        setData(body);
        setLoading(false);
      })
      .catch((err) => {
        if (request.signal.aborted) return;
        setError(err instanceof Error ? err.message : 'The work could not be loaded.');
        setLoading(false);
      });
    return () => request.abort();
  }, [apiQuery, attempt]);

  const pastEnd = !!data && data.rows.length === 0 && data.total > 0 && filters.page > 1;
  const finalPage = data ? lastQueuePage(data.total) : 1;
  useEffect(() => {
    if (pastEnd) go(filters, { page: finalPage });
  }, [pastEnd, finalPage, filters, go]);

  const refresh = () => setAttempt((n) => n + 1);

  /** Runs one change, then reloads, so the list always shows what the server holds. */
  async function act(taskId: string, run: () => Promise<unknown>, done: { text: string; link?: boolean }, taken?: string) {
    setBusy(taskId);
    setActionError('');
    setNotice(null);
    try {
      await run();
      setNotice(done);
      setPicking(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'That could not be saved.';
      // Someone else got there first: say so, and show the list as it is now. Picking up
      // work someone already holds is refused as a take-over (403), which here means just that.
      const lost = err instanceof ApiError && (err.status === 409 || err.status === 404 || (!!taken && err.status === 403));
      setActionError(lost
        ? `${taken && (err as ApiError).status === 403 ? taken : message} The list has been refreshed.`
        : message);
    } finally {
      setBusy(null);
      refresh();
    }
  }

  const assign = (task: Row, assigneeId: string | null) =>
    api(`/api/desk/tasks/${task.id}/assign`, { method: 'POST', body: JSON.stringify({ assigneeId }) });

  const pickUp = (task: Row) => act(task.id, () => assign(task, userId), { text: `You picked up #${task.reference}. It's in My tasks.`, link: true }, `Someone else has already picked up #${task.reference}.`);
  const start = (task: Row) => act(task.id, () => api(`/api/desk/tasks/${task.id}/status`, { method: 'POST', body: JSON.stringify({ status: 'IN_PROGRESS' }) }), { text: `#${task.reference} is in progress.` });
  const release = (task: Row) => {
    if (!window.confirm(`Return #${task.reference} to the Pod queue for someone else to pick up?`)) return;
    void act(task.id, () => assign(task, null), { text: `#${task.reference} is back in the Pod queue.` });
  };

  async function openPicker(task: Row) {
    if (picking?.taskId === task.id) return setPicking(null);
    setPicking({ taskId: task.id, people: null, error: '' });
    try {
      const { people } = await api<{ people: Person[] }>(`/api/desk/tasks/${task.id}/assignees`);
      setPicking((p) => (p?.taskId === task.id ? { ...p, people } : p));
    } catch (err) {
      setPicking((p) => (p?.taskId === task.id ? { ...p, people: [], error: err instanceof Error ? err.message : 'Could not load who can take this.' } : p));
    }
  }

  const handTo = (task: Row, person: Person) =>
    act(task.id, () => assign(task, person.id), { text: person.id === userId ? `You took #${task.reference}. It's in My tasks.` : `#${task.reference} is assigned to ${person.name}.`, link: person.id === userId });

  const canAssign = !!options?.canAssign;
  const rows = data?.rows ?? [];
  const shownPage = data?.page ?? filters.page;
  const total = data?.total ?? 0;
  const closedView = mode === 'mine' && filters.view === 'closed';
  const filtered = hasQueueFilters(filters);
  const counts = options?.counts;

  return (
    <div data-testid={`desk-${mode}`}>
      <div className="mb-5">
        <h1 className="text-2xl font-bold tracking-tight mb-1" style={{ color: ACCENT }} data-testid="page-title">{mode === 'queue' ? 'Pod queue' : 'My tasks'}</h1>
        <p className="text-sm text-slate-500" data-testid="desk-queue-summary">
          {mode === 'queue'
            ? (counts
              ? <>{counts.waiting} waiting to be picked up{counts.overdue ? <>, <span className="text-red-700 font-medium">{counts.overdue} overdue</span></> : null}{canAssign && counts.unrouted ? `, ${counts.unrouted} not yet routed to a pod` : ''}. You hold {counts.mine}.</>
              : 'Open work in your pods that nobody has picked up yet.')
            : (counts ? <>You hold {counts.mine} open {counts.mine === 1 ? 'task' : 'tasks'}. {counts.waiting} waiting in the <Link href="/desk-ops/queue" className="underline">Pod queue</Link>.</> : 'Work assigned to you.')}
        </p>
      </div>

      {mode === 'mine' && (
        <div className="flex flex-wrap gap-2 mb-4" role="group" aria-label="Show" data-testid="desk-queue-views">
          {(Object.keys(MINE_VIEWS) as MineView[]).map((v) => (
            <button
              key={v} type="button" aria-pressed={filters.view === v} onClick={() => go(filters, { view: v })}
              className={`${BUTTON} border ${filters.view === v ? 'text-white border-transparent' : 'border-slate-300 bg-white text-slate-700'}`}
              style={filters.view === v ? { backgroundColor: ACCENT } : undefined} data-testid={`desk-queue-view-${v}`}
            >{MINE_VIEWS[v].label}</button>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3 mb-4" data-testid="desk-queue-filters">
        <input
          type="search" aria-label="Search" placeholder="Search title, account or #number…" maxLength={200}
          className={`${INPUT} flex-1 min-w-[200px]`} value={search} onChange={(e) => setSearch(e.target.value)} data-testid="desk-queue-search"
        />
        {options && (options.pods.length > 1 || (canAssign && mode === 'queue')) && (
          <select aria-label="Pod" className={INPUT} value={filters.podId} onChange={(e) => go(filters, { podId: e.target.value })} data-testid="desk-queue-pod">
            <option value="">All pods</option>
            {options.pods.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            {canAssign && <option value="none">Not yet routed</option>}
          </select>
        )}
        {options && options.agencies.length > 1 && (
          <select aria-label="Agency" className={INPUT} value={filters.agencyId} onChange={(e) => go(filters, { agencyId: e.target.value })} data-testid="desk-queue-agency">
            <option value="">All agencies</option>
            {options.agencies.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        )}
        <select aria-label="Request type" className={INPUT} value={filters.type} onChange={(e) => go(filters, { type: e.target.value as QueueFilters['type'] })} data-testid="desk-queue-type">
          <option value="">All types</option>
          {Object.entries(TASK_TYPE_LABELS).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
        </select>
        <select aria-label="Priority" className={INPUT} value={filters.priority} onChange={(e) => go(filters, { priority: e.target.value as QueueFilters['priority'] })} data-testid="desk-queue-priority">
          <option value="">Any priority</option>
          {Object.entries(PRIORITY_LABELS).reverse().map(([k, label]) => <option key={k} value={k}>{label}</option>)}
        </select>
        {!closedView && (
          <>
            <label className="flex items-center gap-1.5 text-sm text-slate-700">
              <input type="checkbox" checked={filters.overdue} onChange={(e) => go(filters, { overdue: e.target.checked })} data-testid="desk-queue-overdue" />
              Overdue only
            </label>
            <select aria-label="Order" className={INPUT} value={filters.sort} onChange={(e) => go(filters, { sort: e.target.value as QueueSort })} data-testid="desk-queue-sort">
              {Object.entries(QUEUE_SORTS).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
            </select>
          </>
        )}
      </div>

      {notice && (
        <p className="text-sm text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 mb-4" role="status" data-testid="desk-queue-notice">
          {notice.text}{notice.link && mode === 'queue' && <> <Link href="/desk-ops/my-tasks" className="underline font-medium">Open My tasks</Link></>}
        </p>
      )}
      {actionError && <p className="text-sm text-red-600 mb-4" role="alert" data-testid="desk-queue-action-error">{actionError}</p>}
      {error && (
        <p className="text-sm text-red-600 mb-4" role="alert" data-testid="desk-queue-error">
          {error}{' '}<button type="button" className="underline" onClick={refresh} data-testid="desk-queue-retry">Try again</button>
        </p>
      )}

      {!error && !loading && rows.length === 0 && (
        <div className="border border-dashed border-slate-300 rounded-xl p-8 text-center text-sm text-slate-500" data-testid="desk-queue-empty">
          {filtered
            ? <>Nothing matches these filters. <button type="button" className="underline" onClick={() => { setSearch(''); sentSearch.current = ''; go(filters, { q: '', podId: '', agencyId: '', type: '', priority: '', overdue: false }); }} data-testid="desk-queue-clear">Clear filters</button></>
            : mode === 'queue'
              ? 'Nothing is waiting to be picked up.'
              : closedView ? 'Nothing completed yet.' : `Nothing here. Pick up work from the Pod queue.`}
        </div>
      )}

      <ul className="grid gap-3 list-none p-0" aria-busy={loading} data-testid="desk-queue-rows">
        {rows.map((task) => {
          const due = dueLabel(task, now);
          const mineRow = task.assignee?.id === userId;
          const closed = task.status === 'COMPLETED' || task.status === 'CANCELLED';
          return (
            <li key={task.id} className="border border-slate-200 rounded-xl bg-white p-4 min-w-0" data-testid="desk-queue-row" data-task-id={task.id}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                {/* At least ~14rem wide, so on a phone the buttons move below rather than squeezing the title. */}
                <div className="min-w-[14rem] flex-1" data-testid="desk-queue-row-main">
                  <p className="font-medium text-slate-900 break-words">
                    <span className="text-slate-500 font-normal mr-1.5">#{task.reference}</span><Link href={`/desk-ops/tasks/${task.id}`} className="hover:underline" data-testid="desk-queue-row-open">{task.title}</Link>
                  </p>
                  <p className="text-sm text-slate-600 break-words mt-0.5" data-testid="desk-queue-row-context">
                    {task.typeLabel} · {task.agency.name}{task.insured ? ` · ${task.insured.name}` : ''}
                  </p>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2 text-xs">
                    {PRIORITY_BADGE[task.priority] && (
                      <span className={`px-2 py-0.5 rounded-full font-medium ${task.priority === 'URGENT' ? 'bg-red-100 text-red-800' : 'bg-amber-100 text-amber-800'}`} data-testid="desk-queue-row-priority">{PRIORITY_BADGE[task.priority]}</span>
                    )}
                    {task.complexity === 'COMPLEX' && <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-700">{COMPLEXITY_LABELS.COMPLEX}</span>}
                    {(mode === 'mine' || task.status !== 'NEW') && <span className="text-slate-700" data-testid="desk-queue-row-status">{task.statusLabel}</span>}
                    <span className={TONE[due.tone]} data-testid="desk-queue-row-due">{due.text}</span>
                    <span className="text-slate-500">{task.pod ? task.pod.name : 'Not yet routed'}</span>
                    {mode === 'mine' && task.assignee && !mineRow && <span className="text-slate-500">With {task.assignee.name}</span>}
                  </div>
                </div>
                {!closed && (
                  <div className="flex flex-wrap gap-2 shrink-0">
                    {mode === 'queue' && !canAssign && (
                      <button type="button" className={`${BUTTON} text-white`} style={{ backgroundColor: ACCENT }} disabled={busy === task.id} onClick={() => pickUp(task)} data-testid="desk-queue-pickup">Pick up</button>
                    )}
                    {mode === 'mine' && mineRow && task.status === 'ASSIGNED' && (
                      <button type="button" className={`${BUTTON} text-white`} style={{ backgroundColor: ACCENT }} disabled={busy === task.id} onClick={() => start(task)} data-testid="desk-queue-start">Start</button>
                    )}
                    {canAssign && (
                      <button type="button" className={SECONDARY} disabled={busy === task.id} aria-expanded={picking?.taskId === task.id} onClick={() => void openPicker(task)} data-testid="desk-queue-assign">{task.assignee ? 'Reassign' : 'Assign'}</button>
                    )}
                    {mode === 'mine' && mineRow && (
                      <button type="button" className={SECONDARY} disabled={busy === task.id} onClick={() => release(task)} data-testid="desk-queue-release">Release</button>
                    )}
                  </div>
                )}
              </div>
              {picking?.taskId === task.id && (
                <div className="mt-3 border-t border-slate-100 pt-3" data-testid="desk-queue-picker">
                  {picking.people === null && <p className="text-sm text-slate-500">Loading who can take this…</p>}
                  {picking.error && <p className="text-sm text-red-600" role="alert">{picking.error}</p>}
                  {picking.people && !picking.error && picking.people.length === 0 && (
                    <p className="text-sm text-slate-600" data-testid="desk-queue-picker-none">Nobody is authorised for this agency, pod and task yet. Check the pod&apos;s members and agency access.</p>
                  )}
                  {picking.people && picking.people.length > 0 && (
                    <ul className="grid gap-2 list-none p-0">
                      {picking.people.map((person) => {
                        const holds = person.id === task.assignee?.id;
                        return (
                          <li key={person.id}>
                            <button
                              type="button" disabled={holds || busy === task.id} onClick={() => void handTo(task, person)}
                              className="w-full text-left border border-slate-200 rounded-lg px-3 py-2 text-sm hover:bg-slate-50 disabled:opacity-60 flex flex-wrap justify-between gap-2"
                              data-testid="desk-queue-picker-person"
                            >
                              <span className="font-medium text-slate-800 break-words">
                                {person.name}{person.id === userId ? ' (you)' : ''}{person.lead ? ' · Pod lead' : ''}
                              </span>
                              <span className="text-slate-500">
                                {holds ? 'Has it now' : `${person.kind === 'VA' ? 'VA' : 'Account Manager'} · ${person.openTasks} open`}
                              </span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {total > QUEUE_PAGE_SIZE && (
        <div className="flex items-center justify-between gap-3 mt-4 text-sm text-slate-600" data-testid="desk-queue-pager">
          <span>{(shownPage - 1) * QUEUE_PAGE_SIZE + 1}–{Math.min(shownPage * QUEUE_PAGE_SIZE, total)} of {total}</span>
          <span className="flex gap-2">
            <button type="button" className={SECONDARY} disabled={shownPage <= 1} onClick={() => go(filters, { page: shownPage - 1 })} data-testid="desk-queue-prev">Previous</button>
            <button type="button" className={SECONDARY} disabled={shownPage >= finalPage} onClick={() => go(filters, { page: shownPage + 1 })} data-testid="desk-queue-next">Next</button>
          </span>
        </div>
      )}
    </div>
  );
}
