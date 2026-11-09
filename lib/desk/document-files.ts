/**
 * Which files may be attached to a Desk request, and what they really are.
 * Pure — safe for server and browser.
 *
 * The type a browser reports is the uploader's claim, so it is never used: the
 * file's extension picks the kind, and the file's first bytes must agree with
 * it. The stored content type comes from this table, so a script renamed to
 * .pdf is refused rather than served back with a type the uploader chose.
 */
import type { DocumentSensitivity } from '@prisma/client';

/** What each category is for, shown where a file is classified. Every file needs one (no default). */
export const CATEGORY_HINTS: Record<DocumentSensitivity, string> = {
  GENERAL: 'Certificates, forms, letters and emails.',
  POLICY: 'Policies, declarations pages, endorsements and quotes.',
  FINANCIAL: 'Bank details, payments, tax returns or financial statements.',
  PERSONAL: "Social Security numbers, dates of birth, driver's licenses or medical details.",
};

/** How many files the New request form attaches at once. */
export const MAX_FILES_PER_SEND = 10;

/**
 * Middleware runs on API routes, and Next keeps only the first 10 MB of a body
 * passing through it (as for imports). One file per upload, so 9 MB leaves room
 * for the form around it.
 */
export const MAX_DOCUMENT_BYTES = 9 * 1024 * 1024;
export const MAX_DOCUMENTS_PER_TASK = 50;
export const FILE_NAME_MAX = 200;

type Magic = 'pdf' | 'jpeg' | 'png' | 'webp' | 'heic' | 'zip' | 'ole' | 'text';

const KINDS: Record<string, { type: string; magic: Magic; inline?: true }> = {
  pdf: { type: 'application/pdf', magic: 'pdf', inline: true },
  jpg: { type: 'image/jpeg', magic: 'jpeg', inline: true },
  jpeg: { type: 'image/jpeg', magic: 'jpeg', inline: true },
  png: { type: 'image/png', magic: 'png', inline: true },
  webp: { type: 'image/webp', magic: 'webp', inline: true },
  heic: { type: 'image/heic', magic: 'heic' },
  docx: { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', magic: 'zip' },
  xlsx: { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', magic: 'zip' },
  doc: { type: 'application/msword', magic: 'ole' },
  xls: { type: 'application/vnd.ms-excel', magic: 'ole' },
  msg: { type: 'application/vnd.ms-outlook', magic: 'ole' },
  csv: { type: 'text/csv', magic: 'text' },
  txt: { type: 'text/plain', magic: 'text' },
  eml: { type: 'message/rfc822', magic: 'text' },
};

/** For the file picker. The server checks again. */
export const DOCUMENT_ACCEPT = Object.keys(KINDS).map((e) => `.${e}`).join(',');
export const DOCUMENT_KINDS_TEXT = 'PDF, Word, Excel, CSV, text, Outlook or email files, and JPG, PNG, WebP or HEIC images';

const startsWith = (b: Uint8Array, sig: number[], at = 0) => b.length >= at + sig.length && sig.every((v, i) => b[at + i] === v);
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));

function magicMatches(magic: Magic, b: Uint8Array): boolean {
  switch (magic) {
    case 'pdf': return startsWith(b, ascii('%PDF-'));
    case 'jpeg': return startsWith(b, [0xff, 0xd8, 0xff]);
    case 'png': return startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case 'webp': return startsWith(b, ascii('RIFF')) && startsWith(b, ascii('WEBP'), 8);
    case 'heic': return startsWith(b, ascii('ftyp'), 4) && ['heic', 'heix', 'mif1', 'msf1', 'hevc'].some((brand) => startsWith(b, ascii(brand), 8));
    case 'zip': return startsWith(b, [0x50, 0x4b, 0x03, 0x04]);
    case 'ole': return startsWith(b, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
    // Text has no signature: it just must not be binary.
    case 'text': return !b.subarray(0, 8192).includes(0);
  }
}

/** The name shown and offered on download: no folders, no control characters. */
export function cleanFileName(name: unknown): string | null {
  if (typeof name !== 'string') return null;
  // eslint-disable-next-line no-control-regex
  const base = (name.split(/[/\\]/).pop() ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim();
  if (!base || /^\.+$/.test(base)) return null;
  if (base.length <= FILE_NAME_MAX) return base;
  // Keep the extension when shortening.
  const dot = base.lastIndexOf('.');
  const ext = dot > 0 && base.length - dot <= 10 ? base.slice(dot) : '';
  return base.slice(0, FILE_NAME_MAX - ext.length) + ext;
}

export const extensionOf = (name: string) => {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
};

export type DocumentCheck =
  | { ok: true; fileName: string; contentType: string; inline: boolean }
  | { ok: false; code: 'NO_NAME' | 'EMPTY' | 'TOO_LARGE' | 'TYPE' | 'CONTENT'; message: string };

const MB = MAX_DOCUMENT_BYTES / 1024 / 1024;

/** Decide whether a file may be attached, from its name and its bytes. */
export function checkDocument(name: unknown, bytes: Uint8Array): DocumentCheck {
  const fileName = cleanFileName(name);
  if (!fileName) return { ok: false, code: 'NO_NAME', message: 'The file needs a name.' };
  if (bytes.length === 0) return { ok: false, code: 'EMPTY', message: `${fileName} is empty.` };
  if (bytes.length > MAX_DOCUMENT_BYTES) return { ok: false, code: 'TOO_LARGE', message: `${fileName} is larger than ${MB} MB.` };
  const kind = KINDS[extensionOf(fileName)];
  if (!kind) return { ok: false, code: 'TYPE', message: `${fileName} can't be attached. Attach ${DOCUMENT_KINDS_TEXT}.` };
  if (!magicMatches(kind.magic, bytes)) {
    return { ok: false, code: 'CONTENT', message: `${fileName} doesn't look like a .${extensionOf(fileName)} file. It may be damaged or renamed.` };
  }
  return { ok: true, fileName, contentType: kind.type, inline: !!kind.inline };
}

/** Whether a stored content type may be shown in the browser rather than downloaded. */
export const viewableInline = (contentType: string) =>
  Object.values(KINDS).some((k) => k.inline && k.type === contentType);

/** Quick checks the browser can make before uploading (the server repeats them with the bytes). */
export function precheckDocument(name: string, size: number): string | null {
  if (size === 0) return `${name} is empty.`;
  if (size > MAX_DOCUMENT_BYTES) return `${name} is larger than ${MB} MB.`;
  if (!KINDS[extensionOf(name)]) return `${name} can't be attached. Attach ${DOCUMENT_KINDS_TEXT}.`;
  return null;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
