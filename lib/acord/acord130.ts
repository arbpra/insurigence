import type { AcordFormSpec, AcordMapContext } from './types';
import { pick } from './util';

/**
 * ACORD 130 — Workers' Compensation Application (core subset).
 * WC is rated on payroll and is state-specific, so this captures payroll,
 * class/operations, and state rather than revenue. Fields not captured by the
 * current GL intake (payroll, class codes, experience mod) are left blank for
 * agent entry and flagged by required-field validation.
 */
export const acord130Spec: AcordFormSpec = {
  formType: 'ACORD_130',
  title: "ACORD 130 — Workers' Compensation Application",
  fields: [
    { key: 'namedInsured', label: 'Named Insured', section: 'Applicant', required: true },
    { key: 'fein', label: 'FEIN', section: 'Applicant' },
    { key: 'entityType', label: 'Entity Type', section: 'Applicant' },
    { key: 'effectiveDate', label: 'Proposed Effective Date', section: 'Applicant' },

    { key: 'state', label: 'State', section: 'Operations', required: true },
    { key: 'descriptionOfOperations', label: 'Nature of Business / Operations', section: 'Operations', required: true },
    { key: 'naics', label: 'NAICS', section: 'Operations' },

    { key: 'numberOfEmployees', label: 'Number of Employees', section: 'Payroll & Class' },
    { key: 'estimatedAnnualPayroll', label: 'Estimated Annual Payroll', section: 'Payroll & Class', required: true },
    { key: 'classCodes', label: 'Class Code(s)', section: 'Payroll & Class' },

    { key: 'experienceMod', label: 'Experience Modifier', section: 'Experience' },
    { key: 'priorCarrier', label: 'Prior Carrier', section: 'Experience' },
  ],
  map: ({ lead, answers }: AcordMapContext) => ({
    namedInsured: pick(answers, ['companyName', 'insuredName']) || lead.insuredName,
    fein: pick(answers, ['fein', 'taxId']),
    entityType: pick(answers, ['entityType', 'businessStructure', 'business_structure']),
    effectiveDate: pick(answers, ['effectiveDate', 'cov.effective_date']),

    state: pick(answers, ['state', 'ops.states', 'states_of_operation']),
    descriptionOfOperations: pick(answers, ['description', 'ops.description', 'additionalNotes']),
    naics: pick(answers, ['naics', 'naicsCode']),

    numberOfEmployees: pick(answers, ['numberOfEmployees', 'insured.employee_count']),
    estimatedAnnualPayroll: pick(answers, ['estimatedAnnualPayroll', 'annualPayroll', 'payroll']),
    classCodes: pick(answers, ['classCodes', 'wcClassCodes']),

    experienceMod: pick(answers, ['experienceMod', 'expMod']),
    priorCarrier: pick(answers, ['priorCarrier', 'currentCarrier']),
  }),
};
