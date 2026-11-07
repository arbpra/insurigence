/**
 * Staging an uploaded book of business (client answer Q2). A file is read into
 * ImportRow records for the mapping and preview steps; nothing reaches the book
 * until the import is committed (lib/desk/import-commit.ts).
 *
 * For the agency's Owner / Admin and Insurigence admins, as the Import page is.
 * Someone in another agency gets a 404. Rows are client data, so reading them is
 * logged, and only counts ever go in the log.
 *
 * Q4 says passwords are not stored here, and exports can carry them, so a column
 * named like a password and a cell reading like one are left out before anything
 * is saved. The original file is not kept.
 */
import { Prisma, type PrismaClient } from '@prisma/client';
import { canManageAgencyAccess, DeskAccessError, isObjectId, type DeskScope, type GuardContext } from './access';
import { recordAudit, type AuditAction } from './audit';
import { columnsFromMapping, mergeColumnMemory, parseColumnMemory, suggestColumns, validateMapping, type ColumnMapping } from './import-fields';
import {
  HEADER_SCAN_ROWS, IMPORT_PAGE_SIZE, columnLetter, detectHeaderRow, isCredentialLabel, uniqueHeaders, type ParsedRow,
} from './import-headers';
import { ImportFileError, parseImportFile, type ParsedFile } from './import-parse';
import { looksLikeCredential } from './profile';

type Db = PrismaClient;

/** Files started but not finished. Enough for real use, and it stops the staging area filling up. */
export const MAX_OPEN_IMPORTS = 10;
const LIST_LIMIT = 50;
const MAX_PAGE_SIZE = 100;
const WRITE_CHUNK_ROWS = 2_000;
const WRITE_CHUNK_CHARS = 8 * 1024 * 1024;
const TX_OPTIONS = { timeout: 20_000, maxWait: 10_000 };
const CHANGED_ELSEWHERE = 'Someone else just changed this. Reload to see their changes, then try again.';

const bad = (message: string, code?: string) => new DeskAccessError(400, message, code);
const conflict = (message: string, code?: string) => new DeskAccessError(409, message, code);

export function importAudit(db: Pick<Db, 'deskAuditLog'> | Prisma.TransactionClient, scope: DeskScope, ctx: GuardContext, action: AuditAction, entityId: string | null, agencyId: string | null, metadata: Record<string, unknown> = {}) {
  return recordAudit(db, { actor: { id: scope.userId, role: scope.role }, action, entityType: 'ImportBatch', entityId, agencyId, metadata, ip: ctx.ip, userAgent: ctx.userAgent });
}

/** Two people changing one import at once: one gets a 409, not a server error. */
export function inImportTransaction<T>(db: Db, work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return db.$transaction(work, TX_OPTIONS).catch((err) => {
    if (err instanceof Prisma.PrismaClientKnownRequestError && (err.code === 'P2034' || err.code === 'P2002')) throw conflict(CHANGED_ELSEWHERE, 'CHANGED_ELSEWHERE');
    throw err;
  });
}

async function logRefusal(db: Db, scope: DeskScope, ctx: GuardContext, entityId: string | null, agencyId: string | null, op: string) {
  try {
    await importAudit(db, scope, ctx, 'access.denied', entityId, agencyId, { op, scope: scope.kind });
  } catch (err) {
    console.error('[desk/imports] could not log refused action', err);
  }
}

/** The agency this upload or list is for: an agency admin's own, or the one an Insurigence admin names. */
export async function importAgency(db: Db, scope: DeskScope, requested: string | null | undefined, ctx: GuardContext = {}): Promise<string> {
  const agencyId = scope.kind === 'AGENCY' ? scope.agencyId : requested;
  if (scope.kind === 'PLATFORM' && !isObjectId(agencyId)) throw bad('Choose an agency.');
  if (!agencyId || !canManageAgencyAccess(scope, agencyId)) {
    await logRefusal(db, scope, ctx, null, isObjectId(agencyId) ? agencyId : null, 'import');
    throw new DeskAccessError(403, 'Only an agency admin can import a book of business.');
  }
  if (scope.kind === 'PLATFORM' && !(await db.agency.findFirst({ where: { id: agencyId, deskEnabled: true }, select: { id: true } }))) {
    throw bad('That agency does not have The Desk.');
  }
  return agencyId;
}

