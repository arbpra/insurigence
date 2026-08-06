/**
 * Types for the Coverage Recommendations engine.
 *
 * Per the build direction: a structured rules library decides WHICH coverages
 * are recommended and at WHAT level — deterministically, from the risk's
 * exposures. AI is used later only to phrase the plain-English explanation. The
 * engine never invents coverages or levels.
 */

export type RecommendationLevel =
  | 'STRONGLY_RECOMMENDED'
  | 'RECOMMENDED'
  | 'CONSIDER'
  | 'NOT_TYPICALLY_NEEDED';

/** Sort weight — lower shows first (most important at top). */
export const LEVEL_ORDER: Record<RecommendationLevel, number> = {
  STRONGLY_RECOMMENDED: 0,
  RECOMMENDED: 1,
  CONSIDER: 2,
  NOT_TYPICALLY_NEEDED: 3,
};

/**
 * Exposure facts that drive coverage rules. All optional — the engine handles
 * unknowns conservatively (usually "CONSIDER" rather than asserting a need).
 * Booleans are tri-state via `undefined` = unknown.
 */
export interface RiskExposureFacts {
  industry?: string | null;
  revenue?: number | null;
  employees?: number | null;
  state?: string | null;
  yearsInBusiness?: number | null;
  priorLosses?: boolean | null;

  /** Business-owned or used vehicles. */
  hasBusinessVehicles?: boolean | null;
  /** Customer property (e.g. vehicles) in the business's care, custody, or control. */
  customerPropertyInCare?: boolean | null;
  /** Mobile tools/equipment transported to job sites. */
  mobileEquipment?: boolean | null;
  /** Stores customer data / payment info / uses online booking. */
  storesCustomerData?: boolean | null;
  /** Owns or leases a building / significant business personal property. */
  ownsOrLeasesProperty?: boolean | null;
  /** Insured wants higher/excess liability limits. */
  higherLimitsDesired?: boolean | null;
}

/** One recommended coverage in the output. */
export interface CoverageRecommendation {
  coverageName: string;
  recommendationLevel: RecommendationLevel;
  reason: string;
  agentExplanation: string;
  triggeringExposures: string[];
  crossSellOpportunity: boolean;
  disclaimer: string;
}

/** A coverage's rule in the library: evaluates facts → level + triggers. */
export interface CoverageRule {
  coverageName: string;
  /** Plain-English base explanation an agent can use with the insured. */
  agentExplanation: string;
  /** True when this line is typically a round-out/cross-sell rather than the primary line. */
  crossSell: boolean;
  /**
   * Deterministic evaluation. Returns the level, the exposures that triggered
   * it, and a short reason tied to the risk. Never asserts an absolute need.
   */
  evaluate: (facts: RiskExposureFacts) => {
    level: RecommendationLevel;
    triggeringExposures: string[];
    reason: string;
  };
}
