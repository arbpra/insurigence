'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import type { DocumentSensitivity, TaskComplexity, TaskPriority, TaskStatus } from '@prisma/client';
import { COMPLEXITY_LABELS, PRIORITY_LABELS, TASK_TYPE_LABELS } from '@/lib/desk/service-levels';
import { SERVICE_CATEGORY_LABELS } from '@/lib/desk/billing';
import { SENSITIVITY_LABELS } from '@/lib/desk/need-to-know';
import { CATEGORY_HINTS, DOCUMENT_ACCEPT, DOCUMENT_KINDS_TEXT, formatBytes, precheckDocument } from '@/lib/desk/document-files';
import { STATUS_LABELS, moveLabel, needsReason, reasonPrompt } from '@/lib/desk/task-statuses';
import { MAX_UNITS, NOTE_MAX, REVIEW_REASON_MAX, SUBTASK_TITLE_MAX, eventLines, eventTitle, reviewBody, type ReviewState, type StaffEvent } from '@/lib/desk/task-workspace';
import { PRIORITY_BADGE, dueLabel } from '@/lib/desk/queue-view';
import { ApiError, api } from '@/components/desk/accounts/account-api';
import { TaskClassificationCard, type TaskClassificationView } from './TaskClassificationCard';

type Person = { id: string; name: string } | null;
interface Doc {
  id: string; fileName: string; fileSize: number; sensitivity: DocumentSensitivity; sensitivityLabel: string;
  visibility?: 'INTERNAL' | 'AGENCY'; addedBy: string; createdAt: string; viewable: boolean; canRemove: boolean;
}
interface Detail {
  id: string; reference: number; type: string; typeLabel: string; title: string; description: string | null;
  priority: TaskPriority; complexity: TaskComplexity; status: TaskStatus; statusLabel: string;
  agency: { id: string; name: string }; insured: { id: string; name: string } | null;
  policy: { policyNumber: string | null; lineOfBusiness: string | null; carrierName: string | null; expirationDate: string | null } | null;
  pod: { id: string; name: string } | null; accountManager: Person; assignee: Person;
  dueAt: string | null; waitingSince: string | null; escalated: boolean; escalationReason?: string | null;
  createdAt: string; startedAt: string | null; completedAt: string | null;
  restrictedToUserIds?: string[]; restrictionReason?: string | null;
  billing?: { serviceCategory: keyof typeof SERVICE_CATEGORY_LABELS | null; units: number; nonBillable: boolean; class: string | null; status: string | null; period: string | null };
  permissions: { statusMoves: TaskStatus[]; pickUp: boolean; release: boolean; assign: boolean; review: boolean; addDocuments: boolean; addSubtask: boolean; escalate?: boolean; movePod?: boolean; restrict?: boolean };
  /** For managers: the pods it can be moved to (Module 40). */
  pods?: { id: string; name: string }[];
  /** On a request: its subtasks this person can see, and how many are open in all. */
  subtasks?: Subtask[]; openSubtasks?: number; hiddenSubtasks?: number;
  /** On a subtask: its request (the title only if this person can open it). */
  parentRequest?: { id: string | null; reference: number | null; title: string | null; statusLabel: string | null; canOpen: boolean; followUp: boolean };
  /** Module 53: null on a subtask. */
  classification?: TaskClassificationView | null;
  documents: Doc[];
  events: StaffEvent[];
  eventsTotal: number;
}
interface Subtask { id: string; reference: number; typeLabel: string; title: string; status: TaskStatus; statusLabel: string; assignee: Person; pod: { id: string; name: string } | null; followUp: boolean }
interface Nameable { id: string; name: string; pods: string[]; named: boolean; eligible: boolean }
interface RestrictionForm { people: Nameable[]; chosen: string[]; reason: string; restricted: boolean }
interface Candidate { id: string; name: string; kind: 'VA' | 'ACCOUNT_MANAGER'; lead: boolean; openTasks: number }

const ACCENT = 'var(--brand-primary, #05314c)';
const CARD = 'border border-slate-200 rounded-xl bg-white p-4 sm:p-5 min-w-0';
const INPUT = 'border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white min-w-0';
const BUTTON = 'px-3 py-1.5 text-sm rounded-lg font-medium disabled:opacity-50';
const PRIMARY = `${BUTTON} text-white`;
const SECONDARY = `${BUTTON} border border-slate-300 bg-white text-slate-700`;
const H2 = 'text-base font-semibold text-slate-900 mb-3';
const CATEGORIES = Object.keys(SENSITIVITY_LABELS) as DocumentSensitivity[];
const TYPES = Object.entries(TASK_TYPE_LABELS) as [string, string][];

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—');
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { dateStyle: 'medium' }) : null);

