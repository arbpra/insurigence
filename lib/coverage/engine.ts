import { COVERAGE_LIBRARY } from './library';
import { COVERAGE_ITEM_DISCLAIMER } from './constants';
import { LEVEL_ORDER, type CoverageRecommendation, type RiskExposureFacts } from './types';

/**
 * Deterministically compute coverage recommendations from a risk's exposures.
 * Evaluates every rule in the library and returns the recommendations sorted by
 * level (most important first). AI is not involved — it only phrases the
 * explanations downstream.
 */
export function computeCoverageRecommendations(
  facts: RiskExposureFacts,
  opts: { includeNotNeeded?: boolean } = {}
): CoverageRecommendation[] {
  const recs: CoverageRecommendation[] = COVERAGE_LIBRARY.map((rule) => {
    const { level, triggeringExposures, reason } = rule.evaluate(facts);
    return {
      coverageName: rule.coverageName,
      recommendationLevel: level,
      reason,
      agentExplanation: rule.agentExplanation,
      triggeringExposures,
      crossSellOpportunity: rule.crossSell,
      disclaimer: COVERAGE_ITEM_DISCLAIMER,
    };
  });

  const filtered = opts.includeNotNeeded
    ? recs
    : recs.filter((r) => r.recommendationLevel !== 'NOT_TYPICALLY_NEEDED');

  return filtered.sort(
    (a, b) => LEVEL_ORDER[a.recommendationLevel] - LEVEL_ORDER[b.recommendationLevel]
  );
}

/**
 * Merge AI-refined plain-language explanations into deterministic recommendations.
 * ONLY the `agentExplanation` text is replaced — coverage names, levels,
 * triggering exposures, and cross-sell flags stay exactly as the engine decided.
 * Unknown/extra coverage names from the AI are ignored.
 */
export function applyAiExplanations(
  recs: CoverageRecommendation[],
  explanations: { coverageName: string; agentExplanation: string }[]
): CoverageRecommendation[] {
  const byName = new Map(
    explanations
      .filter((e) => e.coverageName && e.agentExplanation?.trim())
      .map((e) => [e.coverageName.trim().toLowerCase(), e.agentExplanation.trim()])
  );
  return recs.map((r) => {
    const refined = byName.get(r.coverageName.toLowerCase());
    return refined ? { ...r, agentExplanation: refined } : r;
  });
}
