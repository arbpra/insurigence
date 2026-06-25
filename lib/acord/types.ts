/**
 * Shared types for the ACORD field-mapping layer.
 *
 * Mapping is deterministic (rules), per the AI build direction: the rules engine
 * maps intake/lead/policy data into ACORD fields; AI is used only to clean up or
 * interpret ambiguous free-text fields (added in a later step).
 */

export interface AcordFieldSpec {
  /** Stable field key (stored in AcordDraft.fields). */
  key: string;
  /** Human label shown on the review screen. */
  label: string;
  /** Form section grouping. */
  section: string;
  /** Required-for-submission fields drive missing-field detection. */
  required?: boolean;
}

/** Inputs available to a form mapper. */
export interface AcordMapContext {
  lead: { insuredName: string; primaryContactEmail: string | null };
  answers: Record<string, unknown>;
  agency: { name: string | null };
}

export interface AcordFormSpec {
  formType: string;
  title: string;
  fields: AcordFieldSpec[];
  /** Deterministic mapping from context to field values (strings). */
  map: (ctx: AcordMapContext) => Record<string, string>;
}

export interface AcordDraftResult {
  formType: string;
  title: string;
  fields: Record<string, string>;
  /** Required field keys still blank. */
  missingFields: string[];
}
