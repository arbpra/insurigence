/**
 * The Desk, Module 44: the permission test suite.
 *
 * One world, every route. Two Desk agencies and one without The Desk, three
 * pods, and a person for every kind of access (Operations Manager, each
 * agency's Owner / Admin, a whole-book CSR, an assigned-only Producer, an
 * Account Manager for each agency, VAs with and without a sensitive-document
 * grant, a VA named on a restricted task, VAs in pods no agency authorised).
 * Every record that only some people may see carries a marker, and:
 *
 *  - every Desk route refuses a request with no session, and every route but
 *    the Operations pages refuses an agency without The Desk;
 *  - every Operations route refuses everyone else, and logs each refusal;
 *  - every page of data each person can ask for (every GET route, with every
 *    record's id) is searched for the markers they must never see, with a
 *    check that each marker they should see does appear, so the search can't
 *    pass by finding nothing;
 *  - a record out of someone's reach answers exactly like one that doesn't
 *    exist, whether read or changed, and nothing changes;
 *  - documents: internal ones never to the agency, Financial / Personal only
 *    with a grant, removed ones to nobody, each refusal logged with its kind;
 *  - restricted tasks, internal notes, losing access mid-session.
 *
 * Client answers: Q3 (agency roles and book access), Q4 (need-to-know: agency
 * authorisation, pod, individual permissions, task requirements; everything
 * logged), Q5 (targets internal). Against the shared database, temporary
 * records only, removed at the end. Emails switched off.
 * Run with:  npx tsx script/verify-desk-permissions.ts
 */
import 'dotenv/config';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative, sep } from 'path';
import { NextRequest } from 'next/server';
import type { UserRole } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { createSession } from '../lib/auth';

process.env.DESK_EMAIL_NOTIFICATIONS = 'off';
process.env.RESEND_API_KEY = '';

let pass = 0, fail = 0;
const started = Date.now();
const section = (name: string) => console.log(`${name}  (${Math.round((Date.now() - started) / 1000)} s)`);
const ok = (n: string, c: boolean, detail?: unknown) => {
  c ? pass++ : fail++;
  console.log(`  ${c ? '✓' : '✗'} ${n}${!c && detail !== undefined ? `  ${JSON.stringify(detail).slice(0, 400)}` : ''}`);
  if (!c && process.env.FAIL_FAST) throw new Error(`stopped at: ${n}`);
};

const TAG = `m44test${Date.now()}`;
const cleanup = { agencyIds: [] as string[], userIds: [] as string[], podIds: [] as string[] };
type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any

async function wipe() {
  const agencyId = { in: cleanup.agencyIds };
  await prisma.deskNotification.deleteMany({ where: { OR: [{ agencyId }, { recipientId: { in: cleanup.userIds } }] } });
  await prisma.deskMessage.deleteMany({ where: { agencyId } });
  await prisma.deskMessageRead.deleteMany({ where: { OR: [{ agencyId }, { userId: { in: cleanup.userIds } }] } });
  await prisma.taskDocument.deleteMany({ where: { agencyId } });
  await prisma.taskEvent.deleteMany({ where: { agencyId } });
  await prisma.task.updateMany({ where: { agencyId }, data: { parentTaskId: null } });
  await prisma.task.deleteMany({ where: { agencyId } });
  await prisma.policy.deleteMany({ where: { agencyId } });
  await prisma.insuredAssignment.deleteMany({ where: { agencyId } });
  await prisma.insuredAccount.deleteMany({ where: { agencyId } });
  await prisma.agencyPodAccess.deleteMany({ where: { OR: [{ agencyId }, { podId: { in: cleanup.podIds } }] } });
  await prisma.podMember.deleteMany({ where: { podId: { in: cleanup.podIds } } });
  await prisma.pod.deleteMany({ where: { id: { in: cleanup.podIds } } });
  await prisma.agencyDeskAssignment.deleteMany({ where: { agencyId } });
  await prisma.deskStaffPermission.deleteMany({ where: { userId: { in: cleanup.userIds } } });
  await prisma.deskAuditLog.deleteMany({ where: { OR: [{ agencyId }, { actorId: { in: cleanup.userIds } }] } });
  await prisma.session.deleteMany({ where: { userId: { in: cleanup.userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: cleanup.userIds } } });
  await prisma.agency.deleteMany({ where: { id: agencyId } });
}

// ── The routes, found on disk so a new one can't be left out ──

const API = join('app', 'api', 'desk');
function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? routeFiles(p) : f === 'route.ts' ? [p] : [];
  });
}
const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;
type Method = typeof METHODS[number];
type Handler = (req: NextRequest, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;
interface Route { file: string; path: string; params: string[]; admin: boolean; cron: boolean; handlers: Partial<Record<Method, Handler>> }

async function loadRoutes(): Promise<Route[]> {
  const out: Route[] = [];
  for (const file of routeFiles(API).sort()) {
    const rel = relative(API, file).split(sep).slice(0, -1);
    const mod = await import(`../${file.split(sep).join('/')}`);
    const src = readFileSync(file, 'utf8');
    out.push({
      file: file.split(sep).join('/'),
      path: `/api/desk/${rel.join('/')}`,
      params: rel.filter((s) => s.startsWith('[')).map((s) => s.slice(1, -1)),
      admin: src.includes('deskAdminRequest'),
      cron: rel[0] === 'cron',
      handlers: Object.fromEntries(METHODS.filter((m) => typeof mod[m] === 'function').map((m) => [m, mod[m]])),
    });
  }
  return out;
}

/** Runs fn over items, a few at a time (the database is remote; one at a time is slow). */
async function pool<T, U>(items: T[], fn: (item: T) => Promise<U>, size = 12): Promise<U[]> {
  const out: U[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i]); }
  }));
  return out;
}

const fakeId = () => [...Array(24)].map(() => '0123456789abcdef'[Math.floor(Math.random() * 16)]).join('');

