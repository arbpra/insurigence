'use client';

import { useCallback, useEffect, useState } from 'react';
import type { TeamView } from '@/lib/desk/supervision';

const INPUT = 'w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white';
const LABEL = 'block text-sm font-medium text-slate-700 mb-1';
const ACTION = 'text-xs font-medium text-slate-600 hover:text-slate-900 underline disabled:opacity-50';
const PRIMARY = { backgroundColor: 'var(--brand-primary, #05314c)' };
const CARD = 'bg-white border border-slate-200 rounded-xl p-5 mb-5';

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...init });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Something went wrong.');
  return data;
}

const when = (iso: string) => new Date(iso).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
/** A datetime-local value (local time) for an instant. */
const localInput = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);

/**
 * Account Managers (Module 50): who reports to whom, cover for absences and
 * moving agencies between Account Managers. A Senior AM sees themselves and
 * the people who report to them; whoever reaches every agency sees everyone
 * and sets reporting lines. The API decides; this page only shows what it allows.
 */
export function AccountManagersView() {
  const [team, setTeam] = useState<TeamView | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [cover, setCover] = useState({ absentUserId: '', coverUserId: '', startsAt: localInput(new Date()), endsAt: '', note: '' });
  const [moving, setMoving] = useState<{ id: string; primaryAmId: string; backupAmId: string; version: string } | null>(null);

  const load = useCallback(async () => setTeam(await api<TeamView>('/api/desk/admin/account-managers')), []);
  useEffect(() => { load().catch((err) => setError(err.message)); }, [load]);

  const run = async (action: () => Promise<string>) => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      setNotice(await action());
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  };

  const returned = (n: number) => (n ? ` ${plural(n, 'open request')} they could no longer reach went back to the queue.` : '');

  const submitCover = (e: React.FormEvent) => {
    e.preventDefault();
    run(async () => {
      await api('/api/desk/admin/account-managers/covers', {
        method: 'POST',
        body: JSON.stringify({ ...cover, startsAt: cover.startsAt ? new Date(cover.startsAt).toISOString() : null, endsAt: cover.endsAt ? new Date(cover.endsAt).toISOString() : '' }),
      });
      setCover({ absentUserId: '', coverUserId: '', startsAt: localInput(new Date()), endsAt: '', note: '' });
      return 'Cover arranged.';
    });
  };

  if (!team) {
    return error ? <p className="text-sm text-red-600" role="alert">{error}</p> : <p className="text-sm text-slate-500">Loading…</p>;
  }
  const names = team.managers.map((m) => ({ id: m.id, name: m.isSelf ? `${m.name} (you)` : m.name }));

  return (
    <div data-testid="desk-account-managers">
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight mb-1" style={{ color: 'var(--brand-primary, #05314c)' }} data-testid="page-title">Account Managers</h1>
        <p className="text-sm text-slate-500">
          {team.everyAgency
            ? 'Every Account Manager: who they report to, their agencies and cover for absences.'
            : 'You and the Account Managers who report to you: their agencies and cover for absences.'}
        </p>
      </div>

      {error && <p className="text-sm text-red-600 mb-4" role="alert" data-testid="desk-am-error">{error}</p>}
      {notice && <p className="text-sm text-slate-700 bg-slate-50 border border-slate-200 rounded-lg p-3 mb-4" role="status" data-testid="desk-am-notice">{notice}</p>}

      <section className={CARD} aria-labelledby="am-people">
        <h2 id="am-people" className="text-base font-semibold text-slate-800 mb-3">People</h2>
        {team.managers.length === 0 ? <p className="text-sm text-slate-500">No Account Managers yet.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-slate-400 border-b border-slate-100">
                  <th className="py-2 pr-4 font-medium">Name</th>
                  <th className="py-2 pr-4 font-medium">Reports to</th>
                  <th className="py-2 font-medium">Agencies</th>
                </tr>
              </thead>
              <tbody>
                {team.managers.map((m) => (
                  <tr key={m.id} className="border-b border-slate-100 last:border-0 align-top" data-testid="desk-am-row">
                    <td className="py-2 pr-4">
                      <p className="font-medium text-slate-800">{m.name}{m.isSelf && <span className="text-slate-400 font-normal"> (you)</span>}</p>
                      <p className="text-xs text-slate-500">{m.email}</p>
                    </td>
                    <td className="py-2 pr-4">
                      {team.everyAgency && !m.isSelf ? (
                        <select
                          aria-label={`Who ${m.name} reports to`} className={INPUT} disabled={busy} value={m.reportsTo?.id ?? ''}
                          onChange={(e) => run(async () => {
                            const r = await api<{ tasksReturned: number }>('/api/desk/admin/account-managers/reporting', { method: 'PUT', body: JSON.stringify({ userId: m.id, managerId: e.target.value || null }) });
                            return `Saved.${returned(r.tasksReturned)}`;
                          })}
                        >
                          <option value="">Nobody</option>
                          {team.possibleManagers.filter((p) => p.id !== m.id).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                        </select>
                      ) : <span className="text-slate-600">{m.reportsTo?.name ?? '—'}</span>}
                    </td>
                    <td className="py-2 text-xs text-slate-600">
                      {m.agencies.length === 0 ? '—' : m.agencies.map((a) => <p key={a.id}>{a.name}{a.as === 'BACKUP' && <span className="text-slate-400"> (backup)</span>}</p>)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className={CARD} aria-labelledby="am-cover">
        <h2 id="am-cover" className="text-base font-semibold text-slate-800 mb-1">Cover</h2>
        <p className="text-xs text-slate-500 mb-3">While a cover runs, the person covering works the absent Account Manager&apos;s agencies and is told what they would be told. It ends by itself at the end date.</p>
        {team.covers.length === 0 ? <p className="text-sm text-slate-500 mb-4">No cover arranged.</p> : (
          <ul className="mb-4 divide-y divide-slate-100" data-testid="desk-am-covers">
            {team.covers.map((c) => (
              <li key={c.id} className="py-2 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 text-sm">
                <span>
                  <span className="font-medium text-slate-800">{c.cover.name}</span> covers <span className="font-medium text-slate-800">{c.absent.name}</span>
                  <span className="block text-xs text-slate-500">{c.running ? 'Now' : when(c.startsAt)} until {when(c.endsAt)}{c.note ? ` · ${c.note}` : ''}</span>
                </span>
                {c.canEnd && (
                  <button className={`${ACTION} self-start`} disabled={busy} onClick={() => {
                    if (!confirm(c.running ? `End this cover now? Open requests ${c.cover.name} can no longer reach go back to the queue.` : 'Cancel this cover?')) return;
                    run(async () => {
                      const r = await api<{ tasksReturned: number }>(`/api/desk/admin/account-managers/covers/${c.id}`, { method: 'DELETE' });
                      return `${c.running ? 'Cover ended.' : 'Cover cancelled.'}${returned(r.tasksReturned)}`;
                    });
                  }}>{c.running ? 'End now' : 'Cancel'}</button>
                )}
              </li>
            ))}
          </ul>
        )}
        {names.length > 1 && (
          <form onSubmit={submitCover} className="grid grid-cols-1 sm:grid-cols-2 gap-4" data-testid="desk-am-cover-form">
            <div>
              <label className={LABEL} htmlFor="coverAbsent">Who is away</label>
              <select id="coverAbsent" required className={INPUT} value={cover.absentUserId} onChange={(e) => setCover({ ...cover, absentUserId: e.target.value })}>
                <option value="">Choose…</option>
                {names.map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}
              </select>
            </div>
            <div>
              <label className={LABEL} htmlFor="coverBy">Covered by</label>
              <select id="coverBy" required className={INPUT} value={cover.coverUserId} onChange={(e) => setCover({ ...cover, coverUserId: e.target.value })}>
                <option value="">Choose…</option>
                {names.filter((n) => n.id !== cover.absentUserId).map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}
              </select>
            </div>
            <div>
              <label className={LABEL} htmlFor="coverFrom">From</label>
              <input id="coverFrom" type="datetime-local" required className={INPUT} value={cover.startsAt} onChange={(e) => setCover({ ...cover, startsAt: e.target.value })} />
            </div>
            <div>
              <label className={LABEL} htmlFor="coverUntil">Until</label>
              <input id="coverUntil" type="datetime-local" required className={INPUT} value={cover.endsAt} onChange={(e) => setCover({ ...cover, endsAt: e.target.value })} />
            </div>
            <div className="sm:col-span-2">
              <label className={LABEL} htmlFor="coverNote">Note (optional)</label>
              <input id="coverNote" maxLength={300} className={INPUT} value={cover.note} onChange={(e) => setCover({ ...cover, note: e.target.value })} placeholder="For example: annual leave" />
            </div>
            <div className="sm:col-span-2">
              <button type="submit" disabled={busy} className="px-4 py-2 rounded-lg text-sm font-medium text-white disabled:opacity-60" style={PRIMARY}>Arrange cover</button>
            </div>
          </form>
        )}
      </section>

      <section className={CARD} aria-labelledby="am-agencies">
        <h2 id="am-agencies" className="text-base font-semibold text-slate-800 mb-1">Agencies</h2>
        <p className="text-xs text-slate-500 mb-3">Moving an agency moves its open requests to the new Account Manager. Work someone can no longer reach goes back to the queue.</p>
        {team.agencies.length === 0 ? <p className="text-sm text-slate-500">No agencies.</p> : (
          <ul className="divide-y divide-slate-100">
            {team.agencies.map((a) => (
              <li key={a.id} className="py-2 text-sm" data-testid="desk-am-agency">
                {moving?.id === a.id ? (
                  <form
                    className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end"
                    onSubmit={(e) => {
                      e.preventDefault();
                      run(async () => {
                        const r = await api<{ openTasksMoved: number; stillAssigned: number }>(`/api/desk/admin/account-managers/agencies/${a.id}`, {
                          method: 'PUT', body: JSON.stringify({ primaryAmId: moving.primaryAmId, backupAmId: moving.backupAmId || null, version: moving.version }),
                        });
                        setMoving(null);
                        return [`${a.name} saved.`,
                          r.openTasksMoved ? `${plural(r.openTasksMoved, 'open request')} moved to the new Account Manager.` : '',
                          r.stillAssigned ? `${plural(r.stillAssigned, 'open request')} ${r.stillAssigned === 1 ? 'is' : 'are'} still assigned to someone you removed and should be reassigned.` : ''].filter(Boolean).join(' ');
                      });
                    }}
                  >
                    <p className="sm:col-span-3 font-medium text-slate-800">{a.name}</p>
                    <div>
                      <label className={LABEL} htmlFor={`primary-${a.id}`}>Primary</label>
                      <select id={`primary-${a.id}`} required className={INPUT} value={moving.primaryAmId} onChange={(e) => setMoving({ ...moving, primaryAmId: e.target.value })}>
                        <option value="">Choose…</option>
                        {a.primary && !names.some((n) => n.id === a.primary!.id) && <option value={a.primary.id}>{a.primary.name}</option>}
                        {names.map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className={LABEL} htmlFor={`backup-${a.id}`}>Backup</label>
                      <select id={`backup-${a.id}`} className={INPUT} value={moving.backupAmId} onChange={(e) => setMoving({ ...moving, backupAmId: e.target.value })}>
                        <option value="">None</option>
                        {a.backup && !names.some((n) => n.id === a.backup!.id) && <option value={a.backup.id}>{a.backup.name}</option>}
                        {names.filter((n) => n.id !== moving.primaryAmId).map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}
                      </select>
                    </div>
                    <span className="flex gap-3">
                      <button type="submit" disabled={busy} className="px-3 py-2 rounded-lg text-sm font-medium text-white disabled:opacity-60" style={PRIMARY}>Save</button>
                      <button type="button" className={ACTION} onClick={() => setMoving(null)}>Cancel</button>
                    </span>
                  </form>
                ) : (
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                    <span>
                      <span className="font-medium text-slate-800">{a.name}</span>
                      <span className="block text-xs text-slate-500">Primary: {a.primary?.name ?? 'none'} · Backup: {a.backup?.name ?? 'none'}</span>
                    </span>
                    <button className={`${ACTION} self-start`} disabled={busy} onClick={() => setMoving({ id: a.id, primaryAmId: a.primary?.id ?? '', backupAmId: a.backup?.id ?? '', version: a.version })}>Move</button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
