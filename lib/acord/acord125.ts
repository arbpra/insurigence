import type { AcordFormSpec, AcordMapContext } from './types';
import { pick } from './util';

/**
 * ACORD 125 — Commercial Insurance Application (core subset).
 * Covers the applicant, contact, premises, and nature-of-business sections that
 * we can populate from intake data today. More fields are added as intake
 * captures more; mapping stays deterministic.
 */
export const acord125Spec: AcordFormSpec = {
  formType: 'ACORD_125',
  title: 'ACORD 125 — Commercial Insurance Application',
  fields: [
    { key: 'producer', label: 'Producer / Agency', section: 'Producer' },

    { key: 'namedInsured', label: 'Named Insured', section: 'Applicant', required: true },
    { key: 'mailingAddress', label: 'Mailing Address', section: 'Applicant' },
    { key: 'businessPhone', label: 'Business Phone', section: 'Applicant' },
    { key: 'website', label: 'Website', section: 'Applicant' },
    { key: 'feinOrSSN', label: 'FEIN / SSN', section: 'Applicant' },
    { key: 'entityType', label: 'Entity Type', section: 'Applicant' },
    { key: 'yearsInBusiness', label: 'Years in Business', section: 'Applicant', required: true },
    { key: 'naics', label: 'NAICS', section: 'Applicant' },
    { key: 'sic', label: 'SIC', section: 'Applicant' },

    { key: 'contactName', label: 'Contact Name', section: 'Contact', required: true },
    { key: 'contactEmail', label: 'Contact Email', section: 'Contact', required: true },

    { key: 'premisesAddress', label: 'Premises Address', section: 'Premises' },

    { key: 'descriptionOfOperations', label: 'Description of Operations', section: 'Nature of Business', required: true },
    { key: 'annualRevenue', label: 'Annual Revenue / Gross Sales', section: 'Nature of Business', required: true },
    { key: 'numberOfEmployees', label: 'Number of Employees', section: 'Nature of Business' },
  ],
  map: ({ lead, answers, agency }: AcordMapContext) => ({
    producer: agency.name ?? '',

    namedInsured: pick(answers, ['companyName', 'insuredName']) || lead.insuredName,
    mailingAddress: pick(answers, ['address', 'mailingAddress', 'insured.address']),
    businessPhone: pick(answers, ['contactPhone', 'phone', 'businessPhone']),
    website: pick(answers, ['website']),
    feinOrSSN: pick(answers, ['fein', 'ssn', 'taxId']),
    entityType: pick(answers, ['entityType', 'businessStructure', 'business_structure']),
    yearsInBusiness: pick(answers, ['yearsInBusiness', 'insured.years_in_business']),
    naics: pick(answers, ['naics', 'naicsCode']),
    sic: pick(answers, ['sic', 'sicCode']),

    contactName: pick(answers, ['contactName', 'primaryContactName']),
    contactEmail: pick(answers, ['contactEmail']) || lead.primaryContactEmail || '',

    premisesAddress: pick(answers, ['premisesAddress', 'locationAddress', 'address', 'ops.primary_location']),

    descriptionOfOperations: pick(answers, ['description', 'ops.description', 'additionalNotes', 'operationsDescription']),
    annualRevenue: pick(answers, ['annualRevenue', 'fin.annual_revenue']),
    numberOfEmployees: pick(answers, ['numberOfEmployees', 'insured.employee_count']),
  }),
};
