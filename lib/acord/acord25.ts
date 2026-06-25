import type { AcordFormSpec, AcordMapContext } from './types';
import { pick } from './util';

/**
 * ACORD 25 — Certificate of Liability Insurance (core subset).
 * Producer, insured, certificate holder, coverage limits, and description.
 * Certificate-holder and policy specifics are typically filled by the agent (or
 * carried over from the COI Assistant) on the review screen.
 */
export const acord25Spec: AcordFormSpec = {
  formType: 'ACORD_25',
  title: 'ACORD 25 — Certificate of Liability Insurance',
  fields: [
    { key: 'producer', label: 'Producer / Agency', section: 'Producer' },

    { key: 'insuredName', label: 'Insured', section: 'Insured', required: true },
    { key: 'insuredAddress', label: 'Insured Address', section: 'Insured' },

    { key: 'certificateHolder', label: 'Certificate Holder', section: 'Certificate Holder', required: true },

    { key: 'glEachOccurrence', label: 'GL Each Occurrence', section: 'Coverages' },
    { key: 'glAggregate', label: 'GL General Aggregate', section: 'Coverages' },
    { key: 'autoLimit', label: 'Automobile Liability Limit', section: 'Coverages' },
    { key: 'umbrellaLimit', label: 'Umbrella / Excess Limit', section: 'Coverages' },
    { key: 'workersComp', label: "Workers' Compensation", section: 'Coverages' },

    { key: 'descriptionOfOperations', label: 'Description of Operations', section: 'Description', required: true },
  ],
  map: ({ lead, answers, agency }: AcordMapContext) => ({
    producer: agency.name ?? '',

    insuredName: pick(answers, ['companyName', 'insuredName']) || lead.insuredName,
    insuredAddress: pick(answers, ['address', 'mailingAddress', 'insured.address']),

    certificateHolder: pick(answers, ['certificateHolder']),

    glEachOccurrence: pick(answers, ['requestedLimits', 'cov.gl_limits', 'glLimits']),
    glAggregate: pick(answers, ['glAggregate']),
    autoLimit: pick(answers, ['autoLimit']),
    umbrellaLimit: pick(answers, ['umbrellaLimit']),
    workersComp: pick(answers, ['workersComp']),

    descriptionOfOperations: pick(answers, ['description', 'ops.description', 'additionalNotes']),
  }),
};
