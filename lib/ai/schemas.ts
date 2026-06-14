import { z } from 'zod';

/**
 * Output schemas for each AI feature.
 *
 * These are the contract: the model is told to produce JSON in this shape, and
 * `callPrompt` validates the response against the matching schema before any
 * caller sees it. If the model drifts, validation fails loudly instead of
 * leaking malformed data into the UI or database.
 *
 * Only the Phase-1 priority features (Smart Intake, Quick Risk Guide) are
 * defined now. Later features add their schemas here as they are built.
 */

/** Feature 1 — Smart Intake Assistant. */
export const SmartIntakeSchema = z.object({
  cleanBusinessDescription: z
    .string()
    .describe('A clear, professional rewrite of what the business does.'),
  operationsSummary: z
    .string()
    .describe('A concise summary of how the business operates.'),
  missingOrUnclearInfo: z
    .array(z.string())
    .describe('Specific items that are missing, ambiguous, or need agent follow-up.'),
  submissionReadyRiskSummary: z
    .string()
    .describe('A summary suitable for submitting the risk to a carrier or underwriter.'),
});
export type SmartIntakeOutput = z.infer<typeof SmartIntakeSchema>;

/**
 * Coerce a list of mixed values into clean strings. LLMs sometimes return NAICS
 * candidates as `{ code, description }` objects instead of strings.
 */
function toStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((v) => {
    if (typeof v === 'string') return v;
    if (v && typeof v === 'object') {
      const o = v as Record<string, unknown>;
      const code = o.code ?? o.naics ?? o.naicsCode;
      const desc = o.description ?? o.title ?? o.name ?? o.label;
      const joined = [code, desc].filter(Boolean).join(' ').trim();
      return joined || JSON.stringify(v);
    }
    return String(v);
  });
}

/**
 * Tolerant `suggestedClassification`: the model occasionally returns this as a
 * bare array (of strings or objects) instead of the intended object. We
 * normalize both shapes into `{ naicsCandidates, notes }` before validating, so
 * harmless format drift doesn't fail the whole run.
 */
const SuggestedClassificationSchema = z.preprocess((val) => {
  if (Array.isArray(val)) {
    return { naicsCandidates: toStringList(val), notes: '' };
  }
  if (val && typeof val === 'object') {
    const o = val as Record<string, unknown>;
    return {
      naicsCandidates: toStringList(o.naicsCandidates),
      notes: typeof o.notes === 'string' ? o.notes : '',
    };
  }
  return val;
}, z.object({
  naicsCandidates: z.array(z.string()),
  notes: z.string(),
}));

/** Feature 3 — Coverage Explanation Assistant. */
const CoverageExplanationItemSchema = z.object({
  coverage: z.string().describe('The coverage name being explained.'),
  whyItMatters: z.string().default('').describe('Plain-English reason this coverage matters for this business.'),
  whenItApplies: z.string().default('').describe('Situations where this coverage would respond.'),
  ifMissing: z.string().default('').describe('The exposure/gap the business carries if this coverage is absent.'),
});

export const CoverageExplanationSchema = z.object({
  explanations: z.array(CoverageExplanationItemSchema),
});
export type CoverageExplanationOutput = z.infer<typeof CoverageExplanationSchema>;

/** Feature 2 — Quick Risk Guide (internal guidance only). */
export const QuickRiskGuideSchema = z.object({
  likelyMarketDirection: z
    .enum(['STANDARD', 'EXCESS_SURPLUS', 'BORDERLINE'])
    .describe('Non-binding directional guess. The rules engine makes the real determination.'),
  keyRiskConcerns: z.array(z.string()),
  coverageConsiderations: z.array(z.string()),
  suggestedClassification: SuggestedClassificationSchema,
  recommendedNextSteps: z.array(z.string()),
});
export type QuickRiskGuideOutput = z.infer<typeof QuickRiskGuideSchema>;
