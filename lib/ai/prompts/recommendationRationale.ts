import { AI_PURPOSES } from '../config';
import { RecommendationRationaleSchema, type RecommendationRationaleOutput } from '../schemas';
import type { PromptDefinition } from './types';

/**
 * "Why We Recommend This Option".
 *
 * The agent decides which option to recommend — that choice is already made
 * before this runs, and is passed in. The model only writes the explanation.
 *
 * It is given the comparison the diff engine produced, so its reasoning cites
 * real differences rather than invented ones, and the output schema holds a
 * single prose field with nowhere to put a number.
 */
export const recommendationRationalePrompt: PromptDefinition<RecommendationRationaleOutput> = {
  purpose: AI_PURPOSES.RECOMMENDATION_RATIONALE,
  version: '1.0.0',
  schema: RecommendationRationaleSchema,
  maxOutputTokens: 700,
  instructions: [
    'An insurance agent has already chosen which quote option to recommend to their client.',
    'Write the short explanation that will appear in the proposal under "Why We Recommend This Option".',
    '',
    'You are given: the business, every option with its total cost, the option the agent chose, a list of',
    'the factual coverage differences, and a list of cost facts — all produced by a comparison engine.',
    '',
    'The cost facts already state which option is cheaper and by how much. Use those statements as',
    'written. Do NOT compare the totals yourself or compute a difference — if a cost claim is not in',
    'the cost facts, do not make it.',
    '',
    'Respond with JSON in EXACTLY this shape:',
    '{ "rationale": "..." }',
    '',
    'Guidance:',
    '- 2-4 sentences, written to the business owner, in a confident and professional agency voice.',
    '- Ground the reasoning in the supplied differences — the coverage that is broader, the limit that',
    '  is higher, the deductible that is lower, the coverage the others leave out, the cost trade-off.',
    '- Where the recommended option costs more, say plainly what the extra money buys.',
    '- Where it costs less and still covers what matters, say that.',
    '',
    'Hard rules:',
    '- Use ONLY the figures supplied. Never state a premium, limit, deductible, or saving that is not',
    '  in the input, and never estimate one.',
    '- Never claim coverage is bound, effective, or guaranteed.',
    '- Never disparage a carrier. The options not chosen are legitimate; they are simply a weaker fit.',
    '- Never promise an outcome ("you will be fully covered", "this will save you money").',
    '- Do not mention AI, this prompt, or the comparison engine.',
  ].join('\n'),
};
