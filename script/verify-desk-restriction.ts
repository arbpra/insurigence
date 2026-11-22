/**
 * Restricting a request to named VAs (Q4: "restrict certain agencies or tasks
 * to specific employees"), added after Module 46.
 *
 *   npx tsx script/verify-desk-restriction.ts
 *
 * The history's wording (pure); who can be named; who may restrict (Account
 * and Operations Managers; a VA refused, the agency and another agency's
 * Account Manager told "not found"); bad input; restricting a request takes
 * its subtasks with it, sends anyone holding work who isn't named back to the
 * queue, and is in the history and the audit log; VAs and the agency never
 * see who is named or why; changing who is named; lifting it; a closed
 * request; the real routes; the workspace's offer and screen. Against the
 * shared database, with temporary agencies, people, pods and tasks, all
 * removed at the end. Emails are off for this run.
 */
import 'dotenv/config';
import { readFileSync } from 'fs';
import { NextRequest } from 'next/server';
import type { Prisma, UserRole } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { createSession } from '../lib/auth';
import { DeskAccessError, resolveDeskScope } from '../lib/desk/access';
import { getRestrictionCandidates, getTaskDetail, setTaskRestriction } from '../lib/desk/task-api';
import { RESTRICTION_MAX_PEOPLE, restrictTask } from '../lib/desk/tasks';
import { eventLines, eventTitle, type StaffEvent } from '../lib/desk/task-workspace';
import { GET as candidatesRoute, POST as restrictRoute } from '../app/api/desk/tasks/[id]/restriction/route';

process.env.DESK_EMAIL_NOTIFICATIONS = 'off';

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, detail = '') => {
  c ? pass++ : fail++;
  console.log(`  ${c ? '✓' : '✗'} ${n}${!c && detail ? `  [${detail}]` : ''}`);
};
const section = (s: string) => console.log(`\n${s}`);

const TAG = `m46test${Date.now()}`;
const cleanup = { agencyIds: [] as string[], userIds: [] as string[], podIds: [] as string[] };
type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any

async function wipe() {
  const agencyId = { in: cleanup.agencyIds };
  await prisma.taskEvent.deleteMany({ where: { agencyId } });
  await prisma.task.updateMany({ where: { agencyId }, data: { parentTaskId: null } });
  await prisma.task.deleteMany({ where: { agencyId } });
  await prisma.insuredAccount.deleteMany({ where: { agencyId } });
  await prisma.agencyPodAccess.deleteMany({ where: { OR: [{ agencyId }, { podId: { in: cleanup.podIds } }] } });
  await prisma.podMember.deleteMany({ where: { podId: { in: cleanup.podIds } } });
  await prisma.pod.deleteMany({ where: { id: { in: cleanup.podIds } } });
  await prisma.agencyDeskAssignment.deleteMany({ where: { agencyId } });
  await prisma.deskAuditLog.deleteMany({ where: { OR: [{ agencyId }, { actorId: { in: cleanup.userIds } }] } });
  await prisma.session.deleteMany({ where: { userId: { in: cleanup.userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: cleanup.userIds } } });
  await prisma.agency.deleteMany({ where: { id: agencyId } });
}

const refusal = async (fn: () => Promise<unknown>) => {
  try { await fn(); return null; } catch (e) { if (e instanceof DeskAccessError) return e; throw e; }
};

function pureLogic() {
  section('History wording');
  const e = (kind: string, details: Record<string, unknown>) => ({ id: 'x', kind, visibility: 'INTERNAL', actorName: null, body: null, fromStatus: null, toStatus: null, details, createdAt: '' }) as StaffEvent;
  ok('restricting reads "Restricted to named people", with who and why for managers',
    eventTitle(e('RESTRICTED', { to: ['a'], from: [], names: ['Dana Reyes'], reason: 'Open litigation' })) === 'Restricted to named people'
    && eventLines(e('RESTRICTED', { to: ['a'], names: ['Dana Reyes'], reason: 'Open litigation' })).join('|') === 'Only: Dana Reyes, with the Account Managers and Operations Managers|Reason: Open litigation');
  ok('changing and lifting read as such', eventTitle(e('RESTRICTED', { to: ['a'], from: ['b'] })) === 'Restriction changed' && eventTitle(e('RESTRICTED', { to: [], from: ['b'] })) === 'Restriction lifted');
  ok('on a subtask it says which request it was set on', eventTitle(e('RESTRICTED', { to: ['a'], from: [], onRequest: 1042 })) === 'Restricted to named people (set on request #1042)');
  ok('the subtasks and the work sent back are counted', eventLines(e('RESTRICTED', { to: ['a'], subtasks: 2, released: 1 })).join('|') === 'Applied to 2 subtasks too|1 piece of work went back to the queue: the person holding it isn\'t named');
  ok('a VA, without the details, learns only that access changed', eventTitle(e('RESTRICTED', {})) === 'Access restriction changed' && eventLines(e('RESTRICTED', {})).length === 0);
  ok('work sent back automatically doesn\'t say its holder released it',
    eventTitle({ ...e('UNASSIGNED', { automatic: 'restricted' }), assignedFrom: 'Sam Lee' }) === 'Back to the queue: Sam Lee no longer has access'
    && eventTitle({ ...e('UNASSIGNED', {}), assignedFrom: 'Sam Lee' }) === 'Released by Sam Lee, back to the queue');
}

