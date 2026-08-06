import { acord125Spec } from './acord125';
import { acord126Spec } from './acord126';
import { acord140Spec } from './acord140';
import { acord25Spec } from './acord25';
import { acord130Spec } from './acord130';
import type { AcordFormSpec, AcordMapContext, AcordDraftResult } from './types';

export type { AcordFieldSpec, AcordFormSpec, AcordMapContext, AcordDraftResult } from './types';

/**
 * Registry of supported ACORD forms. Add new forms here as their mappers are
 * built. Everything else reads from this registry, so the API and UI don't need
 * per-form branching.
 */
export const ACORD_FORMS: Record<string, AcordFormSpec> = {
  ACORD_125: acord125Spec,
  ACORD_126: acord126Spec,
  ACORD_140: acord140Spec,
  ACORD_25: acord25Spec,
  ACORD_130: acord130Spec,
};

export function getAcordForm(formType: string): AcordFormSpec | null {
  return ACORD_FORMS[formType] ?? null;
}

/** Required field keys whose mapped value is blank. */
export function detectMissing(spec: AcordFormSpec, fields: Record<string, string>): string[] {
  return spec.fields
    .filter((f) => f.required && !String(fields[f.key] ?? '').trim())
    .map((f) => f.key);
}

/** Deterministically build an ACORD draft (mapped fields + missing-field list). */
export function buildAcordDraft(formType: string, ctx: AcordMapContext): AcordDraftResult | null {
  const spec = getAcordForm(formType);
  if (!spec) return null;
  const fields = spec.map(ctx);
  return {
    formType: spec.formType,
    title: spec.title,
    fields,
    missingFields: detectMissing(spec, fields),
  };
}
