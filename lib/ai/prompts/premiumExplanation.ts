import { AI_PURPOSES } from '../config';
import { PremiumExplanationSchema, type PremiumExplanationOutput } from '../schemas';
import type { PromptDefinition } from './types';

/**
 * Premium Indication — explanation only.
 * The deterministic benchmark has ALREADY computed the range, confidence, and
 * factor lists. This prompt is given those results and writes a short plain-
 * language reasoning paragraph. It must not produce or restate different
 * numbers, must not call it a quote, and must not imply coverage or binding.
 */
export const premiumExplanationPrompt: PromptDefinition<PremiumExplanationOutput> = {
  purpose: AI_PURPOSES.PREMIUM_INDICATION,
  version: '1.0.0',
  schema: PremiumExplanationSchema,
  temperature: 0.2,
  maxOutputTokens: 400,
  instructions: [
    'You are given a pre-computed generalized premium INDICATION (a range) with its',
    'confidence level and the factors that were considered. Write a short, plain-language',
    'explanation (2-4 sentences) of what drives this range, for internal agent use.',
    '',
    'Respond with JSON in EXACTLY this shape:',
    '{ "reasoning": "..." }',
    '',
    'Strict rules:',
    '- Do NOT state any premium number other than the range you were given, and do not narrow it.',
    '- Do NOT call this a quote, price, binder, or offer. It is a generalized indication only.',
    '- Do NOT imply coverage is available or that any carrier will accept the risk.',
    '- Only reference factors present in the provided data. Do not invent facts.',
    '- Keep it concise and professional.',
  ].join('\n'),
};
