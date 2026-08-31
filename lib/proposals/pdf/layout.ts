/**
 * A small flowing-document writer on top of pdf-lib.
 *
 * pdf-lib draws at absolute coordinates and has no concept of a paragraph, a
 * page break, or a table. This module supplies the missing layer: a cursor that
 * moves down the page, wraps text to the column width, and starts a new page
 * when it runs out of room — so the proposal renderer can describe content
 * rather than arithmetic.
 */

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage, type RGB } from 'pdf-lib';

/** US Letter at 72dpi, the size a US agency will print on. */
export const PAGE_WIDTH = 612;
export const PAGE_HEIGHT = 792;
const MARGIN = 54;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
/** Leave room for the footer before breaking to a new page. */
const BOTTOM_LIMIT = 64;

export const INK = rgb(0.05, 0.13, 0.22);
export const MUTED = rgb(0.45, 0.5, 0.56);
export const FAINT = rgb(0.62, 0.66, 0.71);
export const RULE = rgb(0.88, 0.9, 0.92);

/**
 * Convert a hex colour to pdf-lib's RGB.
 *
 * Branding colours are already validated as hex upstream, but this is called
 * with whatever is stored, so an unreadable value falls back rather than
 * throwing midway through a document.
 */
export function hexToRgb(hex: string | null | undefined, fallback: RGB = INK): RGB {
  if (typeof hex !== 'string') return fallback;
  let h = hex.trim().replace(/^#/, '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return fallback;
  return rgb(
    parseInt(h.slice(0, 2), 16) / 255,
    parseInt(h.slice(2, 4), 16) / 255,
    parseInt(h.slice(4, 6), 16) / 255
  );
}

/**
 * Make text safe for the standard PDF fonts.
 *
 * The built-in fonts use WinAnsi encoding, which cannot represent an em dash, a
 * curly quote, or an ellipsis — and pdf-lib throws when asked to draw one. Our
 * content is full of them: AI output, the default section wording, and the
 * disclaimer all contain typographic punctuation. Anything outside the encoding
 * is mapped to its ASCII equivalent, and anything unmappable is dropped, so a
 * stray character can never abort a document.
 */
export function toWinAnsi(text: string): string {
  return text
    .replace(/[‘’‚′]/g, "'")
    .replace(/[“”„″]/g, '"')
    .replace(/[–—―]/g, '-')
    .replace(/…/g, '...')
    .replace(/[   ]/g, ' ')
    .replace(/[•‣◦]/g, '-')
    .replace(/™/g, '(TM)')
    .replace(/®/g, '(R)')
    .replace(/€/g, 'EUR')
    // Anything still outside printable Latin-1 is not representable.
    .replace(/[^\x20-\x7E\xA0-\xFF\n]/g, '');
}

export interface Fonts {
  regular: PDFFont;
  bold: PDFFont;
  italic: PDFFont;
}

/** A document being written, tracking the cursor and current page. */
export class PdfWriter {
  readonly doc: PDFDocument;
  readonly fonts: Fonts;
  page: PDFPage;
  y: number;
  private pages: PDFPage[] = [];

  private constructor(doc: PDFDocument, fonts: Fonts) {
    this.doc = doc;
    this.fonts = fonts;
    this.page = this.newPage();
    this.y = PAGE_HEIGHT - MARGIN;
  }

  static async create(): Promise<PdfWriter> {
    const doc = await PDFDocument.create();
    const fonts: Fonts = {
      regular: await doc.embedFont(StandardFonts.Helvetica),
      bold: await doc.embedFont(StandardFonts.HelveticaBold),
      italic: await doc.embedFont(StandardFonts.HelveticaOblique),
    };
    return new PdfWriter(doc, fonts);
  }

  private newPage(): PDFPage {
    const p = this.doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    this.pages.push(p);
    return p;
  }

  get left(): number { return MARGIN; }
  get width(): number { return CONTENT_WIDTH; }
  get pageCount(): number { return this.pages.length; }

  /** Start a new page and reset the cursor. */
  breakPage(): void {
    this.page = this.newPage();
    this.y = PAGE_HEIGHT - MARGIN;
  }

  /** Break if `needed` points of vertical space are not available. */
  ensure(needed: number): void {
    if (this.y - needed < BOTTOM_LIMIT) this.breakPage();
  }

  space(points: number): void { this.y -= points; }

  /** Split text into lines that fit `width` at the given font and size. */
  wrap(text: string, font: PDFFont, size: number, width = CONTENT_WIDTH): string[] {
    const safe = toWinAnsi(text);
    const lines: string[] = [];

    for (const paragraph of safe.split('\n')) {
      if (paragraph.trim() === '') { lines.push(''); continue; }
      let line = '';
      for (const word of paragraph.split(/\s+/)) {
        const candidate = line === '' ? word : `${line} ${word}`;
        if (font.widthOfTextAtSize(candidate, size) <= width) {
          line = candidate;
        } else {
          if (line !== '') lines.push(line);
          // A single word wider than the column (a long URL) is broken by
          // character rather than allowed to overflow the margin.
          if (font.widthOfTextAtSize(word, size) > width) {
            let chunk = '';
            for (const ch of word) {
              if (font.widthOfTextAtSize(chunk + ch, size) > width) {
                lines.push(chunk);
                chunk = ch;
              } else chunk += ch;
            }
            line = chunk;
          } else line = word;
        }
      }
      if (line !== '') lines.push(line);
    }
    return lines;
  }

  /** Draw wrapped text from the cursor, paginating as needed. */
  text(
    content: string,
    opts: {
      font?: PDFFont; size?: number; color?: RGB; lineHeight?: number;
      x?: number; width?: number; spaceAfter?: number;
    } = {}
  ): void {
    const font = opts.font ?? this.fonts.regular;
    const size = opts.size ?? 10;
    const color = opts.color ?? INK;
    const lineHeight = opts.lineHeight ?? size * 1.45;
    const x = opts.x ?? MARGIN;
    const width = opts.width ?? CONTENT_WIDTH;

    for (const line of this.wrap(content, font, size, width)) {
      this.ensure(lineHeight);
      if (line !== '') {
        this.page.drawText(line, { x, y: this.y - size, size, font, color });
      }
      this.y -= lineHeight;
    }
    if (opts.spaceAfter) this.y -= opts.spaceAfter;
  }

  /** A single line that is never wrapped — truncated with an ellipsis instead. */
  line(
    content: string,
    opts: { font?: PDFFont; size?: number; color?: RGB; x?: number; maxWidth?: number } = {}
  ): void {
    const font = opts.font ?? this.fonts.regular;
    const size = opts.size ?? 10;
    let safe = toWinAnsi(content);
    const maxWidth = opts.maxWidth ?? CONTENT_WIDTH;

    while (safe.length > 1 && font.widthOfTextAtSize(safe, size) > maxWidth) {
      safe = safe.slice(0, -2) + '.';
    }
    this.ensure(size * 1.45);
    this.page.drawText(safe, {
      x: opts.x ?? MARGIN, y: this.y - size, size, font, color: opts.color ?? INK,
    });
    this.y -= size * 1.45;
  }

  /** Section heading with a rule beneath it. */
  heading(title: string, color: RGB): void {
    // Keep a heading with at least a little of its content.
    this.ensure(52);
    this.space(6);
    this.text(title, { font: this.fonts.bold, size: 13, color, lineHeight: 17 });
    this.rule();
    this.space(6);
  }

  rule(color: RGB = RULE): void {
    this.ensure(8);
    this.page.drawLine({
      start: { x: MARGIN, y: this.y },
      end: { x: PAGE_WIDTH - MARGIN, y: this.y },
      thickness: 0.75,
      color,
    });
    this.y -= 8;
  }

  /** A filled block, drawn behind content the caller writes next. */
  panel(height: number, color: RGB): void {
    this.ensure(height + 8);
    this.page.drawRectangle({
      x: MARGIN, y: this.y - height, width: CONTENT_WIDTH, height,
      color,
    });
  }

  /** Label/value pair on one line, label in muted small caps. */
  field(label: string, value: string, opts: { x?: number; width?: number } = {}): void {
    const x = opts.x ?? MARGIN;
    const width = opts.width ?? CONTENT_WIDTH;
    this.ensure(24);
    this.page.drawText(toWinAnsi(label.toUpperCase()), {
      x, y: this.y - 7, size: 7, font: this.fonts.bold, color: FAINT,
    });
    this.y -= 11;
    this.line(value || '-', { size: 10, x, maxWidth: width });
    this.y -= 2;
  }

  /**
   * A simple table. Column widths are fractions of the content width.
   * Rows wrap within their column and the row grows to the tallest cell.
   */
  table(headers: string[], rows: string[][], widths: number[], accent: RGB): void {
    const size = 9;
    const padding = 6;
    const cols = widths.map((w) => w * CONTENT_WIDTH);

    const drawHeader = () => {
      this.ensure(26);
      this.page.drawRectangle({
        x: MARGIN, y: this.y - 18, width: CONTENT_WIDTH, height: 18,
        color: rgb(0.97, 0.98, 0.99),
      });
      let x = MARGIN + padding;
      headers.forEach((h, i) => {
        this.page.drawText(toWinAnsi(h.toUpperCase()), {
          x, y: this.y - 13, size: 7, font: this.fonts.bold, color: FAINT,
        });
        x += cols[i];
      });
      this.y -= 18;
    };

    drawHeader();

    for (const row of rows) {
      const cellLines = row.map((cell, i) =>
        this.wrap(cell, this.fonts.regular, size, cols[i] - padding * 2)
      );
      const height = Math.max(...cellLines.map((l) => l.length)) * (size * 1.35) + padding;

      // Repeat the header when a table spills onto a new page.
      if (this.y - height < BOTTOM_LIMIT) {
        this.breakPage();
        drawHeader();
      }

      const top = this.y;
      let x = MARGIN + padding;
      cellLines.forEach((lines, i) => {
        lines.forEach((line, li) => {
          this.page.drawText(line, {
            x, y: top - padding - size - li * (size * 1.35),
            size, font: i === 0 ? this.fonts.bold : this.fonts.regular,
            color: i === 0 ? INK : rgb(0.25, 0.3, 0.36),
          });
        });
        x += cols[i];
      });

      this.y -= height;
      this.page.drawLine({
        start: { x: MARGIN, y: this.y }, end: { x: PAGE_WIDTH - MARGIN, y: this.y },
        thickness: 0.5, color: RULE,
      });
    }
    this.y -= 4;
    void accent;
  }

  /**
   * Stamp the footer on every page. Called last, once the page count is known,
   * so "Page 1 of 4" is accurate.
   */
  finishFooters(leftText: string, accent: RGB): void {
    this.pages.forEach((page, i) => {
      page.drawLine({
        start: { x: MARGIN, y: 46 }, end: { x: PAGE_WIDTH - MARGIN, y: 46 },
        thickness: 0.5, color: RULE,
      });
      page.drawText(toWinAnsi(leftText).slice(0, 90), {
        x: MARGIN, y: 34, size: 7, font: this.fonts.regular, color: FAINT,
      });
      const label = `Page ${i + 1} of ${this.pages.length}`;
      const w = this.fonts.regular.widthOfTextAtSize(label, 7);
      page.drawText(label, {
        x: PAGE_WIDTH - MARGIN - w, y: 34, size: 7, font: this.fonts.regular, color: FAINT,
      });
      page.drawRectangle({ x: 0, y: PAGE_HEIGHT - 4, width: PAGE_WIDTH, height: 4, color: accent });
    });
  }

  async save(): Promise<Uint8Array> {
    return this.doc.save();
  }
}
