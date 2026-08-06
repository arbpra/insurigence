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
  version: '1.2.0',
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
    '  "recommendedNextSteps": ["..."],',
    '  "parsedFacts": {',
    '    "industry": "auto detailing",',
    '    "revenue": 150000,',
    '    "employees": 0,',
    '    "state": "MI",',
    '    "yearsInBusiness": 0,',
    '    "priorLosses": null,',
    '    "requestedLimit": null,',
    '    "hasBusinessVehicles": null,',
    '    "customerPropertyInCare": true,',
    '    "mobileEquipment": null,',
    '    "storesCustomerData": null,',
    '    "ownsOrLeasesProperty": null,',
    '    "higherLimitsDesired": null',
    '  }',
    '}',
    '',
    'Notes on the fields:',
    '- likelyMarketDirection is a non-binding directional guess only; the rules engine makes the real call later.',
    '- suggestedClassification MUST be an object with a "naicsCandidates" string array and a "notes" string — not a bare array.',
    '- naicsCandidates entries are plain strings like "811192 Car Washes".',
    '- parsedFacts numbers (revenue/employees/yearsInBusiness/requestedLimit): use the stated number or null. Use a 2-letter state code or "".',
    '- parsedFacts exposure flags are tri-state true/false/null:',
    '    hasBusinessVehicles (business owns/uses vehicles), customerPropertyInCare (customer vehicles/property in the business\'s care, custody, or control),',
    '    mobileEquipment (tools/equipment transported to job sites), storesCustomerData (stores customer data/payment info or uses online booking),',
    '    ownsOrLeasesProperty (owns/leases a building or significant business property), higherLimitsDesired (wants higher/excess limits).',
    '  Set true when stated or clearly typical for this business type, false when clearly not, and null when genuinely unclear. Do NOT invent specifics.',
    '',
    'Keep it concise and practical. Do not invent carrier names, pricing, or eligibility outcomes.',
  ].join('\n'),
};
