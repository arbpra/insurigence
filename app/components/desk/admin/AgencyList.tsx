'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { amsDisplayName } from '@/lib/desk/profile';
import type { DeskAgencyRow } from '@/lib/desk/agency-setup';

type DeskFilter = '' | 'on' | 'off';

/** Every agency, with its Desk status, Account Managers, plan and AMS. */
export function AgencyList() {
  const [q, setQ] = useState('');
  const [desk, setDesk] = useState<DeskFilter>('');
  const [agencies, setAgencies] = useState<DeskAgencyRow[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const params = new URLSearchParams();
        if (q.trim()) params.set('q', q.trim());
        if (desk) params.set('desk', desk);
        const res = await fetch(`/api/desk/admin/agencies?${params}`, { signal: controller.signal });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        setAgencies(data.agencies);
        setError('');
      } catch (err) {
        if (!controller.signal.aborted) setError(err instanceof Error && err.message ? err.message : 'Could not load agencies.');
      }
    }, 250);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [q, desk]);

  return (
    <div data-testid="desk-agency-list">
      <h1 className="text-2xl font-bold tracking-tight mb-1" style={{ color: 'var(--brand-primary, #05314c)' }} data-testid="page-title">Agencies</h1>
      <p className="text-sm text-slate-500 mb-6">Turn The Desk on per agency, assign Account Managers, plans and profiles.</p>

      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <input
          type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search agencies"
          aria-label="Search agencies" data-testid="desk-agency-search"
          className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm"
        />
        <select
          value={desk} onChange={(e) => setDesk(e.target.value as DeskFilter)}
          aria-label="Filter by Desk status" data-testid="desk-agency-filter"
          className="border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white"
        >
          <option value="">All agencies</option>
          <option value="on">The Desk on</option>
          <option value="off">The Desk off</option>
        </select>
      </div>

      {error && <p className="text-sm text-red-600 mb-4" role="alert">{error}</p>}
      {!agencies && !error && <p className="text-sm text-slate-500">Loading…</p>}
      {agencies?.length === 0 && <p className="text-sm text-slate-500" data-testid="desk-agency-empty">No agencies match.</p>}

      {agencies && agencies.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-slate-400 border-b border-slate-100">
                <th className="px-4 py-3 font-medium">Agency</th>
                <th className="px-4 py-3 font-medium">The Desk</th>
                <th className="px-4 py-3 font-medium">Account Manager</th>
                <th className="px-4 py-3 font-medium">Plan</th>
                <th className="px-4 py-3 font-medium">AMS</th>
              </tr>
            </thead>
            <tbody>
              {agencies.map((a) => (
                <tr key={a.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium">
                    <Link href={`/super-admin/desk/agencies/${a.id}`} className="hover:underline" style={{ color: 'var(--brand-primary, #05314c)' }} data-testid="desk-agency-link">
                      {a.name}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${a.deskEnabled ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                      {a.deskEnabled ? 'On' : 'Off'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{a.primaryAm ?? '—'}{a.backupAm && <span className="text-slate-400"> · backup {a.backupAm}</span>}</td>
                  <td className="px-4 py-3 text-slate-600">{a.plan ?? '—'}</td>
                  <td className="px-4 py-3 text-slate-600">{amsDisplayName(a.ams, a.amsOther) ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
