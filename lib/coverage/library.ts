import type { CoverageRule, RiskExposureFacts } from './types';

/**
 * Structured coverage rules library.
 *
 * This is the single place coverage recommendations are decided. Each entry's
 * `evaluate` maps the risk's exposures to a recommendation level, the triggering
 * exposures, and a short reason. Edit/add rules here over time (a DB-backed
 * admin editor can replace this later without changing the engine).
 *
 * Language guardrails: reasons use soft phrasing ("may", "commonly recommended",
 * "should consider") and never assert an absolute need or guarantee coverage.
 */

/** Tri-state helper: true only when explicitly true. */
const yes = (v: boolean | null | undefined) => v === true;
/** True when explicitly false. */
const no = (v: boolean | null | undefined) => v === false;

export const COVERAGE_LIBRARY: CoverageRule[] = [
  {
    coverageName: 'General Liability',
    crossSell: false,
    agentExplanation:
      'General Liability helps cover third-party bodily injury and property damage claims arising from your operations, premises, or products.',
    evaluate: () => ({
      level: 'STRONGLY_RECOMMENDED',
      triggeringExposures: ['customer_facing_operations', 'premises_liability'],
      reason:
        'Most commercial operations have general third-party bodily injury and property damage exposure, so GL is commonly recommended as the foundation.',
    }),
  },
  {
    coverageName: 'Garagekeepers',
    crossSell: true,
    agentExplanation:
      'Garagekeepers coverage helps protect customer vehicles while they are in your possession for service, detailing, storage, or repair.',
    evaluate: (f: RiskExposureFacts) => {
      if (yes(f.customerPropertyInCare)) {
        return {
          level: 'STRONGLY_RECOMMENDED',
          triggeringExposures: ['customer_vehicles', 'care_custody_control'],
          reason:
            'Customer vehicles or property may be in the business’s care, custody, or control, which GL typically excludes.',
        };
      }
      if (no(f.customerPropertyInCare)) {
        return { level: 'NOT_TYPICALLY_NEEDED', triggeringExposures: [], reason: 'No customer property in care, custody, or control indicated.' };
      }
      return {
        level: 'CONSIDER',
        triggeringExposures: ['care_custody_control'],
        reason: 'If the business handles or stores customer vehicles/property, this gap should be considered.',
      };
    },
  },
  {
    coverageName: 'Workers Compensation',
    crossSell: true,
    agentExplanation:
      'Workers Compensation helps cover medical costs and lost wages for employees injured on the job, and is required by most states once you have employees.',
    evaluate: (f: RiskExposureFacts) => {
      const emp = f.employees;
      if (typeof emp === 'number' && emp > 0) {
        return {
          level: 'RECOMMENDED',
          triggeringExposures: ['employees'],
          reason: 'The business appears to have employees; state law commonly requires Workers Compensation.',
        };
      }
      if (emp === 0) {
        return { level: 'NOT_TYPICALLY_NEEDED', triggeringExposures: [], reason: 'No employees indicated.' };
      }
      return { level: 'CONSIDER', triggeringExposures: ['employees'], reason: 'If the business has any employees, Workers Compensation should be considered (often required by state).' };
    },
  },
  {
    coverageName: 'Commercial Auto',
    crossSell: true,
    agentExplanation:
      'Commercial Auto helps cover liability and physical damage for vehicles owned or used in the business.',
    evaluate: (f: RiskExposureFacts) => {
      if (yes(f.hasBusinessVehicles)) {
        return { level: 'RECOMMENDED', triggeringExposures: ['business_vehicles'], reason: 'The business appears to own or use vehicles for operations.' };
      }
      if (no(f.hasBusinessVehicles)) {
        return { level: 'NOT_TYPICALLY_NEEDED', triggeringExposures: [], reason: 'No business-owned or used vehicles indicated.' };
      }
      return { level: 'CONSIDER', triggeringExposures: ['business_vehicles'], reason: 'If any vehicles are used for business, Commercial Auto should be considered.' };
    },
  },
  {
    coverageName: 'Commercial Property',
    crossSell: true,
    agentExplanation:
      'Commercial Property helps cover the business’s building, equipment, inventory, and other business personal property against covered losses.',
    evaluate: (f: RiskExposureFacts) => {
      if (yes(f.ownsOrLeasesProperty)) {
        return { level: 'RECOMMENDED', triggeringExposures: ['owned_or_leased_property', 'business_personal_property'], reason: 'The business appears to own or lease property or hold significant business personal property.' };
      }
      return { level: 'CONSIDER', triggeringExposures: ['business_personal_property'], reason: 'If the business owns equipment, inventory, or leasehold improvements, property coverage should be considered.' };
    },
  },
  {
    coverageName: 'Inland Marine',
    crossSell: true,
    agentExplanation:
      'Inland Marine helps cover tools, equipment, and property while in transit or away from a fixed location — gaps standard property policies often leave.',
    evaluate: (f: RiskExposureFacts) => {
      if (yes(f.mobileEquipment)) {
        return { level: 'CONSIDER', triggeringExposures: ['mobile_equipment', 'tools_in_transit'], reason: 'Mobile tools or equipment may be transported, which standard property coverage often excludes.' };
      }
      return { level: 'NOT_TYPICALLY_NEEDED', triggeringExposures: [], reason: 'No mobile equipment/tools in transit indicated.' };
    },
  },
  {
    coverageName: 'Cyber',
    crossSell: true,
    agentExplanation:
      'Cyber coverage helps with costs from data breaches, ransomware, and other cyber incidents — relevant when handling customer data, payments, or online systems.',
    evaluate: (f: RiskExposureFacts) => {
      if (yes(f.storesCustomerData)) {
        return { level: 'CONSIDER', triggeringExposures: ['customer_data', 'payment_data', 'online_booking'], reason: 'The business may store customer data, payment information, or use online booking, creating cyber exposure.' };
      }
      return { level: 'NOT_TYPICALLY_NEEDED', triggeringExposures: [], reason: 'No significant customer-data, payment, or online-system exposure indicated.' };
    },
  },
  {
    coverageName: 'EPLI',
    crossSell: true,
    agentExplanation:
      'Employment Practices Liability (EPLI) helps cover claims from employees such as wrongful termination, discrimination, or harassment.',
    evaluate: (f: RiskExposureFacts) => {
      const emp = f.employees;
      if (typeof emp === 'number' && emp > 0) {
        return { level: 'CONSIDER', triggeringExposures: ['employees', 'employment_practices'], reason: 'With employees, employment-practices claims are possible and EPLI may be appropriate.' };
      }
      return { level: 'NOT_TYPICALLY_NEEDED', triggeringExposures: [], reason: 'No employees indicated.' };
    },
  },
  {
    coverageName: 'Umbrella',
    crossSell: true,
    agentExplanation:
      'Umbrella (Excess Liability) adds an extra layer of liability limits above your underlying policies for larger claims.',
    evaluate: (f: RiskExposureFacts) => {
      if (yes(f.higherLimitsDesired)) {
        return { level: 'RECOMMENDED', triggeringExposures: ['higher_limits'], reason: 'Higher liability limits are desired; an umbrella can extend limits cost-effectively.' };
      }
      return { level: 'CONSIDER', triggeringExposures: ['higher_limits'], reason: 'If higher liability limits may be needed (e.g., for contracts or larger exposures), an umbrella should be considered.' };
    },
  },
];

/** All coverage names in the library (for the agent's "add coverage" picker). */
export const COVERAGE_NAMES = COVERAGE_LIBRARY.map((c) => c.coverageName);

