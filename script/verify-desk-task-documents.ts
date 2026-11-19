/**
 * The Desk, Module 30: documents on a request.
 *
 * The file rules alone (what a file really is, names, limits), then the service
 * with an in-memory store: who may attach, open and remove; what each person
 * sees in a request's file list; that every upload, open and removal is logged,
 * and that an open which can't be logged doesn't happen. Then the real routes,
 * which use R2 (on a machine without R2 they must refuse with a clear 503).
 * Temporary agencies, users and pods only.
 * Run with:  npx tsx script/verify-desk-task-documents.ts
 */
import 'dotenv/config';
import { readFileSync } from 'fs';
import { NextRequest } from 'next/server';
import type { PrismaClient, UserRole } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { createSession } from '../lib/auth';
import { DeskAccessError, resolveDeskScope } from '../lib/desk/access';
import {
  DOCUMENT_ACCEPT, FILE_NAME_MAX, MAX_DOCUMENTS_PER_TASK, MAX_DOCUMENT_BYTES, checkDocument, cleanFileName, formatBytes, precheckDocument, viewableInline,
} from '../lib/desk/document-files';
import { addTaskDocument, openTaskDocument, removeTaskDocument, type DocumentStore } from '../lib/desk/task-documents';
import { getTaskDetail } from '../lib/desk/task-api';
import { isStorageConfigured } from '../lib/storage/r2';
import { POST as uploadRoute } from '../app/api/desk/tasks/[id]/documents/route';
import { GET as openRoute, DELETE as removeRoute } from '../app/api/desk/documents/[id]/route';

let pass = 0, fail = 0;
const ok = (n: string, c: boolean) => {
  c ? pass++ : fail++;
  console.log(`  ${c ? '✓' : '✗'} ${n}`);
  if (!c && process.env.FAIL_FAST) throw new Error(`stopped at: ${n}`);
};

const TAG = `m30test${Date.now()}`;
const cleanup = { agencyIds: [] as string[], userIds: [] as string[], podIds: [] as string[] };
const read = (p: string) => readFileSync(p, 'utf8');

async function wipe() {
  const agencyId = { in: cleanup.agencyIds };
  await prisma.taskDocument.deleteMany({ where: { agencyId } });
  await prisma.taskEvent.deleteMany({ where: { agencyId } });
  await prisma.task.updateMany({ where: { agencyId }, data: { parentTaskId: null } });
  await prisma.task.deleteMany({ where: { agencyId } });
  await prisma.insuredAssignment.deleteMany({ where: { agencyId } });
  await prisma.insuredAccount.deleteMany({ where: { agencyId } });
  await prisma.agencyPodAccess.deleteMany({ where: { agencyId } });
  await prisma.agencyDeskAssignment.deleteMany({ where: { agencyId } });
  await prisma.deskStaffPermission.deleteMany({ where: { userId: { in: cleanup.userIds } } });
  await prisma.podMember.deleteMany({ where: { podId: { in: cleanup.podIds } } });
  await prisma.pod.deleteMany({ where: { id: { in: cleanup.podIds } } });
  await prisma.deskAuditLog.deleteMany({ where: { OR: [{ agencyId }, { actorId: { in: cleanup.userIds } }] } });
  await prisma.session.deleteMany({ where: { userId: { in: cleanup.userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: cleanup.userIds } } });
  await prisma.agency.deleteMany({ where: { id: agencyId } });
}

const bytes = (...parts: (string | number[])[]) => new Uint8Array(parts.flatMap((p) => (typeof p === 'string' ? [...Buffer.from(p, 'latin1')] : p)));
const PDF = bytes('%PDF-1.7\n', 'x'.repeat(200));
const PNG = bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 'rest');
const JPG = bytes([0xff, 0xd8, 0xff, 0xe0], 'rest');
const WEBP = bytes('RIFF', [1, 2, 3, 4], 'WEBPVP8 ');
const HEIC = bytes([0, 0, 0, 24], 'ftypheic', 'rest');
const ZIP = bytes([0x50, 0x4b, 0x03, 0x04], 'rest');
const OLE = bytes([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1], 'rest');
const TEXT = bytes('Name,Policy\nAcme,GL-1\n');
const EXE = bytes('MZ', [0x90, 0, 3, 0], 'This program cannot be run in DOS mode');

