'use client';

import { useState, useEffect, useMemo } from 'react';
import type { QuoteOptionDTO } from '@/lib/quotes/quoteOption';
import QuoteDocumentField from './QuoteDocumentField';

/**
 * Create/edit form for a single carrier quote option.
 *
 * Mirrors the server-side validation in lib/quotes/quoteOption.ts so the agent
 * gets immediate feedback, but the server remains the authority — every rule
 * checked here is checked again on POST/PATCH.
 */

export interface CarrierChoice {
  id: string;
  name: string;
  marketType: string;
}

interface Props {
  leadId: string;
  carriers: CarrierChoice[];
  /** Present when editing; absent when adding. */
  existing?: QuoteOptionDTO | null;
  onSaved: (option: QuoteOptionDTO) => void;
  onCancel: () => void;
}

type FormState = {
  optionLabel: string;
  carrierId: string;
  carrierName: string;
  programName: string;
  policyType: string;
  effectiveDate: string;
  expirationDate: string;
  quoteExpirationDate: string;
  premiumAnnual: string;
  taxes: string;
  fees: string;
  totalAnnual: string;
  paymentPlan: string;
  notes: string;
  isRecommended: boolean;
};

const EMPTY: FormState = {
  optionLabel: '', carrierId: '', carrierName: '', programName: '', policyType: '',
  effectiveDate: '', expirationDate: '', quoteExpirationDate: '',
  premiumAnnual: '', taxes: '', fees: '', totalAnnual: '', paymentPlan: '',
  notes: '', isRecommended: false,
};

/** ISO timestamp → the yyyy-mm-dd a date input expects. */
function toDateInput(iso: string | null): string {
  return iso ? iso.slice(0, 10) : '';
}

function toAmountInput(value: number | null): string {
  return value === null || value === undefined ? '' : String(value);
}

