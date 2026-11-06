'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { BOOK_ACCESS_LABELS, inviteLabel, type BookAccessValue } from '@/lib/desk/team-form';
import { ApiError, api } from '../accounts/account-api';

interface Member {
  id: string;
  version: string;
  name: string;
  email: string;
  role: string;
  roleLabel: string;
  bookAccess: BookAccessValue;
  isActive: boolean;
  inviteAccepted: boolean;
  assignedAccounts: number;
  isSelf: boolean;
}

const ROLES = [['ADMIN', 'Owner / Admin'], ['AGENT', 'Producer'], ['CSR', 'CSR']] as const;
const ACCENT = 'var(--brand-primary, #05314c)';
const INPUT = 'border border-slate-300 rounded-lg px-2 py-1.5 text-sm bg-white disabled:opacity-60';

/** Everyone in the agency: their role, how much of the book they see, and how many accounts they have. */
export function TeamList() {
  const [members, setMembers] = useState<Member[] | null>(null);
  const [error, setError] = useState('');
  const [stale, setStale] = useState(false);
  const [notice, setNotice] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const body = await api<{ members: Member[] }>('/api/desk/team');
      setMembers(body.members);
      setError('');
      setStale(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The team could not be loaded.');
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const save = async (member: Member, change: { role?: string; bookAccess?: BookAccessValue }, message: string) => {
    setBusyId(member.id);
    setError('');
    setNotice('');
    setStale(false);
    try {
      const saved = await api<Member>(`/api/desk/team/${encodeURIComponent(member.id)}`, { method: 'PATCH', body: JSON.stringify({ version: member.version, ...change }) });
      setMembers((all) => all?.map((m) => (m.id === saved.id ? saved : m)) ?? null);
      setNotice(message);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
      setStale(err instanceof ApiError && err.code === 'CHANGED_ELSEWHERE');
    } finally {
      setBusyId(null);
    }
  };

  const changeRole = (m: Member, role: string) => {
    const label = ROLES.find(([r]) => r === role)?.[1] ?? role;
    const warning = role === 'ADMIN'
      ? `Make ${m.name} an Owner / Admin? They will see every account and can manage your team.`
      : m.role === 'ADMIN'
        ? `Change ${m.name} to ${label}? They will see only their assigned accounts and can no longer manage your team.`
        : `Change ${m.name} to ${label}?`;
    if (window.confirm(warning)) save(m, { role }, `${m.name} is now ${label}.`);
  };

  const changeBook = (m: Member, bookAccess: BookAccessValue) => {
    const narrowing = bookAccess === 'ASSIGNED';
    const warning = narrowing
      ? `Limit ${m.name} to assigned accounts? They have ${m.assignedAccounts} assigned and will lose access to the rest.`
      : `Give ${m.name} access to every account in the agency?`;
    if (window.confirm(warning)) save(m, { bookAccess }, narrowing ? `${m.name} now sees only assigned accounts.` : `${m.name} now sees the whole book.`);
  };

  return (
    <div data-testid="desk-team">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-5">
        <div>
          <h1 className="text-2xl font-bold tracking-tight mb-1" style={{ color: ACCENT }} data-testid="page-title">Team access</h1>
          <p className="text-sm text-slate-500">Who in your agency sees which accounts.</p>
        </div>
        <Link href="/team" className="px-4 py-2 rounded-lg text-sm font-medium border border-slate-300 bg-white text-slate-700" data-testid="desk-team-invite">Invite someone</Link>
      </div>

      {notice && <p className="text-sm text-slate-700 bg-slate-50 border border-slate-200 rounded-lg p-3 mb-4" role="status" data-testid="desk-team-notice">{notice}</p>}
      {error && (
        <div className="mb-4" role="alert" data-testid="desk-team-error">
          <p className="text-sm text-red-600">{error}</p>
          {stale && <button type="button" className="text-sm underline text-slate-700 mt-1" onClick={load} data-testid="desk-team-reload">Reload the team</button>}
        </div>
      )}
      {!members && !error && <p className="text-sm text-slate-500" data-testid="desk-team-loading">Loading…</p>}

      {members && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
          <table className="w-full text-sm" data-testid="desk-team-table">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-slate-500 border-b border-slate-200">
                <th scope="col" className="px-4 py-3 font-medium">Person</th>
                <th scope="col" className="px-4 py-3 font-medium">Role</th>
                <th scope="col" className="px-4 py-3 font-medium">Sees</th>
                <th scope="col" className="px-4 py-3 font-medium">Assigned accounts</th>
              </tr>
            </thead>
            <tbody>
              {members.map((m) => {
                const locked = m.isSelf || !m.isActive || busyId === m.id;
                const pending = inviteLabel(m.inviteAccepted);
                return (
                  <tr key={m.id} className="border-b border-slate-100 last:border-0" data-testid={`desk-team-${m.id}`}>
                    <td className="px-4 py-3 min-w-[14rem]">
                      <div className="font-medium text-slate-800 break-words">{m.name}{m.isSelf ? ' (you)' : ''}</div>
                      <div className="text-xs text-slate-500 break-words">{m.email}</div>
                      {!m.isActive && <span className="text-xs px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">Inactive</span>}
                      {m.isActive && pending && <span className="text-xs px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">{pending}</span>}
                    </td>
                    <td className="px-4 py-3">
                      <select
                        aria-label={`Role of ${m.name}`} className={INPUT} value={m.role} disabled={locked} data-testid={`desk-team-role-${m.id}`}
                        onChange={(e) => changeRole(m, e.target.value)}
                      >
                        {ROLES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                      </select>
                    </td>
                    <td className="px-4 py-3">
                      {m.role === 'ADMIN' ? (
                        <span className="text-slate-600 whitespace-nowrap">Whole book</span>
                      ) : (
                        <select
                          aria-label={`What ${m.name} sees`} className={INPUT} value={m.bookAccess} disabled={locked} data-testid={`desk-team-book-${m.id}`}
                          onChange={(e) => changeBook(m, e.target.value as BookAccessValue)}
                        >
                          {(Object.keys(BOOK_ACCESS_LABELS) as BookAccessValue[]).map((b) => <option key={b} value={b}>{BOOK_ACCESS_LABELS[b]}</option>)}
                        </select>
                      )}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <Link href={`/desk/team/${m.id}`} className="underline text-slate-700" data-testid={`desk-team-accounts-${m.id}`}>{m.assignedAccounts.toLocaleString('en-US')} · Manage</Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {members && <p className="text-xs text-slate-500 mt-3">You can&apos;t change your own access. Ask another Owner / Admin.</p>}
    </div>
  );
}
