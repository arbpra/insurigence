/**
 * Maps our ACORD data keys → the AcroForm field names inside each official
 * fillable ACORD PDF template.
 *
 * Official ACORD PDFs use their own internal field names (e.g. "Form_CompletionDate_A"),
 * which differ per form and per ACORD revision. Populate these once the agency
 * provides the licensed templates — discover names with:
 *   npx tsx script/list-acord-fields.ts ACORD_125
 *
 * Any key left unmapped is simply skipped (that field stays blank on the form).
 * Until a template + mapping exist for a form, export falls back to the
 * generated data PDF automatically.
 */
export const ACORD_TEMPLATE_FIELD_MAP: Record<string, Record<string, string>> = {
  ACORD_125: {
    // ourKey: 'PDF AcroForm field name'
    // namedInsured: 'NamedInsured_FullName_A',
    // mailingAddress: 'NamedInsured_MailingAddress_LineOne_A',
  },
  ACORD_126: {},
  ACORD_140: {},
  ACORD_25: {},
  ACORD_130: {},
};
