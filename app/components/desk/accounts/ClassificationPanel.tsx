'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { ServiceClass } from '@prisma/client';
import { localDayLabel } from '@/lib/desk/account-form';
import { CLASS_REASON_MAX, SERVICE_CLASSES, SERVICE_CLASS_LABELS, classLabel } from '@/lib/desk/classification-view';
import type { accountClassification } from '@/lib/desk/classification';
import { ApiError, api } from './account-api';

export type AccountClassificationView = NonNullable<Awaited<ReturnType<typeof accountClassification>>>;

const ACCENT = 'var(--brand-primary, #05314c)';
const CARD = 'bg-white border border-slate-200 rounded-xl p-5 mb-5 min-w-0';
const INPUT = 'border border-slate-300 rounded-lg px-3 py-2 text-sm';

/** Module 53: the account's classification, for Desk staff. Agency users never get this panel. */
export function ClassificationPanel({ insuredId, value, onChanged }: { insuredId: string; value: AccountClassificationView; onChanged: () => void }) {
  const [choice, setChoice] = useState<ServiceClass | ''>('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const override = !!value.serviceClass;
  const ready = !!choice && choice !== value.serviceClass && (!override || reason.trim().length > 0);

  async function save() {
    setBusy(true);
    setError('');
    try {
      await api(`/api/desk/insureds/${encodeURIComponent(insuredId)}/classification`, {
        method: 'POST', body: JSON.stringify({ serviceClass: choice, reason: reason.trim() || null, version: value.version }),
      });
      setChoice('');
      setReason('');
      onChanged();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={CARD} data-testid="desk-account-classification">
      <h2 className="text-base font-semibold text-slate-800 mb-1">Classification</h2>
      <p className="text-sm text-slate-800" data-testid="desk-account-class">
        <strong>{classLabel(value.serviceClass)}</strong>
        {value.setBy && value.setAt && <span className="text-slate-500"> · set by {value.setBy}, {localDayLabel(value.setAt)}</span>}
      </p>
      <p className="text-xs text-slate-500 mt-1">Internal. Applies to this account&apos;s requests unless a request has its own. The agency doesn&apos;t see it.</p>

      {value.can.change ? (
        <div className="mt-4 space-y-2">
          <select aria-label="Classification" className={`${INPUT} w-full`} value={choice} onChange={(e) => setChoice(e.target.value as ServiceClass | '')} data-testid="desk-account-class-choice">
            <option value="">{override ? 'Change to…' : 'Choose…'}</option>
            {SERVICE_CLASSES.filter((c) => c !== value.serviceClass).map((c) => <option key={c} value={c}>{SERVICE_CLASS_LABELS[c]}</option>)}
          </select>
          <textarea aria-label="Reason" rows={2} maxLength={CLASS_REASON_MAX} className={`${INPUT} w-full`}
            placeholder={override ? 'Why? Required to change a classification.' : 'Why? (optional)'} value={reason} onChange={(e) => setReason(e.target.value)} data-testid="desk-account-class-reason" />
          {error && <p className="text-sm text-red-600" role="alert" data-testid="desk-account-class-error">{error}</p>}
          <button type="button" className="px-4 py-2 rounded-lg text-sm font-medium text-white disabled:opacity-50" style={{ backgroundColor: ACCENT }} disabled={busy || !ready} onClick={save} data-testid="desk-account-class-save">
            {override ? 'Change' : 'Set'}
          </button>
        </div>
      ) : value.serviceClass && value.can.flag ? (
        <p className="text-xs text-slate-500 mt-3">To ask for a change, flag it from one of the account&apos;s requests.</p>
      ) : null}

      {value.flags && value.flags.length > 0 && (
        <div className="mt-4" data-testid="desk-account-class-flags">
          <h3 className="text-sm font-semibold text-amber-800">Flagged for a change</h3>
          <ul className="mt-1 space-y-1">
            {value.flags.map((f) => (
              <li key={f.id} className="text-sm text-slate-700">
                {f.by} suggests <strong>{SERVICE_CLASS_LABELS[f.suggested]}</strong>
                {f.reference !== null && <> on <Link className="underline" href={`/desk/requests/${f.taskId}`}>#{f.reference}</Link></>}: {f.reason}
              </li>
            ))}
          </ul>
        </div>
      )}

      {value.history && value.history.length > 0 && (
        <details className="mt-4" data-testid="desk-account-class-history">
          <summary className="text-sm text-slate-600 cursor-pointer">History</summary>
          <ul className="mt-2 space-y-1">
            {value.history.map((h) => (
              <li key={h.id} className="text-xs text-slate-600">
                {localDayLabel(h.at)} · {h.by}: {classLabel(h.from, 'none')} → {SERVICE_CLASS_LABELS[h.to]}{h.reason ? ` — ${h.reason}` : ''}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
