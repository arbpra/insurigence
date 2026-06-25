'use client';

import { useCallback, useEffect, useState } from 'react';
import AiDisclaimer from '@/components/ai/AiDisclaimer';
import AiAssistedBadge from '@/components/ai/AiAssistedBadge';
import AiReviewStatus from '@/components/ai/AiReviewStatus';

interface CoiCoverage {
  type: string;
  policyNumber: string;
  effectiveDate: string;
  expirationDate: string;
  limits: string;
}

interface FlaggedWording {
  request: string;
  concern: string;
}

interface CoiData {
  insuredName: string;
  certificateHolder: string;
  descriptionOfOperations: string;
  coverages: CoiCoverage[];
  additionalInsured: boolean;
  waiverOfSubrogation: boolean;
  missingInformation: string[];
  flaggedWording: FlaggedWording[];
  endorsementReviewNeeded: boolean;
  endorsementReviewReason: string;
}

/**
 * Feature 6 — COI Assistant panel for the proposal page.
 * The agent enters certificate-holder/project/wording details; the AI drafts
 * COI fields, a missing-info checklist, flags unusual wording, and notes whether
 * endorsement review is needed. Draft only — never confirms or issues a COI.
 */
export default function CoiAssistantPanel({ leadId }: { leadId: string }) {
  const [certificateHolder, setCertificateHolder] = useState('');
  const [projectDetails, setProjectDetails] = useState('');
  const [additionalInsured, setAdditionalInsured] = useState(false);
  const [waiver, setWaiver] = useState(false);
  const [specialWording, setSpecialWording] = useState('');

  const [data, setData] = useState<CoiData | null>(null);
  const [reviewedAt, setReviewedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadExisting = useCallback(async () => {
    try {
      const res = await fetch(`/api/ai/coi/${leadId}`);
      const json = await res.json();
      if (res.ok && json.data) {
        setData(json.data);
        setReviewedAt(json.reviewedAt ?? null);
      }
    } catch {
      /* non-fatal */
    } finally {
      setLoaded(true);
    }
  }, [leadId]);

  useEffect(() => {
    loadExisting();
  }, [loadExisting]);

  const generate = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/ai/coi/${leadId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          certificateHolder,
          projectDetails,
          additionalInsuredRequested: additionalInsured,
          waiverRequested: waiver,
          specialWording,
        }),
      });
      const json = await res.json();
      if (!res.ok) setError(json.error || 'Failed to draft COI');
      else {
        setData(json.data);
        setReviewedAt(null);
      }
    } catch {
      setError('Network error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="brand-card p-8 mb-8" data-testid="section-coi-assistant">
      <div className="flex items-center justify-between mb-6 gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center"
            style={{ backgroundColor: 'rgba(124, 58, 237, 0.1)' }}
          >
            <span className="text-violet-600 text-lg" aria-hidden>✦</span>
          </div>
          <div>
            <h3 className="text-xl font-semibold" style={{ color: 'var(--brand-primary)' }}>
              COI Assistant
            </h3>
            <div className="mt-1">
              <AiAssistedBadge />
            </div>
          </div>
        </div>
        {data && <AiReviewStatus reviewedAt={reviewedAt} />}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
        <div>
          <label className="text-xs uppercase font-bold mb-1 block" style={{ color: 'var(--brand-text-subtle)' }}>
            Certificate Holder *
          </label>
          <input
            value={certificateHolder}
            onChange={(e) => setCertificateHolder(e.target.value)}
            placeholder="Name & address of certificate holder"
            className="form-input w-full"
            data-testid="input-coi-holder"
          />
        </div>
        <div>
          <label className="text-xs uppercase font-bold mb-1 block" style={{ color: 'var(--brand-text-subtle)' }}>
            Project / Job Details
          </label>
          <input
            value={projectDetails}
            onChange={(e) => setProjectDetails(e.target.value)}
            placeholder="e.g. Roofing at 123 Main St, Contract #4471"
            className="form-input w-full"
            data-testid="input-coi-project"
          />
        </div>
      </div>

      <div className="mb-4">
        <label className="text-xs uppercase font-bold mb-1 block" style={{ color: 'var(--brand-text-subtle)' }}>
          Special Wording Requests
        </label>
        <textarea
          value={specialWording}
          onChange={(e) => setSpecialWording(e.target.value)}
          rows={2}
          placeholder="Any specific wording the holder requested"
          className="form-input resize-y w-full"
          data-testid="input-coi-wording"
        />
      </div>

      <div className="flex items-center gap-6 mb-4 flex-wrap">
        <label className="flex items-center gap-2 text-sm" style={{ color: 'var(--brand-text-muted)' }}>
          <input type="checkbox" checked={additionalInsured} onChange={(e) => setAdditionalInsured(e.target.checked)} />
          Additional Insured requested
        </label>
        <label className="flex items-center gap-2 text-sm" style={{ color: 'var(--brand-text-muted)' }}>
          <input type="checkbox" checked={waiver} onChange={(e) => setWaiver(e.target.checked)} />
          Waiver of Subrogation requested
        </label>
        <div className="ml-auto">
          <button
            onClick={generate}
            disabled={loading || !certificateHolder.trim()}
            className="btn-brand-primary px-4 py-2"
            data-testid="button-generate-coi"
          >
            {loading ? 'Drafting…' : data ? 'Regenerate Draft' : 'Draft COI'}
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-2 text-sm mb-4">
          {error}
        </div>
      )}

      {!data && loaded && !error && (
        <p className="text-sm" style={{ color: 'var(--brand-text-muted)' }}>
          Enter the certificate holder and any requests, then draft a COI. Policy data is pulled from
          this lead&apos;s latest Document Summary if available.
        </p>
      )}

      {data && (
        <div className="space-y-4 mt-2">
          <AiDisclaimer text="Draft only. This COI is not issued and does not confirm coverage. Agent review and approval required." />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Stat label="Insured" value={data.insuredName} />
            <Stat label="Certificate Holder" value={data.certificateHolder} />
          </div>

          <div className="rounded-xl border border-slate-200 p-5">
            <p className="text-xs uppercase font-bold mb-3" style={{ color: 'var(--brand-text-subtle)' }}>
              Coverages
            </p>
            {data.coverages.length === 0 ? (
              <p className="text-sm" style={{ color: 'var(--brand-text-muted)' }}>None available.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left" style={{ color: 'var(--brand-text-subtle)' }}>
                    <th className="py-1 font-medium">Type</th>
                    <th className="py-1 font-medium">Policy #</th>
                    <th className="py-1 font-medium">Limits</th>
                  </tr>
                </thead>
                <tbody>
                  {data.coverages.map((c, i) => (
                    <tr key={i} className="border-t border-slate-100" style={{ color: 'var(--brand-text-muted)' }}>
                      <td className="py-1.5">{c.type}</td>
                      <td className="py-1.5">{c.policyNumber || '—'}</td>
                      <td className="py-1.5">{c.limits || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="flex gap-4 flex-wrap text-sm">
            <Flag on={data.additionalInsured} label="Additional Insured" />
            <Flag on={data.waiverOfSubrogation} label="Waiver of Subrogation" />
          </div>

          {data.descriptionOfOperations && (
            <Block label="Description of Operations" value={data.descriptionOfOperations} />
          )}

          <div className="rounded-xl border border-slate-200 p-5">
            <p className="text-xs uppercase font-bold mb-2" style={{ color: 'var(--brand-text-subtle)' }}>
              Missing Information
            </p>
            {data.missingInformation.length === 0 ? (
              <p className="text-sm" style={{ color: 'var(--market-standard)' }}>Nothing missing.</p>
            ) : (
              <ul className="space-y-2">
                {data.missingInformation.map((m, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm" style={{ color: 'var(--brand-text-muted)' }}>
                    <span className="text-amber-500 mt-0.5" aria-hidden>⚠</span>
                    <span>{m}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {data.flaggedWording.length > 0 && (
            <div className="rounded-xl border border-red-200 bg-red-50/50 p-5">
              <p className="text-xs uppercase font-bold mb-2 text-red-700">Flagged for Agent Review</p>
              <ul className="space-y-2">
                {data.flaggedWording.map((f, i) => (
                  <li key={i} className="text-sm text-red-800">
                    <span className="font-medium">{f.request}</span>
                    {f.concern ? ` — ${f.concern}` : ''}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {data.endorsementReviewNeeded && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-5">
              <p className="text-xs uppercase font-bold mb-1 text-amber-800">Endorsement Review Suggested</p>
              <p className="text-sm text-amber-800">{data.endorsementReviewReason || 'An endorsement may be required to honor these requests.'}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-200 p-4">
      <p className="text-xs uppercase font-bold mb-1" style={{ color: 'var(--brand-text-subtle)' }}>{label}</p>
      <p className="text-sm font-medium" style={{ color: 'var(--brand-text)' }}>{value || '—'}</p>
    </div>
  );
}

function Block({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-200 p-5">
      <p className="text-xs uppercase font-bold mb-2" style={{ color: 'var(--brand-text-subtle)' }}>{label}</p>
      <p className="text-sm whitespace-pre-line" style={{ color: 'var(--brand-text-muted)' }}>{value}</p>
    </div>
  );
}

function Flag({ on, label }: { on: boolean; label: string }) {
  return (
    <span
      className="inline-flex items-center gap-2 rounded-full px-3 py-1"
      style={{
        backgroundColor: on ? 'var(--market-standard-bg)' : '#F1F5F9',
        color: on ? 'var(--market-standard)' : '#94A3B8',
      }}
    >
      <span aria-hidden>{on ? '✓' : '—'}</span>
      {label}
    </span>
  );
}
