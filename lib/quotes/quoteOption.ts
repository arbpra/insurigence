/**
 * Shared parsing, validation, and serialization for QuoteOption.
 *
 * The API routes stay thin: they handle auth and HTTP, and delegate the shape of
 * a quote option to this module so create and update cannot drift apart.
 */

import { Prisma, type QuoteOption } from '@prisma/client';
import { toCents, fromCents, computeTotalCents } from './money';

/**
 * What a Json? column accepts on write. On MongoDB a nullable Json field is
 * cleared with a plain null (the DbNull sentinel is a PostgreSQL-only concern,
 * where SQL NULL and JSON null are different values).
 */
type JsonInput = Prisma.InputJsonValue | null;

/** Field-length caps. Generous for real use, tight enough to bound payload size. */
const MAX_TEXT = 500;
const MAX_NOTES = 5000;
const MAX_JSON_ITEMS = 100;

export class QuoteValidationError extends Error {}

/** A quote option as it appears on the wire: BigInt cents become dollar numbers. */
export interface QuoteOptionDTO {
  id: string;
  leadId: string;
  agencyId: string;
  carrierId: string | null;
  optionLabel: string | null;
  carrierName: string | null;
  programName: string | null;
  lineOfBusiness: string | null;
  policyType: string | null;
  effectiveDate: string | null;
  expirationDate: string | null;
  quoteExpirationDate: string | null;
  premiumAnnual: number | null;
  taxes: number | null;
  fees: number | null;
  totalAnnual: number | null;
  paymentPlan: string | null;
  coverages: unknown;
  limits: unknown;
  deductibles: unknown;
  endorsements: unknown;
  exclusions: unknown;
  notes: string | null;
  documentName: string | null;
  documentSize: number | null;
  documentContentType: string | null;
  documentUploadedAt: string | null;
  /** True when a document is attached. The object key itself never leaves the server. */
  hasDocument: boolean;
  isRecommended: boolean;
  recommendationRationale: string | null;
  /** True while the rationale is an unedited AI draft. */
  rationaleAiDrafted: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export function serializeQuoteOption(q: QuoteOption): QuoteOptionDTO {
  return {
    id: q.id,
    leadId: q.leadId,
    agencyId: q.agencyId,
    carrierId: q.carrierId,
    optionLabel: q.optionLabel,
    carrierName: q.carrierName,
    programName: q.programName,
    lineOfBusiness: q.lineOfBusiness,
    policyType: q.policyType,
    effectiveDate: q.effectiveDate?.toISOString() ?? null,
    expirationDate: q.expirationDate?.toISOString() ?? null,
    quoteExpirationDate: q.quoteExpirationDate?.toISOString() ?? null,
    premiumAnnual: fromCents(q.premiumAnnualCents),
    taxes: fromCents(q.taxesCents),
    fees: fromCents(q.feesCents),
    totalAnnual: fromCents(q.totalAnnualCents),
    paymentPlan: q.paymentPlan,
    coverages: q.coverages ?? null,
    limits: q.limits ?? null,
    deductibles: q.deductibles ?? null,
    endorsements: q.endorsements ?? null,
    exclusions: q.exclusions ?? null,
    notes: q.notes,
    documentName: q.documentName,
    documentSize: q.documentSize,
    documentContentType: q.documentContentType,
    documentUploadedAt: q.documentUploadedAt?.toISOString() ?? null,
    hasDocument: Boolean(q.documentKey),
    isRecommended: q.isRecommended,
    recommendationRationale: q.recommendationRationale,
    rationaleAiDrafted: q.rationaleAiDrafted,
    sortOrder: q.sortOrder,
    createdAt: q.createdAt.toISOString(),
    updatedAt: q.updatedAt.toISOString(),
  };
}

function text(value: unknown, field: string, max = MAX_TEXT): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string') throw new QuoteValidationError(`${field} must be text`);
  const trimmed = value.trim();
  if (trimmed === '') return null;
  if (trimmed.length > max) {
    throw new QuoteValidationError(`${field} must be ${max} characters or fewer`);
  }
  return trimmed;
}

function date(value: unknown, field: string): Date | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string' && !(value instanceof Date)) {
    throw new QuoteValidationError(`${field} must be a date`);
  }
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new QuoteValidationError(`${field} is not a valid date`);
  }
  return parsed;
}

function money(value: unknown, field: string): bigint | null {
  try {
    return toCents(value);
  } catch (err) {
    throw new QuoteValidationError(`${field}: ${(err as Error).message}`);
  }
}

/** Bound arbitrary JSON so a caller cannot post an unbounded blob. */
function json(value: unknown, field: string): JsonInput {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value) && value.length > MAX_JSON_ITEMS) {
    throw new QuoteValidationError(`${field} cannot have more than ${MAX_JSON_ITEMS} entries`);
  }
  if (typeof value === 'object' && Object.keys(value as object).length > MAX_JSON_ITEMS) {
    throw new QuoteValidationError(`${field} cannot have more than ${MAX_JSON_ITEMS} entries`);
  }
  return value as Prisma.InputJsonValue;
}

