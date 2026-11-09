/**
 * The agency's "New request" form: which request types an agency may send,
 * what each one is for, and how the form becomes the API body. Pure — safe for
 * server and browser. The server checks everything again (lib/desk/tasks.ts).
 */
import type { TaskComplexity, TaskType } from '@prisma/client';
import { TASK_TYPE_LABELS } from './service-levels';

export const REQUEST_TITLE_MAX = 200;
export const REQUEST_DETAILS_MAX = 10_000;

/**
 * The types an agency may send, in the order the form lists them. QA review is
 * an internal step of the Desk team's own process, not something an agency asks for.
 */
export const AGENCY_REQUEST_TYPES: readonly { type: TaskType; label: string; hint: string }[] = [
  { type: 'COI', hint: 'A certificate of insurance for a certificate holder.' },
  { type: 'ENDORSEMENT', hint: 'A change to a policy: add or remove a vehicle, driver, location or insured.' },
  { type: 'POLICY_UPDATE', hint: 'Update policy details such as an address, contact or named insured.' },
  { type: 'AMS_ENTRY', hint: 'Enter or correct information in your AMS.' },
  { type: 'ACORD', hint: 'Complete an ACORD form.' },
  { type: 'DOCUMENT_UPLOAD', hint: 'File documents to the account or your AMS.' },
  { type: 'LOSS_RUNS', hint: 'Request loss runs from a carrier.' },
  { type: 'RENEWAL', hint: 'Prepare an upcoming renewal.' },
  { type: 'REMARKETING', hint: 'Shop the account with other carriers.' },
  { type: 'NEW_BUSINESS', hint: 'Set up a new client or new line of coverage.' },
  { type: 'SUBMISSION', hint: 'Prepare and send a submission to carriers.' },
  { type: 'PROPOSAL_PREP', hint: 'Prepare a proposal for the client.' },
  { type: 'OTHER', hint: 'Anything else. Describe what you need in the details.' },
].map((t) => ({ ...t, type: t.type as TaskType, label: TASK_TYPE_LABELS[t.type as TaskType] }));

export const agencyMaySend = (type: unknown): type is TaskType =>
  AGENCY_REQUEST_TYPES.some((t) => t.type === type);

export const COMPLEXITY_HINTS: Record<TaskComplexity, string> = {
  STANDARD: 'A routine request with everything needed included.',
  COMPLEX: 'Several locations, vehicles or holders, special wording, or work across policies.',
};

export interface RequestFormValues {
  /** '' while no account is chosen; null when the request isn't about one account. */
  insuredId: string | null;
  policyId: string;
  type: TaskType | '';
  complexity: TaskComplexity;
  title: string;
  description: string;
}

export const blankRequest = (insuredId: string | null = ''): RequestFormValues => ({
  insuredId, policyId: '', type: '', complexity: 'STANDARD', title: '', description: '',
});

/** A short title the form offers until the user types their own, e.g. "COI – Acme LLC". */
export function suggestedTitle(type: TaskType | '', accountName: string | null): string {
  if (!type) return '';
  const label = TASK_TYPE_LABELS[type];
  return (accountName ? `${label} – ${accountName}` : label).slice(0, REQUEST_TITLE_MAX);
}

/** What still has to be filled in before the form can be sent; empty when it's ready. */
export function missingFields(f: RequestFormValues): string[] {
  const missing: string[] = [];
  if (f.insuredId === '') missing.push('Choose an account, or say the request is not about one account.');
  if (!f.type) missing.push('Choose a request type.');
  if (!f.title.trim()) missing.push('Give the request a title.');
  if (f.title.trim().length > REQUEST_TITLE_MAX) missing.push(`Keep the title to ${REQUEST_TITLE_MAX} characters.`);
  if (f.description.trim().length > REQUEST_DETAILS_MAX) missing.push(`Keep the details to ${REQUEST_DETAILS_MAX.toLocaleString('en-US')} characters.`);
  return missing;
}

/** The body for POST /api/desk/tasks. Blank optional fields are left out. */
export function requestPayload(f: RequestFormValues) {
  return {
    type: f.type,
    title: f.title.trim(),
    complexity: f.complexity,
    ...(f.description.trim() ? { description: f.description.trim() } : {}),
    ...(f.insuredId ? { insuredId: f.insuredId } : {}),
    ...(f.insuredId && f.policyId ? { policyId: f.policyId } : {}),
  };
}

/** Whether leaving the page would lose something the user entered. */
export const requestDirty = (f: RequestFormValues, start: RequestFormValues) =>
  f.type !== start.type || f.title.trim() !== '' || f.description.trim() !== '' || f.policyId !== start.policyId
  || f.complexity !== start.complexity || f.insuredId !== start.insuredId;
