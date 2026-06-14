'use client';

import { useCallback, useEffect, useState } from 'react';
import AiDisclaimer from '@/components/ai/AiDisclaimer';
import AiAssistedBadge from '@/components/ai/AiAssistedBadge';
import AiReviewStatus from '@/components/ai/AiReviewStatus';

interface SmartIntakeData {
  cleanBusinessDescription: string;
  operationsSummary: string;
  missingOrUnclearInfo: string[];
  submissionReadyRiskSummary: string;
}

interface GetResponse {
  data: SmartIntakeData | null;
  reviewedAt?: string | null;
  createdAt?: string;
  disclaimer?: string;
}

/**
 * Feature 1 — Smart Intake Assistant panel for the lead/proposal page.
 * On mount it loads any previously generated output (free — no AI call). The
 * agent generates/regenerates on demand; results are saved server-side for
 * audit/history and show the disclaimer + review status.
 */
export default function SmartIntakePanel({ leadId }: { leadId: string }) {
  const [data, setData] = useState<SmartIntakeData | null>(null);
  const [reviewedAt, setReviewedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadExisting = useCallback(async () => {
    try {
      const res = await fetch(`/api/ai/smart-intake/${leadId}`);
      const json: GetResponse = await res.json();
      if (res.ok && json.data) {
        setData(json.data);
        setReviewedAt(json.reviewedAt ?? null);
      }
    } catch {
      /* non-fatal — agent can still generate */
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
      const res = await fetch(`/api/ai/smart-intake/${leadId}`, { method: 'POST' });
      const json = await res.json();
      if (!res.ok) setError(json.error || 'Failed to generate');
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
    <div className="brand-card p-8 mb-8" data-testid="section-smart-intake">
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
              Smart Intake Summary
            </h3>
            <div className="mt-1">
              <AiAssistedBadge />
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {data && <AiReviewStatus reviewedAt={reviewedAt} />}
          <button
            onClick={generate}
            disabled={loading}
            className="btn-brand-primary px-4 py-2"
            data-testid="button-generate-smart-intake"
          >
            {loading ? 'Generating…' : data ? 'Regenerate' : 'Generate Summary'}
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
          Generate a cleaned-up business description, operations summary, missing-information
          checklist, and a submission-ready risk summary from this lead&apos;s intake.
        </p>
      )}

      {data && (
        <div className="space-y-5">
          <AiDisclaimer />

          <Field label="Business Description" value={data.cleanBusinessDescription} />
          <Field label="Operations Summary" value={data.operationsSummary} />

          <div>
            <p className="text-xs uppercase font-bold mb-2" style={{ color: 'var(--brand-text-subtle)' }}>
              Missing / Unclear Information
            </p>
            {data.missingOrUnclearInfo.length === 0 ? (
              <p className="text-sm" style={{ color: 'var(--market-standard)' }}>
                Nothing flagged — intake looks complete.
              </p>
            ) : (
              <ul className="space-y-2">
                {data.missingOrUnclearInfo.map((item, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm" style={{ color: 'var(--brand-text-muted)' }}>
                    <span className="text-amber-500 mt-0.5" aria-hidden>⚠</span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <Field label="Submission-Ready Risk Summary" value={data.submissionReadyRiskSummary} />
        </div>
      )}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs uppercase font-bold mb-2" style={{ color: 'var(--brand-text-subtle)' }}>
        {label}
      </p>
      <p className="text-sm leading-relaxed whitespace-pre-line" style={{ color: 'var(--brand-text-muted)' }}>
        {value}
      </p>
    </div>
  );
}
