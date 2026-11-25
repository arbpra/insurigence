'use client';

import { useCallback, useEffect, useState } from 'react';
import type { DeskAgencyReach, DeskDepartment } from '@prisma/client';
import { DEPARTMENT_LABELS, PERMISSIONS, PERMISSION_GROUPS, REACH_LABELS, REACH_ORDER } from '@/lib/desk/permission-catalogue';
import type { listPositions } from '@/lib/desk/positions';

type View = Awaited<ReturnType<typeof listPositions>>;
type Position = View['positions'][number];
interface Draft {
  name: string;
  description: string;
  department: DeskDepartment;
  reach: DeskAgencyReach;
  reportsToId: string;
  permissions: string[];
}

const INPUT = 'w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white';
const LABEL = 'block text-sm font-medium text-slate-700 mb-1';
const ACTION = 'text-xs font-medium text-slate-600 hover:text-slate-900 underline disabled:opacity-50';
const PRIMARY = { backgroundColor: 'var(--brand-primary, #05314c)' };
const CARD = 'bg-white border border-slate-200 rounded-xl p-5 mb-4';
const DEPARTMENTS = Object.keys(DEPARTMENT_LABELS) as DeskDepartment[];
const LABEL_OF = new Map<string, string>(PERMISSIONS.map((p) => [p.key, p.label]));

/** Open work that went back to the queue because its holder can no longer work it. */
type Released = { tasksReturned: number };
const returned = (r: Released) => (r.tasksReturned ? ` ${r.tasksReturned} open request${r.tasksReturned === 1 ? '' : 's'} went back to the queue.` : '');

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...init });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Something went wrong.');
  return data;
}

const toDraft = (p?: Position): Draft => ({
  name: p?.name ?? '', description: p?.description ?? '', department: p?.department ?? 'VIRTUAL_OPERATIONS',
  reach: p?.reach ?? 'POD', reportsToId: p?.reportsToId ?? '', permissions: p?.permissions ?? [],
});