/** One request, for the Desk team: everything about it and every change they may make. */
export function TaskWorkspace({ taskId, userId }: { taskId: string; userId: string }) {
  const [task, setTask] = useState<Detail | null>(null);
  const [loadError, setLoadError] = useState<{ status: number; message: string } | null>(null);
  const [notice, setNotice] = useState('');
  const [problem, setProblem] = useState('');
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);

  const [move, setMove] = useState<{ to: TaskStatus; reason: string } | null>(null);
  const [picker, setPicker] = useState<Candidate[] | 'loading' | null>(null);
  const [escalation, setEscalation] = useState<{ reason: string } | null>(null);
  const [podPicker, setPodPicker] = useState(false);
  const [restriction, setRestriction] = useState<RestrictionForm | 'loading' | null>(null);
  const [note, setNote] = useState({ body: '', shared: false });
  const [upload, setUpload] = useState<{ file: File | null; sensitivity: DocumentSensitivity | ''; shared: boolean }>({ file: null, sensitivity: '', shared: false });
  const fileInput = useRef<HTMLInputElement>(null);
  const [review, setReview] = useState<ReviewState | null>(null);
  const [subtask, setSubtask] = useState<{ type: string; title: string; description: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const detail = await api<Detail>(`/api/desk/tasks/${taskId}`);
      setTask(detail);
      setLoadError(null);
    } catch (err) {
      setLoadError({ status: err instanceof ApiError ? err.status : 0, message: err instanceof Error ? err.message : 'This request could not be loaded.' });
    }
  }, [taskId]);

  useEffect(() => { void load(); }, [load, attempt]);

  // The review form starts from the task as it is now.
  useEffect(() => {
    if (task) setReview({ complexity: task.complexity, priority: task.priority, billableUnits: String(task.billing?.units ?? 1), nonBillable: !!task.billing?.nonBillable, reason: '' });
  }, [task]);

  /**
   * Runs one change, reloads so the page shows what the server holds, then says
   * what happened, so the confirmation never appears beside a stale history.
   */
  async function act(run: () => Promise<unknown>, done: string) {
    setBusy(true);
    setProblem('');
    setNotice('');
    let saved = false;
    let failure = '';
    try {
      await run();
      saved = true;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'That could not be saved.';
      failure = err instanceof ApiError && err.status === 409 ? `${message} The page has been refreshed.` : message;
    }
    await load();
    if (saved) {
      setMove(null);
      setPicker(null);
      setEscalation(null);
      setPodPicker(false);
      setRestriction(null);
      setNotice(done);
    } else {
      setProblem(failure);
    }
    setBusy(false);
    return saved;
  }

  const post = (path: string, body: unknown) => api(`/api/desk/tasks/${taskId}/${path}`, { method: 'POST', body: JSON.stringify(body) });

  function chooseMove(to: TaskStatus) {
    if (!task) return;
    if (needsReason(task.status, to)) return setMove({ to, reason: '' });
    if (to === 'COMPLETED' && !window.confirm(`Mark #${task.reference} as completed? It will count toward the agency's usage for the month.`)) return;
    void act(() => post('status', { status: to }), `#${task.reference} is now ${STATUS_LABELS[to].toLowerCase()}.`);
  }

  async function openPicker() {
    if (picker) return setPicker(null);
    setPicker('loading');
    try {
      const { people } = await api<{ people: Candidate[] }>(`/api/desk/tasks/${taskId}/assignees`);
      setPicker(people);
    } catch (err) {
      setPicker(null);
      setProblem(err instanceof Error ? err.message : 'Could not load who can take this.');
    }
  }

  async function openRestriction() {
    if (restriction) return setRestriction(null);
    setRestriction('loading');
    try {
      const r = await api<{ restricted: boolean; reason: string | null; people: Nameable[] }>(`/api/desk/tasks/${taskId}/restriction`);
      setRestriction({ people: r.people, chosen: r.people.filter((x) => x.named && x.eligible).map((x) => x.id), reason: r.reason ?? '', restricted: r.restricted });
    } catch (err) {
      setRestriction(null);
      setProblem(err instanceof Error ? err.message : 'Could not load who can be named.');
    }
  }

  function saveRestriction(userIds: string[], reason: string) {
    if (!task) return;
    const lifting = userIds.length === 0;
    if (lifting && !window.confirm(`Lift the restriction on #${task.reference}? Everyone authorised in its pods will see it again.`)) return;
    void act(
      () => post('restriction', { userIds, reason }),
      lifting ? `#${task.reference}: restriction lifted.` : `#${task.reference} is restricted to the people you named, with its subtasks. Anyone holding it who isn't named is back in the queue.`,
    );
  }

  async function sendNote() {
    if (!task || !note.body.trim()) return;
    const ok = await act(() => post('notes', { body: note.body, visibility: note.shared ? 'AGENCY' : 'INTERNAL' }), note.shared ? 'Note shared with the agency.' : 'Internal note added.');
    if (ok) setNote({ body: '', shared: false });
  }

  const uploadProblem = useMemo(() => (upload.file ? precheckDocument(upload.file.name, upload.file.size) : null), [upload.file]);

  async function sendFile() {
    if (!upload.file || !upload.sensitivity || uploadProblem) return;
    const form = new FormData();
    form.append('file', upload.file);
    form.append('sensitivity', upload.sensitivity);
    form.append('visibility', upload.shared ? 'AGENCY' : 'INTERNAL');
    const ok = await act(async () => {
      const res = await fetch(`/api/desk/tasks/${taskId}/documents`, { method: 'POST', body: form });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new ApiError(body.error || 'The file could not be attached.', res.status, body.code);
    }, `${upload.file.name} attached${upload.shared ? ' and shared with the agency' : ''}.`);
    if (ok) {
      setUpload({ file: null, sensitivity: '', shared: false });
      if (fileInput.current) fileInput.current.value = '';
    }
  }

  function removeDoc(doc: Doc) {
    if (!window.confirm(`Remove ${doc.fileName}? It stays in the history as removed.`)) return;
    void act(() => api(`/api/desk/documents/${doc.id}`, { method: 'DELETE' }), `${doc.fileName} removed.`);
  }

  async function addSubtask() {
    if (!task || !subtask || !subtask.type || !subtask.title.trim()) return;
    const ok = await act(() => post('subtasks', { type: subtask.type, title: subtask.title, description: subtask.description || null }), `Subtask added to #${task.reference}.`);
    if (ok) setSubtask(null);
  }

  const reviewCheck = task && review ? reviewBody(task, review) : null;

  if (loadError && !task) {
    return (
      <div className={CARD} data-testid="desk-task-unavailable">
        <p className="text-sm text-slate-700 mb-3">{loadError.status === 404 ? "This request isn't available. It may not exist, or it isn't in your pods or agencies." : loadError.message}</p>
        <div className="flex gap-2">
          <Link href="/desk-ops/my-tasks" className={SECONDARY}>My tasks</Link>
          {loadError.status !== 404 && <button type="button" className={SECONDARY} onClick={() => setAttempt((n) => n + 1)}>Try again</button>}
        </div>
      </div>
    );
  }
  if (!task) return <p className="text-sm text-slate-500">Loading…</p>;

  const due = dueLabel(task, new Date());
  const p = task.permissions;
  const holdsIt = task.assignee?.id === userId;
  const events = [...task.events].reverse();

  return (
    <div data-testid="desk-task" data-task-id={task.id}>
      <Link href="/desk-ops/my-tasks" className="text-sm text-slate-600 hover:underline">← My tasks</Link>
      <div className="mt-2 mb-5">
        <h1 className="text-2xl font-bold tracking-tight break-words" style={{ color: ACCENT }} data-testid="page-title">
          <span className="text-slate-400 font-semibold mr-2">#{task.reference}</span>{task.title}
        </h1>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2 text-sm">
          <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-800 font-medium" data-testid="desk-task-status">{task.statusLabel}</span>
          {PRIORITY_BADGE[task.priority] && <span className={`px-2 py-0.5 rounded-full font-medium ${task.priority === 'URGENT' ? 'bg-red-100 text-red-800' : 'bg-amber-100 text-amber-800'}`}>{PRIORITY_BADGE[task.priority]}</span>}
          <span className="text-slate-600">{COMPLEXITY_LABELS[task.complexity]}</span>
          {/* A closed request's stage already says it all. */}
          {due.tone !== 'closed' && <span className={due.tone === 'overdue' ? 'text-red-700 font-medium' : due.tone === 'soon' ? 'text-amber-700 font-medium' : 'text-slate-600'} data-testid="desk-task-due">{due.text}</span>}
          {task.escalated && <span className="px-2 py-0.5 rounded-full bg-red-100 text-red-800 font-medium" data-testid="desk-task-escalated">Escalated</span>}
        </div>
        {task.escalated && task.escalationReason && <p className="text-sm text-red-800 mt-2" data-testid="desk-task-escalation-reason">Escalated: {task.escalationReason}</p>}
        {task.parentRequest && (
          <p className="text-sm text-slate-600 mt-2" data-testid="desk-task-parent">
            {task.parentRequest.followUp ? 'Follow-up to' : 'Subtask of'}{' '}
            {task.parentRequest.canOpen && task.parentRequest.id ? (
              <Link href={`/desk-ops/tasks/${task.parentRequest.id}`} className="font-medium hover:underline" style={{ color: ACCENT }} data-testid="desk-task-parent-open">
                #{task.parentRequest.reference} {task.parentRequest.title}
              </Link>
            ) : (
              <span>request #{task.parentRequest.reference}, handled by another team</span>
            )}
            {task.parentRequest.statusLabel && <span className="text-slate-500"> · {task.parentRequest.statusLabel}</span>}
          </p>
        )}
      </div>

      {notice && <p className="text-sm text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 mb-4" role="status" data-testid="desk-task-notice">{notice}</p>}
      {problem && <p className="text-sm text-red-600 mb-4" role="alert" data-testid="desk-task-problem">{problem}</p>}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="grid gap-4 lg:col-span-2 content-start min-w-0">
          <section className={CARD} data-testid="desk-task-facts">
            <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2 text-sm">
              {[
                ['Type', task.typeLabel],
                ['Agency', task.agency.name],
                ['Account', task.insured?.name ?? 'Not about one account'],
                ['Policy', task.policy ? [task.policy.policyNumber, task.policy.lineOfBusiness, task.policy.carrierName, task.policy.expirationDate && `expires ${day(task.policy.expirationDate)}`].filter(Boolean).join(' · ') : 'None'],
                ['Pod', task.pod?.name ?? 'Not yet routed'],
                ['Assigned to', task.assignee ? `${task.assignee.name}${holdsIt ? ' (you)' : ''}` : 'Nobody yet'],
                ['Account Manager', task.accountManager?.name ?? 'None'],
                ['Filed', when(task.createdAt)],
                ...(task.startedAt ? [['Started', when(task.startedAt)]] : []),
                ...(task.completedAt ? [['Completed', when(task.completedAt)]] : []),
                ...(task.restrictedToUserIds?.length ? [['Restricted', `To ${task.restrictedToUserIds.length} named ${task.restrictedToUserIds.length === 1 ? 'person' : 'people'}${task.restrictionReason ? `: ${task.restrictionReason}` : ''}`]] : []),
              ].map(([k, v]) => (
                <div key={k} className="min-w-0"><dt className="text-slate-500">{k}</dt><dd className="text-slate-900 break-words">{v}</dd></div>
              ))}
            </dl>
            {task.description && (
              <div className="mt-4 pt-4 border-t border-slate-100">
                <h2 className="text-sm font-semibold text-slate-700 mb-1">Details from the request</h2>
                <p className="text-sm text-slate-800 whitespace-pre-wrap break-words" data-testid="desk-task-description">{task.description}</p>
              </div>
            )}
          </section>

          {task.subtasks && (
            <section className={CARD} data-testid="desk-task-subtasks">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                <h2 className="text-base font-semibold text-slate-900">Subtasks</h2>
                {p.addSubtask && !subtask && <button type="button" className={SECONDARY} disabled={busy} onClick={() => setSubtask({ type: '', title: '', description: '' })} data-testid="desk-task-subtask-add">Add subtask</button>}
              </div>
              {task.subtasks.length === 0 && !task.hiddenSubtasks && <p className="text-sm text-slate-500">None. Add one for a separate piece of the work, such as the AMS update.</p>}
              {task.subtasks.length > 0 && (
                <ul className="grid gap-2 list-none p-0">
                  {task.subtasks.map((st) => (
                    <li key={st.id} className="border border-slate-200 rounded-lg px-3 py-2 text-sm min-w-0" data-testid="desk-task-subtask" data-status={st.status}>
                      <Link href={`/desk-ops/tasks/${st.id}`} className="font-medium hover:underline break-words" style={{ color: ACCENT }} data-testid="desk-task-subtask-open">
                        <span className="text-slate-400 mr-1">#{st.reference}</span>{st.title}
                      </Link>
                      {st.followUp && <span className="ml-2 text-xs px-1.5 py-0.5 rounded bg-slate-100 text-slate-600" data-testid="desk-task-subtask-followup">Follow-up</span>}
                      <p className="text-slate-500">{st.typeLabel} · {st.statusLabel} · {st.assignee ? st.assignee.name : 'Nobody yet'}{st.pod ? ` · ${st.pod.name}` : ''}</p>
                    </li>
                  ))}
                </ul>
              )}
              {!!task.hiddenSubtasks && <p className="text-xs text-slate-500 mt-2" data-testid="desk-task-subtasks-hidden">{task.hiddenSubtasks === 1 ? '1 more subtask is' : `${task.hiddenSubtasks} more subtasks are`} with another team.</p>}
              {!!task.openSubtasks && task.status !== 'COMPLETED' && task.status !== 'CANCELLED' && (
                <p className="text-xs text-slate-500 mt-2" data-testid="desk-task-subtasks-rule">The request can be completed once {task.openSubtasks === 1 ? 'its open subtask is' : `its ${task.openSubtasks} open subtasks are`} finished or cancelled.</p>
              )}
              {subtask && (
                <div className="grid gap-2 border-t border-slate-100 pt-3 mt-3" data-testid="desk-task-subtask-form">
                  <select aria-label="Type" className={INPUT} value={subtask.type} onChange={(e) => setSubtask({ ...subtask, type: e.target.value })} data-testid="desk-task-subtask-type">
                    <option value="">Choose a type…</option>
                    {TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                  </select>
                  <input aria-label="Title" maxLength={SUBTASK_TITLE_MAX} className={INPUT} placeholder="What needs doing" value={subtask.title} onChange={(e) => setSubtask({ ...subtask, title: e.target.value })} data-testid="desk-task-subtask-title" />
                  <textarea aria-label="Details" rows={2} maxLength={NOTE_MAX} className={INPUT} placeholder="Details (optional)" value={subtask.description} onChange={(e) => setSubtask({ ...subtask, description: e.target.value })} data-testid="desk-task-subtask-details" />
                  <div className="flex gap-2">
                    <button type="button" className={PRIMARY} style={{ backgroundColor: ACCENT }} disabled={busy || !subtask.type || !subtask.title.trim()} onClick={() => void addSubtask()} data-testid="desk-task-subtask-save">Add</button>
                    <button type="button" className={SECONDARY} onClick={() => setSubtask(null)}>Cancel</button>
                  </div>
                  <p className="text-xs text-slate-500">Goes to the pod for its type and is non-billable, as part of this request. The agency sees only the request.</p>
                </div>
              )}
            </section>
          )}

          <section className={CARD} data-testid="desk-task-note">
            <h2 className={H2}>Add a note</h2>
            <textarea
              aria-label="Note" rows={3} maxLength={NOTE_MAX} className={`${INPUT} w-full`} value={note.body}
              onChange={(e) => setNote({ ...note, body: e.target.value })} placeholder="What you did, what you found, what's next…" data-testid="desk-task-note-body"
            />
            <div className="flex flex-wrap items-center justify-between gap-3 mt-2">
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" checked={note.shared} onChange={(e) => setNote({ ...note, shared: e.target.checked })} data-testid="desk-task-note-shared" />
                Share with the agency
              </label>
              <button type="button" className={PRIMARY} style={{ backgroundColor: ACCENT }} disabled={busy || !note.body.trim()} onClick={() => void sendNote()} data-testid="desk-task-note-send">
                {note.shared ? 'Share note' : 'Add internal note'}
              </button>
            </div>
            <p className="text-xs text-slate-500 mt-1">{note.shared ? 'The agency will see this note.' : 'Only the Desk team sees internal notes.'} Never paste passwords or carrier logins.</p>
          </section>

          <section className={CARD} data-testid="desk-task-history">
            <h2 className={H2}>History</h2>
            {task.eventsTotal > task.events.length && <p className="text-xs text-slate-500 mb-2">Showing the latest {task.events.length} of {task.eventsTotal} entries.</p>}
            <ol className="grid gap-3 list-none p-0">
              {events.map((e) => {
                const lines = eventLines(e);
                return (
                  <li key={e.id} className={`border-l-2 pl-3 ${e.visibility === 'AGENCY' ? 'border-sky-300' : 'border-slate-200'}`} data-testid="desk-task-event" data-kind={e.kind}>
                    <p className="text-sm text-slate-900 font-medium break-words">{eventTitle(e)}</p>
                    {lines.map((l) => <p key={l} className="text-sm text-slate-700">{l}</p>)}
                    {e.body && <p className="text-sm text-slate-700 whitespace-pre-wrap break-words">{e.body}</p>}
                    <p className="text-xs text-slate-500 mt-0.5">{e.actorName ?? 'The Desk'} · {when(e.createdAt)}{e.visibility === 'AGENCY' ? ' · the agency sees this' : ''}</p>
                  </li>
                );
              })}
            </ol>
          </section>
        </div>

        {/* On a phone the work buttons come first, above the long history. */}
        <div className="grid gap-4 content-start min-w-0 order-first lg:order-none">
          <section className={CARD} data-testid="desk-task-actions">
            <h2 className={H2}>Work</h2>
            <div className="flex flex-wrap gap-2">
              {p.pickUp && <button type="button" className={PRIMARY} style={{ backgroundColor: ACCENT }} disabled={busy} onClick={() => void act(() => post('assign', { assigneeId: userId }), `You picked up #${task.reference}.`)} data-testid="desk-task-pickup">Pick up</button>}
              {p.statusMoves.map((to) => (
                <button key={to} type="button" className={to === 'COMPLETED' || to === 'IN_PROGRESS' ? PRIMARY : SECONDARY} style={to === 'COMPLETED' || to === 'IN_PROGRESS' ? { backgroundColor: ACCENT } : undefined}
                  disabled={busy} onClick={() => chooseMove(to)} data-testid={`desk-task-move-${to}`}>{moveLabel(task.status, to)}</button>
              ))}
              {p.assign && <button type="button" className={SECONDARY} disabled={busy} aria-expanded={!!picker} onClick={() => void openPicker()} data-testid="desk-task-assign">{task.assignee ? 'Reassign' : 'Assign'}</button>}
              {p.release && <button type="button" className={SECONDARY} disabled={busy} onClick={() => { if (window.confirm(`Return #${task.reference} to the Pod queue?`)) void act(() => post('assign', { assigneeId: null }), `#${task.reference} is back in the Pod queue.`); }} data-testid="desk-task-release">Release</button>}
              {p.movePod && <button type="button" className={SECONDARY} disabled={busy} aria-expanded={podPicker} onClick={() => setPodPicker(!podPicker)} data-testid="desk-task-move-pod">Move to another pod</button>}
              {p.escalate && (task.escalated
                ? <button type="button" className={SECONDARY} disabled={busy} onClick={() => void act(() => post('escalation', { escalate: false }), `#${task.reference}: escalation cleared.`)} data-testid="desk-task-deescalate">Clear escalation</button>
                : <button type="button" className={SECONDARY} disabled={busy} aria-expanded={!!escalation} onClick={() => setEscalation(escalation ? null : { reason: '' })} data-testid="desk-task-escalate">Escalate</button>)}
              {p.restrict && <button type="button" className={SECONDARY} disabled={busy} aria-expanded={!!restriction} onClick={() => void openRestriction()} data-testid="desk-task-restrict">{task.restrictedToUserIds?.length ? 'Change restriction' : 'Restrict access'}</button>}
            </div>
            {!p.pickUp && !p.statusMoves.length && !p.assign && !p.release && (
              <p className="text-sm text-slate-500" data-testid="desk-task-no-actions">{task.status === 'COMPLETED' || task.status === 'CANCELLED' ? 'This request is closed.' : 'Someone else is working on this.'}</p>
            )}

            {move && (
              <div className="mt-3 pt-3 border-t border-slate-100" data-testid="desk-task-move-form">
                <label className="block text-sm text-slate-700 mb-1" htmlFor="desk-task-reason">{reasonPrompt(task.status, move.to)}</label>
                <textarea id="desk-task-reason" rows={3} maxLength={2000} className={`${INPUT} w-full`} value={move.reason} onChange={(e) => setMove({ ...move, reason: e.target.value })} data-testid="desk-task-move-reason" />
                {move.to === 'CANCELLED' && !!task.openSubtasks && <p className="text-xs text-amber-800 mt-1" data-testid="desk-task-move-cascade">Its {task.openSubtasks === 1 ? 'open subtask' : `${task.openSubtasks} open subtasks`} will be cancelled too.</p>}
                <div className="flex gap-2 mt-2">
                  <button type="button" className={PRIMARY} style={{ backgroundColor: ACCENT }} disabled={busy || !move.reason.trim()} onClick={() => void act(() => post('status', { status: move.to, reason: move.reason }), `#${task.reference} is now ${STATUS_LABELS[move.to].toLowerCase()}.`)} data-testid="desk-task-move-confirm">{moveLabel(task.status, move.to)}</button>
                  <button type="button" className={SECONDARY} onClick={() => setMove(null)}>Cancel</button>
                </div>
              </div>
            )}

            {escalation && (
              <div className="mt-3 pt-3 border-t border-slate-100" data-testid="desk-task-escalate-form">
                <label className="block text-sm text-slate-700 mb-1" htmlFor="desk-task-escalation-reason">Why does it need a manager&apos;s attention?</label>
                <textarea id="desk-task-escalation-reason" rows={3} maxLength={500} className={`${INPUT} w-full`} value={escalation.reason} onChange={(e) => setEscalation({ reason: e.target.value })} data-testid="desk-task-escalate-reason" />
                <p className="text-xs text-slate-500 mt-1">Internal: the agency and VAs don&apos;t see the reason.</p>
                <div className="flex gap-2 mt-2">
                  <button type="button" className={PRIMARY} style={{ backgroundColor: ACCENT }} disabled={busy || !escalation.reason.trim()} onClick={() => void act(() => post('escalation', { escalate: true, reason: escalation.reason }), `#${task.reference} escalated.`)} data-testid="desk-task-escalate-confirm">Escalate</button>
                  <button type="button" className={SECONDARY} onClick={() => setEscalation(null)}>Cancel</button>
                </div>
              </div>
            )}

            {restriction === 'loading' && <p className="text-sm text-slate-500 mt-3">Loading who can be named…</p>}
            {restriction && restriction !== 'loading' && (
              <div className="mt-3 pt-3 border-t border-slate-100" data-testid="desk-task-restrict-form">
                <p className="text-sm text-slate-700 mb-2">Only the people you tick, the agency&apos;s Account Managers and the Operations Managers will see this request and its subtasks.</p>
                {restriction.people.length === 0 && <p className="text-sm text-slate-500" data-testid="desk-task-restrict-none">No VA is authorised for this agency in the pods doing this work, so nobody can be named.</p>}
                <ul className="grid gap-1 list-none p-0">
                  {restriction.people.map((person) => (
                    <li key={person.id}>
                      <label className={`flex items-start gap-2 text-sm ${person.eligible ? 'text-slate-800' : 'text-slate-400'}`}>
                        <input type="checkbox" className="mt-0.5" disabled={!person.eligible} checked={restriction.chosen.includes(person.id)}
                          onChange={(e) => setRestriction({ ...restriction, chosen: e.target.checked ? [...restriction.chosen, person.id] : restriction.chosen.filter((id) => id !== person.id) })}
                          data-testid="desk-task-restrict-person" data-user-id={person.id} />
                        <span>{person.name}<span className="text-slate-500"> · {person.eligible ? person.pods.join(', ') : 'named, but no longer authorised'}</span></span>
                      </label>
                    </li>
                  ))}
                </ul>
                <label className="block text-sm text-slate-700 mt-3 mb-1" htmlFor="desk-task-restrict-reason">Why is it restricted?</label>
                <textarea id="desk-task-restrict-reason" rows={2} maxLength={500} className={`${INPUT} w-full`} value={restriction.reason} onChange={(e) => setRestriction({ ...restriction, reason: e.target.value })} data-testid="desk-task-restrict-reason" />
                <p className="text-xs text-slate-500 mt-1">Internal: VAs and the agency don&apos;t see who is named or why. Anyone holding this work who isn&apos;t ticked goes back to the queue.</p>
                <div className="flex flex-wrap gap-2 mt-2">
                  <button type="button" className={PRIMARY} style={{ backgroundColor: ACCENT }} disabled={busy || !restriction.chosen.length || !restriction.reason.trim()} onClick={() => saveRestriction(restriction.chosen, restriction.reason)} data-testid="desk-task-restrict-save">{restriction.restricted ? 'Save' : 'Restrict'}</button>
                  {restriction.restricted && <button type="button" className={SECONDARY} disabled={busy} onClick={() => saveRestriction([], '')} data-testid="desk-task-restrict-lift">Lift restriction</button>}
                  <button type="button" className={SECONDARY} onClick={() => setRestriction(null)}>Cancel</button>
                </div>
              </div>
            )}

            {podPicker && (
              <div className="mt-3 pt-3 border-t border-slate-100" data-testid="desk-task-pod-picker">
                <ul className="grid gap-2 list-none p-0">
                  {(task.pods ?? []).filter((pod) => pod.id !== task.pod?.id).map((pod) => (
                    <li key={pod.id}>
                      <button type="button" disabled={busy} className="w-full text-left border border-slate-200 rounded-lg px-3 py-2 text-sm hover:bg-slate-50 disabled:opacity-60"
                        onClick={() => void act(() => post('pod', { podId: pod.id }), `#${task.reference} moved to ${pod.name}.`)} data-testid="desk-task-pod-choice">{pod.name}</button>
                    </li>
                  ))}
                </ul>
                {task.assignee && <p className="text-xs text-slate-500 mt-2">If {task.assignee.name} can&apos;t work it in the new pod, it goes back to that pod&apos;s queue.</p>}
              </div>
            )}

            {picker && (
              <div className="mt-3 pt-3 border-t border-slate-100" data-testid="desk-task-picker">
                {picker === 'loading' && <p className="text-sm text-slate-500">Loading who can take this…</p>}
                {picker !== 'loading' && picker.length === 0 && <p className="text-sm text-slate-600">Nobody is authorised for this agency, pod and task yet.</p>}
                {picker !== 'loading' && picker.length > 0 && (
                  <ul className="grid gap-2 list-none p-0">
                    {picker.map((person) => (
                      <li key={person.id}>
                        <button type="button" disabled={busy || person.id === task.assignee?.id} className="w-full text-left border border-slate-200 rounded-lg px-3 py-2 text-sm hover:bg-slate-50 disabled:opacity-60"
                          onClick={() => void act(() => post('assign', { assigneeId: person.id }), person.id === userId ? `You took #${task.reference}.` : `#${task.reference} is assigned to ${person.name}.`)} data-testid="desk-task-picker-person">
                          <span className="font-medium text-slate-800">{person.name}{person.id === userId ? ' (you)' : ''}{person.lead ? ' · Pod lead' : ''}</span>
                          <span className="block text-slate-500">{person.id === task.assignee?.id ? 'Has it now' : `${person.kind === 'VA' ? 'VA' : 'Account Manager'} · ${person.openTasks} open`}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </section>

          <section className={CARD} data-testid="desk-task-documents">
            <h2 className={H2}>Documents</h2>
            {task.documents.length === 0 && <p className="text-sm text-slate-500 mb-3">No documents yet.</p>}
            <ul className="grid gap-2 list-none p-0 mb-3">
              {task.documents.map((d) => (
                <li key={d.id} className="border border-slate-200 rounded-lg p-3 text-sm min-w-0" data-testid="desk-task-document">
                  <a href={`/api/desk/documents/${d.id}${d.viewable ? '?view=1' : ''}`} target="_blank" rel="noopener noreferrer" className="font-medium underline break-all" style={{ color: ACCENT }} data-testid="desk-task-document-open">{d.fileName}</a>
                  <p className="text-slate-500 mt-0.5">{d.sensitivityLabel} · {formatBytes(d.fileSize)} · {d.visibility === 'AGENCY' ? 'Shared with the agency' : 'Internal'}</p>
                  <p className="text-slate-500">{d.addedBy} · {when(d.createdAt)}</p>
                  <div className="flex gap-3 mt-1">
                    {d.viewable && <a href={`/api/desk/documents/${d.id}`} className="text-slate-700 underline" data-testid="desk-task-document-download">Download</a>}
                    {d.canRemove && <button type="button" className="text-red-700 underline" disabled={busy} onClick={() => removeDoc(d)} data-testid="desk-task-document-remove">Remove</button>}
                  </div>
                </li>
              ))}
            </ul>
            {p.addDocuments && (
              <div className="grid gap-2 border-t border-slate-100 pt-3" data-testid="desk-task-upload">
                <input ref={fileInput} type="file" accept={DOCUMENT_ACCEPT} aria-label="File" className="text-sm min-w-0"
                  onChange={(e) => setUpload({ ...upload, file: e.target.files?.[0] ?? null })} data-testid="desk-task-upload-file" />
                {uploadProblem && <p className="text-sm text-red-600" data-testid="desk-task-upload-problem">{uploadProblem}</p>}
                <select aria-label="Category" className={INPUT} value={upload.sensitivity} onChange={(e) => setUpload({ ...upload, sensitivity: e.target.value as DocumentSensitivity })} data-testid="desk-task-upload-category">
                  <option value="">Choose a category…</option>
                  {CATEGORIES.map((c) => <option key={c} value={c}>{SENSITIVITY_LABELS[c]}</option>)}
                </select>
                {upload.sensitivity && <p className="text-xs text-slate-500">{CATEGORY_HINTS[upload.sensitivity]}</p>}
                <label className="flex items-center gap-2 text-sm text-slate-700">
                  <input type="checkbox" checked={upload.shared} onChange={(e) => setUpload({ ...upload, shared: e.target.checked })} data-testid="desk-task-upload-shared" />
                  Share with the agency
                </label>
                <button type="button" className={PRIMARY} style={{ backgroundColor: ACCENT }} disabled={busy || !upload.file || !upload.sensitivity || !!uploadProblem} onClick={() => void sendFile()} data-testid="desk-task-upload-send">Attach</button>
                <p className="text-xs text-slate-500">{DOCUMENT_KINDS_TEXT}, up to 9 MB. Internal unless shared.</p>
              </div>
            )}
          </section>

          {task.classification && <TaskClassificationCard taskId={taskId} value={task.classification} busy={busy} act={act} />}

          {task.billing && review && (
            <section className={CARD} data-testid="desk-task-review">
              <h2 className={H2}>Complexity and billing</h2>
              <p className="text-sm text-slate-600 mb-3" data-testid="desk-task-billing">
                Counts toward {task.billing.serviceCategory ? SERVICE_CATEGORY_LABELS[task.billing.serviceCategory] : 'no category'}
                {task.billing.class ? ` · ${task.billing.class === 'INCLUDED' ? 'Included in the plan' : task.billing.class === 'OVERAGE' ? 'Overage' : 'Non-billable'}${task.billing.period ? ` (${task.billing.period})` : ''}` : task.status === 'COMPLETED' ? ' · not classified yet: the agency has no plan allowance for this' : ' · decided when completed'}
              </p>
              {p.review ? (
                <div className="grid gap-2">
                  <div className="grid grid-cols-2 gap-2">
                    <label className="text-sm text-slate-700">Complexity
                      <select className={`${INPUT} w-full mt-1`} value={review.complexity} onChange={(e) => setReview({ ...review, complexity: e.target.value as TaskComplexity })} data-testid="desk-task-review-complexity">
                        {Object.entries(COMPLEXITY_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                      </select>
                    </label>
                    <label className="text-sm text-slate-700">Priority
                      <select className={`${INPUT} w-full mt-1`} value={review.priority} onChange={(e) => setReview({ ...review, priority: e.target.value as TaskPriority })} data-testid="desk-task-review-priority">
                        {Object.entries(PRIORITY_LABELS).reverse().map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                      </select>
                    </label>
                    <label className="text-sm text-slate-700">Billable units
                      <input type="number" min={1} max={MAX_UNITS} className={`${INPUT} w-full mt-1`} value={review.billableUnits} onChange={(e) => setReview({ ...review, billableUnits: e.target.value })} data-testid="desk-task-review-units" />
                    </label>
                    <label className="flex items-end gap-2 text-sm text-slate-700 pb-2">
                      <input type="checkbox" checked={review.nonBillable} onChange={(e) => setReview({ ...review, nonBillable: e.target.checked })} data-testid="desk-task-review-nonbillable" />
                      Non-billable
                    </label>
                  </div>
                  <textarea aria-label="Reason" rows={2} maxLength={REVIEW_REASON_MAX} className={`${INPUT} w-full`} placeholder="Why? Kept in the internal history." value={review.reason} onChange={(e) => setReview({ ...review, reason: e.target.value })} data-testid="desk-task-review-reason" />
                  {reviewCheck && 'problem' in reviewCheck && (review.reason || reviewCheck.problem !== 'Change something first.') && <p className="text-xs text-slate-500" data-testid="desk-task-review-hint">{reviewCheck.problem}</p>}
                  <button type="button" className={PRIMARY} style={{ backgroundColor: ACCENT }} disabled={busy || !reviewCheck || !('body' in reviewCheck)}
                    onClick={() => { if (reviewCheck && 'body' in reviewCheck) void act(() => post('review', reviewCheck.body), 'Saved. A new complexity or priority recalculates the due date.'); }} data-testid="desk-task-review-save">Save</button>
                  <p className="text-xs text-slate-500">A new complexity or priority can change the service-level target and its due date.</p>
                </div>
              ) : (
                <p className="text-sm text-slate-500">Reopen the request to change its complexity or billing.</p>
              )}
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
