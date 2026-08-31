'use client';

import { useState } from 'react';
import { Send, Copy, Check, Link2, Ban, RefreshCw, AlertTriangle, Download } from 'lucide-react';

/**
 * Send, copy, resend, and withdraw the proposal link (requirement 6).
 *
 * The link and the email are separate actions on purpose: an agent often wants
 * the URL to paste into their own client thread, and a failed email must not
 * cost them the link.
 */

interface Props {
  proposalId: string;
  status: string;
  /** Blocking problems from the builder — sending is disabled while any remain. */
  readiness: string[];
  defaultEmail: string | null;
  onSent: () => void;
}

export default function SendProposalPanel({
  proposalId, status, readiness, defaultEmail, onSent,
}: Props) {
  const [email, setEmail] = useState(defaultEmail ?? '');
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState<'send' | 'link' | 'revoke' | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const isSent = ['SENT', 'VIEWED', 'OPTION_SELECTED'].includes(status);
  const isRevoked = status === 'REVOKED';
  const isSigned = status === 'SIGNED';
  const blocked = readiness.length > 0;

  async function send(opts: { withEmail: boolean; resend?: boolean }) {
    setBusy(opts.withEmail ? 'send' : 'link');
    setError('');
    setNotice('');
    try {
      const res = await fetch(`/api/proposals/${proposalId}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sendEmail: opts.withEmail,
          resend: opts.resend ?? false,
          ...(opts.withEmail ? { email } : {}),
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.problems?.length ? `${json.error} ${json.problems.join(' ')}` : (json.error || 'Could not send.'));
        return;
      }
      setUrl(json.proposalUrl);
      // The link is minted even when the email fails, so say so rather than
      // showing a bare error that implies nothing happened.
      if (opts.withEmail && !json.emailed) {
        setError(`The link is ready, but the email did not send: ${json.emailError ?? 'unknown error'}. Copy the link and share it directly.`);
      } else if (opts.withEmail) {
        setNotice(`Sent to ${json.recipient}.`);
      } else {
        setNotice('Link ready — copy it below.');
      }
      onSent();
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setBusy(null);
    }
  }

  async function revoke() {
    setBusy('revoke');
    setError('');
    setNotice('');
    try {
      const res = await fetch(`/api/proposals/${proposalId}/revoke`, { method: 'POST' });
      const json = await res.json();
      if (!res.ok) { setError(json.error || 'Could not withdraw the link.'); return; }
      setUrl(null);
      setNotice('The link has been withdrawn and no longer works.');
      onSent();
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setBusy(null);
    }
  }

  async function copy() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('Could not copy — select the link and copy it manually.');
    }
  }

  const input = 'w-full px-3 py-2 rounded-md border border-slate-300 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#00E6A7] focus:border-transparent';

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5" data-testid="send-panel">
      <h2 className="text-lg font-medium mb-1" style={{ color: 'var(--brand-primary)' }}>
        {isSigned ? 'Signed' : isRevoked ? 'Link Withdrawn' : isSent ? 'Sent' : 'Send to the Insured'}
      </h2>
      <p className="text-sm text-slate-500 mb-4">
        {isSigned
          ? 'This proposal has been signed. It can no longer be edited or resent.'
          : isRevoked
            ? 'The previous link no longer works. Sending again will issue a new one.'
            : 'They can open it without an account, compare the options, and sign.'}
      </p>

      {blocked && !isSigned && (
        <div className="mb-4 rounded-md px-3 py-2 text-sm flex items-start gap-2"
             style={{ backgroundColor: '#FEF3C7', color: '#92400E' }}>
          <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span>Resolve the {readiness.length} item{readiness.length === 1 ? '' : 's'} above before sending.</span>
        </div>
      )}

      {error && (
        <div className="mb-3 rounded-md px-3 py-2 text-sm" style={{ backgroundColor: '#FEE2E2', color: '#991B1B' }}>
          {error}
        </div>
      )}
      {notice && (
        <div className="mb-3 rounded-md px-3 py-2 text-sm" style={{ backgroundColor: '#E9FBF5', color: '#0F9E78' }}>
          {notice}
        </div>
      )}

      {!isSigned && (
        <>
          <label className="block text-xs font-medium text-slate-600 mb-1">Send to</label>
          <div className="flex gap-2 flex-wrap mb-3">
            <input
              type="email"
              className={`${input} flex-1 min-w-[200px]`}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="client@business.com"
              data-testid="send-email"
            />
            <button
              onClick={() => send({ withEmail: true, resend: isSent })}
              disabled={blocked || busy !== null}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md text-sm font-semibold disabled:opacity-50"
              style={{ backgroundColor: 'var(--brand-accent)', color: 'var(--brand-primary)' }}
              data-testid="send-proposal"
            >
              {isSent ? <RefreshCw className="w-4 h-4" /> : <Send className="w-4 h-4" />}
              {busy === 'send' ? 'Sending…' : isSent ? 'Resend' : 'Send Proposal'}
            </button>
          </div>

          <button
            onClick={() => send({ withEmail: false })}
            disabled={blocked || busy !== null}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-700 disabled:opacity-50"
            data-testid="get-link"
          >
            <Link2 className="w-4 h-4" />
            {busy === 'link' ? 'Preparing…' : 'Just give me the link'}
          </button>
        </>
      )}

      {url && (
        <div className="mt-4 flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
          <code className="text-xs text-slate-600 truncate flex-1" data-testid="proposal-url">{url}</code>
          <button
            onClick={copy}
            className="p-1.5 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-200 flex-shrink-0"
            title="Copy link"
            aria-label="Copy proposal link"
          >
            {copied ? <Check className="w-4 h-4" style={{ color: '#0F9E78' }} /> : <Copy className="w-4 h-4" />}
          </button>
        </div>
      )}

      <div className="mt-4 pt-4 border-t border-slate-200">
        <a
          href={`/api/proposals/${proposalId}/pdf`}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-800"
          data-testid="agent-download-pdf"
        >
          <Download className="w-4 h-4" />
          Download {isSigned ? 'the signed proposal' : 'a preview'} (PDF)
        </a>
      </div>

      {isSent && !isSigned && (
        <button
          onClick={revoke}
          disabled={busy !== null}
          className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-slate-400 hover:text-red-600 disabled:opacity-50"
          data-testid="revoke-link"
        >
          <Ban className="w-4 h-4" />
          {busy === 'revoke' ? 'Withdrawing…' : 'Withdraw this link'}
        </button>
      )}
    </div>
  );
}