/** Positions, their permissions and agency reach, and who holds them (Module 47). Super Admin only. */
export function PositionManager() {
  const [view, setView] = useState<View | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const [adding, setAdding] = useState<Record<string, string>>({});

  const load = useCallback(async () => setView(await api<View>('/api/desk/admin/positions')), []);
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

  const save = (position: Position | null, draft: Draft) => run(async () => {
    const body = { ...draft, reportsToId: draft.reportsToId || null };
    let returnedWork = '';
    if (position) returnedWork = returned(await api<Released>(`/api/desk/admin/positions/${position.id}`, { method: 'PATCH', body: JSON.stringify(body) }));
    else await api('/api/desk/admin/positions', { method: 'POST', body: JSON.stringify(body) });
    setEditing(null);
    return position ? `"${draft.name}" saved.${returnedWork}` : `Position "${draft.name}" created.`;
  });

  if (!view) {
    return error ? <p className="text-sm text-red-600" role="alert" data-testid="desk-positions-error">{error}</p> : <p className="text-sm text-slate-500">Loading…</p>;
  }
  const staffName = new Map(view.staff.map((s) => [s.id, s]));

  return (
    <div data-testid="desk-positions">
      <h1 className="text-2xl font-bold tracking-tight mb-1" style={{ color: 'var(--brand-primary, #05314c)' }} data-testid="page-title">Positions</h1>
      <p className="text-sm text-slate-500 mb-3">Each position is a set of permissions and the agencies it reaches. A person can hold several positions and gets everything they allow.</p>
      <p className="text-sm text-slate-700 bg-slate-50 border border-slate-200 rounded-lg p-3 mb-5" data-testid="desk-positions-rule">
        A position never opens another agency&apos;s data or Financial and Personal documents by itself: its reach decides which agencies, and
        Financial and Personal documents need that permission or an individual grant on the Pods page. Reporting lines give no access.
      </p>

      {error && <p className="text-sm text-red-600 mb-4" role="alert" data-testid="desk-positions-error">{error}</p>}
      {notice && <p className="text-sm text-slate-700 bg-slate-50 border border-slate-200 rounded-lg p-3 mb-4" role="status" data-testid="desk-positions-notice">{notice}</p>}

      <div className="mb-4">
        <button onClick={() => setEditing(editing === 'new' ? null : 'new')} disabled={busy} className="px-4 py-2 rounded-lg text-sm font-medium text-white disabled:opacity-50" style={PRIMARY} data-testid="desk-position-new">New position</button>
      </div>
      {editing === 'new' && <PositionForm positions={view.positions} onCancel={() => setEditing(null)} onSave={(d) => save(null, d)} busy={busy} />}

      {DEPARTMENTS.map((department) => {
        const positions = view.positions.filter((p) => p.department === department);
        if (!positions.length) return null;
        return (
          <section key={department} className="mb-6" data-testid={`desk-positions-${department}`}>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 mb-2">{DEPARTMENT_LABELS[department]}</h2>
            {positions.map((p) => {
              const candidates = view.staff.filter((s) => s.isActive && !s.positionIds.includes(p.id));
              return (
                <div key={p.id} className={`${CARD} ${p.isActive ? '' : 'opacity-60'}`} data-testid={`desk-position-${p.code}`}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <h3 className="font-semibold text-slate-900">{p.name}{!p.isActive && <span className="ml-2 text-xs font-medium text-slate-500">switched off</span>}</h3>
                      <p className="text-xs text-slate-500 mt-0.5">
                        {REACH_LABELS[p.reach].label}{p.reportsToName ? ` · reports to ${p.reportsToName}` : ''} · {p.permissions.length} permission{p.permissions.length === 1 ? '' : 's'}
                      </p>
                      {p.description && <p className="text-sm text-slate-600 mt-1">{p.description}</p>}
                    </div>
                    <div className="flex gap-3">
                      <button className={ACTION} disabled={busy} onClick={() => setEditing(editing === p.id ? null : p.id)} data-testid="desk-position-edit">Edit</button>
                      <button
                        className={ACTION} disabled={busy} data-testid="desk-position-toggle"
                        onClick={() => run(async () => {
                          await api(`/api/desk/admin/positions/${p.id}`, { method: 'PATCH', body: JSON.stringify({ isActive: !p.isActive }) });
                          return p.isActive ? `"${p.name}" switched off.` : `"${p.name}" switched on.`;
                        })}
                      >{p.isActive ? 'Switch off' : 'Switch on'}</button>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-1.5 mt-3" data-testid="desk-position-permissions">
                    {p.permissions.length
                      ? p.permissions.map((k) => <span key={k} className="text-xs bg-slate-100 text-slate-700 rounded px-2 py-0.5">{LABEL_OF.get(k) ?? k}</span>)
                      : <span className="text-xs text-slate-500">No permissions</span>}
                  </div>

                  {editing === p.id && <div className="mt-4"><PositionForm position={p} positions={view.positions} onCancel={() => setEditing(null)} onSave={(d) => save(p, d)} busy={busy} /></div>}

                  <div className="mt-4 border-t border-slate-100 pt-3">
                    <p className="text-xs font-medium text-slate-500 mb-2">Held by</p>
                    {p.holders.length === 0 && <p className="text-sm text-slate-500">Nobody yet.</p>}
                    <ul className="space-y-1">
                      {p.holders.map((h) => (
                        <li key={h.id} className="flex items-center justify-between text-sm" data-testid="desk-position-holder">
                          <span>
                            {h.name} <span className="text-slate-500">· {h.email}</span>
                            {!h.isActive && <span className="text-xs text-slate-500"> · deactivated</span>}
                            {(staffName.get(h.id)?.positionIds.length ?? 0) > 1 && <span className="text-xs text-slate-500"> · holds {staffName.get(h.id)!.positionIds.length} positions</span>}
                          </span>
                          <button
                            className={ACTION} disabled={busy} data-testid="desk-position-holder-remove"
                            onClick={() => run(async () => {
                              const r = await api<Released>(`/api/desk/admin/positions/${p.id}/holders?userId=${encodeURIComponent(h.id)}`, { method: 'DELETE' });
                              return `${h.name} no longer holds "${p.name}".${returned(r)}`;
                            })}
                          >Remove</button>
                        </li>
                      ))}
                    </ul>
                    {p.isActive && candidates.length > 0 && (
                      <div className="flex gap-2 mt-3">
                        <select className={INPUT} value={adding[p.id] ?? ''} onChange={(e) => setAdding({ ...adding, [p.id]: e.target.value })} aria-label={`Add someone to ${p.name}`} data-testid="desk-position-holder-select">
                          <option value="">Add someone…</option>
                          {candidates.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.email})</option>)}
                        </select>
                        <button
                          className="px-3 py-2 rounded-lg text-sm font-medium text-white disabled:opacity-50" style={PRIMARY}
                          disabled={busy || !adding[p.id]} data-testid="desk-position-holder-add"
                          onClick={() => run(async () => {
                            const r = await api<Released>(`/api/desk/admin/positions/${p.id}/holders`, { method: 'POST', body: JSON.stringify({ userId: adding[p.id] }) });
                            const who = staffName.get(adding[p.id])?.name ?? 'They';
                            setAdding({ ...adding, [p.id]: '' });
                            return `${who} now holds "${p.name}".${returned(r)}`;
                          })}
                        >Add</button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </section>
        );
      })}
    </div>
  );
}

function PositionForm({ position, positions, onSave, onCancel, busy }: {
  position?: Position; positions: Position[]; onSave: (draft: Draft) => void; onCancel: () => void; busy: boolean;
}) {
  const [draft, setDraft] = useState<Draft>(toDraft(position));
  const toggle = (key: string) => setDraft({ ...draft, permissions: draft.permissions.includes(key) ? draft.permissions.filter((k) => k !== key) : [...draft.permissions, key] });
  return (
    <form className={CARD} data-testid="desk-position-form" onSubmit={(e) => { e.preventDefault(); onSave(draft); }}>
      <div className="grid sm:grid-cols-2 gap-4">
        <label className="block">
          <span className={LABEL}>Name</span>
          <input className={INPUT} value={draft.name} maxLength={80} onChange={(e) => setDraft({ ...draft, name: e.target.value })} data-testid="desk-position-name" required />
        </label>
        <label className="block">
          <span className={LABEL}>Department</span>
          <select className={INPUT} value={draft.department} onChange={(e) => setDraft({ ...draft, department: e.target.value as DeskDepartment })} data-testid="desk-position-department">
            {DEPARTMENTS.map((d) => <option key={d} value={d}>{DEPARTMENT_LABELS[d]}</option>)}
          </select>
        </label>
        <label className="block">
          <span className={LABEL}>Agencies it reaches</span>
          <select className={INPUT} value={draft.reach} onChange={(e) => setDraft({ ...draft, reach: e.target.value as DeskAgencyReach })} data-testid="desk-position-reach">
            {REACH_ORDER.map((r) => <option key={r} value={r}>{REACH_LABELS[r].label}</option>)}
          </select>
          <span className="block text-xs text-slate-500 mt-1">{REACH_LABELS[draft.reach].description}</span>
        </label>
        <label className="block">
          <span className={LABEL}>Reports to</span>
          <select className={INPUT} value={draft.reportsToId} onChange={(e) => setDraft({ ...draft, reportsToId: e.target.value })} data-testid="desk-position-reports-to">
            <option value="">Nobody (top of the chart)</option>
            {positions.filter((p) => p.id !== position?.id).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
      </div>
      <label className="block mt-4">
        <span className={LABEL}>Description</span>
        <textarea className={INPUT} rows={2} maxLength={300} value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} data-testid="desk-position-description" />
      </label>

      <fieldset className="mt-4">
        <legend className={LABEL}>Permissions</legend>
        <div className="grid sm:grid-cols-2 gap-4">
          {PERMISSION_GROUPS.map((group) => (
            <div key={group}>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1">{group}</p>
              {PERMISSIONS.filter((p) => p.group === group).map((p) => (
                <label key={p.key} className="flex gap-2 items-start text-sm py-1">
                  <input type="checkbox" className="mt-1" checked={draft.permissions.includes(p.key)} onChange={() => toggle(p.key)} data-testid={`desk-position-perm-${p.key}`} />
                  <span><span className="font-medium text-slate-800">{p.label}</span><span className="block text-xs text-slate-500">{p.description}</span></span>
                </label>
              ))}
            </div>
          ))}
        </div>
      </fieldset>

      <div className="flex gap-3 mt-4">
        <button type="submit" disabled={busy || draft.name.trim().length < 2} className="px-4 py-2 rounded-lg text-sm font-medium text-white disabled:opacity-50" style={PRIMARY} data-testid="desk-position-save">Save</button>
        <button type="button" onClick={onCancel} className="px-4 py-2 rounded-lg text-sm font-medium text-slate-600 border border-slate-200">Cancel</button>
      </div>
    </form>
  );
}
