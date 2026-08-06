import { AI_PURPOSES } from '../config';
import {
  CoverageExplanationRefinementSchema,
  type CoverageExplanationRefinementOutput,
} from '../schemas';
import type { PromptDefinition } from './types';

/**
 * Coverage Recommendations — AI explanation refinement.
 * The deterministic engine has ALREADY chosen the coverages and their levels.
 * This prompt receives that list plus the business context and returns a
 * tailored plain-language `agentExplanation` per coverage, for the agent to use
 * with the insured. It must not change levels, add/remove coverages, or
 * guarantee coverage.
 */
export const coverageRecommendationExplanationPrompt: PromptDefinition<CoverageExplanationRefinementOutput> = {
  purpose: AI_PURPOSES.COVERAGE_RECOMMENDATIONS,
  version: '1.0.0',
  schema: CoverageExplanationRefinementSchema,
  maxOutputTokens: 1200,
  instructions: [
    'You are given a business context and a fixed list of recommended coverages, each with a',
    'recommendation level and reason that were already decided by a rules engine.',
    'For EACH coverage in the list, write a short, plain-English explanation the agent can use with',
    'the insured — tailored to this business. Do not change the coverage list or the levels.',
    '',
    'Respond with JSON in EXACTLY this shape (one entry per given coverage, same names):',
    '{',
    '  "explanations": [',
    '    { "coverageName": "Garagekeepers", "agentExplanation": "..." }',
    '  ]',
    '}',
    '',
    'Rules:',
    '- Keep each explanation to 1-2 simple sentences a business owner would understand.',
    '- Use soft language ("helps cover", "may be appropriate", "commonly recommended"). Never say the insured "needs" or "must have" it, and never guarantee coverage.',
    '- Do not invent coverages, levels, prices, carriers, or policy terms.',
    '- Return an entry for every coverage you were given, using the same coverageName.',
  ].join('\n'),
};
