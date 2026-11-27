/**
 * Files on a Desk request: attaching, opening and removing them.
 *
 * Who sees which files is decided by the access layer (documentWhere, Modules
 * 9–10): agency users only files shared with the agency, VAs only the
 * categories they hold, on work they can see. This module adds who may attach
 * and remove, checks what a file really is (lib/desk/document-files.ts), and
 * logs every upload, view, download and removal (client answer Q4). An open or
 * download that can't be logged doesn't happen.
 *
 * The stored file sits in the private bucket. Nobody gets its location: an
 * open is a short-lived link minted after the check and the log entry.
 */
import { Prisma, DocumentSensitivity, type PrismaClient, type TaskDocument } from '@prisma/client';
import { isStaffScope, can, DeskAccessError, documentWhere, getDocumentForScope, getTaskForScope, scopeIn, type DeskScope, type GuardContext } from './access';
import { recordAudit } from './audit';
import { MAX_DOCUMENTS_PER_TASK, checkDocument, viewableInline } from './document-files';
import { SENSITIVITY_LABELS } from './need-to-know';
import { CLOSED_STATUSES } from './task-filters';
import { getFileUrl, deleteObject, isStorageConfigured, putObject, taskDocumentKey } from '../storage/r2';

type Db = PrismaClient;
type Tx = Prisma.TransactionClient;

const TX_OPTIONS = { timeout: 20_000, maxWait: 10_000 };

/** Where files are kept. The app uses R2; the tests pass their own. */
export interface DocumentStore {
  configured(): boolean;
  put(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  link(key: string, opts: { fileName: string; inline: boolean; contentType: string }): Promise<string>;
  remove(key: string): Promise<void>;
}

export const r2DocumentStore: DocumentStore = {
  configured: isStorageConfigured,
  put: (key, bytes, contentType) => putObject({ key, body: bytes, contentType }),
  link: getFileUrl,
  remove: deleteObject,
};

const STORAGE_OFF = 'File storage is not set up yet, so documents can\'t be attached or opened. Your Desk team has been told.';
/** Hands work out (Module 48: `requests.assign`): may remove any file they can see. */
const isManager = (s: DeskScope) => can(s, 'requests.assign');
const isClosed = (status: string) => (CLOSED_STATUSES as readonly string[]).includes(status);
const actorOf = (s: DeskScope) => ({ id: s.userId, role: s.role });

function storageReady(store: DocumentStore) {
  if (!store.configured()) {
    console.error('[desk/documents] R2 storage is not configured');
    throw new DeskAccessError(503, STORAGE_OFF, 'STORAGE_UNAVAILABLE');
  }
}

async function inTransaction<T>(db: Db, fn: (tx: Tx) => Promise<T>): Promise<T> {
  try {
    return await db.$transaction(fn, TX_OPTIONS);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2034') {
      throw new DeskAccessError(409, 'The request was changed by someone else. Try again.', 'CHANGED_ELSEWHERE');
    }
    throw err;
  }
}

// ── Views ──

type Uploader = { id: string; firstName: string | null; lastName: string | null; email: string; agencyId: string | null };
const nameOf = (u: Uploader) => [u.firstName, u.lastName].filter(Boolean).join(' ') || u.email;

/**
 * Who may remove a file:
 *  - positions that hand work out (Account Managers and up): any they can see, at any time;
 *  - whoever attached it, while the request is open;
 *  - an agency's Owner / Admin: any file their agency's people attached, while open.
 */
function mayRemove(scope: DeskScope, doc: Pick<TaskDocument, 'uploadedById'>, uploader: Uploader | undefined, taskClosed: boolean): boolean {
  if (isManager(scope)) return true;
  if (taskClosed) return false;
  if (doc.uploadedById === scope.userId) return true;
  return scope.kind === 'AGENCY' && scope.role === 'ADMIN' && !!uploader && uploader.agencyId === scope.agencyId;
}

function documentView(scope: DeskScope, doc: TaskDocument, uploaders: Map<string, Uploader>, taskClosed: boolean, podId: string | null) {
  scope = scopeIn(scope, doc.agencyId, podId);
  const uploader = doc.uploadedById ? uploaders.get(doc.uploadedById) : undefined;
  // Agencies see their colleagues by name and the Desk team as a team (as in the history).
  const addedBy = scope.kind === 'AGENCY'
    ? (uploader && uploader.agencyId === scope.agencyId ? nameOf(uploader) : 'Your Desk team')
    : (uploader ? nameOf(uploader) : doc.uploadedById ? 'Former user' : 'The Desk');
  return {
    id: doc.id,
    fileName: doc.fileName,
    fileSize: doc.fileSize,
    contentType: doc.contentType,
    sensitivity: doc.sensitivity,
    sensitivityLabel: SENSITIVITY_LABELS[doc.sensitivity],
    ...(scope.kind === 'AGENCY' ? {} : { visibility: doc.visibility }),
    addedBy,
    createdAt: doc.createdAt,
    viewable: viewableInline(doc.contentType),
    canRemove: mayRemove(scope, doc, uploader, taskClosed),
  };
}

