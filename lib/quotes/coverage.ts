/**
 * Coverage items on a quote option, and the guardrail that keeps AI away from
 * the numbers.
 *
 * A coverage has two halves that are deliberately kept apart:
 *
 *   FACTS  — name, limit, deductible, included. Entered by the agent from the
 *            carrier's quote. These are contractual terms.
 *   PROSE  — plainLanguage, whyItMatters, differsFromOthers. Draftable by AI,
 *            always editable by the agent.
 *
 * `mergeAiProse` below only ever writes the prose half. The model's output is
 * not even consulted for a limit or a deductible, so requirement 15 ("AI must
 * not change quote terms, alter carrier limits or premiums") holds structurally
 * rather than depending on the model following instructions.
 */

import { randomUUID } from 'crypto';

export interface CoverageItem {
  /** Stable id within the option; the join key for AI prose. */
  key: string;

  // ── Facts: agent-entered, never AI-writable ──
  name: string;
  limit: string | null;
  deductible: string | null;
  included: boolean;

  // ── Prose: AI-draftable, agent-editable ──
  plainLanguage: string;
  whyItMatters: string;
  differsFromOthers: string;

  // ── Review trail ──
  /** Prose came from the model at least once. */
  aiDrafted: boolean;
  /** Agent has edited the prose since it was drafted. */
  agentEdited: boolean;
  /** Set when an agent explicitly approves this coverage's client-facing text. */
  reviewedAt: string | null;
}

const MAX_COVERAGES = 40;
const MAX_NAME = 200;
const MAX_PROSE = 2000;

export class CoverageValidationError extends Error {}

function str(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, max);
}

function nullableStr(value: unknown, max: number): string | null {
  const s = str(value, max);
  return s === '' ? null : s;
}

/**
 * Normalise whatever is stored in `QuoteOption.coverages` into CoverageItem[].
 *
 * The column is untyped Json, so anything could be in there — older shapes,
 * partial writes, hand-edited data. Everything is coerced rather than trusted,
 * and unusable entries are dropped instead of throwing: a malformed coverage
 * should not make a whole quote option unreadable.
 */
export function normalizeCoverages(raw: unknown): CoverageItem[] {
  if (!Array.isArray(raw)) return [];
  const out: CoverageItem[] = [];
  const seenKeys = new Set<string>();

  for (const entry of raw.slice(0, MAX_COVERAGES)) {
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as Record<string, unknown>;

    const name = str(e.name, MAX_NAME);
    if (name === '') continue; // a coverage without a name is not a coverage

    // Regenerate on collision so the AI join key stays unambiguous.
    let key = str(e.key, 100) || randomUUID();
    if (seenKeys.has(key)) key = randomUUID();
    seenKeys.add(key);

    out.push({
      key,
      name,
      limit: nullableStr(e.limit, MAX_NAME),
      deductible: nullableStr(e.deductible, MAX_NAME),
      included: e.included !== false, // absent means included
      plainLanguage: str(e.plainLanguage ?? e.explanation, MAX_PROSE),
      whyItMatters: str(e.whyItMatters, MAX_PROSE),
      differsFromOthers: str(e.differsFromOthers, MAX_PROSE),
      aiDrafted: e.aiDrafted === true,
      agentEdited: e.agentEdited === true,
      reviewedAt: typeof e.reviewedAt === 'string' ? e.reviewedAt : null,
    });
  }
  return out;
}

/**
 * Validate coverages submitted by an agent. Unlike normalize, this throws —
 * a person typing into a form should be told what is wrong.
 */
export function parseCoverageInput(raw: unknown): CoverageItem[] {
  if (raw === null || raw === undefined) return [];
  if (!Array.isArray(raw)) throw new CoverageValidationError('Coverages must be a list');
  if (raw.length > MAX_COVERAGES) {
    throw new CoverageValidationError(`A quote option can have at most ${MAX_COVERAGES} coverages`);
  }
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') {
      throw new CoverageValidationError('Each coverage must be an object');
    }
    if (str((entry as Record<string, unknown>).name, MAX_NAME) === '') {
      throw new CoverageValidationError('Every coverage needs a name');
    }
  }
  return normalizeCoverages(raw);
}

/** One coverage's prose as returned by the model. */
export interface AiCoverageProse {
  key: string;
  plainLanguage?: string;
  whyItMatters?: string;
  differsFromOthers?: string;
}

export interface MergeReport {
  /** Coverages that received prose. */
  updated: number;
  /** Keys the model returned that we never sent — invented coverages, discarded. */
  unknownKeys: string[];
  /** Coverages we sent that the model did not write prose for. */
  missingKeys: string[];
}

