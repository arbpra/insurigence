import type { RiskExposureFacts } from './types';

/**
 * Deterministically build coverage exposure facts from stored intake answers.
 *
 * No AI: explicit intake fields are read directly, and a few exposures are
 * conservatively inferred by keyword-scanning the free-text description. A
 * keyword match sets the flag true; the absence of a keyword leaves it null
 * (unknown), so the engine stays conservative (→ "Consider" rather than asserting
 * a need). This keeps the formal Evaluation engine fully deterministic.
 */

function pick(answers: Record<string, unknown>, keys: string[]): unknown {
  for (const k of keys) {
    const v = answers[k];
    if (v !== undefined && v !== null && String(v).trim?.() !== '') return v;
  }
  return undefined;
}

function toNum(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string') {
    const n = parseFloat(v.replace(/[$,\s]/g, ''));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function toBool(v: unknown): boolean | null {
  if (v === true || v === false) return v;
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase();
    if (['true', 'yes', 'y'].includes(s)) return true;
    if (['false', 'no', 'n'].includes(s)) return false;
  }
  return null;
}

/** Infer an exposure from description text; true on match, else keep prior/unknown. */
function inferFromText(text: string, patterns: RegExp[]): boolean | null {
  return patterns.some((re) => re.test(text)) ? true : null;
}

export function buildExposureFactsFromIntake(answers: Record<string, unknown>): RiskExposureFacts {
  const industry = String(pick(answers, ['industry', 'ops.industry_primary', 'businessType']) ?? '') || null;
  const states = pick(answers, ['ops.states', 'states_of_operation']);
  const state =
    (Array.isArray(states) ? String(states[0] ?? '') : String(pick(answers, ['state']) ?? '')) || null;

  const description = String(
    pick(answers, ['description', 'ops.description', 'additionalNotes', 'operationsDescription']) ?? ''
  ).toLowerCase();

  // Explicit exposure fields take priority; otherwise infer from the description.
  const explicit = {
    hasBusinessVehicles: toBool(pick(answers, ['hasBusinessVehicles'])),
    customerPropertyInCare: toBool(pick(answers, ['customerPropertyInCare'])),
    mobileEquipment: toBool(pick(answers, ['mobileEquipment'])),
    storesCustomerData: toBool(pick(answers, ['storesCustomerData'])),
    ownsOrLeasesProperty: toBool(pick(answers, ['ownsOrLeasesProperty', 'ownsProperty'])),
  };

  return {
    industry,
    revenue: toNum(pick(answers, ['annualRevenue', 'fin.annual_revenue'])),
    employees: toNum(pick(answers, ['numberOfEmployees', 'insured.employee_count'])),
    state,
    yearsInBusiness: toNum(pick(answers, ['yearsInBusiness', 'insured.years_in_business'])),
    priorLosses: toBool(pick(answers, ['priorClaims', 'loss.any_5yr'])),

    hasBusinessVehicles:
      explicit.hasBusinessVehicles ??
      inferFromText(description, [/\b(company|business|owned|fleet)\b.{0,20}\b(vehicle|auto|truck|van|car)/, /\bdelivery\b/, /\bfleet\b/]),
    customerPropertyInCare:
      explicit.customerPropertyInCare ??
      inferFromText(description, [/customer.{0,25}(vehicle|car|property|equipment)/, /care,? custody/, /valet|storage of customer/]),
    mobileEquipment:
      explicit.mobileEquipment ??
      inferFromText(description, [/\bmobile\b/, /on-?site|job ?site/, /(tools|equipment).{0,20}(transport|site|truck)/]),
    storesCustomerData:
      explicit.storesCustomerData ??
      inferFromText(description, [
        /e-?commerce|customer data|payment|credit card|website|\bapp\b/,
        /book\w*\s+online|online\s+book|online\s+(scheduling|payment|order)|schedul\w*\s+online/,
      ]),
    ownsOrLeasesProperty:
      explicit.ownsOrLeasesProperty ??
      inferFromText(description, [/own.{0,10}(building|property)|lease.{0,10}(space|building)|storefront|warehouse|premises/]),
    higherLimitsDesired: toBool(pick(answers, ['higherLimitsDesired'])),
  };
}