export interface ParsedQuoteOption {
  optionLabel: string | null;
  carrierId: string | null;
  carrierName: string | null;
  programName: string | null;
  lineOfBusiness: 'COMMERCIAL_GL' | null;
  policyType: string | null;
  effectiveDate: Date | null;
  expirationDate: Date | null;
  quoteExpirationDate: Date | null;
  premiumAnnualCents: bigint | null;
  taxesCents: bigint | null;
  feesCents: bigint | null;
  totalAnnualCents: bigint | null;
  paymentPlan: string | null;
  coverages: JsonInput;
  limits: JsonInput;
  deductibles: JsonInput;
  endorsements: JsonInput;
  exclusions: JsonInput;
  notes: string | null;
  recommendationRationale: string | null;
  rationaleAiDrafted: boolean;
}

/**
 * Validate and normalise a quote-option payload.
 *
 * `partial` is true for PATCH: only the keys actually present are returned, so an
 * update never blanks a field the caller did not mention.
 */
export function parseQuoteOptionInput(
  body: Record<string, unknown>,
  { partial = false }: { partial?: boolean } = {}
): Partial<ParsedQuoteOption> {
  const has = (k: string) => !partial || Object.prototype.hasOwnProperty.call(body, k);
  const out: Partial<ParsedQuoteOption> = {};

  if (has('optionLabel')) out.optionLabel = text(body.optionLabel, 'Option label');
  if (has('carrierId')) out.carrierId = text(body.carrierId, 'Carrier');
  if (has('carrierName')) out.carrierName = text(body.carrierName, 'Carrier name');
  if (has('programName')) out.programName = text(body.programName, 'Program name');
  if (has('policyType')) out.policyType = text(body.policyType, 'Policy type');
  if (has('paymentPlan')) out.paymentPlan = text(body.paymentPlan, 'Payment plan');
  if (has('notes')) out.notes = text(body.notes, 'Notes', MAX_NOTES);

  // An agent editing the rationale clears the AI-draft flag: the words are
  // theirs now, so it no longer needs review. Decided here rather than trusting
  // a client-supplied flag.
  if (has('recommendationRationale')) {
    out.recommendationRationale = text(body.recommendationRationale, 'Recommendation', MAX_NOTES);
    out.rationaleAiDrafted = false;
  }

  if (has('lineOfBusiness')) {
    const lob = text(body.lineOfBusiness, 'Line of business');
    if (lob !== null && lob !== 'COMMERCIAL_GL') {
      throw new QuoteValidationError('Line of business must be COMMERCIAL_GL');
    }
    out.lineOfBusiness = lob as 'COMMERCIAL_GL' | null;
  }

  if (has('effectiveDate')) out.effectiveDate = date(body.effectiveDate, 'Effective date');
  if (has('expirationDate')) out.expirationDate = date(body.expirationDate, 'Expiration date');
  if (has('quoteExpirationDate')) {
    out.quoteExpirationDate = date(body.quoteExpirationDate, 'Quote expiration date');
  }

  if (out.effectiveDate && out.expirationDate && out.expirationDate <= out.effectiveDate) {
    throw new QuoteValidationError('Expiration date must be after the effective date');
  }

  if (has('premiumAnnual')) out.premiumAnnualCents = money(body.premiumAnnual, 'Annual premium');
  if (has('taxes')) out.taxesCents = money(body.taxes, 'Taxes');
  if (has('fees')) out.feesCents = money(body.fees, 'Fees');

  // An explicit total wins; otherwise derive it from the parts. `undefined` has
  // to be excluded explicitly: without it, a payload that simply omits
  // totalAnnual takes this branch and resolves to null instead of the sum.
  const totalProvided =
    has('totalAnnual') &&
    body.totalAnnual !== null &&
    body.totalAnnual !== undefined &&
    body.totalAnnual !== '';

  if (totalProvided) {
    out.totalAnnualCents = money(body.totalAnnual, 'Total annual cost');
  } else if (has('premiumAnnual') || has('taxes') || has('fees')) {
    out.totalAnnualCents = computeTotalCents(
      out.premiumAnnualCents ?? null,
      out.taxesCents ?? null,
      out.feesCents ?? null
    );
  }

  if (has('coverages')) out.coverages = json(body.coverages, 'Coverages');
  if (has('limits')) out.limits = json(body.limits, 'Limits');
  if (has('deductibles')) out.deductibles = json(body.deductibles, 'Deductibles');
  if (has('endorsements')) out.endorsements = json(body.endorsements, 'Endorsements');
  if (has('exclusions')) out.exclusions = json(body.exclusions, 'Exclusions');

  return out;
}

/**
 * Every option needs something to identify the carrier, otherwise the comparison
 * table has a nameless column and the insured cannot tell the options apart.
 */
export function assertIdentifiable(parsed: Partial<ParsedQuoteOption>): void {
  if (!parsed.carrierId && !parsed.carrierName) {
    throw new QuoteValidationError('Either a carrier or a carrier name is required');
  }
}
