'use client';

import { useCallback, useEffect, useState } from 'react';
import type { SlaTargetKind, TaskComplexity, TaskPriority, TaskType } from '@prisma/client';
import { COMPLEXITY_LABELS, PRIORITY_LABELS } from '@/lib/desk/service-levels';
import type { getRoutingSetup } from '@/lib/desk/routing-admin';

type Setup = Awaited<ReturnType<typeof getRoutingSetup>>;
type TypeRow = Setup['types'][number];
type TargetRow = TypeRow['targets'][number];

const INPUT = 'w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white';
const LABEL = 'block text-xs font-medium text-slate-600 mb-1';
const ACTION = 'text-xs font-medium text-slate-600 hover:text-slate-900 underline disabled:opacity-50';
const PRIMARY = { backgroundColor: 'var(--brand-primary, #05314c)' };
const PRIORITIES = Object.keys(PRIORITY_LABELS) as TaskPriority[];
const COMPLEXITIES = Object.keys(COMPLEXITY_LABELS) as TaskComplexity[];

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...init });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Something went wrong.');
  return data;
}

interface TargetDraft {
  id?: string;
  complexity: string;
  priority: string;
  kind: SlaTargetKind;
  unit: 'hours' | 'days';
  amount: string;
  opens: string;
  due: string;
  note: string;
}

const emptyDraft = (): TargetDraft => ({ complexity: '', priority: '', kind: 'BUSINESS_TIME', unit: 'days', amount: '', opens: '', due: '', note: '' });

const toDraft = (t: TargetRow): TargetDraft => ({
  id: t.id,
  complexity: t.complexity ?? '',
  priority: t.priority ?? '',
  kind: t.kind,
  unit: t.businessHours !== null ? 'hours' : 'days',
  amount: String(t.businessHours ?? t.businessDays ?? ''),
  opens: t.opensDaysBeforeExpiration === null ? '' : String(t.opensDaysBeforeExpiration),
  due: t.dueDaysBeforeExpiration === null ? '' : String(t.dueDaysBeforeExpiration),
  note: t.note ?? '',
});

const num = (text: string) => (text.trim() === '' ? null : Number(text));

