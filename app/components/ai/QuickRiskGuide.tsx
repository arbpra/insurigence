'use client';

import { useState } from 'react';
import { Button } from '@/components/ui';
import AiDisclaimer from '@/components/ai/AiDisclaimer';
import AiAssistedBadge from '@/components/ai/AiAssistedBadge';

interface QuickRiskGuideData {
  likelyMarketDirection: 'STANDARD' | 'EXCESS_SURPLUS' | 'BORDERLINE';
  keyRiskConcerns: string[];
  coverageConsiderations: string[];
  suggestedClassification: { naicsCandidates?: string[]; notes: string };
  recommendedNextSteps: string[];
}

interface ApiResult {
  data: QuickRiskGuideData;
  disclaimer: string;
  model: string;
  promptVersion: string;
  usage: { totalTokens: number } | null;
}

const DIRECTION_LABEL: Record<string, string> = {
  STANDARD: 'Standard',
  EXCESS_SURPLUS: 'Excess & Surplus',
  BORDERLINE: 'Borderline',
};

const EXAMPLE = 'Auto detailing business in Michigan, brand new, $150k revenue, no employees.';

/**
 * Feature 2 — Quick Risk Guide widget for the agent dashboard.
 * Self-contained: owns its input/result state and calls the agent API route.
 * Renders the shared disclaimer + AI-assisted badge so the guardrails are
 * visible. The market direction shown here is explicitly non-binding — the
 * rules engine makes the real determination during lead evaluation.
 */
export default function QuickRiskGuide() {
  const [open, setOpen] = useState(false);
  const [description, setDescription] = useState('');
  const [result, setResult] = useState<ApiResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const run = async () => {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch('/api/ai/quick-risk-guide', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description }),
      });
      const json = await res.json();
      if (!res.ok) setError(json.error || 'Request failed');
      else setResult(json);
    } catch {
      setError('Network error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-white rounded-xl border border-slate-200/80 shadow-sm mb-6" data-testid="quick-risk-guide">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-3 p-4 text-left"
      >
        <div className="flex items-center gap-2">
          <span className="text-violet-500" aria-hidden>✦</span>
          <h2 className="text-xl font-semibold text-[#07496C]" style={{ margin: 0 }}>
            Quick Risk Guide
          </h2>
          <span className="text-xs text-slate-400">Internal guidance · no lead required</span>
        </div>
        <svg
          className={`w-5 h-5 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="p-4 pt-0 border-t border-slate-100">
          <label className="block text-xs uppercase font-bold text-slate-500 mt-4 mb-2">
            Describe the risk
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            maxLength={2000}
            placeholder={EXAMPLE}
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-offset-1"
            style={{ ['--tw-ring-color' as string]: 'var(--brand-accent)' }}
          />
          <div className="flex items-center justify-between mt-3">
            <button
              type="button"
              onClick={() => setDescription(EXAMPLE)}
              className="text-xs text-slate-500 hover:text-slate-800"
            >
              Use example
            </button>
            <Button
              variant="accent"
              size="sm"
              onClick={run}
              loading={loading}
              disabled={!description.trim()}
              testId="button-run-quick-risk-guide"
            >
              Run Quick Risk Guide
            </Button>
          </div>

          {error && (
            <div className="mt-4 bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-2 text-sm">
              {error}
            </div>
          )}

          {result && (
            <div className="mt-4 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <AiAssistedBadge />
                <span className="text-xs text-slate-400">
                  {result.model} · v{result.promptVersion}
                  {result.usage ? ` · ${result.usage.totalTokens} tokens` : ''}
                </span>
              </div>
              <AiDisclaimer text={result.disclaimer} />

              <div className="rounded-lg border border-slate-200 p-4">
                <p className="text-xs uppercase font-bold text-slate-500 mb-1">
                  Likely market direction <span className="font-normal lowercase">(non-binding)</span>
                </p>
                <p className="text-lg font-semibold text-[#07496C]">
                  {DIRECTION_LABEL[result.data.likelyMarketDirection]}
                </p>
              </div>

              <GuideList title="Key risk concerns" items={result.data.keyRiskConcerns} />
              <GuideList title="Coverage considerations" items={result.data.coverageConsiderations} />

              <div className="rounded-lg border border-slate-200 p-4">
                <p className="text-xs uppercase font-bold text-slate-500 mb-2">Suggested classification</p>
                {result.data.suggestedClassification.naicsCandidates?.length ? (
                  <div className="flex gap-2 flex-wrap mb-2">
                    {result.data.suggestedClassification.naicsCandidates.map((n) => (
                      <span key={n} className="px-2 py-0.5 bg-slate-100 text-slate-700 text-xs rounded">
                        {n}
                      </span>
                    ))}
                  </div>
                ) : null}
                <p className="text-sm text-slate-700">{result.data.suggestedClassification.notes}</p>
              </div>

              <GuideList title="Recommended next steps" items={result.data.recommendedNextSteps} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function GuideList({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="rounded-lg border border-slate-200 p-4">
      <p className="text-xs uppercase font-bold text-slate-500 mb-3">{title}</p>
      {items.length === 0 ? (
        <p className="text-sm text-slate-400">None.</p>
      ) : (
        <ul className="space-y-2">
          {items.map((item, i) => (
            <li key={i} className="text-sm text-slate-700 flex gap-2">
              <span className="text-[var(--brand-accent)] mt-0.5">•</span>
              <span>{item}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