/**
 * Write AI prose onto stored coverages.
 *
 * The stored coverages are the base. For each one we look up the model's prose
 * by key and copy across *only* the three prose fields. Consequences:
 *
 *  - A limit or deductible in the model's response is ignored entirely.
 *  - A coverage the model invented has no matching key, so it cannot appear.
 *  - A coverage the model skipped keeps whatever prose it already had.
 *  - Prose an agent has already edited is preserved unless `overwriteEdited`.
 */
export function mergeAiProse(
  stored: CoverageItem[],
  aiItems: AiCoverageProse[],
  { overwriteEdited = false }: { overwriteEdited?: boolean } = {}
): { coverages: CoverageItem[]; report: MergeReport } {
  const byKey = new Map<string, AiCoverageProse>();
  for (const item of aiItems) {
    if (item && typeof item.key === 'string') byKey.set(item.key, item);
  }

  const storedKeys = new Set(stored.map((c) => c.key));
  const unknownKeys = [...byKey.keys()].filter((k) => !storedKeys.has(k));
  const missingKeys: string[] = [];
  let updated = 0;

  const coverages = stored.map((coverage) => {
    const prose = byKey.get(coverage.key);
    if (!prose) {
      missingKeys.push(coverage.key);
      return coverage;
    }
    // The agent's own wording outranks a regenerated draft.
    if (coverage.agentEdited && !overwriteEdited) return coverage;

    updated++;
    return {
      ...coverage,
      plainLanguage: str(prose.plainLanguage, MAX_PROSE) || coverage.plainLanguage,
      whyItMatters: str(prose.whyItMatters, MAX_PROSE) || coverage.whyItMatters,
      differsFromOthers: str(prose.differsFromOthers, MAX_PROSE) || coverage.differsFromOthers,
      aiDrafted: true,
      // Regenerated text has not been reviewed, whatever its previous state.
      agentEdited: false,
      reviewedAt: null,
    };
  });

  return { coverages, report: { updated, unknownKeys, missingKeys } };
}

/**
 * Set `agentEdited` by comparing incoming prose against what is stored, rather
 * than trusting the client to flag its own edits.
 *
 * The flag gates whether AI text still needs review, so a client that forgot to
 * set it — or chose not to — could otherwise push unreviewed model output in
 * front of an insured. Deciding it server-side removes that possibility.
 */
export function markAgentEdits(stored: CoverageItem[], incoming: CoverageItem[]): CoverageItem[] {
  const byKey = new Map(stored.map((c) => [c.key, c]));

  return incoming.map((item) => {
    const before = byKey.get(item.key);
    if (!before) return item; // new coverage, agent-authored by definition

    const proseChanged =
      before.plainLanguage !== item.plainLanguage ||
      before.whyItMatters !== item.whyItMatters ||
      before.differsFromOthers !== item.differsFromOthers;

    return {
      ...item,
      // Preserve provenance: only a generation run may set aiDrafted.
      aiDrafted: before.aiDrafted,
      agentEdited: before.agentEdited || proseChanged,
      // Editing reviewed text resets the review; an untouched item keeps it.
      reviewedAt: proseChanged ? null : (item.reviewedAt ?? before.reviewedAt),
    };
  });
}

/**
 * Client-facing text must be agent-reviewed before the insured sees it
 * (requirement 15). AI-drafted prose counts as reviewed once the agent has
 * edited it or explicitly approved it.
 */
export function needsAgentReview(coverages: CoverageItem[]): CoverageItem[] {
  return coverages.filter((c) => c.aiDrafted && !c.agentEdited && c.reviewedAt === null);
}

/**
 * Strip the review trail — what actually goes in front of the insured.
 *
 * `differsFromOthers` is included deliberately: requirement 2 lists "important
 * differences compared with other options" as part of the coverage breakdown the
 * insured reads. What is withheld here is provenance (aiDrafted, agentEdited,
 * reviewedAt) and the internal join key, not content.
 */
export function toClientFacing(coverages: CoverageItem[]) {
  return coverages.map(
    ({ name, limit, deductible, included, plainLanguage, whyItMatters, differsFromOthers }) => ({
      name, limit, deductible, included, plainLanguage, whyItMatters, differsFromOthers,
    })
  );
}

export function newCoverage(name = ''): CoverageItem {
  return {
    key: randomUUID(), name, limit: null, deductible: null, included: true,
    plainLanguage: '', whyItMatters: '', differsFromOthers: '',
    aiDrafted: false, agentEdited: false, reviewedAt: null,
  };
}