export async function loadBatch(db: Db, scope: DeskScope, id: string, ctx: GuardContext, op: string) {
  const batch = isObjectId(id) ? await db.importBatch.findUnique({ where: { id } }) : null;
  if (batch && canManageAgencyAccess(scope, batch.agencyId)) return batch;
  await logRefusal(db, scope, ctx, isObjectId(id) ? id : null, batch?.agencyId ?? null, op);
  throw new DeskAccessError(404, 'Not found');
}

export type BatchRow = NonNullable<Awaited<ReturnType<Db['importBatch']['findUnique']>>>;

/** A commit normally takes a minute or two. Long after that, it has stopped. */
const COMMIT_STOPPED_AFTER_MS = 15 * 60 * 1000;

/** A finished import, or one that stopped part way through and left records behind. */
export function undoAvailable(b: Pick<BatchRow, 'status' | 'updatedAt'>, now = Date.now()): boolean {
  return b.status === 'COMMITTED' || (b.status === 'COMMITTING' && now - b.updatedAt.getTime() > COMMIT_STOPPED_AFTER_MS);
}

export function batchView(b: BatchRow) {
  return {
    id: b.id, version: b.updatedAt.toISOString(), agencyId: b.agencyId, fileName: b.fileName, fileSize: b.fileSize, format: b.format, status: b.status,
    sheetName: b.sheetName, sheetNames: b.sheetNames, headerRow: b.headerRow, headerConfident: b.headerConfident, headers: b.headers,
    columnCount: b.columnCount, rowCount: b.rowCount, screened: b.screened, mapped: b.columnMapping !== null, createdAt: b.createdAt.toISOString(),
    insuredsCreated: b.insuredsCreated, policiesCreated: b.policiesCreated, rowsSkipped: b.rowsSkipped, committedAt: b.committedAt?.toISOString() ?? null,
    undoneAt: b.undoneAt?.toISOString() ?? null, undoSummary: b.undoSummary, canUndo: undoAvailable(b),
  };
}

// ── Leaving out credentials ──

/**
 * Blanks anything that reads like a credential, wherever the header row turns
 * out to be, so changing it later can't bring a password column back. A column
 * is judged by labels near the top of the file, a cell by its own text.
 */
export function screenCredentials(rows: ParsedRow[]): { rows: ParsedRow[]; columns: string[]; cells: number } {
  const columns = new Set<number>();
  for (const row of rows.slice(0, HEADER_SCAN_ROWS)) {
    row.cells.forEach((cell, i) => { if (isCredentialLabel(cell)) columns.add(i); });
  }
  let cells = 0;
  const kept: ParsedRow[] = [];
  for (const row of rows) {
    const clean = row.cells.map((cell, i) => {
      if (cell === '') return cell;
      if (columns.has(i)) return '';
      if (looksLikeCredential(cell)) { cells++; return ''; }
      return cell;
    });
    if (clean.some((c) => c !== '')) kept.push({ rowNumber: row.rowNumber, cells: clean });
  }
  return { rows: kept, columns: [...columns].sort((a, b) => a - b).map(columnLetter), cells };
}

const cleanFileName = (name: string) =>
  (name.split(/[\\/]/).pop() ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 255) || 'import';

/**
 * Direct database commands, because a full book through Prisma's createMany took
 * minutes inside one request, and these take seconds. The ids are ours and cells
 * are plain strings inside an array, so nothing from the file can act as a command.
 * These report a failed write in their result rather than throwing, so it is checked.
 */
async function writeRows(db: Db, batchId: string, agencyId: string, rows: ParsedRow[]) {
  let chunk: Prisma.InputJsonObject[] = [];
  let chars = 0;
  const flush = async () => {
    if (chunk.length) {
      const result = await db.$runCommandRaw({ insert: 'ImportRow', documents: chunk, ordered: true });
      if (result.n !== chunk.length) throw new Error('Not every import row was saved.');
    }
    chunk = []; chars = 0;
  };
  for (const row of rows) {
    chunk.push({ batchId: { $oid: batchId }, agencyId: { $oid: agencyId }, rowNumber: row.rowNumber, data: row.cells, status: 'PENDING', errors: [] });
    chars += row.cells.reduce((sum, c) => sum + c.length + 8, 64);
    if (chunk.length >= WRITE_CHUNK_ROWS || chars >= WRITE_CHUNK_CHARS) await flush();
  }
  await flush();
}

