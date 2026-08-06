/**
 * Default Commercial GL intake form provisioned for a newly signed-up agency.
 *
 * Without an active COMMERCIAL_GL form, an agency cannot submit intakes
 * (app/api/intake/submit requires one), so self-signup provisions this so the
 * workspace is usable immediately. Mirrors the definition used by prisma/seed.ts.
 */
export const DEFAULT_COMMERCIAL_GL_FORM = {
  name: 'Commercial General Liability Application',
  lob: 'COMMERCIAL_GL' as const,
  definition: {
    version: '1.0',
    sections: [
      {
        id: 'business_info',
        title: 'Business Information',
        fields: [
          { id: 'companyName', type: 'text', label: 'Company Name', required: true },
          { id: 'yearsInBusiness', type: 'number', label: 'Years in Business', required: true },
          {
            id: 'industry',
            type: 'select',
            label: 'Industry',
            required: true,
            options: [
              'construction', 'manufacturing', 'retail', 'professional_services',
              'hospitality', 'healthcare', 'technology', 'other',
            ],
          },
          { id: 'annualRevenue', type: 'currency', label: 'Annual Revenue', required: true },
          { id: 'numberOfEmployees', type: 'number', label: 'Number of Employees', required: true },
        ],
      },
      {
        id: 'coverage_info',
        title: 'Coverage Information',
        fields: [
          {
            id: 'requestedLimits',
            type: 'select',
            label: 'Requested Limits',
            required: true,
            options: ['500000', '1000000', '2000000', '5000000'],
          },
          { id: 'effectiveDate', type: 'date', label: 'Requested Effective Date', required: true },
          { id: 'priorClaims', type: 'boolean', label: 'Any claims in the past 5 years?', required: true },
          {
            id: 'priorClaimsDetails',
            type: 'textarea',
            label: 'Claims Details',
            required: false,
            showIf: { field: 'priorClaims', value: true },
          },
        ],
      },
      {
        id: 'contact_info',
        title: 'Contact Information',
        fields: [
          { id: 'contactName', type: 'text', label: 'Contact Name', required: true },
          { id: 'contactEmail', type: 'email', label: 'Contact Email', required: true },
          { id: 'contactPhone', type: 'phone', label: 'Contact Phone', required: true },
          { id: 'additionalNotes', type: 'textarea', label: 'Additional Notes', required: false },
        ],
      },
    ],
  },
};
