/**
 * Prompt registry. Central export point for all feature prompts so the rest of
 * the app imports from one place (`@/lib/ai/prompts`). New features add their
 * PromptDefinition here as they are built.
 */
export type { PromptDefinition } from './types';
export { smartIntakePrompt } from './smartIntake';
export { quickRiskGuidePrompt } from './quickRiskGuide';
export { premiumExplanationPrompt } from './premiumExplanation';
export { coverageRecommendationExplanationPrompt } from './coverageRecommendationExplanation';
export { coverageExplanationPrompt } from './coverageExplanation';
export { coverageBreakdownPrompt } from './coverageBreakdown';
export { recommendationRationalePrompt } from './recommendationRationale';
export { proposalLanguagePrompt } from './proposalLanguage';
export { documentSummaryPrompt } from './documentSummary';
export { coiDraftPrompt } from './coiDraft';
