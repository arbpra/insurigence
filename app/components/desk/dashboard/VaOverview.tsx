'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/components/desk/accounts/account-api';

interface Counts { waiting: number; overdue: number; mine: number }

const ACCENT = 'var(--brand-primary, #05314c)';
const CARD = 'border border-slate-200 rounded-xl bg-white p-4 sm:p-5 min-w-0';

/** A VA's overview: their own work and the queue they pick from. Nothing agency-wide (Q4). */
export function VaOverview() {
  const [counts, setCounts] = useState<Counts | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api<{ counts: Counts }>('/api/desk/queue')
      .then((o) => setCounts(o.counts))
      .catch((err) => setError(err instanceof Error ? err.message : 'Your work could not be loaded.'));
  }, []);

  return (
    <div data-testid="desk-va-overview">
      <h1 className="text-2xl font-bold tracking-tight mb-5" style={{ color: ACCENT }} data-testid="page-title">Overview</h1>
      {error && <p className="text-sm text-red-600 mb-4" role="alert">{error}</p>}
      <div className="grid gap-4 sm:grid-cols-2">
        <Link href="/desk-ops/my-tasks" className={`${CARD} hover:border-slate-300`} data-testid="desk-va-mine">
          <p className="text-sm text-slate-500">My tasks</p>
          <p className="text-3xl font-semibold text-slate-900 mt-1">{counts ? counts.mine : '…'}</p>
          <p className="text-sm text-slate-600 mt-1">open {counts?.mine === 1 ? 'task' : 'tasks'} you hold</p>
        </Link>
        <Link href="/desk-ops/queue" className={`${CARD} hover:border-slate-300`} data-testid="desk-va-queue">
          <p className="text-sm text-slate-500">Pod queue</p>
          <p className="text-3xl font-semibold text-slate-900 mt-1">{counts ? counts.waiting : '…'}</p>
          <p className="text-sm text-slate-600 mt-1">
            waiting to be picked up{counts && counts.overdue > 0 ? <>, <span className="text-red-700 font-medium">{counts.overdue} overdue</span></> : null}
          </p>
        </Link>
      </div>
    </div>
  );
}