(async () => {
  try {
    pureLogic();

    const mkAgency = async (n: string) => { const a = await prisma.agency.create({ data: { name: `${TAG} ${n}`, deskEnabled: true } }); cleanup.agencyIds.push(a.id); return a; };
    const mkUser = async (n: string, role: UserRole, agencyId: string | null = null) => {
      const u = await prisma.user.create({ data: { email: `${TAG}-${n}@example.test`, role, agencyId, firstName: `${TAG}`, lastName: n, passwordHash: 'x', mustChangePassword: false } });
      cleanup.userIds.push(u.id); return u;
    };
    const mkPod = async (n: string, sortOrder: number) => { const p = await prisma.pod.create({ data: { code: `${TAG}${n}`, name: `${TAG} ${n}`, sortOrder } }); cleanup.podIds.push(p.id); return p; };
    const A = await mkAgency('Harbor');
    const B = await mkAgency('Basin');
    const owner = await mkUser('owner', 'ADMIN', A.id);
    const am = await mkUser('am', 'ACCOUNT_MANAGER');
    const amB = await mkUser('amb', 'ACCOUNT_MANAGER');
    const ops = await mkUser('ops', 'DESK_ADMIN');
    const va = await mkUser('va', 'DESK_VA');       // Harbor, Pod One
    const va2 = await mkUser('va2', 'DESK_VA');     // Harbor, Pod One: holds the request
    const va3 = await mkUser('va3', 'DESK_VA');     // Harbor, Pod Two: holds the subtask
    const outsider = await mkUser('out', 'DESK_VA'); // in Pod One, but Harbor hasn't authorised them
    const vaB = await mkUser('vab', 'DESK_VA');     // Basin only
    const P1 = await mkPod('One', 911);
    const P2 = await mkPod('Two', 912);
    await prisma.agencyDeskAssignment.createMany({ data: [{ agencyId: A.id, primaryAmId: am.id }, { agencyId: B.id, primaryAmId: amB.id }] });
    await prisma.podMember.createMany({ data: [
      { podId: P1.id, userId: va.id }, { podId: P1.id, userId: va2.id }, { podId: P2.id, userId: va3.id }, { podId: P1.id, userId: outsider.id }, { podId: P1.id, userId: vaB.id },
    ] });
    await prisma.agencyPodAccess.createMany({ data: [
      { agencyId: A.id, podId: P1.id, userId: va.id }, { agencyId: A.id, podId: P1.id, userId: va2.id }, { agencyId: A.id, podId: P2.id, userId: va3.id },
      { agencyId: B.id, podId: P1.id, userId: vaB.id },
    ] });
    const acme = await prisma.insuredAccount.create({ data: { agencyId: A.id, name: `${TAG} Acme Trucking`, nameKey: `${TAG} acme trucking` } });
    const scope = (u: { id: string }) => resolveDeskScope(prisma, u.id);
    const [sOwner, sAm, sAmB, sOps, sVa, sVa2, sVa3] = await Promise.all([owner, am, amB, ops, va, va2, va3].map(scope));
    const now = Date.now();
    let n = 0;
    const mkTask = (title: string, data: Partial<Prisma.TaskUncheckedCreateInput> = {}) => {
      n += 1;
      return prisma.task.create({ data: {
        reference: 960_000_000 + (now % 30_000_000) + n, agencyId: A.id, type: 'DOCUMENT_UPLOAD', title: `${TAG} ${title}`, amId: am.id,
        createdById: owner.id, restrictedToUserIds: [], insuredId: acme.id, podId: P1.id, ...data,
      } });
    };
    const row = (id: string) => prisma.task.findUniqueOrThrow({ where: { id } });
    const T = await mkTask('Coverage dispute file', { status: 'IN_PROGRESS', assigneeId: va2.id, startedAt: new Date() });
    const S = await mkTask('Pull the loss runs', { parentTaskId: T.id, podId: P2.id, type: 'LOSS_RUNS', status: 'ASSIGNED', assigneeId: va3.id });
    const C = await mkTask('Closed certificate', { status: 'COMPLETED', assigneeId: va.id, completedAt: new Date() });

    section('Who can be named');
    {
      const c = await getRestrictionCandidates(prisma, sOps, T.id);
      const byId = new Map(c.people.map((p) => [p.id, p]));
      ok('the VAs Harbor authorised in the pods doing the work, with their pods', byId.get(va.id)?.eligible === true && byId.get(va2.id)?.eligible === true
        && byId.get(va3.id)?.pods.join() === P2.name && byId.get(va.id)?.pods.join() === P1.name, JSON.stringify(c.people));
      ok('not a pod member Harbor hasn\'t authorised, nor another agency\'s VA', !byId.has(outsider.id) && !byId.has(vaB.id));
      ok('nobody named yet', c.restricted === false && c.reason === null && c.people.every((p) => !p.named));
    }

    section('Who may restrict');
    {
      const asVa = await refusal(() => restrictTask(prisma, sVa2, T.id, { userIds: [va2.id], reason: 'mine' }));
      ok('a VA is refused (403), and the refusal is logged', asVa?.status === 403 && (await prisma.deskAuditLog.count({ where: { actorId: va2.id, entityId: T.id, action: 'access.denied' } })) > 0, asVa?.message);
      const asOwner = await refusal(() => setTaskRestriction(prisma, sOwner, T.id, { userIds: [va.id], reason: 'x' }));
      const ownerList = await refusal(() => getRestrictionCandidates(prisma, sOwner, T.id));
      ok('the agency is told "not found", for the change and the list', asOwner?.status === 404 && ownerList?.status === 404);
      const asAmB = await refusal(() => restrictTask(prisma, sAmB, T.id, { userIds: [va.id], reason: 'x' }));
      ok('another agency\'s Account Manager: not found', asAmB?.status === 404);
      const vaList = await refusal(() => getRestrictionCandidates(prisma, sVa, T.id));
      ok('a VA can\'t list who could be named', vaList?.status === 403);
    }

    section('Bad input');
    {
      const tries: [string, unknown, unknown, number][] = [
        ['no list', undefined, 'r', 400], ['not ids', ['nope'], 'r', 400], ['a VA Harbor hasn\'t authorised', [outsider.id], 'r', 400],
        ['another agency\'s VA', [vaB.id], 'r', 400], ['an Account Manager', [am.id], 'r', 400], ['no reason', [va.id], '  ', 400],
        ['too many people', Array.from({ length: RESTRICTION_MAX_PEOPLE + 1 }, (_, i) => i.toString(16).padStart(24, '0')), 'r', 400],
        ['lifting what isn\'t restricted', [], null, 409],
      ];
      for (const [what, userIds, reason, status] of tries) {
        const r = await refusal(() => restrictTask(prisma, sAm, T.id, { userIds, reason }));
        ok(`${what}: refused (${status})`, r?.status === status, r ? `${r.status} ${r.message}` : 'saved');
      }
      const onSub = await refusal(() => restrictTask(prisma, sAm, S.id, { userIds: [va3.id], reason: 'r' }));
      ok('on a subtask: set it on the request instead', onSub?.status === 400 && /main request/.test(onSub.message));
      ok('nothing changed', (await row(T.id)).restrictedToUserIds.length === 0 && (await row(S.id)).restrictedToUserIds.length === 0);
    }

    section('Restricting');
    {
      const r = await restrictTask(prisma, sAm, T.id, { userIds: [va.id, va.id], reason: '  Open litigation; counsel only  ' });
      const [t, s] = await Promise.all([row(T.id), row(S.id)]);
      ok('the request is restricted to the one named (duplicates dropped), with the reason', t.restrictedToUserIds.join() === va.id && t.restrictionReason === 'Open litigation; counsel only');
      ok('its subtask follows it', s.restrictedToUserIds.join() === va.id && s.restrictionReason === t.restrictionReason && r.subtasks === 1);
      ok('the holder who isn\'t named goes back to the queue, as New', t.assigneeId === null && t.status === 'NEW');
      ok('so does the subtask\'s holder', s.assigneeId === null && s.status === 'NEW' && r.released === 2);
      const events = await prisma.taskEvent.findMany({ where: { taskId: { in: [T.id, S.id] } } });
      const restricted = events.filter((e) => e.kind === 'RESTRICTED');
      ok('a history entry on the request and on the subtask, internal', restricted.length === 2 && restricted.every((e) => e.visibility === 'INTERNAL'));
      ok('the releases are in the history, marked automatic', events.filter((e) => e.kind === 'UNASSIGNED' && (e.metadata as Json)?.automatic === 'restricted').length === 2);
      const audit = await prisma.deskAuditLog.findFirst({ where: { action: 'task.restricted', entityId: T.id } });
      ok('the audit log records who, to whom and who was released', audit?.actorId === am.id && (audit?.metadata as Json)?.to?.join() === va.id && (audit?.metadata as Json)?.released?.length === 2);

      const again = await refusal(() => restrictTask(prisma, sAm, T.id, { userIds: [va.id], reason: 'again' }));
      ok('the same people again: nothing to change (409)', again?.status === 409);
    }

    section('Who sees it now');
    {
      const seen = async (s: Awaited<ReturnType<typeof scope>>, id: string) => (await refusal(() => getTaskDetail(prisma, s, id))) === null;
      ok('the named VA opens the request', await seen(sVa, T.id));
      ok('the VA who held it doesn\'t; nor does the subtask\'s', !(await seen(sVa2, T.id)) && !(await seen(sVa3, S.id)));
      ok('the Account Manager and the Operations Manager do', (await seen(sAm, T.id)) && (await seen(sOps, T.id)) && (await seen(sOps, S.id)));
      ok('another agency\'s Account Manager doesn\'t', !(await seen(sAmB, T.id)));

      const asVa: Json = await getTaskDetail(prisma, sVa, T.id);
      ok('the named VA isn\'t shown who else is named, or why', !('restrictedToUserIds' in asVa) && !('restrictionReason' in asVa));
      const vaEntry = asVa.events.find((e: Json) => e.kind === 'RESTRICTED');
      ok('their history says access changed, without names or the reason', vaEntry && Object.keys(vaEntry.details).length === 0 && eventTitle(vaEntry) === 'Access restriction changed'
        && !JSON.stringify(asVa.events).includes('litigation'), JSON.stringify(vaEntry));
      ok('they aren\'t offered the restriction', asVa.permissions.restrict === false);

      const asOwner: Json = await getTaskDetail(prisma, sOwner, T.id);
      ok('the agency still sees its request, with nothing about the restriction', !('restrictedToUserIds' in asOwner) && !('restrictionReason' in asOwner)
        && !asOwner.events.some((e: Json) => e.kind === 'RESTRICTED' || e.kind === 'UNASSIGNED') && !JSON.stringify(asOwner).includes('litigation'));

      const asAm: Json = await getTaskDetail(prisma, sAm, T.id);
      const amEntry = asAm.events.find((e: Json) => e.kind === 'RESTRICTED');
      ok('the Account Manager sees who and why in the history', eventTitle(amEntry) === 'Restricted to named people'
        && eventLines(amEntry).some((l) => l.includes(`${TAG} va`) && l.startsWith('Only:')) && eventLines(amEntry).includes('Reason: Open litigation; counsel only'), JSON.stringify(eventLines(amEntry)));
      ok('…and is offered to change it on the request, not on its subtask', asAm.permissions.restrict === true && ((await getTaskDetail(prisma, sAm, S.id)) as Json).permissions.restrict === false);
      const c = await getRestrictionCandidates(prisma, sAm, T.id);
      ok('the list shows who is named and the reason', c.restricted && c.reason === 'Open litigation; counsel only' && c.people.find((p) => p.id === va.id)?.named === true);
    }

    section('Changing who is named');
    {
      await prisma.task.update({ where: { id: S.id }, data: { assigneeId: va3.id, status: 'ASSIGNED' } });
      const r = await restrictTask(prisma, sOps, T.id, { userIds: [va.id, va3.id], reason: 'Loss runs needed too' });
      const s = await row(S.id);
      ok('the Pod Two VA is added, and can open the subtask again', s.restrictedToUserIds.length === 2 && (await refusal(() => getTaskDetail(prisma, sVa3, S.id))) === null);
      ok('nobody named loses their work this time', r.released === 0 && s.assigneeId === va3.id);
      const entry = await prisma.taskEvent.findFirst({ where: { taskId: T.id, kind: 'RESTRICTED' }, orderBy: { createdAt: 'desc' } });
      ok('the history reads "Restriction changed"', eventTitle({ kind: 'RESTRICTED', details: entry?.metadata } as unknown as StaffEvent) === 'Restriction changed');
    }

    section('Lifting it');
    {
      await restrictTask(prisma, sOps, T.id, { userIds: [], reason: null });
      const [t, s] = await Promise.all([row(T.id), row(S.id)]);
      ok('the request and its subtask are open to their pods again, the reason cleared', t.restrictedToUserIds.length === 0 && s.restrictedToUserIds.length === 0 && t.restrictionReason === null && s.restrictionReason === null);
      ok('the VA who used to hold it sees it again', (await refusal(() => getTaskDetail(prisma, sVa2, T.id))) === null);
    }

    section('A closed request');
    {
      const r = await restrictTask(prisma, sAm, C.id, { userIds: [va2.id], reason: 'Complaint received after completion' });
      const c = await row(C.id);
      ok('can be restricted (a dispute can come after the work), and its holder isn\'t touched', c.restrictedToUserIds.join() === va2.id && c.assigneeId === va.id && c.status === 'COMPLETED' && r.released === 0);
      ok('its former holder no longer opens it', (await refusal(() => getTaskDetail(prisma, sVa, C.id))) !== null);
    }

    section('The routes');
    {
      const [tAm, tVa, tOwner] = await Promise.all([createSession(am.id), createSession(va.id), createSession(owner.id)]);
      const req = (method: string, token: string, body?: unknown) => new NextRequest(`http://local.test/api/desk/tasks/${T.id}/restriction`, {
        method, headers: { cookie: `session_token=${token}`, 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
      });
      const params = { params: Promise.resolve({ id: T.id }) };
      const list = await candidatesRoute(req('GET', tAm), params);
      const listBody: Json = await list.json();
      ok('GET lists who can be named, for the Account Manager', list.status === 200 && listBody.people.some((p: Json) => p.id === va.id));
      const post = await restrictRoute(req('POST', tAm, { userIds: [va.id], reason: 'Via the route' }), params);
      const postBody: Json = await post.json();
      ok('POST restricts, and answers with the request and what followed', post.status === 200 && postBody.task.restrictedToUserIds.join() === va.id && postBody.subtasks === 1 && typeof postBody.released === 'number');
      ok('a VA: 403; the agency: 404; broken JSON: 400', (await restrictRoute(req('POST', tVa, { userIds: [] }), params)).status === 403
        && (await restrictRoute(req('POST', tOwner, { userIds: [] }), params)).status === 404 && (await candidatesRoute(req('GET', tOwner), params)).status === 404
        && (await restrictRoute(req('POST', tAm, '{oops'), params)).status === 400);
      const unsigned = await restrictRoute(new NextRequest(`http://local.test/api/desk/tasks/${T.id}/restriction`, { method: 'POST', body: '{}' }), params);
      ok('signed out: refused', unsigned.status === 401 || unsigned.status === 403, String(unsigned.status));
    }

    section('The screen');
    {
      const src = readFileSync('app/components/desk/workspace/TaskWorkspace.tsx', 'utf8');
      ok('the workspace offers it only when allowed, and posts to the route', /p\.restrict && <button/.test(src) && src.includes("post('restriction'") && src.includes('/restriction`'));
      ok('it says who will see it and that it is internal', src.includes("Only the people you tick, the agency&apos;s Account Managers and the Operations Managers") && src.includes("VAs and the agency don&apos;t see who is named or why"));
      ok('it can be lifted, with a confirmation', src.includes('desk-task-restrict-lift') && /window\.confirm\(`Lift the restriction/.test(src));
      ok('saving needs someone ticked and a reason', /disabled=\{busy \|\| !restriction\.chosen\.length \|\| !restriction\.reason\.trim\(\)\}/.test(src));
    }
  } catch (err) {
    console.error(err);
    fail += 1;
  } finally {
    await wipe().catch((e) => { console.error('cleanup failed', e); fail += 1; });
    const left = await prisma.agency.count({ where: { name: { startsWith: TAG } } }) + await prisma.user.count({ where: { email: { startsWith: TAG } } });
    if (left) { console.error('left behind', left); fail += 1; }
    console.log(`\n━━ ${pass} passed, ${fail} failed ━━`);
    await prisma.$disconnect();
    process.exit(fail ? 1 : 0);
  }
})();
