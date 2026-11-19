'use client';

import { useCallback, useEffect, useState } from 'react';
import type { TaskType } from '@prisma/client';
import { FOLLOW_UP_PLACEHOLDER_HELP, FOLLOW_UP_TEMPLATE_MAX, followUpTitle, templateProblem } from '@/lib/desk/follow-ups';
import type { getFollowUpSetup } from '@/lib/desk/follow-up-admin';

type Setup = Awaited<ReturnType<typeof getFollowUpSetup>>;
type Rule = Setup['rules'][number];

const INPUT = 'w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white';
const LABEL = 'block text-xs font-medium text-slate-600 mb-1';
const ACTION = 'text-xs font-medium text-slate-600 hover:text-slate-900 underline disabled:opacity-50';
const PRIMARY = { backgroundColor: 'var(--brand-primary, #05314c)' };

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...init });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Something went wrong.');
  return data;
}

interface Draft { id?: string; triggerType: string; createType: string; podId: string; titleTemplate: string; billable: boolean }

const emptyDraft = (): Draft => ({ triggerType: '', createType: '', podId: '', titleTemplate: '', billable: false });
const toDraft = (r: Rule): Draft => ({ id: r.id, triggerType: r.triggerType, createType: r.createType, podId: r.podId ?? '', titleTemplate: r.titleTemplate, billable: r.billable });