function rules() {
  console.log('What a file really is');
  const kind = (name: string, b: Uint8Array) => { const r = checkDocument(name, b); return r.ok ? r.contentType : r.code; };
  ok('PDF', kind('quote.pdf', PDF) === 'application/pdf');
  ok('images: JPG, PNG, WebP, HEIC', kind('a.jpg', JPG) === 'image/jpeg' && kind('a.JPEG', JPG) === 'image/jpeg' && kind('a.png', PNG) === 'image/png' && kind('a.webp', WEBP) === 'image/webp' && kind('a.heic', HEIC) === 'image/heic');
  ok('Word and Excel, old and new', kind('a.docx', ZIP).includes('wordprocessingml') && kind('a.xlsx', ZIP).includes('spreadsheetml') && kind('a.doc', OLE) === 'application/msword' && kind('a.xls', OLE) === 'application/vnd.ms-excel');
  ok('Outlook and email files', kind('a.msg', OLE) === 'application/vnd.ms-outlook' && kind('a.eml', TEXT) === 'message/rfc822');
  ok('CSV and text', kind('a.csv', TEXT) === 'text/csv' && kind('a.txt', TEXT) === 'text/plain');
  ok('a program renamed to .pdf: refused', kind('quote.pdf', EXE) === 'CONTENT');
  ok('a PDF renamed to .png: refused', kind('photo.png', PDF) === 'CONTENT');
  ok('a .png with only the first byte right: refused', kind('photo.png', bytes([0x89], 'NOTPNG..')) === 'CONTENT');
  ok('binary in a .csv: refused', kind('list.csv', bytes('a,b\n', [0], 'c')) === 'CONTENT');
  ok('a JPG missing its last signature byte: refused', kind('a.jpg', bytes([0xff, 0xd8], 'x')) === 'CONTENT');
  ok('a WebP needs both of its markers', kind('a.webp', bytes('RIFF', [1, 2, 3, 4], 'AVI ')) === 'CONTENT');
  for (const name of ['run.exe', 'page.html', 'drawing.svg', 'script.js', 'archive.zip', 'noextension']) ok(`${name}: not allowed`, kind(name, TEXT) === 'TYPE');
  ok('the browser\'s claimed type plays no part (only name and bytes are read)', checkDocument.length === 2);
  ok('empty: refused', kind('a.pdf', new Uint8Array()) === 'EMPTY');
  ok(`up to ${MAX_DOCUMENT_BYTES / 1024 / 1024} MB`, kind('a.txt', new Uint8Array(MAX_DOCUMENT_BYTES).fill(65)) === 'text/plain');
  ok('one byte more: refused', kind('a.txt', new Uint8Array(MAX_DOCUMENT_BYTES + 1).fill(65)) === 'TOO_LARGE');
  ok('the limit fits under the 10 MB a body keeps through middleware', MAX_DOCUMENT_BYTES + 64 * 1024 < 10 * 1024 * 1024);

  console.log('Names');
  ok('folders dropped', cleanFileName('C:\\Users\\bob\\quote.pdf') === 'quote.pdf' && cleanFileName('../../etc/passwd.txt') === 'passwd.txt');
  ok('control characters dropped', cleanFileName('quo\u0000te\u001b.pdf') === 'quote.pdf');
  ok('no name, or only dots: none', cleanFileName('') === null && cleanFileName('   ') === null && cleanFileName('..') === null && cleanFileName(42) === null);
  const long = cleanFileName(`${'n'.repeat(400)}.pdf`)!;
  ok('a long name is shortened, keeping its extension', long.length === FILE_NAME_MAX && long.endsWith('.pdf'));
  ok('non-English names kept', cleanFileName('Póliza – 2027.pdf') === 'Póliza – 2027.pdf');
  ok('a nameless file is refused', checkDocument('', PDF).ok === false);

  console.log('Shown in the browser, or downloaded');
  ok('PDFs and images open in the browser', viewableInline('application/pdf') && viewableInline('image/png') && viewableInline('image/jpeg'));
  ok('everything else downloads', !viewableInline('text/csv') && !viewableInline('message/rfc822') && !viewableInline('image/heic') && !viewableInline('text/html'));
  ok('the file picker offers the same list', DOCUMENT_ACCEPT.includes('.pdf') && DOCUMENT_ACCEPT.includes('.msg') && !DOCUMENT_ACCEPT.includes('.html') && !DOCUMENT_ACCEPT.includes('.svg'));
  ok('the browser\'s quick check', precheckDocument('a.exe', 10)!.includes("can't be attached") && precheckDocument('a.pdf', 0)!.includes('empty') && precheckDocument('a.pdf', MAX_DOCUMENT_BYTES + 1)!.includes('larger') && precheckDocument('a.pdf', 10) === null);
  ok('sizes read naturally', formatBytes(512) === '512 B' && formatBytes(2048) === '2 KB' && formatBytes(3.5 * 1024 * 1024) === '3.5 MB');
}

