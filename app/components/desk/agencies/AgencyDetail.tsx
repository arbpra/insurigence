'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type { TaskStatus } from '@prisma/client';
import { dayLabel } from '@/lib/desk/account-form';
import { daysLeftLabel } from '@/lib/desk/dashboard-view';
import { PRIORITY_BADGE, dueLabel, type DueTone } from '@/lib/desk/queue-view';
import {
  AGENCY_ACCOUNTS_PAGE_SIZE, AGENCY_WORK_PAGE_SIZE, AGENCY_WORK_VIEWS, AM_ROLE_LABELS, agencyWorkAddress, agencyWorkQuery,
  type AgencyWorkFilters, type AgencyWorkView,
} from '@/lib/desk/agency-page-view';
import { ApiError, api } from '@/components/desk/accounts/account-api';

type Ref = { id: string; name: string };
type Person = { id: string; name: string; isActive: boolean } | null;
interface Summary {
  id: string; name: string; status: string;
  contact: { email: string | null; phone: string | null; website: string | null };
  deskSince: string | null; yourRole: 'PRIMARY' | 'BACKUP' | null; primaryAm: Person; backupAm: Person;
  ams: string | null; instructions: string | null; credentialVaultRef: string | null;
  plan: { name: string; since: string; includedAccounts: number | null } | null;
  accounts: { active: number; inactive: number };
  pods: { id: string; name: string; isActive: boolean; wholePod: boolean; people: number }[];
  counts: { open: number; overdue: number; dueSoon: number; waitingOnAgency: number; review: number; unrouted: number };
  renewalDays: number; renewalsTotal: number;
  renewals: { id: string; policyNumber: string | null; lineOfBusiness: string | null; carrierName: string | null; expirationDate: string; daysLeft: number; insured: Ref; renewalTask: { id: string; reference: number; statusLabel: string } | null }[];
}
interface Task {
  id: string; reference: number; title: string; typeLabel: string; status: TaskStatus; statusLabel: string; priority: keyof typeof PRIORITY_BADGE | string;
  insured: Ref | null; assignee: Ref | null; pod: Ref | null; dueAt: string | null; waitingSince: string | null; completedAt: string | null;
}
interface Account { id: string; name: string; dba: string | null; status: 'ACTIVE' | 'INACTIVE'; city: string | null; state: string | null; policyCount: number; openTasks?: number }

const ACCENT = 'var(--brand-primary, #05314c)';
const CARD = 'border border-slate-200 rounded-xl bg-white p-4 sm:p-5 min-w-0';
const INPUT = 'border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white min-w-0';
const BUTTON = 'px-3 py-1.5 text-sm rounded-lg font-medium disabled:opacity-50';
const SECONDARY = `${BUTTON} border border-slate-300 bg-white text-slate-700`;
const H2 = 'text-base font-semibold text-slate-900';
const SEARCH_DELAY_MS = 300;
const TONE: Record<DueTone, string> = {
  overdue: 'text-red-700 font-medium', soon: 'text-amber-700 font-medium', normal: 'text-slate-600', waiting: 'text-slate-500', none: 'text-slate-400', closed: 'text-slate-500',
};
const VIEWS = Object.keys(AGENCY_WORK_VIEWS) as AgencyWorkView[];

/** Debounces a search box: the value to send, once typing has paused. */
function useSettled(value: string): string {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setSettled(value.trim()), SEARCH_DELAY_MS);
    return () => clearTimeout(t);
  }, [value]);
  return settled;
}

