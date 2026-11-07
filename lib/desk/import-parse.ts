/**
 * Reads an uploaded export into rows of text: CSV (and its tab, semicolon and
 * pipe variants) and XLSX. Server only.
 *
 * Files come from outside, so nothing is trusted: the size, unpacked size, row,
 * column and cell limits are checked while reading, and XML document types are
 * refused outright, which rules out entity expansion and outside references.
 * Macros in an .xlsm are never read, let alone run. Every value becomes text
 * here; deciding what a value means is the next step's job (Module 26).
 */
import { Unzip, UnzipInflate } from 'fflate';
import { SaxesParser } from 'saxes';
import {
  MAX_CELL_CHARS, MAX_IMPORT_BYTES, MAX_IMPORT_COLUMNS, MAX_IMPORT_ROWS, MAX_UNPACKED_BYTES, type ParsedRow,
} from './import-headers';

/** A problem with the file that its owner can fix. The message is shown to them. */
export class ImportFileError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = 'ImportFileError';
  }
}

export interface ParsedFile {
  format: 'CSV' | 'XLSX';
  sheetName: string | null;
  sheetNames: string[];
  rows: ParsedRow[];
  columnCount: number;
}

const tooManyRows = () => new ImportFileError(`This file has more than ${MAX_IMPORT_ROWS.toLocaleString('en-US')} rows. Split it into smaller files.`, 'TOO_MANY_ROWS');
const tooManyColumns = () => new ImportFileError(`This file has more than ${MAX_IMPORT_COLUMNS} columns. Remove the ones you don't need.`, 'TOO_MANY_COLUMNS');
const cellTooLong = (rowNumber: number) => new ImportFileError(`Row ${rowNumber.toLocaleString('en-US')} has a cell longer than ${MAX_CELL_CHARS.toLocaleString('en-US')} characters. Check the file for an unmatched quote mark or shorten the cell.`, 'CELL_TOO_LONG');
const notReadable = () => new ImportFileError('This file could not be read as a spreadsheet. Open it in Excel and save it as .xlsx or .csv, then try again.', 'UNREADABLE');

/** Adds a row, dropping trailing blanks. A wholly blank row is left out but keeps its number. */
class RowCollector {
  readonly rows: ParsedRow[] = [];
  columnCount = 0;

  add(rowNumber: number, raw: string[]) {
    const cells = raw.map((c) => c.trim());
    let end = cells.length;
    while (end > 0 && cells[end - 1] === '') end--;
    if (!end) return;
    if (end > MAX_IMPORT_COLUMNS) throw tooManyColumns();
    if (this.rows.length >= MAX_IMPORT_ROWS) throw tooManyRows();
    cells.length = end;
    this.rows.push({ rowNumber, cells });
    if (end > this.columnCount) this.columnCount = end;
  }
}

// ── Text files ──

function decodeText(bytes: Uint8Array): string {
  const isUtf16 = (a: number, b: number) => bytes[0] === a && bytes[1] === b;
  let text: string;
  if (isUtf16(0xff, 0xfe)) text = new TextDecoder('utf-16le').decode(bytes);
  else if (isUtf16(0xfe, 0xff)) text = new TextDecoder('utf-16be').decode(bytes);
  // Excel's "Unicode text" sometimes has no marker: plain Latin text then has a zero in every other byte.
  else if (bytes.length > 3 && bytes[0] !== 0 && bytes[1] === 0 && bytes[3] === 0) text = new TextDecoder('utf-16le').decode(bytes);
  else if (bytes.length > 3 && bytes[0] === 0 && bytes[2] === 0 && bytes[1] !== 0) text = new TextDecoder('utf-16be').decode(bytes);
  else {
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      // Older exports: "Café" in Windows' own encoding isn't valid UTF-8.
      text = new TextDecoder('windows-1252').decode(bytes);
    }
  }
  if (text.includes('\u0000')) throw notReadable();
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

const DELIMITERS = [',', '\t', ';', '|'];

/** How many times the delimiter appears on a line, ignoring quoted text. */
function countOutsideQuotes(line: string, delimiter: string): number {
  let count = 0, quoted = false;
  for (const ch of line) {
    if (ch === '"') quoted = !quoted;
    else if (ch === delimiter && !quoted) count++;
  }
  return count;
}

