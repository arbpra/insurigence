import type { AcordFormSpec, AcordMapContext } from './types';
import { pick } from './util';

/**
 * ACORD 140 — Property Section (core subset).
 * Premises, building characteristics, and property coverage amounts. Many fields
 * are not captured by the current GL intake and will be blank for agent entry.
 */
export const acord140Spec: AcordFormSpec = {
  formType: 'ACORD_140',
  title: 'ACORD 140 — Property Section',
  fields: [
    { key: 'namedInsured', label: 'Named Insured', section: 'Applicant', required: true },

    { key: 'premisesAddress', label: 'Premises Address', section: 'Premises', required: true },
    { key: 'occupancy', label: 'Occupancy', section: 'Premises' },

    { key: 'constructionType', label: 'Construction Type', section: 'Building' },
    { key: 'yearBuilt', label: 'Year Built', section: 'Building' },
    { key: 'squareFootage', label: 'Total Area (sq ft)', section: 'Building' },

    { key: 'buildingLimit', label: 'Building Limit', section: 'Coverage' },
    { key: 'contentsLimit', label: 'Business Personal Property Limit', section: 'Coverage' },
    { key: 'deductible', label: 'Deductible', section: 'Coverage' },
  ],
  map: ({ lead, answers }: AcordMapContext) => ({
    namedInsured: pick(answers, ['companyName', 'insuredName']) || lead.insuredName,

    premisesAddress: pick(answers, ['premisesAddress', 'locationAddress', 'address', 'ops.primary_location']),
    occupancy: pick(answers, ['occupancy', 'industry', 'ops.industry_primary']),

    constructionType: pick(answers, ['constructionType', 'construction']),
    yearBuilt: pick(answers, ['yearBuilt']),
    squareFootage: pick(answers, ['squareFootage', 'totalArea', 'squareFeet']),

    buildingLimit: pick(answers, ['buildingLimit', 'buildingValue']),
    contentsLimit: pick(answers, ['contentsLimit', 'bppLimit', 'businessPersonalProperty']),
    deductible: pick(answers, ['propertyDeductible', 'deductible']),
  }),
};
