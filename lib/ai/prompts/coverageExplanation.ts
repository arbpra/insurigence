import { AI_PURPOSES } from '../config';
import { CoverageExplanationSchema, type CoverageExplanationOutput } from '../schemas';
import type { PromptDefinition } from './types';

/**
 * Feature 3 — Coverage Explanation Assistant.
 * Given a business context and a list of coverages the agent selected, explain
 * each coverage in plain English the agent can use with the insured. The AI
 * explains relevance — it does not decide that the business needs or has a
 * coverage, and never quotes prices, limits, or binding terms.
 */
export const coverageExplanationPrompt: PromptDefinition<CoverageExplanationOutput> = {
  purpose: AI_PURPOSES.COVERAGE_EXPLANATION,
  version: '1.0.0',
  schema: CoverageExplanationSchema,
  instructions: [
    'You are given a business context and a list of insurance coverages to explain.',
    'For EACH coverage in the list, write a plain-English explanation an agent can share with the insured.',
    'Tailor the explanation to the business context where relevant, but do not state as fact that the',
    'business already carries, needs, or qualifies for the coverage — frame it as education.',
    '',
    'Respond with JSON in EXACTLY this shape (one object per requested coverage, same order):',
    '{',
    '  "explanations": [',
    '    {',
    '      "coverage": "General Liability (GL)",',
    '      "whyItMatters": "...",',
    '      "whenItApplies": "...",',
    '      "ifMissing": "..."',
    '    }',
    '  ]',
    '}',
    '',
    'Field guidance:',
    '- whyItMatters: why this coverage is relevant for a business like this one.',
    '- whenItApplies: concrete situations where the coverage would respond.',
    '- ifMissing: the exposure the business carries if it goes without this coverage.',
    '',
    'Keep each field to 1-3 sentences, jargon-free. Do not invent carrier names, prices, limits, or terms.',
  ].join('\n'),
};