/** The delimiter that splits the most lines the same way, so a title row doesn't decide it. Comma wins a tie. */
function detectDelimiter(text: string): string {
  const lines = text.slice(0, 256 * 1024).split(/\r\n|\n|\r/).filter((l) => l.trim()).slice(0, 25);
  let best = ',', bestScore = 0;
  for (const delimiter of DELIMITERS) {
    const tally = new Map<number, number>();
    for (const line of lines) {
      const n = countOutsideQuotes(line, delimiter);
      if (n) tally.set(n, (tally.get(n) ?? 0) + 1);
    }
    for (const [fields, lineCount] of tally) {
      const score = fields * lineCount;
      if (score > bestScore) { bestScore = score; best = delimiter; }
    }
  }
  return best;
}

export function parseCsv(bytes: Uint8Array): ParsedFile {
  let text = decodeText(bytes);
  let delimiter: string | null = null;
  // Excel's own way of naming the delimiter on the first line.
  const sep = /^sep=(.)\r?\n/i.exec(text);
  let rowNumber = 1;
  if (sep) { delimiter = sep[1]; text = text.slice(sep[0].length); rowNumber = 2; }
  delimiter ??= detectDelimiter(text);

  const collector = new RowCollector();
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  let quoteStartRow = 0;
  const endCell = () => {
    if (cell.length > MAX_CELL_CHARS) throw cellTooLong(rowNumber);
    row.push(cell);
    cell = '';
  };
  const endRow = () => { endCell(); collector.add(rowNumber, row); row = []; rowNumber++; };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch !== '"') {
        cell += ch;
        if (cell.length > MAX_CELL_CHARS) throw new ImportFileError(`The quote mark opened on row ${quoteStartRow.toLocaleString('en-US')} isn't closed within ${MAX_CELL_CHARS.toLocaleString('en-US')} characters. Check that row.`, 'UNCLOSED_QUOTE');
      } else if (text[i + 1] === '"') { cell += '"'; i++; }
      else quoted = false;
    } else if (ch === '"' && cell.trim() === '') { cell = ''; quoted = true; quoteStartRow = rowNumber; }
    else if (ch === delimiter) endCell();
    else if (ch === '\r') { if (text[i + 1] === '\n') i++; endRow(); }
    else if (ch === '\n') endRow();
    else cell += ch;
  }
  if (quoted) throw new ImportFileError(`The quote mark opened on row ${quoteStartRow.toLocaleString('en-US')} is never closed. Check that row.`, 'UNCLOSED_QUOTE');
  if (cell !== '' || row.length) endRow();
  return { format: 'CSV', sheetName: null, sheetNames: [], rows: collector.rows, columnCount: collector.columnCount };
}

// ── XLSX: a zip of XML files ──

const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04];
const OLE_MAGIC = [0xd0, 0xcf, 0x11, 0xe0];
const startsWith = (bytes: Uint8Array, magic: number[]) => magic.every((b, i) => bytes[i] === b);
const WANTED_ENTRY = /(\.xml|\.rels)$/i;
const SKIPPED_ENTRY = /^xl\/(theme|media|drawings|charts|printerSettings|externalLinks|pivotCache|pivotTables|ctrlProps|activeX|vbaProject)/i;
/** The unzip library recurses once per entry, so this stops well before the stack would run out. A real workbook has far fewer. */
const MAX_ZIP_ENTRIES = 2_000;

/** Unpacks only the XML, counting real output, because the sizes a zip declares can be false. */
function unzipWorkbook(bytes: Uint8Array): Map<string, Uint8Array> {
  const files = new Map<string, Uint8Array>();
  let unpacked = 0, entries = 0;
  const tooBig = () => new ImportFileError('This workbook unpacks to more than The Desk will read. Save just the sheet you need as .csv or a new .xlsx, then try again.', 'TOO_LARGE_UNPACKED');
  const unzip = new Unzip((file) => {
    if (++entries > MAX_ZIP_ENTRIES) throw tooBig();
    const name = file.name.replace(/\\/g, '/').replace(/^\/+/, '');
    if (!WANTED_ENTRY.test(name) || SKIPPED_ENTRY.test(name)) return;
    const chunks: Uint8Array[] = [];
    file.ondata = (err, chunk, final) => {
      if (err) throw err;
      unpacked += chunk.length;
      if (unpacked > MAX_UNPACKED_BYTES) throw tooBig();
      chunks.push(chunk);
      if (final) {
        const whole = new Uint8Array(chunks.reduce((sum, c) => sum + c.length, 0));
        let at = 0;
        for (const c of chunks) { whole.set(c, at); at += c.length; }
        files.set(name.toLowerCase(), whole);
      }
    };
    file.start();
  });
  unzip.register(UnzipInflate);
  try {
    unzip.push(bytes, true);
  } catch (err) {
    if (err instanceof ImportFileError) throw err;
    throw notReadable();
  }
  return files;
}

