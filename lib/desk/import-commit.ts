/**
 * Previewing, committing and undoing an import (client answer Q2). The preview and
 * the commit run the same plan (lib/desk/import-plan.ts). If the book has changed
 * in between so the numbers differ, the commit stops and asks for another look.
 *
 * A full book doesn't fit in one database transaction, so a commit marks the import
 * COMMITTING, writes in chunks, and then marks it COMMITTED. Everything written
 * carries the import's id, so a failure can remove it, and one that stopped dead
 * (a server restart) can be undone from the imports list.
 *
 * Undo removes only what's unchanged and unused. An account with requests, with a
 * policy added by hand or edited since is kept and reported (Module 11: work history
 * is protected). Accounts already in the book are never changed by an import, so
 * undo has nothing to restore on them. Only counts ever go in the log.
 */
import { randomBytes } from 'crypto';
import { Prisma, type PrismaClient, type UserRole } from '@prisma/client';
import { AGENCY_ROLES } from '@/lib/roles';
import { DeskAccessError, type DeskScope, type GuardContext } from './access';
import { validateMapping } from './import-fields';
import { batchView, importAudit, inImportTransaction, loadBatch, removeRows, undoAvailable, type BatchRow } from './imports';
import { buildImportPlan, isOnExisting, type ImportPlan, type OnExisting, type PlannedAccount } from './import-plan';

type Db = PrismaClient;

const READ_CHUNK_ROWS = 5_000;
const WRITE_CHUNK_DOCS = 2_000;
const ID_CHUNK = 1_000;
const DELETES_AT_ONCE = 5;
const PREVIEW_ACCOUNTS = 50;
const PREVIEW_PROBLEMS = 200;
const KEPT_NAMES = 20;

const bad = (message: string, code?: string) => new DeskAccessError(400, message, code);
const conflict = (message: string, code?: string) => new DeskAccessError(409, message, code);
const CHANGED_ELSEWHERE = 'Someone else just changed this. Reload to see their changes, then try again.';

const dayOnly = (d: Date | null) => d?.toISOString().slice(0, 10) ?? null;

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** The plan as the book stands now. */
async function planFor(db: Db, batch: BatchRow, onExisting: OnExisting): Promise<ImportPlan> {
  const { mapping, errors } = batch.columnMapping === null ? { mapping: {}, errors: ['none'] } : validateMapping(batch.columnMapping, batch.headers);
  if (errors.length) throw conflict('Choose this file\'s columns first.', 'NOT_MAPPED');

  const rows: { rowNumber: number; cells: string[] }[] = [];
  let after = batch.headerRow;
  for (;;) {
    const page = await db.importRow.findMany({ where: { batchId: batch.id, rowNumber: { gt: after } }, orderBy: { rowNumber: 'asc' }, take: READ_CHUNK_ROWS, select: { rowNumber: true, data: true } });
    for (const r of page) rows.push({ rowNumber: r.rowNumber, cells: r.data as string[] });
    if (page.length < READ_CHUNK_ROWS) break;
    after = page[page.length - 1].rowNumber;
  }

  const [existingAccounts, policies, users] = await Promise.all([
    db.insuredAccount.findMany({ where: { agencyId: batch.agencyId }, select: { id: true, name: true, nameKey: true, externalRef: true, status: true } }),
    db.policy.findMany({ where: { agencyId: batch.agencyId }, select: { insuredId: true, policyNumber: true, lineOfBusiness: true, carrierName: true, effectiveDate: true, expirationDate: true } }),
    db.user.findMany({ where: { agencyId: batch.agencyId, isActive: true, role: { in: [...AGENCY_ROLES] as UserRole[] } }, select: { id: true, firstName: true, lastName: true, email: true } }),
  ]);
  return buildImportPlan({
    rows, headers: batch.headers, mapping, users, onExisting, today: new Date().toISOString().slice(0, 10), existingAccounts,
    existingPolicies: policies.map((p) => ({ ...p, effectiveDate: dayOnly(p.effectiveDate), expirationDate: dayOnly(p.expirationDate) })),
  });
}

