/**
 * Builds the side-by-side comparison of a lead's quote options.
 *
 * The hard part is not layout, it is deciding what counts as a *meaningful*
 * difference. Carriers describe the same coverage differently ("General
 * Liability" vs "General Liability (GL)") and write limits in incompatible
 * formats ("$250,000", "250K", "$1M/$2M"). This module reconciles both so the
 * table can highlight what actually differs rather than what merely looks
 * different.
 *
 * Nothing here invents data: a coverage absent from an option is reported as
 * absent, never assumed included or excluded.
 */

import type { QuoteOptionDTO } from './quoteOption';
import { normalizeCoverages, type CoverageItem } from './coverage';

/** How a row's cells differ from one another. */
export type DifferenceKind =
  | 'none'          // every option is materially the same
  | 'availability'  // present on some options, missing or excluded on others
  | 'limit'
  | 'deductible'
  | 'mixed';        // more than one of the above

export interface ComparisonCell {
  optionId: string;
  /** The option carries this coverage at all. */
  present: boolean;
  /** Present AND not marked excluded. */
  included: boolean;
  limit: string | null;
  deductible: string | null;
  /** Parsed limit, when the text could be read as a number. Used for ranking only. */
  limitValue: number | null;
  deductibleValue: number | null;
  /** Best in row: highest limit, or lowest deductible. Only set when comparable. */
  isBestLimit: boolean;
  isBestDeductible: boolean;
}

export interface ComparisonRow {
  /** Display name, taken from the first option that carries the coverage. */
  label: string;
  /** Match key used to line the coverage up across options. */
  matchKey: string;
  cells: ComparisonCell[];
  differs: boolean;
  differenceKind: DifferenceKind;
  /** Plain sentence describing the difference, for the proposal narrative. */
  summary: string | null;
}

export interface CostRow {
  label: string;
  key: 'premiumAnnual' | 'taxes' | 'fees' | 'totalAnnual';
  values: { optionId: string; value: number | null }[];
  differs: boolean;
  /** Cheapest option on this row, when at least two are comparable. */
  lowestOptionId: string | null;
}

export interface Comparison {
  options: {
    id: string;
    label: string;
    carrierName: string | null;
    isRecommended: boolean;
  }[];
  coverageRows: ComparisonRow[];
  costRows: CostRow[];
  /** Count of coverage rows with a meaningful difference. */
  differenceCount: number;
}

/**
 * Reduce a coverage name to a match key.
 *
 * Drops parentheticals, punctuation, and common filler so "General Liability
 * (GL)" and "General liability" line up in the same row. Deliberately
 * conservative — over-merging two genuinely different coverages would be worse
 * than showing them as separate rows.
 */
