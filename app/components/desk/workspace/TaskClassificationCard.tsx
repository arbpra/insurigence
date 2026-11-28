'use client';

import { useState } from 'react';
import type { ClassFlagTarget, ServiceClass } from '@prisma/client';
import { CLASS_REASON_MAX, FLAG_NOTE_MAX, FLAG_TARGET_LABELS, SERVICE_CLASSES, SERVICE_CLASS_LABELS, classLabel } from '@/lib/desk/classification-view';
import type { taskClassification } from '@/lib/desk/classification';
import { api } from '@/components/desk/accounts/account-api';

export type TaskClassificationView = NonNullable<Awaited<ReturnType<typeof taskClassification>>>;

const ACCENT = 'var(--brand-primary, #05314c)';
const CARD = 'border border-slate-200 rounded-xl bg-white p-4 sm:p-5 min-w-0';
const INPUT = 'border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white min-w-0';
const BUTTON = 'px-3 py-1.5 text-sm rounded-lg font-medium disabled:opacity-50';
const PRIMARY = `${BUTTON} text-white`;
const SECONDARY = `${BUTTON} border border-slate-300 bg-white text-slate-700`;

type Act = (run: () => Promise<unknown>, done: string) => Promise<boolean>;

/**
 * Module 53: the request's classification, its own or the account's. Those
 * who may change it do so here (with a reason, kept in the internal history);
 * VAs and Pod Leaders flag it for someone who may.
 */
