'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { MESSAGE_MAX, messageTime } from '@/lib/desk/message-view';
import { ApiError, api } from '@/components/desk/accounts/account-api';

type Side = 'AGENCY' | 'DESK';
interface Thread { agencyId: string; agencyName: string; unread: number; last: { side: Side; snippet: string; at: string } | null }
interface Conversation { taskId: string; reference: number; title: string; agencyName?: string; from: Side; author: string; snippet: string; at: string }
interface Inbox { canMessage: boolean; threads: Thread[]; requestConversations: Conversation[] }
interface Message { id: string; side: Side; mine: boolean; author: string; body: string; at: string }
interface ThreadView { agency: { id: string; name: string }; yourSide: Side; total: number; messages: Message[] }

const ACCENT = 'var(--brand-primary, #05314c)';
const CARD = 'border border-slate-200 rounded-xl bg-white p-4 sm:p-5 min-w-0';
const INPUT = 'border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white min-w-0';
const BUTTON = 'px-3 py-1.5 text-sm rounded-lg font-medium disabled:opacity-50';
const SECONDARY = `${BUTTON} border border-slate-300 bg-white text-slate-700`;
const H2 = 'text-base font-semibold text-slate-900';

/**
 * Messages, for an agency (its conversation with its Desk team) or for Desk
 * managers (one conversation per agency they look after), with the latest
 * conversations on requests beside it.
 */
