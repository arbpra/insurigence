'use client';

import { useState } from 'react';
import type { QuoteOptionDTO } from '@/lib/quotes/quoteOption';
import { Star, Pencil, Trash2, ChevronUp, ChevronDown, FileText } from 'lucide-react';

/**
 * The list of quote options on a lead: reorder, edit, delete, and choose which
 * one carries the agent's recommendation.
 *
 * Reordering and recommending both write through to the server immediately —
 * these are single-click actions where a separate save step would be a trap.
 */

interface Props {
  leadId: string;
  options: QuoteOptionDTO[];
  onChange: (options: QuoteOptionDTO[]) => void;
  onEdit: (option: QuoteOptionDTO) => void;
}

const money = (n: number | null) =>
  n === null || n === undefined
    ? '—'
    : n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

const shortDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';

/** A quote the carrier will no longer honour needs to be visibly stale. */
function isQuoteExpired(option: QuoteOptionDTO): boolean {
  if (!option.quoteExpirationDate) return false;
  return new Date(option.quoteExpirationDate) < new Date();
}

export default function QuoteOptionList({ leadId, options, onChange, onEdit }: Props) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  async function setRecommended(option: QuoteOptionDTO) {
    setBusyId(option.id);
    setError('');
    const next = !option.isRecommended;
    try {
      const res = await fetch(`/api/quote-options/${option.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isRecommended: next }),
      });
      const json = await res.json();
      if (!res.ok) { setError(json.error || 'Could not update the recommendation.'); return; }
      // The server clears the flag on the other options; mirror that locally
      // rather than refetching the whole list.
      onChange(options.map((o) =>
        o.id === option.id ? json.quoteOption : next ? { ...o, isRecommended: false } : o
      ));
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setBusyId(null);
    }
  }

  async function move(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= options.length) return;

    const reordered = [...options];
    [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
    onChange(reordered); // optimistic

    setError('');
    try {
      const res = await fetch(`/api/leads/${leadId}/quote-options/reorder`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderedIds: reordered.map((o) => o.id) }),
      });
      if (!res.ok) {
        const json = await res.json();
        setError(json.error || 'Could not save the new order.');
        onChange(options); // roll back
      }
    } catch {
      setError('Network error. Please try again.');
      onChange(options);
    }
  }

  async function remove(option: QuoteOptionDTO) {
    setBusyId(option.id);
    setError('');
    try {
      const res = await fetch(`/api/quote-options/${option.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const json = await res.json();
        setError(json.error || 'Could not delete this quote option.');
        return;
      }
      onChange(options.filter((o) => o.id !== option.id));
      setConfirmDelete(null);
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setBusyId(null);
    }
  }

  if (options.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center" data-testid="quote-list-empty">
        <p className="text-sm text-slate-500">
          No quote options yet. Add the quotes you received back from carriers to build a comparison.
        </p>
      </div>
    );
  }

  return (
    <div data-testid="quote-option-list">
      {error && (
        <div className="mb-3 rounded-md px-3 py-2 text-sm" style={{ backgroundColor: '#FEE2E2', color: '#991B1B' }}>
          {error}
        </div>
      )}

      <div className="space-y-3">
        {options.map((option, index) => {
          const expired = isQuoteExpired(option);
          return (
            <div
              key={option.id}
              className="rounded-xl border bg-white p-4 sm:p-5"
              style={{ borderColor: option.isRecommended ? 'var(--brand-accent)' : '#e2e8f0' }}
              data-testid={`quote-option-${option.id}`}
            >
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <span className="text-xs font-medium text-slate-400">
                      {option.optionLabel || `Option ${index + 1}`}
                    </span>
                    {option.isRecommended && (
                      <span
                        className="text-xs font-semibold px-2 py-0.5 rounded-full"
                        style={{ backgroundColor: '#E9FBF5', color: '#0F9E78' }}
                      >
                        Recommended
                      </span>
                    )}
                    {expired && (
                      <span className="text-xs font-semibold px-2 py-0.5 rounded-full" style={{ backgroundColor: '#FEF3C7', color: '#92400E' }}>
                        Quote expired
                      </span>
                    )}
                  </div>

                  <h4 className="text-base font-medium truncate" style={{ color: 'var(--brand-primary)' }}>
                    {option.carrierName || 'Unnamed carrier'}
                    {option.programName && <span className="text-slate-400 font-normal"> · {option.programName}</span>}
                  </h4>

                  <div className="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-1 text-sm">
                    <div>
                      <span className="text-slate-400 text-xs block">Premium</span>
                      <span className="text-slate-700">{money(option.premiumAnnual)}</span>
                    </div>
                    <div>
                      <span className="text-slate-400 text-xs block">Total</span>
                      <span className="text-slate-900 font-medium">{money(option.totalAnnual)}</span>
                    </div>
                    <div>
                      <span className="text-slate-400 text-xs block">Effective</span>
                      <span className="text-slate-700">{shortDate(option.effectiveDate)}</span>
                    </div>
                    <div>
                      <span className="text-slate-400 text-xs block">Quote expires</span>
                      <span className={expired ? 'text-amber-700' : 'text-slate-700'}>
                        {shortDate(option.quoteExpirationDate)}
                      </span>
                    </div>
                  </div>

                  {option.hasDocument && (
                    <a
                      href={`/api/quote-options/${option.id}/document`}
                      className="mt-2 text-xs text-slate-500 hover:text-slate-700 inline-flex items-center gap-1"
                    >
                      <FileText className="w-3.5 h-3.5" />
                      {option.documentName ?? 'Carrier quote'}
                    </a>
                  )}
                </div>

                {/* ── Row actions ── */}
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button
                    onClick={() => move(index, -1)}
                    disabled={index === 0}
                    title="Move up"
                    aria-label="Move up"
                    className="p-1.5 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 disabled:opacity-30 disabled:hover:bg-transparent"
                  >
                    <ChevronUp className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => move(index, 1)}
                    disabled={index === options.length - 1}
                    title="Move down"
                    aria-label="Move down"
                    className="p-1.5 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 disabled:opacity-30 disabled:hover:bg-transparent"
                  >
                    <ChevronDown className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => setRecommended(option)}
                    disabled={busyId === option.id}
                    title={option.isRecommended ? 'Remove recommendation' : 'Mark as recommended'}
                    aria-label={option.isRecommended ? 'Remove recommendation' : 'Mark as recommended'}
                    className="p-1.5 rounded-md hover:bg-slate-100 disabled:opacity-40"
                    style={{ color: option.isRecommended ? '#0F9E78' : '#94a3b8' }}
                    data-testid={`quote-recommend-${option.id}`}
                  >
                    <Star className="w-4 h-4" fill={option.isRecommended ? 'currentColor' : 'none'} />
                  </button>
                  <button
                    onClick={() => onEdit(option)}
                    title="Edit"
                    aria-label="Edit"
                    className="p-1.5 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100"
                  >
                    <Pencil className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => setConfirmDelete(option.id)}
                    title="Delete"
                    aria-label="Delete"
                    className="p-1.5 rounded-md text-slate-400 hover:text-red-600 hover:bg-red-50"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {confirmDelete === option.id && (
                <div className="mt-3 pt-3 border-t border-slate-200 flex items-center gap-3 flex-wrap">
                  <span className="text-sm text-slate-600">Delete this quote option?</span>
                  <button
                    onClick={() => remove(option)}
                    disabled={busyId === option.id}
                    className="px-3 py-1.5 rounded-md text-sm font-medium text-white bg-red-600 hover:bg-red-700 disabled:opacity-60"
                    data-testid={`quote-delete-confirm-${option.id}`}
                  >
                    {busyId === option.id ? 'Deleting…' : 'Delete'}
                  </button>
                  <button
                    onClick={() => setConfirmDelete(null)}
                    className="px-3 py-1.5 rounded-md text-sm font-medium border border-slate-300 text-slate-600"
                  >
                    Keep
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
