'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { api } from '@/components/desk/accounts/account-api';

interface Row {
  id: string; name: string; yourRole: 'PRIMARY' | 'BACKUP' | null;
  primaryAm: string | null; backupAm: string | null; plan: string | null;
  activeAccounts: number; includedAccounts: number | null;
  open: number; overdue: number; waitingOnAgency: number; review: number;
}

const ACCENT = 'var(--brand-primary, #05314c)';
const CARD = 'border border-slate-200 rounded-xl bg-white p-4 sm:p-5 min-w-0';
const INPUT = 'border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white min-w-0';
const SECONDARY = 'px-3 py-1.5 text-sm rounded-lg font-medium border border-slate-300 bg-white text-slate-700';

/** The agencies a manager looks after, each opening its own page. */
export function AgencyList() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [q, setQ] = useState('');

  useEffect(() => {
    setError('');
    api<{ agencies: Row[] }>('/api/desk/agencies')
      .then((r) => setRows(r.agencies))
      .catch((err) => setError(err instanceof Error ? err.message : 'Your agencies could not be loaded.'));
  }, [attempt]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (rows ?? []).filter((r) => !needle || r.name.toLowerCase().includes(needle));
  }, [rows, q]);

  return (
    <div data-testid="desk-agencies">
      <div className="mb-5">
        <h1 className="text-2xl font-bold tracking-tight mb-1" style={{ color: ACCENT }} data-testid="page-title">Agencies</h1>
        <p className="text-sm text-slate-500" data-testid="desk-agencies-summary">
          {rows ? `${rows.length} ${rows.length === 1 ? 'agency' : 'agencies'} using The Desk that you look after.` : 'The agencies you look after.'}
        </p>
      </div>
      {error && (
        <div className="mb-4" role="alert">
          <p className="text-sm text-red-600 mb-2">{error}</p>
          <button type="button" className={SECONDARY} onClick={() => setAttempt((n) => n + 1)}>Try again</button>
        </div>
      )}
      {rows && rows.length > 5 && (
        <input type="search" aria-label="Find an agency" placeholder="Find an agency" className={`${INPUT} w-full sm:w-80 mb-4`} value={q} onChange={(e) => setQ(e.target.value)} data-testid="desk-agencies-search" />
      )}
      <section className={CARD}>
        {!rows ? <p className="text-sm text-slate-500">{error ? '' : 'Loading…'}</p>
          : rows.length === 0 ? <p className="text-sm text-slate-600" data-testid="desk-agencies-empty">No agencies are assigned to you yet. An Insurigence admin assigns Account Managers in Desk setup.</p>
          : shown.length === 0 ? <p className="text-sm text-slate-600">No agency matches “{q.trim()}”.</p>
          : (
            <div className="overflow-x-auto -mx-4 sm:mx-0 px-4 sm:px-0">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-slate-500 border-b border-slate-200">
                    <th className="py-2 pr-4 font-medium">Agency</th>
                    <th className="py-2 pr-4 font-medium">Account Managers</th>
                    <th className="py-2 pr-4 font-medium text-right">Accounts</th>
                    <th className="py-2 pr-4 font-medium text-right">Open</th>
                    <th className="py-2 pr-4 font-medium text-right">Overdue</th>
                    <th className="py-2 pr-4 font-medium text-right whitespace-nowrap">Waiting on them</th>
                    <th className="py-2 font-medium text-right whitespace-nowrap">To review</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((a) => (
                    <tr key={a.id} className="border-b border-slate-100 last:border-0 align-top" data-testid="desk-agencies-row">
                      <td className="py-2 pr-4 min-w-[11rem]">
                        <Link href={`/desk-ops/agencies/${a.id}`} className="font-medium hover:underline break-words" style={{ color: ACCENT }} data-testid="desk-agencies-open">{a.name}</Link>
                        <p className="text-xs text-slate-500">{a.plan ?? 'No plan yet'}{a.yourRole === 'BACKUP' ? ' · you are backup' : ''}</p>
                      </td>
                      <td className="py-2 pr-4 text-slate-700 min-w-[9rem]">
                        {a.primaryAm ?? 'No primary'}{a.backupAm ? <span className="block text-xs text-slate-500">Backup: {a.backupAm}</span> : null}
                      </td>
                      <td className="py-2 pr-4 text-right tabular-nums whitespace-nowrap" data-testid="desk-agencies-accounts">
                        {a.activeAccounts}{a.includedAccounts !== null ? <span className={a.activeAccounts > a.includedAccounts ? 'text-amber-800' : 'text-slate-500'}> / {a.includedAccounts}</span> : null}
                      </td>
                      <td className="py-2 pr-4 text-right tabular-nums">{a.open}</td>
                      <td className={`py-2 pr-4 text-right tabular-nums ${a.overdue ? 'text-red-700 font-medium' : 'text-slate-500'}`}>{a.overdue}</td>
                      <td className="py-2 pr-4 text-right tabular-nums text-slate-700">{a.waitingOnAgency}</td>
                      <td className="py-2 text-right tabular-nums text-slate-700">{a.review}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
      </section>
      {rows && rows.some((r) => r.includedAccounts !== null) && <p className="text-xs text-slate-500 mt-2">Accounts: active accounts / accounts included in the plan.</p>}
    </div>
  );
}
