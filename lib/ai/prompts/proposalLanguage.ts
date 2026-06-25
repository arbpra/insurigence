import { AI_PURPOSES } from '../config';
import { ProposalLanguageSchema, type ProposalLanguageOutput } from '../schemas';
import type { PromptDefinition } from './types';

/**
 * Feature 4 — Proposal Language Assistant.
 * Turns the rules-engine evaluation (market classification, carrier fits) and
 * insured details into clean, client-ready proposal language. It writes from
 * the structured data provided — it never invents carriers, pricing, limits, or
 * eligibility, and the output is draft language for agent review.
 */
export const proposalLanguagePrompt: PromptDefinition<ProposalLanguageOutput> = {
  purpose: AI_PURPOSES.PROPOSAL_LANGUAGE,
  version: '1.0.0',
  schema: ProposalLanguageSchema,
  maxOutputTokens: 1800,
  instructions: [
    'You are drafting client-facing proposal language for an insurance agency.',
    'You are given: the insured details, the rules-engine evaluation (market classification,',
    'confidence, reason codes), the top carrier fits, and any agent notes. Write ONLY from this data.',
    '',
    'Respond with JSON in EXACTLY this shape (no extra keys):',
    '{',
    '  "executiveSummary": "...",',
    '  "whatWeRecommend": "...",',
    '  "optionComparison": "..."',
    '}',
    '',
    'Field guidance:',
    '- executiveSummary: a short, professional overview of the placement the client can read first.',
    '- whatWeRecommend: the recommended market direction and why, grounded in the evaluation reasons.',
    '- optionComparison: a narrative comparing the carrier/market options provided (by name and fit).',
    '',
    'Rules: Do not invent carrier names, premiums, limits, or terms not present in the input.',
    'Do not present the market direction as a binding decision; it reflects the evaluation. Keep it',
    'professional and client-appropriate (this text may be shown to the insured).',
  ].join('\n'),
};