const parseOnExisting = (value: unknown): OnExisting => {
  if (value === undefined || value === null) return 'ADD';
  if (!isOnExisting(value)) throw bad('Choose what to do with accounts already in your book.');
  return value;
};

// ── Preview ──

export async function getImportPreview(db: Db, scope: DeskScope, id: string, opts: { onExisting?: unknown } = {}, ctx: GuardContext = {}) {
  const batch = await loadBatch(db, scope, id, ctx, 'import.preview');
  if (batch.status !== 'STAGED') throw conflict('This import can no longer be changed.', 'NOT_STAGED');
  const onExisting = parseOnExisting(opts.onExisting);
  const plan = await planFor(db, batch, onExisting);
  await importAudit(db, scope, ctx, 'import.previewed', batch.id, batch.agencyId, { ...plan.counts, onExisting });
  return {
    version: batch.updatedAt.toISOString(), fileName: batch.fileName, onExisting, counts: plan.counts, unmatchedProducers: plan.unmatchedProducers,
    accounts: plan.accounts.slice(0, PREVIEW_ACCOUNTS).map((a) => ({
      name: a.name, existing: !!a.existingId, assigned: a.userIds.length,
      policies: a.policies.map((p) => ({ rowNumber: p.rowNumber, policyNumber: p.policyNumber, lineOfBusiness: p.lineOfBusiness, carrierName: p.carrierName, expirationDate: p.expirationDate, premiumCents: p.premiumCents, status: p.status })),
    })),
    accountsTotal: plan.accounts.length,
    problems: plan.problems.slice(0, PREVIEW_PROBLEMS),
    problemsTotal: plan.problems.length,
  };
}

// ── Commit ──

/** A new database id. These are ours, and nothing from the file can act as a command: its text only ever lands in string values. */
const newId = () => randomBytes(12).toString('hex');
const oid = (id: string) => ({ $oid: id });

/**
 * Direct database commands, as staging uses: a full book through Prisma's createMany
 * takes minutes. Only fields with a value are written, as Prisma does, and each
 * collection's required fields are all set here.
 */
async function insertAll(db: Db, collection: string, documents: Prisma.InputJsonObject[]) {
  for (const part of chunks(documents, WRITE_CHUNK_DOCS)) {
    const result = await db.$runCommandRaw({ insert: collection, documents: part, ordered: true });
    if (result.n !== part.length) throw new Error(`Not every ${collection} record was saved.`);
  }
}

async function writePlan(db: Db, batch: BatchRow, scope: DeskScope, accounts: PlannedAccount[]) {
  const stamp = { $date: new Date().toISOString() };
  const common = { agencyId: oid(batch.agencyId), importBatchId: oid(batch.id), createdById: oid(scope.userId), createdAt: stamp, updatedAt: stamp };
  const accountDocs: Prisma.InputJsonObject[] = [];
  const policyDocs: Prisma.InputJsonObject[] = [];
  const assignmentDocs: Prisma.InputJsonObject[] = [];
  for (const a of accounts) {
    const insuredId = a.existingId ?? newId();
    if (!a.existingId) {
      accountDocs.push({ _id: oid(insuredId), ...common, ...a.fields, name: a.name, nameKey: a.nameKey, status: 'ACTIVE', source: 'IMPORT' });
      for (const userId of a.userIds) {
        assignmentDocs.push({ _id: oid(newId()), agencyId: common.agencyId, insuredId: oid(insuredId), userId: oid(userId), role: 'PRODUCER', createdById: common.createdById, createdAt: stamp });
      }
    }
    for (const p of a.policies) {
      policyDocs.push({
        _id: oid(newId()), ...common, insuredId: oid(insuredId), status: p.status,
        ...(p.policyNumber ? { policyNumber: p.policyNumber } : {}),
        ...(p.lineOfBusiness ? { lineOfBusiness: p.lineOfBusiness } : {}),
        ...(p.carrierName ? { carrierName: p.carrierName } : {}),
        ...(p.effectiveDate ? { effectiveDate: { $date: `${p.effectiveDate}T00:00:00.000Z` } } : {}),
        ...(p.expirationDate ? { expirationDate: { $date: `${p.expirationDate}T00:00:00.000Z` } } : {}),
        ...(p.premiumCents !== null ? { premiumCents: { $numberLong: String(p.premiumCents) } } : {}),
        ...(p.notes ? { notes: p.notes } : {}),
        ...(p.externalRef ? { externalRef: p.externalRef } : {}),
      });
    }
  }
  await insertAll(db, 'InsuredAccount', accountDocs);
  await insertAll(db, 'Policy', policyDocs);
  await insertAll(db, 'InsuredAssignment', assignmentDocs);
}

