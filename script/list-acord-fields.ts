/**
 * List the fillable field names in an official ACORD template so they can be
 * mapped in lib/acord/templateMap.ts.
 *
 * Usage: npx tsx script/list-acord-fields.ts ACORD_125
 */
import { listTemplateFields } from '../lib/acord/templateFill';

async function main() {
  const formType = process.argv[2];
  if (!formType) {
    console.error('Usage: npx tsx script/list-acord-fields.ts <ACORD_125|ACORD_126|...>');
    process.exit(1);
  }
  const fields = await listTemplateFields(formType);
  if (fields === null) {
    console.error(`No template found at acord-templates/${formType}.pdf`);
    process.exit(1);
  }
  console.log(`Fillable fields in ${formType}.pdf (${fields.length}):`);
  fields.forEach((f) => console.log(' -', f));
}

main().catch((e) => { console.error(e); process.exit(1); });