/** Keeps files in memory, and remembers what was asked of it. */
function memoryStore(on = true) {
  const files = new Map<string, { bytes: Uint8Array; contentType: string }>();
  const calls: string[] = [];
  const links: { key: string; fileName: string; inline: boolean; contentType: string }[] = [];
  const store: DocumentStore & { files: typeof files; calls: string[]; links: typeof links; failPut?: boolean } = {
    files, calls, links,
    configured: () => on,
    put: async (key, b, contentType) => { calls.push(`put ${key}`); if (store.failPut) throw new Error('store down'); files.set(key, { bytes: b, contentType }); },
    link: async (key, opts) => { calls.push(`link ${key}`); links.push({ key, ...opts }); return `https://files.example.test/${encodeURIComponent(key)}?signed`; },
    remove: async (key) => { calls.push(`remove ${key}`); files.delete(key); },
  };
  return store;
}

const refusal = async (fn: () => Promise<unknown>) => {
  try { await fn(); return null; } catch (err) { return err instanceof DeskAccessError ? { status: err.status, code: err.code, message: err.message } : { status: -1, code: String(err), message: '' }; }
};

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const req = (url: string, token: string, init: { method?: string; body?: FormData; headers?: Record<string, string> } = {}) =>
  new NextRequest(`http://local.test${url}`, { method: init.method ?? 'GET', headers: { cookie: `session_token=${token}`, ...init.headers }, ...(init.body ? { body: init.body } : {}) });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

