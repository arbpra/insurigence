'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import type { DocumentSensitivity, TaskComplexity, TaskPriority } from '@prisma/client';
import { COMPLEXITY_LABELS, PRIORITY_LABELS } from '@/lib/desk/service-levels';
import { SENSITIVITY_LABELS } from '@/lib/desk/need-to-know';
import { CATEGORY_HINTS, DOCUMENT_ACCEPT, DOCUMENT_KINDS_TEXT, formatBytes, precheckDocument } from '@/lib/desk/document-files';
import type { AgencyStatus } from '@/lib/desk/task-statuses';
import { AGENCY_NOTE_MAX, AGENCY_STATUS_BADGE, agencyEventTitle, type AgencyEvent } from '@/lib/desk/tracker-view';
import { ApiError, api } from '@/components/desk/accounts/account-api';

interface Doc { id: string; fileName: string; fileSize: number; sensitivityLabel: string; addedBy: string; createdAt: string; viewable: boolean; canRemove: boolean }
interface Detail {
  id: string; reference: number; typeLabel: string; title: string; description: string | null;
  priority: TaskPriority; complexity: TaskComplexity; status: AgencyStatus; statusLabel: string;
  insured: { id: string; name: string } | null;
  policy: { policyNumber: string | null; lineOfBusiness: string | null; carrierName: string | null; expirationDate: string | null } | null;
  createdAt: string; completedAt: string | null; cancelledAt: string | null;
  documents: Doc[];
  events: AgencyEvent[];
  eventsTotal: number;
}

const ACCENT = 'var(--brand-primary, #05314c)';
const CARD = 'border border-slate-200 rounded-xl bg-white p-4 sm:p-5 min-w-0';
const INPUT = 'border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white min-w-0';
const BUTTON = 'px-3 py-1.5 text-sm rounded-lg font-medium disabled:opacity-50';
const PRIMARY = `${BUTTON} text-white`;
const SECONDARY = `${BUTTON} border border-slate-300 bg-white text-slate-700`;
const H2 = 'text-base font-semibold text-slate-900 mb-3';
const CATEGORIES = Object.keys(SENSITIVITY_LABELS) as DocumentSensitivity[];

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—');
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { dateStyle: 'medium' }) : null);

/**
 * One request, for the agency: where it stands, what the Desk team needs, the
 * conversation and the shared files. Never a due date, a pod or who on the team
 * has it (Q5); the API doesn't send them.
 */