export async function removeRows(db: Db, batchId: string) {
  await db.$runCommandRaw({ delete: 'ImportRow', deletes: [{ q: { batchId: { $oid: batchId } }, limit: 0 }] });
}

// ── Staging ──

/** A file turned away before it could be read. Only its size and the reason are logged. */
export function logImportRejected(db: Db, scope: DeskScope, agencyId: string, code: string, fileSize: number, ctx: GuardContext = {}) {
  return importAudit(db, scope, ctx, 'import.rejected', null, agencyId, { code, fileSize });
}

export interface ImportUpload {
  fileName: string;
  bytes: Uint8Array;
  sheet?: string | null;
  agencyId?: string | null;
}

export async function stageImport(db: Db, scope: DeskScope, upload: ImportUpload, ctx: GuardContext = {}) {
  const agencyId = await importAgency(db, scope, upload.agencyId, ctx);
  const open = await db.importBatch.count({ where: { agencyId, status: { in: ['STAGED', 'FAILED'] } } });
  if (open >= MAX_OPEN_IMPORTS) throw conflict(`This agency has ${MAX_OPEN_IMPORTS} imports not yet finished. Finish or discard one, then try again.`, 'TOO_MANY_OPEN');

  const fileName = cleanFileName(upload.fileName);
  let parsed: ParsedFile;
  try {
    parsed = parseImportFile(upload.bytes, fileName, { sheet: upload.sheet });
  } catch (err) {
    if (!(err instanceof ImportFileError)) throw err;
    await importAudit(db, scope, ctx, 'import.rejected', null, agencyId, { code: err.code, fileSize: upload.bytes.length });
    throw bad(err.message, err.code);
  }

  const { rows, columns, cells } = screenCredentials(parsed.rows);
  if (!rows.length) {
    await importAudit(db, scope, ctx, 'import.rejected', null, agencyId, { code: 'NO_ROWS', fileSize: upload.bytes.length });
    throw bad('There are no rows to import in this file.', 'NO_ROWS');
  }
  const { headerRow, confident } = detectHeaderRow(rows);
  const headerCells = rows.find((r) => r.rowNumber === headerRow)?.cells ?? [];
  const columnCount = rows.reduce((widest, r) => Math.max(widest, r.cells.length), 0);

  // Marked FAILED until every row is in, so a batch that stops halfway is never taken for a finished one.
  const batch = await db.importBatch.create({
    data: {
      agencyId, uploadedById: scope.userId, fileName, fileSize: upload.bytes.length, format: parsed.format, sheetName: parsed.sheetName, sheetNames: parsed.sheetNames,
      status: 'FAILED', headerRow, headerConfident: confident, headers: uniqueHeaders(headerCells, columnCount), columnCount,
      rowCount: rows.filter((r) => r.rowNumber > headerRow).length,
      screened: columns.length || cells ? { columns, cells } : undefined,
    },
  });
  try {
    await writeRows(db, batch.id, agencyId, rows);
    const ready = await db.$transaction(async (tx) => {
      await importAudit(tx, scope, ctx, 'import.staged', batch.id, agencyId, {
        format: parsed.format, fileSize: upload.bytes.length, rowCount: batch.rowCount, columnCount, screenedColumns: columns.length, screenedCells: cells,
      });
      return tx.importBatch.update({ where: { id: batch.id }, data: { status: 'STAGED' } });
    }, TX_OPTIONS);
    return batchView(ready);
  } catch (err) {
    // The batch stays FAILED if this fails too, and can be discarded.
    await removeRows(db, batch.id).then(() => db.importBatch.delete({ where: { id: batch.id } })).catch((cleanupErr) => console.error('[desk/imports] could not remove a failed batch', cleanupErr));
    throw err;
  }
}

// ── Reading ──

