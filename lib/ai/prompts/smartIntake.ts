import { AI_PURPOSES } from '../config';
import { SmartIntakeSchema, type SmartIntakeOutput } from '../schemas';
import type { PromptDefinition } from './types';

/**
 * Feature 1 — Smart Intake Assistant.
 * Runs after an intake is submitted. Cleans up and structures the raw answers
 * so an agent has submission-ready material without re-typing anything.
 */
export const smartIntakePrompt: PromptDefinition<SmartIntakeOutput> = {
  purpose: AI_PURPOSES.SMART_INTAKE,
  version: '1.0.0',
  schema: SmartIntakeSchema,
  instructions: [
    'You are cleaning up and structuring a submitted commercial insurance intake.',
    'You are given the intake answers as structured data. Work only from those answers.',
    '',
    'Respond with JSON in EXACTLY this shape (no extra keys):',
    '{',
    '  "cleanBusinessDescription": "...",',
    '  "operationsSummary": "...",',
    '  "missingOrUnclearInfo": ["..."],',
    '  "submissionReadyRiskSummary": "..."',
    '}',
    '',
    'Field guidance:',
    '- cleanBusinessDescription: a clear, professional description of what the business does, in plain language.',
    '- operationsSummary: a concise summary of how the business operates (locations, services, who they serve).',
    '- missingOrUnclearInfo: specific items missing, ambiguous, or needing agent follow-up before marketing the risk. Use an empty array if nothing is missing.',
    '- submissionReadyRiskSummary: a tidy summary an agent could paste into a carrier submission.',
    '',
    'Do not assume facts that are not in the answers. Do not estimate premiums or eligibility.',
  ].join('\n'),
};