/** "When a request of one type is completed, create this follow-up." */
export function FollowUpEditor() {
  const [setup, setSetup] = useState<Setup | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);

  const load = useCallback(async () => { setSetup(await api<Setup>('/api/desk/admin/follow-ups')); }, []);
  useEffect(() => { load().catch((err) => setError(err.message)); }, [load]);

  const run = async (action: () => Promise<string>) => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const message = await action();
      await load();
      setNotice(message);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  };

  if (!setup) return error ? <p className="text-sm text-red-600" role="alert">{error}</p> : <p className="text-sm text-slate-500">Loading…</p>;

  const label = (type: string) => setup.types.find((t) => t.type === type)?.label ?? type;
  const routedTo = (type: string) => setup.types.find((t) => t.type === type)?.routedTo ?? null;
  const problem = draft ? templateProblem(draft.titleTemplate) : null;

  const save = (d: Draft) => run(async () => {
    await api('/api/desk/admin/follow-ups', {
      method: 'POST',
      body: JSON.stringify({ ...(d.id ? { id: d.id } : { triggerType: d.triggerType, createType: d.createType }), podId: d.podId || null, titleTemplate: d.titleTemplate, billable: d.billable }),
    });
    setDraft(null);
    return `Rule saved. It applies to ${label(d.triggerType)} requests completed from now on.`;
  });

  const toggle = (r: Rule) => {
    if (r.isActive && !window.confirm(`Switch off this rule? Completing ${r.triggerLabel} will no longer create ${r.createLabel}. Follow-ups already made stay as they are.`)) return;
    run(async () => {
      await api('/api/desk/admin/follow-ups', { method: 'PATCH', body: JSON.stringify({ id: r.id, isActive: !r.isActive }) });
      return r.isActive ? 'Rule switched off.' : 'Rule switched on.';
    });
  };

  return (
    <div data-testid="desk-follow-ups">
      <h1 className="text-2xl font-bold tracking-tight mb-1" style={{ color: 'var(--brand-primary, #05314c)' }} data-testid="page-title">Follow-up rules</h1>
      <p className="text-sm text-slate-500 mb-5 max-w-3xl">
        When a request is completed, the follow-up work is created for the team automatically, such as the AMS update after a renewal.
        A follow-up is an internal subtask of the request: the agency doesn&apos;t see it. Changes apply to requests completed from now on.
      </p>

      {error && <p className="text-sm text-red-600 mb-4" role="alert" data-testid="desk-follow-ups-error">{error}</p>}
      {notice && <p className="text-sm text-slate-700 bg-slate-50 border border-slate-200 rounded-lg p-3 mb-4" role="status" data-testid="desk-follow-ups-notice">{notice}</p>}

      {setup.rules.length === 0 && <p className="text-sm text-slate-500 mb-4">No rules yet.</p>}
      <ul className="grid gap-3 list-none p-0 mb-4">
        {setup.rules.map((r) => (
          <li key={r.id} className={`bg-white border border-slate-200 rounded-xl p-4 ${r.isActive ? '' : 'opacity-70'}`} data-testid="desk-follow-up-rule" data-active={r.isActive}>
            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
              <div className="min-w-0">
                <h2 className="text-sm font-semibold text-slate-800">
                  When <span data-testid="desk-follow-up-trigger">{r.triggerLabel}</span> is completed → <span data-testid="desk-follow-up-create">{r.createLabel}</span>
                  {!r.isActive && <span className="ml-2 text-xs font-medium px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">Off</span>}
                </h2>
                <p className="text-xs text-slate-500 mt-1" data-testid="desk-follow-up-where">
                  {r.goesTo ? <>Goes to {r.goesTo}{r.viaRouting ? ` (where ${r.createLabel} is routed)` : ''}</> : <span className="text-amber-700">{r.createLabel} isn&apos;t routed: its Account Manager triages it</span>}
                  {' · '}{r.billable ? 'Billable' : 'Non-billable'}
                </p>
                <p className="text-xs text-slate-500 mt-0.5 break-words">For request #{setup.example.reference}: <span className="text-slate-700" data-testid="desk-follow-up-example">{r.example}</span></p>
              </div>
              <span className="flex gap-3 shrink-0">
                <button className={ACTION} disabled={busy} onClick={() => { setDraft(toDraft(r)); setNotice(''); }} data-testid="desk-follow-up-edit">Edit</button>
                <button className={ACTION} disabled={busy} onClick={() => toggle(r)} data-testid="desk-follow-up-toggle">{r.isActive ? 'Switch off' : 'Switch on'}</button>
              </span>
            </div>
          </li>
        ))}
      </ul>

      {draft ? (
        <form className="bg-white border border-slate-200 rounded-xl p-4" onSubmit={(e) => { e.preventDefault(); if (!problem) save(draft); }} data-testid="desk-follow-up-form">
          <h2 className="text-sm font-semibold text-slate-800 mb-3">{draft.id ? 'Edit rule' : 'New rule'}</h2>
          <div className="grid sm:grid-cols-2 gap-3 mb-3">
            <div>
              <label className={LABEL} htmlFor="fuTrigger">When this is completed</label>
              <select id="fuTrigger" className={INPUT} required disabled={!!draft.id} value={draft.triggerType} onChange={(e) => setDraft({ ...draft, triggerType: e.target.value })} data-testid="desk-follow-up-form-trigger">
                <option value="">Choose a request type…</option>
                {setup.types.map((t) => <option key={t.type} value={t.type}>{t.label}</option>)}
              </select>
            </div>
            <div>
              <label className={LABEL} htmlFor="fuCreate">Create</label>
              <select id="fuCreate" className={INPUT} required disabled={!!draft.id} value={draft.createType} onChange={(e) => setDraft({ ...draft, createType: e.target.value })} data-testid="desk-follow-up-form-create">
                <option value="">Choose a type…</option>
                {setup.types.map((t) => <option key={t.type} value={t.type}>{t.label}</option>)}
              </select>
            </div>
            <div>
              <label className={LABEL} htmlFor="fuPod">In</label>
              <select id="fuPod" className={INPUT} value={draft.podId} onChange={(e) => setDraft({ ...draft, podId: e.target.value })} data-testid="desk-follow-up-form-pod">
                <option value="">
                  {draft.createType ? (routedTo(draft.createType) ? `Where ${label(draft.createType)} is routed (${routedTo(draft.createType)})` : `Where ${label(draft.createType)} is routed (unrouted now)`) : 'Where its type is routed'}
                </option>
                {setup.pods.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div className="flex items-end">
              <label className="flex items-center gap-2 text-sm text-slate-700 pb-2">
                <input type="checkbox" checked={draft.billable} onChange={(e) => setDraft({ ...draft, billable: e.target.checked })} data-testid="desk-follow-up-form-billable" />
                Billable (counts toward the agency&apos;s plan)
              </label>
            </div>
            <div className="sm:col-span-2">
              <label className={LABEL} htmlFor="fuTitle">Title</label>
              <input id="fuTitle" className={INPUT} required maxLength={FOLLOW_UP_TEMPLATE_MAX} placeholder="Update AMS for completed renewal #{reference}" value={draft.titleTemplate} onChange={(e) => setDraft({ ...draft, titleTemplate: e.target.value })} data-testid="desk-follow-up-form-title" />
              <p className="text-xs text-slate-500 mt-1">{FOLLOW_UP_PLACEHOLDER_HELP}</p>
              {draft.titleTemplate.trim() && (problem
                ? <p className="text-xs text-red-600 mt-1" data-testid="desk-follow-up-form-problem">{problem}</p>
                : <p className="text-xs text-slate-600 mt-1 break-words" data-testid="desk-follow-up-form-preview">For request #{setup.example.reference}: {followUpTitle(draft.titleTemplate, setup.example)}</p>)}
            </div>
          </div>
          <div className="flex gap-3 items-center">
            <button type="submit" disabled={busy || !!problem || !draft.triggerType || !draft.createType} className="px-4 py-2 rounded-lg text-sm font-medium text-white disabled:opacity-60" style={PRIMARY} data-testid="desk-follow-up-save">Save rule</button>
            <button type="button" className={ACTION} onClick={() => setDraft(null)}>Cancel</button>
          </div>
        </form>
      ) : (
        <button className="px-4 py-2 rounded-lg text-sm font-medium text-white disabled:opacity-60" style={PRIMARY} disabled={busy} onClick={() => { setDraft(emptyDraft()); setNotice(''); }} data-testid="desk-follow-up-add">Add rule</button>
      )}
    </div>
  );
}