export function Messages({ mode, initialAgencyId }: { mode: 'agency' | 'desk'; initialAgencyId: string | null }) {
  const [inbox, setInbox] = useState<Inbox | null>(null);
  const [inboxError, setInboxError] = useState('');
  const [selected, setSelected] = useState<string | null>(initialAgencyId);
  const [thread, setThread] = useState<ThreadView | null>(null);
  const [threadError, setThreadError] = useState('');
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [problem, setProblem] = useState('');
  const [attempt, setAttempt] = useState(0);
  const bottom = useRef<HTMLLIElement>(null);
  const requestHref = (taskId: string) => (mode === 'agency' ? `/desk/requests/${taskId}` : `/desk-ops/tasks/${taskId}`);

  const loadInbox = useCallback(async () => {
    try {
      const data = await api<Inbox>('/api/desk/messages');
      setInbox(data);
      setInboxError('');
      return data;
    } catch (err) {
      setInboxError(err instanceof Error ? err.message : 'Messages could not be loaded.');
      return null;
    }
  }, []);

  useEffect(() => {
    void loadInbox().then((data) => {
      // An agency has one conversation; open it straight away.
      if (data && mode === 'agency' && data.threads[0]) setSelected(data.threads[0].agencyId);
    });
  }, [loadInbox, mode, attempt]);

  const loadThread = useCallback(async (agencyId: string) => {
    try {
      setThread(await api<ThreadView>(`/api/desk/messages/${agencyId}`));
      setThreadError('');
    } catch (err) {
      setThread(null);
      setThreadError(err instanceof ApiError && err.status === 404 ? "This conversation isn't available to you." : err instanceof Error ? err.message : 'The conversation could not be loaded.');
    }
  }, []);

  useEffect(() => {
    if (!selected) { setThread(null); return; }
    setThread(null);
    void loadThread(selected).then(() => loadInbox()); // opening it marks it read
    if (mode === 'desk') {
      try { window.history.replaceState(null, '', `/desk-ops/messages?agency=${selected}`); } catch { /* address only */ }
    }
  }, [selected, loadThread, loadInbox, mode]);

  useEffect(() => { bottom.current?.scrollIntoView({ block: 'end' }); }, [thread?.messages.length]);

  async function send() {
    if (!selected || !draft.trim()) return;
    setSending(true);
    setProblem('');
    try {
      await api(`/api/desk/messages/${selected}`, { method: 'POST', body: JSON.stringify({ body: draft }) });
      setDraft('');
      await loadThread(selected);
      await loadInbox();
    } catch (err) {
      setProblem(err instanceof Error ? err.message : 'The message could not be sent.');
    } finally {
      setSending(false);
    }
  }

  const conversations = inbox?.requestConversations ?? [];
  const threadPanel = (
    <section className={`${CARD} flex flex-col`} data-testid="desk-messages-thread">
      {!selected ? (
        <p className="text-sm text-slate-500">Choose an agency to see your conversation.</p>
      ) : threadError ? (
        <p className="text-sm text-slate-700" role="alert">{threadError}</p>
      ) : !thread ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : (
        <>
          <h2 className={`${H2} mb-1`} data-testid="desk-messages-thread-title">
            {mode === 'agency' ? 'Your Desk team' : thread.agency.name}
          </h2>
          <p className="text-xs text-slate-500 mb-3">
            {mode === 'agency'
              ? 'Your Account Manager and the Desk managers read this. For one request, use its own page.'
              : "The agency's owners and admins read this. For one request, use its notes."}
          </p>
          {thread.total > thread.messages.length && <p className="text-xs text-slate-500 mb-2">Showing the latest {thread.messages.length} of {thread.total} messages.</p>}
          <ol className="grid gap-3 list-none p-0 mb-4 max-h-[60vh] overflow-y-auto" data-testid="desk-messages-list">
            {thread.messages.length === 0 && <li className="text-sm text-slate-500">No messages yet. Say hello.</li>}
            {thread.messages.map((m) => (
              <li key={m.id} className={`max-w-[85%] min-w-0 ${m.side === thread.yourSide ? 'justify-self-end text-right' : 'justify-self-start'}`} data-testid="desk-messages-message" data-side={m.side}>
                <div className={`inline-block text-left rounded-xl px-3 py-2 text-sm whitespace-pre-wrap break-words ${m.side === thread.yourSide ? 'text-white' : 'bg-slate-100 text-slate-900'}`}
                  style={m.side === thread.yourSide ? { backgroundColor: ACCENT } : undefined} data-testid="desk-messages-body">{m.body}</div>
                <p className="text-xs text-slate-500 mt-0.5">{m.mine ? 'You' : m.author} · {messageTime(m.at)}</p>
              </li>
            ))}
            <li ref={bottom} aria-hidden="true" className="h-0" />
          </ol>
          <div className="border-t border-slate-100 pt-3">
            <textarea aria-label="Message" rows={3} maxLength={MESSAGE_MAX} className={`${INPUT} w-full`} value={draft}
              onChange={(e) => { setDraft(e.target.value); setProblem(''); }} placeholder="Write a message…" data-testid="desk-messages-draft"
              onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void send(); }} />
            {problem && <p className="text-sm text-red-600 mt-1" role="alert" data-testid="desk-messages-problem">{problem}</p>}
            <div className="flex flex-wrap items-center justify-between gap-2 mt-2">
              <p className="text-xs text-slate-500">Never send passwords or carrier logins here.</p>
              <button type="button" className={`${BUTTON} text-white`} style={{ backgroundColor: ACCENT }} disabled={sending || !draft.trim()} onClick={() => void send()} data-testid="desk-messages-send">Send</button>
            </div>
          </div>
        </>
      )}
    </section>
  );

  const conversationsPanel = (
    <section className={CARD} data-testid="desk-messages-requests">
      <h2 className={`${H2} mb-1`}>Conversations on requests</h2>
      <p className="text-xs text-slate-500 mb-3">The latest shared note on each request.</p>
      {conversations.length === 0 ? <p className="text-sm text-slate-500">None yet.</p> : (
        <ul className="grid gap-3 list-none p-0">
          {conversations.map((c) => (
            <li key={c.taskId} className="text-sm min-w-0" data-testid="desk-messages-request">
              <Link href={requestHref(c.taskId)} className="font-medium hover:underline break-words" style={{ color: ACCENT }} data-testid="desk-messages-request-open">
                <span className="text-slate-400 mr-1">#{c.reference}</span>{c.title}
              </Link>
              {c.agencyName && <p className="text-xs text-slate-500">{c.agencyName}</p>}
              <p className="text-slate-700 break-words">{c.snippet}</p>
              <p className="text-xs text-slate-500">{c.author} · {messageTime(c.at)}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );

  if (inboxError && !inbox) {
    return (
      <div className={CARD} role="alert">
        <p className="text-sm text-red-600 mb-2">{inboxError}</p>
        <button type="button" className={SECONDARY} onClick={() => setAttempt((n) => n + 1)}>Try again</button>
      </div>
    );
  }

  return (
    <div data-testid={`desk-messages-${mode}`}>
      <h1 className="text-2xl font-bold tracking-tight mb-5" style={{ color: ACCENT }} data-testid="page-title">Messages</h1>
      {!inbox ? <p className="text-sm text-slate-500">Loading…</p> : mode === 'agency' ? (
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="lg:col-span-2 min-w-0">
            {inbox.canMessage ? threadPanel : (
              <section className={CARD} data-testid="desk-messages-not-yours">
                <p className="text-sm text-slate-700">Your agency&apos;s owners and admins talk with your Desk team here. To ask about one of your requests, add a note on its page.</p>
              </section>
            )}
          </div>
          <div className="min-w-0">{conversationsPanel}</div>
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-3">
          <section className={`${CARD} content-start`} data-testid="desk-messages-threads">
            <h2 className={`${H2} mb-3`}>Agencies</h2>
            {inbox.threads.length === 0 ? <p className="text-sm text-slate-500">No agencies are assigned to you yet.</p> : (
              <ul className="grid gap-1 list-none p-0">
                {inbox.threads.map((t) => (
                  <li key={t.agencyId}>
                    <button type="button" aria-current={selected === t.agencyId}
                      className={`w-full text-left rounded-lg px-3 py-2 min-w-0 ${selected === t.agencyId ? 'bg-slate-100' : 'hover:bg-slate-50'}`}
                      onClick={() => setSelected(t.agencyId)} data-testid="desk-messages-thread-choose">
                      <span className="flex items-center justify-between gap-2">
                        <span className={`text-sm break-words ${t.unread ? 'font-semibold text-slate-900' : 'text-slate-800'}`}>{t.agencyName}</span>
                        {t.unread > 0 && <span className="shrink-0 text-xs font-semibold text-white rounded-full px-2 py-0.5" style={{ backgroundColor: ACCENT }} data-testid="desk-messages-unread">{t.unread}</span>}
                      </span>
                      <span className="block text-xs text-slate-500 truncate">{t.last ? `${t.last.side === 'DESK' ? 'Desk: ' : ''}${t.last.snippet}` : 'No messages yet'}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <div className="lg:col-span-2 grid gap-4 content-start min-w-0">
            {threadPanel}
            {conversationsPanel}
          </div>
        </div>
      )}
    </div>
  );
}
