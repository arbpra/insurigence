import prisma from '@/lib/prisma';
import { COVERAGE_ITEM_DISCLAIMER } from './constants';
import {
  LEVEL_ORDER,
  type CoverageRecommendation,
  type RecommendationLevel,
} from './types';

/**
 * Super-admin overrides applied on top of the deterministic engine output.
 * The engine decides levels from exposures (in code); these DB-backed configs
 * let non-developers enable/disable coverages, override the plain-English
 * explanation, and add custom coverages — without touching code.
 */

export interface CoverageConfig {
  coverageName: string;
  enabled: boolean;
  agentExplanation: string | null;
  isCustom: boolean;
  customLevel: string | null;
  customReason: string | null;
}

const LEVELS: RecommendationLevel[] = [
  'STRONGLY_RECOMMENDED',
  'RECOMMENDED',
  'CONSIDER',
  'NOT_TYPICALLY_NEEDED',
];

export async function loadCoverageConfigs(): Promise<CoverageConfig[]> {
  try {
    return await prisma.coverageRuleConfig.findMany();
  } catch {
    return [];
  }
}

/**
 * Apply configs to engine recommendations: drop disabled coverages, apply
 * explanation overrides, and append enabled custom coverages. Re-sorts by level.
 */
export function applyCoverageConfigs(
  recs: CoverageRecommendation[],
  configs: CoverageConfig[]
): CoverageRecommendation[] {
  const byName = new Map(configs.map((c) => [c.coverageName.toLowerCase(), c]));

  const out: CoverageRecommendation[] = recs
    .filter((r) => {
      const c = byName.get(r.coverageName.toLowerCase());
      return !c || c.enabled;
    })
    .map((r) => {
      const c = byName.get(r.coverageName.toLowerCase());
      return c?.agentExplanation ? { ...r, agentExplanation: c.agentExplanation } : r;
    });

  // Append custom coverages that aren't already present.
  for (const c of configs) {
    if (!c.isCustom || !c.enabled) continue;
    if (out.some((r) => r.coverageName.toLowerCase() === c.coverageName.toLowerCase())) continue;
    const level = (LEVELS as string[]).includes(c.customLevel ?? '')
      ? (c.customLevel as RecommendationLevel)
      : 'CONSIDER';
    out.push({
      coverageName: c.coverageName,
      recommendationLevel: level,
      reason: c.customReason || 'Custom coverage rule (agency-defined).',
      agentExplanation: c.agentExplanation || '',
      triggeringExposures: [],
      crossSellOpportunity: true,
      disclaimer: COVERAGE_ITEM_DISCLAIMER,
    });
  }

  return out.sort((a, b) => LEVEL_ORDER[a.recommendationLevel] - LEVEL_ORDER[b.recommendationLevel]);
}