export async function listImports(db: Db, scope: DeskScope, opts: { agencyId?: string | null } = {}, ctx: GuardContext = {}) {
  const agencyId = await importAgency(db, scope, opts.agencyId, ctx);
  const batches = await db.importBatch.findMany({ where: { agencyId }, orderBy: { createdAt: 'desc' }, take: LIST_LIMIT });
  return { imports: batches.map(batchView) };
}

export async function getImport(db: Db, scope: DeskScope, id: string, ctx: GuardContext = {}) {
  return batchView(await loadBatch(db, scope, id, ctx, 'import.read'));
}

const positiveInt = (value: unknown, fallback: number) => {
  const n = typeof value === 'string' ? Number(value) : value;
  return typeof n === 'number' && Number.isInteger(n) && n > 0 && n <= 1_000_000 ? n : fallback;
};

/** The rows under the header row, or with `all` every row, for choosing a different one. */
export async function getImportRows(db: Db, scope: DeskScope, id: string, opts: { page?: unknown; pageSize?: unknown; all?: boolean } = {}, ctx: GuardContext = {}) {
  const batch = await loadBatch(db, scope, id, ctx, 'import.rows');
  if (batch.status !== 'STAGED') throw conflict('This import has no rows to preview.', 'NOT_STAGED');
  const page = positiveInt(opts.page, 1);
  const pageSize = Math.min(positiveInt(opts.pageSize, IMPORT_PAGE_SIZE), MAX_PAGE_SIZE);
  const where: Prisma.ImportRowWhereInput = { batchId: batch.id, ...(opts.all ? {} : { rowNumber: { gt: batch.headerRow } }) };
  const [rows, total] = await Promise.all([
    db.importRow.findMany({ where, orderBy: { rowNumber: 'asc' }, skip: (page - 1) * pageSize, take: pageSize }),
    db.importRow.count({ where }),
  ]);
  await importAudit(db, scope, ctx, 'import.viewed', batch.id, batch.agencyId, { page, rows: rows.length });
  return {
    rows: rows.map((r) => ({ rowNumber: r.rowNumber, cells: r.data as string[], status: r.status, errors: r.errors })),
    total, page, pageSize,
  };
}

// ── Changing ──

/** Corrects the header row. 0: the file has no column names, so columns go by letter. Any mapping chosen is cleared. */
export async function setImportHeaderRow(db: Db, scope: DeskScope, id: string, input: Record<string, unknown>, ctx: GuardContext = {}) {
  const batch = await loadBatch(db, scope, id, ctx, 'import.header');
  if (batch.status !== 'STAGED') throw conflict('This import can no longer be changed.', 'NOT_STAGED');
  if (input.version !== undefined && input.version !== batch.updatedAt.toISOString()) throw conflict(CHANGED_ELSEWHERE, 'CHANGED_ELSEWHERE');
  const headerRow = input.headerRow;
  if (typeof headerRow !== 'number' || !Number.isInteger(headerRow) || headerRow < 0) throw bad('Choose a row for the column names.');

  let cells: string[] = [];
  if (headerRow > 0) {
    const row = await db.importRow.findUnique({ where: { batchId_rowNumber: { batchId: batch.id, rowNumber: headerRow } } });
    if (!row) throw bad('That row is empty or is not in the file.');
    cells = row.data as string[];
  }
  const rowCount = await db.importRow.count({ where: { batchId: batch.id, rowNumber: { gt: headerRow } } });
  if (!rowCount) throw bad('There are no rows below that one to import.');

  return inImportTransaction(db, async (tx) => {
    const { count } = await tx.importBatch.updateMany({
      where: { id: batch.id, status: 'STAGED', updatedAt: batch.updatedAt },
      data: { headerRow, headerConfident: true, headers: uniqueHeaders(cells, batch.columnCount), rowCount, columnMapping: null },
    });
    if (count !== 1) throw conflict(CHANGED_ELSEWHERE, 'CHANGED_ELSEWHERE');
    await importAudit(tx, scope, ctx, 'import.header_changed', batch.id, batch.agencyId, { from: batch.headerRow, to: headerRow, rowCount });
    return batchView(await tx.importBatch.findUniqueOrThrow({ where: { id: batch.id } }));
  });
}