/** Back to where it was, ready for another try. */
const release = (db: Db, batchId: string) => db.importBatch.updateMany({ where: { id: batchId, status: 'COMMITTING' }, data: { status: 'STAGED' } });

export async function commitImport(db: Db, scope: DeskScope, id: string, input: Record<string, unknown>, ctx: GuardContext = {}) {
  const batch = await loadBatch(db, scope, id, ctx, 'import.commit');
  if (batch.status !== 'STAGED') throw conflict('This import has already been dealt with.', 'NOT_STAGED');
  if (input.version !== batch.updatedAt.toISOString()) throw conflict(CHANGED_ELSEWHERE, 'CHANGED_ELSEWHERE');
  const onExisting = parseOnExisting(input.onExisting);
  const expected = input.expected as { accountsNew?: unknown; policiesNew?: unknown } | null | undefined;
  if (!expected || typeof expected !== 'object' || typeof expected.accountsNew !== 'number' || typeof expected.policiesNew !== 'number') throw bad('Preview this import first.', 'NO_PREVIEW');
  if (batch.columnMapping === null || validateMapping(batch.columnMapping, batch.headers).errors.length) throw conflict('Choose this file\'s columns first.', 'NOT_MAPPED');

  const claimed = await inImportTransaction(db, async (tx) => {
    // One at a time per agency, or two files naming one new client would each add it.
    const running = await tx.importBatch.findMany({ where: { agencyId: batch.agencyId, status: 'COMMITTING', id: { not: batch.id } } });
    if (running.some((b) => !undoAvailable(b))) throw conflict('Another import for this agency is running. Try again when it has finished.', 'IMPORT_RUNNING');
    // Both of two imports starting at once write this one record, so the database lets only one through.
    await tx.importColumnMemory.upsert({
      where: { agencyId: batch.agencyId },
      create: { agencyId: batch.agencyId, columns: [], updatedById: scope.userId },
      update: { updatedById: scope.userId },
    });
    const { count } = await tx.importBatch.updateMany({ where: { id: batch.id, status: 'STAGED', updatedAt: batch.updatedAt }, data: { status: 'COMMITTING' } });
    if (count !== 1) throw conflict(CHANGED_ELSEWHERE, 'CHANGED_ELSEWHERE');
    return tx.importBatch.findUniqueOrThrow({ where: { id: batch.id } });
  });

  let plan: ImportPlan;
  try {
    plan = await planFor(db, claimed, onExisting);
    if (plan.counts.accountsNew !== expected.accountsNew || plan.counts.policiesNew !== expected.policiesNew) {
      throw conflict('Your book has changed since this preview, so the numbers are different. Check the new preview, then import.', 'PREVIEW_OUT_OF_DATE');
    }
    if (!plan.counts.accountsNew && !plan.counts.policiesNew) throw conflict('There\'s nothing new to import from this file.', 'NOTHING_TO_IMPORT');
  } catch (err) {
    await release(db, batch.id);
    throw err;
  }

  let done: BatchRow;
  try {
    await writePlan(db, claimed, scope, plan.accounts);
    const skipped = plan.counts.errors + plan.counts.duplicates;
    done = await inImportTransaction(db, async (tx) => {
      const { count } = await tx.importBatch.updateMany({
        where: { id: batch.id, status: 'COMMITTING' },
        data: { status: 'COMMITTED', committedAt: new Date(), insuredsCreated: plan.counts.accountsNew, policiesCreated: plan.counts.policiesNew, rowsSkipped: skipped },
      });
      if (count !== 1) throw conflict(CHANGED_ELSEWHERE, 'CHANGED_ELSEWHERE');
      await importAudit(tx, scope, ctx, 'import.committed', batch.id, batch.agencyId, { ...plan.counts, onExisting });
      return tx.importBatch.findUniqueOrThrow({ where: { id: batch.id } });
    });
  } catch (err) {
    // If the cleanup fails too it stays COMMITTING, so a retry can't double up, and it can be undone from the list.
    try {
      await applyRemoval(db, await planRemoval(db, claimed));
      await release(db, batch.id);
    } catch (cleanupErr) {
      console.error('[desk/imports] could not remove a failed commit', cleanupErr);
    }
    throw err;
  }

  // The rows have done their job, and they're a copy of client data.
  await removeRows(db, batch.id).catch((err) => console.error('[desk/imports] could not remove committed rows', err));
  return { ...batchView(done), counts: plan.counts };
}