export function coverageMatchKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')      // drop "(GL)"
    .replace(/[^a-z0-9\s]/g, ' ')    // punctuation → space
    .replace(/\b(coverage|insurance|liability limit)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Read a money-ish string as a number for ranking.
 *
 * Handles "$250,000", "250k", "$1.5M", and split limits like "$1M/$2M" — for
 * which the FIRST figure (per-occurrence) is used, since that is what an
 * occurrence limit comparison turns on. Returns null when the text cannot be
 * read, in which case the caller falls back to string comparison.
 */
export function parseLimitValue(text: string | null): number | null {
  if (!text) return null;
  const first = text.split('/')[0];
  const cleaned = first.toLowerCase().replace(/[$,\s]/g, '');
  const match = cleaned.match(/^(\d+(?:\.\d+)?)([km])?/);
  if (!match) return null;
  const n = parseFloat(match[1]);
  if (!Number.isFinite(n)) return null;
  if (match[2] === 'k') return n * 1_000;
  if (match[2] === 'm') return n * 1_000_000;
  return n;
}

/** Compare limit text when it cannot be parsed as a number. */
function sameText(a: string | null, b: string | null): boolean {
  const norm = (s: string | null) => (s ?? '').toLowerCase().replace(/[$,\s]/g, '');
  return norm(a) === norm(b);
}

const money = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

/** "Travelers carries $250,000 versus $100,000 on Westfield" */
function limitClause(label: string, cells: ComparisonCell[],
                     optionLabel: (id: string) => string): string | null {
  const comparable = cells.filter((c) => c.included && c.limitValue !== null);
  if (comparable.length < 2) return null;
  const best = comparable.reduce((a, b) => (b.limitValue! > a.limitValue! ? b : a));
  const worst = comparable.reduce((a, b) => (b.limitValue! < a.limitValue! ? b : a));
  if (best.limitValue === worst.limitValue) return null;
  return `${label} limits differ — ${optionLabel(best.optionId)} carries ${money(best.limitValue!)} versus ${money(worst.limitValue!)} on ${optionLabel(worst.optionId)}`;
}

/** "$1,000 on Travelers versus $2,500 on Westfield" */
function deductibleClause(cells: ComparisonCell[],
                          optionLabel: (id: string) => string): string | null {
  const withDed = cells.filter((c) => c.included && c.deductibleValue !== null);
  if (withDed.length < 2) return null;
  const low = withDed.reduce((a, b) => (b.deductibleValue! < a.deductibleValue! ? b : a));
  const high = withDed.reduce((a, b) => (b.deductibleValue! > a.deductibleValue! ? b : a));
  if (low.deductibleValue === high.deductibleValue) return null;
  return `the deductible is ${money(low.deductibleValue!)} on ${optionLabel(low.optionId)} versus ${money(high.deductibleValue!)} on ${optionLabel(high.optionId)}`;
}

/**
 * Human sentence for a row's difference, used in the proposal narrative and fed
 * to the AI recommendation prompt as fact.
 *
 * `mixed` (limit AND deductible both differ) is the common real-world case, so
 * it composes both clauses rather than falling back to a vague sentence — the
 * model can only cite specifics if we give it specifics.
 */
function describeRow(label: string, cells: ComparisonCell[], kind: DifferenceKind,
                     optionLabel: (id: string) => string): string | null {
  if (kind === 'none') return null;

  const have = cells.filter((c) => c.present && c.included);
  const lack = cells.filter((c) => !c.present || !c.included);

  if (kind === 'availability') {
    if (have.length === 0) return `${label} is not included in any option.`;
    return `${label} is included in ${have.map((c) => optionLabel(c.optionId)).join(', ')} but not ${lack.map((c) => optionLabel(c.optionId)).join(', ')}.`;
  }

  const limits = limitClause(label, cells, optionLabel);
  const deds = deductibleClause(cells, optionLabel);

  if (kind === 'limit' && limits) return `${limits}.`;
  if (kind === 'deductible' && deds) return `${label} deductibles differ — ${deds}.`;

  if (kind === 'mixed') {
    const parts: string[] = [];
    if (limits) parts.push(limits);
    if (deds) parts.push(deds);
    if (lack.length > 0 && have.length > 0) {
      parts.push(`it is not included in ${lack.map((c) => optionLabel(c.optionId)).join(', ')}`);
    }
    if (parts.length > 0) return `${parts.join('; ')}.`;
  }

  // Reached only when the values differ as text but cannot be ranked.
  return `${label} differs between the options.`;
}

/**
 * Cost difference sentences.
 *
 * Kept separate from coverage rows and stated explicitly ("costs less than")
 * because a model handed only raw totals will sometimes get the direction of
 * the comparison wrong. Saying it in words removes the arithmetic.
 */
export function costSummaries(comparison: Comparison): string[] {
  const labelOf = (id: string) => comparison.options.find((o) => o.id === id)?.label ?? 'Option';
  const total = comparison.costRows.find((r) => r.key === 'totalAnnual');
  if (!total || !total.differs) return [];

  const present = total.values.filter((v) => v.value !== null && v.value !== undefined);
  if (present.length < 2) return [];

  const sorted = [...present].sort((a, b) => a.value! - b.value!);
  const cheapest = sorted[0];
  const dearest = sorted[sorted.length - 1];

  const lines = [
    `${labelOf(cheapest.optionId)} has the lowest total annual cost at ${money(cheapest.value!)}; ${labelOf(dearest.optionId)} has the highest at ${money(dearest.value!)}.`,
  ];
  // An explicit pairwise ordering, so no arithmetic is left to the model.
  for (const v of sorted.slice(1)) {
    lines.push(
      `${labelOf(v.optionId)} costs ${money(v.value! - cheapest.value!)} more per year than ${labelOf(cheapest.optionId)}.`
    );
  }
  return lines;
}

export function buildComparison(options: QuoteOptionDTO[]): Comparison {
  const optionMeta = options.map((o) => ({
    id: o.id,
    label: o.optionLabel || o.carrierName || 'Option',
    carrierName: o.carrierName,
    isRecommended: o.isRecommended,
  }));
  const labelOf = (id: string) => optionMeta.find((o) => o.id === id)?.label ?? 'Option';

  // Line coverages up across options by match key, preserving first-seen order.
  const perOption = new Map<string, CoverageItem[]>(
    options.map((o) => [o.id, normalizeCoverages(o.coverages)])
  );
  const order: string[] = [];
  const labels = new Map<string, string>();
  for (const o of options) {
    for (const c of perOption.get(o.id)!) {
      const key = coverageMatchKey(c.name);
      if (key === '') continue;
      if (!labels.has(key)) { labels.set(key, c.name); order.push(key); }
    }
  }

  const coverageRows: ComparisonRow[] = order.map((matchKey) => {
    const cells: ComparisonCell[] = options.map((o) => {
      const found = perOption.get(o.id)!.find((c) => coverageMatchKey(c.name) === matchKey);
      return {
        optionId: o.id,
        present: Boolean(found),
        included: Boolean(found?.included),
        limit: found?.limit ?? null,
        deductible: found?.deductible ?? null,
        limitValue: parseLimitValue(found?.limit ?? null),
        deductibleValue: parseLimitValue(found?.deductible ?? null),
        isBestLimit: false,
        isBestDeductible: false,
      };
    });

    // What actually differs?
    const availabilityDiffers =
      new Set(cells.map((c) => c.present && c.included)).size > 1;

    const active = cells.filter((c) => c.present && c.included);
    const limitDiffers = active.length > 1 && (
      active.some((c) => c.limitValue !== null)
        ? new Set(active.map((c) => c.limitValue)).size > 1
        : !active.every((c) => sameText(c.limit, active[0].limit))
    );
    const deductibleDiffers = active.length > 1 && (
      active.some((c) => c.deductibleValue !== null)
        ? new Set(active.map((c) => c.deductibleValue)).size > 1
        : !active.every((c) => sameText(c.deductible, active[0].deductible))
    );

    const flags = [availabilityDiffers, limitDiffers, deductibleDiffers].filter(Boolean).length;
    let kind: DifferenceKind = 'none';
    if (flags > 1) kind = 'mixed';
    else if (availabilityDiffers) kind = 'availability';
    else if (limitDiffers) kind = 'limit';
    else if (deductibleDiffers) kind = 'deductible';

    // Mark the strongest cells — highest limit, lowest deductible.
    const rankableLimits = active.filter((c) => c.limitValue !== null);
    if (limitDiffers && rankableLimits.length > 1) {
      const max = Math.max(...rankableLimits.map((c) => c.limitValue!));
      cells.forEach((c) => { if (c.limitValue === max && c.included) c.isBestLimit = true; });
    }
    const rankableDeds = active.filter((c) => c.deductibleValue !== null);
    if (deductibleDiffers && rankableDeds.length > 1) {
      const min = Math.min(...rankableDeds.map((c) => c.deductibleValue!));
      cells.forEach((c) => { if (c.deductibleValue === min && c.included) c.isBestDeductible = true; });
    }

    const label = labels.get(matchKey)!;
    return {
      label, matchKey, cells,
      differs: kind !== 'none',
      differenceKind: kind,
      summary: describeRow(label, cells, kind, labelOf),
    };
  });

  const costDefs: { label: string; key: CostRow['key'] }[] = [
    { label: 'Annual Premium', key: 'premiumAnnual' },
    { label: 'Taxes', key: 'taxes' },
    { label: 'Fees', key: 'fees' },
    { label: 'Total Annual Cost', key: 'totalAnnual' },
  ];

  const costRows: CostRow[] = costDefs.map(({ label, key }) => {
    const values = options.map((o) => ({ optionId: o.id, value: o[key] }));
    const present = values.filter((v) => v.value !== null && v.value !== undefined);
    const differs = new Set(present.map((v) => v.value)).size > 1;
    let lowestOptionId: string | null = null;
    if (differs && present.length > 1) {
      lowestOptionId = present.reduce((a, b) => (b.value! < a.value! ? b : a)).optionId;
    }
    return { label, key, values, differs, lowestOptionId };
  })
  // A row every option leaves blank is noise in the table.
  .filter((row) => row.values.some((v) => v.value !== null && v.value !== undefined));

  return {
    options: optionMeta,
    coverageRows,
    costRows,
    differenceCount: coverageRows.filter((r) => r.differs).length,
  };
}

/** The difference sentences, for the AI recommendation prompt and the proposal. */
export function differenceSummaries(comparison: Comparison): string[] {
  return comparison.coverageRows
    .filter((r) => r.summary !== null)
    .map((r) => r.summary!);
}
