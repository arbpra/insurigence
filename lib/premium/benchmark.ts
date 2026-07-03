import type { RiskFacts, PremiumBenchmark, Confidence } from './types';

/**
 * Deterministic Commercial GL premium-indication benchmark.
 *
 * This produces an ESTIMATED RANGE from general benchmarks — never an exact
 * premium and never a quote. GL is rated primarily on annual revenue (gross
 * sales) times a per-$1,000 rate that varies by class risk tier, adjusted for
 * market type, tenure, and loss history. If the essential inputs are missing,
 * it reports "insufficient" instead of guessing.
 */

/** Per-$1,000-revenue GL rate range by risk tier. Illustrative benchmarks. */
const TIER_RATES = {
  low: { lo: 1.5, hi: 4.0, label: 'lower-risk class' },
  medium: { lo: 4.0, hi: 9.0, label: 'medium-risk class' },
  high: { lo: 9.0, hi: 20.0, label: 'higher-risk class' },
  unknown: { lo: 3.0, hi: 12.0, label: 'unclassified (wide) range' },
} as const;

type Tier = keyof typeof TIER_RATES;

const HIGH_KEYWORDS = ['construction', 'roofing', 'contractor', 'framing', 'excavat', 'demolition', 'concrete', 'manufactur', 'welding', 'tree', 'scaffold'];
const MEDIUM_KEYWORDS = ['auto', 'detailing', 'cleaning', 'janitorial', 'landscap', 'lawn', 'hospitality', 'restaurant', 'food', 'salon', 'repair', 'warehouse', 'transport'];
const LOW_KEYWORDS = ['consult', 'professional', 'office', 'retail', 'technology', 'software', 'accounting', 'marketing', 'design', 'clerical', 'services'];

function classifyTier(industry?: string | null): Tier {
  if (!industry) return 'unknown';
  const s = industry.toLowerCase();
  if (HIGH_KEYWORDS.some((k) => s.includes(k))) return 'high';
  if (MEDIUM_KEYWORDS.some((k) => s.includes(k))) return 'medium';
  if (LOW_KEYWORDS.some((k) => s.includes(k))) return 'low';
  return 'unknown';
}

const MIN_PREMIUM = 500;

/** Round to a tidy value for an indication (nearest $100). */
function roundIndication(n: number): number {
  return Math.max(0, Math.round(n / 100) * 100);
}

function fmtMoney(n: number): string {
  return `$${n.toLocaleString('en-US')}`;
}

const STANDARD_PRICING_FACTORS = [
  'Carrier underwriting appetite',
  'Final class code',
  'Coverage limits and deductibles',
  'Loss history verification',
  'Inspection requirements',
  'Endorsements',
  'State-specific rating rules',
];

export function computePremiumIndication(facts: RiskFacts): PremiumBenchmark {
  const tier = classifyTier(facts.industry);
  const revenue = typeof facts.revenue === 'number' && facts.revenue > 0 ? facts.revenue : null;

  // Essential inputs for a GL indication: a revenue basis is required.
  if (revenue === null) {
    return {
      insufficient: true,
      factorsConsidered: [],
      factorsThatMayChangePricing: STANDARD_PRICING_FACTORS,
    };
  }

  const rate = TIER_RATES[tier];
  let low = (revenue / 1000) * rate.lo;
  let high = (revenue / 1000) * rate.hi;

  // Adjustment multipliers.
  let mult = 1;
  if (facts.marketType === 'EXCESS_SURPLUS') mult *= 1.3;
  else if (facts.marketType === 'BORDERLINE') mult *= 1.15;
  if (typeof facts.yearsInBusiness === 'number' && facts.yearsInBusiness < 3) mult *= 1.1;
  if (facts.priorLosses === true) mult *= 1.25;
  low *= mult;
  high *= mult;

  // Floors and sanity.
  low = Math.max(low, MIN_PREMIUM);
  high = Math.max(high, low * 1.4);

  const annualLow = roundIndication(low);
  const annualHigh = roundIndication(high);

  // Confidence from data completeness and class certainty.
  const known = [
    tier !== 'unknown',
    revenue !== null,
    Boolean(facts.state),
    typeof facts.yearsInBusiness === 'number',
    facts.priorLosses !== null && facts.priorLosses !== undefined,
  ].filter(Boolean).length;

  let confidence: Confidence = known >= 4 ? 'HIGH' : known >= 3 ? 'MEDIUM' : 'LOW';
  const downgrade = (c: Confidence): Confidence => (c === 'HIGH' ? 'MEDIUM' : 'LOW');
  if (tier === 'unknown') confidence = downgrade(confidence);
  if (facts.marketType === 'EXCESS_SURPLUS' || facts.marketType === 'BORDERLINE') {
    confidence = downgrade(confidence);
  }

  // Factors considered (only those actually present).
  const factorsConsidered: string[] = [];
  factorsConsidered.push(`Industry/class: ${facts.industry || 'not specified'} (${rate.label})`);
  factorsConsidered.push(`Annual revenue basis: ${fmtMoney(revenue)}`);
  if (typeof facts.employees === 'number') factorsConsidered.push(`Employees: ${facts.employees}`);
  if (facts.state) factorsConsidered.push(`State: ${facts.state}`);
  if (typeof facts.yearsInBusiness === 'number') factorsConsidered.push(`Years in business: ${facts.yearsInBusiness}`);
  if (facts.priorLosses !== null && facts.priorLosses !== undefined) {
    factorsConsidered.push(`Prior losses: ${facts.priorLosses ? 'yes' : 'none reported'}`);
  }
  if (facts.marketType) factorsConsidered.push(`Market type: ${facts.marketType.replace('_', ' & ').toLowerCase()}`);
  if (facts.coverages && facts.coverages.length) factorsConsidered.push(`Coverages: ${facts.coverages.join(', ')}`);
  if (typeof facts.requestedLimit === 'number') factorsConsidered.push(`Requested limit: ${fmtMoney(facts.requestedLimit)}`);

  return {
    insufficient: false,
    annualLow,
    annualHigh,
    confidence,
    basis: `General Liability indication rated on ${fmtMoney(revenue)} annual revenue (${rate.label}).`,
    factorsConsidered,
    factorsThatMayChangePricing: STANDARD_PRICING_FACTORS,
  };
}
