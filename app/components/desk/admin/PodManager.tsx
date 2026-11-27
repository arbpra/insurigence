'use client';

import { useCallback, useEffect, useState } from 'react';
import type { DocumentSensitivity } from '@prisma/client';
import { SENSITIVITY_LABELS, DEFAULT_STAFF_SENSITIVITIES } from '@/lib/desk/need-to-know';
import type { getAgencyPodAccess, listPods, listVaPermissions, PodAccessMode } from '@/lib/desk/pod-admin';
import type { DeskAgencyRow } from '@/lib/desk/agency-setup';

type PodsView = Awaited<ReturnType<typeof listPods>>;
type AccessView = Awaited<ReturnType<typeof getAgencyPodAccess>>;
type VaRow = Awaited<ReturnType<typeof listVaPermissions>>[number];
type Tab = 'pods' | 'agencies' | 'permissions';

const INPUT = 'w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white';
const LABEL = 'block text-sm font-medium text-slate-700 mb-1';
const ACTION = 'text-xs font-medium text-slate-600 hover:text-slate-900 underline disabled:opacity-50';
const PRIMARY = { backgroundColor: 'var(--brand-primary, #05314c)' };
const CARD = 'bg-white border border-slate-200 rounded-xl p-5 mb-4';

const returned = (n: number) => (n ? ` ${n} open request${n === 1 ? '' : 's'} went back to the queue.` : '');

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...init });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Something went wrong.');
  return data;
}