const localName = (name: string) => name.slice(name.indexOf(':') + 1);

interface XmlHandlers {
  open?: (name: string, attrs: Record<string, string>) => void;
  close?: (name: string) => void;
  text?: (text: string) => void;
}

function readXml(bytes: Uint8Array, handlers: XmlHandlers) {
  const text = bytes[0] === 0xff && bytes[1] === 0xfe ? new TextDecoder('utf-16le').decode(bytes)
    : bytes[0] === 0xfe && bytes[1] === 0xff ? new TextDecoder('utf-16be').decode(bytes)
    : new TextDecoder('utf-8').decode(bytes);
  const parser = new SaxesParser();
  parser.on('error', () => { throw notReadable(); });
  // A real workbook never has one, and refusing it rules out entity expansion and outside references.
  parser.on('doctype', () => { throw notReadable(); });
  parser.on('opentag', (tag) => handlers.open?.(localName(tag.name), tag.attributes as Record<string, string>));
  parser.on('closetag', (tag) => handlers.close?.(localName(tag.name)));
  parser.on('text', (t) => handlers.text?.(t));
  parser.on('cdata', (t) => handlers.text?.(t));
  parser.write(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text).close();
}

/** Excel writes some characters as _x000D_ inside text. */
const decodeEscapes = (s: string) => s.replace(/_x([0-9a-fA-F]{4})_/g, (_, hex) => {
  const code = parseInt(hex, 16);
  return code === 0 ? '' : String.fromCharCode(code);
});

function readSharedStrings(xml: Uint8Array | undefined): string[] {
  if (!xml) return [];
  const out: string[] = [];
  let current = '', depthPhonetic = 0, inText = false;
  readXml(xml, {
    open(name) {
      if (name === 'si') current = '';
      else if (name === 'rPh') depthPhonetic++;
      else if (name === 't') inText = depthPhonetic === 0;
    },
    text(t) { if (inText) current += t; },
    close(name) {
      if (name === 't') inText = false;
      else if (name === 'rPh') depthPhonetic--;
      else if (name === 'si') out.push(decodeEscapes(current));
    },
  });
  return out;
}

// Excel's built-in date and time formats, by number.
const BUILT_IN_DATES = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 45, 46, 47, 50, 51, 52, 53, 54, 55, 56, 57, 58]);

export function isDateFormat(code: string): boolean {
  const bare = code
    .replace(/"[^"]*"/g, '')
    .replace(/\\./g, '')
    .replace(/[_*]./g, '')
    .replace(/\[[^\]]*\]/g, '');
  return bare.toLowerCase() !== 'general' && /[dmyhs]/i.test(bare);
}

interface CellStyle { isDate: boolean; zeroPad: number }

function readStyles(xml: Uint8Array | undefined): CellStyle[] {
  if (!xml) return [];
  const custom = new Map<number, string>();
  const styles: CellStyle[] = [];
  let inCellXfs = false;
  readXml(xml, {
    open(name, attrs) {
      if (name === 'numFmt') custom.set(Number(attrs.numFmtId), attrs.formatCode ?? '');
      else if (name === 'cellXfs') inCellXfs = true;
      else if (name === 'xf' && inCellXfs) {
        const id = Number(attrs.numFmtId ?? 0);
        const code = custom.get(id);
        styles.push({
          isDate: code !== undefined ? isDateFormat(code) : BUILT_IN_DATES.has(id),
          // "00000" keeps the leading zeros of a code stored as a number.
          zeroPad: code && /^0+$/.test(code) ? code.length : 0,
        });
      }
    },
    close(name) { if (name === 'cellXfs') inCellXfs = false; },
  });
  return styles;
}

const pad = (n: number, width = 2) => String(n).padStart(width, '0');

/** A date cell's stored number as text, or null when the number can't be a date. */
export function serialToText(serial: number, date1904: boolean): string | null {
  if (!Number.isFinite(serial) || serial < 0 || serial >= 2_958_466) return null;
  const days = Math.floor(serial);
  let seconds = Math.round((serial - days) * 86_400);
  let wholeDays = days;
  if (seconds === 86_400) { wholeDays++; seconds = 0; }
  const time = `${pad(Math.floor(seconds / 3600))}:${pad(Math.floor(seconds / 60) % 60)}:${pad(seconds % 60)}`;
  if (wholeDays === 0 && !date1904) return time;
  // Excel counts a 29 Feb 1900 that never was, so serials before it start a day later.
  if (!date1904 && wholeDays === 60) return null;
  const epoch = date1904 ? Date.UTC(1904, 0, 1) : wholeDays < 60 ? Date.UTC(1899, 11, 31) : Date.UTC(1899, 11, 30);
  const day = new Date(epoch + wholeDays * 86_400_000).toISOString().slice(0, 10);
  return seconds ? `${day}T${time}` : day;
}

