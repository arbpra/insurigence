'use client';

import { useState } from 'react';
import { Plus, Trash2, Sparkles, Check, AlertTriangle, ChevronDown, ChevronRight } from 'lucide-react';
import type { QuoteOptionDTO } from '@/lib/quotes/quoteOption';
import type { CoverageItem } from '@/lib/quotes/coverage';

/**
 * Coverage breakdown for a lead's quote options.
 *
 * Two kinds of field sit side by side and are treated differently:
 *
 *   Facts (name, limit, deductible, included) — the agent types these from the
 *   carrier's quote. AI never writes them.
 *
 *   Prose (plain language, why it matters, differences) — AI can draft these,
 *   and the agent can edit every word before an insured sees any of it.
 *
 * Anything AI drafted and the agent has not touched is flagged as needing
 * review, so unreviewed model output cannot quietly reach a client proposal.
 */

interface Props {
  leadId: string;
  options: QuoteOptionDTO[];
  onOptionsChange: (options: QuoteOptionDTO[]) => void;
}

/** A blank coverage. crypto.randomUUID is available in every browser we target. */
function blankCoverage(): CoverageItem {
  return {
    key: crypto.randomUUID(), name: '', limit: null, deductible: null, included: true,
    plainLanguage: '', whyItMatters: '', differsFromOthers: '',
    aiDrafted: false, agentEdited: false, reviewedAt: null,
  };
}

function coveragesOf(option: QuoteOptionDTO): CoverageItem[] {
  return Array.isArray(option.coverages) ? (option.coverages as CoverageItem[]) : [];
}

function needsReview(c: CoverageItem): boolean {
  return c.aiDrafted && !c.agentEdited && !c.reviewedAt;
}

