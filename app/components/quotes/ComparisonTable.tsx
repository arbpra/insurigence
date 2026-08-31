'use client';

import { useMemo, useState } from 'react';
import { Star, Check, Minus, AlertCircle } from 'lucide-react';
import type { QuoteOptionDTO } from '@/lib/quotes/quoteOption';
import { buildComparison, type ComparisonCell } from '@/lib/quotes/comparison';

/**
 * Side-by-side comparison of every quote option.
 *
 * Highlighting is deliberately restrained: only rows the diff engine flagged as
 * meaningfully different are tinted, and only the strongest cell in a row is
 * marked. Colouring everything would be the same as colouring nothing.
 *
 * Colour is never the only signal — a stronger limit also carries a "best"
 * label, and an excluded coverage shows a dash and the words "Not included",
 * so the table still reads correctly without colour vision.
 */

interface Props {
  options: QuoteOptionDTO[];
  onRecommend?: (optionId: string) => void;
}

const money = (n: number | null | undefined) =>
  n === null || n === undefined
    ? '—'
    : n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

function CellValue({ cell }: { cell: ComparisonCell }) {
  if (!cell.present) {
    return <span className="text-slate-300 inline-flex items-center gap-1"><Minus className="w-3.5 h-3.5" /> Not quoted</span>;
  }
  if (!cell.included) {
    return <span className="text-slate-400 inline-flex items-center gap-1"><Minus className="w-3.5 h-3.5" /> Not included</span>;
  }
  return (
    <span className="text-slate-800">
      <span className={cell.isBestLimit ? 'font-semibold' : ''}>{cell.limit ?? 'Included'}</span>
      {cell.isBestLimit && (
        <span className="ml-1.5 text-[10px] font-semibold px-1.5 py-0.5 rounded-full align-middle"
              style={{ backgroundColor: '#E9FBF5', color: '#0F9E78' }}>
          highest
        </span>
      )}
      {cell.deductible && (
        <span className="block text-xs text-slate-500">
          {cell.deductible} deductible
          {cell.isBestDeductible && <span className="ml-1 text-[10px] font-semibold" style={{ color: '#0F9E78' }}>lowest</span>}
        </span>
      )}
    </span>
  );
}

export default function ComparisonTable({ options, onRecommend }: Props) {
  const [differencesOnly, setDifferencesOnly] = useState(false);
  const comparison = useMemo(() => buildComparison(options), [options]);

  if (options.length < 2) {
    return (
      <div className="rounded-xl border border-dashed border-slate-300 p-6 text-center">
        <p className="text-sm text-slate-500">
          Add a second quote option to compare them side by side.
        </p>
      </div>
    );
  }

  const rows = differencesOnly
    ? comparison.coverageRows.filter((r) => r.differs)
    : comparison.coverageRows;

  const cellBase = 'px-4 py-3 text-sm align-top';

  return (
    <div data-testid="comparison-table">
      <div className="flex items-start justify-between gap-4 flex-wrap mb-3">
        <div>
          <h2 className="text-lg font-medium" style={{ color: 'var(--brand-primary)' }}>Option Comparison</h2>
          <p className="text-sm text-slate-500">
            {comparison.differenceCount === 0
              ? 'These options are materially the same on every coverage entered.'
              : `${comparison.differenceCount} coverage${comparison.differenceCount === 1 ? '' : 's'} differ${comparison.differenceCount === 1 ? 's' : ''} between the options.`}
          </p>
        </div>
        {comparison.differenceCount > 0 && (
          <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer">
            <input
              type="checkbox"
              checked={differencesOnly}
              onChange={(e) => setDifferencesOnly(e.target.checked)}
              className="w-4 h-4 accent-[#00E6A7]"
              data-testid="differences-only"
            />
            Show differences only
          </label>
        )}
      </div>

      {/* Wide tables scroll inside their own container rather than the page. */}
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full border-collapse min-w-[640px]">
          <thead>
            <tr className="border-b border-slate-200">
              <th className="px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wide w-48">
                Coverage
              </th>
              {comparison.options.map((o) => (
                <th key={o.id} className="px-4 py-3 text-left">
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm font-medium" style={{ color: 'var(--brand-primary)' }}>{o.label}</span>
                    {o.isRecommended && (
                      <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full"
                            style={{ backgroundColor: '#E9FBF5', color: '#0F9E78' }}>
                        Recommended
                      </span>
                    )}
                  </div>
                  {o.carrierName && o.carrierName !== o.label && (
                    <span className="text-xs text-slate-400 font-normal">{o.carrierName}</span>
                  )}
                  {onRecommend && !o.isRecommended && (
                    <button
                      onClick={() => onRecommend(o.id)}
                      className="mt-1 inline-flex items-center gap-1 text-[11px] font-medium text-slate-400 hover:text-slate-700"
                      data-testid={`recommend-${o.id}`}
                    >
                      <Star className="w-3 h-3" /> Recommend
                    </button>
                  )}
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={comparison.options.length + 1} className="px-4 py-6 text-center text-sm text-slate-400">
                  {differencesOnly ? 'No differences to show.' : 'No coverages entered yet.'}
                </td>
              </tr>
            )}

            {rows.map((row) => (
              <tr
                key={row.matchKey}
                className="border-b border-slate-100"
                style={row.differs ? { backgroundColor: '#FFFBEB' } : undefined}
                data-testid={`row-${row.matchKey}`}
              >
                <td className={`${cellBase} font-medium text-slate-700`}>
                  {row.label}
                  {row.differs && (
                    <span className="block text-[10px] font-semibold uppercase tracking-wide mt-0.5" style={{ color: '#B45309' }}>
                      differs
                    </span>
                  )}
                </td>
                {row.cells.map((cell) => (
                  <td key={cell.optionId} className={cellBase}>
                    <CellValue cell={cell} />
                  </td>
                ))}
              </tr>
            ))}

            {/* ── Cost ── */}
            {comparison.costRows.map((row) => (
              <tr key={row.key} className="border-b border-slate-100 bg-slate-50/60">
                <td className={`${cellBase} font-medium text-slate-700`}>
                  {row.label}
                </td>
                {row.values.map((v) => (
                  <td key={v.optionId} className={cellBase}>
                    <span className={row.key === 'totalAnnual' ? 'font-semibold text-slate-900' : 'text-slate-700'}>
                      {money(v.value)}
                    </span>
                    {row.lowestOptionId === v.optionId && (
                      <span className="ml-1.5 text-[10px] font-semibold px-1.5 py-0.5 rounded-full"
                            style={{ backgroundColor: '#E9FBF5', color: '#0F9E78' }}>
                        lowest
                      </span>
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Plain-language difference list — reused verbatim in the proposal. */}
      {comparison.differenceCount > 0 && (
        <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-2 flex items-center gap-1.5">
            <AlertCircle className="w-3.5 h-3.5" /> Key differences
          </p>
          <ul className="space-y-1">
            {comparison.coverageRows.filter((r) => r.summary).map((r) => (
              <li key={r.matchKey} className="text-sm text-slate-600 flex gap-2">
                <Check className="w-3.5 h-3.5 flex-shrink-0 mt-1 text-slate-400" />
                {r.summary}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
