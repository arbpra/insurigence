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

/** Feature 6 — COI Assistant (Certificate of Insurance draft). */
const CoiCoverageSchema = z.preprocess((val) => {
  if (typeof val === 'string') return { type: val };
  if (val && typeof val === 'object') {
    const o = val as Record<string, unknown>;
    return {
      type: typeof o.type === 'string' ? o.type : String(o.name ?? o.coverage ?? ''),
      policyNumber: o.policyNumber == null ? '' : String(o.policyNumber),
      effectiveDate: o.effectiveDate == null ? '' : String(o.effectiveDate),
      expirationDate: o.expirationDate == null ? '' : String(o.expirationDate),
      limits: o.limits == null ? '' : String(o.limits),
    };
  }
  return val;
}, z.object({
  type: z.string(),
  policyNumber: z.string().default(''),
  effectiveDate: z.string().default(''),
  expirationDate: z.string().default(''),
  limits: z.string().default(''),
}));

const FlaggedWordingSchema = z.object({
  request: z.string(),
  concern: z.string().default(''),
});

export const CoiDraftSchema = z.object({
  insuredName: z.string().default(''),
  certificateHolder: z.string().default(''),
  descriptionOfOperations: z.string().default('').describe('Assembled description / special wording for the COI.'),
  coverages: z.array(CoiCoverageSchema).default([]),
  additionalInsured: z.boolean().default(false),
  waiverOfSubrogation: z.boolean().default(false),
  missingInformation: z.array(z.string()).default([]).describe('Items needed before the COI can be issued.'),
  flaggedWording: z.array(FlaggedWordingSchema).default([]).describe('Unusual wording/requests flagged for agent review.'),
  endorsementReviewNeeded: z.boolean().default(false),
  endorsementReviewReason: z.string().default(''),
});
export type CoiDraftOutput = z.infer<typeof CoiDraftSchema>;

/** Feature 5 — Document Summary (policy/quote extraction). */
const CoverageLineSchema = z.preprocess((val) => {
  // The model sometimes returns a coverage as a bare string instead of an object.
  if (typeof val === 'string') return { name: val, limit: '', deductible: '' };
  if (val && typeof val === 'object') {
    const o = val as Record<string, unknown>;
    return {
      name: typeof o.name === 'string' ? o.name : String(o.coverage ?? ''),
      limit: o.limit == null ? '' : String(o.limit),
      deductible: o.deductible == null ? '' : String(o.deductible),
    };
  }
  return val;
}, z.object({
  name: z.string(),
  limit: z.string().default(''),
  deductible: z.string().default(''),
}));

export const DocumentSummarySchema = z.object({
  carrier: z.string().default('').describe('Carrier/insurer name, blank if not found.'),
  effectiveDate: z.string().default('').describe('Policy effective date as written, blank if not found.'),
  expirationDate: z.string().default('').describe('Policy expiration date as written, blank if not found.'),
  coverages: z.array(CoverageLineSchema).default([]),
  gaps: z.array(z.string()).default([]).describe('Potential missing coverages / gap opportunities to flag for agent review.'),
  notes: z.string().default(''),
});
export type DocumentSummaryOutput = z.infer<typeof DocumentSummarySchema>;

/** Feature 4 — Proposal Language Assistant. */
export const ProposalLanguageSchema = z.object({
  executiveSummary: z.string().describe('A concise client-facing overview of the placement.'),
  whatWeRecommend: z.string().describe('"What we recommend and why" — the recommendation narrative.'),
  optionComparison: z.string().default('').describe('Narrative comparing the carrier/market options.'),
});
export type ProposalLanguageOutput = z.infer<typeof ProposalLanguageSchema>;

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

/** Coerce a value to a number (accepts "150000", "$150k", 150000) or null. */
const zNullableNumber = z.preprocess((v) => {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string') {
    let s = v.toLowerCase().replace(/[$,\s]/g, '');
    let mult = 1;
    if (s.endsWith('k')) { mult = 1_000; s = s.slice(0, -1); }
    else if (s.endsWith('m')) { mult = 1_000_000; s = s.slice(0, -1); }
    const n = parseFloat(s);
    return Number.isFinite(n) ? n * mult : null;
  }
  return null;
}, z.number().nullable());

/**
 * Structured facts parsed from the agent's free-text description. These feed the
 * deterministic premium benchmark — the AI parses the agent's own words into
 * numbers; it does not compute pricing.
 */
export const ParsedRiskFactsSchema = z.object({
  industry: z.string().default(''),
  revenue: zNullableNumber.default(null),
  employees: zNullableNumber.default(null),
  state: z.string().default('').describe('Two-letter state code if determinable, else blank.'),
  yearsInBusiness: zNullableNumber.default(null),
  priorLosses: z.boolean().nullable().default(null),
  requestedLimit: zNullableNumber.default(null),
});

/** Feature 2 — Quick Risk Guide (internal guidance only). */
export const QuickRiskGuideSchema = z.object({
  likelyMarketDirection: z
    .enum(['STANDARD', 'EXCESS_SURPLUS', 'BORDERLINE'])
    .describe('Non-binding directional guess. The rules engine makes the real determination.'),
  keyRiskConcerns: z.array(z.string()),
  coverageConsiderations: z.array(z.string()),
  suggestedClassification: SuggestedClassificationSchema,
  recommendedNextSteps: z.array(z.string()),
  parsedFacts: ParsedRiskFactsSchema.default({}),
});
export type QuickRiskGuideOutput = z.infer<typeof QuickRiskGuideSchema>;

/**
 * Premium Indication — AI explanation only. The range, confidence, and factor
 * lists come from the deterministic benchmark; the AI writes a short plain-
 * language reasoning paragraph explaining the given range. It must not restate
 * different numbers or call it a quote.
 */
export const PremiumExplanationSchema = z.object({
  reasoning: z.string().describe('Plain-language explanation of what drives the given range.'),
});
export type PremiumExplanationOutput = z.infer<typeof PremiumExplanationSchema>;
