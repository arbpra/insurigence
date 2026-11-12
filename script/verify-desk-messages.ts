/**
 * Module 36: messaging.
 *
 *   npx tsx script/verify-desk-messages.ts
 *
 * Who takes part in an agency's general conversation (owners and admins,
 * its primary and backup AMs, Operations Managers) and who doesn't
 * (producers, VAs, another agency, another AM), each refusal logged;
 * sending, with credentials refused and the text kept out of the log;
 * unread counts and read marks; the inbox's order; conversations on
 * requests, limited to what each person can open; the real routes; and the
 * screens. Against the shared database, with temporary agencies, people,
 * requests and messages, all removed at the end.
 */
import 'dotenv/config';
import { readFileSync } from 'fs';
import { NextRequest } from 'next/server';
import type { UserRole } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { createSession } from '../lib/auth';
import { DeskAccessError, resolveDeskScope } from '../lib/desk/access';
import { messageInbox, readThread, sendMessage } from '../lib/desk/messages';
import { messageTime, snippet } from '../lib/desk/message-view';
import { GET as inboxRoute } from '../app/api/desk/messages/route';
import { GET as threadRoute, POST as sendRoute } from '../app/api/desk/messages/[agencyId]/route';

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, detail = '') => {
  c ? pass++ : fail++;
  console.log(`  ${c ? '✓' : '✗'} ${n}${!c && detail ? `  [${detail}]` : ''}`);
  if (!c && process.env.FAIL_FAST) throw new Error(`stopped at: ${n}`);
};

const TAG = `m36test${Date.now()}`;
const cleanup = { agencyIds: [] as string[], userIds: [] as string[], podIds: [] as string[] };
let ref = 999_000_000 + Math.floor(Math.random() * 900_000);
const read = (p: string) => readFileSync(p, 'utf8');
type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any