async function uploadersOf(db: Db, docs: Pick<TaskDocument, 'uploadedById'>[]) {
  const ids = [...new Set(docs.map((d) => d.uploadedById).filter((id): id is string => !!id))];
  const people = ids.length
    ? await db.user.findMany({ where: { id: { in: ids } }, select: { id: true, firstName: true, lastName: true, email: true, agencyId: true } })
    : [];
  return new Map(people.map((p) => [p.id, p]));
}

/**
 * The files on a request this person may see, newest first. The caller logs the
 * listing (the request detail does, with the file ids).
 */
export async function taskDocumentsFor(db: Db, scope: DeskScope, task: { id: string; status: string; podId: string | null }) {
  const docs = await db.taskDocument.findMany({
    where: { AND: [{ taskId: task.id }, documentWhere(scope)] },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  });
  const uploaders = await uploadersOf(db, docs);
  return docs.map((d) => documentView(scope, d, uploaders, isClosed(task.status), task.podId));
}

// ── Attaching ──

export interface NewDocument {
  fileName: unknown;
  bytes: Uint8Array;
  sensitivity: unknown;
  visibility?: unknown;
}

/**
 * The checks that don't need the file: the request is visible and open, the
 * person may attach to it, and it isn't full. The upload route runs these
 * before reading a large body.
 */
export async function documentTarget(db: Db, scope: DeskScope, taskId: string, ctx: GuardContext = {}) {
  const task = await getTaskForScope(db, scope, taskId, ctx);
  if (isClosed(task.status)) throw new DeskAccessError(409, 'This request is closed, so documents can\'t be added.', 'TASK_CLOSED');
  const count = await db.taskDocument.count({ where: { AND: [{ taskId: task.id }, { OR: [{ deletedAt: null }, { deletedAt: { isSet: false } }] }] } });
  if (count >= MAX_DOCUMENTS_PER_TASK) {
    throw new DeskAccessError(409, `A request can hold up to ${MAX_DOCUMENTS_PER_TASK} documents. Remove one first, or send a new request.`, 'TOO_MANY_DOCUMENTS');
  }
  return task;
}

export async function addTaskDocument(db: Db, scope: DeskScope, taskId: string, input: NewDocument, ctx: GuardContext = {}, store: DocumentStore = r2DocumentStore) {
  const task = await documentTarget(db, scope, taskId, ctx);
  scope = scopeIn(scope, task.agencyId, task.podId);

  if (typeof input.sensitivity !== 'string' || !(Object.values(DocumentSensitivity) as string[]).includes(input.sensitivity)) {
    throw new DeskAccessError(400, 'Choose what kind of document this is.', 'NO_SENSITIVITY');
  }
  const sensitivity = input.sensitivity as DocumentSensitivity;
  // Staff can't file a document into a category they couldn't open themselves.
  if (isStaffScope(scope) && !scope.sensitivities.includes(sensitivity)) {
    throw new DeskAccessError(403, `You can't attach ${SENSITIVITY_LABELS[sensitivity].toLowerCase()} documents. Ask your Account Manager.`, 'SENSITIVITY_NOT_HELD');
  }
  // Agency users' files are always shared with their agency; staff files are internal unless shared.
  let visibility: 'INTERNAL' | 'AGENCY' = 'INTERNAL';
  if (scope.kind === 'AGENCY') visibility = 'AGENCY';
  else if (input.visibility !== undefined && input.visibility !== null) {
    if (input.visibility !== 'INTERNAL' && input.visibility !== 'AGENCY') throw new DeskAccessError(400, 'Choose who can see this document.');
    visibility = input.visibility;
  }

  const file = checkDocument(input.fileName, input.bytes);
  if (!file.ok) throw new DeskAccessError(400, file.message, file.code);

  storageReady(store);
  const key = taskDocumentKey(task.agencyId, task.id, file.fileName);
  await store.put(key, input.bytes, file.contentType);

  try {
    const doc = await inTransaction(db, async (tx) => {
      const created = await tx.taskDocument.create({
        data: {
          taskId: task.id, agencyId: task.agencyId, storageKey: key, fileName: file.fileName, fileSize: input.bytes.length,
          contentType: file.contentType, visibility, sensitivity, uploadedById: scope.userId,
        },
      });
      await tx.taskEvent.create({
        data: {
          taskId: task.id, agencyId: task.agencyId, actorId: scope.userId, kind: 'DOCUMENT_ADDED', visibility, body: file.fileName,
          metadata: { documentId: created.id, sensitivity },
        },
      });
      await tx.task.update({ where: { id: task.id }, data: { lastActivityAt: new Date() } });
      // The file's name is the uploader's text, so the log keeps the id and facts only.
      await recordAudit(tx, {
        actor: actorOf(scope), action: 'document.uploaded', entityType: 'TaskDocument', entityId: created.id, agencyId: task.agencyId,
        metadata: { taskId: task.id, reference: task.reference, sensitivity, visibility, size: input.bytes.length, contentType: file.contentType },
        ...ctx,
      });
      return created;
    });
    const uploaders = await uploadersOf(db, [doc]);
    return documentView(scope, doc, uploaders, false, task.podId);
  } catch (err) {
    // Nothing points at the stored file, so it goes too.
    await store.remove(key).catch((e) => console.error('[desk/documents] could not remove an unrecorded upload', key, e));
    throw err;
  }
}

