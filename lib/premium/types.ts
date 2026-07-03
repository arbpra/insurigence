/**
 * Types for the Premium Indication benchmark engine.
 *
 * Per the AI build direction, the *number* is computed by deterministic
 * rules/benchmarks here — AI never invents pricing. AI is used only to explain
 * the computed range in plain language.
 */

export type MarketType = 'STANDARD' | 'EXCESS_SURPLUS' | 'BORDERLINE';
export type Confidence = 'LOW' | 'MEDIUM' | 'HIGH';

/** Structured facts a premium indication is computed from. */
export interface RiskFacts {
  industry?: string | null;
  revenue?: number | null; // annual gross sales, USD
  employees?: number | null;
  state?: string | null;
  yearsInBusiness?: number | null;
  priorLosses?: boolean | null;
  marketType?: MarketType | null;
  coverages?: string[];
  requestedLimit?: number | null;
}

/** Deterministic output of the benchmark engine (before AI explanation). */
export interface PremiumBenchmark {
  /** True when data is too weak to produce a reliable indication. */
  insufficient: boolean;
  annualLow?: number;
  annualHigh?: number;
  confidence?: Confidence;
  /** Short description of what the indication is based on. */
  basis?: string;
  /** Human-readable factors that drove the range. */
  factorsConsidered: string[];
  /** Standard factors that could move final pricing. */
  factorsThatMayChangePricing: string[];
}