/**
 * What each column maps to: the choice saved on this import, or else a suggestion
 * from what this agency chose before and what the column's name says.
 */
export async function getImportMapping(db: Db, scope: DeskScope, id: string, ctx: GuardContext = {}) {
  const batch = await loadBatch(db, scope, id, ctx, 'import.mapping');
  if (batch.status !== 'STAGED') throw conflict('This import can no longer be changed.', 'NOT_STAGED');
  const saved = batch.columnMapping === null ? null : validateMapping(batch.columnMapping, batch.headers);
  if (saved && !saved.errors.length) return { version: batch.updatedAt.toISOString(), saved: true, columns: columnsFromMapping(batch.headers, saved.mapping) };
  const memory = await db.importColumnMemory.findUnique({ where: { agencyId: batch.agencyId } });
  return { version: batch.updatedAt.toISOString(), saved: false, columns: suggestColumns(batch.headers, parseColumnMemory(memory?.columns)) };
}

/** Saves the choice on this import, and remembers it for this agency's next upload. Only field names go in the log. */
export async function saveImportMapping(db: Db, scope: DeskScope, id: string, input: Record<string, unknown>, ctx: GuardContext = {}) {
  const batch = await loadBatch(db, scope, id, ctx, 'import.map');
  if (batch.status !== 'STAGED') throw conflict('This import can no longer be changed.', 'NOT_STAGED');
  if (input.version !== undefined && input.version !== batch.updatedAt.toISOString()) throw conflict(CHANGED_ELSEWHERE, 'CHANGED_ELSEWHERE');
  const { mapping, errors } = validateMapping(input.mapping, batch.headers);
  if (errors.length) throw bad(errors.join(' '), 'INVALID_MAPPING');

  return inImportTransaction(db, async (tx) => {
    const { count } = await tx.importBatch.updateMany({
      where: { id: batch.id, status: 'STAGED', updatedAt: batch.updatedAt },
      data: { columnMapping: mapping as Prisma.InputJsonObject },
    });
    if (count !== 1) throw conflict(CHANGED_ELSEWHERE, 'CHANGED_ELSEWHERE');
    const memory = await tx.importColumnMemory.findUnique({ where: { agencyId: batch.agencyId } });
    const columns = mergeColumnMemory(parseColumnMemory(memory?.columns), batch.headers, mapping as ColumnMapping) as unknown as Prisma.InputJsonArray;
    await tx.importColumnMemory.upsert({
      where: { agencyId: batch.agencyId },
      create: { agencyId: batch.agencyId, columns, updatedById: scope.userId },
      update: { columns, updatedById: scope.userId },
    });
    await importAudit(tx, scope, ctx, 'import.mapped', batch.id, batch.agencyId, { fields: Object.keys(mapping), columnCount: batch.headers.length });
    return batchView(await tx.importBatch.findUniqueOrThrow({ where: { id: batch.id } }));
  });
}

/**
 * Removes an unfinished import and its rows; the log entry stays. Staged rows are
 * client data, so they shouldn't outlive their use. It is marked FAILED first, so
 * a commit can't start on rows that are being removed, and a discard cut short
 * can simply be repeated.
 */
export async function discardImport(db: Db, scope: DeskScope, id: string, ctx: GuardContext = {}) {
  const batch = await loadBatch(db, scope, id, ctx, 'import.discard');
  if (batch.status !== 'STAGED' && batch.status !== 'FAILED') throw conflict('This import has been committed. Undo it instead.', 'NOT_STAGED');
  await inImportTransaction(db, async (tx) => {
    const { count } = await tx.importBatch.updateMany({ where: { id: batch.id, status: { in: ['STAGED', 'FAILED'] } }, data: { status: 'FAILED' } });
    if (count !== 1) throw conflict(CHANGED_ELSEWHERE, 'CHANGED_ELSEWHERE');
    await importAudit(tx, scope, ctx, 'import.discarded', batch.id, batch.agencyId, { rowCount: batch.rowCount });
  });
  await removeRows(db, batch.id);
  await db.importBatch.delete({ where: { id: batch.id } });
  return { discarded: true };
}
