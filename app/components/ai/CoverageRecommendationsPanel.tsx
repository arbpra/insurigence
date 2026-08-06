'use client';

import { useCallback, useEffect, useState } from 'react';
import AiAssistedBadge from '@/components/ai/AiAssistedBadge';
import AiReviewStatus from '@/components/ai/AiReviewStatus';

type Level = 'STRONGLY_RECOMMENDED' | 'RECOMMENDED' | 'CONSIDER' | 'NOT_TYPICALLY_NEEDED';

interface Recommendation {
  coverageName: string;
  recommendationLevel: Level;
  reason: string;
  agentExplanation: string;
  triggeringExposures: string[];
  crossSellOpportunity: boolean;
  disclaimer: string;
}

interface RecSet {
  recommendations: Recommendation[];
  status: 'DRAFT' | 'REVIEWED';
  reviewedAt: string | null;
}

const LEVELS: Level[] = ['STRONGLY_RECOMMENDED', 'RECOMMENDED', 'CONSIDER', 'NOT_TYPICALLY_NEEDED'];
const LEVEL_LABEL: Record<Level, string> = {
  STRONGLY_RECOMMENDED: 'Strongly Recommended',
  RECOMMENDED: 'Recommended',
  CONSIDER: 'Consider',
  NOT_TYPICALLY_NEEDED: 'Not Typically Needed',
};
const LEVEL_COLOR: Record<Level, string> = {
  STRONGLY_RECOMMENDED: 'border-green-300',
  RECOMMENDED: 'border-emerald-200',
  CONSIDER: 'border-amber-200',
  NOT_TYPICALLY_NEEDED: 'border-slate-200',
};

/**
 * Feature — Coverage Recommendations (editable) for the proposal builder.
 * Seeded deterministically from intake (+ AI-refined text). The agent can edit
 * levels/explanations, remove, or add coverages, then approve before using in a
 * proposal. Guidance only — disclaimer + agent review are always shown.
 */
