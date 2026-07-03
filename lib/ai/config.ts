/**
 * Central AI configuration.
 *
 * Everything about *how* we talk to the LLM lives here — model names, limits,
 * the guardrails injected into every prompt, and the canonical disclaimer.
 * Feature prompts (Day 2) and the service layer read from this file so there is
 * a single source of truth.
 */

/** Model used for all AI features unless a feature overrides it. */
export const AI_MODEL = process.env.AI_MODEL || 'gpt-4o-mini';

/** Default sampling + size limits. Conservative by design — this is an assistant, not a creative writer. */
export const AI_DEFAULTS = {
  temperature: 0.2,
  maxOutputTokens: 1500,
} as const;

/**
 * Disclaimer attached to every AI output and surfaced in the UI.
 * Per client direction: "Guidance only. Final review required by licensed agent."
 */
export const AI_DISCLAIMER =
  'Guidance only. This is AI-assisted output and requires final review by a licensed agent.';

/**
 * Guardrails injected into the system prompt of EVERY AI call.
 * These encode the client's non-negotiable rules: the rules engine decides,
 * AI only explains/summarizes/drafts, and never invents eligibility or pricing.
 */
export const AI_GUARDRAILS = [
  'You are an assistant layer on top of a deterministic insurance rules engine.',
  'The rules engine makes all underwriting, quoting, eligibility, and binding decisions. You do NOT.',
  'Your job is only to explain, summarize, clean up, and draft language based on the structured data you are given.',
  'Never override or contradict carrier appetite rules or the rules-engine output provided to you.',
  'Never invent carrier eligibility, pricing, premiums, limits, or binding terms that are not present in the input.',
  'If information is missing or unclear, say so explicitly instead of guessing.',
  'Every output is draft guidance that a licensed agent must review before use.',
].join(' ');

/**
 * Canonical list of AI features. Stored on each AiRun.purpose for audit/history.
 * Keep these stable — they are written to the database.
 */
export const AI_PURPOSES = {
  SMART_INTAKE: 'smart_intake_assistant',
  QUICK_RISK_GUIDE: 'quick_risk_guide',
  PREMIUM_INDICATION: 'premium_indication',
  COVERAGE_EXPLANATION: 'coverage_explanation',
  PROPOSAL_LANGUAGE: 'proposal_language',
  DOCUMENT_SUMMARY: 'document_summary',
  COI_DRAFT: 'coi_draft',
  ACORD_DRAFT: 'acord_draft',
} as const;

export type AiPurpose = (typeof AI_PURPOSES)[keyof typeof AI_PURPOSES];

/**
 * Mandatory disclaimer for the Premium Indication feature. Shown anywhere a
 * premium indication appears. This is NOT a quote — ranges only.
 */
export const PREMIUM_INDICATION_DISCLAIMER =
  'This is a generalized premium indication only and is not a quote, binder, or offer of insurance. ' +
  'Actual premiums vary based on underwriting review, carrier appetite, class codes, coverage limits, ' +
  'loss history, state rating rules, endorsements, and other factors. Final pricing must be confirmed ' +
  'by a licensed agent and insurance carrier.';
