'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type { DocumentSensitivity, TaskType } from '@prisma/client';
import {
  AGENCY_REQUEST_TYPES, COMPLEXITY_HINTS, REQUEST_DETAILS_MAX, REQUEST_TITLE_MAX,
  blankRequest, missingFields, requestDirty, requestPayload, suggestedTitle, type RequestFormValues,
} from '@/lib/desk/request-form';
import { CATEGORY_HINTS, DOCUMENT_ACCEPT, DOCUMENT_KINDS_TEXT, MAX_DOCUMENT_BYTES, MAX_FILES_PER_SEND, formatBytes, precheckDocument } from '@/lib/desk/document-files';
import { SENSITIVITY_LABELS } from '@/lib/desk/need-to-know';
import { ApiError, api } from '../accounts/account-api';

interface Policy {
  id: string;
  policyNumber: string | null;
  lineOfBusiness: string | null;
  carrierName: string | null;
  expirationDate: string | null;
  status: string;
}
interface Account { id: string; name: string; dba: string | null; status: 'ACTIVE' | 'INACTIVE'; policies: Policy[] }
interface Found { id: string; name: string; dba: string | null; city: string | null; state: string | null }
/** A file chosen to attach. The category has no default: the sender classifies each one. */
interface Attachment { key: number; file: File; sensitivity: DocumentSensitivity | ''; problem: string | null }
interface Attached { name: string; error: string | null }
const CATEGORIES = Object.keys(SENSITIVITY_LABELS) as DocumentSensitivity[];

/** Sends one file to a request. Not through api(): the body is a form, not JSON. */
async function attach(taskId: string, a: Attachment): Promise<string | null> {
  const body = new FormData();
  body.append('file', a.file);
  body.append('sensitivity', a.sensitivity);
  try {
    const res = await fetch(`/api/desk/tasks/${encodeURIComponent(taskId)}/documents`, { method: 'POST', body });
    if (res.ok) return null;
    const answer = await res.json().catch(() => ({}));
    return answer.error || 'It could not be attached.';
  } catch {
    return 'The connection dropped while sending it.';
  }
}

interface Sent { id: string; reference: number; typeLabel: string; title: string; statusLabel: string; insured: { id: string; name: string } | null }

const INPUT = 'w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white';
const LABEL = 'block text-sm font-medium text-slate-700 mb-1';
const CARD = 'bg-white border border-slate-200 rounded-xl p-5 mb-5';
const ACCENT = 'var(--brand-primary, #05314c)';
const SECONDARY = 'px-4 py-2 rounded-lg text-sm font-medium border border-slate-300 bg-white text-slate-700 disabled:opacity-50';
const NOTE = 'text-sm text-slate-700 bg-slate-50 border border-slate-200 rounded-lg p-3 mb-4';

const message = (err: unknown) => (err instanceof Error ? err.message : 'Something went wrong.');

function policyLabel(p: Policy) {
  const parts = [p.policyNumber || 'No number', p.lineOfBusiness, p.carrierName].filter(Boolean);
  if (p.expirationDate) parts.push(`expires ${p.expirationDate}`);
  if (p.status !== 'ACTIVE') parts.push(p.status.toLowerCase().replace(/_/g, ' '));
  return parts.join(' · ');
}

// Current policies first, then by expiration.
const byRelevance = (a: Policy, b: Policy) =>
  Number(b.status === 'ACTIVE') - Number(a.status === 'ACTIVE') || (a.expirationDate ?? '9999').localeCompare(b.expirationDate ?? '9999');

