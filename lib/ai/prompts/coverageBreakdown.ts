import { AI_PURPOSES } from '../config';
import { CoverageBreakdownSchema, type CoverageBreakdownOutput } from '../schemas';
import type { PromptDefinition } from './types';

/**
 * Coverage Breakdown for quote proposals.
 *
 * Turns the coverages an agent entered from carrier quotes into language the
 * insured can actually read, including how each option differs from the others.
 *
 * The model writes prose only. Limits, deductibles, and premiums are supplied as
 * read-only context so the comparison can reference them accurately, but the
 * output schema has nowhere to put a number, and mergeAiProse copies only the
 * three prose fields back onto the stored coverage. A hallucinated limit
 * therefore cannot reach the database or the insured.
 */
export const coverageBreakdownPrompt: PromptDefinition<CoverageBreakdownOutput> = {
  purpose: AI_PURPOSES.COVERAGE_BREAKDOWN,
  version: '1.0.0',
  schema: CoverageBreakdownSchema,
  maxOutputTokens: 3000,
  instructions: [
    'You are writing the coverage breakdown section of an insurance proposal for a commercial insured.',
    '',
    'You are given the business context and every quote option the agent received, each with its',
    'coverages. Each coverage carries a "key", a name, and — where the agent recorded them — a limit',
    'and deductible. Write client-facing prose for EVERY coverage you are given.',
    '',
    'Respond with JSON in EXACTLY this shape:',
    '{',
    '  "coverages": [',
    '    {',
    '      "key": "<copy the key from the input verbatim>",',
    '      "plainLanguage": "...",',
    '      "whyItMatters": "...",',
    '      "differsFromOthers": "..."',
    '    }',
    '  ]',
    '}',
    '',
    'Field guidance:',
    '- plainLanguage: what this coverage actually does, in language a business owner understands.',
    '  Describe the protection, not the policy mechanics. 1-3 sentences.',
    '- whyItMatters: why it matters for THIS business, given the context supplied. Reference the',
    '  operations where that is genuinely relevant. 1-3 sentences.',
    '- differsFromOthers: how this option compares with the other options on this same coverage —',
    '  a higher or lower limit, a different deductible, present here but absent elsewhere. Compare',
    '  ONLY using the limits and deductibles given to you. If the options are materially the same',
    '  on this coverage, or there is only one option, return an empty string.',
    '',
    'Hard rules:',
    '- Copy each "key" exactly. An item whose key was not in the input is discarded.',
    '- Never state a limit, deductible, premium, or price that was not given to you in the input.',
    '- Never describe a coverage as included when the input marks it excluded, or vice versa.',
    '- Never recommend an option, advise the insured which to buy, or say coverage is bound.',
    '  Selecting and recommending is the agent\'s job.',
    '- Where a limit or deductible is missing from the input, do not guess it and do not comment',
    '  on it — write about the coverage without referencing the missing number.',
    '- Plain language throughout: no "insured", "peril", "subrogation", "care, custody, or control"',
    '  without explaining it.',
  ].join('\n'),
};
