import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { ACORD_TEMPLATE_FIELD_MAP } from './templateMap';

/**
 * Fills an official fillable ACORD PDF template (when the agency has provided
 * one) with the mapped draft field values, and returns the PDF bytes.
 *
 * Returns null when no template exists for the form type, so the caller can fall
 * back to the generated data PDF. AI is not involved here — this is a
 * deterministic form fill.
 */

const TEMPLATE_DIR = path.join(process.cwd(), 'acord-templates');

function templatePath(formType: string): string {
  return path.join(TEMPLATE_DIR, `${formType}.pdf`);
}

/** List the AcroForm field names in a template (developer tool for building the map). */
export async function listTemplateFields(formType: string): Promise<string[] | null> {
  let bytes: Buffer;
  try {
    bytes = await readFile(templatePath(formType));
  } catch {
    return null;
  }
  const pdf = await PDFDocument.load(bytes);
  return pdf.getForm().getFields().map((f) => f.getName());
}

/** True if a template file exists for this form type. */
export async function hasTemplate(formType: string): Promise<boolean> {
  try {
    await readFile(templatePath(formType));
    return true;
  } catch {
    return false;
  }
}

/**
 * Fill the official template. Returns filled PDF bytes, or null if there is no
 * template for this form type.
 */
export async function fillAcordTemplate(
  formType: string,
  fields: Record<string, string>
): Promise<Uint8Array | null> {
  let bytes: Buffer;
  try {
    bytes = await readFile(templatePath(formType));
  } catch {
    return null; // no template → caller uses the generated PDF
  }

  const pdf = await PDFDocument.load(bytes);
  const form = pdf.getForm();
  const map = ACORD_TEMPLATE_FIELD_MAP[formType] ?? {};

  for (const [ourKey, pdfFieldName] of Object.entries(map)) {
    const value = fields[ourKey];
    if (!value) continue;
    try {
      form.getTextField(pdfFieldName).setText(value);
    } catch {
      // Field is missing or not a text field on this template — skip it.
    }
  }

  // Keep it editable so an agent can still adjust before printing/submitting.
  return pdf.save();
}