// ── Opening ──

/**
 * A short-lived link to the file, after the access check and the log entry.
 * `view` opens PDFs and images in the browser; anything else always downloads.
 */
export async function openTaskDocument(db: Db, scope: DeskScope, documentId: string, opts: { view?: boolean } = {}, ctx: GuardContext = {}, store: DocumentStore = r2DocumentStore) {
  const doc = await getDocumentForScope(db, scope, documentId, ctx);
  storageReady(store);
  const inline = !!opts.view && viewableInline(doc.contentType);
  await recordAudit(db, {
    actor: actorOf(scope), action: inline ? 'document.viewed' : 'document.downloaded', entityType: 'TaskDocument', entityId: doc.id, agencyId: doc.agencyId,
    metadata: { taskId: doc.taskId, sensitivity: doc.sensitivity },
    ...ctx,
  });
  return store.link(doc.storageKey, { fileName: doc.fileName, inline, contentType: doc.contentType });
}

// ── Removing ──

/**
 * Hides the file from everyone and deletes the stored copy; the record stays,
 * so the history still says what was attached and removed, and by whom.
 */
export async function removeTaskDocument(db: Db, scope: DeskScope, documentId: string, ctx: GuardContext = {}, store: DocumentStore = r2DocumentStore) {
  const doc = await getDocumentForScope(db, scope, documentId, ctx);
  const task = await db.task.findUniqueOrThrow({ where: { id: doc.taskId }, select: { id: true, status: true, reference: true, podId: true } });
  scope = scopeIn(scope, doc.agencyId, task.podId);
  const uploaders = await uploadersOf(db, [doc]);
  if (!mayRemove(scope, doc, doc.uploadedById ? uploaders.get(doc.uploadedById) : undefined, isClosed(task.status))) {
    await recordAudit(db, {
      actor: actorOf(scope), action: 'access.denied', entityType: 'TaskDocument', entityId: doc.id, agencyId: doc.agencyId,
      metadata: { scope: scope.kind, op: 'remove', sensitivity: doc.sensitivity }, ...ctx,
    });
    throw new DeskAccessError(403, isClosed(task.status)
      ? 'This request is closed. Ask your Account Manager to remove the document.'
      : 'You can only remove documents you added.', 'NOT_YOURS');
  }

  await inTransaction(db, async (tx) => {
    const now = new Date();
    // Only if nobody removed it a moment ago.
    const { count } = await tx.taskDocument.updateMany({
      where: { AND: [{ id: doc.id }, { OR: [{ deletedAt: null }, { deletedAt: { isSet: false } }] }] },
      data: { deletedAt: now, deletedById: scope.userId },
    });
    if (count === 0) throw new DeskAccessError(404, 'Not found');
    await tx.taskEvent.create({
      data: {
        taskId: doc.taskId, agencyId: doc.agencyId, actorId: scope.userId, kind: 'DOCUMENT_REMOVED', visibility: doc.visibility, body: doc.fileName,
        metadata: { documentId: doc.id, sensitivity: doc.sensitivity },
      },
    });
    await tx.task.update({ where: { id: doc.taskId }, data: { lastActivityAt: now } });
    await recordAudit(tx, {
      actor: actorOf(scope), action: 'document.removed', entityType: 'TaskDocument', entityId: doc.id, agencyId: doc.agencyId,
      metadata: { taskId: doc.taskId, reference: task.reference, sensitivity: doc.sensitivity, visibility: doc.visibility },
      ...ctx,
    });
  });

  // After the record is updated: a stored file nobody can reach is better than a listed file that's gone.
  if (store.configured()) {
    await store.remove(doc.storageKey).catch((e) => console.error('[desk/documents] could not delete a removed file', doc.storageKey, e));
  }
  return { removed: true };
}
