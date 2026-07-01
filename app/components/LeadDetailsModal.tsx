'use client';

import { useState } from 'react';
import Link from 'next/link';

interface LeadLike {
  id: string;
  insuredName: string;
  primaryContactEmail?: string | null;
  status: string;
  source?: string;
  marketClassification: string | null;
  marketConfidence: number | null;
  marketReasonCodes?: string[];
  archivedAt?: string | null;
  createdAt: string;
  intakeSubmission?: { responses: Record<string, unknown> };
}

/** Read the first non-empty value among candidate keys from the answers map. */
function pick(answers: Record<string, unknown>, keys: string[]): unknown {
  for (const k of keys) {
    const v = answers[k];
    if (v !== undefined && v !== null && String(v).trim?.() !== '') return v;
  }
  return undefined;
}

function fmt(v: unknown): string {
  if (v === undefined || v === null || v === '') return '—';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (Array.isArray(v)) return v.length ? v.join(', ') : '—';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

const MARKET_LABEL: Record<string, string> = {
  STANDARD: 'Standard',
  EXCESS_SURPLUS: 'E&S',
  BORDERLINE: 'Borderline',
};

/**
 * Read-only company/intake details for a lead, shown from data already loaded on
 * the dashboard. Curated fields cover the common intake shapes (flat and dotted);
 * the full raw intake is available in an expandable section for completeness.
 */
export default function LeadDetailsModal({
  lead,
  onClose,
  onChanged,
}: {
  lead: LeadLike;
  onClose: () => void;
  /** Called after a successful archive/unarchive/delete so the list can refresh. */
  onChanged?: () => void;
}) {
  const isArchived = Boolean(lead.archivedAt);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggleArchive = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/leads/${lead.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ archived: !isArchived }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setError(j.error || 'Failed to update');
      } else {
        onChanged?.();
      }
    } catch {
      setError('Network error');
    } finally {
      setBusy(false);
    }
  };

  const deleteLead = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/leads/${lead.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setError(j.error || 'Failed to delete');
      } else {
        onChanged?.();
      }
    } catch {
      setError('Network error');
    } finally {
      setBusy(false);
    }
  };

  const responses = lead.intakeSubmission?.responses ?? {};
  const answers = ((responses as Record<string, unknown>).answers as Record<string, unknown>) ?? responses;

  const business: [string, unknown][] = [
    ['Industry', pick(answers, ['industry', 'ops.industry_primary'])],
    ['Years in Business', pick(answers, ['yearsInBusiness', 'insured.years_in_business'])],
    ['Annual Revenue', pick(answers, ['annualRevenue', 'fin.annual_revenue'])],
    ['Number of Employees', pick(answers, ['numberOfEmployees', 'insured.employee_count'])],
    ['Requested Limits', pick(answers, ['requestedLimits', 'cov.gl_limits'])],
    ['Effective Date', pick(answers, ['effectiveDate', 'cov.effective_date'])],
    ['States of Operation', pick(answers, ['states_of_operation', 'ops.states', 'state'])],
  ];

  const contact: [string, unknown][] = [
    ['Contact Name', pick(answers, ['contactName', 'primaryContactName'])],
    ['Contact Email', pick(answers, ['contactEmail']) ?? lead.primaryContactEmail],
    ['Contact Phone', pick(answers, ['contactPhone', 'phone'])],
  ];

  const claims: [string, unknown][] = [
    ['Prior Claims', pick(answers, ['priorClaims', 'loss.any_5yr'])],
    ['Claim Details', pick(answers, ['priorClaimsDetails', 'loss.total_incurred_5yr'])],
  ];

  const notes = pick(answers, ['additionalNotes', 'description', 'ops.description']);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
      data-testid="lead-details-modal"
    >
      <div
        className="bg-white rounded-2xl shadow-xl max-w-2xl w-full max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4 p-6 border-b border-slate-100">
          <div>
            <h2 className="text-xl font-bold text-slate-900">{lead.insuredName}</h2>
            <div className="flex items-center gap-2 mt-2 flex-wrap">
              <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
                {lead.status.replace(/_/g, ' ')}
              </span>
              {lead.marketClassification && (
                <span className="text-xs px-2 py-0.5 rounded-full bg-blue-50 text-blue-600">
                  {MARKET_LABEL[lead.marketClassification] || lead.marketClassification}
                  {lead.marketConfidence ? ` · ${Math.round(lead.marketConfidence * 100)}%` : ''}
                </span>
              )}
              <span className="text-xs text-slate-400">
                Created {new Date(lead.createdAt).toLocaleDateString()}
              </span>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 hover:bg-slate-100 rounded-lg text-slate-400"
            data-testid="button-close-details"
            aria-label="Close"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-6">
          <Section title="Business" rows={business} />
          <Section title="Contact" rows={contact} />
          <Section title="Loss History" rows={claims} />

          {notes !== undefined && fmt(notes) !== '—' && (
            <div>
              <p className="text-xs uppercase font-bold text-slate-400 mb-2">Notes / Description</p>
              <p className="text-sm text-slate-700 whitespace-pre-line">{fmt(notes)}</p>
            </div>
          )}

          <details className="rounded-lg border border-slate-200">
            <summary className="cursor-pointer px-4 py-2 text-sm text-slate-600">
              All intake responses
            </summary>
            <div className="px-4 pb-3 space-y-1">
              {Object.entries(answers).map(([k, v]) => (
                <div key={k} className="flex gap-3 text-xs border-t border-slate-100 py-1">
                  <span className="text-slate-400 w-48 shrink-0">{k}</span>
                  <span className="text-slate-700 break-words">{fmt(v)}</span>
                </div>
              ))}
            </div>
          </details>
        </div>

        {/* Footer */}
        <div className="p-6 border-t border-slate-100">
          {error && (
            <div className="mb-3 bg-red-50 border border-red-200 text-red-700 rounded-lg px-3 py-2 text-sm">
              {error}
            </div>
          )}

          {confirmDelete ? (
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <p className="text-sm text-red-700">
                Permanently delete <strong>{lead.insuredName}</strong> and all its data? This cannot be undone.
              </p>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setConfirmDelete(false)}
                  disabled={busy}
                  className="text-sm text-slate-500 hover:text-slate-800"
                >
                  Cancel
                </button>
                <button
                  onClick={deleteLead}
                  disabled={busy}
                  className="px-4 py-2 text-sm rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
                  data-testid="button-confirm-delete-lead"
                >
                  {busy ? 'Deleting…' : 'Delete Permanently'}
                </button>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <button
                onClick={() => setConfirmDelete(true)}
                disabled={busy}
                className="text-sm font-medium text-red-600 hover:text-red-700 disabled:opacity-50"
                data-testid="button-delete-lead"
              >
                Delete
              </button>
              <div className="flex items-center gap-3">
                <button
                  onClick={toggleArchive}
                  disabled={busy}
                  className="btn-brand-secondary px-4 py-2 text-sm disabled:opacity-50"
                  data-testid="button-archive-lead"
                >
                  {busy ? 'Working…' : isArchived ? 'Unarchive' : 'Archive'}
                </button>
                <Link
                  href={`/leads/${lead.id}/proposal`}
                  className="btn-brand-primary px-4 py-2 text-sm"
                  data-testid="link-open-proposal"
                >
                  Open Proposal
                </Link>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Section({ title, rows }: { title: string; rows: [string, unknown][] }) {
  return (
    <div>
      <p className="text-xs uppercase font-bold text-slate-400 mb-2">{title}</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2">
        {rows.map(([label, value]) => (
          <div key={label} className="flex justify-between gap-3 text-sm border-b border-slate-50 py-1">
            <span className="text-slate-500">{label}</span>
            <span className="text-slate-900 font-medium text-right">{fmt(value)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