function numberToText(raw: string, style: CellStyle | undefined, date1904: boolean): string {
  const value = raw.trim();
  const n = Number(value);
  if (value === '' || !Number.isFinite(n)) return value;
  if (style?.isDate) return serialToText(n, date1904) ?? value;
  // A whole number as written, so a long id isn't rounded.
  if (/^-?\d+$/.test(value)) return style?.zeroPad && !value.startsWith('-') ? value.padStart(style.zeroPad, '0') : value;
  // Excel keeps 15 significant digits: 1234.5000000000002 means 1234.5.
  return String(Number(n.toPrecision(15)));
}

function columnIndex(ref: string | undefined): number | null {
  const m = ref ? /^([A-Za-z]{1,3})\d*$/.exec(ref) : null;
  if (!m) return null;
  let n = 0;
  for (const ch of m[1].toUpperCase()) n = n * 26 + ch.charCodeAt(0) - 64;
  return n - 1;
}

function readSheet(xml: Uint8Array, shared: string[], styles: CellStyle[], date1904: boolean) {
  const collector = new RowCollector();
  let rowNumber = 0, nextColumn = 0;
  let row: string[] = [];
  let inRow = false;
  let cell: { column: number; type: string; style?: CellStyle } | null = null;
  let value = '', inline = '';
  let capture: 'v' | 't' | null = null, phonetic = 0;

  readXml(xml, {
    open(name, attrs) {
      if (name === 'row') {
        const given = Number(attrs.r);
        rowNumber = Number.isInteger(given) && given > 0 ? given : rowNumber + 1;
        row = []; nextColumn = 0; inRow = true;
      } else if (name === 'c' && inRow) {
        const column = columnIndex(attrs.r) ?? nextColumn;
        nextColumn = column + 1;
        cell = { column, type: attrs.t ?? 'n', style: styles[Number(attrs.s ?? 0)] };
        value = ''; inline = '';
      } else if (!cell) return;
      else if (name === 'v') capture = 'v';
      else if (name === 'rPh') phonetic++;
      else if (name === 't') capture = phonetic ? null : 't';
    },
    text(t) {
      if (capture === 'v') value += t;
      else if (capture === 't') inline += t;
    },
    close(name) {
      if (name === 'v' || name === 't') capture = null;
      else if (name === 'rPh') phonetic--;
      else if (name === 'c' && cell) {
        let text: string;
        switch (cell.type) {
          case 's': text = shared[Number(value)] ?? ''; break;
          case 'inlineStr': text = decodeEscapes(inline); break;
          case 'str': case 'e': case 'd': text = decodeEscapes(value); break;
          case 'b': text = value.trim() === '1' ? 'TRUE' : value.trim() === '0' ? 'FALSE' : value; break;
          default: text = numberToText(value, cell.style, date1904);
        }
        if (text.length > MAX_CELL_CHARS) throw cellTooLong(rowNumber);
        if (text.trim()) {
          if (cell.column >= MAX_IMPORT_COLUMNS) throw tooManyColumns();
          while (row.length < cell.column) row.push('');
          row[cell.column] = text;
        }
        cell = null;
      } else if (name === 'row') {
        collector.add(rowNumber, row);
        inRow = false;
      }
    },
  });
  return collector;
}

const dirOf = (path: string) => path.slice(0, path.lastIndexOf('/') + 1);

/** A relationship's target as a path in the zip. Targets may be absolute or relative, with "..". */
function resolveTarget(fromDir: string, target: string): string {
  const parts = (target.startsWith('/') ? target.slice(1) : fromDir + target).split('/');
  const out: string[] = [];
  for (const part of parts) {
    if (part === '..') out.pop();
    else if (part && part !== '.') out.push(part);
  }
  return out.join('/').toLowerCase();
}

function readRelationships(xml: Uint8Array | undefined) {
  const out: { id: string; type: string; target: string }[] = [];
  if (xml) readXml(xml, { open(name, attrs) { if (name === 'Relationship') out.push({ id: attrs.Id, type: attrs.Type ?? '', target: attrs.Target ?? '' }); } });
  return out;
}

