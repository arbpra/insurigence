'use client';

import { useState } from 'react';
import { Sparkles, Star, AlertTriangle } from 'lucide-react';
import type { QuoteOptionDTO } from '@/lib/quotes/quoteOption';

/**
 * "Why We Recommend This Option".
 *
 * The agent picks the option; this only handles the explanation. AI can draft
 * it, but the draft is flagged until the agent edits it — the same review rule
 * as the coverage breakdown, since this text also goes in front of the insured.
 */

interface Props {
  leadId: string;
  options: QuoteOptionDTO[];
  onOptionsChange: (options: QuoteOptionDTO[]) => void;
}

export default function RecommendationPanel({ leadId, options, onOptionsChange }: Props) {
  const recommended = options.find((o) => o.isRecommended);
  const [draft, setDraft] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Local edits take precedence; otherwise show what is stored.
  const value = draft ?? recommended?.recommendationRationale ?? '';
  const needsReview = Boolean(recommended?.rationaleAiDrafted && draft === null);

  function replace(updated: QuoteOptionDTO) {
    onOptionsChange(options.map((o) => (o.id === updated.id ? updated : o)));
  }

  async function generate() {
    setGenerating(true);
    setError('');
    try {
      const res = await fetch(`/api/leads/${leadId}/recommendation`, { method: 'POST' });
      const json = await res.json();
      if (!res.ok) { setError(json.error || 'Could not draft the recommendation.'); return; }
      replace(json.quoteOption);
      setDraft(null);
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setGenerating(false);
    }
  }

  async function save() {
    if (!recommended) return;
    setSaving(true);
    setError('');
    try {
      const res = await fetch(`/api/quote-options/${recommended.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recommendationRationale: value }),
      });
      const json = await res.json();
      if (!res.ok) { setError(json.error || 'Could not save.'); return; }
      replace(json.quoteOption);
      setDraft(null);
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  if (!recommended) {
    return (
      <div className="rounded-xl border border-dashed border-slate-300 p-6 text-center" data-testid="recommendation-empty">
        <Star className="w-5 h-5 mx-auto mb-2 text-slate-300" />
        <p className="text-sm text-slate-500">
          Mark one option as recommended, then explain why here.
        </p>
      </div>
    );
  }

  return (
    <div data-testid="recommendation-panel">
      <div className="flex items-start justify-between gap-4 flex-wrap mb-3">
        <div>
          <h2 className="text-lg font-medium" style={{ color: 'var(--brand-primary)' }}>
            Why We Recommend This Option
          </h2>
          <p className="text-sm text-slate-500">
            Recommending{' '}
            <span className="font-medium text-slate-700">
              {recommended.optionLabel || recommended.carrierName}
            </span>
            . This wording appears in the proposal.
          </p>
        </div>
        <button
          onClick={generate}
          disabled={generating || options.length < 2}
          title={options.length < 2 ? 'Add a second option to compare against' : undefined}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md text-sm font-semibold disabled:opacity-50"
          style={{ backgroundColor: 'var(--brand-accent)', color: 'var(--brand-primary)' }}
          data-testid="draft-recommendation"
        >
          <Sparkles className="w-4 h-4" />
          {generating ? 'Drafting…' : value ? 'Redraft with AI' : 'Draft with AI'}
        </button>
      </div>

      {error && (
        <div className="mb-3 rounded-md px-3 py-2 text-sm" style={{ backgroundColor: '#FEE2E2', color: '#991B1B' }}>
          {error}
        </div>
      )}

      {needsReview && (
        <div
          className="mb-3 rounded-md px-3 py-2 text-sm flex items-start gap-2"
          style={{ backgroundColor: '#FEF3C7', color: '#92400E' }}
          data-testid="rationale-review-warning"
        >
          <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span>This is an unedited AI draft. Read it and adjust the wording before it goes to the insured.</span>
        </div>
      )}

      <textarea
        className="w-full px-3 py-2 rounded-md border border-slate-300 text-sm text-slate-900 resize-y focus:outline-none focus:ring-2 focus:ring-[#00E6A7] focus:border-transparent"
        rows={5}
        value={value}
        placeholder="Explain why this option is the right fit — the coverage it carries that the others don't, the limit that's higher, what the cost difference buys."
        onChange={(e) => setDraft(e.target.value)}
        data-testid="rationale-text"
      />

      <div className="flex items-center gap-3 mt-2">
        <button
          onClick={save}
          disabled={saving || draft === null}
          className="px-4 py-2 rounded-md text-sm font-semibold disabled:opacity-50"
          style={{ backgroundColor: 'var(--brand-accent)', color: 'var(--brand-primary)' }}
          data-testid="save-rationale"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        {draft !== null && (
          <button
            onClick={() => setDraft(null)}
            className="px-4 py-2 rounded-md text-sm font-medium border border-slate-300 text-slate-600"
          >
            Discard changes
          </button>
        )}
        {draft === null && value && !needsReview && (
          <span className="text-xs text-slate-400">Saved</span>
        )}
      </div>
    </div>
  );
}