/** Which pod each request type goes to, and the targets for it, for the Desk or one agency. */
export function RoutingEditor() {
  const [agencyId, setAgencyId] = useState('');
  const [setup, setSetup] = useState<Setup | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [drafting, setDrafting] = useState<{ type: TaskType; draft: TargetDraft } | null>(null);

  const load = useCallback(async () => {
    setSetup(await api<Setup>(`/api/desk/admin/routing${agencyId ? `?agencyId=${agencyId}` : ''}`));
  }, [agencyId]);
  useEffect(() => { load().catch((err) => setError(err.message)); }, [load]);

  const run = async (action: () => Promise<string | void>) => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const message = await action();
      if (message) setNotice(message);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  };

  const saveRouting = (row: TypeRow, patch: { podId?: string | null; defaultPriority?: string }) => run(async () => {
    await api('/api/desk/admin/routing', { method: 'PUT', body: JSON.stringify({ taskType: row.type, podId: row.podId, defaultPriority: row.defaultPriority, ...patch }) });
    return `${row.label}: saved. This applies to new requests; open ones stay where they are.`;
  });

  const saveTarget = (type: TaskType, d: TargetDraft) => run(async () => {
    const business = d.kind === 'BUSINESS_TIME';
    await api('/api/desk/admin/service-levels', {
      method: 'POST',
      body: JSON.stringify({
        ...(d.id ? { id: d.id } : { taskType: type, complexity: d.complexity || null, priority: d.priority || null, agencyId: agencyId || null }),
        kind: d.kind,
        businessHours: business && d.unit === 'hours' ? num(d.amount) : null,
        businessDays: business && d.unit === 'days' ? num(d.amount) : null,
        opensDaysBeforeExpiration: business ? null : num(d.opens),
        dueDaysBeforeExpiration: business ? null : num(d.due),
        note: d.note,
      }),
    });
    setDrafting(null);
    return 'Target saved. This applies to new requests; open ones keep the target they started with.';
  });

  if (!setup) return error ? <p className="text-sm text-red-600" role="alert">{error}</p> : <p className="text-sm text-slate-500">Loading…</p>;

  const agencyView = !!agencyId;
  const targetName = (t: TargetRow) => [t.complexity ? COMPLEXITY_LABELS[t.complexity] : 'Any complexity', t.priority ? `${PRIORITY_LABELS[t.priority]} priority` : 'any priority'].join(', ');

  return (
    <div data-testid="desk-routing">
      <h1 className="text-2xl font-bold tracking-tight mb-1" style={{ color: 'var(--brand-primary, #05314c)' }} data-testid="page-title">Routing &amp; targets</h1>
      <p className="text-sm text-slate-500 mb-5">Where each request type goes and its internal service-level targets. Changes apply to new requests.</p>

      <div className="mb-5 max-w-md">
        <label className={LABEL} htmlFor="routingScope">Showing</label>
        <select id="routingScope" className={INPUT} value={agencyId} onChange={(e) => { setAgencyId(e.target.value); setDrafting(null); setNotice(''); }} data-testid="desk-routing-scope">
          <option value="">Desk defaults (all agencies)</option>
          {setup.agencies.map((a) => <option key={a.id} value={a.id}>Agreement: {a.name}</option>)}
        </select>
        {agencyView && <p className="text-xs text-slate-500 mt-1">An agreement target replaces the Desk default for this agency. Routing is the same for every agency.</p>}
      </div>

      {error && <p className="text-sm text-red-600 mb-4" role="alert" data-testid="desk-routing-error">{error}</p>}
      {notice && <p className="text-sm text-slate-700 bg-slate-50 border border-slate-200 rounded-lg p-3 mb-4" role="status" data-testid="desk-routing-notice">{notice}</p>}

      {setup.types.map((row) => {
        const editing = drafting?.type === row.type ? drafting.draft : null;
        const setDraft = (patch: Partial<TargetDraft>) => setDrafting({ type: row.type, draft: { ...editing!, ...patch } });
        const applies = [
          row.effective.standard?.description === row.effective.complex?.description
            ? `All: ${row.effective.standard?.description ?? 'no target'}`
            : `Standard: ${row.effective.standard?.description ?? 'no target'} · Complex: ${row.effective.complex?.description ?? 'no target'}`,
        ][0];
        return (
          <section key={row.type} className="bg-white border border-slate-200 rounded-xl p-4 mb-3" data-testid="desk-routing-type">
            <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-3">
              <div className="min-w-0">
                <h2 className="text-sm font-semibold text-slate-800">{row.label}</h2>
                <p className={`text-xs mt-0.5 ${row.effective.standard || row.effective.complex ? 'text-slate-500' : 'text-amber-700'}`} data-testid="desk-routing-applies">{applies}</p>
              </div>
              {!agencyView && (
                <div className="grid grid-cols-2 gap-2 lg:w-96 shrink-0">
                  <div>
                    <label className={LABEL} htmlFor={`pod-${row.type}`}>Pod</label>
                    <select id={`pod-${row.type}`} className={INPUT} disabled={busy} value={row.podId ?? ''} onChange={(e) => saveRouting(row, { podId: e.target.value || null })} data-testid={`desk-routing-pod-${row.type}`}>
                      <option value="">Unrouted (Account Manager triages)</option>
                      {setup.pods.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className={LABEL} htmlFor={`priority-${row.type}`}>Default priority</label>
                    <select id={`priority-${row.type}`} className={INPUT} disabled={busy || !row.podId} value={row.defaultPriority} onChange={(e) => saveRouting(row, { defaultPriority: e.target.value })} data-testid={`desk-routing-priority-${row.type}`}>
                      {PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_LABELS[p]}</option>)}
                    </select>
                  </div>
                </div>
              )}
            </div>

            <ul className="mt-3 divide-y divide-slate-100">
              {row.targets.map((t) => (
                <li key={t.id} className="py-2 flex items-center justify-between gap-3 text-sm" data-testid="desk-routing-target">
                  <span className="text-slate-700">{targetName(t)}: <strong className="font-medium">{t.description}</strong>{t.note && <span className="block text-xs text-slate-400">{t.note}</span>}</span>
                  <span className="flex gap-3 shrink-0">
                    <button className={ACTION} disabled={busy} onClick={() => setDrafting({ type: row.type, draft: toDraft(t) })}>Edit</button>
                    <button
                      className={ACTION} disabled={busy}
                      onClick={() => {
                        if (!window.confirm(`Remove this target for ${row.label}? New requests will fall back to the next target that applies, or have none.`)) return;
                        run(async () => { await api(`/api/desk/admin/service-levels?id=${t.id}`, { method: 'DELETE' }); return 'Target removed.'; });
                      }}
                    >
                      Remove
                    </button>
                  </span>
                </li>
              ))}
            </ul>

            {editing ? (
              <form className="mt-3 border-t border-slate-100 pt-3" onSubmit={(e) => { e.preventDefault(); saveTarget(row.type, editing); }} data-testid="desk-target-form">
                <div className="grid sm:grid-cols-3 gap-3 mb-3">
                  <div>
                    <label className={LABEL} htmlFor="targetComplexity">Complexity</label>
                    <select id="targetComplexity" className={INPUT} disabled={!!editing.id} value={editing.complexity} onChange={(e) => setDraft({ complexity: e.target.value })}>
                      <option value="">Any</option>
                      {COMPLEXITIES.map((c) => <option key={c} value={c}>{COMPLEXITY_LABELS[c]}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className={LABEL} htmlFor="targetPriority">Priority</label>
                    <select id="targetPriority" className={INPUT} disabled={!!editing.id} value={editing.priority} onChange={(e) => setDraft({ priority: e.target.value })}>
                      <option value="">Any</option>
                      {PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_LABELS[p]}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className={LABEL} htmlFor="targetKind">Measured by</label>
                    <select id="targetKind" className={INPUT} value={editing.kind} onChange={(e) => setDraft({ kind: e.target.value as SlaTargetKind })}>
                      <option value="BUSINESS_TIME">Business time</option>
                      <option value="BEFORE_EXPIRATION">Days before expiration</option>
                    </select>
                  </div>
                  {editing.kind === 'BUSINESS_TIME' ? (
                    <>
                      <div>
                        <label className={LABEL} htmlFor="targetAmount">Due within</label>
                        <input id="targetAmount" type="number" min="1" step="1" required className={INPUT} value={editing.amount} onChange={(e) => setDraft({ amount: e.target.value })} />
                      </div>
                      <div>
                        <label className={LABEL} htmlFor="targetUnit">Unit</label>
                        <select id="targetUnit" className={INPUT} value={editing.unit} onChange={(e) => setDraft({ unit: e.target.value as TargetDraft['unit'] })}>
                          <option value="hours">Business hours</option>
                          <option value="days">Business days</option>
                        </select>
                      </div>
                    </>
                  ) : (
                    <>
                      <div>
                        <label className={LABEL} htmlFor="targetOpens">Opens (days before)</label>
                        <input id="targetOpens" type="number" min="1" step="1" className={INPUT} value={editing.opens} onChange={(e) => setDraft({ opens: e.target.value })} />
                      </div>
                      <div>
                        <label className={LABEL} htmlFor="targetDue">Due (days before)</label>
                        <input id="targetDue" type="number" min="1" step="1" required className={INPUT} value={editing.due} onChange={(e) => setDraft({ due: e.target.value })} />
                      </div>
                    </>
                  )}
                  <div className="sm:col-span-3">
                    <label className={LABEL} htmlFor="targetNote">Note</label>
                    <input id="targetNote" maxLength={300} className={INPUT} value={editing.note} onChange={(e) => setDraft({ note: e.target.value })} />
                  </div>
                </div>
                <div className="flex gap-3 items-center">
                  <button type="submit" disabled={busy} className="px-4 py-2 rounded-lg text-sm font-medium text-white disabled:opacity-60" style={PRIMARY} data-testid="desk-target-save">Save target</button>
                  <button type="button" className={ACTION} onClick={() => setDrafting(null)}>Cancel</button>
                </div>
              </form>
            ) : (
              <button className={`${ACTION} mt-2`} disabled={busy} onClick={() => setDrafting({ type: row.type, draft: emptyDraft() })} data-testid={`desk-target-add-${row.type}`}>
                Add {agencyView ? 'agreement ' : ''}target
              </button>
            )}
          </section>
        );
      })}
    </div>
  );
}
