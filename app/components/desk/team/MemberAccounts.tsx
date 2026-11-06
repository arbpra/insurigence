'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  ASSIGNMENT_ROLE_LABELS, MEMBER_PAGE_SIZE, MEMBER_VIEW_LABELS, accessSummary, allSelected, bulkDoneMessage, bulkRequestBody,
  memberAccountsQuery, toggleOne, togglePage,
  type AssignmentRoleValue, type BookAccessValue, type BulkTarget, type MemberView,
} from '@/lib/desk/team-form';
import { ApiError, api } from '../accounts/account-api';

interface Member {
  id: string;
  name: string;
  email: string;
  role: string;
  roleLabel: string;
  bookAccess: BookAccessValue;
  isActive: boolean;
}

interface Row {
  id: string;
  name: string;
  dba: string | null;
  status: 'ACTIVE' | 'INACTIVE';
  city: string | null;
  state: string | null;
  assignments: { userId: string; name: string; role: AssignmentRoleValue }[];
}

const ACCENT = 'var(--brand-primary, #05314c)';
const INPUT = 'border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white';
const BUTTON = 'px-4 py-2 rounded-lg text-sm font-medium border border-slate-300 bg-white text-slate-700 disabled:opacity-50';
const SEARCH_DELAY_MS = 300;