/** One agency for its Account Manager: setup, work, accounts and renewals. */
export function AgencyDetail({ agencyId, initial }: { agencyId: string; initial: AgencyWorkFilters }) {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loadError, setLoadError] = useState<{ status: number; message: string } | null>(null);
  const [attempt, setAttempt] = useState(0);

  // Work: tab, account, search and page live in the address.
  const [work, setWork] = useState(initial);
  const [workSearch, setWorkSearch] = useState(initial.q);
  const settledWork = useSettled(workSearch);
  const [tasks, setTasks] = useState<{ total: number; page: number; rows: Task[] } | null>(null);
  const [tasksError, setTasksError] = useState('');
  const [tasksLoading, setTasksLoading] = useState(true);
  const [now, setNow] = useState(() => new Date());
  const workSection = useRef<HTMLElement>(null);

  // Accounts: their own search and page, not kept in the address.
  const [accountSearch, setAccountSearch] = useState('');
  const settledAccounts = useSettled(accountSearch);
  const [accountStatus, setAccountStatus] = useState<'ACTIVE' | 'INACTIVE'>('ACTIVE');
  const [accountPage, setAccountPage] = useState(1);
  const [accounts, setAccounts] = useState<{ total: number; page: number; insureds: Account[] } | null>(null);
  const [accountsError, setAccountsError] = useState('');
  const [accountNames, setAccountNames] = useState<Record<string, string>>({});

  useEffect(() => {
    api<Summary>(`/api/desk/agencies/${agencyId}`)
      .then((s) => { setSummary(s); setLoadError(null); })
      .catch((err) => setLoadError({ status: err instanceof ApiError ? err.status : 0, message: err instanceof Error ? err.message : 'This agency could not be loaded.' }));
  }, [agencyId, attempt]);

  const go = useCallback((next: Partial<AgencyWorkFilters>) => {
    setWork((current) => {
      const f = { ...current, page: 1, ...next };
      try { window.history.replaceState(null, '', agencyWorkAddress(agencyId, f)); } catch { /* address only */ }
      return f;
    });
  }, [agencyId]);

  useEffect(() => {
    if (settledWork !== work.q) go({ q: settledWork });
  }, [settledWork, work.q, go]);

  const workQuery = agencyWorkQuery(agencyId, work);
  useEffect(() => {
    if (!summary) return;
    const request = new AbortController();
    setTasksLoading(true);
    setTasksError('');
    fetch(`/api/desk/tasks?${workQuery}`, { signal: request.signal })
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error || 'The work could not be loaded.');
        setTasks(body);
        setNow(new Date());
        setTasksLoading(false);
      })
      .catch((err) => {
        if (request.signal.aborted) return;
        setTasksError(err instanceof Error ? err.message : 'The work could not be loaded.');
        setTasksLoading(false);
      });
    return () => request.abort();
  }, [workQuery, summary]);

  useEffect(() => { setAccountPage(1); }, [settledAccounts, accountStatus]);
  useEffect(() => {
    if (!summary) return;
    const request = new AbortController();
    setAccountsError('');
    const p = new URLSearchParams({ agencyId, status: accountStatus, page: String(accountPage), pageSize: String(AGENCY_ACCOUNTS_PAGE_SIZE) });
    if (settledAccounts) p.set('q', settledAccounts);
    fetch(`/api/desk/insureds?${p}`, { signal: request.signal })
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error || 'The accounts could not be loaded.');
        setAccounts(body);
        setAccountNames((names) => ({ ...names, ...Object.fromEntries((body.insureds as Account[]).map((a) => [a.id, a.name])) }));
      })
      .catch((err) => {
        if (!request.signal.aborted) setAccountsError(err instanceof Error ? err.message : 'The accounts could not be loaded.');
      });
    return () => request.abort();
  }, [agencyId, summary, settledAccounts, accountStatus, accountPage]);

  function showAccountWork(account: Account) {
    setAccountNames((names) => ({ ...names, [account.id]: account.name }));
    go({ account: account.id });
    workSection.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  if (loadError && !summary) {
    return (
      <div className={CARD} data-testid="desk-agency-unavailable">
        <p className="text-sm text-slate-700 mb-3">{loadError.status === 404 ? "This agency isn't available. It may not exist, use The Desk, or be one you look after." : loadError.message}</p>
        <div className="flex gap-2">
          <Link href="/desk-ops/agencies" className={SECONDARY}>All agencies</Link>
          {loadError.status !== 404 && <button type="button" className={SECONDARY} onClick={() => setAttempt((n) => n + 1)}>Try again</button>}
        </div>
      </div>
    );
  }
  if (!summary) return <p className="text-sm text-slate-500">Loading…</p>;

  const c = summary.counts;
  const tiles = [
    { key: 'open', label: 'Open', value: c.open, tone: '' },
    { key: 'overdue', label: 'Overdue', value: c.overdue, tone: c.overdue ? 'text-red-700' : '' },
    { key: 'soon', label: 'Due soon', value: c.dueSoon, tone: c.dueSoon ? 'text-amber-700' : '' },
    { key: 'waiting', label: 'Waiting on them', value: c.waitingOnAgency, tone: '' },
    { key: 'review', label: 'To review', value: c.review, tone: '' },
    { key: 'renewals', label: `Renewals, ${summary.renewalDays} days`, value: summary.renewalsTotal, tone: '' },
  ];
  const rows = tasks?.rows ?? [];
  const lastWorkPage = tasks ? Math.max(1, Math.ceil(tasks.total / AGENCY_WORK_PAGE_SIZE)) : 1;
  const lastAccountPage = accounts ? Math.max(1, Math.ceil(accounts.total / AGENCY_ACCOUNTS_PAGE_SIZE)) : 1;
  const included = summary.plan?.includedAccounts ?? null;

  return (
    <div data-testid="desk-agency" data-agency-id={summary.id}>
      <Link href="/desk-ops/agencies" className="text-sm text-slate-600 hover:underline">← Agencies</Link>
      <div className="mt-2 mb-5">
        <h1 className="text-2xl font-bold tracking-tight break-words" style={{ color: ACCENT }} data-testid="page-title">{summary.name}</h1>
        <p className="text-sm text-slate-500 mt-1" data-testid="desk-agency-role">
          {summary.yourRole ? AM_ROLE_LABELS[summary.yourRole] : `Account Manager: ${summary.primaryAm?.name ?? 'not assigned'}`}
          {summary.deskSince ? ` · on The Desk since ${dayLabel(summary.deskSince)}` : ''}
        </p>
        <Link href={`/desk-ops/messages?agency=${summary.id}`} className="inline-block text-sm underline text-slate-700 mt-1" data-testid="desk-agency-message">Message this agency</Link>
      </div>

      <div className="grid gap-3 grid-cols-2 lg:grid-cols-6 mb-5" data-testid="desk-agency-tiles">
        {tiles.map((t) => (
          <div key={t.key} className={CARD}>
            <p className="text-sm text-slate-500">{t.label}</p>
            <p className={`text-2xl font-semibold mt-1 ${t.tone || 'text-slate-900'}`} data-testid={`desk-agency-count-${t.key}`}>{t.value.toLocaleString('en-US')}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="grid gap-4 lg:col-span-2 content-start min-w-0">
          <section ref={workSection} className={`${CARD} scroll-mt-4`} data-testid="desk-agency-work" aria-busy={tasksLoading}>
            <h2 className={`${H2} mb-3`}>Work</h2>
            <div className="flex flex-wrap gap-2 mb-3" role="tablist" aria-label="Show">
              {VIEWS.map((v) => {
                const active = work.view === v;
                return (
                  <button key={v} type="button" role="tab" aria-selected={active}
                    className={`${BUTTON} border ${active ? 'text-white border-transparent' : 'border-slate-300 bg-white text-slate-700'}`}
                    style={active ? { backgroundColor: ACCENT } : undefined} onClick={() => go({ view: v })} data-testid={`desk-agency-view-${v}`}>
                    {AGENCY_WORK_VIEWS[v].label}
                  </button>
                );
              })}
            </div>
            <div className="flex flex-wrap items-center gap-2 mb-3">
              <input type="search" aria-label="Search the work" placeholder="Search by title, account or #number" className={`${INPUT} flex-1 min-w-[12rem]`}
                value={workSearch} onChange={(e) => setWorkSearch(e.target.value)} data-testid="desk-agency-work-search" />
              {work.account && (
                <span className="inline-flex items-center gap-2 px-2 py-1 rounded-full bg-sky-50 border border-sky-200 text-sm text-sky-900" data-testid="desk-agency-work-account">
                  {accountNames[work.account] ?? 'One account'}
                  <button type="button" aria-label="Show every account" className="text-sky-700" onClick={() => go({ account: '' })} data-testid="desk-agency-work-account-clear">×</button>
                </span>
              )}
            </div>
            {tasksError ? <p className="text-sm text-red-600" role="alert">{tasksError}</p>
              : !tasks ? <p className="text-sm text-slate-500">Loading…</p>
              : rows.length === 0 ? <p className="text-sm text-slate-600" data-testid="desk-agency-work-empty">Nothing here{work.account || work.q ? ' for these filters' : ''}.</p>
              : (
                <ul className="divide-y divide-slate-100 list-none p-0 -my-2">
                  {rows.map((t) => {
                    const due = dueLabel(t, now);
                    return (
                      <li key={t.id} className="py-3 flex flex-wrap items-start justify-between gap-x-4 gap-y-1" data-testid="desk-agency-task">
                        <div className="min-w-[13rem] flex-1">
                          <Link href={`/desk-ops/tasks/${t.id}`} className="font-medium hover:underline break-words" style={{ color: ACCENT }} data-testid="desk-agency-task-open">
                            <span className="text-slate-400 mr-1">#{t.reference}</span>{t.title}
                          </Link>
                          <p className="text-xs text-slate-500 mt-0.5 break-words">
                            {t.typeLabel}{t.insured ? ` · ${t.insured.name}` : ''} · {t.assignee?.name ?? (t.pod ? `${t.pod.name}, unassigned` : 'Not routed')}
                          </p>
                        </div>
                        <div className="sm:text-right text-xs shrink-0">
                          <span className="inline-block px-2 py-0.5 rounded-full bg-slate-100 text-slate-800 font-medium" data-testid="desk-agency-task-status">{t.statusLabel}</span>
                          {PRIORITY_BADGE[t.priority as keyof typeof PRIORITY_BADGE] && <span className="ml-1 inline-block px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 font-medium">{PRIORITY_BADGE[t.priority as keyof typeof PRIORITY_BADGE]}</span>}
                          <p className={`mt-1 ${TONE[due.tone]}`} data-testid="desk-agency-task-due">{t.status === 'COMPLETED' && t.completedAt ? `Completed ${dayLabel(t.completedAt)}` : due.text}</p>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            {tasks && tasks.total > AGENCY_WORK_PAGE_SIZE && (
              <div className="flex flex-wrap items-center justify-between gap-2 mt-3 text-sm text-slate-600">
                <span>{(tasks.page - 1) * AGENCY_WORK_PAGE_SIZE + 1}–{Math.min(tasks.page * AGENCY_WORK_PAGE_SIZE, tasks.total)} of {tasks.total.toLocaleString('en-US')}</span>
                <div className="flex gap-2">
                  <button type="button" className={SECONDARY} disabled={tasks.page <= 1 || tasksLoading} onClick={() => go({ page: tasks.page - 1 })}>Previous</button>
                  <button type="button" className={SECONDARY} disabled={tasks.page >= lastWorkPage || tasksLoading} onClick={() => go({ page: tasks.page + 1 })}>Next</button>
                </div>
              </div>
            )}
          </section>

          <section className={CARD} data-testid="desk-agency-accounts">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
              <h2 className={H2}>Accounts</h2>
              <p className={`text-sm ${included !== null && summary.accounts.active > included ? 'text-amber-800 font-medium' : 'text-slate-500'}`} data-testid="desk-agency-accounts-count">
                {summary.accounts.active} active{included !== null ? ` of ${included} included` : ''}{summary.accounts.inactive ? ` · ${summary.accounts.inactive} inactive` : ''}
              </p>
            </div>
            <div className="flex flex-wrap gap-2 mb-3">
              <input type="search" aria-label="Find an account" placeholder="Find an account" className={`${INPUT} flex-1 min-w-[12rem]`}
                value={accountSearch} onChange={(e) => setAccountSearch(e.target.value)} data-testid="desk-agency-accounts-search" />
              <select aria-label="Account status" className={INPUT} value={accountStatus} onChange={(e) => setAccountStatus(e.target.value as 'ACTIVE' | 'INACTIVE')} data-testid="desk-agency-accounts-status">
                <option value="ACTIVE">Active</option>
                <option value="INACTIVE">Inactive</option>
              </select>
            </div>
            {accountsError ? <p className="text-sm text-red-600" role="alert">{accountsError}</p>
              : !accounts ? <p className="text-sm text-slate-500">Loading…</p>
              : accounts.insureds.length === 0 ? <p className="text-sm text-slate-600">No {accountStatus === 'ACTIVE' ? 'active' : 'inactive'} accounts{settledAccounts ? ` match “${settledAccounts}”` : ''}.</p>
              : (
                <ul className="divide-y divide-slate-100 list-none p-0 -my-2">
                  {accounts.insureds.map((a) => (
                    <li key={a.id} className="py-2.5 flex flex-wrap items-center justify-between gap-x-4 gap-y-1" data-testid="desk-agency-account">
                      <div className="min-w-[12rem] flex-1">
                        <p className="font-medium text-slate-900 break-words">{a.name}{a.dba ? <span className="text-slate-500 font-normal"> · {a.dba}</span> : null}</p>
                        <p className="text-xs text-slate-500">{[a.city, a.state].filter(Boolean).join(', ') || '—'} · {a.policyCount} {a.policyCount === 1 ? 'policy' : 'policies'}</p>
                      </div>
                      <button type="button" className="text-sm underline text-slate-700 shrink-0" onClick={() => showAccountWork(a)} data-testid="desk-agency-account-work">
                        {a.openTasks ? `${a.openTasks} open ${a.openTasks === 1 ? 'request' : 'requests'}` : 'Its work'}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            {accounts && accounts.total > AGENCY_ACCOUNTS_PAGE_SIZE && (
              <div className="flex flex-wrap items-center justify-between gap-2 mt-3 text-sm text-slate-600">
                <span>{(accounts.page - 1) * AGENCY_ACCOUNTS_PAGE_SIZE + 1}–{Math.min(accounts.page * AGENCY_ACCOUNTS_PAGE_SIZE, accounts.total)} of {accounts.total.toLocaleString('en-US')}</span>
                <div className="flex gap-2">
                  <button type="button" className={SECONDARY} disabled={accounts.page <= 1} onClick={() => setAccountPage(accounts.page - 1)}>Previous</button>
                  <button type="button" className={SECONDARY} disabled={accounts.page >= lastAccountPage} onClick={() => setAccountPage(accounts.page + 1)}>Next</button>
                </div>
              </div>
            )}
          </section>
        </div>

        <div className="grid gap-4 content-start min-w-0">
          <section className={CARD} data-testid="desk-agency-about">
            <h2 className={`${H2} mb-3`}>About</h2>
            <dl className="grid gap-2 text-sm">
              {([
                ['Account Managers', <>{summary.primaryAm ? `${summary.primaryAm.name}${summary.primaryAm.isActive ? '' : ' (inactive)'}` : 'No primary'}{summary.backupAm ? <span className="block text-slate-500">Backup: {summary.backupAm.name}{summary.backupAm.isActive ? '' : ' (inactive)'}</span> : null}</>],
                ['Plan', summary.plan ? `${summary.plan.name}, since ${dayLabel(summary.plan.since)}` : 'No plan yet'],
                ['AMS', summary.ams ?? 'Not recorded'],
                ['Pods', summary.pods.length ? summary.pods.map((p) => `${p.name}${p.wholePod ? '' : ` (${p.people} named ${p.people === 1 ? 'person' : 'people'})`}${p.isActive ? '' : ', inactive'}`).join('; ') : 'None yet: no VA can work for this agency'],
                ['Contact', [summary.contact.email, summary.contact.phone].filter(Boolean).join(' · ') || '—'],
              ] as [string, React.ReactNode][]).map(([k, v]) => (
                <div key={k} className="min-w-0"><dt className="text-slate-500">{k}</dt><dd className="text-slate-900 break-words" data-testid={`desk-agency-about-${k.toLowerCase().replace(/\s+/g, '-')}`}>{v}</dd></div>
              ))}
            </dl>
          </section>

          <section className={CARD} data-testid="desk-agency-instructions">
            <h2 className={`${H2} mb-2`}>Instructions for Desk staff</h2>
            {summary.instructions
              ? <p className="text-sm text-slate-800 whitespace-pre-wrap break-words">{summary.instructions}</p>
              : <p className="text-sm text-slate-500">None recorded.</p>}
            <p className="text-sm text-slate-600 mt-3 pt-3 border-t border-slate-100" data-testid="desk-agency-vault">
              {summary.credentialVaultRef
                ? <>Logins are kept in the password manager: <span className="font-medium text-slate-900 break-words">{summary.credentialVaultRef}</span></>
                : 'No password-manager location recorded. Logins are never kept in The Desk.'}
            </p>
          </section>

          <section className={CARD} data-testid="desk-agency-renewals">
            <h2 className={`${H2} mb-3`}>Renewals in the next {summary.renewalDays} days</h2>
            {summary.renewals.length === 0 ? <p className="text-sm text-slate-500">None.</p> : (
              <ul className="grid gap-3 list-none p-0">
                {summary.renewals.map((p) => (
                  <li key={p.id} className="text-sm min-w-0" data-testid="desk-agency-renewal">
                    <p className="font-medium text-slate-900 break-words">{p.insured.name}</p>
                    <p className="text-xs text-slate-500 break-words">{[p.policyNumber, p.lineOfBusiness, p.carrierName].filter(Boolean).join(' · ') || 'Policy'}</p>
                    <p className={p.daysLeft <= 14 ? 'text-amber-800 font-medium' : 'text-slate-700'}>{daysLeftLabel(p.daysLeft)} · {dayLabel(p.expirationDate)}</p>
                    {p.renewalTask
                      ? <Link href={`/desk-ops/tasks/${p.renewalTask.id}`} className="text-xs underline text-slate-600" data-testid="desk-agency-renewal-task">Renewal #{p.renewalTask.reference}: {p.renewalTask.statusLabel}</Link>
                      : <p className="text-xs text-amber-800">No renewal request yet</p>}
                  </li>
                ))}
              </ul>
            )}
            {summary.renewalsTotal > summary.renewals.length && <p className="text-xs text-slate-500 mt-2">Showing {summary.renewals.length} of {summary.renewalsTotal}.</p>}
          </section>
        </div>
      </div>
    </div>
  );
}
