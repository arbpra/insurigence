/**
 * Limits and column-name logic for imports. No imports, so the screens can share it.
 *
 * Exports come from any AMS (client answer Q2), often with a report title and a
 * date above the column names, so the header row is found rather than assumed.
 * It is a best guess: `confident` says whether the mapping step should ask.
 */

/**
 * Middleware runs on API routes, and Next keeps only the first 10 MB of a body
 * passing through it. 9 MB leaves room for the form's own overhead.
 */
export const MAX_IMPORT_BYTES = 9 * 1024 * 1024;
/** Unpacked size of a workbook. A small .xlsx can unpack to gigabytes if built to. */
export const MAX_UNPACKED_BYTES = 96 * 1024 * 1024;
export const MAX_IMPORT_ROWS = 50_000;
export const MAX_IMPORT_COLUMNS = 200;
export const MAX_CELL_CHARS = 10_000;
export const MAX_HEADER_CHARS = 120;
/** How far down a file the column names can be. */
export const HEADER_SCAN_ROWS = 25;
export const IMPORT_PAGE_SIZE = 50;
export const IMPORT_ACCEPT = '.csv,.tsv,.txt,.xlsx,.xlsm';

export interface ParsedRow {
  /** 1-based, as the user sees it in their spreadsheet. */
  rowNumber: number;
  cells: string[];
}

/** 0 → A, 26 → AA. */
export function columnLetter(index: number): string {
  let out = '';
  for (let n = index; n >= 0; n = Math.floor(n / 26) - 1) out = String.fromCharCode(65 + (n % 26)) + out;
  return out;
}

const HEADER_WORDS = new Set([
  'name', 'client', 'insured', 'customer', 'account', 'dba', 'policy', 'number', 'no', 'carrier', 'company', 'writing',
  'line', 'lob', 'business', 'type', 'coverage', 'effective', 'eff', 'expiration', 'expiry', 'exp', 'renewal', 'date',
  'premium', 'producer', 'agent', 'csr', 'contact', 'email', 'phone', 'address', 'city', 'state', 'zip', 'postal',
  'status', 'code', 'id', 'notes', 'website', 'industry',
]);

const LOOKS_LIKE_DATA = /^[\d\s.,$()%/:+-]+$|^\d{4}-\d{2}-\d{2}/;
const filled = (cells: string[]) => cells.filter((c) => c !== '');
const words = (cell: string) => cell.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

function headerWordHits(cells: string[]): number {
  return filled(cells).filter((c) => words(c).some((w) => HEADER_WORDS.has(w))).length;
}

/** Column names are text and don't repeat. A row of numbers, dates or repeats isn't one. */
function couldBeHeader(cells: string[]): boolean {
  const present = filled(cells);
  if (!present.length) return false;
  if (present.some((c) => c.length > MAX_HEADER_CHARS || LOOKS_LIKE_DATA.test(c))) return false;
  return new Set(present.map((c) => c.toLowerCase())).size === present.length;
}

/**
 * The row most likely to hold the column names: wide enough to be the table's
 * top rather than a title above it, then the most insurance words, then the
 * earliest. With nothing suitable, the first row, marked as a guess.
 */
export function detectHeaderRow(rows: ParsedRow[]): { headerRow: number; confident: boolean } {
  const scan = rows.slice(0, HEADER_SCAN_ROWS);
  if (!scan.length) return { headerRow: 0, confident: false };
  const widest = Math.max(...scan.map((r) => filled(r.cells).length));
  let best: { row: ParsedRow; hits: number } | null = null;
  for (const row of scan) {
    if (filled(row.cells).length < widest * 0.8 || !couldBeHeader(row.cells)) continue;
    const hits = headerWordHits(row.cells);
    if (!best || hits > best.hits) best = { row, hits };
  }
  if (!best) return { headerRow: scan[0].rowNumber, confident: false };
  return { headerRow: best.row.rowNumber, confident: best.hits >= Math.min(2, filled(best.row.cells).length) };
}

/** One name per column, never blank and never repeated, because mapping refers to columns by name. */
export function uniqueHeaders(cells: string[], columnCount: number): string[] {
  const taken = new Set<string>();
  const claim = (name: string) => { taken.add(name.toLowerCase()); return name; };
  const blanks: number[] = [];
  const out: string[] = Array.from({ length: columnCount }, () => '');
  for (let i = 0; i < columnCount; i++) {
    const name = (cells[i] ?? '').trim().slice(0, MAX_HEADER_CHARS);
    if (!name) { blanks.push(i); continue; }
    let candidate = name;
    for (let n = 2; taken.has(candidate.toLowerCase()); n++) candidate = `${name} (${n})`;
    out[i] = claim(candidate);
  }
  // After the real names, so a blank column can't take a name the file uses.
  for (const i of blanks) {
    const name = `Column ${columnLetter(i)}`;
    let candidate = name;
    for (let n = 2; taken.has(candidate.toLowerCase()); n++) candidate = `${name} (${n})`;
    out[i] = claim(candidate);
  }
  return out;
}

const QUALIFIER = 'carrier|ams|login|logon|portal|web|website|site|online|user|account|acct|agent|agency|client|insured|system|my|sign|in';
const SECRET = 'password|passwd|pwd|pw|passcode|passphrase|pin|api key|apikey|secret|secret key|access token|auth token|security answer|security question';
const CREDENTIAL_LABEL = new RegExp(`^(?:(?:${QUALIFIER}) )*(?:${SECRET})(?: (?:${QUALIFIER}|${SECRET}))*$`);

/**
 * "Password" or "Carrier Login Password" as a column name. Only the whole cell
 * counts, so a note saying "reset password" doesn't lose its column.
 * Q4: "carrier/AMS passwords should not be stored directly in The Desk."
 */
export function isCredentialLabel(cell: string): boolean {
  if (!cell || cell.length > 60) return false;
  return CREDENTIAL_LABEL.test(cell.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim());
}