export function parseXlsx(bytes: Uint8Array, wantedSheet?: string | null): ParsedFile {
  const files = unzipWorkbook(bytes);
  const office = readRelationships(files.get('_rels/.rels')).find((r) => /\/officeDocument$/.test(r.type));
  const workbookPath = office ? resolveTarget('', office.target) : 'xl/workbook.xml';
  const workbook = files.get(workbookPath);
  if (!workbook) throw notReadable();

  let date1904 = false;
  const sheets: { name: string; relId: string; visible: boolean }[] = [];
  readXml(workbook, {
    open(name, attrs) {
      if (name === 'workbookPr') date1904 = attrs.date1904 === '1' || attrs.date1904 === 'true';
      else if (name === 'sheet') {
        const relKey = Object.keys(attrs).find((k) => localName(k) === 'id' && k.includes(':')) ?? 'id';
        sheets.push({ name: attrs.name ?? '', relId: attrs[relKey], visible: (attrs.state ?? 'visible') === 'visible' });
      }
    },
  });
  const dir = dirOf(workbookPath);
  const relsPath = `${dir}_rels/${workbookPath.slice(dir.length)}.rels`;
  const relationships = readRelationships(files.get(relsPath));
  const pathOf = (relId: string) => {
    const rel = relationships.find((r) => r.id === relId);
    return rel ? resolveTarget(dir, rel.target) : null;
  };
  const relOf = (kind: RegExp) => {
    const rel = relationships.find((r) => kind.test(r.type));
    return rel ? files.get(resolveTarget(dir, rel.target)) : undefined;
  };

  const visible = sheets.filter((s) => s.visible);
  const sheetNames = visible.map((s) => s.name);
  if (wantedSheet && !sheetNames.includes(wantedSheet)) throw new ImportFileError('That sheet is not in this workbook.', 'NO_SUCH_SHEET');
  const shared = readSharedStrings(relOf(/\/sharedStrings$/));
  const styles = readStyles(relOf(/\/styles$/));

  // The sheet asked for, or the first visible one with anything in it.
  for (const sheet of visible) {
    if (wantedSheet && sheet.name !== wantedSheet) continue;
    const path = pathOf(sheet.relId);
    const xml = path ? files.get(path) : undefined;
    if (!xml) continue;
    const { rows, columnCount } = readSheet(xml, shared, styles, date1904);
    if (rows.length || wantedSheet) return { format: 'XLSX', sheetName: sheet.name, sheetNames, rows, columnCount };
  }
  if (!visible.length && sheets.length) throw new ImportFileError('Every sheet in this workbook is hidden. Unhide the one to import, then try again.', 'NO_VISIBLE_SHEET');
  return { format: 'XLSX', sheetName: sheetNames[0] ?? null, sheetNames, rows: [], columnCount: 0 };
}

// ── Choosing the reader ──

const TEXT_EXTENSIONS = new Set(['csv', 'tsv', 'txt']);
const XLSX_EXTENSIONS = new Set(['xlsx', 'xlsm']);

/**
 * Goes by what the file is, not only what it is called: AMS systems often name
 * files loosely, and a renamed workbook should still read as one.
 */
export function parseImportFile(bytes: Uint8Array, fileName: string, options: { sheet?: string | null } = {}): ParsedFile {
  if (bytes.length === 0) throw new ImportFileError('This file is empty.', 'EMPTY_FILE');
  if (bytes.length > MAX_IMPORT_BYTES) throw new ImportFileError(`Files can be up to ${MAX_IMPORT_BYTES / 1024 / 1024} MB. Split this one into smaller files.`, 'TOO_LARGE');
  const extension = /\.([^./\\]+)$/.exec(fileName)?.[1]?.toLowerCase() ?? '';
  const known = TEXT_EXTENSIONS.has(extension) || XLSX_EXTENSIONS.has(extension);

  if (startsWith(bytes, OLE_MAGIC) || extension === 'xls') {
    throw new ImportFileError(extension === 'xlsx' || extension === 'xlsm'
      ? 'This workbook is password protected. Remove the password in Excel, save it, then try again.'
      : 'Older .xls files can\'t be read. Open it in Excel and save it as .xlsx or .csv, then try again.', 'OLD_OR_PROTECTED');
  }
  if (!known) throw new ImportFileError('Upload a .csv or .xlsx file.', 'UNSUPPORTED_TYPE');
  if (startsWith(bytes, ZIP_MAGIC)) return parseXlsx(bytes, options.sheet);
  if (XLSX_EXTENSIONS.has(extension)) throw notReadable();
  return parseCsv(bytes);
}
