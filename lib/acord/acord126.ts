import type { AcordFormSpec, AcordMapContext } from './types';
import { pick } from './util';

/**
 * ACORD 126 — Commercial General Liability Section (core subset).
 * Captures GL limits, classification, and operations from intake data.
 */
export const acord126Spec: AcordFormSpec = {
  formType: 'ACORD_126',
  title: 'ACORD 126 — Commercial General Liability Section',
  fields: [
    { key: 'namedInsured', label: 'Named Insured', section: 'Applicant', required: true },
    { key: 'effectiveDate', label: 'Effective Date', section: 'Applicant' },

    { key: 'requestedLimits', label: 'Requested Limits (Each Occ / Aggregate)', section: 'Coverage' },
    { key: 'medicalExpense', label: 'Medical Expense Limit', section: 'Coverage' },
    { key: 'damageToRentedPremises', label: 'Damage to Rented Premises', section: 'Coverage' },

    { key: 'classification', label: 'Classification / Industry', section: 'Classification', required: true },
    { key: 'naics', label: 'NAICS', section: 'Classification' },
    { key: 'annualGrossSales', label: 'Annual Gross Sales', section: 'Classification' },

    { key: 'subcontractorsUsed', label: 'Subcontractors Used', section: 'Operations' },
    { key: 'descriptionOfOperations', label: 'Description of Operations', section: 'Operations', required: true },
  ],
  map: ({ lead, answers }: AcordMapContext) => ({
    namedInsured: pick(answers, ['companyName', 'insuredName']) || lead.insuredName,
    effectiveDate: pick(answers, ['effectiveDate', 'cov.effective_date']),

    requestedLimits: pick(answers, ['requestedLimits', 'cov.gl_limits', 'glLimits']),
    medicalExpense: pick(answers, ['medicalExpense', 'medExp']),
    damageToRentedPremises: pick(answers, ['damageToRentedPremises']),

    classification: pick(answers, ['industry', 'ops.industry_primary', 'classification']),
    naics: pick(answers, ['naics', 'naicsCode']),
    annualGrossSales: pick(answers, ['annualRevenue', 'fin.annual_revenue']),

    subcontractorsUsed: pick(answers, ['subcontractorsUsed', 'ops.subcontractors.used']),
    descriptionOfOperations: pick(answers, ['description', 'ops.description', 'additionalNotes']),
  }),
};