(async () => {
  try {
    rules();

    const mkAgency = async (n: string) => { const a = await prisma.agency.create({ data: { name: `${TAG} ${n}`, deskEnabled: true } }); cleanup.agencyIds.push(a.id); return a; };
    const mkUser = async (n: string, role: UserRole, agencyId: string | null = null, extra: object = {}) => {
      const u = await prisma.user.create({ data: { email: `${TAG}-${n}@example.test`, role, agencyId, firstName: `${TAG}${n}`, lastName: 'Person', mustChangePassword: false, ...extra } });
      cleanup.userIds.push(u.id); return u;
    };
    const A = await mkAgency('A'), B = await mkAgency('B');
    const admin = await mkUser('admin', 'ADMIN', A.id);
    const csr = await mkUser('csr', 'CSR', A.id, { bookAccess: 'ALL' });
    const producer = await mkUser('producer', 'AGENT', A.id, { bookAccess: 'ASSIGNED' });
    const adminB = await mkUser('adminb', 'ADMIN', B.id);
    const am = await mkUser('am', 'ACCOUNT_MANAGER');
    const ops = await mkUser('ops', 'DESK_ADMIN');
    const va = await mkUser('va', 'DESK_VA');
    const vaFin = await mkUser('vafin', 'DESK_VA');
    const vaOut = await mkUser('vaout', 'DESK_VA');
    const pod = await prisma.pod.create({ data: { code: TAG, name: `${TAG} Pod` } }); cleanup.podIds.push(pod.id);
    const pod2 = await prisma.pod.create({ data: { code: `${TAG}b`, name: `${TAG} Other` } }); cleanup.podIds.push(pod2.id);
    await prisma.podMember.createMany({ data: [{ podId: pod.id, userId: va.id }, { podId: pod.id, userId: vaFin.id }, { podId: pod2.id, userId: vaOut.id }] });
    await prisma.agencyPodAccess.create({ data: { agencyId: A.id, podId: pod.id } });
    await prisma.agencyDeskAssignment.create({ data: { agencyId: A.id, primaryAmId: am.id } });
    await prisma.deskStaffPermission.create({ data: { userId: vaFin.id, allowedSensitivities: ['FINANCIAL'] } });
    const acme = await prisma.insuredAccount.create({ data: { agencyId: A.id, name: `${TAG} Acme`, nameKey: `${TAG} acme` } });
    const zen = await prisma.insuredAccount.create({ data: { agencyId: A.id, name: `${TAG} Zen`, nameKey: `${TAG} zen` } });
    await prisma.insuredAssignment.create({ data: { agencyId: A.id, insuredId: acme.id, userId: producer.id, role: 'PRODUCER' } });
    let n = 0;
    const mkTask = (title: string, data: object = {}, agencyId = A.id) => {
      n += 1;
      return prisma.task.create({ data: { reference: 910_000_000 + (Date.now() % 80_000_000) + n, agencyId, type: 'COI', title: `${TAG} ${title}`, podId: pod.id, createdById: admin.id, restrictedToUserIds: [], insuredId: agencyId === A.id ? acme.id : null, ...data } });
    };
    const task = await mkTask('open');
    const zenTask = await mkTask('zen', { insuredId: zen.id });
    const closed = await mkTask('closed', { status: 'COMPLETED', completedAt: new Date() });
    const bTask = await mkTask('b', {}, B.id);

    const scope = (u: { id: string }) => resolveDeskScope(prisma, u.id);
    const [sAdmin, sCsr, sProducer, sAdminB, sAm, sOps, sVa, sVaFin, sVaOut] = await Promise.all([admin, csr, producer, adminB, am, ops, va, vaFin, vaOut].map(scope));
    const store = memoryStore();
    const add = (s: Awaited<ReturnType<typeof scope>>, taskId: string, input: { fileName?: unknown; bytes?: Uint8Array; sensitivity?: unknown; visibility?: unknown }, st: DocumentStore = store) =>
      addTaskDocument(prisma, s, taskId, { fileName: 'quote.pdf', bytes: PDF, sensitivity: 'POLICY', ...input }, { ip: '10.0.0.1', userAgent: 'verify' }, st);
    const audits = (action: string, entityId?: string) => prisma.deskAuditLog.findMany({ where: { action, ...(entityId ? { entityId } : { agencyId: { in: cleanup.agencyIds } }) } });

    console.log('Attaching');
    const before = (await prisma.task.findUniqueOrThrow({ where: { id: task.id } })).lastActivityAt;
    const mine = await add(sAdmin, task.id, { fileName: 'C:\\scans\\Holder list.pdf', visibility: 'INTERNAL' });
    const saved = await prisma.taskDocument.findUniqueOrThrow({ where: { id: mine.id } });
    ok('an agency user attaches a file', !!mine.id && mine.fileName === 'Holder list.pdf' && mine.sensitivityLabel === 'Policy documents');
    ok('their files are always shared with their agency', saved.visibility === 'AGENCY');
    ok('stored under the agency and the request', saved.storageKey.startsWith(`agencies/${A.id}/tasks/${task.id}/`) && store.files.has(saved.storageKey));
    ok('type from the file itself', saved.contentType === 'application/pdf' && store.files.get(saved.storageKey)!.contentType === 'application/pdf');
    ok('the location is never sent', !JSON.stringify(mine).includes(saved.storageKey) && !('storageKey' in mine));
    ok('an agency user isn\'t told internal sharing details', !('visibility' in mine));
    const added = await prisma.taskEvent.findFirst({ where: { taskId: task.id, kind: 'DOCUMENT_ADDED' } });
    ok('in the request\'s history, shared with the agency', added?.visibility === 'AGENCY' && added.body === 'Holder list.pdf' && added.actorId === admin.id);
    const upLog = (await audits('document.uploaded', mine.id))[0];
    ok('logged, with facts only (no file name)', !!upLog && !JSON.stringify(upLog.metadata).includes('Holder') && (upLog.metadata as Json).sensitivity === 'POLICY' && upLog.ipAddress === '10.0.0.1');
    ok('the request shows recent activity', (await prisma.task.findUniqueOrThrow({ where: { id: task.id } })).lastActivityAt! > before!);

    const internal = await add(sAm, task.id, { fileName: 'carrier notes.txt', bytes: TEXT, sensitivity: 'GENERAL' });
    ok('staff files are internal unless shared', (await prisma.taskDocument.findUniqueOrThrow({ where: { id: internal.id } })).visibility === 'INTERNAL' && internal.visibility === 'INTERNAL');
    const shared = await add(sAm, task.id, { fileName: 'certificate.pdf', sensitivity: 'GENERAL', visibility: 'AGENCY' });
    ok('and shared when asked', shared.visibility === 'AGENCY');
    const fin = await add(sVaFin, task.id, { fileName: 'bank letter.pdf', sensitivity: 'FINANCIAL' });
    ok('a VA with the Financial grant may file Financial', fin.sensitivity === 'FINANCIAL');
    const vaDoc = await add(sVa, task.id, { fileName: 'dec page.png', bytes: PNG, sensitivity: 'POLICY' });
    ok('a VA attaches to work in their pod', vaDoc.contentType === 'image/png');

    console.log('Refused when attaching');
    const stored = store.files.size;
    ok('no category: 400', (await refusal(() => add(sAdmin, task.id, { sensitivity: undefined })))?.code === 'NO_SENSITIVITY');
    ok('an unknown category: 400', (await refusal(() => add(sAdmin, task.id, { sensitivity: 'SECRET' })))?.code === 'NO_SENSITIVITY');
    ok('a file that isn\'t what it says: 400', (await refusal(() => add(sAdmin, task.id, { fileName: 'quote.pdf', bytes: EXE })))?.code === 'CONTENT');
    ok('a type not allowed: 400', (await refusal(() => add(sAdmin, task.id, { fileName: 'a.html', bytes: TEXT })))?.code === 'TYPE');
    ok('staff: a bad sharing choice: 400', (await refusal(() => add(sAm, task.id, { visibility: 'PUBLIC' })))?.status === 400);
    const noGrant = await refusal(() => add(sVa, task.id, { sensitivity: 'FINANCIAL' }));
    ok('a VA without the grant can\'t file Financial: 403', noGrant?.status === 403 && noGrant.code === 'SENSITIVITY_NOT_HELD');
    ok('nor Personal', (await refusal(() => add(sVaFin, task.id, { sensitivity: 'PERSONAL' })))?.status === 403);
    ok('a Producer, on an account not theirs: 404', (await refusal(() => add(sProducer, zenTask.id, {})))?.status === 404);
    ok('another agency: 404', (await refusal(() => add(sAdminB, task.id, {})))?.status === 404);
    ok('a VA outside the pod: 404', (await refusal(() => add(sVaOut, task.id, {})))?.status === 404);
    ok('the refusals are logged', (await audits('access.denied')).some((a) => a.entityId === task.id && a.actorId === adminB.id));
    ok('a closed request: 409', (await refusal(() => add(sAdmin, closed.id, {})))?.code === 'TASK_CLOSED');
    ok('nothing stored for any of these', store.files.size === stored);
    const off = memoryStore(false);
    const offRefusal = await refusal(() => add(sAdmin, task.id, {}, off));
    ok('storage not set up: 503 with a clear message', offRefusal?.status === 503 && offRefusal.code === 'STORAGE_UNAVAILABLE' && /not set up/.test(offRefusal.message) && off.calls.length === 0);
    const broken = memoryStore();
    broken.failPut = true;
    ok('the store failing: nothing recorded', (await refusal(() => add(sAdmin, task.id, { fileName: 'lost.pdf' }, broken)))?.status === -1 && await prisma.taskDocument.count({ where: { fileName: 'lost.pdf' } }) === 0);
    // The database failing after the file is stored: the stored file is removed again.
    const failing = new Proxy(prisma, { get: (t, p) => (p === '$transaction' ? async () => { throw new Error('db down'); } : Reflect.get(t, p)) }) as PrismaClient;
    const orphan = memoryStore();
    await refusal(() => addTaskDocument(failing, sAdmin, task.id, { fileName: 'orphan.pdf', bytes: PDF, sensitivity: 'POLICY' }, {}, orphan));
    ok('the database failing: the stored file is removed again', orphan.calls.length === 2 && orphan.calls[1].startsWith('remove ') && orphan.files.size === 0);

    console.log('How many');
    const full = await mkTask('full');
    await prisma.taskDocument.createMany({ data: Array.from({ length: MAX_DOCUMENTS_PER_TASK }, (_, i) => ({ taskId: full.id, agencyId: A.id, storageKey: `x/${i}`, fileName: `f${i}.pdf`, fileSize: 1, contentType: 'application/pdf', sensitivity: 'GENERAL' as const })) });
    ok(`${MAX_DOCUMENTS_PER_TASK} files is the most: 409`, (await refusal(() => add(sAdmin, full.id, {})))?.code === 'TOO_MANY_DOCUMENTS');
    await prisma.taskDocument.updateMany({ where: { taskId: full.id, fileName: 'f0.pdf' }, data: { deletedAt: new Date() } });
    ok('removed files don\'t count', !!(await add(sAdmin, full.id, {})).id);

    console.log('Who sees which files');
    const names = (docs: { fileName: string }[]) => docs.map((d) => d.fileName).sort().join();
    const detail = (s: Awaited<ReturnType<typeof scope>>) => getTaskDetail(prisma, s, task.id, {});
    const agencyView = await detail(sAdmin);
    ok('agency: only shared files', names(agencyView.documents) === 'Holder list.pdf,certificate.pdf');
    ok('agency: their colleague by name, staff as the team', agencyView.documents.find((d) => d.fileName === 'certificate.pdf')!.addedBy === 'Your Desk team'
      && agencyView.documents.find((d) => d.fileName === 'Holder list.pdf')!.addedBy === `${TAG}admin Person`);
    ok('agency: no sharing details, no locations', agencyView.documents.every((d) => !('visibility' in d) && !('storageKey' in d)));
    const amView = await detail(sAm);
    ok('Account Manager: every file, with who it\'s shared with', amView.documents.length === 5 && amView.documents.every((d) => 'visibility' in d));
    ok('newest first', amView.documents[0].fileName === 'dec page.png');
    ok('VA: General and Policy only', names((await detail(sVa)).documents) === 'Holder list.pdf,carrier notes.txt,certificate.pdf,dec page.png');
    ok('VA with the Financial grant: Financial too', (await detail(sVaFin)).documents.some((d) => d.sensitivity === 'FINANCIAL'));
    ok('which open in the browser', amView.documents.find((d) => d.fileName === 'dec page.png')!.viewable && !amView.documents.find((d) => d.fileName === 'carrier notes.txt')!.viewable);
    const viewed = (await prisma.deskAuditLog.findMany({ where: { action: 'task.viewed', entityId: task.id, actorId: va.id } }))[0];
    ok('the listing is logged with the file ids', ((viewed?.metadata as Json)?.documentIds ?? []).length === 4);

    console.log('Opening');
    const link = await openTaskDocument(prisma, sAdmin, mine.id, { view: true }, {}, store);
    ok('a short-lived link, after the check', link.startsWith('https://files.example.test/') && store.links.at(-1)!.inline && store.links.at(-1)!.fileName === 'Holder list.pdf');
    ok('logged as viewed', (await audits('document.viewed', mine.id)).length === 1);
    await openTaskDocument(prisma, sAdmin, mine.id, {}, {}, store);
    ok('without view: downloaded, and logged so', !store.links.at(-1)!.inline && (await audits('document.downloaded', mine.id)).length === 1);
    await openTaskDocument(prisma, sAm, internal.id, { view: true }, {}, store);
    ok('a text file always downloads', !store.links.at(-1)!.inline && (await audits('document.downloaded', internal.id)).length === 1);
    ok('the stored type is sent with it', store.links.at(-1)!.contentType === 'text/plain');
    const linksBefore = store.links.length;
    ok('agency: an internal file: 404', (await refusal(() => openTaskDocument(prisma, sAdmin, internal.id, {}, {}, store)))?.status === 404);
    const denied = (await audits('access.denied')).find((a) => a.entityId === internal.id);
    ok('logged with the file\'s category', (denied?.metadata as Json)?.sensitivity === 'GENERAL');
    ok('VA without the grant: a Financial file: 404', (await refusal(() => openTaskDocument(prisma, sVa, fin.id, {}, {}, store)))?.status === 404);
    ok('another agency: 404', (await refusal(() => openTaskDocument(prisma, sAdminB, mine.id, {}, {}, store)))?.status === 404);
    ok('a made-up id: 404', (await refusal(() => openTaskDocument(prisma, sAdmin, 'not-an-id', {}, {}, store)))?.status === 404);
    ok('no link made for any of these', store.links.length === linksBefore);
    const noLog = new Proxy(prisma, { get: (t, p) => (p === 'deskAuditLog' ? { create: async () => { throw new Error('log down'); } } : Reflect.get(t, p)) }) as PrismaClient;
    ok('if it can\'t be logged, it doesn\'t open', (await refusal(() => openTaskDocument(noLog, sAdmin, mine.id, {}, {}, store)))?.status === -1 && store.links.length === linksBefore);
    ok('storage not set up: 503', (await refusal(() => openTaskDocument(prisma, sAdmin, mine.id, {}, {}, off)))?.status === 503);

    console.log('Removing');
    const csrDoc = await add(sCsr, task.id, { fileName: 'csr upload.pdf' });
    const adminDoc2 = await add(sAdmin, task.id, { fileName: 'admin second.pdf' });
    const notYours = await refusal(() => removeTaskDocument(prisma, sCsr, adminDoc2.id, {}, store));
    ok('a CSR can\'t remove the admin\'s file: 403', notYours?.status === 403 && notYours.code === 'NOT_YOURS');
    ok('and the attempt is logged', (await audits('access.denied')).some((a) => a.entityId === adminDoc2.id && (a.metadata as Json).op === 'remove'));
    ok('their view says so', !(await detail(sCsr)).documents.find((d) => d.id === adminDoc2.id)!.canRemove && (await detail(sCsr)).documents.find((d) => d.id === csrDoc.id)!.canRemove);
    ok('the agency admin can remove a colleague\'s file', (await removeTaskDocument(prisma, sAdmin, csrDoc.id, {}, store)).removed);
    ok('but not the Desk team\'s: 403', (await refusal(() => removeTaskDocument(prisma, sAdmin, shared.id, {}, store)))?.status === 403);
    ok('a VA can\'t remove someone else\'s: 403', (await refusal(() => removeTaskDocument(prisma, sVa, internal.id, {}, store)))?.status === 403);
    const removedKey = (await prisma.taskDocument.findUniqueOrThrow({ where: { id: vaDoc.id } })).storageKey;
    ok('a VA removes their own', (await removeTaskDocument(prisma, sVa, vaDoc.id, {}, store)).removed);
    const gone = await prisma.taskDocument.findUniqueOrThrow({ where: { id: vaDoc.id } });
    ok('the record stays, marked removed, and the stored copy goes', !!gone.deletedAt && gone.deletedById === va.id && !store.files.has(removedKey));
    const removedEvent = await prisma.taskEvent.findFirst({ where: { taskId: task.id, kind: 'DOCUMENT_REMOVED', actorId: va.id } });
    ok('in the history, as visible as the file was', removedEvent?.visibility === 'INTERNAL' && removedEvent.body === 'dec page.png');
    ok('logged', (await audits('document.removed', vaDoc.id)).length === 1);
    ok('hidden from everyone', !(await detail(sAm)).documents.some((d) => d.id === vaDoc.id));
    ok('and can\'t be opened', (await refusal(() => openTaskDocument(prisma, sAm, vaDoc.id, {}, {}, store)))?.status === 404);
    ok('removing it again: 404', (await refusal(() => removeTaskDocument(prisma, sAm, vaDoc.id, {}, store)))?.status === 404);
    // Two removals at once: both pass the check, only one may record it.
    const raceDoc = await prisma.taskDocument.create({ data: { taskId: task.id, agencyId: A.id, storageKey: `agencies/${A.id}/race`, fileName: 'race.pdf', fileSize: 10, contentType: 'application/pdf', sensitivity: 'GENERAL', visibility: 'INTERNAL', uploadedById: am.id } });
    const raced = new Proxy(prisma, { get: (t, p) => (p === '$transaction'
      ? async (...args: unknown[]) => { await prisma.taskDocument.update({ where: { id: raceDoc.id }, data: { deletedAt: new Date(), deletedById: am.id } }); return (prisma.$transaction as (...a: unknown[]) => unknown)(...args); }
      : Reflect.get(t, p)) }) as PrismaClient;
    ok('removed by someone else meanwhile: 404', (await refusal(() => removeTaskDocument(raced, sAm, raceDoc.id, {}, store)))?.status === 404);
    ok('and nothing recorded twice', await prisma.taskEvent.count({ where: { taskId: task.id, kind: 'DOCUMENT_REMOVED', body: 'race.pdf' } }) === 0 && (await audits('document.removed', raceDoc.id)).length === 0);
    const closedDoc = await prisma.taskDocument.create({ data: { taskId: closed.id, agencyId: A.id, storageKey: `agencies/${A.id}/x`, fileName: 'final.pdf', fileSize: 10, contentType: 'application/pdf', sensitivity: 'GENERAL', visibility: 'AGENCY', uploadedById: admin.id } });
    const closedRefusal = await refusal(() => removeTaskDocument(prisma, sAdmin, closedDoc.id, {}, store));
    ok('on a closed request, not even the uploader: 403', closedRefusal?.status === 403 && /closed/.test(closedRefusal.message));
    ok('an Account Manager still can', (await removeTaskDocument(prisma, sAm, closedDoc.id, {}, store)).removed);
    ok('an Operations Manager can remove any', (await removeTaskDocument(prisma, sOps, adminDoc2.id, {}, store)).removed);

    console.log('Routes');
    const [tAdmin, tAdminB] = await Promise.all([admin, adminB].map((u) => createSession(u.id)));
    const form = (name: string, b: Uint8Array, sensitivity = 'POLICY') => { const f = new FormData(); f.append('file', new File([b], name)); f.append('sensitivity', sensitivity); return f; };
    const up = async (token: string, id: string, body: FormData, headers: Record<string, string> = {}) => {
      const r = await uploadRoute(req(`/api/desk/tasks/${id}/documents`, token, { method: 'POST', body, headers }), ctx(id));
      return { status: r.status, json: await r.json().catch(() => null) as Json };
    };
    const big = await up(tAdmin, task.id, form('a.pdf', PDF), { 'content-length': String(MAX_DOCUMENT_BYTES + 200 * 1024) });
    ok('too large, told before the body is read: 400', big.status === 400 && big.json.code === 'TOO_LARGE');
    ok('another agency\'s request: 404, before the size', (await up(tAdminB, task.id, form('a.pdf', PDF), { 'content-length': String(MAX_DOCUMENT_BYTES * 2) })).status === 404);
    ok('no file: 400', (await up(tAdmin, task.id, new FormData())).status === 400);
    ok('a bad file: 400 with the reason', (await up(tAdmin, task.id, form('a.pdf', EXE))).json.code === 'CONTENT');
    const real = await up(tAdmin, task.id, form('route.pdf', PDF));
    if (isStorageConfigured()) {
      ok('a real upload to R2: 201', real.status === 201);
    } else {
      ok('this machine has no R2: 503, with the reason', real.status === 503 && real.json.code === 'STORAGE_UNAVAILABLE');
    }
    const opened = await openRoute(req(`/api/desk/documents/${mine.id}?view=1`, tAdmin), ctx(mine.id));
    ok(isStorageConfigured() ? 'open: a redirect to the file, not cached' : 'open without R2: 503', isStorageConfigured()
      ? opened.status === 302 && opened.headers.get('cache-control') === 'no-store' && opened.headers.get('referrer-policy') === 'no-referrer'
      : opened.status === 503);
    // Signing a link needs no network, so the redirect itself is checked with stand-in R2 settings.
    const envBefore = { ...process.env };
    if (!isStorageConfigured()) Object.assign(process.env, { R2_ACCOUNT_ID: 'testaccount', R2_ACCESS_KEY_ID: 'testkey', R2_SECRET_ACCESS_KEY: 'testsecret', R2_BUCKET: process.env.R2_BUCKET || 'testbucket' });
    let signed: Response;
    try { signed = await openRoute(req(`/api/desk/documents/${mine.id}?view=1`, tAdmin), ctx(mine.id)); } finally {
      for (const k of ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET']) { if (envBefore[k] === undefined) delete process.env[k]; else process.env[k] = envBefore[k]; }
    }
    const where = signed.headers.get('location') ?? '';
    ok('open: a redirect to a short-lived signed link', signed.status === 302 && where.includes('X-Amz-Signature') && where.includes('X-Amz-Expires=300'), `${signed.status} ${where.slice(0, 80)}`);
    ok('shown inline, under its own name and type', where.includes('response-content-disposition=inline') && where.includes('response-content-type=application%2Fpdf'));
    ok('the link isn\'t cached', signed.headers.get('cache-control') === 'no-store');
    ok('and isn\'t passed on as a referrer', signed.headers.get('referrer-policy') === 'no-referrer');
    ok('open, another agency: 404', (await openRoute(req(`/api/desk/documents/${mine.id}`, tAdminB), ctx(mine.id))).status === 404);
    const del = await removeRoute(req(`/api/desk/documents/${mine.id}`, tAdmin, { method: 'DELETE' }), ctx(mine.id));
    ok('remove through the route', del.status === 200 && !!(await prisma.taskDocument.findUniqueOrThrow({ where: { id: mine.id } })).deletedAt);

    console.log('The screens');
    const screen = read('app/components/desk/requests/RequestForm.tsx');
    ok('the form offers the allowed files only', screen.includes('accept={DOCUMENT_ACCEPT}'));
    ok('each file needs a category, with none chosen to start', screen.includes("sensitivity: '' as const") && screen.includes('Choose a category…') && screen.includes('Choose what kind of document'));
    ok('files go after the request exists, one at a time', screen.indexOf("api<Sent>('/api/desk/tasks'") < screen.indexOf('await attach(created.id, a)'));
    ok('and failures are listed, with the request still sent', screen.includes('The request was sent, but these files weren'));
    ok('the account page opens files through the checked route', read('app/components/desk/accounts/AccountDetail.tsx').includes('/api/desk/documents/${d.id}?view=1'));
    ok('a link to a file is never handed to the page', !read('app/api/desk/documents/[id]/route.ts').includes('NextResponse.json(url'));
  } catch (err) {
    console.error(err);
    fail++;
  } finally {
    try {
      await wipe();
      const left = await prisma.user.count({ where: { email: { startsWith: TAG } } }) + await prisma.agency.count({ where: { name: { startsWith: TAG } } }) + await prisma.pod.count({ where: { code: { startsWith: TAG } } });
      ok('nothing left behind', left === 0);
    } catch (err) {
      console.error('cleanup failed', err);
      fail++;
    }
    console.log(`\n${pass} passed, ${fail} failed`);
    await prisma.$disconnect();
    process.exit(fail ? 1 : 0);
  }
})();