/** Pods and members, agency authorization, and VA sensitive-data permissions. */
export function PodManager({ tabs: allowed }: { tabs: Tab[] }) {
  const [tab, setTab] = useState<Tab>(allowed[0]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  /** Runs an action and shows what it reports; `after` reloads the tab's data. */
  const run = async (action: () => Promise<string | void>, after: () => Promise<void>) => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const message = await action();
      if (message) setNotice(message);
      await after();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  };
  const shared = { run, busy, onError: setError };

  const tabs = ([['pods', 'Pods and members'], ['agencies', 'Agency access'], ['permissions', 'VA permissions']] as [Tab, string][]).filter(([key]) => allowed.includes(key));

  return (
    <div data-testid="desk-pods">
      <h1 className="text-2xl font-bold tracking-tight mb-1" style={{ color: 'var(--brand-primary, #05314c)' }} data-testid="page-title">Pods</h1>
      <p className="text-sm text-slate-500 mb-5">Pods, their members, agency authorization and VA permissions.</p>

      <div className="flex flex-wrap gap-2 mb-5" role="tablist">
        {tabs.map(([key, label]) => (
          <button
            key={key} role="tab" aria-selected={tab === key} data-testid={`desk-pods-tab-${key}`}
            onClick={() => { setTab(key); setError(''); setNotice(''); }}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium ${tab === key ? 'text-white' : 'text-slate-600 bg-white border border-slate-200'}`}
            style={tab === key ? PRIMARY : undefined}
          >
            {label}
          </button>
        ))}
      </div>

      {error && <p className="text-sm text-red-600 mb-4" role="alert" data-testid="desk-pods-error">{error}</p>}
      {notice && <p className="text-sm text-slate-700 bg-slate-50 border border-slate-200 rounded-lg p-3 mb-4" role="status" data-testid="desk-pods-notice">{notice}</p>}

      {tab === 'pods' && <PodsTab {...shared} />}
      {tab === 'agencies' && <AgencyAccessTab {...shared} />}
      {tab === 'permissions' && <PermissionsTab {...shared} />}
    </div>
  );
}

interface TabProps {
  run: (action: () => Promise<string | void>, after: () => Promise<void>) => Promise<void>;
  busy: boolean;
  onError: (message: string) => void;
}

function PodsTab({ run, busy, onError }: TabProps) {
  const [view, setView] = useState<PodsView | null>(null);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState({ name: '', description: '' });
  const [editing, setEditing] = useState<string | null>(null);
  const [edit, setEdit] = useState({ name: '', description: '' });
  const [adding, setAdding] = useState<Record<string, string>>({});

  const load = useCallback(async () => setView(await api<PodsView>('/api/desk/admin/pods')), []);
  useEffect(() => { load().catch((err) => onError(err.message)); }, [load, onError]);

  const patch = <T,>(id: string, body: object) => api<T>(`/api/desk/admin/pods/${id}`, { method: 'PATCH', body: JSON.stringify(body) });

  if (!view) return <p className="text-sm text-slate-500">Loading…</p>;

  return (
    <div>
      <div className="mb-4">
        <button onClick={() => setCreating(!creating)} className="px-4 py-2 rounded-lg text-sm font-medium text-white" style={PRIMARY} data-testid="desk-pod-new">New pod</button>
      </div>
      {creating && (
        <form
          className={CARD} data-testid="desk-pod-create"
          onSubmit={(e) => {
            e.preventDefault();
            run(async () => {
              await api('/api/desk/admin/pods', { method: 'POST', body: JSON.stringify(draft) });
              setCreating(false);
              setDraft({ name: '', description: '' });
              return `Pod "${draft.name}" created.`;
            }, load);
          }}
        >
          <label className={LABEL} htmlFor="podName">Name</label>
          <input id="podName" required maxLength={100} className={`${INPUT} mb-3`} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          <label className={LABEL} htmlFor="podDescription">Description</label>
          <input id="podDescription" maxLength={500} className={`${INPUT} mb-3`} value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
          <button type="submit" disabled={busy} className="px-4 py-2 rounded-lg text-sm font-medium text-white disabled:opacity-60" style={PRIMARY}>Create pod</button>
        </form>
      )}

      {view.pods.map((pod) => {
        const memberIds = new Set(pod.members.map((m) => m.id));
        const candidates = view.eligible.filter((u) => !memberIds.has(u.id));
        return (
          <section key={pod.id} className={`${CARD} ${pod.isActive ? '' : 'opacity-70'}`} data-testid="desk-pod">
            {editing === pod.id ? (
              <form
                className="mb-3"
                onSubmit={(e) => { e.preventDefault(); run(async () => { await patch(pod.id, { action: 'update', ...edit }); setEditing(null); }, load); }}
              >
                <input aria-label="Pod name" required maxLength={100} className={`${INPUT} mb-2`} value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
                <input aria-label="Pod description" maxLength={500} className={`${INPUT} mb-2`} value={edit.description} onChange={(e) => setEdit({ ...edit, description: e.target.value })} />
                <span className="flex gap-3">
                  <button type="submit" disabled={busy} className={ACTION}>Save</button>
                  <button type="button" className={ACTION} onClick={() => setEditing(null)}>Cancel</button>
                </span>
              </form>
            ) : (
              <div className="flex flex-col sm:flex-row sm:justify-between gap-2 mb-3">
                <div>
                  <h2 className="text-base font-semibold text-slate-800">{pod.name}{!pod.isActive && <span className="ml-2 text-xs font-medium text-slate-500">Switched off</span>}</h2>
                  {pod.description && <p className="text-xs text-slate-500 mt-0.5">{pod.description}</p>}
                  <p className="text-xs text-slate-500 mt-1">{pod.agencies} {pod.agencies === 1 ? 'agency' : 'agencies'} · {pod.openTasks} open request{pod.openTasks === 1 ? '' : 's'}</p>
                </div>
                <div className="flex gap-3 shrink-0">
                  <button className={ACTION} disabled={busy} onClick={() => { setEditing(pod.id); setEdit({ name: pod.name, description: pod.description ?? '' }); }}>Edit</button>
                  <button
                    className={ACTION} disabled={busy}
                    onClick={() => run(async () => { await patch(pod.id, { action: 'update', isActive: !pod.isActive }); return `${pod.name} was switched ${pod.isActive ? 'off' : 'on'}.`; }, load)}
                  >
                    {pod.isActive ? 'Switch off' : 'Switch on'}
                  </button>
                </div>
              </div>
            )}

            <ul className="divide-y divide-slate-100 mb-3">
              {pod.members.length === 0 && <li className="py-2 text-sm text-amber-700">No members yet.</li>}
              {pod.members.map((m) => (
                <li key={m.id} className="py-2 flex items-center justify-between gap-3 text-sm" data-testid="desk-pod-member">
                  <span className="text-slate-700">
                    {m.name} <span className="text-xs text-slate-400">{m.roleLabel}{m.isActive ? '' : ' · inactive'}</span>
                    {m.isLead && <span className="ml-2 text-xs font-medium text-emerald-700" data-testid="desk-pod-lead">Pod Leader</span>}
                  </span>
                  <span className="flex gap-3 shrink-0">
                  {(m.isLead || (m.canLead && pod.isActive)) && (
                    <button
                      className={ACTION} disabled={busy} data-testid="desk-pod-lead-toggle"
                      title={m.isLead ? undefined : 'Leads this pod: assigns, reassigns and escalates its work'}
                      onClick={() => run(async () => {
                        await patch(pod.id, { action: 'setLead', userId: m.id, isLead: !m.isLead });
                        return m.isLead ? `${m.name} no longer leads ${pod.name}.` : `${m.name} now leads ${pod.name}.`;
                      }, load)}
                    >
                      {m.isLead ? 'Stop leading' : 'Make Pod Leader'}
                    </button>
                  )}
                  <button
                    className={ACTION} disabled={busy}
                    onClick={() => {
                      if (!window.confirm(`Remove ${m.name} from ${pod.name}? Any requests they can no longer see go back to the queue.`)) return;
                      run(async () => {
                        const r = await patch<{ tasksReturned: number }>(pod.id, { action: 'removeMember', userId: m.id });
                        return `${m.name} was removed from ${pod.name}.${returned(r.tasksReturned)}`;
                      }, load);
                    }}
                  >
                    Remove
                  </button>
                  </span>
                </li>
              ))}
            </ul>

            {pod.isActive && (
              <div className="flex gap-2">
                <select aria-label={`Add to ${pod.name}`} className={INPUT} value={adding[pod.id] ?? ''} onChange={(e) => setAdding({ ...adding, [pod.id]: e.target.value })} data-testid="desk-pod-add-select">
                  <option value="">Add a VA or Account Manager…</option>
                  {candidates.map((u) => <option key={u.id} value={u.id}>{u.name} ({u.roleLabel})</option>)}
                </select>
                <button
                  className="px-3 py-2 rounded-lg text-sm font-medium text-white disabled:opacity-60 shrink-0" style={PRIMARY}
                  disabled={busy || !adding[pod.id]} data-testid="desk-pod-add"
                  onClick={() => run(async () => { await patch(pod.id, { action: 'addMember', userId: adding[pod.id] }); setAdding({ ...adding, [pod.id]: '' }); }, load)}
                >
                  Add
                </button>
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

const MODE_LABELS: Record<PodAccessMode, string> = { NONE: 'Not authorized', WHOLE: 'Whole pod', NAMED: 'Named VAs only' };

function AgencyAccessTab({ run, busy, onError }: TabProps) {
  const [agencies, setAgencies] = useState<DeskAgencyRow[] | null>(null);
  const [agencyId, setAgencyId] = useState('');
  const [view, setView] = useState<AccessView | null>(null);
  const [drafts, setDrafts] = useState<Record<string, { mode: PodAccessMode; userIds: string[] }>>({});

  useEffect(() => {
    api<{ agencies: DeskAgencyRow[] }>('/api/desk/admin/agencies').then((d) => setAgencies(d.agencies)).catch((err) => onError(err.message));
  }, [onError]);

  const load = useCallback(async () => {
    if (!agencyId) { setView(null); return; }
    const data = await api<AccessView>(`/api/desk/admin/agencies/${agencyId}/pod-access`);
    setView(data);
    setDrafts(Object.fromEntries(data.pods.map((p) => [p.id, { mode: p.mode, userIds: p.userIds }])));
  }, [agencyId]);
  useEffect(() => { load().catch((err) => onError(err.message)); }, [load, onError]);

  return (
    <div>
      <div className="mb-4 max-w-md">
        <label className={LABEL} htmlFor="accessAgency">Agency</label>
        <select id="accessAgency" className={INPUT} value={agencyId} onChange={(e) => setAgencyId(e.target.value)} data-testid="desk-access-agency">
          <option value="">{agencies ? 'Choose an agency…' : 'Loading…'}</option>
          {agencies?.map((a) => <option key={a.id} value={a.id}>{a.name}{a.deskEnabled ? '' : ' (The Desk off)'}</option>)}
        </select>
      </div>
      {view && !view.agency.deskEnabled && <p className="text-xs text-amber-700 mb-3">The Desk is off for this agency, so nobody can reach its work until it is turned on.</p>}
      {view && !view.canChange && (
        <p className="text-xs text-slate-500 mb-3" data-testid="desk-access-readonly">
          {view.canName
            ? 'Which pods an agency authorizes is part of agency setup. For a pod it authorizes, you choose whether every VA in the pod works for it, or only those you name.'
            : 'Your position can see which pods an agency authorizes, but not change it.'}
        </p>
      )}
      {view?.pods.map((pod) => {
        const draft = drafts[pod.id] ?? { mode: pod.mode, userIds: pod.userIds };
        const setDraft = (patch: Partial<typeof draft>) => setDrafts({ ...drafts, [pod.id]: { ...draft, ...patch } });
        // Without agency setup: only the VAs of a pod already authorized.
        const editable = view.canChange || (view.canName && pod.mode !== 'NONE');
        const modes = (Object.keys(MODE_LABELS) as PodAccessMode[]).filter((m) => view.canChange || m !== 'NONE' || pod.mode === 'NONE');
        return (
          <section key={pod.id} className={CARD} data-testid="desk-access-pod">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <h2 className="text-sm font-semibold text-slate-800">{pod.name}</h2>
              <div className="flex gap-2 items-center">
                <select aria-label={`Access for ${pod.name}`} className={INPUT} value={draft.mode} disabled={!editable} onChange={(e) => setDraft({ mode: e.target.value as PodAccessMode })} data-testid="desk-access-mode">
                  {modes.map((m) => <option key={m} value={m}>{MODE_LABELS[m]}</option>)}
                </select>
                <button
                  className="px-3 py-2 rounded-lg text-sm font-medium text-white disabled:opacity-60" style={PRIMARY} disabled={busy || !editable} data-testid="desk-access-save"
                  onClick={() => run(async () => {
                    const r = await api<{ tasksReturned: number }>(`/api/desk/admin/agencies/${agencyId}/pod-access`, { method: 'PUT', body: JSON.stringify({ podId: pod.id, mode: draft.mode, userIds: draft.mode === 'NAMED' ? draft.userIds : [] }) });
                    return `${pod.name}: saved.${returned(r.tasksReturned)}`;
                  }, load)}
                >
                  Save
                </button>
              </div>
            </div>
            {draft.mode === 'NAMED' && (
              <div className="mt-3 grid sm:grid-cols-2 gap-1">
                {pod.vas.length === 0 && <p className="text-xs text-amber-700">This pod has no VAs yet.</p>}
                {pod.vas.map((va) => (
                  <label key={va.id} className="flex items-center gap-2 text-sm text-slate-700">
                    <input
                      type="checkbox" checked={draft.userIds.includes(va.id)} disabled={!editable}
                      onChange={(e) => setDraft({ userIds: e.target.checked ? [...draft.userIds, va.id] : draft.userIds.filter((id) => id !== va.id) })}
                    />
                    {va.name}{va.isActive ? '' : ' (inactive)'}
                  </label>
                ))}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

function PermissionsTab({ run, busy, onError }: TabProps) {
  const [vas, setVas] = useState<VaRow[] | null>(null);
  const [grantable, setGrantable] = useState<DocumentSensitivity[]>([]);

  const load = useCallback(async () => {
    const data = await api<{ vas: VaRow[]; grantable: DocumentSensitivity[] }>('/api/desk/admin/va-permissions');
    setVas(data.vas);
    setGrantable(data.grantable);
  }, []);
  useEffect(() => { load().catch((err) => onError(err.message)); }, [load, onError]);

  if (!vas) return <p className="text-sm text-slate-500">Loading…</p>;
  const defaults = DEFAULT_STAFF_SENSITIVITIES.map((s) => SENSITIVITY_LABELS[s]).join(' and ');

  return (
    <div>
      <p className="text-xs text-slate-500 mb-3">Every VA can open {defaults} documents on work they are authorized for. Tick to grant more. A change applies right away.</p>
      {vas.length === 0 && <p className="text-sm text-slate-500">No VAs yet.</p>}
      {vas.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-slate-400 border-b border-slate-100">
                <th className="px-4 py-3 font-medium">VA</th>
                {grantable.map((g) => <th key={g} className="px-4 py-3 font-medium">{SENSITIVITY_LABELS[g]}</th>)}
              </tr>
            </thead>
            <tbody>
              {vas.map((va) => (
                <tr key={va.id} className="border-b border-slate-100 last:border-0" data-testid="desk-va-permission">
                  <td className="px-4 py-3 text-slate-800">{va.name}{!va.isActive && <span className="text-xs text-slate-400"> · inactive</span>}</td>
                  {grantable.map((g) => (
                    <td key={g} className="px-4 py-3">
                      <input
                        type="checkbox" disabled={busy} aria-label={`${SENSITIVITY_LABELS[g]} for ${va.name}`} checked={va.granted.includes(g)}
                        onChange={(e) => run(async () => {
                          const granted = e.target.checked ? [...va.granted, g] : va.granted.filter((x) => x !== g);
                          await api('/api/desk/admin/va-permissions', { method: 'PUT', body: JSON.stringify({ userId: va.id, granted }) });
                        }, load)}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