export function AgencyRequest({ taskId }: { taskId: string }) {
  const [task, setTask] = useState<Detail | null>(null);
  const [loadError, setLoadError] = useState<{ status: number; message: string } | null>(null);
  const [notice, setNotice] = useState('');
  const [problem, setProblem] = useState('');
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [note, setNote] = useState('');
  const [cancelling, setCancelling] = useState<string | null>(null);
  const [upload, setUpload] = useState<{ file: File | null; sensitivity: DocumentSensitivity | '' }>({ file: null, sensitivity: '' });
  const fileInput = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      setTask(await api<Detail>(`/api/desk/tasks/${taskId}`));
      setLoadError(null);
    } catch (err) {
      setLoadError({ status: err instanceof ApiError ? err.status : 0, message: err instanceof Error ? err.message : 'This request could not be loaded.' });
    }
  }, [taskId]);

  useEffect(() => { void load(); }, [load, attempt]);

  /** Runs one change, reloads, then says what happened. */
  async function act(run: () => Promise<string>) {
    setBusy(true);
    setProblem('');
    setNotice('');
    let done = '';
    let failure = '';
    try {
      done = await run();
    } catch (err) {
      failure = err instanceof Error ? err.message : 'That could not be sent.';
    }
    await load();
    if (done) setNotice(done); else setProblem(failure);
    setBusy(false);
    return !!done;
  }

  async function sendNote() {
    if (!note.trim()) return;
    const ok = await act(async () => {
      const { resumed } = await api<{ resumed: boolean }>(`/api/desk/tasks/${taskId}/notes`, { method: 'POST', body: JSON.stringify({ body: note }) });
      return resumed ? 'Thanks. Your reply was sent, and the request is back with your Desk team.' : 'Your note was sent to your Desk team.';
    });
    if (ok) setNote('');
  }

  async function cancelRequest() {
    if (!cancelling?.trim()) return;
    const ok = await act(async () => {
      await api(`/api/desk/tasks/${taskId}/status`, { method: 'POST', body: JSON.stringify({ status: 'CANCELLED', reason: cancelling }) });
      return 'The request was cancelled. Your Desk team can see why.';
    });
    if (ok) setCancelling(null);
  }

  const uploadProblem = useMemo(() => (upload.file ? precheckDocument(upload.file.name, upload.file.size) : null), [upload.file]);

  async function sendFile() {
    if (!upload.file || !upload.sensitivity || uploadProblem) return;
    const name = upload.file.name;
    const form = new FormData();
    form.append('file', upload.file);
    form.append('sensitivity', upload.sensitivity);
    const ok = await act(async () => {
      const res = await fetch(`/api/desk/tasks/${taskId}/documents`, { method: 'POST', body: form });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new ApiError(body.error || 'The file could not be attached.', res.status, body.code);
      return `${name} attached. Your Desk team can see it.`;
    });
    if (ok) {
      setUpload({ file: null, sensitivity: '' });
      if (fileInput.current) fileInput.current.value = '';
    }
  }

  function removeDoc(doc: Doc) {
    if (!window.confirm(`Remove ${doc.fileName}? It stays in the history as removed.`)) return;
    void act(async () => {
      await api(`/api/desk/documents/${doc.id}`, { method: 'DELETE' });
      return `${doc.fileName} removed.`;
    });
  }

  if (loadError && !task) {
    return (
      <div className={CARD} data-testid="desk-request-unavailable">
        <p className="text-sm text-slate-700 mb-3">{loadError.status === 404 ? "This request isn't available. It may not exist, or it isn't one you can see." : loadError.message}</p>
        <div className="flex gap-2">
          <Link href="/desk/requests" className={SECONDARY}>All requests</Link>
          {loadError.status !== 404 && <button type="button" className={SECONDARY} onClick={() => setAttempt((n) => n + 1)}>Try again</button>}
        </div>
      </div>
    );
  }
  if (!task) return <p className="text-sm text-slate-500">Loading…</p>;

  const closed = task.status === 'COMPLETED' || task.status === 'CANCELLED';
  const attention = task.status === 'NEEDS_ATTENTION';
  // What was asked: the latest "needs your attention" entry.
  const ask = attention ? [...task.events].reverse().find((e) => e.kind === 'STATUS_CHANGED' && e.status === 'NEEDS_ATTENTION') : undefined;
  const events = [...task.events].reverse();
  // An agency may cancel until work starts; the service checks it again.
  const cancellable = task.status === 'RECEIVED';
  const newRequest = `/desk/requests/new${task.insured ? `?insuredId=${task.insured.id}` : ''}`;

  const composer = (
    <>
      <textarea
        aria-label={attention ? 'Your reply' : 'Note'} rows={attention ? 4 : 3} maxLength={AGENCY_NOTE_MAX} className={`${INPUT} w-full`} value={note}
        onChange={(e) => setNote(e.target.value)} placeholder={attention ? 'Answer the question, or say what you have attached…' : 'Anything your Desk team should know…'} data-testid="desk-request-note-body"
      />
      <div className="flex flex-wrap items-center justify-between gap-3 mt-2">
        <p className="text-xs text-slate-500">Your Desk team will see this. Never send passwords or carrier logins here.</p>
        <button type="button" className={PRIMARY} style={{ backgroundColor: ACCENT }} disabled={busy || !note.trim()} onClick={() => void sendNote()} data-testid="desk-request-note-send">
          {attention ? 'Send reply' : 'Send note'}
        </button>
      </div>
    </>
  );

  return (
    <div data-testid="desk-request" data-task-id={task.id} data-status={task.status}>
      <Link href="/desk/requests" className="text-sm text-slate-600 hover:underline">← Requests</Link>
      <div className="mt-2 mb-5">
        <h1 className="text-2xl font-bold tracking-tight break-words" style={{ color: ACCENT }} data-testid="page-title">
          <span className="text-slate-400 font-semibold mr-2">#{task.reference}</span>{task.title}
        </h1>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2 text-sm">
          <span className={`px-2 py-0.5 rounded-full font-medium ${AGENCY_STATUS_BADGE[task.status]}`} data-testid="desk-request-status">{task.statusLabel}</span>
          <span className="text-slate-600">{task.typeLabel}</span>
        </div>
      </div>

      {notice && <p className="text-sm text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 mb-4" role="status" data-testid="desk-request-notice">{notice}</p>}
      {problem && <p className="text-sm text-red-600 mb-4" role="alert" data-testid="desk-request-problem">{problem}</p>}

      {attention && (
        <section className="border border-amber-300 bg-amber-50 rounded-xl p-4 sm:p-5 mb-4 min-w-0" data-testid="desk-request-attention">
          <h2 className="text-base font-semibold text-amber-900 mb-1">Your Desk team needs something from you</h2>
          {ask?.body
            ? <p className="text-sm text-slate-900 whitespace-pre-wrap break-words mb-1" data-testid="desk-request-asked">{ask.body}</p>
            : <p className="text-sm text-slate-900 mb-1">Reply below with what's needed.</p>}
          {ask && <p className="text-xs text-amber-900 mb-3">Asked {when(ask.createdAt)}. Replying sends it straight back to them.</p>}
          {composer}
        </section>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="grid gap-4 lg:col-span-2 content-start min-w-0">
          <section className={CARD} data-testid="desk-request-facts">
            <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2 text-sm">
              {([
                ['Account', task.insured ? <Link key="a" href={`/desk/accounts/${task.insured.id}`} className="underline" data-testid="desk-request-account">{task.insured.name}</Link> : 'Not about one account'],
                ['Policy', task.policy ? [task.policy.policyNumber, task.policy.lineOfBusiness, task.policy.carrierName, task.policy.expirationDate && `expires ${day(task.policy.expirationDate)}`].filter(Boolean).join(' · ') : 'None'],
                ['Priority', PRIORITY_LABELS[task.priority]],
                ['Complexity', COMPLEXITY_LABELS[task.complexity]],
                ['Sent', when(task.createdAt)],
                ...(task.completedAt && task.status === 'COMPLETED' ? [['Completed', when(task.completedAt)]] : []),
                ...(task.cancelledAt && task.status === 'CANCELLED' ? [['Cancelled', when(task.cancelledAt)]] : []),
              ] as [string, React.ReactNode][]).map(([k, v]) => (
                <div key={k} className="min-w-0"><dt className="text-slate-500">{k}</dt><dd className="text-slate-900 break-words">{v}</dd></div>
              ))}
            </dl>
            {task.description && (
              <div className="mt-4 pt-4 border-t border-slate-100">
                <h2 className="text-sm font-semibold text-slate-700 mb-1">Details you sent</h2>
                <p className="text-sm text-slate-800 whitespace-pre-wrap break-words" data-testid="desk-request-description">{task.description}</p>
              </div>
            )}
          </section>

          {!attention && (
            <section className={CARD} data-testid="desk-request-note">
              {closed ? (
                <p className="text-sm text-slate-600" data-testid="desk-request-closed">
                  This request is {task.status === 'COMPLETED' ? 'completed' : 'cancelled'}. Need something more? <Link href={newRequest} className="underline" data-testid="desk-request-new">Send a new request</Link>.
                </p>
              ) : (
                <>
                  <h2 className={H2}>Add a note</h2>
                  {composer}
                  {cancellable && (
                    <div className="mt-4 pt-4 border-t border-slate-100" data-testid="desk-request-cancel">
                      {cancelling === null ? (
                        <p className="text-sm text-slate-600">
                          Work hasn't started yet, so you can still <button type="button" className="text-red-700 underline" disabled={busy} onClick={() => setCancelling('')} data-testid="desk-request-cancel-open">cancel this request</button>.
                        </p>
                      ) : (
                        <>
                          <label className="block text-sm text-slate-700 mb-1" htmlFor="desk-request-cancel-reason">Why are you cancelling it? Your Desk team will see this.</label>
                          <textarea id="desk-request-cancel-reason" rows={2} maxLength={2000} className={`${INPUT} w-full`} value={cancelling} onChange={(e) => setCancelling(e.target.value)} data-testid="desk-request-cancel-reason" />
                          <div className="flex gap-2 mt-2">
                            <button type="button" className={`${BUTTON} text-white bg-red-700`} disabled={busy || !cancelling.trim()} onClick={() => void cancelRequest()} data-testid="desk-request-cancel-confirm">Cancel request</button>
                            <button type="button" className={SECONDARY} onClick={() => setCancelling(null)}>Keep it</button>
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </>
              )}
            </section>
          )}

          <section className={CARD} data-testid="desk-request-history">
            <h2 className={H2}>History</h2>
            {task.eventsTotal > task.events.length && <p className="text-xs text-slate-500 mb-2">Showing the latest {task.events.length} of {task.eventsTotal} entries.</p>}
            <ol className="grid gap-3 list-none p-0">
              {events.map((e) => (
                <li key={e.id} className={`border-l-2 pl-3 ${e.status === 'NEEDS_ATTENTION' ? 'border-amber-400' : 'border-slate-200'}`} data-testid="desk-request-event" data-kind={e.kind}>
                  <p className="text-sm text-slate-900 font-medium break-words">{agencyEventTitle(e)}</p>
                  {/* A new request's title is already the page's title. */}
                  {e.body && e.kind !== 'CREATED' && <p className="text-sm text-slate-700 whitespace-pre-wrap break-words">{e.body}</p>}
                  <p className="text-xs text-slate-500 mt-0.5">{e.actorName} · {when(e.createdAt)}</p>
                </li>
              ))}
            </ol>
          </section>
        </div>

        <div className="grid gap-4 content-start min-w-0">
          <section className={CARD} data-testid="desk-request-documents">
            <h2 className={H2}>Documents</h2>
            {task.documents.length === 0 && <p className="text-sm text-slate-500 mb-3">No documents yet.</p>}
            <ul className="grid gap-2 list-none p-0 mb-3">
              {task.documents.map((d) => (
                <li key={d.id} className="border border-slate-200 rounded-lg p-3 text-sm min-w-0" data-testid="desk-request-document">
                  <a href={`/api/desk/documents/${d.id}${d.viewable ? '?view=1' : ''}`} target="_blank" rel="noopener noreferrer" className="font-medium underline break-all" style={{ color: ACCENT }} data-testid="desk-request-document-open">{d.fileName}</a>
                  <p className="text-slate-500 mt-0.5">{d.sensitivityLabel} · {formatBytes(d.fileSize)}</p>
                  <p className="text-slate-500">{d.addedBy} · {when(d.createdAt)}</p>
                  <div className="flex gap-3 mt-1">
                    {d.viewable && <a href={`/api/desk/documents/${d.id}`} className="text-slate-700 underline" data-testid="desk-request-document-download">Download</a>}
                    {d.canRemove && <button type="button" className="text-red-700 underline" disabled={busy} onClick={() => removeDoc(d)} data-testid="desk-request-document-remove">Remove</button>}
                  </div>
                </li>
              ))}
            </ul>
            {!closed && (
              <div className="grid gap-2 border-t border-slate-100 pt-3" data-testid="desk-request-upload">
                <input ref={fileInput} type="file" accept={DOCUMENT_ACCEPT} aria-label="File" className="text-sm min-w-0"
                  onChange={(e) => setUpload({ ...upload, file: e.target.files?.[0] ?? null })} data-testid="desk-request-upload-file" />
                {uploadProblem && <p className="text-sm text-red-600" data-testid="desk-request-upload-problem">{uploadProblem}</p>}
                <select aria-label="Category" className={INPUT} value={upload.sensitivity} onChange={(e) => setUpload({ ...upload, sensitivity: e.target.value as DocumentSensitivity })} data-testid="desk-request-upload-category">
                  <option value="">What kind of document is it?</option>
                  {CATEGORIES.map((c) => <option key={c} value={c}>{SENSITIVITY_LABELS[c]}</option>)}
                </select>
                {upload.sensitivity && <p className="text-xs text-slate-500">{CATEGORY_HINTS[upload.sensitivity]}</p>}
                <button type="button" className={PRIMARY} style={{ backgroundColor: ACCENT }} disabled={busy || !upload.file || !upload.sensitivity || !!uploadProblem} onClick={() => void sendFile()} data-testid="desk-request-upload-send">Attach</button>
                <p className="text-xs text-slate-500">{DOCUMENT_KINDS_TEXT}, up to 9 MB.</p>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
