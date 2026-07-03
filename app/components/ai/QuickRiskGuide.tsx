'use client';

import { useState } from 'react';
import { Button } from '@/components/ui';
import AiDisclaimer from '@/components/ai/AiDisclaimer';
import AiAssistedBadge from '@/components/ai/AiAssistedBadge';

interface PremiumIndication {
  insufficient: boolean;
  annualLow?: number;
  annualHigh?: number;
  confidence?: 'LOW' | 'MEDIUM' | 'HIGH';
  basis?: string;
  reasoning: string;
  factorsConsidered: string[];
  factorsThatMayChangePricing: string[];
  disclaimer: string;
}

interface QuickRiskGuideData {
  likelyMarketDirection: 'STANDARD' | 'EXCESS_SURPLUS' | 'BORDERLINE';
  keyRiskConcerns: string[];
  coverageConsiderations: string[];
  suggestedClassification: { naicsCandidates?: string[]; notes: string };
  recommendedNextSteps: string[];
  premiumIndication?: PremiumIndication;
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

              {result.data.premiumIndication && (
                <PremiumIndicationCard indication={result.data.premiumIndication} />
              )}

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

const CONFIDENCE_STYLE: Record<string, { bg: string; text: string; label: string }> = {
  LOW: { bg: 'bg-red-50', text: 'text-red-600', label: 'Low confidence' },
  MEDIUM: { bg: 'bg-amber-50', text: 'text-amber-700', label: 'Medium confidence' },
  HIGH: { bg: 'bg-green-50', text: 'text-green-700', label: 'High confidence' },
};

function money(n?: number) {
  return typeof n === 'number' ? `$${n.toLocaleString('en-US')}` : '—';
}

function PremiumIndicationCard({
  indication,
}: {
  indication: NonNullable<QuickRiskGuideData['premiumIndication']>;
}) {
  const conf = indication.confidence ? CONFIDENCE_STYLE[indication.confidence] : null;

  return (
    <div className="rounded-lg border-2 border-violet-200 bg-violet-50/30 p-4" data-testid="premium-indication">
      <div className="flex items-center justify-between gap-3 mb-2 flex-wrap">
        <p className="text-xs uppercase font-bold text-violet-700">Premium Indication</p>
        <span className="text-[11px] uppercase tracking-wide text-slate-400">Not a quote · Internal</span>
      </div>

      {indication.insufficient ? (
        <p className="text-sm text-slate-600 mb-3">
          Insufficient information to provide a reliable indication.
        </p>
      ) : (
        <>
          <div className="flex items-baseline gap-3 flex-wrap mb-2">
            <span className="text-2xl font-bold text-[#07496C]">
              {money(indication.annualLow)} – {money(indication.annualHigh)}
            </span>
            <span className="text-xs text-slate-500">estimated annual premium indication</span>
            {conf && (
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${conf.bg} ${conf.text}`}>
                {conf.label}
              </span>
            )}
          </div>

          <p className="text-sm text-slate-700 mb-3">{indication.reasoning}</p>

          {indication.factorsConsidered.length > 0 && (
            <div className="mb-3">
              <p className="text-[11px] uppercase font-bold text-slate-500 mb-1">Factors considered</p>
              <ul className="space-y-1">
                {indication.factorsConsidered.map((f, i) => (
                  <li key={i} className="text-xs text-slate-600 flex gap-2">
                    <span className="text-violet-500">•</span>
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {indication.factorsThatMayChangePricing.length > 0 && (
            <div className="mb-3">
              <p className="text-[11px] uppercase font-bold text-slate-500 mb-1">
                Factors that may change pricing
              </p>
              <div className="flex flex-wrap gap-1.5">
                {indication.factorsThatMayChangePricing.map((f, i) => (
                  <span key={i} className="text-[11px] px-2 py-0.5 bg-white border border-slate-200 rounded text-slate-600">
                    {f}
                  </span>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      <p className="text-[11px] leading-snug text-slate-500 border-t border-violet-200 pt-2 mt-1">
        {indication.disclaimer}
      </p>
    </div>
  );
}