export function TaskClassificationCard({ taskId, value, busy, act }: { taskId: string; value: TaskClassificationView; busy: boolean; act: Act }) {
  const [mode, setMode] = useState<'change' | 'flag' | 'dismiss' | null>(null);
  const [choice, setChoice] = useState<ServiceClass | 'ACCOUNT' | ''>('');
  const [target, setTarget] = useState<ClassFlagTarget>(value.hasAccount ? 'ACCOUNT' : 'REQUEST');
  const [suggested, setSuggested] = useState<ServiceClass | ''>('');
  const [text, setText] = useState('');
  const url = `/api/desk/tasks/${taskId}`;
  const reset = () => { setMode(null); setChoice(''); setSuggested(''); setText(''); };
  const run = async (fn: () => Promise<unknown>, done: string) => { if (await act(fn, done)) reset(); };

  const source = value.source === 'REQUEST' ? 'set for this request' : value.source === 'ACCOUNT' ? 'from the account' : null;
  const flagCurrent = target === 'ACCOUNT' ? value.account : value.serviceClass;

  return (
    <section className={CARD} data-testid="desk-task-classification">
      <h2 className="text-base font-semibold text-slate-900 mb-1">Account classification</h2>
      <p className="text-sm text-slate-800" data-testid="desk-task-class">
        <strong>{classLabel(value.serviceClass)}</strong>{source && <span className="text-slate-500"> · {source}</span>}
        {value.source === 'REQUEST' && <span className="text-slate-500"> (the account: {classLabel(value.account)})</span>}
      </p>

      {value.flag && (
        <div className="mt-3 text-sm bg-amber-50 border border-amber-200 rounded-lg p-3" data-testid="desk-task-class-flag">
          <p className="text-amber-900"><strong>Flagged for reclassification</strong> by {value.flag.by}: {FLAG_TARGET_LABELS[value.flag.target].toLowerCase()} → {SERVICE_CLASS_LABELS[value.flag.suggested]}</p>
          <p className="text-slate-700 mt-1 whitespace-pre-line">{value.flag.reason}</p>
          {value.flag.target === 'ACCOUNT' && <p className="text-xs text-slate-500 mt-1">Changing the account&apos;s classification on its page settles this flag.</p>}
        </div>
      )}

      <div className="flex flex-wrap gap-2 mt-3">
        {value.can.change && mode !== 'change' && <button type="button" className={SECONDARY} disabled={busy} onClick={() => { reset(); setMode('change'); }} data-testid="desk-task-class-change">{value.serviceClass ? 'Change for this request' : 'Set for this request'}</button>}
        {value.can.flag && mode !== 'flag' && <button type="button" className={SECONDARY} disabled={busy} onClick={() => { reset(); setMode('flag'); }} data-testid="desk-task-class-flag-open">Flag for reclassification</button>}
        {value.can.dismiss && mode !== 'dismiss' && <button type="button" className={SECONDARY} disabled={busy} onClick={() => { reset(); setMode('dismiss'); }} data-testid="desk-task-class-dismiss-open">Dismiss the flag</button>}
      </div>

      {mode === 'change' && (
        <div className="grid gap-2 mt-3">
          <select aria-label="Classification for this request" className={`${INPUT} w-full`} value={choice} onChange={(e) => setChoice(e.target.value as ServiceClass | 'ACCOUNT' | '')} data-testid="desk-task-class-choice">
            <option value="">Choose…</option>
            {value.request && value.hasAccount && <option value="ACCOUNT">The account&apos;s ({classLabel(value.account)})</option>}
            {SERVICE_CLASSES.filter((c) => c !== value.request).map((c) => <option key={c} value={c}>{SERVICE_CLASS_LABELS[c]}</option>)}
          </select>
          <textarea aria-label="Reason" rows={2} maxLength={CLASS_REASON_MAX} className={`${INPUT} w-full`} placeholder="Why? Kept in the internal history." value={text} onChange={(e) => setText(e.target.value)} data-testid="desk-task-class-reason" />
          <div className="flex gap-2">
            <button type="button" className={PRIMARY} style={{ backgroundColor: ACCENT }} disabled={busy || !choice || !text.trim()}
              onClick={() => void run(() => api(`${url}/review`, { method: 'POST', body: JSON.stringify({ serviceClass: choice === 'ACCOUNT' ? null : choice, reason: text.trim() }) }), 'Classification saved for this request.')} data-testid="desk-task-class-save">Save</button>
            <button type="button" className={SECONDARY} onClick={reset}>Cancel</button>
          </div>
        </div>
      )}

      {mode === 'flag' && (
        <div className="grid gap-2 mt-3">
          {value.hasAccount && (
            <select aria-label="What to reclassify" className={`${INPUT} w-full`} value={target} onChange={(e) => setTarget(e.target.value as ClassFlagTarget)} data-testid="desk-task-class-flag-target">
              <option value="ACCOUNT">{FLAG_TARGET_LABELS.ACCOUNT}</option>
              <option value="REQUEST">{FLAG_TARGET_LABELS.REQUEST}</option>
            </select>
          )}
          <select aria-label="Suggested classification" className={`${INPUT} w-full`} value={suggested} onChange={(e) => setSuggested(e.target.value as ServiceClass | '')} data-testid="desk-task-class-flag-suggested">
            <option value="">Suggest…</option>
            {SERVICE_CLASSES.filter((c) => c !== flagCurrent).map((c) => <option key={c} value={c}>{SERVICE_CLASS_LABELS[c]}</option>)}
          </select>
          <textarea aria-label="Reason" rows={2} maxLength={CLASS_REASON_MAX} className={`${INPUT} w-full`} placeholder="Why? For example the number of policies, locations or markets." value={text} onChange={(e) => setText(e.target.value)} data-testid="desk-task-class-flag-reason" />
          <div className="flex gap-2">
            <button type="button" className={PRIMARY} style={{ backgroundColor: ACCENT }} disabled={busy || !suggested || !text.trim()}
              onClick={() => void run(() => api(`${url}/classification`, { method: 'POST', body: JSON.stringify({ target, suggested, reason: text.trim() }) }), 'Flagged. Someone who may change the classification will see it.')} data-testid="desk-task-class-flag-send">Flag</button>
            <button type="button" className={SECONDARY} onClick={reset}>Cancel</button>
          </div>
          <p className="text-xs text-slate-500">A flag changes nothing by itself.</p>
        </div>
      )}

      {mode === 'dismiss' && (
        <div className="grid gap-2 mt-3">
          <textarea aria-label="Note" rows={2} maxLength={FLAG_NOTE_MAX} className={`${INPUT} w-full`} placeholder="Why not? (optional, kept in the internal history)" value={text} onChange={(e) => setText(e.target.value)} data-testid="desk-task-class-dismiss-note" />
          <div className="flex gap-2">
            <button type="button" className={PRIMARY} style={{ backgroundColor: ACCENT }} disabled={busy}
              onClick={() => void run(() => api(`${url}/classification`, { method: 'DELETE', body: JSON.stringify({ note: text.trim() || null }) }), 'Flag dismissed.')} data-testid="desk-task-class-dismiss">Dismiss</button>
            <button type="button" className={SECONDARY} onClick={reset}>Cancel</button>
          </div>
        </div>
      )}
    </section>
  );
}