/** Parse a typed amount for the live total. Returns 0 for blank or unparseable. */
function amount(value: string): number {
  const n = Number(value.replace(/[$,\s]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

const money = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });

export default function QuoteOptionForm({
  leadId, carriers, existing, onSaved, onCancel,
}: Props) {
  const [form, setForm] = useState<FormState>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!existing) { setForm(EMPTY); return; }
    setForm({
      optionLabel: existing.optionLabel ?? '',
      carrierId: existing.carrierId ?? '',
      carrierName: existing.carrierName ?? '',
      programName: existing.programName ?? '',
      policyType: existing.policyType ?? '',
      effectiveDate: toDateInput(existing.effectiveDate),
      expirationDate: toDateInput(existing.expirationDate),
      quoteExpirationDate: toDateInput(existing.quoteExpirationDate),
      premiumAnnual: toAmountInput(existing.premiumAnnual),
      taxes: toAmountInput(existing.taxes),
      fees: toAmountInput(existing.fees),
      totalAnnual: toAmountInput(existing.totalAnnual),
      paymentPlan: existing.paymentPlan ?? '',
      notes: existing.notes ?? '',
      isRecommended: existing.isRecommended,
    });
  }, [existing]);

  const set = <K extends keyof FormState>(key: K) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setForm((f) => ({
        ...f,
        [key]: e.target.type === 'checkbox'
          ? (e.target as HTMLInputElement).checked
          : e.target.value,
      }));

  /** Live preview of the total the server will compute when it is left blank. */
  const computedTotal = useMemo(
    () => amount(form.premiumAnnual) + amount(form.taxes) + amount(form.fees),
    [form.premiumAnnual, form.taxes, form.fees]
  );
  const totalIsOverridden = form.totalAnnual.trim() !== '';

  function validate(): string | null {
    if (!form.carrierId && !form.carrierName.trim()) {
      return 'Select a carrier or type a carrier name.';
    }
    if (form.effectiveDate && form.expirationDate && form.expirationDate <= form.effectiveDate) {
      return 'Expiration date must be after the effective date.';
    }
    for (const [label, value] of [
      ['Annual premium', form.premiumAnnual], ['Taxes', form.taxes],
      ['Fees', form.fees], ['Total annual cost', form.totalAnnual],
    ] as const) {
      if (value.trim() === '') continue;
      const n = Number(value.replace(/[$,\s]/g, ''));
      if (!Number.isFinite(n)) return `${label} is not a valid amount.`;
      if (n < 0) return `${label} cannot be negative.`;
    }
    return null;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    const problem = validate();
    if (problem) { setError(problem); return; }

    // Empty strings mean "not provided" — the server turns them into nulls.
    const payload = {
      optionLabel: form.optionLabel || null,
      carrierId: form.carrierId || null,
      carrierName: form.carrierName || null,
      programName: form.programName || null,
      policyType: form.policyType || null,
      effectiveDate: form.effectiveDate || null,
      expirationDate: form.expirationDate || null,
      quoteExpirationDate: form.quoteExpirationDate || null,
      premiumAnnual: form.premiumAnnual || null,
      taxes: form.taxes || null,
      fees: form.fees || null,
      totalAnnual: form.totalAnnual || null,
      paymentPlan: form.paymentPlan || null,
      notes: form.notes || null,
      isRecommended: form.isRecommended,
    };

    setSaving(true);
    try {
      const url = existing ? `/api/quote-options/${existing.id}` : `/api/leads/${leadId}/quote-options`;
      const res = await fetch(url, {
        method: existing ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok) { setError(json.error || 'Could not save this quote option.'); return; }
      onSaved(json.quoteOption);
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  const input = 'w-full px-3 py-2 rounded-md border border-slate-300 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#00E6A7] focus:border-transparent';
  const label = 'block text-xs font-medium text-slate-600 mb-1';

  return (
    <form onSubmit={submit} className="bg-white rounded-xl border border-slate-200 p-5 sm:p-6" data-testid="quote-option-form">
      <h3 className="text-lg font-medium mb-4" style={{ color: 'var(--brand-primary)' }}>
        {existing ? 'Edit Quote Option' : 'Add Quote Option'}
      </h3>

      {error && (
        <div className="mb-4 rounded-md px-3 py-2 text-sm" style={{ backgroundColor: '#FEE2E2', color: '#991B1B' }} data-testid="quote-form-error">
          {error}
        </div>
      )}

      {/* ── Identity ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-5">
        <div>
          <label className={label}>Option Label</label>
          <input className={input} value={form.optionLabel} onChange={set('optionLabel')} placeholder="Option 1" />
        </div>
        <div>
          <label className={label}>Carrier</label>
          <select className={input} value={form.carrierId} onChange={set('carrierId')} data-testid="quote-carrier">
            <option value="">— Not in my carrier list —</option>
            {carriers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}{c.marketType === 'EXCESS_SURPLUS' ? ' (E&S)' : ''}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={label}>
            Carrier Name {!form.carrierId && <span className="text-red-500">*</span>}
          </label>
          <input
            className={input}
            value={form.carrierName}
            onChange={set('carrierName')}
            placeholder="e.g. Travelers, or an E&S market"
          />
          <p className="text-xs text-slate-400 mt-1">Required when the carrier is not in your list.</p>
        </div>
        <div>
          <label className={label}>Program / Product Name</label>
          <input className={input} value={form.programName} onChange={set('programName')} placeholder="e.g. Garage Program" />
        </div>
        <div>
          <label className={label}>Policy Type / Line of Business</label>
          <input className={input} value={form.policyType} onChange={set('policyType')} placeholder="e.g. Garage Liability" />
        </div>
        <div>
          <label className={label}>Payment Plan</label>
          <input className={input} value={form.paymentPlan} onChange={set('paymentPlan')} placeholder="e.g. 25% down, 9 monthly" />
        </div>
      </div>

      {/* ── Dates ── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-5">
        <div>
          <label className={label}>Effective Date</label>
          <input type="date" className={input} value={form.effectiveDate} onChange={set('effectiveDate')} />
        </div>
        <div>
          <label className={label}>Expiration Date</label>
          <input type="date" className={input} value={form.expirationDate} onChange={set('expirationDate')} />
        </div>
        <div>
          <label className={label}>Quote Expires</label>
          <input type="date" className={input} value={form.quoteExpirationDate} onChange={set('quoteExpirationDate')} />
          <p className="text-xs text-slate-400 mt-1">When the carrier&apos;s quote goes stale.</p>
        </div>
      </div>

      {/* ── Cost ── */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 mb-2">
        <div>
          <label className={label}>Annual Premium</label>
          <input className={input} value={form.premiumAnnual} onChange={set('premiumAnnual')} placeholder="8750.00" inputMode="decimal" data-testid="quote-premium" />
        </div>
        <div>
          <label className={label}>Taxes</label>
          <input className={input} value={form.taxes} onChange={set('taxes')} placeholder="0.00" inputMode="decimal" />
        </div>
        <div>
          <label className={label}>Fees</label>
          <input className={input} value={form.fees} onChange={set('fees')} placeholder="0.00" inputMode="decimal" />
        </div>
        <div>
          <label className={label}>Total Annual Cost</label>
          <input className={input} value={form.totalAnnual} onChange={set('totalAnnual')} placeholder="auto" inputMode="decimal" />
        </div>
      </div>
      <p className="text-xs text-slate-500 mb-5" data-testid="quote-total-hint">
        {totalIsOverridden
          ? `Using the total you entered. Premium + taxes + fees would be ${money(computedTotal)}.`
          : `Total will be calculated as ${money(computedTotal)}. Enter a total only if the carrier's differs.`}
      </p>

      {/* ── Notes ── */}
      <div className="mb-5">
        <label className={label}>Quote Notes</label>
        <textarea className={`${input} resize-y`} rows={3} value={form.notes} onChange={set('notes')} placeholder="Anything the agent should remember about this quote." />
      </div>

      {/* The document attaches to a saved option, so this only shows when editing. */}
      {existing ? (
        <div className="mb-5">
          <QuoteDocumentField option={existing} onChange={onSaved} />
        </div>
      ) : (
        <p className="text-xs text-slate-400 mb-5">
          Save this option first, then reopen it to attach the carrier&apos;s quote document.
        </p>
      )}

      <label className="flex items-center gap-2 mb-5 cursor-pointer">
        <input type="checkbox" checked={form.isRecommended} onChange={set('isRecommended')} className="w-4 h-4 accent-[#00E6A7]" data-testid="quote-recommended" />
        <span className="text-sm text-slate-700">Mark as the agent-recommended option</span>
      </label>
      {form.isRecommended && (
        <p className="text-xs text-slate-500 -mt-3 mb-5">
          Only one option can be recommended — this will clear the flag on any other option.
        </p>
      )}

      <div className="flex gap-3">
        <button
          type="submit"
          disabled={saving}
          className="px-5 py-2 rounded-md text-sm font-semibold disabled:opacity-60"
          style={{ backgroundColor: 'var(--brand-accent)', color: 'var(--brand-primary)' }}
          data-testid="quote-save"
        >
          {saving ? 'Saving…' : existing ? 'Save Changes' : 'Add Quote Option'}
        </button>
        <button type="button" onClick={onCancel} className="px-5 py-2 rounded-md text-sm font-medium border border-slate-300 text-slate-600">
          Cancel
        </button>
      </div>
    </form>
  );
}
