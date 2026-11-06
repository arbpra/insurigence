'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ACCOUNT_NAME_MAX, CONTACT_EMAIL_MAX, INSURED_TEXT, changedAccountFields, formFromAccount, newAccountPayload,
  type AccountFormKey, type AccountFormValues,
} from '@/lib/desk/account-form';
import { ApiError, api } from './account-api';

interface SavedAccount extends Partial<Record<AccountFormKey, string | null>> {
  id: string;
  status: 'ACTIVE' | 'INACTIVE';
  version: string;
  openTasks?: number;
  can: { edit: boolean; manage: boolean };
}

const INPUT = 'w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white';
const LABEL = 'block text-sm font-medium text-slate-700 mb-1';
const CARD = 'bg-white border border-slate-200 rounded-xl p-5 mb-5';
const ACCENT = 'var(--brand-primary, #05314c)';
const SECONDARY = 'px-4 py-2 rounded-lg text-sm font-medium border border-slate-300 bg-white text-slate-700 disabled:opacity-50';

const blank = formFromAccount();

/** Add an account (no accountId) or edit one. Policies and assigned staff are on the account's own page. */
export function AccountForm({ accountId }: { accountId?: string }) {
  const router = useRouter();
  const [account, setAccount] = useState<SavedAccount | null>(null);
  const [saved, setSaved] = useState<AccountFormValues>(blank);
  const [form, setForm] = useState<AccountFormValues>(blank);
  const [loadError, setLoadError] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  // A refusal the user can act on: saving a duplicate name anyway, or reloading after someone else's change.
  const [duplicate, setDuplicate] = useState<null | (() => void)>(null);
  const [stale, setStale] = useState(false);

  const editing = !!accountId;
  const dirty = Object.keys(editing ? changedAccountFields(form, saved) : newAccountPayload(form)).length > 0;

  const apply = useCallback((a: SavedAccount) => {
    const values = formFromAccount(a);
    setAccount(a);
    setSaved(values);
    setForm(values);
  }, []);

  const load = useCallback(async () => {
    if (!accountId) return;
    try {
      setLoadError('');
      apply(await api<SavedAccount>(`/api/desk/insureds/${encodeURIComponent(accountId)}`));
      setStale(false);
      setError('');
    } catch (err) {
      setLoadError(err instanceof ApiError && err.status === 404
        ? "This account isn't available. It may not exist, or may not be assigned to you."
        : err instanceof Error ? err.message : 'Something went wrong.');
    }
  }, [accountId, apply]);

  useEffect(() => { load(); }, [load]);

  // Closing or reloading the tab with unsaved typing.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const run = async (action: () => Promise<void>, retry?: () => void) => {
    setBusy(true);
    setError('');
    setNotice('');
    setDuplicate(null);
    setStale(false);
    try {
      await action();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
      if (err instanceof ApiError && err.code === 'DUPLICATE_NAME' && retry) setDuplicate(() => retry);
      if (err instanceof ApiError && err.code === 'CHANGED_ELSEWHERE') setStale(true);
    } finally {
      setBusy(false);
    }
  };

  const save = (allowDuplicate = false) => run(async () => {
    const confirmed = allowDuplicate ? { allowDuplicate: true } : {};
    if (!editing) {
      const created = await api<{ id: string }>('/api/desk/insureds', { method: 'POST', body: JSON.stringify({ ...newAccountPayload(form), ...confirmed }) });
      router.push(`/desk/accounts/${created.id}?created=1`);
      return;
    }
    const changes = changedAccountFields(form, saved);
    if (Object.keys(changes).length === 0) {
      setNotice('No changes to save.');
      return;
    }
    apply(await api<SavedAccount>(`/api/desk/insureds/${encodeURIComponent(accountId!)}`, {
      method: 'PATCH',
      body: JSON.stringify({ version: account!.version, ...changes, ...confirmed }),
    }));
    setNotice('Saved.');
  }, () => save(true));

  const setStatus = (status: 'ACTIVE' | 'INACTIVE', allowDuplicate = false) => run(async () => {
    apply(await api<SavedAccount>(`/api/desk/insureds/${encodeURIComponent(accountId!)}`, {
      method: 'PATCH',
      body: JSON.stringify({ version: account!.version, status, ...(allowDuplicate ? { allowDuplicate: true } : {}) }),
    }));
    setNotice(status === 'ACTIVE' ? 'Account reactivated.' : 'Account deactivated. No new requests can be sent for it.');
  }, () => setStatus(status, true));

  const leave = (e: React.MouseEvent) => {
    if (dirty && !window.confirm('Leave without saving your changes?')) e.preventDefault();
  };

  const field = (key: AccountFormKey, label: string, opts: { max?: number; type?: string; required?: boolean; rows?: number; hint?: string; className?: string } = {}) => {
    const id = `account-${key}`;
    const max = opts.max ?? INSURED_TEXT[key]?.max;
    const props = {
      id, maxLength: max, className: INPUT, required: opts.required, value: form[key], 'data-testid': id,
      onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        setForm((f) => ({ ...f, [key]: e.target.value }));
        // The offer to continue was for the values that were refused.
        setDuplicate(null);
      },
    };
    return (
      <div className={opts.className}>
        <label className={LABEL} htmlFor={id}>{label}{opts.required && <span className="text-red-600"> *</span>}</label>
        {opts.rows ? <textarea rows={opts.rows} {...props} /> : <input type={opts.type ?? 'text'} {...props} />}
        {opts.hint && <p className="text-xs text-slate-500 mt-1">{opts.hint}</p>}
      </div>
    );
  };

  const backHref = editing && account ? `/desk/accounts/${account.id}` : '/desk/accounts';
  const backLink = <Link href={backHref} className="text-sm text-slate-600 hover:underline" onClick={leave} data-testid="desk-account-back">{editing && account ? '← Back to account' : '← Accounts'}</Link>;

  if (loadError) {
    return (
      <div data-testid="desk-account-form">
        {backLink}
        <p className="text-sm text-red-600 mt-4" role="alert" data-testid="desk-account-load-error">{loadError}</p>
      </div>
    );
  }
  if (editing && !account) return <p className="text-sm text-slate-500" data-testid="desk-account-loading">Loading…</p>;

  const open = account?.openTasks ?? 0;

  return (
    <div className="max-w-3xl" data-testid="desk-account-form">
      {backLink}
      <h1 className="text-2xl font-bold tracking-tight mt-2 mb-5" style={{ color: ACCENT }} data-testid="page-title">{editing ? saved.name : 'Add account'}</h1>

      {account?.status === 'INACTIVE' && (
        <p className="text-sm text-slate-700 bg-slate-50 border border-slate-200 rounded-lg p-3 mb-4" data-testid="desk-account-inactive">This account is inactive. No new requests can be sent for it.</p>
      )}
      {notice && <p className="text-sm text-slate-700 bg-slate-50 border border-slate-200 rounded-lg p-3 mb-4" role="status" data-testid="desk-account-notice">{notice}</p>}
      {error && (
        <div className="mb-4" role="alert" data-testid="desk-account-error">
          <p className="text-sm text-red-600">{error}</p>
          {duplicate && (
            <button type="button" disabled={busy} className={`${SECONDARY} mt-2`} onClick={duplicate} data-testid="desk-account-save-anyway">It's a different business: continue anyway</button>
          )}
          {stale && (
            <button type="button" disabled={busy} className={`${SECONDARY} mt-2`} onClick={load} data-testid="desk-account-reload">Reload (discards what you typed)</button>
          )}
        </div>
      )}

      <form onSubmit={(e) => { e.preventDefault(); save(); }} data-testid="desk-account-fields">
        <section className={CARD}>
          <h2 className="text-base font-semibold text-slate-800 mb-4">Business</h2>
          <div className="grid sm:grid-cols-2 gap-4">
            {field('name', 'Account name', { required: true, max: ACCOUNT_NAME_MAX })}
            {field('dba', 'DBA name')}
            {field('industry', 'Industry')}
            {field('website', 'Website')}
            {field('description', 'Description', { rows: 3, className: 'sm:col-span-2' })}
          </div>
        </section>

        <section className={CARD}>
          <h2 className="text-base font-semibold text-slate-800 mb-4">Contact</h2>
          <div className="grid sm:grid-cols-3 gap-4">
            {field('contactName', 'Name')}
            {field('contactEmail', 'Email', { type: 'email', max: CONTACT_EMAIL_MAX })}
            {field('contactPhone', 'Phone', { type: 'tel' })}
          </div>
        </section>

        <section className={CARD}>
          <h2 className="text-base font-semibold text-slate-800 mb-4">Address</h2>
          <div className="grid sm:grid-cols-6 gap-4">
            {field('addressLine1', 'Address', { className: 'sm:col-span-6' })}
            {field('addressLine2', 'Address line 2', { className: 'sm:col-span-6' })}
            {field('city', 'City', { className: 'sm:col-span-3' })}
            {field('state', 'State', { className: 'sm:col-span-1' })}
            {field('postalCode', 'Postal code', { className: 'sm:col-span-2' })}
          </div>
        </section>

        <section className={CARD}>
          <h2 className="text-base font-semibold text-slate-800 mb-4">Other</h2>
          <div className="grid gap-4">
            {field('externalRef', 'AMS reference', { hint: "This account's ID or code in your AMS, if it has one." })}
            {field('notes', 'Notes', { rows: 4, hint: 'Never enter passwords or carrier logins here.' })}
          </div>
        </section>

        <div className="flex flex-wrap items-center gap-3 mb-5">
          <button type="submit" disabled={busy} className="px-5 py-2.5 rounded-lg text-sm font-medium text-white disabled:opacity-60" style={{ backgroundColor: ACCENT }} data-testid="desk-account-save">
            {editing ? 'Save changes' : 'Add account'}
          </button>
          <Link href={backHref} className={SECONDARY} onClick={leave} data-testid="desk-account-cancel">{editing ? 'Back to account' : 'Cancel'}</Link>
        </div>
      </form>

      {account?.can.manage && (
        <section className={CARD} data-testid="desk-account-status">
          <h2 className="text-base font-semibold text-slate-800 mb-2">Account status</h2>
          {account.status === 'ACTIVE' ? (
            <>
              <p className="text-sm text-slate-600 mb-3">
                {open > 0
                  ? `This account has ${open} open request${open === 1 ? '' : 's'}, which must be completed or cancelled before it can be deactivated.`
                  : 'Deactivating keeps the account and its history, and stops new requests being sent for it.'}
              </p>
              <button
                type="button" disabled={busy || dirty || open > 0} className={SECONDARY} data-testid="desk-account-deactivate"
                onClick={() => { if (window.confirm(`Deactivate ${saved.name}? It stays on record and can be reactivated later.`)) setStatus('INACTIVE'); }}
              >Deactivate account</button>
            </>
          ) : (
            <button type="button" disabled={busy || dirty} className={SECONDARY} onClick={() => setStatus('ACTIVE')} data-testid="desk-account-reactivate">Reactivate account</button>
          )}
          {dirty && <p className="text-xs text-slate-500 mt-2">Save or discard your changes first.</p>}
        </section>
      )}
    </div>
  );
}