async function wipe() {
  const agencyId = { in: cleanup.agencyIds };
  await prisma.deskMessage.deleteMany({ where: { agencyId } });
  await prisma.deskMessageRead.deleteMany({ where: { OR: [{ agencyId }, { userId: { in: cleanup.userIds } }] } });
  await prisma.taskEvent.deleteMany({ where: { agencyId } });
  await prisma.task.deleteMany({ where: { agencyId } });
  await prisma.insuredAssignment.deleteMany({ where: { agencyId } });
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

const req = (url: string, token?: string, body?: unknown) =>
  new NextRequest(`http://local.test${url}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { ...(token ? { cookie: `session_token=${token}` } : {}), 'content-type': 'application/json' },
    ...(body !== undefined ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}),
  });
const refusal = async (fn: () => Promise<unknown>) => {
  try { await fn(); return null; } catch (e) { if (e instanceof DeskAccessError) return e; throw e; }
};

function pureLogic() {
  console.log('Wording');
  ok('a snippet is one line, cut at 140', snippet('a\n\n  b   c') === 'a b c' && snippet('x'.repeat(200)).length === 140 && snippet('x'.repeat(200)).endsWith('…'));
  const now = new Date(2026, 10, 11, 15, 0);
  ok('today', messageTime(new Date(2026, 10, 11, 9, 40), now) === 'Today, 9:40 AM');
  ok('yesterday, across a month', messageTime(new Date(2026, 9, 31, 16, 5), new Date(2026, 10, 1, 8, 0)) === 'Yesterday, 4:05 PM');
  ok('earlier', messageTime(new Date(2026, 10, 3, 9, 40), now) === 'Nov 3, 2026, 9:40 AM');
}

(async () => {
  try {
    pureLogic();

    const mkAgency = async (n: string, deskEnabled = true) => { const a = await prisma.agency.create({ data: { name: `${TAG} ${n}`, deskEnabled } }); cleanup.agencyIds.push(a.id); return a; };
    const mkUser = async (n: string, role: UserRole, agencyId: string | null = null, extra: object = {}) => {
      const u = await prisma.user.create({ data: { email: `${TAG}-${n}@example.test`, role, agencyId, firstName: `${TAG}${n}`, passwordHash: 'x', mustChangePassword: false, ...extra } });
      cleanup.userIds.push(u.id); return u;
    };
    const A = await mkAgency('Harbor');
    const B = await mkAgency('Summit');
    const C = await mkAgency('Gamma');
    const Off = await mkAgency('Desk off', false);
    const owner = await mkUser('owner', 'ADMIN', A.id);
    const producer = await mkUser('producer', 'AGENT', A.id);
    const ownerB = await mkUser('ownerb', 'ADMIN', B.id);
    const am = await mkUser('am', 'ACCOUNT_MANAGER');
    const backup = await mkUser('backup', 'ACCOUNT_MANAGER');
    const otherAm = await mkUser('otheram', 'ACCOUNT_MANAGER');
    const ops = await mkUser('ops', 'DESK_ADMIN');
    const va = await mkUser('va', 'DESK_VA');
    await prisma.agencyDeskAssignment.createMany({ data: [
      { agencyId: A.id, primaryAmId: am.id, backupAmId: backup.id },
      { agencyId: B.id, primaryAmId: am.id },
      { agencyId: C.id, primaryAmId: otherAm.id },
      { agencyId: Off.id, primaryAmId: am.id },
    ] });
    const pod = await prisma.pod.create({ data: { code: TAG, name: `${TAG} Pod` } }); cleanup.podIds.push(pod.id);
    await prisma.podMember.create({ data: { podId: pod.id, userId: va.id } });
    await prisma.agencyPodAccess.create({ data: { agencyId: A.id, podId: pod.id } });

    const [sOwner, sProducer, sOwnerB, sAm, sBackup, sOther, sOps, sVa] = await Promise.all([owner, producer, ownerB, am, backup, otherAm, ops, va].map((u) => resolveDeskScope(prisma, u.id)));
    const CTX = { ip: '203.0.113.6', userAgent: 'verify' };

    console.log('Who takes part');
    const hello = await sendMessage(prisma, sOwner, A.id, { body: '  Hello team, can we review the renewals list?  ' }, CTX);
    ok('the agency owner sends; trimmed; from the agency side', hello.side === 'AGENCY' && hello.body === 'Hello team, can we review the renewals list?');
    const reply = await sendMessage(prisma, sAm, A.id, { body: 'Of course. I will send it Friday.' });
    ok('its Account Manager replies, from the Desk side', reply.side === 'DESK');
    ok('its backup AM can too', (await sendMessage(prisma, sBackup, A.id, { body: 'Backup here, noted.' })).side === 'DESK');
    ok('an Operations Manager can too', (await sendMessage(prisma, sOps, A.id, { body: 'Ops: all good.' })).side === 'DESK');
    const refusedFor = async (name: string, s: Awaited<ReturnType<typeof resolveDeskScope>>, userId: string, agencyId: string) => {
      const sendErr = await refusal(() => sendMessage(prisma, s, agencyId, { body: 'hi' }, CTX));
      const readErr = await refusal(() => readThread(prisma, s, agencyId, CTX));
      const logs = await prisma.deskAuditLog.findMany({ where: { actorId: userId, action: 'access.denied', entityType: 'DeskMessage' } });
      ok(name, sendErr?.status === 404 && readErr?.status === 404 && logs.some((l) => (l.metadata as Json).op === 'send') && logs.some((l) => (l.metadata as Json).op === 'read'), `${sendErr?.status} ${readErr?.status} ${logs.length}`);
    };
    await refusedFor('a producer (own accounts only): refused, logged', sProducer, producer.id, A.id);
    await refusedFor('another agency\'s owner: refused, logged', sOwnerB, ownerB.id, A.id);
    await refusedFor('another AM: refused, logged', sOther, otherAm.id, A.id);
    await refusedFor('a VA: refused, logged', sVa, va.id, A.id);
    await refusedFor('an agency with the Desk off, even its AM: refused', sAm, am.id, Off.id);
    await refusedFor('an agency with the Desk off, even for an Operations Manager: refused', sOps, ops.id, Off.id);
    ok('not an id: refused', (await refusal(() => readThread(prisma, sAm, 'nope')))?.status === 404);
    ok('nothing was sent by anyone refused', await prisma.deskMessage.count({ where: { body: 'hi' } }) === 0);

    console.log('Sending');
    ok('empty: 400', (await refusal(() => sendMessage(prisma, sOwner, A.id, { body: '   ' })))?.status === 400 && (await refusal(() => sendMessage(prisma, sOwner, A.id, {})))?.status === 400);
    ok('too long: 400', (await refusal(() => sendMessage(prisma, sOwner, A.id, { body: 'x'.repeat(4001) })))?.status === 400 && !!(await sendMessage(prisma, sOps, A.id, { body: 'y'.repeat(4000) })));
    const cred = await refusal(() => sendMessage(prisma, sOwner, A.id, { body: 'The carrier login is admin, password: Hunter22!' }));
    ok('a password: refused, and not stored', cred?.status === 400 && cred.message.includes('password manager') && await prisma.deskMessage.count({ where: { agencyId: A.id, body: { contains: 'Hunter22' } } }) === 0);
    ok('the AM is held to it too', (await refusal(() => sendMessage(prisma, sAm, A.id, { body: 'pwd = abc123' })))?.status === 400);
    const sentLog = await prisma.deskAuditLog.findFirst({ where: { action: 'message.sent', entityId: hello.id } });
    ok('sending is logged with the facts, not the text', !!sentLog && (sentLog.metadata as Json).length === hello.body.length && (sentLog.metadata as Json).side === 'AGENCY' && !JSON.stringify(sentLog.metadata).includes('renewals') && sentLog.ipAddress === '203.0.113.6');

    console.log('Reading and unread');
    const ownerInbox = await messageInbox(prisma, sOwner);
    ok('the owner: one conversation, four unread from the Desk', ownerInbox.canMessage && ownerInbox.threads.length === 1 && ownerInbox.threads[0].agencyId === A.id && ownerInbox.threads[0].unread === 4, JSON.stringify(ownerInbox.threads));
    const t = await readThread(prisma, sOwner, A.id, CTX);
    ok('oldest first, each side marked', t.messages.length === 5 && t.messages[0].id === hello.id && t.messages[0].mine && t.messages[0].side === 'AGENCY' && t.messages[1].side === 'DESK' && !t.messages[1].mine);
    ok('the agency sees its AM by name', t.messages[1].author === `${TAG}am`);
    ok('opening it is logged', !!(await prisma.deskAuditLog.findFirst({ where: { actorId: owner.id, action: 'message.viewed', entityId: A.id } })));
    ok('and marks it read', (await messageInbox(prisma, sOwner)).threads[0].unread === 0);
    // The AM replied after the owner's first message: replying marks the conversation read for them.
    ok('replying marks it read for you; Desk colleagues\' messages aren\'t "unread"', (await messageInbox(prisma, sAm)).threads.find((x) => x.agencyId === A.id)?.unread === 0);
    await sendMessage(prisma, sOwner, A.id, { body: 'Thanks!' });
    // Newer, but from the Desk side, so not unread for the AM: unread still comes first.
    await sendMessage(prisma, sOps, B.id, { body: 'Summit note from operations.' });
    const amInbox = await messageInbox(prisma, sAm);
    ok('the AM: their agencies only, Desk-off left out', amInbox.threads.map((x) => x.agencyId).sort().join() === [A.id, B.id].sort().join());
    ok('unread first, with the latest message', amInbox.threads[0].agencyId === A.id && amInbox.threads[0].unread === 1 && amInbox.threads[0].last?.snippet === 'Thanks!' && amInbox.threads[0].last?.side === 'AGENCY');
    ok('a newer conversation with nothing unread comes after', amInbox.threads[1].agencyId === B.id && amInbox.threads[1].last?.snippet === 'Summit note from operations.' && amInbox.threads[1].unread === 0);
    ok('a conversation with no messages: nothing yet', (await messageInbox(prisma, sOps)).threads.find((x) => x.agencyId === C.id)?.last === null);
    await readThread(prisma, sAm, A.id);
    ok('each person\'s read mark is their own', (await messageInbox(prisma, sAm)).threads.find((x) => x.agencyId === A.id)?.unread === 0 && (await messageInbox(prisma, sBackup)).threads.find((x) => x.agencyId === A.id)!.unread > 0);
    ok('one read mark per person and agency', await prisma.deskMessageRead.count({ where: { agencyId: A.id, userId: am.id } }) === 1);
    const opsInbox = await messageInbox(prisma, sOps);
    ok('an Operations Manager: every Desk agency', [A.id, B.id, C.id].every((id) => opsInbox.threads.some((x) => x.agencyId === id)) && !opsInbox.threads.some((x) => x.agencyId === Off.id));
    const prodInbox = await messageInbox(prisma, sProducer);
    ok('a producer: no conversation, told why', !prodInbox.canMessage && prodInbox.threads.length === 0);
    ok('a VA has no inbox: 404, logged', (await refusal(() => messageInbox(prisma, sVa)))?.status === 404);

    console.log('Conversations on requests');
    const acme = await prisma.insuredAccount.create({ data: { agencyId: A.id, name: `${TAG} Acme`, nameKey: `${TAG} acme` } });
    const other = await prisma.insuredAccount.create({ data: { agencyId: A.id, name: `${TAG} Other`, nameKey: `${TAG} other` } });
    await prisma.insuredAssignment.create({ data: { agencyId: A.id, insuredId: acme.id, userId: producer.id, role: 'PRODUCER' } });
    const mkTask = (title: string, insuredId: string) => prisma.task.create({ data: { reference: ref++, agencyId: A.id, insuredId, type: 'COI', title: `${TAG} ${title}`, status: 'IN_PROGRESS', podId: pod.id, assigneeId: va.id, restrictedToUserIds: [] } });
    const t1 = await mkTask('acme certificate', acme.id);
    const t2 = await mkTask('other endorsement', other.id);
    const note = (taskId: string, actorId: string, body: string, visibility: 'AGENCY' | 'INTERNAL', minutesAgo: number) =>
      prisma.taskEvent.create({ data: { taskId, agencyId: A.id, actorId, kind: 'NOTE', visibility, body, createdAt: new Date(Date.now() - minutesAgo * 60_000) } });
    await note(t1.id, producer.id, 'Is the certificate ready?', 'AGENCY', 30);
    await note(t1.id, va.id, 'Sent to the holder this morning.', 'AGENCY', 10);
    await note(t1.id, va.id, `${TAG} internal: carrier slow`, 'INTERNAL', 5);
    await note(t2.id, owner.id, 'Please add the new driver.', 'AGENCY', 20);
    const conv = (await messageInbox(prisma, sOwner)).requestConversations;
    ok('one per request, newest first', conv.length === 2 && conv[0].taskId === t1.id && conv[1].taskId === t2.id, conv.map((c) => c.title).join());
    ok('the latest shared note, never an internal one', conv[0].snippet === 'Sent to the holder this morning.' && !JSON.stringify(conv).includes('carrier slow'));
    ok('to the agency the Desk is one team; colleagues by name', conv[0].author === 'Your Desk team' && conv[0].from === 'DESK' && conv[1].author === `${TAG}owner` && conv[1].from === 'AGENCY');
    ok('no agency name on the agency\'s own list', !('agencyName' in conv[0]));
    const prodConv = (await messageInbox(prisma, sProducer)).requestConversations;
    ok('a producer: only their own accounts\' requests', prodConv.length === 1 && prodConv[0].taskId === t1.id);
    const amConv = (await messageInbox(prisma, sAm)).requestConversations.filter((c) => c.taskId === t1.id || c.taskId === t2.id);
    ok('staff see who wrote it, and the agency', amConv.length === 2 && amConv[0].author === `${TAG}va` && amConv[0].agencyName === `${TAG} Harbor`);
    ok('staff could read internal notes, but this lists shared ones only', amConv[0].snippet === 'Sent to the holder this morning.');
    ok('another AM sees none of them', !(await messageInbox(prisma, sOther)).requestConversations.some((c) => c.taskId === t1.id || c.taskId === t2.id));

    console.log('The real routes');
    const [tOwner, tAm, tVa, tProducer] = await Promise.all([owner, am, va, producer].map((u) => createSession(u.id)));
    const ctx = (agencyId: string) => ({ params: Promise.resolve({ agencyId }) });
    const inbox = await inboxRoute(req('/api/desk/messages', tAm));
    ok('inbox: 200', inbox.status === 200 && ((await inbox.json()) as Json).threads.length === 2);
    ok('inbox: a VA, 404; signed out, 401', (await inboxRoute(req('/api/desk/messages', tVa))).status === 404 && (await inboxRoute(req('/api/desk/messages'))).status === 401);
    const sent = await sendRoute(req(`/api/desk/messages/${A.id}`, tOwner, { body: 'Through the route.' }), ctx(A.id));
    ok('send: 201', sent.status === 201 && ((await sent.json()) as Json).body === 'Through the route.');
    ok('send: not JSON, 400', (await sendRoute(req(`/api/desk/messages/${A.id}`, tOwner, 'nope'), ctx(A.id))).status === 400);
    ok('send: a password, 400', (await sendRoute(req(`/api/desk/messages/${A.id}`, tOwner, { body: 'password: x1' }), ctx(A.id))).status === 400);
    ok('send: a producer, 404', (await sendRoute(req(`/api/desk/messages/${A.id}`, tProducer, { body: 'hi' }), ctx(A.id))).status === 404);
    const thread = await threadRoute(req(`/api/desk/messages/${A.id}`, tAm), ctx(A.id));
    ok('read: 200, the latest at the end', thread.status === 200 && ((await thread.json()) as Json).messages.at(-1).body === 'Through the route.');
    ok('read: another agency\'s owner, 404', (await threadRoute(req(`/api/desk/messages/${A.id}`, await createSession(ownerB.id)), ctx(A.id))).status === 404);

    console.log('The screens');
    const screen = read('app/components/desk/messages/Messages.tsx');
    ok('never asks for passwords', screen.includes('Never send passwords or carrier logins here.'));
    ok('a producer is told where to ask instead', screen.includes('To ask about one of your requests, add a note on its page.'));
    ok('requests open on the right side\'s page', screen.includes("mode === 'agency' ? `/desk/requests/${taskId}` : `/desk-ops/tasks/${taskId}`"));
    ok('the agency page links to its conversation', read('app/components/desk/agencies/AgencyDetail.tsx').includes('href={`/desk-ops/messages?agency=${summary.id}`}'));
    ok('both pages are the Messages items\'', read('app/(desk)/desk/messages/page.tsx').includes("deskPageAccess('AGENCY', '/desk/messages')") && read('app/(desk)/desk-ops/messages/page.tsx').includes("deskPageAccess('OPS', '/desk-ops/messages')"));
  } catch (err) {
    fail++;
    console.error(err);
  } finally {
    await wipe();
    const left = await prisma.deskMessage.count({ where: { agencyId: { in: cleanup.agencyIds } } }) + await prisma.user.count({ where: { email: { startsWith: TAG } } }) + await prisma.task.count({ where: { title: { startsWith: TAG } } });
    ok('nothing left behind', left === 0);
    await prisma.$disconnect();
    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
  }
})();
