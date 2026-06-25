'use client';

import { useCallback, useEffect, useState } from 'react';
import AiDisclaimer from '@/components/ai/AiDisclaimer';
import AiAssistedBadge from '@/components/ai/AiAssistedBadge';
import AiReviewStatus from '@/components/ai/AiReviewStatus';

interface ProposalLanguageData {
  executiveSummary: string;
  whatWeRecommend: string;
  optionComparison: string;
}

/**
 * Feature 4 — Proposal Language Assistant panel for the proposal page.
 * Generates client-ready proposal language from the lead's evaluation + carrier
 * fits. Each section has a copy button since the agent pastes this into the
 * proposal. Loads any saved result on mount.
 */
export default function ProposalLanguagePanel({ leadId }: { leadId: string }) {
  const [data, setData] = useState<ProposalLanguageData | null>(null);
  const [reviewedAt, setReviewedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadExisting = useCallback(async () => {
    try {
      const res = await fetch(`/api/ai/proposal-language/${leadId}`);
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
      const res = await fetch(`/api/ai/proposal-language/${leadId}`, { method: 'POST' });
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
    <div className="brand-card p-8 mb-8" data-testid="section-proposal-language">
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
              Proposal Language
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
            data-testid="button-generate-proposal-language"
          >
            {loading ? 'Generating…' : data ? 'Regenerate' : 'Draft Proposal Language'}
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
          Draft a client-ready executive summary, recommendation, and option comparison from this
          lead&apos;s evaluation. You can copy each section into the proposal.
        </p>
      )}

      {data && (
        <div className="space-y-5">
          <AiDisclaimer />
          <Section title="Executive Summary" value={data.executiveSummary} />
          <Section title="What We Recommend & Why" value={data.whatWeRecommend} />
          {data.optionComparison && (
            <Section title="Option Comparison" value={data.optionComparison} />
          )}
        </div>
      )}
    </div>
  );
}

function Section({ title, value }: { title: string; value: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <div className="rounded-xl border border-slate-200 p-5">
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs uppercase font-bold" style={{ color: 'var(--brand-text-subtle)' }}>
          {title}
        </p>
        <button
          onClick={copy}
          className="text-xs font-medium hover:opacity-80"
          style={{ color: 'var(--brand-accent)' }}
        >
          {copied ? 'Copied!' : 'Copy'}
        </button>
      </div>
      <p className="text-sm leading-relaxed whitespace-pre-line" style={{ color: 'var(--brand-text-muted)' }}>
        {value}
      </p>
    </div>
  );
}