export default function CoverageRecommendationsPanel({ leadId }: { leadId: string }) {
  const [recs, setRecs] = useState<Recommendation[]>([]);
  const [status, setStatus] = useState<'DRAFT' | 'REVIEWED'>('DRAFT');
  const [reviewedAt, setReviewedAt] = useState<string | null>(null);
  const [coverageNames, setCoverageNames] = useState<string[]>([]);
  const [disclaimer, setDisclaimer] = useState('');
  const [hasSet, setHasSet] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [addName, setAddName] = useState('');

  const applySet = (set: RecSet | null) => {
    if (set) {
      setRecs(set.recommendations || []);
      setStatus(set.status);
      setReviewedAt(set.reviewedAt);
      setHasSet(true);
    }
  };

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/ai/coverage-recommendations/${leadId}`);
      const json = await res.json();
      if (res.ok) {
        setCoverageNames(json.coverageNames || []);
        setDisclaimer(json.disclaimer || '');
        applySet(json.set);
      }
    } catch {
      /* non-fatal */
    } finally {
      setLoaded(true);
    }
  }, [leadId]);

  useEffect(() => { load(); }, [load]);

  const generate = async () => {
    setBusy(true); setError(null); setSaved(null);
    try {
      const res = await fetch(`/api/ai/coverage-recommendations/${leadId}`, { method: 'POST' });
      const json = await res.json();
      if (!res.ok) setError(json.error || 'Failed to generate');
      else { applySet(json.set); setDisclaimer(json.disclaimer || disclaimer); }
    } catch { setError('Network error'); } finally { setBusy(false); }
  };

  const save = async (nextStatus?: 'REVIEWED' | 'DRAFT') => {
    setBusy(true); setError(null); setSaved(null);
    try {
      const res = await fetch(`/api/ai/coverage-recommendations/${leadId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recommendations: recs, ...(nextStatus ? { status: nextStatus } : {}) }),
      });
      const json = await res.json();
      if (!res.ok) setError(json.error || 'Failed to save');
      else { applySet(json.set); setSaved(nextStatus === 'REVIEWED' ? 'Approved.' : 'Saved.'); }
    } catch { setError('Network error'); } finally { setBusy(false); }
  };

  const update = (i: number, patch: Partial<Recommendation>) =>
    setRecs((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const remove = (i: number) => setRecs((prev) => prev.filter((_, idx) => idx !== i));
  const addCoverage = () => {
    const name = addName.trim();
    if (!name || recs.some((r) => r.coverageName.toLowerCase() === name.toLowerCase())) return;
    setRecs((prev) => [
      ...prev,
      { coverageName: name, recommendationLevel: 'CONSIDER', reason: 'Added by agent.', agentExplanation: '', triggeringExposures: [], crossSellOpportunity: true, disclaimer: '' },
    ]);
    setAddName('');
  };

  const available = coverageNames.filter((n) => !recs.some((r) => r.coverageName.toLowerCase() === n.toLowerCase()));

  return (
    <div className="brand-card p-8 mb-8" data-testid="section-coverage-recommendations">
      <div className="flex items-center justify-between mb-6 gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ backgroundColor: 'rgba(124, 58, 237, 0.1)' }}>
            <span className="text-violet-600 text-lg" aria-hidden>✦</span>
          </div>
          <div>
            <h3 className="text-xl font-semibold" style={{ color: 'var(--brand-primary)' }}>Recommended Coverages</h3>
            <div className="mt-1"><AiAssistedBadge /></div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {hasSet && <AiReviewStatus reviewedAt={reviewedAt} />}
          <button onClick={generate} disabled={busy} className="btn-brand-secondary px-4 py-2" data-testid="button-generate-coverage-recs">
            {busy ? 'Working…' : hasSet ? 'Regenerate' : 'Generate'}
          </button>
        </div>
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-2 text-sm mb-4">{error}</div>}

      {!hasSet && loaded && !error && (
        <p className="text-sm" style={{ color: 'var(--brand-text-muted)' }}>
          Generate recommended coverages from this lead&apos;s intake. You can then edit levels, add or
          remove coverages, and approve before using them in a proposal.
        </p>
      )}

      {hasSet && (
        <div className="space-y-3">
          {recs.map((r, i) => (
            <div key={i} className={`rounded-lg border-2 ${LEVEL_COLOR[r.recommendationLevel]} p-4`}>
              <div className="flex items-center gap-2 flex-wrap mb-2">
                <span className="font-semibold text-[#07496C]">{r.coverageName}</span>
                <select
                  value={r.recommendationLevel}
                  onChange={(e) => update(i, { recommendationLevel: e.target.value as Level })}
                  className="text-xs border border-slate-200 rounded px-2 py-1"
                  data-testid={`coverage-level-${i}`}
                >
                  {LEVELS.map((l) => <option key={l} value={l}>{LEVEL_LABEL[l]}</option>)}
                </select>
                <label className="text-xs flex items-center gap-1 text-slate-500">
                  <input type="checkbox" checked={r.crossSellOpportunity} onChange={(e) => update(i, { crossSellOpportunity: e.target.checked })} />
                  Cross-sell
                </label>
                <button onClick={() => remove(i)} className="ml-auto text-xs text-red-500 hover:text-red-700" data-testid={`coverage-remove-${i}`}>
                  Remove
                </button>
              </div>
              <textarea
                value={r.agentExplanation}
                onChange={(e) => update(i, { agentExplanation: e.target.value })}
                rows={2}
                placeholder="Plain-English explanation for the insured…"
                className="form-input w-full text-sm"
              />
              {r.reason && <p className="text-xs text-slate-500 mt-1">Why: {r.reason}</p>}
              {r.triggeringExposures.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1.5">
                  {r.triggeringExposures.map((e) => (
                    <span key={e} className="text-[10px] px-1.5 py-0.5 bg-slate-100 text-slate-500 rounded">{e.replace(/_/g, ' ')}</span>
                  ))}
                </div>
              )}
            </div>
          ))}

          {/* Add coverage */}
          <div className="flex items-center gap-2 pt-1">
            <select value={addName} onChange={(e) => setAddName(e.target.value)} className="text-sm border border-slate-200 rounded px-2 py-1.5" data-testid="coverage-add-select">
              <option value="">+ Add coverage…</option>
              {available.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
            <button onClick={addCoverage} disabled={!addName} className="btn-brand-secondary px-3 py-1.5 text-sm disabled:opacity-50" data-testid="button-add-coverage">Add</button>
          </div>

          {disclaimer && (
            <p className="text-[11px] leading-snug text-slate-500 border-t border-slate-200 pt-2 mt-1">{disclaimer}</p>
          )}

          <div className="flex items-center justify-between gap-3 flex-wrap pt-1">
            <span className="text-xs" style={{ color: 'var(--brand-text-subtle)' }}>
              {saved || (status === 'REVIEWED' ? 'Approved — ready for proposal use.' : 'Draft — review and approve before use.')}
            </span>
            <div className="flex items-center gap-3">
              <button onClick={() => save()} disabled={busy} className="btn-brand-secondary px-4 py-2" data-testid="button-save-coverage-recs">
                {busy ? 'Saving…' : 'Save Changes'}
              </button>
              {status === 'REVIEWED' ? (
                <button onClick={() => save('DRAFT')} disabled={busy} className="btn-brand-secondary px-4 py-2">Mark Draft</button>
              ) : (
                <button onClick={() => save('REVIEWED')} disabled={busy} className="btn-brand-accent px-4 py-2" data-testid="button-approve-coverage-recs">Approve</button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