/** The agency's form for sending a service request to its Desk team. */
export function RequestForm({ insuredId }: { insuredId: string | null }) {
  const [start] = useState(() => blankRequest(insuredId ?? ''));
  const [form, setForm] = useState<RequestFormValues>(start);
  const [account, setAccount] = useState<Account | null>(null);
  const [accountError, setAccountError] = useState('');
  const [loadingAccount, setLoadingAccount] = useState(!!insuredId);
  const [search, setSearch] = useState('');
  const [found, setFound] = useState<Found[] | null>(null);
  const [searchError, setSearchError] = useState('');
  const [titleEdited, setTitleEdited] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [problems, setProblems] = useState<string[]>([]);
  const [sent, setSent] = useState<Sent | null>(null);
  const [files, setFiles] = useState<Attachment[]>([]);
  const [attached, setAttached] = useState<Attached[]>([]);
  const [progress, setProgress] = useState('');
  const fileKey = useRef(0);
  const searchSeq = useRef(0);

  const title = titleEdited ? form.title : suggestedTitle(form.type, account?.name ?? null);
  const values = { ...form, title };
  const dirty = !sent && (requestDirty({ ...form, title: titleEdited ? form.title : '' }, start) || titleEdited || files.length > 0);
  const set = (change: Partial<RequestFormValues>) => { setForm((f) => ({ ...f, ...change })); setProblems([]); setError(''); };

  const chooseAccount = useCallback(async (id: string) => {
    setLoadingAccount(true);
    setAccountError('');
    try {
      const a = await api<Account>(`/api/desk/insureds/${encodeURIComponent(id)}`);
      setAccount({ ...a, policies: [...(a.policies ?? [])].sort(byRelevance) });
      setForm((f) => ({ ...f, insuredId: a.id, policyId: '' }));
    } catch (err) {
      setAccount(null);
      setForm((f) => ({ ...f, insuredId: '', policyId: '' }));
      setAccountError(err instanceof ApiError && err.status === 404
        ? "That account isn't available. It may not exist, or may not be assigned to you. Search for another below."
        : message(err));
    } finally {
      setLoadingAccount(false);
    }
  }, []);

  useEffect(() => { if (insuredId) chooseAccount(insuredId); }, [insuredId, chooseAccount]);

  // Search as the user types, keeping only the latest answer.
  useEffect(() => {
    const q = search.trim();
    if (!q) { setFound(null); setSearchError(''); return; }
    const seq = ++searchSeq.current;
    const timer = setTimeout(async () => {
      try {
        const r = await api<{ insureds: Found[] }>(`/api/desk/insureds?status=ACTIVE&pageSize=8&q=${encodeURIComponent(q)}`);
        if (seq === searchSeq.current) { setFound(r.insureds); setSearchError(''); }
      } catch (err) {
        if (seq === searchSeq.current) { setFound(null); setSearchError(message(err)); }
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const leave = (e: React.MouseEvent) => {
    if (dirty && !window.confirm('Leave without sending this request?')) e.preventDefault();
  };

  const clearAccount = () => {
    setAccount(null);
    setAccountError('');
    set({ insuredId: '', policyId: '' });
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const missing = [
      ...missingFields(values),
      ...files.filter((f) => f.problem).map((f) => `${f.problem} Remove it to send.`),
      ...files.filter((f) => !f.problem && !f.sensitivity).map((f) => `Choose what kind of document ${f.file.name} is.`),
    ];
    setProblems(missing);
    if (missing.length) return;
    setBusy(true);
    setError('');
    try {
      const created = await api<Sent>('/api/desk/tasks', { method: 'POST', body: JSON.stringify(requestPayload(values)) });
      // The request exists now; each file follows on its own, so one failure doesn't lose the others.
      const results: Attached[] = [];
      for (const [i, a] of files.entries()) {
        setProgress(`Attaching ${i + 1} of ${files.length}: ${a.file.name}`);
        results.push({ name: a.file.name, error: await attach(created.id, a) });
      }
      setProgress('');
      setAttached(results);
      setFiles([]);
      setSent(created);
      window.scrollTo?.({ top: 0 });
    } catch (err) {
      setError(err instanceof ApiError && err.status === 404
        ? "That account or policy isn't available to you any more. Choose another, or send the request without it."
        : message(err));
    } finally {
      setBusy(false);
      setProgress('');
    }
  };

  const addFiles = (list: FileList | null) => {
    if (!list) return;
    const room = MAX_FILES_PER_SEND - files.length;
    const chosen = [...list].slice(0, Math.max(0, room)).map((file) => ({ key: ++fileKey.current, file, sensitivity: '' as const, problem: precheckDocument(file.name, file.size) }));
    setFiles((f) => [...f, ...chosen]);
    setProblems(list.length > room ? [`You can attach up to ${MAX_FILES_PER_SEND} files at once.`] : []);
  };
  const setCategory = (key: number, sensitivity: DocumentSensitivity | '') => setFiles((f) => f.map((a) => (a.key === key ? { ...a, sensitivity } : a)));
  const dropFile = (key: number) => { setFiles((f) => f.filter((a) => a.key !== key)); setProblems([]); };

  const another = () => {
    const keep = sent?.insured ? account : null;
    setSent(null);
    setForm(blankRequest(keep ? keep.id : ''));
    setAccount(keep);
    setTitleEdited(false);
    setSearch('');
    setFound(null);
    setFiles([]);
    setAttached([]);
  };

  const accountLink = (id: string, text: string, testId: string) => (
    <Link href={`/desk/accounts/${id}`} className={SECONDARY} onClick={leave} data-testid={testId}>{text}</Link>
  );

  if (sent) {
    return (
      <div className="max-w-3xl" data-testid="desk-request-sent">
        <h1 className="text-2xl font-bold tracking-tight mb-5" style={{ color: ACCENT }} data-testid="page-title">Request sent</h1>
        <section className={CARD}>
          <p className="text-sm text-slate-700 mb-3" role="status">
            Your Desk team has received request <strong data-testid="desk-request-reference">#{sent.reference}</strong>. You can follow it on <Link href={`/desk/requests/${sent.id}`} className="underline" onClick={leave} data-testid="desk-request-sent-view">its own page</Link>, and under Requests.
          </p>
          <dl className="grid grid-cols-[auto,1fr] gap-x-4 gap-y-1 text-sm">
            <dt className="text-slate-500">Type</dt><dd data-testid="desk-request-sent-type">{sent.typeLabel}</dd>
            <dt className="text-slate-500">Title</dt><dd className="break-words" data-testid="desk-request-sent-title">{sent.title}</dd>
            <dt className="text-slate-500">Account</dt><dd className="break-words" data-testid="desk-request-sent-account">{sent.insured?.name ?? 'Not about one account'}</dd>
            <dt className="text-slate-500">Status</dt><dd data-testid="desk-request-sent-status">{sent.statusLabel}</dd>
          </dl>
          {attached.some((a) => !a.error) && (
            <div className="mt-4" data-testid="desk-request-sent-files">
              <p className="text-sm font-medium text-slate-700 mb-1">Attached</p>
              <ul className="text-sm text-slate-700 list-disc pl-5">
                {attached.filter((a) => !a.error).map((a, i) => <li key={i} className="break-words">{a.name}</li>)}
              </ul>
            </div>
          )}
          {attached.some((a) => a.error) && (
            <div className="mt-4 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-3" role="alert" data-testid="desk-request-sent-failed">
              <p className="font-medium mb-1">The request was sent, but these files weren&apos;t attached. You can attach them again on the request&apos;s page:</p>
              <ul className="list-disc pl-5">
                {attached.filter((a) => a.error).map((a, i) => <li key={i} className="break-words">{a.error!.includes(a.name) ? a.error : `${a.name}: ${a.error}`}</li>)}
              </ul>
            </div>
          )}
        </section>
        <div className="flex flex-wrap gap-3">
          <button type="button" className="px-5 py-2.5 rounded-lg text-sm font-medium text-white" style={{ backgroundColor: ACCENT }} onClick={another} data-testid="desk-request-another">
            {sent.insured ? 'Send another for this account' : 'Send another request'}
          </button>
          {sent.insured && accountLink(sent.insured.id, 'Back to account', 'desk-request-sent-account-link')}
          <Link href="/desk/requests" className={SECONDARY} data-testid="desk-request-all">All requests</Link>
        </div>
      </div>
    );
  }

  const typeHint = AGENCY_REQUEST_TYPES.find((t) => t.type === form.type)?.hint;
  const inactive = account?.status === 'INACTIVE';

  return (
    <div className="max-w-3xl min-w-0" data-testid="desk-request-form">
      {account
        ? <Link href={`/desk/accounts/${account.id}`} className="text-sm text-slate-600 hover:underline" onClick={leave} data-testid="desk-request-back">← Back to account</Link>
        : <Link href="/desk/requests" className="text-sm text-slate-600 hover:underline" onClick={leave} data-testid="desk-request-back">← Requests</Link>}
      <h1 className="text-2xl font-bold tracking-tight mt-2 mb-5" style={{ color: ACCENT }} data-testid="page-title">New request</h1>

      {error && <p className="text-sm text-red-600 mb-4" role="alert" data-testid="desk-request-error">{error}</p>}
      {problems.length > 0 && (
        <ul className="text-sm text-red-600 mb-4 list-disc pl-5" role="alert" data-testid="desk-request-problems">
          {problems.map((p) => <li key={p}>{p}</li>)}
        </ul>
      )}

      <form onSubmit={submit} noValidate data-testid="desk-request-fields">
        <section className={CARD} data-testid="desk-request-account">
          <h2 className="text-base font-semibold text-slate-800 mb-4">Account</h2>
          {loadingAccount ? (
            <p className="text-sm text-slate-500" data-testid="desk-request-account-loading">Loading…</p>
          ) : account ? (
            <>
              <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-800 break-words" data-testid="desk-request-account-name">{account.name}</p>
                  {account.dba && <p className="text-xs text-slate-500 break-words">DBA {account.dba}</p>}
                </div>
                <button type="button" className={SECONDARY} onClick={clearAccount} data-testid="desk-request-account-change">Change account</button>
              </div>
              {inactive && <p className={NOTE} data-testid="desk-request-account-inactive">This account is inactive. Reactivate it to send a new request.</p>}
              <label className={LABEL} htmlFor="request-policy">Policy</label>
              <select id="request-policy" className={INPUT} value={form.policyId} onChange={(e) => set({ policyId: e.target.value })} data-testid="desk-request-policy">
                <option value="">Not about a specific policy</option>
                {account.policies.map((p) => <option key={p.id} value={p.id}>{policyLabel(p)}</option>)}
              </select>
              {account.policies.length === 0 && <p className="text-xs text-slate-500 mt-1">This account has no policies on record.</p>}
            </>
          ) : form.insuredId === null ? (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-slate-700" data-testid="desk-request-no-account">This request is not about one account.</p>
              <button type="button" className={SECONDARY} onClick={clearAccount} data-testid="desk-request-choose-account">Choose an account</button>
            </div>
          ) : (
            <>
              {accountError && <p className="text-sm text-red-600 mb-3" role="alert" data-testid="desk-request-account-error">{accountError}</p>}
              <label className={LABEL} htmlFor="request-search">Find an account</label>
              <input
                id="request-search" type="search" className={INPUT} value={search} placeholder="Account name, DBA or policy number"
                onChange={(e) => setSearch(e.target.value)} autoComplete="off" data-testid="desk-request-search"
              />
              {searchError && <p className="text-sm text-red-600 mt-2" role="alert">{searchError}</p>}
              {found && (found.length === 0 ? (
                <p className="text-sm text-slate-600 mt-2" data-testid="desk-request-search-none">No active accounts match. You only see accounts you have access to.</p>
              ) : (
                <ul className="mt-2 border border-slate-200 rounded-lg divide-y divide-slate-100" data-testid="desk-request-results">
                  {found.map((a) => (
                    <li key={a.id}>
                      <button type="button" className="w-full text-left px-3 py-2 text-sm hover:bg-slate-50" onClick={() => chooseAccount(a.id)} data-testid="desk-request-result">
                        <span className="font-medium text-slate-800 break-words">{a.name}</span>
                        {(a.dba || a.city || a.state) && (
                          <span className="block text-xs text-slate-500 break-words">
                            {[a.dba && `DBA ${a.dba}`, [a.city, a.state].filter(Boolean).join(', ')].filter(Boolean).join(' · ')}
                          </span>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              ))}
              <button type="button" className="text-sm text-slate-600 underline mt-3" onClick={() => { setAccountError(''); set({ insuredId: null, policyId: '' }); }} data-testid="desk-request-skip-account">
                This request is not about one account
              </button>
            </>
          )}
        </section>

        <section className={CARD} data-testid="desk-request-what">
          <h2 className="text-base font-semibold text-slate-800 mb-4">What you need</h2>
          <div className="grid gap-4">
            <div>
              <label className={LABEL} htmlFor="request-type">Request type<span className="text-red-600"> *</span></label>
              <select id="request-type" className={INPUT} value={form.type} onChange={(e) => set({ type: e.target.value as TaskType | '' })} data-testid="desk-request-type">
                <option value="">Choose a type…</option>
                {AGENCY_REQUEST_TYPES.map((t) => <option key={t.type} value={t.type}>{t.label}</option>)}
              </select>
              {typeHint && <p className="text-xs text-slate-500 mt-1" data-testid="desk-request-type-hint">{typeHint}</p>}
            </div>

            <fieldset>
              <legend className={LABEL}>Complexity</legend>
              <div className="grid sm:grid-cols-2 gap-3">
                {(['STANDARD', 'COMPLEX'] as const).map((c) => (
                  <label key={c} className={`flex gap-2 border rounded-lg p-3 text-sm cursor-pointer ${form.complexity === c ? 'border-slate-500 bg-slate-50' : 'border-slate-200'}`}>
                    <input type="radio" name="request-complexity" value={c} checked={form.complexity === c} onChange={() => set({ complexity: c })} data-testid={`desk-request-complexity-${c.toLowerCase()}`} />
                    <span>
                      <span className="block font-medium text-slate-800">{c === 'STANDARD' ? 'Standard' : 'Complex'}</span>
                      <span className="block text-xs text-slate-500">{COMPLEXITY_HINTS[c]}</span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>

            <div>
              <label className={LABEL} htmlFor="request-title">Title<span className="text-red-600"> *</span></label>
              <input
                id="request-title" className={INPUT} maxLength={REQUEST_TITLE_MAX} value={title}
                onChange={(e) => { setTitleEdited(true); set({ title: e.target.value }); }} data-testid="desk-request-title"
              />
              <p className="text-xs text-slate-500 mt-1">A short summary, such as who the certificate is for.</p>
            </div>

            <div>
              <label className={LABEL} htmlFor="request-details">Details</label>
              <textarea
                id="request-details" rows={6} className={INPUT} maxLength={REQUEST_DETAILS_MAX} value={form.description}
                onChange={(e) => set({ description: e.target.value })} data-testid="desk-request-details"
              />
              <p className="text-xs text-slate-500 mt-1">
                Everything the team needs to complete it. Never enter passwords or carrier logins.
                <span className="float-right" data-testid="desk-request-details-count">{form.description.length.toLocaleString('en-US')} / {REQUEST_DETAILS_MAX.toLocaleString('en-US')}</span>
              </p>
            </div>
          </div>
        </section>

        <section className={CARD} data-testid="desk-request-documents">
          <h2 className="text-base font-semibold text-slate-800 mb-1">Documents</h2>
          <p className="text-xs text-slate-500 mb-4">
            Optional. {DOCUMENT_KINDS_TEXT}, up to {MAX_DOCUMENT_BYTES / 1024 / 1024} MB each and {MAX_FILES_PER_SEND} at a time. Choose a category for each, so only the right people can open it.
          </p>
          {files.length > 0 && (
            <ul className="mb-4 grid gap-3 list-none p-0" data-testid="desk-request-files">
              {files.map((a) => (
                <li key={a.key} className="border border-slate-200 rounded-lg p-3 min-w-0" data-testid="desk-request-file">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <p className="text-sm text-slate-800 break-words min-w-0">{a.file.name} <span className="text-xs text-slate-500 whitespace-nowrap">{formatBytes(a.file.size)}</span></p>
                    <button type="button" className="text-sm text-slate-600 underline" onClick={() => dropFile(a.key)} aria-label={`Remove ${a.file.name}`} data-testid="desk-request-file-remove">Remove</button>
                  </div>
                  {a.problem ? (
                    <p className="text-sm text-red-600 mt-1" data-testid="desk-request-file-problem">{a.problem}</p>
                  ) : (
                    <>
                      <select
                        aria-label={`Category for ${a.file.name}`} className={`${INPUT} mt-2`} value={a.sensitivity}
                        onChange={(e) => setCategory(a.key, e.target.value as DocumentSensitivity | '')} data-testid="desk-request-file-category"
                      >
                        <option value="">Choose a category…</option>
                        {CATEGORIES.map((c) => <option key={c} value={c}>{SENSITIVITY_LABELS[c]}</option>)}
                      </select>
                      {a.sensitivity && <p className="text-xs text-slate-500 mt-1">{CATEGORY_HINTS[a.sensitivity]}</p>}
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
          {files.length < MAX_FILES_PER_SEND && (
            <label className={`${SECONDARY} inline-block cursor-pointer`}>
              Choose files
              <input
                type="file" multiple accept={DOCUMENT_ACCEPT} className="sr-only" data-testid="desk-request-file-input"
                onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }}
              />
            </label>
          )}
        </section>

        {progress && <p className="text-sm text-slate-600 mb-3" role="status" data-testid="desk-request-progress">{progress}</p>}
        <div className="flex flex-wrap items-center gap-3 mb-5">
          <button
            type="submit" disabled={busy || loadingAccount || inactive}
            className="px-5 py-2.5 rounded-lg text-sm font-medium text-white disabled:opacity-60" style={{ backgroundColor: ACCENT }} data-testid="desk-request-send"
          >{busy ? 'Sending…' : 'Send request'}</button>
          {account ? accountLink(account.id, 'Cancel', 'desk-request-cancel') : <Link href="/desk/requests" className={SECONDARY} onClick={leave} data-testid="desk-request-cancel">Cancel</Link>}
        </div>
      </form>
    </div>
  );
}
