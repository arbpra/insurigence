/**
 * The Desk, Module 24: the import engine.
 *
 * Reads files built here, including hostile ones (zip bombs, entity expansion,
 * column names like "__proto__"), and stages them under temporary agencies only.
 * Run with:  npx tsx script/verify-desk-imports.ts
 */
import 'dotenv/config';
import { readFileSync } from 'fs';
import { strToU8, zipSync } from 'fflate';
import { NextRequest } from 'next/server';
import type { Prisma, PrismaClient, UserRole } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { createSession } from '../lib/auth';
import { DeskAccessError, resolveDeskScope } from '../lib/desk/access';
import {
  MAX_CELL_CHARS, MAX_IMPORT_BYTES, MAX_IMPORT_COLUMNS, MAX_IMPORT_ROWS, MAX_UNPACKED_BYTES,
  columnLetter, detectHeaderRow, isCredentialLabel, uniqueHeaders,
} from '../lib/desk/import-headers';
import { ImportFileError, isDateFormat, parseCsv, parseImportFile, parseXlsx, serialToText } from '../lib/desk/import-parse';
import {
  MAX_OPEN_IMPORTS, discardImport, getImport, getImportRows, listImports, screenCredentials, setImportHeaderRow, stageImport,
} from '../lib/desk/imports';
import { GET as listRoute, POST as uploadRoute } from '../app/api/desk/imports/route';
import { DELETE as deleteRoute, GET as oneRoute, PATCH as patchRoute } from '../app/api/desk/imports/[id]/route';
import { GET as rowsRoute } from '../app/api/desk/imports/[id]/rows/route';

let pass = 0, fail = 0;
const ok = (n: string, c: boolean) => { c ? pass++ : fail++; console.log(`  ${c ? '✓' : '✗'} ${n}`); };

const TAG = `m24test${Date.now()}`;
const cleanup = { agencyIds: [] as string[], userIds: [] as string[] };
const read = (p: string) => readFileSync(p, 'utf8');
const u8 = (s: string) => new TextEncoder().encode(s);
const csv = (s: string) => parseCsv(u8(s));
const cellsOf = (f: { rows: { cells: string[] }[] }) => f.rows.map((r) => r.cells);
const codeOf = (fn: () => unknown) => {
  try { fn(); return null; } catch (e) { if (e instanceof ImportFileError) return e.code; throw e; }
};

// ── Building workbooks ──

const CONTENT = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const ROOT_RELS = `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${CONTENT}/officeDocument" Target="xl/workbook.xml"/></Relationships>`;

interface Book {
  sheets?: { name: string; xml: string; state?: string }[];
  shared?: string;
  styles?: string;
  workbookAttrs?: string;
  prefix?: string;
  extra?: Record<string, Uint8Array>;
}

