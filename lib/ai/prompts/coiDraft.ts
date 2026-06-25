import { AI_PURPOSES } from '../config';
import { CoiDraftSchema, type CoiDraftOutput } from '../schemas';
import type { PromptDefinition } from './types';

/**
 * Feature 6 — COI Assistant.
 * Drafts Certificate of Insurance data fields from the insured info, available
 * policy data, certificate-holder details, and the agent's requests. It only
 * prepares a DRAFT for agent review — it must not confirm coverage, assert that
 * coverage is in force, or invent policy numbers/limits not provided.
 */
export const coiDraftPrompt: PromptDefinition<CoiDraftOutput> = {
  purpose: AI_PURPOSES.COI_DRAFT,
  version: '1.0.0',
  schema: CoiDraftSchema,
  maxOutputTokens: 1800,
  instructions: [
    'You are preparing a DRAFT Certificate of Insurance (COI) for an agency user to review.',
    'You are given: insured information, any available policy data, certificate-holder details,',
    'project/job details, and the agent\'s requests (additional insured, waiver, special wording).',
    'Use ONLY the data provided. Do not invent carriers, policy numbers, limits, dates, or terms.',
    '',
    'Respond with JSON in EXACTLY this shape (no extra keys):',
    '{',
    '  "insuredName": "...",',
    '  "certificateHolder": "...",',
    '  "descriptionOfOperations": "...",',
    '  "coverages": [ { "type": "General Liability", "policyNumber": "", "effectiveDate": "", "expirationDate": "", "limits": "" } ],',
    '  "additionalInsured": false,',
    '  "waiverOfSubrogation": false,',
    '  "missingInformation": ["..."],',
    '  "flaggedWording": [ { "request": "...", "concern": "..." } ],',
    '  "endorsementReviewNeeded": false,',
    '  "endorsementReviewReason": "..."',
    '}',
    '',
    'Field guidance:',
    '- coverages: fill from provided policy data; leave a field blank ("") if not provided.',
    '- descriptionOfOperations: assemble project details + any acceptable special wording.',
    '- additionalInsured / waiverOfSubrogation: reflect what the agent requested.',
    '- missingInformation: anything required to issue a COI that is absent (e.g., policy numbers, limits, holder address).',
    '- flaggedWording: any special-wording or request that is unusual, broad, or could imply coverage not evidenced — flag with a short concern. Empty array if none.',
    '- endorsementReviewNeeded: true if the requests likely require an endorsement (e.g., additional insured/waiver) that an agent must verify exists; explain in endorsementReviewReason.',
    '',
    'Do NOT state that coverage is confirmed or that the COI is issued. This is a draft requiring agent approval.',
  ].join('\n'),
};
