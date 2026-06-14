'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useAdminAuth } from '../layout';
import AiDisclaimer from '@/components/ai/AiDisclaimer';
import AiAssistedBadge from '@/components/ai/AiAssistedBadge';

interface QuickRiskGuide {
  likelyMarketDirection: 'STANDARD' | 'EXCESS_SURPLUS' | 'BORDERLINE';
  keyRiskConcerns: string[];
  coverageConsiderations: string[];
  suggestedClassification: { naicsCandidates?: string[]; notes: string };
  recommendedNextSteps: string[];
}

interface ApiResult {
  data: QuickRiskGuide;
  disclaimer: string;
  model: string;
  promptVersion: string;
  usage: { promptTokens: number; completionTokens: number; totalTokens: number } | null;
}

const DIRECTION_LABEL: Record<string, string> = {
  STANDARD: 'Standard',
  EXCESS_SURPLUS: 'Excess & Surplus',
  BORDERLINE: 'Borderline',
};

const EXAMPLE = 'Auto detailing business in Michigan, brand new, $150k revenue, no employees.';

export default function AiLabPage() {
  const { authFetch } = useAdminAuth();
  const [description, setDescription] = useState('');
  const [result, setResult] = useState<ApiResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const run = async () => {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await authFetch('/api/super-admin/ai-lab', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || 'Request failed');
      } else {
        setResult(json);
      }
    } catch {
      setError('Network error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F5F7FA]">
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-[#0D2137] leading-tight">AI Lab</h1>
            <p className="text-sm text-gray-500 mt-1">
              Test harness for the AI foundation · Quick Risk Guide
            </p>
          </div>
          <Link href="/super-admin" className="text-sm text-gray-500 hover:text-[#0D2137]">
            ← Back
          </Link>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-8">
        <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
          <label className="block text-xs uppercase font-bold text-gray-600 mb-2">
            Business description
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            placeholder={EXAMPLE}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1D9E75]"
          />
          <div className="flex items-center justify-between mt-3">
            <button
              type="button"
              onClick={() => setDescription(EXAMPLE)}
              className="text-xs text-gray-500 hover:text-[#0D2137]"
            >
              Use example
            </button>
            <button
              type="button"
              onClick={run}
              disabled={loading || !description.trim()}
              className="px-5 py-2 rounded-lg bg-[#1D9E75] text-white text-sm font-medium disabled:opacity-50"
            >
              {loading ? 'Running…' : 'Run Quick Risk Guide'}
            </button>
          </div>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-4 mb-6 text-sm">
            {error}
          </div>
        )}

        {result && (
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-3">
              <AiAssistedBadge />
              <span className="text-xs text-gray-400">Internal guidance only</span>
            </div>
            <AiDisclaimer text={result.disclaimer} />

            <div className="bg-white rounded-xl border border-gray-200 p-6">
              <p className="text-xs uppercase font-bold text-gray-600 mb-1">
                Likely market direction <span className="font-normal lowercase">(non-binding)</span>
              </p>
              <p className="text-xl font-semibold text-[#07496C]">
                {DIRECTION_LABEL[result.data.likelyMarketDirection]}
              </p>
            </div>

            <ListCard title="Key risk concerns" items={result.data.keyRiskConcerns} />
            <ListCard title="Coverage considerations" items={result.data.coverageConsiderations} />

            <div className="bg-white rounded-xl border border-gray-200 p-6">
              <p className="text-xs uppercase font-bold text-gray-600 mb-2">
                Suggested classification
              </p>
              {result.data.suggestedClassification.naicsCandidates?.length ? (
                <div className="flex gap-2 flex-wrap mb-2">
                  {result.data.suggestedClassification.naicsCandidates.map((n) => (
                    <span key={n} className="px-2 py-0.5 bg-gray-100 text-gray-700 text-xs rounded">
                      {n}
                    </span>
                  ))}
                </div>
              ) : null}
              <p className="text-sm text-gray-700">{result.data.suggestedClassification.notes}</p>
            </div>

            <ListCard title="Recommended next steps" items={result.data.recommendedNextSteps} />

            <p className="text-xs text-gray-400 text-center">
              Model: {result.model} · Prompt v{result.promptVersion}
              {result.usage ? ` · ${result.usage.totalTokens} tokens` : ''}
            </p>
          </div>
        )}
      </main>
    </div>
  );
}

function ListCard({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6">
      <p className="text-xs uppercase font-bold text-gray-600 mb-3">{title}</p>
      {items.length === 0 ? (
        <p className="text-sm text-gray-400">None.</p>
      ) : (
        <ul className="space-y-2">
          {items.map((item, i) => (
            <li key={i} className="text-sm text-gray-700 flex gap-2">
              <span className="text-[#1D9E75] mt-0.5">•</span>
              <span>{item}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