function xlsx(book: Book): Uint8Array {
  const sheets = book.sheets ?? [];
  const list = sheets.map((s, i) => `<sheet name="${s.name}" sheetId="${i + 1}" r:id="rIdS${i}"${s.state ? ` state="${s.state}"` : ''}/>`).join('');
  const rels = sheets.map((_, i) => `<Relationship Id="rIdS${i}" Type="${CONTENT}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('');
  const files: Record<string, Uint8Array> = {
    '_rels/.rels': strToU8(ROOT_RELS),
    'xl/workbook.xml': strToU8(`<?xml version="1.0"?><workbook xmlns="x" xmlns:r="${CONTENT}"><workbookPr ${book.workbookAttrs ?? ''}/><sheets>${list}</sheets></workbook>`),
    'xl/_rels/workbook.xml.rels': strToU8(`<?xml version="1.0"?><Relationships xmlns="y">${rels}<Relationship Id="rIdSt" Type="${CONTENT}/styles" Target="styles.xml"/><Relationship Id="rIdSh" Type="${CONTENT}/sharedStrings" Target="/xl/sharedStrings.xml"/></Relationships>`),
    ...book.extra,
  };
  if (book.styles) files['xl/styles.xml'] = strToU8(book.styles);
  if (book.shared) files['xl/sharedStrings.xml'] = strToU8(book.shared);
  sheets.forEach((s, i) => { files[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(s.xml); });
  return zipSync(files);
}

const sheetXml = (rows: string) => `<?xml version="1.0"?><worksheet xmlns="x"><sheetData>${rows}</sheetData></worksheet>`;
const inlineRow = (n: number, ...values: string[]) => `<row r="${n}">${values.map((v, i) => `<c r="${columnLetter(i)}${n}" t="inlineStr"><is><t>${v}</t></is></c>`).join('')}</row>`;

/** Rewrites what a zip says each file's unpacked size is. */
function lieAboutSizes(zip: Uint8Array, size: number): Uint8Array {
  const out = zip.slice();
  const view = new DataView(out.buffer);
  for (let i = 0; i + 30 < out.length; i++) {
    const sig = view.getUint32(i, true);
    if (sig === 0x04034b50) view.setUint32(i + 22, size, true);
    else if (sig === 0x02014b50) view.setUint32(i + 24, size, true);
  }
  return out;
}

function pureLogic() {
  console.log('CSV');
  ok('rows and cells', JSON.stringify(cellsOf(csv('Name,Policy\nAcme,P1\n'))) === '[["Name","Policy"],["Acme","P1"]]');
  ok('no last line ending needed', csv('a,b\nc,d').rows.length === 2);
  ok('Windows line endings', JSON.stringify(cellsOf(csv('a,b\r\nc,d\r\n'))) === '[["a","b"],["c","d"]]');
  ok('old Mac line endings', csv('a,b\rc,d\r').rows.length === 2);
  const quoted = csv('Name,Notes\n"Smith, Jones & Co","says ""hi""\nsecond line"\nNext,x\n');
  ok('commas, quotes and line breaks in quotes', quoted.rows[1].cells[0] === 'Smith, Jones & Co' && quoted.rows[1].cells[1] === 'says "hi"\nsecond line');
  ok('a row with a line break counts as one spreadsheet row', quoted.rows[2].rowNumber === 3);
  ok('a quote inside plain text stays', csv('a,5" pipe\n').rows[0].cells[1] === '5" pipe');
  ok('spaces trimmed', csv(' a , b \n').rows[0].cells.join('|') === 'a|b');
  const blanks = csv('a,b\n\n,\nc,d\n');
  ok('blank rows are left out but keep the numbering', blanks.rows.length === 2 && blanks.rows[1].rowNumber === 4);
  ok('trailing blank cells dropped', csv('a,b,,,\n').rows[0].cells.length === 2);
  ok('the widest row sets the column count', csv('a\nb,c,d\ne,f\n').columnCount === 3);
  ok('nothing but blanks gives no rows', csv('\n\n , ,\n').rows.length === 0);
  ok('a single column', JSON.stringify(cellsOf(csv('Name\nAcme\nBeta\n'))) === '[["Name"],["Acme"],["Beta"]]');

  console.log('Other delimiters and encodings');
  ok('tab', csv('a\tb\tc\n1\t2\t3\n').rows[1].cells.length === 3);
  ok('semicolon', csv('a;b;c\n1;2;3\n').rows[1].cells.length === 3);
  ok('pipe', csv('a|b|c\n1|2|3\n').rows[1].cells.length === 3);
  ok('commas inside quotes do not decide it', csv('"a,a,a";b\n"c,c,c";d\n').rows[0].cells.length === 2);
  ok('a title row does not decide it', csv('Report, for all, clients, here\na;b;c\n1;2;3\n4;5;6\n7;8;9\n10;11;12\n13;14;15\n').rows[1].cells.length === 3);
  const sep = csv('sep=;\na;b,c\n');
  ok('Excel\'s sep= line is obeyed and numbered', sep.rows[0].cells.join('|') === 'a|b,c' && sep.rows[0].rowNumber === 2);
  ok('UTF-8 with a marker', parseCsv(new Uint8Array([0xef, 0xbb, 0xbf, ...u8('Café,b\n')])).rows[0].cells[0] === 'Café');
  ok('Windows encoding', parseCsv(new Uint8Array([0x43, 0x61, 0x66, 0xe9, 0x2c, 0x62])).rows[0].cells[0] === 'Café');
  const utf16 = (bytes: number[]) => parseCsv(new Uint8Array(bytes)).rows[0]?.cells.join('|');
  ok('UTF-16 little endian with a marker', utf16([0xff, 0xfe, 0x61, 0, 0x2c, 0, 0x62, 0]) === 'a|b');
  ok('UTF-16 big endian with a marker', utf16([0xfe, 0xff, 0, 0x61, 0, 0x2c, 0, 0x62]) === 'a|b');
  ok('UTF-16 with no marker', utf16([0x61, 0, 0x2c, 0, 0x62, 0]) === 'a|b');
  ok('binary data is refused', codeOf(() => parseCsv(new Uint8Array([0x61, 0x62, 0x63, 0, 0x64, 0x65]))) === 'UNREADABLE');

  console.log('CSV limits');
  ok('an unclosed quote names its row', (() => {
    try { csv('a,b\nc,"never closed\nd,e\n'); return false; } catch (e) { return e instanceof ImportFileError && e.code === 'UNCLOSED_QUOTE' && e.message.includes('row 2'); }
  })());
  ok('an unclosed quote across a long file stops early', codeOf(() => csv(`a,"${'x\n'.repeat(MAX_CELL_CHARS)}`)) === 'UNCLOSED_QUOTE');
  ok('a cell at the limit is fine', csv(`${'x'.repeat(MAX_CELL_CHARS)},b\n`).rows.length === 1);
  ok('a cell past it is refused', codeOf(() => csv(`${'x'.repeat(MAX_CELL_CHARS + 1)},b\n`)) === 'CELL_TOO_LONG');
  const manyRows = (n: number) => `a\n${'b\n'.repeat(n - 1)}`;
  ok('the row limit is allowed', csv(manyRows(MAX_IMPORT_ROWS)).rows.length === MAX_IMPORT_ROWS);
  ok('one more is refused', codeOf(() => csv(manyRows(MAX_IMPORT_ROWS + 1))) === 'TOO_MANY_ROWS');
  const manyColumns = (n: number) => Array.from({ length: n }, (_, i) => `c${i}`).join(',');
  ok('the column limit is allowed', csv(manyColumns(MAX_IMPORT_COLUMNS)).columnCount === MAX_IMPORT_COLUMNS);
  ok('one more is refused', codeOf(() => csv(manyColumns(MAX_IMPORT_COLUMNS + 1))) === 'TOO_MANY_COLUMNS');
  ok('thousands of delimiters on a row are stopped', codeOf(() => csv(`${','.repeat(1_000_000)}x`)) === 'TOO_MANY_COLUMNS');

  console.log('XLSX');
  const basic = parseXlsx(xlsx({
    sheets: [{ name: 'Book', xml: sheetXml('<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row><row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2"><v>1250.5</v></c></row>') }],
    shared: '<sst><si><t>Name</t></si><si><t>Premium</t></si><si><r><t>Acme </t></r><r><rPr><b/></rPr><t>Inc</t></r><rPh sb="0" eb="1"><t>ignored</t></rPh></si></sst>',
  }));
  ok('shared text, numbers, styled runs', JSON.stringify(cellsOf(basic)) === '[["Name","Premium"],["Acme Inc","1250.5"]]');
  ok('names the sheet', basic.format === 'XLSX' && basic.sheetName === 'Book' && basic.sheetNames.join() === 'Book');
  const sparse = parseXlsx(xlsx({ sheets: [{ name: 'S', xml: sheetXml('<row r="3"><c r="C3" t="inlineStr"><is><t>x</t></is></c><c r="AA3" t="str"><v>y</v></c></row><row r="7"><c r="A7" t="b"><v>1</v></c><c r="B7" t="b"><v>0</v></c><c r="C7" t="e"><v>#N/A</v></c></row>') }] }));
  ok('gaps, row numbers and far columns kept', sparse.rows[0].rowNumber === 3 && sparse.rows[0].cells[2] === 'x' && sparse.rows[0].cells[0] === '' && sparse.rows[0].cells[26] === 'y' && sparse.columnCount === 27);
  ok('true / false and errors as text', sparse.rows[1].rowNumber === 7 && sparse.rows[1].cells.join() === 'TRUE,FALSE,#N/A');
  const noRefs = parseXlsx(xlsx({ sheets: [{ name: 'S', xml: sheetXml('<row><c t="inlineStr"><is><t>a</t></is></c><c t="inlineStr"><is><t>b</t></is></c></row><row><c t="inlineStr"><is><t>c</t></is></c></row>') }] }));
  ok('positions not written out', noRefs.rows[0].cells.join() === 'a,b' && noRefs.rows[1].rowNumber === 2);
  const prefixed = parseXlsx(xlsx({ sheets: [{ name: 'S', xml: '<x:worksheet xmlns:x="x"><x:sheetData><x:row r="1"><x:c r="A1" t="inlineStr"><x:is><x:t>pre</x:t></x:is></x:c></x:row></x:sheetData></x:worksheet>' }] }));
  ok('XML name prefixes', prefixed.rows[0].cells[0] === 'pre');
  const escapes = parseXlsx(xlsx({ sheets: [{ name: 'S', xml: sheetXml('<row r="1"><c r="A1" t="inlineStr"><is><t>A &amp; B_x000D_C</t></is></c><c r="B1" t="inlineStr"><is><t><![CDATA[<raw>]]></t></is></c></row>') }] }));
  ok('entities, Excel escapes and CDATA', escapes.rows[0].cells[0] === 'A & B\rC' && escapes.rows[0].cells[1] === '<raw>');
  const formula = parseXlsx(xlsx({ sheets: [{ name: 'S', xml: sheetXml('<row r="1"><c r="A1"><f>1+1</f><v>2</v></c><c r="B1" t="str"><f>"a"&amp;"b"</f><v>ab</v></c></row>') }] }));
  ok('formulas: the result, not the formula', formula.rows[0].cells.join() === '2,ab');
  const blankOnly = parseXlsx(xlsx({ sheets: [{ name: 'S', xml: sheetXml('<row r="1"><c r="A1" s="1"/><c r="B1"><v></v></c></row>') }] }));
  ok('formatted but empty rows are left out', blankOnly.rows.length === 0);

  console.log('Numbers and dates');
  const styles = `<styleSheet><numFmts count="3"><numFmt numFmtId="164" formatCode="mm/dd/yy;@"/><numFmt numFmtId="165" formatCode="00000"/><numFmt numFmtId="166" formatCode="&quot;Days: &quot;#,##0"/></numFmts><cellXfs><xf numFmtId="0"/><xf numFmtId="14"/><xf numFmtId="164"/><xf numFmtId="165"/><xf numFmtId="166"/><xf numFmtId="4"/></cellXfs></styleSheet>`;
  const styled = (c: string, attrs = '') => parseXlsx(xlsx({ styles, workbookAttrs: attrs, sheets: [{ name: 'S', xml: sheetXml(`<row r="1">${c}</row>`) }] })).rows[0].cells;
  ok('built-in date format', styled('<c r="A1" s="1"><v>46023</v></c>')[0] === '2026-01-01');
  ok('custom date format', styled('<c r="A1" s="2"><v>46023</v></c>')[0] === '2026-01-01');
  ok('date with a time', styled('<c r="A1" s="1"><v>46023.5</v></c>')[0] === '2026-01-01T12:00:00');
  ok('workbooks counted from 1904', styled('<c r="A1" s="1"><v>44561</v></c>', 'date1904="1"')[0] === '2026-01-01');
  ok('a plain number stays a number', styled('<c r="A1"><v>46023</v></c>')[0] === '46023');
  ok('quoted words in a format aren\'t a date', styled('<c r="A1" s="4"><v>30</v></c>')[0] === '30');
  ok('a money format isn\'t a date', styled('<c r="A1" s="5"><v>1234.5</v></c>')[0] === '1234.5');
  ok('leading zeros from a 00000 format return', styled('<c r="A1" s="3"><v>742</v></c>')[0] === '00742');
  ok('floating point noise removed', styled('<c r="A1"><v>1234.5000000000002</v></c>')[0] === '1234.5');
  ok('long ids are not rounded', styled('<c r="A1"><v>12345678901234567890</v></c>')[0] === '12345678901234567890');
  ok('date cells stored as text', styled('<c r="A1" t="d"><v>2026-03-04</v></c>')[0] === '2026-03-04');
  ok('Excel\'s day numbers: 1900 start', serialToText(1, false) === '1900-01-01' && serialToText(59, false) === '1900-02-28' && serialToText(61, false) === '1900-03-01');
  ok('its leap day that never was stays a number', serialToText(60, false) === null);
  ok('nonsense isn\'t a date', serialToText(-1, false) === null && serialToText(99_999_999, false) === null);
  ok('rounding to the next day', serialToText(46023.999999999, false) === '2026-01-02');
  ok('a time alone', serialToText(0.25, false) === '06:00:00');
  ok('format codes', isDateFormat('yyyy-mm-dd') && isDateFormat('[$-409]m/d/yy h:mm AM/PM;@') && !isDateFormat('General') && !isDateFormat('#,##0.00') && !isDateFormat('[Red]0.00') && !isDateFormat('"Mon"0') && !isDateFormat('_($* #,##0_)'));

  console.log('Choosing a sheet');
  const two = (extra: Partial<Book> = {}) => xlsx({ sheets: [
    { name: 'Hidden', state: 'hidden', xml: sheetXml(inlineRow(1, 'hidden')) },
    { name: 'Empty', xml: sheetXml('') },
    { name: 'Book', xml: sheetXml(inlineRow(1, 'book')) },
    { name: 'Other', xml: sheetXml(inlineRow(1, 'other')) },
  ], ...extra });
  ok('the first visible sheet with anything in it', parseXlsx(two()).rows[0].cells[0] === 'book');
  ok('hidden sheets are not offered', parseXlsx(two()).sheetNames.join() === 'Empty,Book,Other');
  ok('a named sheet', parseXlsx(two(), 'Other').rows[0].cells[0] === 'other');
  ok('a hidden sheet can\'t be named', codeOf(() => parseXlsx(two(), 'Hidden')) === 'NO_SUCH_SHEET');
  ok('a sheet that isn\'t there', codeOf(() => parseXlsx(two(), 'Nope')) === 'NO_SUCH_SHEET');
  ok('all hidden: says so', codeOf(() => parseXlsx(xlsx({ sheets: [{ name: 'H', state: 'hidden', xml: sheetXml(inlineRow(1, 'x')) }] }))) === 'NO_VISIBLE_SHEET');

  console.log('Hostile files');
  const bomb = xlsx({ sheets: [{ name: 'S', xml: sheetXml('') }], extra: { 'xl/huge.xml': new Uint8Array(MAX_UNPACKED_BYTES + 1) } });
  ok('the bomb really is small', bomb.length < 1024 * 1024);
  ok('a zip bomb stops at the limit', codeOf(() => parseXlsx(bomb)) === 'TOO_LARGE_UNPACKED');
  ok('and with false sizes declared', codeOf(() => parseXlsx(lieAboutSizes(bomb, 10))) === 'TOO_LARGE_UNPACKED');
  ok('many small entries are counted together', codeOf(() => parseXlsx(xlsx({ sheets: [{ name: 'S', xml: sheetXml('') }], extra: Object.fromEntries(Array.from({ length: 5 }, (_, i) => [`xl/part${i}.xml`, new Uint8Array(MAX_UNPACKED_BYTES / 4)])) }))) === 'TOO_LARGE_UNPACKED');
  ok('huge files that aren\'t XML are never unpacked', parseXlsx(xlsx({ sheets: [{ name: 'S', xml: sheetXml(inlineRow(1, 'ok')) }], extra: { 'xl/media/huge.png': new Uint8Array(MAX_UNPACKED_BYTES + 1) } })).rows[0].cells[0] === 'ok');
  const withEntries = (n: number) => xlsx({ sheets: [{ name: 'S', xml: sheetXml(inlineRow(1, 'ok')) }], extra: Object.fromEntries(Array.from({ length: n }, (_, i) => [`e${i}`, new Uint8Array(0)])) });
  ok('a workbook near the entry limit still reads', parseXlsx(withEntries(1_990)).rows[0].cells[0] === 'ok');
  ok('over it: refused by the limit', codeOf(() => parseXlsx(withEntries(2_001))) === 'TOO_LARGE_UNPACKED');
  ok('far over it: the same, with no stack overflow', codeOf(() => parseXlsx(withEntries(50_000))) === 'TOO_LARGE_UNPACKED');
  const laughs = '<?xml version="1.0"?><!DOCTYPE lolz [<!ENTITY a "aaaaaaaaaa"><!ENTITY b "&a;&a;&a;&a;&a;&a;&a;&a;">]><worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>&b;</t></is></c></row></sheetData></worksheet>';
  const harmlessLooking = '<?xml version="1.0"?><!DOCTYPE worksheet><worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>x</t></is></c></row></sheetData></worksheet>';
  ok('any document type at all is refused', codeOf(() => parseXlsx(xlsx({ sheets: [{ name: 'S', xml: harmlessLooking }] }))) === 'UNREADABLE');
  ok('entity expansion refused', codeOf(() => parseXlsx(xlsx({ sheets: [{ name: 'S', xml: laughs }] }))) === 'UNREADABLE');
  const xxe = '<?xml version="1.0"?><!DOCTYPE foo [<!ENTITY x SYSTEM "file:///c:/windows/win.ini">]><worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>&x;</t></is></c></row></sheetData></worksheet>';
  ok('outside references refused', codeOf(() => parseXlsx(xlsx({ sheets: [{ name: 'S', xml: xxe }] }))) === 'UNREADABLE');
  ok('in the shared text too', codeOf(() => parseXlsx(xlsx({ shared: laughs, sheets: [{ name: 'S', xml: sheetXml('') }] }))) === 'UNREADABLE');
  ok('broken XML', codeOf(() => parseXlsx(xlsx({ sheets: [{ name: 'S', xml: '<worksheet><sheetData><row>' }] }))) === 'UNREADABLE');
  ok('a zip with no workbook', codeOf(() => parseXlsx(zipSync({ 'a.xml': strToU8('<a/>') }))) === 'UNREADABLE');
  ok('a damaged zip', codeOf(() => parseXlsx(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4, 5, 6, 7, 8, 9, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]))) === 'UNREADABLE');
  ok('too many columns in a sheet', codeOf(() => parseXlsx(xlsx({ sheets: [{ name: 'S', xml: sheetXml(`<row r="1"><c r="${columnLetter(MAX_IMPORT_COLUMNS)}1" t="inlineStr"><is><t>x</t></is></c></row>`) }] }))) === 'TOO_MANY_COLUMNS');
  ok('too many rows in a sheet', codeOf(() => parseXlsx(xlsx({ sheets: [{ name: 'S', xml: sheetXml(Array.from({ length: MAX_IMPORT_ROWS + 1 }, (_, i) => inlineRow(i + 1, 'x')).join('')) }] }))) === 'TOO_MANY_ROWS');
  ok('an over-long cell in a sheet', codeOf(() => parseXlsx(xlsx({ sheets: [{ name: 'S', xml: sheetXml(inlineRow(1, 'x'.repeat(MAX_CELL_CHARS + 1))) }] }))) === 'CELL_TOO_LONG');

  console.log('Choosing how to read a file');
  const book = xlsx({ sheets: [{ name: 'S', xml: sheetXml(inlineRow(1, 'x')) }] });
  ok('.xlsx', parseImportFile(book, 'a.XLSX').format === 'XLSX');
  ok('.xlsm: the macros are never unpacked', parseImportFile(xlsx({ sheets: [{ name: 'S', xml: sheetXml(inlineRow(1, 'x')) }], extra: { 'xl/vbaProject.bin': new Uint8Array(10) } }), 'a.xlsm').rows.length === 1);
  ok('a workbook named .csv still reads as one', parseImportFile(book, 'a.csv').format === 'XLSX');
  ok('.csv, .tsv, .txt', ['a.csv', 'a.tsv', 'a.txt'].every((n) => parseImportFile(u8('a,b'), n).format === 'CSV'));
  ok('text named .xlsx is refused', codeOf(() => parseImportFile(u8('a,b'), 'a.xlsx')) === 'UNREADABLE');
  ok('.xls explains itself', codeOf(() => parseImportFile(u8('a,b'), 'a.xls')) === 'OLD_OR_PROTECTED');
  const ole = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
  ok('an old workbook, whatever it\'s called', codeOf(() => parseImportFile(ole, 'a.csv')) === 'OLD_OR_PROTECTED');
  ok('a password-protected .xlsx says so', (() => { try { parseImportFile(ole, 'a.xlsx'); return false; } catch (e) { return e instanceof ImportFileError && e.message.includes('password protected'); } })());
  ok('other types refused', ['a.pdf', 'a.exe', 'noextension', 'a.csv.exe'].every((n) => codeOf(() => parseImportFile(u8('a,b'), n)) === 'UNSUPPORTED_TYPE'));
  ok('empty refused', codeOf(() => parseImportFile(new Uint8Array(0), 'a.csv')) === 'EMPTY_FILE');
  ok('over the size limit refused', codeOf(() => parseImportFile(new Uint8Array(MAX_IMPORT_BYTES + 1), 'a.csv')) === 'TOO_LARGE');

  console.log('Finding the column names');
  const rowsOf = (...rows: string[][]) => rows.map((cells, i) => ({ rowNumber: i + 1, cells }));
  ok('the first row, normally', JSON.stringify(detectHeaderRow(rowsOf(['Client Name', 'Policy Number', 'Carrier'], ['Acme', 'P1', 'Hartford']))) === '{"headerRow":1,"confident":true}');
  ok('below a report title and date', detectHeaderRow(rowsOf(['Book of Business Report'], ['Run date', '2026-01-05'], [], ['Client Name', 'Policy Number', 'Carrier', 'Exp Date'], ['Acme', 'P1', 'Hartford', '2026-01-01'])).headerRow === 4);
  ok('the real row number, when blanks were left out', detectHeaderRow([{ rowNumber: 6, cells: ['Insured', 'Premium'] }, { rowNumber: 9, cells: ['Acme', '500'] }]).headerRow === 6);
  ok('a data row with a number never wins', detectHeaderRow(rowsOf(['Acme', '500'], ['Beta', '600'])).confident === false);
  ok('no column names: the first row, as a guess', JSON.stringify(detectHeaderRow(rowsOf(['Acme', 'Hartford'], ['Beta', 'Travelers']))) === '{"headerRow":1,"confident":false}');
  ok('insurance words beat earlier data text', detectHeaderRow(rowsOf(['Foo', 'Bar'], ['Name', 'Carrier'], ['Acme', 'Hartford'])).headerRow === 2);
  ok('repeated values aren\'t column names', detectHeaderRow(rowsOf(['Name', 'Name'], ['Client', 'Carrier'])).headerRow === 2);
  ok('a single column', detectHeaderRow(rowsOf(['Insured Name'], ['Acme'])).headerRow === 1);
  ok('a table low in a long file is out of reach, and is a guess', detectHeaderRow([...Array.from({ length: 25 }, (_, i) => ({ rowNumber: i + 1, cells: ['1', '2'] })), { rowNumber: 26, cells: ['Name', 'Carrier'] }]).confident === false);
  ok('a title with insurance words doesn\'t beat the wider row below it', detectHeaderRow(rowsOf(['Client Policy Report'], ['Insured', 'Foo', 'Bar', 'Baz'], ['Acme', 'x', 'y', 'z'])).headerRow === 2);
  ok('a row of numbers isn\'t taken, even first', detectHeaderRow(rowsOf(['100', '200'], ['Foo', 'Bar'])).headerRow === 2);
  ok('a row with a date isn\'t taken, even with an insurance word', detectHeaderRow(rowsOf(['Name', '2026-01-05'], ['Foo', 'Bar'])).headerRow === 2);
  ok('a very long cell isn\'t a column name', detectHeaderRow(rowsOf(['x'.repeat(121), 'Name'], ['Foo', 'Bar'])).headerRow === 2);
  ok('an empty file', detectHeaderRow([]).headerRow === 0);

  console.log('Naming columns');
  ok('blank columns get a letter', uniqueHeaders(['Name', '', 'Phone'], 3).join() === 'Name,Column B,Phone');
  ok('repeats are numbered', uniqueHeaders(['Phone', 'phone', 'Phone'], 3).join() === 'Phone,phone (2),Phone (3)');
  ok('short rows are filled out', uniqueHeaders(['A'], 3).join() === 'A,Column B,Column C');
  ok('a blank can\'t take a name in use', uniqueHeaders(['', 'Column A'], 2).join() === 'Column A (2),Column A');
  ok('long names cut', uniqueHeaders(['x'.repeat(500)], 1)[0].length === 120);
  ok('every name differs, however it\'s tried', new Set(uniqueHeaders(['a', 'a (2)', 'a', 'A', ''], 5).map((h) => h.toLowerCase())).size === 5);
  ok('column letters', columnLetter(0) === 'A' && columnLetter(25) === 'Z' && columnLetter(26) === 'AA' && columnLetter(199) === 'GR');

  console.log('Leaving out credentials');
  for (const label of ['Password', 'password:', 'Carrier Password', 'Portal Login Password', 'AMS PWD', 'Passcode', 'API Key', 'Security Answer', 'Password (Carrier)', 'PIN']) {
    ok(`"${label}" is a credential column`, isCredentialLabel(label));
  }
  for (const label of ['Reset password', 'Notes', 'Passport', 'Password manager location', 'Login', 'Username', 'Compass', 'Pin code area', '']) {
    ok(`"${label}" is not`, !isCredentialLabel(label));
  }
  const screened = screenCredentials(rowsOf(['Report'], ['Name', 'Carrier Password', 'Notes'], ['Acme', 'hunter2', 'password: abc123'], ['Beta', 'qwerty', 'reset password monthly'], ['Password only row']));
  ok('the whole column goes, wherever its label is', screened.columns.join() === 'B' && !JSON.stringify(screened.rows).includes('hunter2') && !JSON.stringify(screened.rows).includes('qwerty') && !JSON.stringify(screened.rows).includes('Carrier Password'));
  ok('a cell reading like a password goes, its row stays', screened.cells === 1 && !JSON.stringify(screened.rows).includes('abc123') && screened.rows.some((r) => r.cells[0] === 'Acme'));
  ok('mentions without a value stay', JSON.stringify(screened.rows).includes('reset password monthly'));
  ok('a row left with nothing goes', screenCredentials(rowsOf(['Name'], ['pwd: x'])).rows.length === 1);
  ok('labels far down don\'t count', screenCredentials([...Array.from({ length: 25 }, (_, i) => ({ rowNumber: i + 1, cells: ['x', 'y'] })), { rowNumber: 26, cells: ['a', 'Password'] }]).columns.length === 0);

  console.log('The code');
  ok('the shared logic imports nothing', !/^import /m.test(read('lib/desk/import-headers.ts')));
  ok('the file itself is not stored', !read('lib/desk/imports.ts').includes('putObject'));
}