// ── Undo ──

interface Removal {
  policyIds: string[];
  accountIds: string[];
  summary: { accountsRemoved: number; policiesRemoved: number; accountsKept: number; policiesKept: number; keptNames: string[] };
}

/** What can go: never anything that has been worked on or changed since the import. */
async function planRemoval(db: Db, batch: BatchRow): Promise<Removal> {
  const [policies, accounts] = await Promise.all([
    db.policy.findMany({ where: { importBatchId: batch.id }, select: { id: true, insuredId: true, createdAt: true, updatedAt: true } }),
    db.insuredAccount.findMany({ where: { importBatchId: batch.id }, select: { id: true, name: true, createdAt: true, updatedAt: true } }),
  ]);
  const usedAccounts = new Set<string>();
  const keptPolicies = new Set<string>();
  for (const part of chunks(accounts.map((a) => a.id), ID_CHUNK)) {
    const [tasks, others] = await Promise.all([
      db.task.findMany({ where: { insuredId: { in: part } }, select: { insuredId: true } }),
      db.policy.findMany({ where: { insuredId: { in: part }, OR: [{ importBatchId: { not: batch.id } }, { importBatchId: { isSet: false } }, { importBatchId: null }] }, select: { insuredId: true } }),
    ]);
    for (const t of tasks) if (t.insuredId) usedAccounts.add(t.insuredId);
    for (const p of others) usedAccounts.add(p.insuredId);
  }
  for (const part of chunks(policies.map((p) => p.id), ID_CHUNK)) {
    const tasks = await db.task.findMany({ where: { policyId: { in: part } }, select: { policyId: true } });
    for (const t of tasks) if (t.policyId) keptPolicies.add(t.policyId);
  }
  for (const p of policies) if (p.updatedAt.getTime() !== p.createdAt.getTime()) keptPolicies.add(p.id);
  for (const a of accounts) if (a.updatedAt.getTime() !== a.createdAt.getTime()) usedAccounts.add(a.id);
  for (const p of policies) if (keptPolicies.has(p.id)) usedAccounts.add(p.insuredId);

  // An account that stays keeps what came with it.
  const ownAccounts = new Set(accounts.map((a) => a.id));
  for (const p of policies) if (ownAccounts.has(p.insuredId) && usedAccounts.has(p.insuredId)) keptPolicies.add(p.id);

  const policyIds = policies.filter((p) => !keptPolicies.has(p.id)).map((p) => p.id);
  const accountIds = accounts.filter((a) => !usedAccounts.has(a.id)).map((a) => a.id);
  const kept = accounts.filter((a) => usedAccounts.has(a.id));
  return {
    policyIds, accountIds,
    summary: {
      accountsRemoved: accountIds.length, policiesRemoved: policyIds.length, accountsKept: kept.length, policiesKept: keptPolicies.size,
      keptNames: kept.slice(0, KEPT_NAMES).map((a) => a.name),
    },
  };
}

