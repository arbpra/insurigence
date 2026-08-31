'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { Plus, ArrowLeft, FileText } from 'lucide-react';
import QuoteOptionForm, { type CarrierChoice } from '@/app/components/quotes/QuoteOptionForm';
import QuoteOptionList from '@/app/components/quotes/QuoteOptionList';
import CoverageBreakdownEditor from '@/app/components/quotes/CoverageBreakdownEditor';
import ComparisonTable from '@/app/components/quotes/ComparisonTable';
import RecommendationPanel from '@/app/components/quotes/RecommendationPanel';
import type { QuoteOptionDTO } from '@/lib/quotes/quoteOption';

/**
 * Quote options for a lead — the agent's workspace for entering the quotes that
 * came back from carriers, before those options are built into a proposal.
 */
export default function LeadQuotesPage() {
  const params = useParams();
  const leadId = String(params.id);

  const [options, setOptions] = useState<QuoteOptionDTO[]>([]);
  const [carriers, setCarriers] = useState<CarrierChoice[]>([]);
  const [leadName, setLeadName] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<QuoteOptionDTO | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      // One call returns the options, the lead name, and the agency's carriers.
      const res = await fetch(`/api/leads/${leadId}/quote-options`);
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        setLoadError(json.error || 'Could not load quote options.');
        return;
      }
      const json = await res.json();
      setOptions(json.quoteOptions ?? []);
      setLeadName(json.lead?.insuredName ?? '');
      setCarriers(
        (json.carriers ?? []).map((c: { id: string; name: string; marketType?: string }) => ({
          id: c.id, name: c.name, marketType: c.marketType ?? 'STANDARD',
        }))
      );
    } catch {
      setLoadError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [leadId]);

  useEffect(() => { load(); }, [load]);

  function handleSaved(saved: QuoteOptionDTO) {
    setOptions((prev) => {
      const exists = prev.some((o) => o.id === saved.id);
      const next = exists ? prev.map((o) => (o.id === saved.id ? saved : o)) : [...prev, saved];
      // The server clears the flag on the others when one is recommended.
      return saved.isRecommended
        ? next.map((o) => (o.id === saved.id ? o : { ...o, isRecommended: false }))
        : next;
    });
    setShowForm(false);
    setEditing(null);
  }

  async function recommend(optionId: string) {
    const res = await fetch(`/api/quote-options/${optionId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isRecommended: true }),
    });
    if (!res.ok) return;
    const json = await res.json();
    // The server clears the flag on the others; mirror that locally.
    setOptions((prev) =>
      prev.map((o) => (o.id === optionId ? json.quoteOption : { ...o, isRecommended: false }))
    );
  }

  const recommended = options.find((o) => o.isRecommended);

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8">
      <Link href="/leads" className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 mb-4">
        <ArrowLeft className="w-4 h-4" /> Back to leads
      </Link>

      <div className="flex items-start justify-between gap-4 flex-wrap mb-2">
        <div>
          <h1 className="text-2xl font-medium" style={{ color: 'var(--brand-primary)' }}>Quote Options</h1>
          {leadName && <p className="text-sm text-slate-500 mt-0.5">{leadName}</p>}
        </div>
        {!showForm && (
          <button
            onClick={() => { setEditing(null); setShowForm(true); }}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md text-sm font-semibold"
            style={{ backgroundColor: 'var(--brand-accent)', color: 'var(--brand-primary)' }}
            data-testid="add-quote-option"
          >
            <Plus className="w-4 h-4" /> Add Quote Option
          </button>
        )}
      </div>

      <p className="text-sm text-slate-500 mb-6">
        Add each quote you received back from a carrier. Two or more options can then be
        compared side by side in a proposal.
      </p>

      {loading && <p className="text-sm text-slate-400">Loading…</p>}

      {loadError && (
        <div className="mb-4 rounded-md px-3 py-2 text-sm" style={{ backgroundColor: '#FEE2E2', color: '#991B1B' }}>
          {loadError}
        </div>
      )}

      {!loading && !loadError && (
        <>
          {showForm && (
            <div className="mb-6">
              <QuoteOptionForm
                leadId={leadId}
                carriers={carriers}
                existing={editing}
                onSaved={handleSaved}
                onCancel={() => { setShowForm(false); setEditing(null); }}
              />
            </div>
          )}

          <QuoteOptionList
            leadId={leadId}
            options={options}
            onChange={setOptions}
            onEdit={(option) => { setEditing(option); setShowForm(true); }}
          />

          {options.length >= 2 && (
            <div className="mt-10 pt-8 border-t border-slate-200">
              <ComparisonTable options={options} onRecommend={recommend} />
            </div>
          )}

          {options.length >= 2 && (
            <div className="mt-10 pt-8 border-t border-slate-200">
              <RecommendationPanel
                leadId={leadId}
                options={options}
                onOptionsChange={setOptions}
              />
            </div>
          )}

          {options.length > 0 && (
            <div className="mt-10 pt-8 border-t border-slate-200">
              <CoverageBreakdownEditor
                leadId={leadId}
                options={options}
                onOptionsChange={setOptions}
              />
            </div>
          )}

          {options.length > 0 && (
            <div className="mt-6 rounded-lg bg-slate-50 border border-slate-200 px-4 py-3 text-sm text-slate-600">
              <p>
                <span className="font-medium">{options.length}</span>{' '}
                {options.length === 1 ? 'option' : 'options'} on this lead
                {recommended
                  ? <> · recommending <span className="font-medium">{recommended.carrierName || recommended.optionLabel}</span></>
                  : <> · no option marked as recommended yet</>}
              </p>
              {options.length < 2 && (
                <p className="text-xs text-slate-400 mt-1">
                  Add at least two options to build a comparison for the insured.
                </p>
              )}
              <Link
                href={`/leads/${leadId}/proposal-builder`}
                className="inline-flex items-center gap-1.5 mt-3 px-4 py-2 rounded-md text-sm font-semibold"
                style={{ backgroundColor: 'var(--brand-accent)', color: 'var(--brand-primary)' }}
                data-testid="open-proposal-builder"
              >
                <FileText className="w-4 h-4" /> Build the proposal
              </Link>
            </div>
          )}
        </>
      )}
    </div>
  );
}