const FILE = 'Name,Policy,Carrier\nAcme,P1,Hartford\nAcme,P2,Travelers\nBeta,P3,Chubb\n';
const TITLED = 'Book of business\nRun date,2026-01-05\n\nClient Name,Policy Number,Carrier\nAcme,P1,Hartford\nBeta,P2,Chubb\n';

(async () => {
  try {
    pureLogic();

    const mkAgency = async (n: string, deskEnabled = true) => { const a = await prisma.agency.create({ data: { name: `${TAG} ${n}`, deskEnabled } }); cleanup.agencyIds.push(a.id); return a; };
    const mkUser = async (n: string, role: UserRole, agencyId: string | null = null) => {
      const u = await prisma.user.create({ data: { email: `${TAG}-${n}@example.test`, role, agencyId, firstName: n, passwordHash: `secret-${TAG}`, mustChangePassword: false } });
      cleanup.userIds.push(u.id); return u;
    };
    const A = await mkAgency('A');
    const B = await mkAgency('B');
    const Off = await mkAgency('Off', false);
    const admin = await mkUser('admin', 'ADMIN', A.id);
    const producer = await mkUser('producer', 'AGENT', A.id);
    const csr = await mkUser('csr', 'CSR', A.id);
    const adminB = await mkUser('admin-b', 'ADMIN', B.id);
    const am = await mkUser('am', 'ACCOUNT_MANAGER');
    const ops = await mkUser('ops', 'DESK_ADMIN');
    const va = await mkUser('va', 'DESK_VA');
    await prisma.agencyDeskAssignment.create({ data: { agencyId: A.id, primaryAmId: am.id } });

    const sAdmin = await resolveDeskScope(prisma, admin.id);
    const sProducer = await resolveDeskScope(prisma, producer.id);
    const sCsr = await resolveDeskScope(prisma, csr.id);
    const sB = await resolveDeskScope(prisma, adminB.id);
    const sAm = await resolveDeskScope(prisma, am.id);
    const sOps = await resolveDeskScope(prisma, ops.id);
    const sVa = await resolveDeskScope(prisma, va.id);
    const CTX = { ip: '203.0.113.24', userAgent: 'verify' };
    const refusal = async (fn: () => Promise<unknown>) => {
      try { await fn(); return null; } catch (e) { if (e instanceof DeskAccessError) return e; throw e; }
    };
    const status = async (fn: () => Promise<unknown>) => (await refusal(fn))?.status ?? 200;
    const upload = (content: string | Uint8Array, fileName = 'book.csv') => ({ fileName, bytes: typeof content === 'string' ? u8(content) : content });
    const stage = (content: string | Uint8Array, fileName?: string, scope = sAdmin) => stageImport(prisma, scope, upload(content, fileName), CTX);
    const logged = (action: string, entityId: string) => prisma.deskAuditLog.count({ where: { action, entityId } });
    const refusedBy = (actorId: string) => prisma.deskAuditLog.count({ where: { action: 'access.denied', actorId } });

    console.log('Staging a file');
    const b1 = await stage(FILE);
    ok('ready for mapping', b1.status === 'STAGED' && b1.format === 'CSV' && b1.fileName === 'book.csv' && b1.fileSize === FILE.length);
    ok('column names, rows and count', b1.headers.join() === 'Name,Policy,Carrier' && b1.rowCount === 3 && b1.columnCount === 3 && b1.headerRow === 1 && b1.headerConfident);
    const stored = await prisma.importRow.findMany({ where: { batchId: b1.id }, orderBy: { rowNumber: 'asc' } });
    ok('each row stored with its number, in this agency', stored.length === 4 && stored[1].rowNumber === 2 && stored.every((r) => r.agencyId === A.id && r.status === 'PENDING'));
    ok('cells line up with the column names', JSON.stringify(stored[1].data) === '["Acme","P1","Hartford"]');
    ok('uploaded by the person asking', (await prisma.importBatch.findUniqueOrThrow({ where: { id: b1.id } })).uploadedById === admin.id);
    ok('nothing reaches the book', await prisma.insuredAccount.count({ where: { agencyId: A.id } }) === 0);
    ok('logged with counts, not contents', await (async () => {
      const entry = await prisma.deskAuditLog.findFirst({ where: { action: 'import.staged', entityId: b1.id } });
      const meta = JSON.stringify(entry?.metadata);
      return !!entry && entry.ipAddress === CTX.ip && entry.agencyId === A.id && meta.includes('"rowCount":3') && !meta.includes('Acme') && !meta.includes('book.csv');
    })());

    const titled = await stage(TITLED);
    ok('the column names found below a title', titled.headerRow === 4 && titled.headers.join() === 'Client Name,Policy Number,Carrier' && titled.rowCount === 2);
    const wbBatch = await stage(xlsx({ sheets: [{ name: 'Clients', xml: sheetXml(inlineRow(1, 'Insured', 'Carrier') + inlineRow(2, 'Acme', 'Chubb')) }, { name: 'Other', xml: sheetXml(inlineRow(1, 'x')) }] }), 'book.xlsx');
    ok('a workbook', wbBatch.format === 'XLSX' && wbBatch.sheetName === 'Clients' && wbBatch.sheetNames.join() === 'Clients,Other' && wbBatch.rowCount === 1);
    const chosen = await stageImport(prisma, sAdmin, { ...upload(xlsx({ sheets: [{ name: 'Clients', xml: sheetXml(inlineRow(1, 'Insured')) }, { name: 'Other', xml: sheetXml(inlineRow(1, 'Carrier') + inlineRow(2, 'Chubb')) }] }), 'book.xlsx'), sheet: 'Other' }, CTX);
    ok('a sheet of the user\'s choosing', chosen.sheetName === 'Other' && chosen.headers.join() === 'Carrier');
    const odd = await stage('__proto__,constructor,$where,a.b\n1,2,3,4\n');
    ok('column names that could do harm are only text', odd.headers.join() === '__proto__,constructor,$where,a.b' && !('polluted' in {}));
    const oddRow = await prisma.importRow.findUnique({ where: { batchId_rowNumber: { batchId: odd.id, rowNumber: 2 } } });
    ok('and the row is stored', JSON.stringify(oddRow?.data) === '["1","2","3","4"]');
    const commandLike = await stage('Name,Other\n"{""$oid"":""x""}","{""$set"":{""a"":1}}"\n$where,$gt\n');
    const commandRows = await prisma.importRow.findMany({ where: { batchId: commandLike.id }, orderBy: { rowNumber: 'asc' } });
    ok('cells that look like database commands stay text', JSON.stringify(commandRows.map((r) => r.data)) === JSON.stringify([['Name', 'Other'], ['{"$oid":"x"}', '{"$set":{"a":1}}'], ['$where', '$gt']]));
    await discardImport(prisma, sAdmin, commandLike.id, CTX);
    const other = await stage(FILE);
    const removing = await stage(FILE);
    await discardImport(prisma, sAdmin, removing.id, CTX);
    ok('discarding leaves other imports\' rows', await prisma.importRow.count({ where: { batchId: other.id } }) === 4);
    await discardImport(prisma, sAdmin, other.id, CTX);
    const path = await stage(FILE, '..\\..\\windows\\evil\u0000.csv');
    ok('a file name can\'t carry a path or control characters', path.fileName === 'evil.csv');
    await discardImport(prisma, sAdmin, path.id, CTX);
    for (const id of [odd.id, chosen.id, wbBatch.id]) await discardImport(prisma, sAdmin, id, CTX);

    console.log('Credentials in a file');
    const creds = await stage('Name,Carrier Password,Notes\nAcme,hunter2,pwd: abc123\nBeta,qwerty,fine\n');
    const credRows = JSON.stringify(await prisma.importRow.findMany({ where: { batchId: creds.id } }));
    ok('never stored', !credRows.includes('hunter2') && !credRows.includes('qwerty') && !credRows.includes('abc123'));
    ok('the rest is', credRows.includes('Acme') && credRows.includes('fine'));
    ok('reported, without the values', JSON.stringify(creds.screened) === '{"columns":["B"],"cells":1}');
    ok('its name is gone too', creds.headers.join() === 'Name,Column B,Notes');
    ok('changing the header row can\'t bring it back', (await setImportHeaderRow(prisma, sAdmin, creds.id, { headerRow: 0 }, CTX)).headers.join() === 'Column A,Column B,Column C');
    const credLog = await prisma.deskAuditLog.findFirst({ where: { action: 'import.staged', entityId: creds.id } });
    ok('the log has counts only', (credLog?.metadata as Record<string, unknown>).screenedColumns === 1 && !JSON.stringify(credLog?.metadata).includes('hunter2'));
    await discardImport(prisma, sAdmin, creds.id, CTX);

    console.log('Refused files');
    const refusedFile = async (content: string | Uint8Array, fileName: string) => (await refusal(() => stage(content, fileName)))?.code;
    const before = await prisma.importBatch.count({ where: { agencyId: A.id } });
    const rejectsBefore = await prisma.deskAuditLog.count({ where: { action: 'import.rejected', agencyId: A.id } });
    ok('a damaged workbook: says why', await refusedFile(u8('not a workbook'), 'a.xlsx') === 'UNREADABLE');
    ok('an old .xls', await refusedFile('x', 'a.xls') === 'OLD_OR_PROTECTED');
    ok('an empty file', await refusedFile(new Uint8Array(0), 'a.csv') === 'EMPTY_FILE');
    ok('only blank rows', await refusedFile('\n\n,,\n', 'a.csv') === 'NO_ROWS');
    ok('only a password column', await refusedFile('Password\nhunter2\n', 'a.csv') === 'NO_ROWS');
    ok('a named sheet that isn\'t there', (await refusal(() => stageImport(prisma, sAdmin, { ...upload(xlsx({ sheets: [{ name: 'S', xml: sheetXml(inlineRow(1, 'x')) }] }), 'a.xlsx'), sheet: 'Nope' }, CTX)))?.code === 'NO_SUCH_SHEET');
    ok('none leaves anything behind', await prisma.importBatch.count({ where: { agencyId: A.id } }) === before);
    const rejects = await prisma.deskAuditLog.findMany({ where: { action: 'import.rejected', agencyId: A.id } });
    ok('each is logged, without the file\'s contents', rejects.length - rejectsBefore === 6 && !JSON.stringify(rejects.map((r) => r.metadata)).includes('hunter2'));

    console.log('Who may import');
    const count = () => prisma.importBatch.count({ where: { agencyId: A.id } });
    const c0 = await count();
    ok('a Producer: 403', await status(() => stage(FILE, 'a.csv', sProducer)) === 403);
    ok('a CSR: 403', await status(() => stage(FILE, 'a.csv', sCsr)) === 403);
    ok('a VA: 403', await status(() => stage(FILE, 'a.csv', sVa)) === 403);
    ok('an Account Manager: 403', await status(() => stage(FILE, 'a.csv', sAm)) === 403);
    ok('an Account Manager naming their own agency: 403', await status(() => stageImport(prisma, sAm, { ...upload(FILE), agencyId: A.id }, CTX)) === 403);
    ok('a VA naming an agency: 403', await status(() => stageImport(prisma, sVa, { ...upload(FILE), agencyId: A.id }, CTX)) === 403);
    ok('an Account Manager can\'t list their agency\'s imports', await status(() => listImports(prisma, sAm, { agencyId: A.id }, CTX)) === 403);
    ok('an Insurigence admin must choose an agency', await status(() => stage(FILE, 'a.csv', sOps)) === 400);
    ok('none of them stored anything', await count() === c0);
    ok('refusals are logged', await refusedBy(producer.id) >= 1 && await refusedBy(am.id) >= 1);
    const named = await stageImport(prisma, sOps, { ...upload(FILE), agencyId: A.id }, CTX);
    ok('an Insurigence admin, for a named agency', named.agencyId === A.id);
    await discardImport(prisma, sOps, named.id, CTX);
    ok('not an agency without The Desk', await status(() => stageImport(prisma, sOps, { ...upload(FILE), agencyId: Off.id }, CTX)) === 400);
    ok('an agency admin can\'t name another agency', (await stageImport(prisma, sB, { ...upload(FILE), agencyId: A.id }, CTX)).agencyId === B.id);

    console.log('Other agencies');
    ok('another agency\'s import: 404', await status(() => getImport(prisma, sB, b1.id, CTX)) === 404);
    ok('its rows: 404', await status(() => getImportRows(prisma, sB, b1.id, {}, CTX)) === 404);
    ok('changing it: 404', await status(() => setImportHeaderRow(prisma, sB, b1.id, { headerRow: 2 }, CTX)) === 404);
    ok('discarding it: 404', await status(() => discardImport(prisma, sB, b1.id, CTX)) === 404);
    ok('the Producer and Account Manager: 404', await status(() => getImport(prisma, sProducer, b1.id, CTX)) === 404 && await status(() => getImportRows(prisma, sAm, b1.id, {}, CTX)) === 404);
    ok('and it is untouched', (await getImport(prisma, sAdmin, b1.id)).status === 'STAGED');
    ok('logged', await refusedBy(adminB.id) >= 4);
    ok('a malformed id: 404', await status(() => getImport(prisma, sAdmin, 'nope', CTX)) === 404);
    ok('the list stays in the agency', (await listImports(prisma, sB, {}, CTX)).imports.every((b) => b.agencyId === B.id) && !(await listImports(prisma, sB, {}, CTX)).imports.some((b) => b.id === b1.id));
    ok('an Insurigence admin lists a named agency', (await listImports(prisma, sOps, { agencyId: A.id }, CTX)).imports.some((b) => b.id === b1.id));
    ok('the Producer can\'t list', await status(() => listImports(prisma, sProducer, {}, CTX)) === 403);

    console.log('Reading rows');
    const page1 = await getImportRows(prisma, sAdmin, titled.id, {}, CTX);
    ok('only those under the column names', page1.total === 2 && page1.rows[0].rowNumber === 5 && page1.rows[0].cells.join() === 'Acme,P1,Hartford');
    const everything = await getImportRows(prisma, sAdmin, titled.id, { all: true }, CTX);
    ok('or everything, to choose a different row', everything.total === 5 && everything.rows[0].cells[0] === 'Book of business');
    const paged = await getImportRows(prisma, sAdmin, b1.id, { page: '2', pageSize: '2' }, CTX);
    ok('in pages', paged.rows.length === 1 && paged.rows[0].rowNumber === 4 && paged.total === 3);
    ok('page sizes are capped', (await getImportRows(prisma, sAdmin, b1.id, { pageSize: '100000' }, CTX)).pageSize === 100);
    ok('nonsense paging falls back', (await getImportRows(prisma, sAdmin, b1.id, { page: '-1', pageSize: 'x' }, CTX)).page === 1);
    ok('viewing rows is logged', await logged('import.viewed', titled.id) === 2);

    console.log('Correcting the header row');
    const v0 = await getImport(prisma, sAdmin, titled.id);
    await prisma.importBatch.update({ where: { id: titled.id }, data: { columnMapping: { 'Client Name': 'name' } } });
    const stale = await refusal(() => setImportHeaderRow(prisma, sAdmin, titled.id, { headerRow: 5, version: v0.version }, CTX));
    ok('an out-of-date screen is refused', stale?.status === 409 && stale.code === 'CHANGED_ELSEWHERE');
    const v1 = await getImport(prisma, sAdmin, titled.id);
    const moved = await setImportHeaderRow(prisma, sAdmin, titled.id, { headerRow: 5, version: v1.version }, CTX);
    ok('a different row', moved.headerRow === 5 && moved.headers.join() === 'Acme,P1,Hartford' && moved.rowCount === 1 && moved.headerConfident);
    ok('the old mapping no longer applies', (await prisma.importBatch.findUniqueOrThrow({ where: { id: titled.id } })).columnMapping === null);
    ok('the old version no longer works', (await refusal(() => setImportHeaderRow(prisma, sAdmin, titled.id, { headerRow: 4, version: v1.version }, CTX)))?.code === 'CHANGED_ELSEWHERE');
    const none = await setImportHeaderRow(prisma, sAdmin, titled.id, { headerRow: 0 }, CTX);
    ok('no column names in the file: columns go by letter', none.headerRow === 0 && none.headers.join() === 'Column A,Column B,Column C' && none.rowCount === 5);
    ok('a row that isn\'t there', await status(() => setImportHeaderRow(prisma, sAdmin, titled.id, { headerRow: 3 }, CTX)) === 400);
    ok('the last row, with nothing under it', await status(() => setImportHeaderRow(prisma, sAdmin, titled.id, { headerRow: 6 }, CTX)) === 400);
    for (const value of [-1, 1.5, '4', null, undefined]) ok(`headerRow ${String(value)} refused`, await status(() => setImportHeaderRow(prisma, sAdmin, titled.id, { headerRow: value }, CTX)) === 400);
    ok('logged', await logged('import.header_changed', titled.id) === 2);
    const concurrent = await Promise.allSettled([4, 5].map((headerRow) => setImportHeaderRow(prisma, sAdmin, titled.id, { headerRow, version: none.version }, CTX)));
    ok('two changes at once: one wins', concurrent.filter((r) => r.status === 'fulfilled').length === 1);

    const raced = await stage(FILE);
    const racing = new Proxy(prisma, { get(target, key) {
      if (key === 'importRow') return new Proxy(target.importRow, { get(rows, k) {
        if (k === 'count') return async (args: Prisma.ImportRowCountArgs) => {
          const n = await rows.count(args);
          await prisma.importBatch.update({ where: { id: raced.id }, data: { columnMapping: { Name: 'name' } } });
          return n;
        };
        return Reflect.get(rows, k);
      } });
      const value = Reflect.get(target, key);
      return typeof value === 'function' ? value.bind(target) : value;
    } }) as PrismaClient;
    const overtaken = await refusal(() => setImportHeaderRow(racing, sAdmin, raced.id, { headerRow: 2, version: raced.version }, CTX));
    ok('a change landing after the check is still refused', overtaken?.status === 409 && overtaken.code === 'CHANGED_ELSEWHERE');
    const afterRace = await prisma.importBatch.findUniqueOrThrow({ where: { id: raced.id } });
    ok('and theirs stands', afterRace.headerRow === 1 && afterRace.columnMapping !== null && await logged('import.header_changed', raced.id) === 0);
    await discardImport(prisma, sAdmin, raced.id, CTX);

    console.log('Discarding');
    const gone = await stage(FILE);
    const auditCount = await prisma.deskAuditLog.count({ where: { entityId: gone.id } });
    ok('removed', (await discardImport(prisma, sAdmin, gone.id, CTX)).discarded);
    ok('with its rows', await prisma.importRow.count({ where: { batchId: gone.id } }) === 0 && !(await prisma.importBatch.findUnique({ where: { id: gone.id } })));
    ok('the log entries stay', await prisma.deskAuditLog.count({ where: { entityId: gone.id } }) === auditCount + 1);
    ok('twice: 404', await status(() => discardImport(prisma, sAdmin, gone.id, CTX)) === 404);
    const committed = await stage(FILE);
    await prisma.importBatch.update({ where: { id: committed.id }, data: { status: 'COMMITTED' } });
    const noDiscard = await refusal(() => discardImport(prisma, sAdmin, committed.id, CTX));
    ok('a committed import can\'t be', noDiscard?.status === 409 && noDiscard.code === 'NOT_STAGED');
    ok('nor have its header changed', (await refusal(() => setImportHeaderRow(prisma, sAdmin, committed.id, { headerRow: 2 }, CTX)))?.code === 'NOT_STAGED');
    ok('nor its rows previewed', (await refusal(() => getImportRows(prisma, sAdmin, committed.id, {}, CTX)))?.code === 'NOT_STAGED');
    ok('and its rows stay', await prisma.importRow.count({ where: { batchId: committed.id } }) === 4);
    await prisma.importBatch.update({ where: { id: committed.id }, data: { status: 'STAGED' } });
    await discardImport(prisma, sAdmin, committed.id, CTX);

    console.log('When saving fails');
    const inA = () => prisma.importBatch.count({ where: { agencyId: A.id } });
    const countBefore = await inA();
    const rowsFail = new Proxy(prisma, { get(target, key) {
      if (key === '$runCommandRaw') return async (command: Record<string, unknown>) => {
        if ('insert' in command) throw new Error('database down');
        return target.$runCommandRaw(command as never);
      };
      return Reflect.get(target, key);
    } }) as PrismaClient;
    let thrown = '';
    try { await stageImport(rowsFail, sAdmin, upload(FILE), CTX); } catch (e) { thrown = (e as Error).message; }
    ok('a failed write is reported', thrown === 'database down');
    ok('and leaves nothing', await inA() === countBefore);
    const shortWrite = new Proxy(prisma, { get(target, key) {
      if (key === '$runCommandRaw') return async (command: Record<string, unknown>) => ('insert' in command ? { n: 0, ok: 1 } : target.$runCommandRaw(command as never));
      return Reflect.get(target, key);
    } }) as PrismaClient;
    thrown = '';
    try { await stageImport(shortWrite, sAdmin, upload(FILE), CTX); } catch (e) { thrown = (e as Error).message; }
    ok('rows the database didn\'t save are noticed', thrown.includes('Not every') && await inA() === countBefore);
    const auditFails = new Proxy(prisma, { get(target, key) {
      if (key === '$transaction') return async () => { throw new Error('log unavailable'); };
      return Reflect.get(target, key);
    } }) as PrismaClient;
    thrown = '';
    try { await stageImport(auditFails, sAdmin, upload(FILE), CTX); } catch (e) { thrown = (e as Error).message; }
    ok('an import that can\'t be logged doesn\'t happen', thrown === 'log unavailable' && await inA() === countBefore);
    const leftOver = await prisma.importRow.count({ where: { agencyId: A.id, batchId: { notIn: (await prisma.importBatch.findMany({ where: { agencyId: A.id }, select: { id: true } })).map((b) => b.id) } } });
    ok('and no stray rows', leftOver === 0);
    let whileWriting = '';
    let previewWhileWriting: string | undefined;
    const watching = new Proxy(prisma, { get(target, key) {
      if (key === '$runCommandRaw') return async (command: Record<string, unknown>) => {
        if ('insert' in command) {
          const id = (command.documents as { batchId: { $oid: string } }[])[0].batchId.$oid;
          whileWriting = (await target.importBatch.findUniqueOrThrow({ where: { id } })).status;
          previewWhileWriting = (await refusal(() => getImportRows(prisma, sAdmin, id, {}, CTX)))?.code;
        }
        return target.$runCommandRaw(command as never);
      };
      const value = Reflect.get(target, key);
      return typeof value === 'function' ? value.bind(target) : value;
    } }) as PrismaClient;
    const watched = await stageImport(watching, sAdmin, upload(FILE), CTX);
    ok('not ready while its rows are going in', whileWriting === 'FAILED' && previewWhileWriting === 'NOT_STAGED');
    ok('and ready once they are', watched.status === 'STAGED');
    await discardImport(prisma, sAdmin, watched.id, CTX);
    const halfWay = await prisma.importBatch.create({ data: { agencyId: A.id, uploadedById: admin.id, fileName: 'half.csv', status: 'FAILED' } });
    ok('a batch that stopped halfway can\'t be previewed', (await refusal(() => getImportRows(prisma, sAdmin, halfWay.id, {}, CTX)))?.code === 'NOT_STAGED');
    ok('but can be discarded', (await discardImport(prisma, sAdmin, halfWay.id, CTX)).discarded);

    console.log('Unfinished imports are limited');
    const C = await mkAgency('C');
    const adminC = await mkUser('admin-c', 'ADMIN', C.id);
    const sC = await resolveDeskScope(prisma, adminC.id);
    await prisma.importBatch.createMany({ data: Array.from({ length: MAX_OPEN_IMPORTS }, (_, i) => ({ agencyId: C.id, uploadedById: adminC.id, fileName: `${i}.csv`, status: 'STAGED' as const })) });
    ok('the limit reached: says so', (await refusal(() => stage(FILE, 'a.csv', sC)))?.code === 'TOO_MANY_OPEN');
    await prisma.importBatch.updateMany({ where: { agencyId: C.id, fileName: '0.csv' }, data: { status: 'COMMITTED' } });
    ok('finished ones don\'t count', (await stage(FILE, 'a.csv', sC)).status === 'STAGED');

    console.log('Over HTTP');
    const tAdmin = await createSession(admin.id);
    const tProducer = await createSession(producer.id);
    const tB = await createSession(adminB.id);
    const tOps = await createSession(ops.id);
    const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
    const req = (url: string, token: string | null, method = 'GET', body?: unknown) => new NextRequest(`http://local.test${url}`, {
      method, headers: { ...(token ? { cookie: `session_token=${token}` } : {}), ...(body ? { 'content-type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const form = (content: string | Uint8Array, name = 'book.csv', extra: Record<string, string> = {}) => {
      const f = new FormData();
      f.set('file', new File([content as BlobPart], name));
      for (const [k, v] of Object.entries(extra)) f.set(k, v);
      return f;
    };
    const post = (token: string | null, body: FormData | string, url = '/api/desk/imports', headers: Record<string, string> = {}) =>
      new NextRequest(`http://local.test${url}`, { method: 'POST', headers: { ...(token ? { cookie: `session_token=${token}` } : {}), ...headers }, body });
    const up = await uploadRoute(post(tAdmin, form(FILE)));
    const upBody = await up.json();
    ok('an upload: 201 with the batch', up.status === 201 && upBody.rowCount === 3 && upBody.headers[0] === 'Name');
    ok('a sheet can be named', (await uploadRoute(post(tAdmin, form(xlsx({ sheets: [{ name: 'A', xml: sheetXml(inlineRow(1, 'x')) }] }), 'a.xlsx', { sheet: 'Nope' })))).status === 400);
    const refused = await uploadRoute(post(tAdmin, form('x', 'a.xls')));
    ok('a bad file: 400, with its message and code', refused.status === 400 && (await refused.json()).code === 'OLD_OR_PROTECTED');
    ok('no file: 400', (await uploadRoute(post(tAdmin, new FormData()))).status === 400);
    ok('not a form: 400', (await uploadRoute(post(tAdmin, 'plain', '/api/desk/imports', { 'content-type': 'text/plain' }))).status === 400);
    ok('a text field called file: 400', await (async () => { const f = new FormData(); f.set('file', 'text'); return (await uploadRoute(post(tAdmin, f))).status === 400; })());
    ok('a Producer: 403', (await uploadRoute(post(tProducer, form(FILE)))).status === 403);
    ok('not signed in: 401', (await uploadRoute(post(null, form(FILE)))).status === 401);
    const large = await uploadRoute(post(tAdmin, 'x', '/api/desk/imports', { 'content-type': 'multipart/form-data; boundary=x', 'content-length': String(MAX_IMPORT_BYTES + 1024 * 1024) }));
    ok('too large by its own account: refused before reading', large.status === 400 && (await large.json()).code === 'TOO_LARGE');
    const justOver = new Uint8Array(MAX_IMPORT_BYTES + 1).fill(97);
    const overRes = await uploadRoute(post(tAdmin, form(justOver)));
    ok('a file just over: refused', overRes.status === 400 && (await overRes.json()).code === 'TOO_LARGE');
    ok('an Insurigence admin names the agency in the address', (await uploadRoute(post(tOps, form(FILE), `/api/desk/imports?agencyId=${B.id}`))).status === 201);
    ok('or is asked to', (await uploadRoute(post(tOps, form(FILE)))).status === 400);
    const listRes = await listRoute(req('/api/desk/imports', tAdmin));
    const listText = await listRes.text();
    ok('the list: 200, with no rows in it', listRes.status === 200 && listText.includes(upBody.id) && !listText.includes('"cells"') && !listText.includes('P3'));
    ok('one import: 200', (await oneRoute(req(`/api/desk/imports/${upBody.id}`, tAdmin), ctx(upBody.id))).status === 200);
    const foreign = await oneRoute(req(`/api/desk/imports/${upBody.id}`, tB), ctx(upBody.id));
    ok('another agency: a bare 404', foreign.status === 404 && JSON.stringify(await foreign.json()) === '{"error":"Not found"}');
    const rowsRes = await rowsRoute(req(`/api/desk/imports/${upBody.id}/rows?page=1&pageSize=2`, tAdmin), ctx(upBody.id));
    const rowsBody = await rowsRes.json();
    ok('rows: 200', rowsRes.status === 200 && rowsBody.rows.length === 2 && rowsBody.total === 3);
    ok('all rows, on request', (await (await rowsRoute(req(`/api/desk/imports/${upBody.id}/rows?all=1`, tAdmin), ctx(upBody.id))).json()).total === 4);
    ok('a change: 200', (await patchRoute(req(`/api/desk/imports/${upBody.id}`, tAdmin, 'PATCH', { headerRow: 2, version: upBody.version }), ctx(upBody.id))).status === 200);
    const stalePatch = await patchRoute(req(`/api/desk/imports/${upBody.id}`, tAdmin, 'PATCH', { headerRow: 1, version: upBody.version }), ctx(upBody.id));
    ok('an old version: 409 with its code', stalePatch.status === 409 && (await stalePatch.json()).code === 'CHANGED_ELSEWHERE');
    ok('a bad body: 400', (await patchRoute(new NextRequest('http://local.test/x', { method: 'PATCH', headers: { cookie: `session_token=${tAdmin}` }, body: '[]' }), ctx(upBody.id))).status === 400);
    ok('discarding by another agency: 404', (await deleteRoute(req(`/api/desk/imports/${upBody.id}`, tB, 'DELETE'), ctx(upBody.id))).status === 404);
    ok('discarding: 200', (await deleteRoute(req(`/api/desk/imports/${upBody.id}`, tAdmin, 'DELETE'), ctx(upBody.id))).status === 200);
  } catch (err) {
    console.error(err);
    fail++;
  } finally {
    const agencyId = { in: cleanup.agencyIds };
    await (async () => {
      await prisma.importRow.deleteMany({ where: { agencyId } });
      await prisma.importBatch.deleteMany({ where: { agencyId } });
      await prisma.agencyDeskAssignment.deleteMany({ where: { agencyId } });
      await prisma.deskAuditLog.deleteMany({ where: { OR: [{ agencyId }, { actorId: { in: cleanup.userIds } }] } });
      await prisma.session.deleteMany({ where: { userId: { in: cleanup.userIds } } });
      await prisma.user.deleteMany({ where: { id: { in: cleanup.userIds } } });
      await prisma.agency.deleteMany({ where: { id: agencyId } });
    })().catch((err) => { console.error('cleanup failed', err); fail++; });
    const leftOver = await prisma.agency.count({ where: { name: { contains: TAG } } }) + await prisma.user.count({ where: { email: { contains: TAG } } });
    ok('nothing left behind', leftOver === 0);
    await prisma.$disconnect();
    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
  }
})();