async function deleteWhereIn(db: Db, collection: string, field: string, ids: string[]) {
  const result = await db.$runCommandRaw({ delete: collection, deletes: [{ q: { [field]: { $in: ids.map(oid) } }, limit: 0 }] });
  if (result.ok !== 1 || result.writeErrors) throw new Error(`Could not remove ${collection} records.`);
}

/** A few chunks at a time: nearly all of a large undo is waiting on the database. */
async function inGroups<T>(parts: T[], work: (part: T) => Promise<void>) {
  for (const group of chunks(parts, DELETES_AT_ONCE)) await Promise.all(group.map(work));
}

const JUST_CHANGED = 'Something on this import was just changed. Please try undoing it again.';

/**
 * Direct database commands: through Prisma, which checks related records on each
 * delete, undoing a full book took over five minutes, too long for a web request.
 * So each chunk checks again just before it goes, and anything new sends the person
 * back to repeat the undo, which works out afresh what can go.
 */
async function applyRemoval(db: Db, removal: Removal) {
  await inGroups(chunks(removal.policyIds, ID_CHUNK), async (part) => {
    if (await db.task.count({ where: { policyId: { in: part } } })) throw conflict(JUST_CHANGED, 'CHANGED_ELSEWHERE');
    await deleteWhereIn(db, 'Policy', '_id', part);
  });
  await inGroups(chunks(removal.accountIds, ID_CHUNK), async (part) => {
    if (await db.task.count({ where: { insuredId: { in: part } } })) throw conflict(JUST_CHANGED, 'CHANGED_ELSEWHERE');
    if (await db.policy.count({ where: { insuredId: { in: part } } })) throw conflict(JUST_CHANGED, 'CHANGED_ELSEWHERE');
    await deleteWhereIn(db, 'InsuredAssignment', 'insuredId', part);
    await deleteWhereIn(db, 'InsuredAccount', '_id', part);
  });
}

/** Can be repeated if it's cut short, since it only ever works from what's still there. */
export async function undoImport(db: Db, scope: DeskScope, id: string, ctx: GuardContext = {}) {
  const batch = await loadBatch(db, scope, id, ctx, 'import.undo');
  if (batch.status === 'UNDONE') throw conflict('This import has already been undone.', 'ALREADY_UNDONE');
  if (!undoAvailable(batch)) throw conflict('Only a finished import can be undone.', 'NOT_COMMITTED');
  const removal = await planRemoval(db, batch);
  const { keptNames: _names, ...counts } = removal.summary;
  // Logged first: an action that can't be logged doesn't happen. A repeated undo adds an entry, and none goes missing.
  await importAudit(db, scope, ctx, 'import.undone', batch.id, batch.agencyId, counts);
  await applyRemoval(db, removal);
  const { count } = await db.importBatch.updateMany({
    where: { id: batch.id, status: batch.status },
    data: { status: 'UNDONE', undoneAt: new Date(), undoneById: scope.userId, undoSummary: removal.summary as unknown as Prisma.InputJsonObject },
  });
  if (count !== 1) throw conflict(CHANGED_ELSEWHERE, 'CHANGED_ELSEWHERE');
  // An import that stopped mid-commit still has its rows.
  await removeRows(db, batch.id).catch((err) => console.error('[desk/imports] could not remove rows on undo', err));
  return batchView(await db.importBatch.findUniqueOrThrow({ where: { id: batch.id } }));
}