async function call(route: Route, method: Method, token: string | null, params: Record<string, string> = {}, body?: unknown, query = '') {
  const full = Object.fromEntries(route.params.map((p) => [p, params[p] ?? fakeId()]));
  let url = route.path;
  for (const p of route.params) url = url.replace(`[${p}]`, full[p]);
  const headers: Record<string, string> = { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.44' };
  if (token) headers.cookie = `session_token=${token}`;
  const req = new NextRequest(`http://local.test${url}${query ? `?${query}` : ''}`, {
    method, headers, ...(method === 'GET' || method === 'DELETE' || body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
  });
  let res: Response;
  try {
    res = await route.handlers[method]!(req, { params: Promise.resolve(full) });
  } catch (err) {
    // A route that throws would be a 500 in the app: reported as one, with the reason.
    return { status: 599, text: `THREW ${String((err as Error)?.message ?? err).slice(0, 300)}`, headers: new Headers() };
  }
  const text = res.status >= 300 && res.status < 400 ? `REDIRECT ${res.headers.get('location') ?? ''}` : await res.text();
  return { status: res.status, text, headers: res.headers };
}

(async () => {
  try {
    const routes = await loadRoutes();
    const R = (path: string) => { const r = routes.find((x) => x.path === path); if (!r) throw new Error(`no route ${path}`); return r; };

    section('The routes');
    ok('every Desk route found on disk (56)', routes.length === 56, routes.length);
    ok('each one goes through a Desk guard, or is the scheduler\'s door', routes.every((r) => r.cron || /desk(User|Admin)Request\(prisma, request/.test(readFileSync(r.file, 'utf8'))),
      routes.filter((r) => !r.cron && !/desk(User|Admin)Request\(prisma, request/.test(readFileSync(r.file, 'utf8'))).map((r) => r.path));
    ok('…and the guard comes before any database work in every handler', routes.filter((r) => !r.cron).every((r) => {
      const src = readFileSync(r.file, 'utf8');
      return src.split(/export (?:async function|const) (?:GET|POST|PUT|PATCH|DELETE)/).slice(1).every((h) => {
        const guard = h.search(/desk(User|Admin)Request\(/);
        const db = h.search(/\bprisma\.[a-zA-Z]+\.|await [a-z][A-Za-z]+\(prisma/);
        return guard >= 0 && (db < 0 || guard < db || /desk(User|Admin)Request\(prisma/.test(h.slice(db, db + 40)));
      });
    }));
    ok('the Operations routes are the admin, audit, usage and workload ones', routes.filter((r) => r.admin).map((r) => r.path.split('/')[3]).every((s) => ['admin', 'audit', 'usage', 'workload'].includes(s))
      && routes.filter((r) => ['admin', 'audit', 'usage', 'workload'].includes(r.path.split('/')[3])).every((r) => r.admin));

    // ── The world ──
    const mark = (k: string) => `${TAG}K${k}Q`;
    const M = {
      intNote: mark('intnote'), sharedNote: mark('sharednote'), carrierReason: mark('carrierwhy'), needsReason: mark('needswhy'),
      intDoc: mark('intdoc'), sharedDoc: mark('shareddoc'), finDoc: mark('findoc'), persDoc: mark('persdoc'), goneDoc: mark('gonedoc'),
      subtask: mark('subtask'), pod: mark('podname'), vaName: mark('vaname'), restrictReason: mark('restrictwhy'), escReason: mark('escwhy'),
      a1: mark('accone'), a2: mark('acctwo'), a3: mark('accthree'), ta1: mark('taskone'), ta2: mark('tasktwo'), restricted: mark('restricted'),
      doneByVa1: mark('donebyvaone'), aMsg: mark('amsg'), policyA2: mark('polacctwo'),
      b: mark('bacc'), tb: mark('btask'), bNote: mark('bnote'), bMsg: mark('bmsg'), bDoc: mark('bdoc'),
      off: mark('offacc'),
    };
    const SLA = '2031-04-05T13:37:00.000Z';
    const INTERNAL = [M.intNote, M.carrierReason, M.intDoc, M.finDoc, M.subtask, M.pod, M.vaName, M.restrictReason, M.escReason, M.goneDoc, SLA.slice(0, 16)];
    const B_ALL = [M.b, M.tb, M.bNote, M.bMsg, M.bDoc];
    const A_ALL = [M.intNote, M.sharedNote, M.carrierReason, M.needsReason, M.intDoc, M.sharedDoc, M.finDoc, M.persDoc, M.subtask, M.restrictReason, M.escReason,
      M.a1, M.a2, M.a3, M.ta1, M.ta2, M.restricted, M.doneByVa1, M.aMsg, M.policyA2, M.vaName, SLA.slice(0, 16)];

    const mkAgency = async (n: string, deskEnabled = true) => { const a = await prisma.agency.create({ data: { name: `${TAG} ${n}`, deskEnabled } }); cleanup.agencyIds.push(a.id); return a; };
    const mkUser = async (n: string, role: UserRole, agencyId: string | null = null, extra: object = {}) => {
      const u = await prisma.user.create({ data: { email: `${TAG}-${n}@example.test`, role, agencyId, firstName: `${TAG}${n}`, lastName: 'Person', mustChangePassword: false, ...extra } });
      cleanup.userIds.push(u.id); return u;
    };
    const A = await mkAgency('Alpha'), B = await mkAgency('Beta'), Off = await mkAgency('Off', false);
    const ops = await mkUser('ops', 'DESK_ADMIN');
    const adminA = await mkUser('admina', 'ADMIN', A.id);
    const csrA = await mkUser('csra', 'CSR', A.id, { bookAccess: 'ALL' });
    const producer = await mkUser('producer', 'AGENT', A.id, { bookAccess: 'ASSIGNED' });
    const adminB = await mkUser('adminb', 'ADMIN', B.id);
    const adminOff = await mkUser('adminoff', 'ADMIN', Off.id);
    const amA = await mkUser('ama', 'ACCOUNT_MANAGER');
    const amB = await mkUser('amb', 'ACCOUNT_MANAGER');
    const va1 = await mkUser('vaone', 'DESK_VA', null, { lastName: M.vaName });
    const va2 = await mkUser('vatwo', 'DESK_VA');
    const vaB = await mkUser('vab', 'DESK_VA');
    const vaNone = await mkUser('vanone', 'DESK_VA');
    const vaQuiet = await mkUser('vaquiet', 'DESK_VA');
    const podA = await prisma.pod.create({ data: { code: `${TAG}a`, name: M.pod } });
    const podB = await prisma.pod.create({ data: { code: `${TAG}b`, name: `${TAG} pod b` } });
    const podN = await prisma.pod.create({ data: { code: `${TAG}n`, name: `${TAG} pod nobody` } });
    cleanup.podIds.push(podA.id, podB.id, podN.id);
    await prisma.podMember.createMany({ data: [
      { podId: podA.id, userId: va1.id }, { podId: podA.id, userId: va2.id }, { podId: podB.id, userId: vaB.id }, { podId: podN.id, userId: vaNone.id }, { podId: podA.id, userId: vaQuiet.id },
    ] });
    await prisma.agencyPodAccess.createMany({ data: [{ agencyId: A.id, podId: podA.id }, { agencyId: B.id, podId: podB.id }] });
    // vaQuiet is in pod A but A has stopped authorising the pod for them: a whole-pod row is the only grant, so it is removed later.
    await prisma.deskStaffPermission.create({ data: { userId: va1.id, allowedSensitivities: ['FINANCIAL'] } });
    await prisma.agencyDeskAssignment.createMany({ data: [{ agencyId: A.id, primaryAmId: amA.id }, { agencyId: B.id, primaryAmId: amB.id }] });

    const account = (agencyId: string, name: string) => prisma.insuredAccount.create({ data: { agencyId, name, nameKey: name.toLowerCase() } });
    const a1 = await account(A.id, M.a1), a2 = await account(A.id, M.a2), a3 = await account(A.id, M.a3);
    const bAcc = await account(B.id, M.b), offAcc = await account(Off.id, M.off);
    await prisma.insuredAssignment.create({ data: { agencyId: A.id, insuredId: a1.id, userId: producer.id, role: 'PRODUCER' } });
    const p1 = await prisma.policy.create({ data: { agencyId: A.id, insuredId: a1.id, policyNumber: `${TAG}-P1` } });
    const p2 = await prisma.policy.create({ data: { agencyId: A.id, insuredId: a2.id, policyNumber: M.policyA2 } });
    const p3 = await prisma.policy.create({ data: { agencyId: A.id, insuredId: a3.id, policyNumber: `${TAG}-P3` } });
    const pB = await prisma.policy.create({ data: { agencyId: B.id, insuredId: bAcc.id, policyNumber: `${TAG}-PB` } });

    let n = 0;
    const base = 940_000_000 + (Date.now() % 50_000_000);
    const mkTask = (agencyId: string, title: string, data: object = {}) => {
      n += 1;
      return prisma.task.create({ data: { reference: base + n, agencyId, type: 'OTHER', title, podId: agencyId === A.id ? podA.id : podB.id, amId: agencyId === A.id ? amA.id : amB.id, createdById: agencyId === A.id ? adminA.id : adminB.id, restrictedToUserIds: [], ...data } });
    };
    const ta1 = await mkTask(A.id, M.ta1, { insuredId: a1.id, policyId: p1.id, status: 'IN_PROGRESS', assigneeId: va1.id, dueAt: new Date(SLA), slaDueAt: new Date(SLA), escalated: true, escalatedAt: new Date(), escalationReason: M.escReason });
    const ta2 = await mkTask(A.id, M.ta2, { insuredId: a2.id, policyId: p2.id });
    const tr = await mkTask(A.id, M.restricted, { insuredId: a2.id, restrictedToUserIds: [va1.id], restrictionReason: M.restrictReason });
    const tDone = await mkTask(A.id, M.doneByVa1, { insuredId: a1.id, status: 'COMPLETED', completedAt: new Date(), assigneeId: va1.id });
    const sub = await mkTask(A.id, M.subtask, { parentTaskId: ta1.id, insuredId: a1.id });
    const tb = await mkTask(B.id, M.tb, { insuredId: bAcc.id, policyId: pB.id });
    const ev = (taskId: string, agencyId: string, visibility: 'INTERNAL' | 'AGENCY', body: string, extra: object = {}) =>
      prisma.taskEvent.create({ data: { taskId, agencyId, actorId: va1.id, kind: 'NOTE', visibility, body, ...extra } });
    await ev(ta1.id, A.id, 'INTERNAL', M.intNote);
    await ev(ta1.id, A.id, 'AGENCY', M.sharedNote);
    await ev(ta1.id, A.id, 'AGENCY', M.carrierReason, { kind: 'STATUS_CHANGED', fromStatus: 'IN_PROGRESS', toStatus: 'WAITING_ON_CARRIER' });
    await ev(ta1.id, A.id, 'AGENCY', M.needsReason, { kind: 'STATUS_CHANGED', fromStatus: 'WAITING_ON_CARRIER', toStatus: 'WAITING_ON_AGENCY' });
    await ev(tb.id, B.id, 'AGENCY', M.bNote, { actorId: adminB.id });
    const doc = (taskId: string, agencyId: string, fileName: string, visibility: 'INTERNAL' | 'AGENCY', sensitivity: 'GENERAL' | 'POLICY' | 'FINANCIAL' | 'PERSONAL', extra: object = {}) =>
      prisma.taskDocument.create({ data: { taskId, agencyId, storageKey: `desk/${TAG}/${fileName}`, fileName: `${fileName}.pdf`, fileSize: 1000, contentType: 'application/pdf', visibility, sensitivity, uploadedById: ops.id, ...extra } });
    const dInt = await doc(ta1.id, A.id, M.intDoc, 'INTERNAL', 'GENERAL');
    const dShared = await doc(ta1.id, A.id, M.sharedDoc, 'AGENCY', 'POLICY');
    const dFin = await doc(ta1.id, A.id, M.finDoc, 'INTERNAL', 'FINANCIAL');
    const dPers = await doc(ta1.id, A.id, M.persDoc, 'AGENCY', 'PERSONAL');
    const dGone = await doc(ta1.id, A.id, M.goneDoc, 'AGENCY', 'GENERAL', { deletedAt: new Date(), deletedById: ops.id });
    const dB = await doc(tb.id, B.id, M.bDoc, 'AGENCY', 'GENERAL');
    await prisma.deskMessage.createMany({ data: [
      { agencyId: A.id, authorId: amA.id, side: 'DESK', body: M.aMsg },
      { agencyId: B.id, authorId: amB.id, side: 'DESK', body: M.bMsg },
    ] });

    const people = { ops, adminA, csrA, producer, adminB, adminOff, amA, amB, va1, va2, vaB, vaNone, vaQuiet };
    type Who = keyof typeof people;
    const tok = Object.fromEntries(await Promise.all(Object.entries(people).map(async ([k, u]) => [k, await createSession(u.id)]))) as Record<Who, string>;
    const denials = () => prisma.deskAuditLog.count({ where: { action: 'access.denied', actorId: { in: cleanup.userIds } } });

    section('No session, an agency without The Desk');
    {
      const noSession: string[] = [], offAgency: string[] = [], badCookie: string[] = [];
      const handlers = routes.filter((x) => !x.cron).flatMap((r) => (Object.keys(r.handlers) as Method[]).map((m) => ({ r, m })));
      await pool(handlers, async ({ r, m }) => {
        const a = await call(r, m, null, {}, {});
        if (a.status !== 401) noSession.push(`${m} ${r.path} ${a.status}`);
        const c = await call(r, m, 'not-a-real-session', {}, {});
        if (c.status !== 401) badCookie.push(`${m} ${r.path} ${c.status}`);
        const o = await call(r, m, tok.adminOff, {}, {});
        if (o.status !== 403) offAgency.push(`${m} ${r.path} ${o.status}`);
      });
      ok('no session: 401 from every handler of every route', noSession.length === 0, noSession);
      ok('a session that doesn\'t exist: 401 everywhere', badCookie.length === 0, badCookie);
      ok('an agency without The Desk: 403 everywhere, its own account included', offAgency.length === 0, offAgency);
      ok('…and nothing was added to that agency', await prisma.task.count({ where: { agencyId: Off.id } }) === 0 && await prisma.insuredAccount.count({ where: { agencyId: Off.id } }) === 1);
    }

    section('The scheduler\'s door');
    {
      const cron = R('/api/desk/cron/alerts');
      const saved = process.env.DESK_CRON_SECRET;
      process.env.DESK_CRON_SECRET = `${TAG}-secret-value-long-enough-0123456789`;
      try {
        const viaSession = await call(cron, 'POST', tok.ops);
        ok('an Operations Manager\'s session is not the scheduler: 401', viaSession.status === 401);
        const r = new NextRequest('http://local.test/api/desk/cron/alerts', { method: 'POST', headers: { authorization: 'Bearer wrong' } });
        ok('a wrong secret: 401', (await cron.handlers.POST!(r, { params: Promise.resolve({}) })).status === 401);
      } finally {
        if (saved === undefined) delete process.env.DESK_CRON_SECRET; else process.env.DESK_CRON_SECRET = saved;
      }
    }

    section('Operations routes: Operations Managers and the Super Admin only');
    {
      const before = await denials();
      const wrong: string[] = [];
      const tries = (['adminA', 'csrA', 'producer', 'amA', 'va1'] as Who[]).flatMap((who) => routes.filter((x) => x.admin).flatMap((r) => (Object.keys(r.handlers) as Method[]).map((m) => ({ who, r, m }))));
      const calls = tries.length;
      await pool(tries, async ({ who, r, m }) => {
        const a = await call(r, m, tok[who], { id: A.id, agencyId: A.id }, { name: 'x' });
        if (a.status !== 403) wrong.push(`${who} ${m} ${r.path} ${a.status}`);
      });
      ok('agency admins, CSRs, producers, Account Managers and VAs: 403 from every handler', wrong.length === 0, wrong);
      ok('each refusal logged', (await denials()) - before === calls, { calls, logged: (await denials()) - before });
      const okGet = await call(R('/api/desk/usage'), 'GET', tok.ops);
      ok('…while the Operations Manager gets in', okGet.status === 200);
    }

    // ── What everyone can ask for, searched for what they mustn't see ──
    /** Each route with the ids of its own kind of record (and one that doesn't exist). */
    const idsFor = (path: string): string[] => {
      const kind = path.split('/')[3];
      if (kind === 'tasks') return [ta1.id, ta2.id, tr.id, tDone.id, sub.id, tb.id];
      if (kind === 'insureds') return [a1.id, a2.id, a3.id, bAcc.id, offAcc.id];
      if (kind === 'agencies' || kind === 'messages') return [A.id, B.id, Off.id];
      if (kind === 'team') return [adminA.id, producer.id, adminB.id, va1.id];
      return [fakeId()];
    };
    async function sweep(who: Who) {
      // Operations routes refuse all of these people (above); documents are opened, not read (below).
      const pages: { r: Route; p: Record<string, string>; query: string }[] = [];
      for (const r of routes.filter((x) => x.handlers.GET && !x.cron && !x.admin && !x.path.startsWith('/api/desk/documents'))) {
        for (const p of r.params.length === 0 ? [{}] : idsFor(r.path).map((v) => ({ [r.params[0]]: v }))) pages.push({ r, p, query: '' });
      }
      // The list routes again with an agency asked for by name.
      for (const path of ['/api/desk/tasks', '/api/desk/insureds', '/api/desk/queue', '/api/desk/tracker', '/api/desk/turnaround', '/api/desk/messages']) {
        for (const ag of [A.id, B.id]) pages.push({ r: R(path), p: {}, query: `agencyId=${ag}` }, { r: R(path), p: {}, query: `agencyId=${ag}&q=${encodeURIComponent(TAG)}` });
      }
      return pool(pages, async ({ r, p, query }) => {
        const a = await call(r, 'GET', tok[who], p, undefined, query);
        return { where: `${r.path} ${JSON.stringify(p)}${query ? `?${query}` : ''}`, text: a.text, status: a.status };
      });
    }
    const expectations: { who: Who; label: string; never: string[]; must: string[] }[] = [
      { who: 'adminA', label: 'agency Owner / Admin', never: [...INTERNAL, ...B_ALL], must: [M.a1, M.a2, M.a3, M.ta1, M.ta2, M.restricted, M.sharedNote, M.needsReason, M.sharedDoc, M.persDoc, M.aMsg] },
      { who: 'csrA', label: 'CSR with the whole book', never: [...INTERNAL, ...B_ALL], must: [M.a2, M.ta2, M.sharedNote, M.sharedDoc] },
      { who: 'producer', label: 'Producer on their assigned accounts', never: [...INTERNAL, ...B_ALL, M.a2, M.a3, M.ta2, M.restricted, M.policyA2, M.aMsg], must: [M.a1, M.ta1, M.sharedNote, M.sharedDoc] },
      { who: 'adminB', label: 'the other agency', never: A_ALL, must: [M.b, M.tb, M.bNote, M.bMsg] },
      { who: 'amA', label: 'Account Manager', never: B_ALL, must: [M.intNote, M.subtask, M.pod, M.restricted, M.restrictReason, M.escReason, M.finDoc, M.a3, M.aMsg] },
      { who: 'amB', label: 'the other agency\'s Account Manager', never: A_ALL, must: [M.tb] },
      { who: 'va1', label: 'VA with a Financial grant, named on the restricted task', never: [...B_ALL, M.a3, M.aMsg, M.persDoc, M.goneDoc], must: [M.ta1, M.intNote, M.finDoc, M.restricted, M.doneByVa1] },
      { who: 'va2', label: 'VA in the pod, no grant, not named', never: [...B_ALL, M.a3, M.aMsg, M.finDoc, M.persDoc, M.restricted, M.restrictReason, M.doneByVa1, M.goneDoc], must: [M.ta1, M.intNote, M.intDoc] },
      { who: 'vaB', label: 'VA working only the other agency', never: A_ALL, must: [M.tb] },
      { who: 'vaNone', label: 'VA in a pod no agency authorised', never: [...A_ALL, ...B_ALL], must: [] },
    ];
    const swept = new Map<Who, Awaited<ReturnType<typeof sweep>>>();
    section('Every page each person can ask for');
    for (const e of expectations) {
      const seen = await sweep(e.who);
      swept.set(e.who, seen);
      const leaks = seen.flatMap((s) => e.never.filter((m) => s.text.includes(m)).map((m) => `${s.where}: ${m.replace(TAG, '')}`));
      const missing = e.must.filter((m) => !seen.some((s) => s.text.includes(m))).map((m) => m.replace(TAG, ''));
      ok(`${e.label}: nothing they mustn't see, on ${seen.length} pages`, leaks.length === 0, leaks.slice(0, 8));
      ok(`${e.label}: …and what they should see is there`, missing.length === 0, missing);
      const errors = seen.filter((s) => s.status >= 500).map((s) => `${s.where} ${s.status}`);
      ok(`${e.label}: no page failed`, errors.length === 0, errors);
    }
    {
      const adminPages = swept.get('adminA')!;
      ok('the agency is shown no target or due time (Q5), not even in another form', !adminPages.some((s) => /"(slaDueAt|dueAt|slaTarget|alertDueAt|alertLevel)"/.test(s.text) && s.where.includes(ta1.id)));
      ok('the agency sees the reason when something is needed from them, not the team\'s own reasons', adminPages.some((s) => s.text.includes(M.needsReason)) && !adminPages.some((s) => s.text.includes(M.carrierReason)));
      ok('the agency is never told who on the Desk did something', !adminPages.some((s) => s.text.includes(va1.email) || s.text.includes(`${TAG}vaone`)));
      ok('…or which pod has the work', !adminPages.some((s) => s.text.includes(M.pod) || s.text.includes(podA.id)));
      // Not even a count: "1 open subtask" tells the agency the team has work of its own on the request.
      const ta1Pages = [...adminPages, ...swept.get('producer')!].filter((s) => s.where.includes(ta1.id));
      ok('…or that the team has subtasks on the request, not even how many', ta1Pages.length > 0 && !ta1Pages.some((s) => /"(subtasks|openSubtasks|hiddenSubtasks|parentRequest)"/.test(s.text)), ta1Pages.length);
    }

    // ── Out of reach answers like nothing there, and changes nothing ──
    section('Out of reach is the same as not there, and changes nothing');
    const snapshot = async () => JSON.stringify(await Promise.all([
      prisma.task.findMany({ where: { agencyId: { in: [A.id, B.id] } }, orderBy: { id: 'asc' } }),
      prisma.taskEvent.count({ where: { agencyId: { in: [A.id, B.id] } } }),
      prisma.taskDocument.findMany({ where: { agencyId: { in: [A.id, B.id] } }, orderBy: { id: 'asc' } }),
      prisma.insuredAccount.findMany({ where: { agencyId: { in: [A.id, B.id] } }, orderBy: { id: 'asc' } }),
      prisma.policy.findMany({ where: { agencyId: { in: [A.id, B.id] } }, orderBy: { id: 'asc' } }),
      prisma.insuredAssignment.findMany({ where: { agencyId: { in: [A.id, B.id] } }, orderBy: { id: 'asc' } }),
      prisma.deskMessage.count({ where: { agencyId: { in: [A.id, B.id] } } }),
      prisma.user.findMany({ where: { id: { in: cleanup.userIds } }, select: { id: true, role: true, bookAccess: true, isActive: true, agencyId: true }, orderBy: { id: 'asc' } }),
    ]));
    const attacks: { path: string; method: Method; param: string; body?: unknown }[] = [
      { path: '/api/desk/tasks/[id]', method: 'GET', param: 'id' },
      { path: '/api/desk/tasks/[id]/status', method: 'POST', param: 'id', body: { status: 'CANCELLED', reason: 'x' } },
      { path: '/api/desk/tasks/[id]/assign', method: 'POST', param: 'id', body: { assigneeId: va1.id } },
      { path: '/api/desk/tasks/[id]/notes', method: 'POST', param: 'id', body: { body: 'a note', visibility: 'AGENCY' } },
      { path: '/api/desk/tasks/[id]/escalation', method: 'POST', param: 'id', body: { escalated: true, reason: 'x' } },
      { path: '/api/desk/tasks/[id]/pod', method: 'POST', param: 'id', body: { podId: podA.id } },
      { path: '/api/desk/tasks/[id]/review', method: 'POST', param: 'id', body: { complexity: 'COMPLEX' } },
      { path: '/api/desk/tasks/[id]/subtasks', method: 'POST', param: 'id', body: { type: 'OTHER', title: 'x' } },
      { path: '/api/desk/tasks/[id]/assignees', method: 'GET', param: 'id' },
      { path: '/api/desk/tasks/[id]/documents', method: 'POST', param: 'id', body: {} },
      { path: '/api/desk/insureds/[id]', method: 'GET', param: 'insured' },
      { path: '/api/desk/insureds/[id]', method: 'PATCH', param: 'insured', body: { name: 'taken over' } },
      { path: '/api/desk/insureds/[id]/overview', method: 'GET', param: 'insured' },
      { path: '/api/desk/insureds/[id]/policies', method: 'POST', param: 'insured', body: { policyNumber: 'x' } },
      { path: '/api/desk/insureds/[id]/assignments', method: 'GET', param: 'insured' },
      { path: '/api/desk/insureds/[id]/assignments', method: 'PUT', param: 'insured', body: { userId: producer.id, role: 'PRODUCER' } },
      { path: '/api/desk/insureds/[id]/assignments', method: 'DELETE', param: 'insured' },
      { path: '/api/desk/policies/[id]', method: 'PATCH', param: 'policy', body: { carrierName: 'x' } },
      { path: '/api/desk/policies/[id]', method: 'DELETE', param: 'policy' },
      { path: '/api/desk/documents/[id]', method: 'GET', param: 'document' },
      { path: '/api/desk/documents/[id]', method: 'DELETE', param: 'document' },
    ];
    const targets: { who: Who; label: string; task: string; insured: string; policy: string; document: string }[] = [
      { who: 'adminA', label: 'agency admin, the other agency\'s records', task: tb.id, insured: bAcc.id, policy: pB.id, document: dB.id },
      { who: 'amA', label: 'Account Manager, an agency they don\'t cover', task: tb.id, insured: bAcc.id, policy: pB.id, document: dB.id },
      { who: 'producer', label: 'Producer, an account they aren\'t assigned', task: ta2.id, insured: a2.id, policy: p2.id, document: dB.id },
      { who: 'va2', label: 'VA, a task restricted to someone else', task: tr.id, insured: a3.id, policy: p3.id, document: dFin.id },
      { who: 'vaB', label: 'VA, an agency that hasn\'t authorised their pod', task: ta1.id, insured: a1.id, policy: p1.id, document: dShared.id },
      { who: 'vaNone', label: 'VA in a pod no agency authorised', task: ta1.id, insured: a1.id, policy: p1.id, document: dShared.id },
    ];
    for (const t of targets) {
      const before = await snapshot();
      const denied0 = await denials();
      const differ: string[] = [];
      await pool(attacks, async (a) => {
        const id = a.param === 'id' ? t.task : t[a.param as 'insured' | 'policy' | 'document'];
        const real = await call(R(a.path), a.method, tok[t.who], { id }, a.body);
        const none = await call(R(a.path), a.method, tok[t.who], { id: fakeId() }, a.body);
        if (real.status !== none.status || real.text !== none.text) differ.push(`${a.method} ${a.path}: ${real.status} ${real.text.slice(0, 60)} vs ${none.status} ${none.text.slice(0, 60)}`);
      });
      ok(`${t.label}: every read and change answers as if it weren't there`, differ.length === 0, differ);
      ok(`${t.label}: nothing changed`, (await snapshot()) === before);
      ok(`${t.label}: the attempts are in the audit log`, (await denials()) - denied0 >= 8, (await denials()) - denied0);
    }
    {
      // People and agencies by id, and the other agency's conversation.
      const differ: string[] = [];
      const pairs: [Who, string, string, Method, unknown?][] = [
        ['adminA', '/api/desk/team/[userId]', adminB.id, 'GET'], ['adminA', '/api/desk/team/[userId]', adminB.id, 'PATCH', { role: 'AGENT' }],
        ['adminA', '/api/desk/team/[userId]/assignments', adminB.id, 'POST', { insuredIds: [bAcc.id], role: 'PRODUCER' }],
        ['adminA', '/api/desk/team/[userId]', va1.id, 'GET'],
        ['adminA', '/api/desk/messages/[agencyId]', B.id, 'GET'], ['adminA', '/api/desk/messages/[agencyId]', B.id, 'POST', { body: 'hi' }],
        ['amA', '/api/desk/messages/[agencyId]', B.id, 'GET'], ['amA', '/api/desk/messages/[agencyId]', B.id, 'POST', { body: 'hi' }],
        ['amA', '/api/desk/agencies/[id]', B.id, 'GET'], ['adminA', '/api/desk/agencies/[id]', B.id, 'GET'],
        ['va1', '/api/desk/messages/[agencyId]', A.id, 'GET'], ['va1', '/api/desk/agencies/[id]', B.id, 'GET'],
      ];
      const before = await snapshot();
      for (const [who, path, id, m, body] of pairs) {
        const r = R(path);
        const real = await call(r, m, tok[who], { [r.params[0]]: id }, body);
        const none = await call(r, m, tok[who], { [r.params[0]]: fakeId() }, body);
        if (real.status !== none.status || real.text !== none.text) differ.push(`${who} ${m} ${path}: ${real.status} vs ${none.status}`);
      }
      ok('people, agencies and conversations out of reach answer as if they weren\'t there', differ.length === 0, differ);
      ok('…and nothing changed', (await snapshot()) === before);
    }

    section('Producer scope (Q3)');
    {
      const list = JSON.parse((await call(R('/api/desk/insureds'), 'GET', tok.producer)).text) as Json;
      const names = JSON.stringify(list);
      ok('the account list is their assigned accounts only', names.includes(M.a1) && !names.includes(M.a2) && !names.includes(M.a3));
      const tasks = (await call(R('/api/desk/tasks'), 'GET', tok.producer)).text;
      ok('requests: on their accounts, not a colleague\'s', tasks.includes(M.ta1) && !tasks.includes(M.ta2) && !tasks.includes(M.restricted));
      // Searching by an account's name: theirs is found, a colleague's isn't, and a request with no account doesn't break it.
      const noAccount = await prisma.task.create({ data: { reference: base + 999, agencyId: A.id, type: 'OTHER', title: `${TAG} no account`, podId: podA.id, createdById: adminA.id, restrictedToUserIds: [] } });
      const search = async (q: string) => call(R('/api/desk/tasks'), 'GET', tok.producer, {}, undefined, `q=${encodeURIComponent(q)}`);
      const byMine = await search(M.a1), byOther = await search(M.a2), byNothing = await search(`${TAG}nothing`);
      ok('search by their account\'s name finds its requests', byMine.status === 200 && byMine.text.includes(M.ta1) && !byMine.text.includes(M.ta2), byMine.status);
      ok('…by a colleague\'s account\'s name finds nothing', byOther.status === 200 && !byOther.text.includes(M.ta2) && !byOther.text.includes(M.restricted), byOther.status);
      ok('…and a search matching nothing is an empty list, not an error', byNothing.status === 200 && (JSON.parse(byNothing.text) as Json).total === 0, byNothing.status);
      await prisma.task.delete({ where: { id: noAccount.id } });
      const before = await snapshot();
      const give = await call(R('/api/desk/insureds/[id]/assignments'), 'PUT', tok.producer, { id: a1.id }, { userId: csrA.id, role: 'SERVICE' });
      ok('can\'t give someone access, even on their own account', give.status === 403 || give.status === 404, give.status);
      const book = await call(R('/api/desk/team/[userId]'), 'PATCH', tok.producer, { userId: producer.id }, { bookAccess: 'ALL' });
      ok('can\'t widen their own book', book.status === 403 || book.status === 404, book.status);
      const imp = await call(R('/api/desk/imports'), 'POST', tok.producer, {}, {});
      ok('can\'t import a book', imp.status === 403 || imp.status === 404, imp.status);
      const conv = await call(R('/api/desk/messages/[agencyId]'), 'GET', tok.producer, { agencyId: A.id });
      ok('isn\'t in the agency\'s conversation with the Desk', conv.status === 403 || conv.status === 404, conv.status);
      ok('nothing changed', (await snapshot()) === before);
      const filed = await call(R('/api/desk/tasks'), 'POST', tok.producer, {}, { type: 'OTHER', title: `${TAG} filed`, insuredId: a2.id });
      ok('can\'t file a request on an account they aren\'t assigned', filed.status === 404);
      const policy = await call(R('/api/desk/insureds/[id]/policies'), 'POST', tok.producer, { id: a2.id }, { policyNumber: `${TAG}-sneak` });
      ok('…or add a policy to one', policy.status === 404 && await prisma.policy.count({ where: { policyNumber: `${TAG}-sneak` } }) === 0);
      await prisma.user.update({ where: { id: producer.id }, data: { bookAccess: 'ALL' } });
      const wider = (await call(R('/api/desk/insureds'), 'GET', tok.producer)).text;
      ok('given the whole book, they see it at once, on the same session', wider.includes(M.a2) && wider.includes(M.a3));
      await prisma.user.update({ where: { id: producer.id }, data: { bookAccess: 'ASSIGNED' } });
      ok('…and lose it at once when it\'s taken back', !(await call(R('/api/desk/insureds'), 'GET', tok.producer)).text.includes(M.a2));
    }

    section('VAs: need-to-know (Q4)');
    {
      // A VA's work comes from the task list (the queue route gives its counts and filters).
      const q1 = (await call(R('/api/desk/tasks'), 'GET', tok.va1)).text, q2 = (await call(R('/api/desk/tasks'), 'GET', tok.va2)).text;
      ok('the pod\'s open work, for both VAs in it', q1.includes(M.ta1) && q2.includes(M.ta1) && q1.includes(M.ta2) && q2.includes(M.ta2));
      ok('a restricted task: only the VA named on it', q1.includes(M.restricted) && !q2.includes(M.restricted));
      ok('closed work: only the VA who did it', (await call(R('/api/desk/tasks/[id]'), 'GET', tok.va1, { id: tDone.id })).status === 200 && (await call(R('/api/desk/tasks/[id]'), 'GET', tok.va2, { id: tDone.id })).status === 404);
      ok('an account with no work for them in it: not found, even to a VA in the pod', (await call(R('/api/desk/insureds/[id]'), 'GET', tok.va1, { id: a3.id })).status === 404);
      ok('an account they have work on: found', (await call(R('/api/desk/insureds/[id]'), 'GET', tok.va1, { id: a1.id })).status === 200);
      ok('a VA can\'t file a request', (await call(R('/api/desk/tasks'), 'POST', tok.va1, {}, { type: 'OTHER', title: `${TAG} va filed`, agencyId: A.id })).status === 404);
      const detail2 = (await call(R('/api/desk/tasks/[id]'), 'GET', tok.va2, { id: ta1.id })).text;
      ok('in a task\'s file list: the Financial file only for the VA granted it', !detail2.includes(M.finDoc) && (await call(R('/api/desk/tasks/[id]'), 'GET', tok.va1, { id: ta1.id })).text.includes(M.finDoc));
      ok('…a Personal file for neither', !detail2.includes(M.persDoc) && !(await call(R('/api/desk/tasks/[id]'), 'GET', tok.va1, { id: ta1.id })).text.includes(M.persDoc));

      // Losing access takes effect on the next request, the same session.
      ok('vaQuiet sees the pod\'s work while the agency authorises the pod', (await call(R('/api/desk/tasks/[id]'), 'GET', tok.vaQuiet, { id: ta1.id })).status === 200);
      await prisma.agencyPodAccess.deleteMany({ where: { agencyId: A.id, podId: podA.id } });
      await prisma.agencyPodAccess.create({ data: { agencyId: A.id, podId: podA.id, userId: va1.id } });
      await prisma.agencyPodAccess.create({ data: { agencyId: A.id, podId: podA.id, userId: va2.id } });
      ok('the agency authorises named VAs instead: the others lose it at once', (await call(R('/api/desk/tasks/[id]'), 'GET', tok.vaQuiet, { id: ta1.id })).status === 404
        && (await call(R('/api/desk/tasks/[id]'), 'GET', tok.va1, { id: ta1.id })).status === 200);
      await prisma.podMember.deleteMany({ where: { podId: podA.id, userId: va2.id } });
      ok('taken out of the pod: the work is gone at once', (await call(R('/api/desk/tasks/[id]'), 'GET', tok.va2, { id: ta1.id })).status === 404);
      await prisma.podMember.create({ data: { podId: podA.id, userId: va2.id } });
      await prisma.pod.update({ where: { id: podA.id }, data: { isActive: false } });
      ok('the pod switched off: nobody in it sees its work', (await call(R('/api/desk/tasks/[id]'), 'GET', tok.va1, { id: ta1.id })).status === 404);
      await prisma.pod.update({ where: { id: podA.id }, data: { isActive: true } });
      await prisma.user.update({ where: { id: va1.id }, data: { isActive: false } });
      const inactive = await call(R('/api/desk/tasks/[id]'), 'GET', tok.va1, { id: ta1.id });
      ok('a deactivated VA: refused on the same session', inactive.status === 401 || inactive.status === 403, inactive.status);
      // Without a session too: handing a task over checks what the new assignee may see (their scope, not the caller's).
      const toInactive = await call(R('/api/desk/tasks/[id]/assign'), 'POST', tok.amA, { id: ta2.id }, { assigneeId: va1.id });
      ok('…and can\'t be handed work while deactivated', toInactive.status >= 400 && toInactive.status < 500 && (await prisma.task.findUniqueOrThrow({ where: { id: ta2.id } })).assigneeId === null, toInactive.status);
      await prisma.user.update({ where: { id: va1.id }, data: { isActive: true } });
      ok('…and back when reactivated', (await call(R('/api/desk/tasks/[id]'), 'GET', tok.va1, { id: ta1.id })).status === 200);
    }

    section('Documents');
    // Signing a link needs no network, so a machine without R2 uses stand-in settings (as in Module 30).
    const r2Keys = ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET'];
    const r2Before = Object.fromEntries(r2Keys.map((k) => [k, process.env[k]]));
    if (!r2Keys.every((k) => process.env[k]?.trim())) Object.assign(process.env, { R2_ACCOUNT_ID: 'testaccount', R2_ACCESS_KEY_ID: 'testkey', R2_SECRET_ACCESS_KEY: 'testsecret', R2_BUCKET: process.env.R2_BUCKET?.trim() || 'testbucket' });
    try {
      const open = async (who: Who, id: string) => (await call(R('/api/desk/documents/[id]'), 'GET', tok[who], { id })).status;
      const table: [string, string, Partial<Record<Who, number>>][] = [
        ['internal, general', dInt.id, { ops: 302, amA: 302, va1: 302, va2: 302, adminA: 404, csrA: 404, producer: 404, adminB: 404, vaB: 404 }],
        ['shared with the agency (policy)', dShared.id, { adminA: 302, csrA: 302, producer: 302, va2: 302, adminB: 404, amB: 404, vaB: 404, vaNone: 404 }],
        ['internal, Financial', dFin.id, { ops: 302, amA: 302, va1: 302, va2: 404, adminA: 404, producer: 404 }],
        ['shared, Personal', dPers.id, { adminA: 302, amA: 302, va1: 404, va2: 404, adminB: 404 }],
        ['removed', dGone.id, { ops: 404, amA: 404, adminA: 404, va1: 404 }],
        ['the other agency\'s', dB.id, { adminB: 302, vaB: 302, adminA: 404, amA: 404, va1: 404 }],
      ];
      for (const [label, id, expect] of table) {
        const got: Record<string, number> = {};
        await pool(Object.keys(expect) as Who[], async (who) => { got[who] = await open(who, id); });
        ok(`${label}: opened by exactly the right people`, Object.entries(expect).every(([w, s]) => got[w] === s), got);
      }
      const finRefusals = await prisma.deskAuditLog.findMany({ where: { action: 'access.denied', entityId: dFin.id, actorId: va2.id } });
      ok('a refused sensitive file is logged with its kind', finRefusals.length > 0 && finRefusals.every((r) => (r.metadata as Json)?.sensitivity === 'FINANCIAL'));
      const opened = await prisma.deskAuditLog.count({ where: { entityId: dFin.id, actorId: va1.id, action: { in: ['document.viewed', 'document.downloaded'] } } });
      ok('an opened file is logged as viewed or downloaded', opened > 0, opened);
      const redirect = await call(R('/api/desk/documents/[id]'), 'GET', tok.adminA, { id: dShared.id });
      ok('the link to an opened file is never cached', /no-store/.test(redirect.headers.get('cache-control') ?? ''));
    } finally {
      for (const k of r2Keys) { if (r2Before[k] === undefined) delete process.env[k]; else process.env[k] = r2Before[k]; }
    }

    section('Restricted tasks');
    {
      const by = async (who: Who) => (await call(R('/api/desk/tasks/[id]'), 'GET', tok[who], { id: tr.id }));
      ok('the named VA opens it', (await by('va1')).status === 200);
      ok('another VA in the same pod: not found', (await by('va2')).status === 404);
      ok('the agency\'s Account Manager and the Operations Manager open it', (await by('amA')).status === 200 && (await by('ops')).status === 200);
      const ag = await by('adminA');
      ok('the agency sees its own request, but not the restriction or its reason', ag.status === 200 && !ag.text.includes(M.restrictReason) && !/restricted/i.test(ag.text.replace(M.restricted, '')));
      const assign = await call(R('/api/desk/tasks/[id]/assign'), 'POST', tok.amA, { id: tr.id }, { assigneeId: va2.id });
      ok('it can\'t be handed to a VA who may not see it', assign.status >= 400 && assign.status < 500 && (await prisma.task.findUniqueOrThrow({ where: { id: tr.id } })).assigneeId === null, assign.status);
      const subs = (await call(R('/api/desk/tasks'), 'GET', tok.adminA)).text;
      ok('the team\'s own subtasks never reach the agency\'s list', !subs.includes(M.subtask));
      ok('…nor open for them by id', (await call(R('/api/desk/tasks/[id]'), 'GET', tok.adminA, { id: sub.id })).status === 404);
    }

    section('Internal notes never reach the agency');
    {
      const vaNote = mark('vanewnote'), shared = mark('opsshared'), agencyTry = mark('agencytry');
      const r1 = await call(R('/api/desk/tasks/[id]/notes'), 'POST', tok.va1, { id: ta1.id }, { body: vaNote });
      const r2 = await call(R('/api/desk/tasks/[id]/notes'), 'POST', tok.ops, { id: ta1.id }, { body: shared, visibility: 'AGENCY' });
      const r3 = await call(R('/api/desk/tasks/[id]/notes'), 'POST', tok.adminA, { id: ta1.id }, { body: agencyTry, visibility: 'INTERNAL' });
      ok('notes written (VA, Operations Manager, agency)', [r1, r2, r3].every((r) => r.status < 300), [r1.status, r2.status, r3.status]);
      // The pages that show a request's notes: the request, the account it is on, and the lists.
      const notesSeen = async (who: Who) => (await Promise.all([
        call(R('/api/desk/tasks/[id]'), 'GET', tok[who], { id: ta1.id }), call(R('/api/desk/insureds/[id]/overview'), 'GET', tok[who], { id: a1.id }),
        call(R('/api/desk/tasks'), 'GET', tok[who]), call(R('/api/desk/queue'), 'GET', tok[who]), call(R('/api/desk/messages'), 'GET', tok[who]),
      ])).map((p) => p.text).join('\n');
      const text = await notesSeen('adminA');
      ok('a VA\'s note is internal unless they say otherwise: not on any agency page', !text.includes(vaNote));
      ok('a note shared with the agency is there', text.includes(shared));
      ok('the agency can\'t write a note its own people can\'t see', (await prisma.taskEvent.findFirstOrThrow({ where: { body: agencyTry } })).visibility === 'AGENCY');
      const prodPages = await notesSeen('producer');
      ok('…the same for a Producer on the account', !prodPages.includes(vaNote) && prodPages.includes(shared));
      const otherPages = await notesSeen('adminB') + (await call(R('/api/desk/tasks/[id]'), 'GET', tok.adminB, { id: tb.id })).text;
      ok('…and none of it reaches the other agency', !otherPages.includes(shared) && !otherPages.includes(agencyTry));
      const vaPages = await notesSeen('va2');
      ok('the team sees the internal note', vaPages.includes(vaNote));
    }

    section('An agency switched off');
    {
      await prisma.agency.update({ where: { id: A.id }, data: { deskEnabled: false } });
      const statuses = await Promise.all((['adminA', 'producer'] as Who[]).map(async (w) => (await call(R('/api/desk/tasks'), 'GET', tok[w])).status));
      ok('its people are refused at once, on the same session', statuses.every((s) => s === 403), statuses);
      ok('its VAs and Account Manager no longer see its work', (await call(R('/api/desk/tasks/[id]'), 'GET', tok.va1, { id: ta1.id })).status === 404
        && (await call(R('/api/desk/tasks/[id]'), 'GET', tok.amA, { id: ta1.id })).status === 404);
      await prisma.agency.update({ where: { id: A.id }, data: { deskEnabled: true } });
      ok('…and everything is back when it\'s switched on again', (await call(R('/api/desk/tasks/[id]'), 'GET', tok.adminA, { id: ta1.id })).status === 200);
    }
  } catch (err) {
    console.error(err);
    fail += 1;
  } finally {
    await wipe().catch((e) => { console.error('cleanup failed', e); fail += 1; });
    const left = await prisma.agency.count({ where: { name: { startsWith: TAG } } }) + await prisma.user.count({ where: { email: { startsWith: TAG } } }) + await prisma.pod.count({ where: { code: { startsWith: TAG } } });
    if (left) { console.error(`left behind: ${left}`); fail += 1; }
    console.log(`\n${pass} passed, ${fail} failed`);
    await prisma.$disconnect();
    process.exit(fail ? 1 : 0);
  }
})();