export default function CoverageBreakdownEditor({ leadId, options, onOptionsChange }: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [savingId, setSavingId] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const pendingReview = options.reduce(
    (n, o) => n + coveragesOf(o).filter(needsReview).length, 0
  );

  function toggle(key: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }

  /** Update one option's coverages locally, then persist. */
  async function save(option: QuoteOptionDTO, coverages: CoverageItem[]) {
    onOptionsChange(options.map((o) => (o.id === option.id ? { ...o, coverages } : o)));
    setSavingId(option.id);
    setError('');
    try {
      const res = await fetch(`/api/quote-options/${option.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ coverages }),
      });
      const json = await res.json();
      if (!res.ok) { setError(json.error || 'Could not save coverages.'); return; }
      // The server decides agentEdited/reviewedAt — take its version back.
      onOptionsChange(options.map((o) => (o.id === option.id ? json.quoteOption : o)));
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setSavingId(null);
    }
  }

  function mutate(option: QuoteOptionDTO, key: string, patch: Partial<CoverageItem>) {
    const next = coveragesOf(option).map((c) => (c.key === key ? { ...c, ...patch } : c));
    onOptionsChange(options.map((o) => (o.id === option.id ? { ...o, coverages: next } : o)));
  }

  async function generate() {
    setGenerating(true);
    setError('');
    setNotice('');
    try {
      const res = await fetch(`/api/leads/${leadId}/coverage-breakdown`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ overwriteEdited: false }),
      });
      const json = await res.json();
      if (!res.ok) { setError(json.error || 'Could not generate the breakdown.'); return; }

      // Server returns the merged coverages per option.
      const byId = new Map<string, CoverageItem[]>(
        (json.options ?? []).map((o: { id: string; coverages: CoverageItem[] }) => [o.id, o.coverages])
      );
      onOptionsChange(
        options.map((o) => (byId.has(o.id) ? { ...o, coverages: byId.get(o.id)! } : o))
      );

      const parts = [`Drafted ${json.coveragesUpdated} coverage${json.coveragesUpdated === 1 ? '' : 's'}.`];
      if (json.coveragesSkipped > 0) parts.push(`${json.coveragesSkipped} kept your existing wording.`);
      if (json.inventedDiscarded > 0) parts.push(`${json.inventedDiscarded} invented coverage discarded.`);
      parts.push('Review each one before sending.');
      setNotice(parts.join(' '));
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setGenerating(false);
    }
  }

  const input = 'w-full px-2.5 py-1.5 rounded-md border border-slate-300 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#00E6A7] focus:border-transparent';
  const area = `${input} resize-y`;
  const lbl = 'block text-xs font-medium text-slate-500 mb-1';

  if (options.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-300 p-6 text-center">
        <p className="text-sm text-slate-500">Add a quote option first, then break down its coverages here.</p>
      </div>
    );
  }

  return (
    <div data-testid="coverage-breakdown-editor">
      <div className="flex items-start justify-between gap-4 flex-wrap mb-3">
        <div>
          <h2 className="text-lg font-medium" style={{ color: 'var(--brand-primary)' }}>Coverage Breakdown</h2>
          <p className="text-sm text-slate-500">
            Enter each coverage from the carrier&apos;s quote, then let AI draft the explanation for the insured.
          </p>
        </div>
        <button
          onClick={generate}
          disabled={generating}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md text-sm font-semibold disabled:opacity-60"
          style={{ backgroundColor: 'var(--brand-accent)', color: 'var(--brand-primary)' }}
          data-testid="generate-breakdown"
        >
          <Sparkles className="w-4 h-4" />
          {generating ? 'Drafting…' : 'Draft with AI'}
        </button>
      </div>

      {error && (
        <div className="mb-3 rounded-md px-3 py-2 text-sm" style={{ backgroundColor: '#FEE2E2', color: '#991B1B' }}>
          {error}
        </div>
      )}
      {notice && (
        <div className="mb-3 rounded-md px-3 py-2 text-sm" style={{ backgroundColor: '#EFF6FF', color: '#1E40AF' }}>
          {notice}
        </div>
      )}

      {pendingReview > 0 && (
        <div
          className="mb-4 rounded-md px-3 py-2 text-sm flex items-start gap-2"
          style={{ backgroundColor: '#FEF3C7', color: '#92400E' }}
          data-testid="review-warning"
        >
          <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span>
            <strong>{pendingReview}</strong> AI-drafted {pendingReview === 1 ? 'coverage has' : 'coverages have'} not
            been reviewed. Edit or approve each one before this goes to the insured.
          </span>
        </div>
      )}

      <div className="space-y-4">
        {options.map((option) => {
          const coverages = coveragesOf(option);
          return (
            <div key={option.id} className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="flex items-center justify-between gap-3 mb-3">
                <h3 className="text-sm font-medium" style={{ color: 'var(--brand-primary)' }}>
                  {option.optionLabel || option.carrierName || 'Option'}
                  <span className="text-slate-400 font-normal"> · {coverages.length} coverage{coverages.length === 1 ? '' : 's'}</span>
                </h3>
                <div className="flex items-center gap-2">
                  {savingId === option.id && <span className="text-xs text-slate-400">Saving…</span>}
                  <button
                    onClick={() => save(option, [...coverages, blankCoverage()])}
                    className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-slate-700"
                    data-testid={`add-coverage-${option.id}`}
                  >
                    <Plus className="w-3.5 h-3.5" /> Add coverage
                  </button>
                </div>
              </div>

              {coverages.length === 0 && (
                <p className="text-sm text-slate-400 py-2">No coverages entered for this option yet.</p>
              )}

              <div className="space-y-2">
                {coverages.map((c) => {
                  const open = expanded.has(c.key);
                  const flagged = needsReview(c);
                  return (
                    <div
                      key={c.key}
                      className="rounded-lg border"
                      style={{ borderColor: flagged ? '#FCD34D' : '#e2e8f0' }}
                    >
                      {/* ── Facts row: agent-entered, never AI-written ── */}
                      <div className="p-3 grid grid-cols-1 sm:grid-cols-12 gap-2 items-end">
                        <div className="sm:col-span-4">
                          <label className={lbl}>Coverage</label>
                          <input
                            className={input}
                            value={c.name}
                            placeholder="e.g. Garagekeepers"
                            onChange={(e) => mutate(option, c.key, { name: e.target.value })}
                            onBlur={() => save(option, coveragesOf(option))}
                          />
                        </div>
                        <div className="sm:col-span-3">
                          <label className={lbl}>Limit</label>
                          <input
                            className={input}
                            value={c.limit ?? ''}
                            placeholder="$250,000"
                            onChange={(e) => mutate(option, c.key, { limit: e.target.value || null })}
                            onBlur={() => save(option, coveragesOf(option))}
                          />
                        </div>
                        <div className="sm:col-span-3">
                          <label className={lbl}>Deductible</label>
                          <input
                            className={input}
                            value={c.deductible ?? ''}
                            placeholder="$1,000"
                            onChange={(e) => mutate(option, c.key, { deductible: e.target.value || null })}
                            onBlur={() => save(option, coveragesOf(option))}
                          />
                        </div>
                        <div className="sm:col-span-2 flex items-center gap-2 pb-1.5">
                          <label className="flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={c.included}
                              className="w-3.5 h-3.5 accent-[#00E6A7]"
                              onChange={(e) => {
                                mutate(option, c.key, { included: e.target.checked });
                                save(option, coveragesOf(option).map((x) =>
                                  x.key === c.key ? { ...x, included: e.target.checked } : x));
                              }}
                            />
                            Included
                          </label>
                          <button
                            onClick={() => save(option, coverages.filter((x) => x.key !== c.key))}
                            className="p-1 rounded text-slate-400 hover:text-red-600 hover:bg-red-50 ml-auto"
                            title="Remove coverage"
                            aria-label="Remove coverage"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>

                      {/* ── Prose: AI-draftable, agent-editable ── */}
                      <div className="px-3 pb-3">
                        <button
                          onClick={() => toggle(c.key)}
                          className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-slate-700"
                        >
                          {open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                          Client-facing wording
                          {c.aiDrafted && (
                            <span
                              className="ml-1 px-1.5 py-0.5 rounded-full text-[10px] font-semibold"
                              style={flagged
                                ? { backgroundColor: '#FEF3C7', color: '#92400E' }
                                : { backgroundColor: '#E9FBF5', color: '#0F9E78' }}
                            >
                              {flagged ? 'AI draft — needs review' : 'reviewed'}
                            </span>
                          )}
                        </button>

                        {open && (
                          <div className="mt-2 space-y-2">
                            <div>
                              <label className={lbl}>Plain-language explanation</label>
                              <textarea
                                className={area} rows={2}
                                value={c.plainLanguage}
                                placeholder="What this coverage does, in language the insured understands."
                                onChange={(e) => mutate(option, c.key, { plainLanguage: e.target.value })}
                                onBlur={() => save(option, coveragesOf(option))}
                              />
                            </div>
                            <div>
                              <label className={lbl}>Why it matters</label>
                              <textarea
                                className={area} rows={2}
                                value={c.whyItMatters}
                                onChange={(e) => mutate(option, c.key, { whyItMatters: e.target.value })}
                                onBlur={() => save(option, coveragesOf(option))}
                              />
                            </div>
                            <div>
                              <label className={lbl}>How this differs from the other options</label>
                              <textarea
                                className={area} rows={2}
                                value={c.differsFromOthers}
                                onChange={(e) => mutate(option, c.key, { differsFromOthers: e.target.value })}
                                onBlur={() => save(option, coveragesOf(option))}
                              />
                            </div>

                            {flagged && (
                              <button
                                onClick={() => save(
                                  option,
                                  coveragesOf(option).map((x) =>
                                    x.key === c.key ? { ...x, reviewedAt: new Date().toISOString() } : x)
                                )}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold"
                                style={{ backgroundColor: '#E9FBF5', color: '#0F9E78' }}
                                data-testid={`approve-${c.key}`}
                              >
                                <Check className="w-3.5 h-3.5" /> Approve this wording as-is
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
