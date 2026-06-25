import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import type { AcordFormSpec } from './types';

/**
 * Generate a clean, structured PDF of an ACORD draft's mapped fields, grouped by
 * section. This renders the agency's data into a readable document — it is NOT
 * the official ACORD-branded template (those are licensed fillable PDFs the
 * agency would supply; pdf-lib can fill them later via form fields).
 */
export async function generateAcordPdf(
  spec: AcordFormSpec,
  draft: { fields: Record<string, string>; status: string; missingFields: string[] }
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  const PAGE_W = 612;
  const PAGE_H = 792;
  const MARGIN = 50;
  const MAX_W = PAGE_W - MARGIN * 2;

  let page: PDFPage = doc.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - MARGIN;

  const newPageIfNeeded = (needed: number) => {
    if (y - needed < MARGIN) {
      page = doc.addPage([PAGE_W, PAGE_H]);
      y = PAGE_H - MARGIN;
    }
  };

  /** Word-wrap a string to fit MAX_W at the given size/font. */
  const wrap = (text: string, f: PDFFont, size: number, width = MAX_W): string[] => {
    const words = text.split(/\s+/);
    const lines: string[] = [];
    let line = '';
    for (const w of words) {
      const test = line ? `${line} ${w}` : w;
      if (f.widthOfTextAtSize(test, size) > width && line) {
        lines.push(line);
        line = w;
      } else {
        line = test;
      }
    }
    if (line) lines.push(line);
    return lines.length ? lines : [''];
  };

  const drawText = (text: string, f: PDFFont, size: number, color = rgb(0.1, 0.13, 0.22)) => {
    for (const line of wrap(text, f, size)) {
      newPageIfNeeded(size + 4);
      page.drawText(line, { x: MARGIN, y, size, font: f, color });
      y -= size + 4;
    }
  };

  // Header
  drawText(spec.title, bold, 16);
  y -= 4;
  drawText(
    draft.status === 'REVIEWED' || draft.status === 'EXPORTED'
      ? 'Agent-reviewed draft.'
      : 'DRAFT — agent review required.',
    font,
    9,
    rgb(0.4, 0.4, 0.4)
  );
  if (draft.missingFields.length > 0) {
    drawText(`Note: ${draft.missingFields.length} required field(s) still blank.`, font, 9, rgb(0.7, 0.2, 0.2));
  }
  y -= 8;

  // Sections
  const bySection = new Map<string, typeof spec.fields>();
  for (const f of spec.fields) {
    if (!bySection.has(f.section)) bySection.set(f.section, []);
    bySection.get(f.section)!.push(f);
  }

  for (const [section, fields] of bySection) {
    newPageIfNeeded(28);
    y -= 6;
    drawText(section.toUpperCase(), bold, 11, rgb(0.05, 0.29, 0.42));
    page.drawLine({
      start: { x: MARGIN, y: y + 2 },
      end: { x: PAGE_W - MARGIN, y: y + 2 },
      thickness: 0.5,
      color: rgb(0.8, 0.8, 0.8),
    });
    y -= 6;

    for (const fld of fields) {
      const value = draft.fields[fld.key]?.trim() || '—';
      newPageIfNeeded(26);
      drawText(`${fld.label}${fld.required ? ' *' : ''}`, bold, 8, rgb(0.45, 0.45, 0.45));
      drawText(value, font, 10);
      y -= 4;
    }
  }

  // Footer disclaimer
  newPageIfNeeded(24);
  y -= 6;
  drawText('Generated draft. Final review required by a licensed agent before use.', font, 8, rgb(0.5, 0.5, 0.5));

  return doc.save();
}
