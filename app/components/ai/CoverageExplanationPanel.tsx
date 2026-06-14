'use client';

import { useCallback, useEffect, useState } from 'react';
import AiDisclaimer from '@/components/ai/AiDisclaimer';
import AiAssistedBadge from '@/components/ai/AiAssistedBadge';
import AiReviewStatus from '@/components/ai/AiReviewStatus';

interface Explanation {
  coverage: string;
  whyItMatters: string;
  whenItApplies: string;
  ifMissing: string;
}

interface CoverageData {
  explanations: Explanation[];
}

/** Common commercial coverages the agent can request explanations for. */
const COVERAGE_OPTIONS = [
  'General Liability (GL)',
  'Commercial Property',
  "Workers' Compensation (WC)",
  'Commercial Auto',
  'Garagekeepers',
  'Cyber Liability',
  'Professional Liability (E&O)',
  'Business Interruption',
  'Umbrella / Excess',
];

/**
 * Feature 3 — Coverage Explanation Assistant panel for the proposal page.
 * The agent picks which coverages to explain; the AI explains each in plain
 * English tailored to the lead's business. Loads any saved result on mount.
 */
export default function CoverageExplanationPanel({ leadId }: { leadId: string }) {
  const [selected, setSelected] = useState<string[]>(['General Liability (GL)']);
  const [data, setData] = useState<CoverageData | null>(null);
  const [reviewedAt, setReviewedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadExisting = useCallback(async () => {
    try {
      const res = await fetch(`/api/ai/coverage-explanation/${leadId}`);
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

  const toggle = (coverage: string) => {
    setSelected((prev) =>
      prev.includes(coverage) ? prev.filter((c) => c !== coverage) : [...prev, coverage]
    );
  };

  const generate = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/ai/coverage-explanation/${leadId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ coverages: selected }),
      });
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
    <div className="brand-card p-8 mb-8" data-testid="section-coverage-explanation">
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
              Coverage Explanations
            </h3>
            <div className="mt-1">
              <AiAssistedBadge />
            </div>
          </div>
        </div>
        {data && <AiReviewStatus reviewedAt={reviewedAt} />}
      </div>

      <p className="text-xs uppercase font-bold mb-2" style={{ color: 'var(--brand-text-subtle)' }}>
        Coverages to explain
      </p>
      <div className="flex flex-wrap gap-2 mb-4">
        {COVERAGE_OPTIONS.map((coverage) => {
          const active = selected.includes(coverage);
          return (
            <button
              key={coverage}
              type="button"
              onClick={() => toggle(coverage)}
              className={`px-3 py-1.5 rounded-full text-sm border transition-colors ${
                active
                  ? 'bg-[var(--brand-primary)] text-white border-transparent'
                  : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
              }`}
            >
              {coverage}
            </button>
          );
        })}
      </div>

      <div className="flex items-center justify-end mb-2">
        <button
          onClick={generate}
          disabled={loading || selected.length === 0}
          className="btn-brand-primary px-4 py-2"
          data-testid="button-generate-coverage-explanation"
        >
          {loading ? 'Generating…' : data ? 'Regenerate' : 'Explain Coverages'}
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-2 text-sm mb-4">
          {error}
        </div>
      )}

      {!data && loaded && !error && (
        <p className="text-sm" style={{ color: 'var(--brand-text-muted)' }}>
          Select coverages above and generate plain-English explanations you can share with the
          insured.
        </p>
      )}

      {data && (
        <div className="space-y-4 mt-2">
          <AiDisclaimer />
          {data.explanations.map((ex, i) => (
            <div key={i} className="rounded-xl border border-slate-200 p-5">
              <h4 className="font-semibold mb-3" style={{ color: 'var(--brand-primary)' }}>
                {ex.coverage}
              </h4>
              {ex.whyItMatters && <ExplLine label="Why it matters" value={ex.whyItMatters} />}
              {ex.whenItApplies && <ExplLine label="When it applies" value={ex.whenItApplies} />}
              {ex.ifMissing && <ExplLine label="If missing" value={ex.ifMissing} />}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ExplLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="mb-2 last:mb-0">
      <span className="text-xs uppercase font-bold mr-2" style={{ color: 'var(--brand-text-subtle)' }}>
        {label}
      </span>
      <span className="text-sm" style={{ color: 'var(--brand-text-muted)' }}>
        {value}
      </span>
    </div>
  );
}
