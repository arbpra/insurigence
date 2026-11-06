'use client';

import { useEffect, useState } from 'react';
import { dayLabel } from '@/lib/desk/account-form';
import {
  POLICY_STATUS_LABELS, POLICY_TEXT, formFromPolicy, policyChanges, policyFormDirty, premiumLabel,
  type PolicyFormValues, type PolicyStatusValue, type StoredPolicy,
} from '@/lib/desk/policy-form';
import { ApiError, api } from './account-api';

export interface PolicyRow extends StoredPolicy {
  id: string;
  version: string;
  status: PolicyStatusValue;
}

const INPUT = 'w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white';
const LABEL = 'block text-sm font-medium text-slate-700 mb-1';
const ACCENT = 'var(--brand-primary, #05314c)';
const SECONDARY = 'px-4 py-2 rounded-lg text-sm font-medium border border-slate-300 bg-white text-slate-700 disabled:opacity-50';
const ROW_ACTION = 'text-sm underline text-slate-700 disabled:opacity-50';

/** The account's policies, with adding, changing and removing them. */
export function PolicyPanel({ insuredId, policies, canEdit, onChanged, onUnsaved }: {
  insuredId: string;
  policies: PolicyRow[];
  canEdit: boolean;
  onChanged: () => Promise<void>;
  onUnsaved: (unsaved: boolean) => void;
}) {
  // null: no form. 'new': adding. Otherwise the policy being changed.
  const [editing, setEditing] = useState<null | 'new' | PolicyRow>(null);
  const [form, setForm] = useState<PolicyFormValues>(formFromPolicy());
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  // Someone else changed or removed what is on screen.
  const [outOfDate, setOutOfDate] = useState(false);
  const [busy, setBusy] = useState(false);

  const saved = editing && editing !== 'new' ? editing : undefined;
  const dirty = editing !== null && policyFormDirty(form, saved);

  useEffect(() => { onUnsaved(dirty); }, [dirty, onUnsaved]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const open = (target: 'new' | PolicyRow) => {
    setEditing(target);
    setForm(formFromPolicy(target === 'new' ? undefined : target));
    setError('');
    setNotice('');
    setOutOfDate(false);
  };

  const close = () => {
    setEditing(null);
    setError('');
    setOutOfDate(false);
  };

  const refused = (err: unknown) => {
    const changed = err instanceof ApiError && (err.status === 404 || err.code === 'CHANGED_ELSEWHERE');
    setOutOfDate(changed);
    setError(err instanceof ApiError && err.status === 404
      ? 'This policy is no longer available. Someone may have removed it.'
      : err instanceof Error ? err.message : 'Something went wrong.');
  };

  const reload = async () => {
    close();
    await onChanged();
  };

  const save = async () => {
    setError('');
    setNotice('');
    setOutOfDate(false);
    const result = policyChanges(form, saved);
    if ('error' in result) {
      setError(result.error);
      return;
    }
    if (Object.keys(result.changes).length === 0) {
      close();
      return;
    }
    setBusy(true);
    try {
      if (saved) {
        await api(`/api/desk/policies/${encodeURIComponent(saved.id)}`, { method: 'PATCH', body: JSON.stringify({ version: saved.version, ...result.changes }) });
      } else {
        await api(`/api/desk/insureds/${encodeURIComponent(insuredId)}/policies`, { method: 'POST', body: JSON.stringify(result.changes) });
      }
      close();
      setNotice(saved ? 'Policy saved.' : 'Policy added.');
      await onChanged();
    } catch (err) {
      refused(err);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (policy: PolicyRow) => {
    const name = policy.policyNumber || policy.lineOfBusiness || policy.carrierName;
    if (!window.confirm(`Remove policy ${name}? This is for a policy entered by mistake. It can't be undone.`)) return;
    setBusy(true);
    setError('');
    setNotice('');
    setOutOfDate(false);
    try {
      await api(`/api/desk/policies/${encodeURIComponent(policy.id)}`, { method: 'DELETE' });
      setNotice('Policy removed.');
      await onChanged();
    } catch (err) {
      refused(err);
    } finally {
      setBusy(false);
    }
  };

  const text = (key: keyof PolicyFormValues, label: string, opts: { type?: string; max?: number; inputMode?: 'decimal'; hint?: string; autoFocus?: boolean } = {}) => {
    const id = `policy-${key}`;
    return (
      <div>
        <label className={LABEL} htmlFor={id}>{label}</label>
        <input
          id={id} type={opts.type ?? 'text'} inputMode={opts.inputMode} className={INPUT} autoFocus={opts.autoFocus} data-testid={id}
          maxLength={opts.max ?? POLICY_TEXT[key]?.max} value={form[key]}
          onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
        />
        {opts.hint && <p className="text-xs text-slate-500 mt-1">{opts.hint}</p>}
      </div>
    );
  };

  const message = error && (
    <div className="mb-4" role="alert" data-testid="desk-policy-error">
      <p className="text-sm text-red-600">{error}</p>
      {outOfDate && <button type="button" disabled={busy} className={`${SECONDARY} mt-2`} onClick={reload} data-testid="desk-policy-reload">Reload policies{editing ? ' (discards what you typed)' : ''}</button>}
    </div>
  );

  return (
    <section className="bg-white border border-slate-200 rounded-xl p-5 mb-5 min-w-0" data-testid="desk-detail-policies">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <h2 className="text-base font-semibold text-slate-800">Policies{policies.length > 0 ? ` (${policies.length})` : ''}</h2>
        {canEdit && !editing && (
          <button type="button" disabled={busy} className={SECONDARY} onClick={() => open('new')} data-testid="desk-policy-add">Add policy</button>
        )}
      </div>

      {notice && <p className="text-sm text-slate-700 bg-slate-50 border border-slate-200 rounded-lg p-3 mb-4" role="status" data-testid="desk-policy-notice">{notice}</p>}
      {!editing && message}

      {editing && (
        <form
          className="border border-slate-200 rounded-lg p-4 mb-5" data-testid="desk-policy-form" noValidate
          onSubmit={(e) => { e.preventDefault(); save(); }}
        >
          <h3 className="text-sm font-semibold text-slate-800 mb-3">{saved ? 'Change policy' : 'Add policy'}</h3>
          {message}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
            {text('policyNumber', 'Policy number', { autoFocus: true })}
            {text('lineOfBusiness', 'Line of business')}
            {text('carrierName', 'Carrier')}
            {text('effectiveDate', 'Effective date', { type: 'date' })}
            {text('expirationDate', 'Expiration date', { type: 'date' })}
            {text('premium', 'Premium ($)', { inputMode: 'decimal', max: 20 })}
            <div>
              <label className={LABEL} htmlFor="policy-status">Status</label>
              <select
                id="policy-status" className={INPUT} value={form.status} data-testid="policy-status"
                onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as PolicyStatusValue }))}
              >
                {(Object.keys(POLICY_STATUS_LABELS) as PolicyStatusValue[]).map((s) => <option key={s} value={s}>{POLICY_STATUS_LABELS[s]}</option>)}
              </select>
            </div>
            {text('externalRef', 'AMS reference')}
          </div>
          <div className="mb-4">
            <label className={LABEL} htmlFor="policy-notes">Notes</label>
            <textarea
              id="policy-notes" rows={2} className={INPUT} maxLength={POLICY_TEXT.notes.max} value={form.notes} data-testid="policy-notes"
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
            />
            <p className="text-xs text-slate-500 mt-1">Never enter passwords or carrier logins here.</p>
          </div>
          <div className="flex flex-wrap gap-3">
            <button type="submit" disabled={busy} className="px-5 py-2 rounded-lg text-sm font-medium text-white disabled:opacity-60" style={{ backgroundColor: ACCENT }} data-testid="desk-policy-save">{saved ? 'Save policy' : 'Add policy'}</button>
            <button
              type="button" disabled={busy} className={SECONDARY} data-testid="desk-policy-cancel"
              onClick={() => { if (!dirty || window.confirm('Discard this policy?')) close(); }}
            >Cancel</button>
          </div>
        </form>
      )}

      {policies.length === 0 ? (
        !editing && <p className="text-sm text-slate-600" data-testid="desk-policies-empty">No policies on this account yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm" data-testid="desk-policies-table">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-slate-500 border-b border-slate-200">
                <th scope="col" className="py-2 pr-4 font-medium">Policy</th>
                <th scope="col" className="py-2 pr-4 font-medium">Carrier</th>
                <th scope="col" className="py-2 pr-4 font-medium">Effective</th>
                <th scope="col" className="py-2 pr-4 font-medium">Expires</th>
                <th scope="col" className="py-2 pr-4 font-medium text-right">Premium</th>
                <th scope="col" className="py-2 pr-4 font-medium">Status</th>
                {canEdit && <th scope="col" aria-label="Actions" className="py-2 font-medium" />}
              </tr>
            </thead>
            <tbody>
              {policies.map((p) => (
                <tr key={p.id} className="border-b border-slate-100 last:border-0 align-top" data-testid={`desk-policy-${p.id}`}>
                  <td className="py-2 pr-4 text-slate-800 min-w-[10rem]">
                    {p.policyNumber ?? '—'}
                    {p.lineOfBusiness && <div className="text-xs text-slate-500">{p.lineOfBusiness}</div>}
                    {p.notes && <div className="text-xs text-slate-500 whitespace-pre-line mt-0.5">{p.notes}</div>}
                  </td>
                  <td className="py-2 pr-4 text-slate-600">{p.carrierName ?? '—'}</td>
                  <td className="py-2 pr-4 text-slate-600 whitespace-nowrap">{dayLabel(p.effectiveDate)}</td>
                  <td className="py-2 pr-4 text-slate-600 whitespace-nowrap">{dayLabel(p.expirationDate)}</td>
                  <td className="py-2 pr-4 text-slate-600 text-right whitespace-nowrap">{premiumLabel(p.premiumCents)}</td>
                  <td className="py-2 pr-4 text-slate-600 whitespace-nowrap">{POLICY_STATUS_LABELS[p.status]}</td>
                  {canEdit && (
                    <td className="py-2 whitespace-nowrap">
                      <button type="button" disabled={busy || !!editing} className={ROW_ACTION} onClick={() => open(p)} data-testid={`desk-policy-edit-${p.id}`}>Change</button>
                      <button type="button" disabled={busy || !!editing} className={`${ROW_ACTION} ml-3`} onClick={() => remove(p)} data-testid={`desk-policy-remove-${p.id}`}>Remove</button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
