'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  FileText, Send, Eye, MousePointerClick, PenLine, Download,
  Ban, Clock, RefreshCw, ShieldCheck, ChevronDown, ChevronUp,
} from 'lucide-react';

/**
 * E-Sign Activity log (requirement 10).
 *
 * A timeline of everything that happened to a proposal, plus the signature's
 * audit record. Agent- and Admin-facing only.
 *
 * Timestamps render in the reader's own timezone with the zone named, because
 * an agent reading "10:02 AM" needs to know whose 10:02 that is — the
 * certificate PDF states UTC for the same reason.
 */

interface ActivityEvent {
  id: string;
  type: string;
  label: string;
  at: string;
  ipAddress: string | null;
  device: string;
  metadata: Record<string, unknown> | null;
}

interface SignatureAudit {
  signerName: string;
  signerTitle: string | null;
  signerEmail: string | null;
  signedAt: string;
  ipAddress: string | null;
  device: string;
  signatureType: 'TYPED' | 'DRAWN';
  proposalVersion: number;
  consentAccepted: boolean;
  consentText: string | null;
}

const ICONS: Record<string, typeof FileText> = {
  CREATED: FileText, SENT: Send, RESENT: RefreshCw, OPENED: Eye, VIEWED: Eye,
  OPTION_SELECTED: MousePointerClick, OPTION_CHANGED: MousePointerClick,
  SIGNED: PenLine, PDF_GENERATED: Download, LINK_REVOKED: Ban,
  VERSION_CREATED: FileText, EXPIRED: Clock,
};

/** Milestones worth colouring; everything else stays neutral. */
const HIGHLIGHT = new Set(['SIGNED', 'OPTION_SELECTED', 'SENT']);

function when(iso: string): string {
  const d = new Date(iso);
  const date = d.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
  const time = d.toLocaleTimeString(undefined, {
    hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
  });
  return `${date}, ${time}`;
}

export default function ActivityLog({ proposalId }: { proposalId: string }) {
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [signature, setSignature] = useState<SignatureAudit | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/proposals/${proposalId}/activity`);
      const json = await res.json();
      if (!res.ok) { setError(json.error || 'Could not load the activity log.'); return; }
      setEvents(json.events ?? []);
      setSignature(json.signature ?? null);
    } catch {
      setError('Network error.');
    } finally {
      setLoading(false);
    }
  }, [proposalId]);

  useEffect(() => { load(); }, [load]);

  if (loading) return null;

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5" data-testid="activity-log">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center justify-between gap-3 w-full text-left"
        aria-expanded={open}
      >
        <div>
          <h2 className="text-lg font-medium" style={{ color: 'var(--brand-primary)' }}>
            E-Sign Activity
          </h2>
          <p className="text-sm text-slate-500">
            {events.length === 0
              ? 'Nothing has happened yet.'
              : `${events.length} event${events.length === 1 ? '' : 's'}${signature ? ' · signed' : ''}`}
          </p>
        </div>
        {open ? <ChevronUp className="w-5 h-5 text-slate-400" /> : <ChevronDown className="w-5 h-5 text-slate-400" />}
      </button>

      {error && (
        <div className="mt-3 rounded-md px-3 py-2 text-sm" style={{ backgroundColor: '#FEE2E2', color: '#991B1B' }}>
          {error}
        </div>
      )}

      {open && (
        <div className="mt-4">
          {events.length === 0 ? (
            <p className="text-sm text-slate-400">
              Activity appears here once the proposal is sent.
            </p>
          ) : (
            <ol className="relative border-l border-slate-200 ml-2">
              {events.map((e) => {
                const Icon = ICONS[e.type] ?? FileText;
                const highlight = HIGHLIGHT.has(e.type);
                return (
                  <li key={e.id} className="ml-5 pb-4 last:pb-0" data-testid={`event-${e.type}`}>
                    <span
                      className="absolute -left-[9px] flex items-center justify-center w-[18px] h-[18px] rounded-full"
                      style={{ backgroundColor: highlight ? 'var(--brand-accent)' : '#e2e8f0' }}
                    >
                      <Icon className="w-2.5 h-2.5" style={{ color: highlight ? 'var(--brand-primary)' : '#64748b' }} />
                    </span>
                    <p className={`text-sm ${highlight ? 'font-medium text-slate-900' : 'text-slate-700'}`}>
                      {e.label}
                    </p>
                    <p className="text-xs text-slate-400">
                      {when(e.at)}
                      {e.ipAddress && ` · ${e.ipAddress}`}
                      {e.device !== 'Unknown device' && ` · ${e.device}`}
                    </p>
                    {typeof e.metadata?.optionLabel === 'string' && (
                      <p className="text-xs text-slate-500 mt-0.5">{e.metadata.optionLabel}</p>
                    )}
                  </li>
                );
              })}
            </ol>
          )}

          {signature && (
            <div className="mt-5 pt-4 border-t border-slate-200">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-2 flex items-center gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5" /> Signature record
              </p>
              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
                {([
                  ['Signed by', signature.signerName],
                  ['Title', signature.signerTitle],
                  ['Email', signature.signerEmail],
                  ['Signed at', when(signature.signedAt)],
                  ['Method', signature.signatureType === 'DRAWN' ? 'Drawn' : 'Typed'],
                  ['Proposal version', String(signature.proposalVersion)],
                  ['IP address', signature.ipAddress],
                  ['Device', signature.device],
                  ['Consent', signature.consentAccepted ? 'Accepted' : 'Not accepted'],
                ] as [string, string | null][]).map(([label, value]) =>
                  value ? (
                    <div key={label}>
                      <dt className="text-xs text-slate-400">{label}</dt>
                      <dd className="text-slate-700">{value}</dd>
                    </div>
                  ) : null
                )}
              </dl>
              {signature.consentText && (
                <details className="mt-3">
                  <summary className="text-xs text-slate-400 cursor-pointer hover:text-slate-600">
                    Consent wording agreed to
                  </summary>
                  <p className="text-xs text-slate-500 leading-relaxed mt-1.5 pl-2 border-l-2 border-slate-200">
                    {signature.consentText}
                  </p>
                </details>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