/** One person's accounts: see what is assigned, and assign or remove many at once. */
export function MemberAccounts({ userId }: { userId: string }) {
  const [member, setMember] = useState<Member | null>(null);
  const [missing, setMissing] = useState(false);
  const [view, setView] = useState<MemberView>('ASSIGNED');
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [total, setTotal] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [everything, setEverything] = useState(false);
  const [role, setRole] = useState<AssignmentRoleValue>('PRODUCER');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const request = new AbortController();
    api<Member>(`/api/desk/team/${encodeURIComponent(userId)}`, { signal: request.signal })
      .then((m) => { setMember(m); setRole(m.role === 'CSR' ? 'SERVICE' : 'PRODUCER'); })
      .catch((err) => {
        if (request.signal.aborted) return;
        if (err instanceof ApiError && err.status === 404) setMissing(true);
        else setError(err instanceof Error ? err.message : 'Something went wrong.');
      });
    return () => request.abort();
  }, [userId]);

  useEffect(() => {
    const timer = setTimeout(() => setQ((current) => {
      const next = search.trim();
      if (next === current) return current;
      // What was ticked was for the old list.
      setPage(1);
      setSelected(new Set());
      setEverything(false);
      return next;
    }), SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    if (!member) return;
    const request = new AbortController();
    api<{ total: number; insureds: Row[] }>(`/api/desk/insureds?${memberAccountsQuery(userId, view, q, page)}`, { signal: request.signal })
      .then((body) => {
        setRows(body.insureds);
        setTotal(body.total);
        // The last page can empty after a removal.
        if (body.insureds.length === 0 && body.total > 0 && page > 1) setPage(Math.max(1, Math.ceil(body.total / MEMBER_PAGE_SIZE)));
      })
      .catch((err) => { if (!request.signal.aborted) setError(err instanceof Error ? err.message : 'The accounts could not be loaded.'); });
    return () => request.abort();
  }, [member, userId, view, q, page, attempt]);

  const changeView = (next: MemberView) => {
    setView(next);
    setPage(1);
    setSelected(new Set());
    setEverything(false);
    setNotice('');
  };

  const pageIds = (rows ?? []).map((r) => r.id);
  const pageTicked = allSelected(selected, pageIds);
  const count = everything ? total : selected.size;
  const target: BulkTarget = everything ? { kind: 'MATCHING', view, q } : { kind: 'IDS', ids: [...selected] };

  const act = useCallback(async (action: 'assign' | 'unassign', chosen: BulkTarget, chosenRole: AssignmentRoleValue) => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await api<{ changed: number }>(`/api/desk/team/${encodeURIComponent(userId)}/assignments`, { method: 'POST', body: JSON.stringify(bulkRequestBody(action, chosen, chosenRole)) });
      setNotice(bulkDoneMessage(action, result.changed));
      setSelected(new Set());
      setEverything(false);
      setAttempt((n) => n + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }, [userId]);

  const back = <Link href="/desk/team" className="text-sm text-slate-600 hover:underline" data-testid="desk-member-back">← Team access</Link>;

  if (missing) {
    return (
      <div data-testid="desk-member">
        {back}
        <p className="text-sm text-red-600 mt-4" role="alert" data-testid="desk-member-missing">This person isn&apos;t in your agency.</p>
      </div>
    );
  }
  if (!member) {
    return error
      ? <div data-testid="desk-member">{back}<p className="text-sm text-red-600 mt-4" role="alert">{error}</p></div>
      : <p className="text-sm text-slate-500" data-testid="desk-member-loading">Loading…</p>;
  }

  const lastPage = Math.max(1, Math.ceil(total / MEMBER_PAGE_SIZE));

  return (
    <div className="min-w-0" data-testid="desk-member">
      {back}
      <h1 className="text-2xl font-bold tracking-tight mt-2 break-words" style={{ color: ACCENT }} data-testid="page-title">{member.name}</h1>
      <p className="text-sm text-slate-500 mb-1 break-words">{member.roleLabel} · {member.email}</p>
      <p className="text-sm text-slate-600 mb-5" data-testid="desk-member-summary">{accessSummary(member.role, member.bookAccess)}</p>

      {!member.isActive && <p className="text-sm text-slate-700 bg-slate-50 border border-slate-200 rounded-lg p-3 mb-4" data-testid="desk-member-inactive">This person is no longer active, so accounts can only be removed.</p>}
      {notice && <p className="text-sm text-slate-700 bg-slate-50 border border-slate-200 rounded-lg p-3 mb-4" role="status" data-testid="desk-member-notice">{notice}</p>}
      {error && <p className="text-sm text-red-600 mb-4" role="alert" data-testid="desk-member-error">{error}</p>}

      <div className="flex flex-wrap items-center gap-3 mb-4">
        <select aria-label="Which accounts" className={INPUT} value={view} onChange={(e) => changeView(e.target.value as MemberView)} data-testid="desk-member-view">
          {(Object.keys(MEMBER_VIEW_LABELS) as MemberView[]).map((v) => <option key={v} value={v}>{MEMBER_VIEW_LABELS[v]}</option>)}
        </select>
        <input
          type="search" aria-label="Search accounts" placeholder="Search name, contact, policy number…" maxLength={200}
          className={`${INPUT} flex-1 min-w-[200px]`} value={search} onChange={(e) => setSearch(e.target.value)} data-testid="desk-member-search"
        />
      </div>

      {count > 0 && (
        <div className="flex flex-wrap items-center gap-3 bg-slate-50 border border-slate-200 rounded-lg p-3 mb-4" data-testid="desk-member-actions">
          <span className="text-sm text-slate-700" data-testid="desk-member-count">{count.toLocaleString('en-US')} selected</span>
          <select aria-label="Assign as" className={INPUT} value={role} onChange={(e) => setRole(e.target.value as AssignmentRoleValue)} data-testid="desk-member-role">
            {(Object.keys(ASSIGNMENT_ROLE_LABELS) as AssignmentRoleValue[]).map((r) => <option key={r} value={r}>As {ASSIGNMENT_ROLE_LABELS[r]}</option>)}
          </select>
          <button type="button" disabled={busy || !member.isActive} className={BUTTON} onClick={() => act('assign', target, role)} data-testid="desk-member-assign">Assign</button>
          <button
            type="button" disabled={busy} className={BUTTON} data-testid="desk-member-remove"
            onClick={() => { if (window.confirm(`Remove ${member.name} from ${count.toLocaleString('en-US')} account${count === 1 ? '' : 's'}?`)) act('unassign', target, role); }}
          >Remove</button>
          <button type="button" disabled={busy} className="text-sm underline text-slate-700" onClick={() => { setSelected(new Set()); setEverything(false); }} data-testid="desk-member-clear">Clear</button>
        </div>
      )}

      {pageTicked && !everything && total > pageIds.length && (
        <p className="text-sm text-slate-700 mb-3" data-testid="desk-member-select-all">
          All {pageIds.length} on this page are selected.{' '}
          <button type="button" className="underline" onClick={() => setEverything(true)} data-testid="desk-member-select-all-button">Select all {total.toLocaleString('en-US')} in this list</button>
        </p>
      )}

      {rows && rows.length === 0 && (
        <div className="bg-white border border-slate-200 rounded-xl p-8 text-center text-sm text-slate-600" data-testid="desk-member-empty">
          {q ? 'No accounts match this search.' : view === 'ASSIGNED' ? 'No accounts are assigned to them yet. Choose "Not assigned to them" to add some.' : 'No accounts to show.'}
        </div>
      )}

      {rows && rows.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
          <table className="w-full text-sm" data-testid="desk-member-table">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-slate-500 border-b border-slate-200">
                <th scope="col" className="px-4 py-3 font-medium w-8">
                  <input
                    type="checkbox" aria-label="Select all on this page" checked={everything || pageTicked} data-testid="desk-member-tick-page"
                    onChange={() => { if (everything) { setEverything(false); setSelected(new Set()); } else setSelected((s) => togglePage(s, pageIds)); }}
                  />
                </th>
                <th scope="col" className="px-4 py-3 font-medium">Account</th>
                <th scope="col" className="px-4 py-3 font-medium">Location</th>
                <th scope="col" className="px-4 py-3 font-medium">Their role</th>
                <th scope="col" className="px-4 py-3 font-medium">Also assigned</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => {
                const mine = a.assignments.find((s) => s.userId === userId);
                const others = a.assignments.filter((s) => s.userId !== userId);
                return (
                  <tr key={a.id} className="border-b border-slate-100 last:border-0" data-testid={`desk-member-row-${a.id}`}>
                    <td className="px-4 py-3">
                      <input
                        type="checkbox" aria-label={`Select ${a.name}`} checked={everything || selected.has(a.id)} disabled={everything} data-testid={`desk-member-tick-${a.id}`}
                        onChange={() => setSelected((s) => toggleOne(s, a.id))}
                      />
                    </td>
                    <td className="px-4 py-3 min-w-[12rem]">
                      <Link href={`/desk/accounts/${a.id}`} className="font-medium text-slate-800 hover:underline">{a.name}</Link>
                      {a.status === 'INACTIVE' && <span className="ml-2 text-xs px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">Inactive</span>}
                      {a.dba && <div className="text-xs text-slate-500">DBA {a.dba}</div>}
                    </td>
                    <td className="px-4 py-3 text-slate-600">{[a.city, a.state].filter(Boolean).join(', ') || '—'}</td>
                    <td className="px-4 py-3 text-slate-600 whitespace-nowrap">{mine ? ASSIGNMENT_ROLE_LABELS[mine.role] : '—'}</td>
                    <td className="px-4 py-3 text-slate-600">{others.map((s) => s.name).join(', ') || '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {rows && total > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 mt-4">
          <p className="text-sm text-slate-500" data-testid="desk-member-total">{total.toLocaleString('en-US')} account{total === 1 ? '' : 's'}</p>
          {lastPage > 1 && (
            <div className="flex items-center gap-2">
              <button type="button" className={BUTTON} disabled={page <= 1} onClick={() => setPage((p) => p - 1)} data-testid="desk-member-prev">Previous</button>
              <span className="text-sm text-slate-600">Page {page} of {lastPage}</span>
              <button type="button" className={BUTTON} disabled={page >= lastPage} onClick={() => setPage((p) => p + 1)} data-testid="desk-member-next">Next</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
