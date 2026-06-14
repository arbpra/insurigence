import { AI_PURPOSES } from '../config';
import { QuickRiskGuideSchema, type QuickRiskGuideOutput } from '../schemas';
import type { PromptDefinition } from './types';

/**
 * Feature 2 — Quick Risk Guide.
 * Agent types a short free-text description; AI returns quick INTERNAL guidance.
 * This runs before any rules-engine evaluation, so the market direction here is
 * an explicitly non-binding directional guess — never a determination.
 */
export const quickRiskGuidePrompt: PromptDefinition<QuickRiskGuideOutput> = {
  purpose: AI_PURPOSES.QUICK_RISK_GUIDE,
  version: '1.0.0',
  schema: QuickRiskGuideSchema,
  instructions: [
    'An agent has typed a short description of a prospective commercial risk, e.g.',
    '"Auto detailing business in Michigan, brand new, $150k revenue, no employees."',
    'Provide quick INTERNAL guidance to help the agent orient. This is not shown to the insured.',
    '',
    'Respond with JSON in EXACTLY this shape (no extra keys):',
    '{',
    '  "likelyMarketDirection": "STANDARD" | "EXCESS_SURPLUS" | "BORDERLINE",',
    '  "keyRiskConcerns": ["..."],',
    '  "coverageConsiderations": ["..."],',
    '  "suggestedClassification": { "naicsCandidates": ["811192 Car Washes"], "notes": "..." },',
    '  "recommendedNextSteps": ["..."]',
    '}',
    '',
    'Notes on the fields:',
    '- likelyMarketDirection is a non-binding directional guess only; the rules engine makes the real call later.',
    '- suggestedClassification MUST be an object with a "naicsCandidates" string array and a "notes" string — not a bare array.',
    '- naicsCandidates entries are plain strings like "811192 Car Washes".',
    '',
    'Keep it concise and practical. Do not invent carrier names, pricing, or eligibility outcomes.',
  ].join('\n'),
};
