import { AI_PURPOSES } from '../config';
import { DocumentSummarySchema, type DocumentSummaryOutput } from '../schemas';
import type { PromptDefinition } from './types';

/**
 * Feature 5 — Document Summary.
 * Given the text of an uploaded policy or quote, extract the key structured
 * fields. The AI extracts only what is present in the document — it does not
 * confirm coverage, invent terms, or make coverage determinations. "gaps" are
 * potential opportunities flagged for agent review, not advice to the insured.
 */
export const documentSummaryPrompt: PromptDefinition<DocumentSummaryOutput> = {
  purpose: AI_PURPOSES.DOCUMENT_SUMMARY,
  version: '1.0.0',
  schema: DocumentSummarySchema,
  maxOutputTokens: 1800,
  instructions: [
    'You are extracting key fields from the text of an insurance policy or quote document.',
    'Extract ONLY what is actually present in the text. If a field is not found, leave it blank',
    '(empty string) or an empty array — never guess or invent values.',
    '',
    'Respond with JSON in EXACTLY this shape (no extra keys):',
    '{',
    '  "carrier": "...",',
    '  "effectiveDate": "...",',
    '  "expirationDate": "...",',
    '  "coverages": [ { "name": "General Liability", "limit": "$1,000,000", "deductible": "$1,000" } ],',
    '  "gaps": ["..."],',
    '  "notes": "..."',
    '}',
    '',
    'Field guidance:',
    '- carrier / effectiveDate / expirationDate: copy as written in the document; blank if absent.',
    '- coverages: one object per coverage line found, with limit and deductible if stated (blank if not).',
    '- gaps: coverages a business like this commonly carries that appear ABSENT here — flagged for the agent to review, not stated as fact.',
    '- notes: anything notable for the agent (e.g., unclear or conflicting figures).',
    '',
    'Do not confirm that coverage is in force, and do not state coverage determinations.',
  ].join('\n'),
};
