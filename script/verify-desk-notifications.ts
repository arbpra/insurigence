/**
 * Module 37: email notifications.
 *
 *   npx tsx script/verify-desk-notifications.ts
 *
 * Who is emailed for a new request, an assignment, a request needing the
 * agency, a completed request, an agency reply and a new message, and who
 * isn't (the person who acted, people who can't open it, people who have
 * left, producers outside the conversation); the fall-back to owners and
 * admins, and to Operations Managers; once per unread conversation; nothing
 * private in an email; a failed or skipped email recorded and never failing
 * the change; the off switch; the real route. Against the shared database,
 * with temporary agencies, people and requests, all removed at the end.
 * No email is sent: a stand-in sender takes them.
 */
import 'dotenv/config';
import { NextRequest } from 'next/server';
import type { UserRole } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { createSession } from '../lib/auth';
import { resolveDeskScope, type DeskScope } from '../lib/desk/access';
import { postTaskNote, setTaskAssignee, setTaskStatus, submitTask } from '../lib/desk/task-api';
import { readThread, sendMessage } from '../lib/desk/messages';
import { notifyStatusChanged, setNotificationSender } from '../lib/desk/notifications';
import { deskNotificationEmail } from '../lib/email/templates';
import { POST as tasksRoute } from '../app/api/desk/tasks/route';

// Belt and braces: nothing here may reach a real inbox.
process.env.RESEND_API_KEY = '';
delete process.env.DESK_EMAIL_NOTIFICATIONS;

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, detail = '') => {
  c ? pass++ : fail++;
  console.log(`  ${c ? '✓' : '✗'} ${n}${!c && detail ? `  [${detail}]` : ''}`);
  if (!c && process.env.FAIL_FAST) throw new Error(`stopped at: ${n}`);
};

const TAG = `m37test${Date.now()}`;
const cleanup = { agencyIds: [] as string[], userIds: [] as string[], podIds: [] as string[] };
type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any

interface Mail { to: string; subject: string; html: string; text?: string }
const outbox: Mail[] = [];
const archive: Mail[] = [];
let senderMode: 'ok' | 'fail' | 'throw' | 'skip' = 'ok';
setNotificationSender(async (p) => {
  outbox.push(p); archive.push(p);
  if (senderMode === 'throw') throw new Error('provider down');
  if (senderMode === 'fail') return { ok: false, error: 'rejected by provider' };
  if (senderMode === 'skip') return { ok: false, skipped: true, error: 'Email is not configured.' };
  return { ok: true, id: `stub-${outbox.length}` };
});
const take = () => outbox.splice(0, outbox.length);
const to = (mails: Mail[]) => mails.map((m) => m.to).sort();

async function wipe() {
  const agencyId = { in: cleanup.agencyIds };
  await prisma.deskNotification.deleteMany({ where: { OR: [{ agencyId }, { recipientId: { in: cleanup.userIds } }] } });
  await prisma.deskMessage.deleteMany({ where: { agencyId } });
  await prisma.deskMessageRead.deleteMany({ where: { OR: [{ agencyId }, { userId: { in: cleanup.userIds } }] } });
  await prisma.taskEvent.deleteMany({ where: { agencyId } });
  // Subtasks first: a parent can't go while it has them.
  await prisma.task.deleteMany({ where: { agencyId, parentTaskId: { not: null } } });
  await prisma.task.deleteMany({ where: { agencyId } });
  await prisma.agencyPodAccess.deleteMany({ where: { OR: [{ agencyId }, { podId: { in: cleanup.podIds } }] } });
  await prisma.podMember.deleteMany({ where: { podId: { in: cleanup.podIds } } });
  await prisma.pod.deleteMany({ where: { id: { in: cleanup.podIds } } });
  await prisma.agencyDeskAssignment.deleteMany({ where: { agencyId } });
  await prisma.deskAuditLog.deleteMany({ where: { OR: [{ agencyId }, { actorId: { in: cleanup.userIds } }] } });
  await prisma.session.deleteMany({ where: { userId: { in: cleanup.userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: cleanup.userIds } } });
  await prisma.agency.deleteMany({ where: { id: agencyId } });
}

function template() {
  console.log('The email');
  const e = deskNotificationEmail({ recipientName: 'Sam <b>', headline: 'Request #12 is complete', detail: 'Done & dusted.', actionUrl: 'https://x.test/desk/requests/1', actionLabel: 'View the request' });
  ok('subject is the headline', e.subject === 'Request #12 is complete');
  ok('names are escaped in the html', e.html.includes('Hi Sam &lt;b&gt;') && e.html.includes('Done &amp; dusted.'));
  ok('the link and the security note, in html and text', e.html.includes('href="https://x.test/desk/requests/1"') && e.text.includes('View the request: https://x.test/desk/requests/1')
    && e.text.includes("For your security, they aren't included in this email."));
}

(async () => {
  try {
    template();

    const mkAgency = async (n: string) => { const a = await prisma.agency.create({ data: { name: `${TAG} ${n}`, deskEnabled: true } }); cleanup.agencyIds.push(a.id); return a; };
    const mkUser = async (n: string, role: UserRole, agencyId: string | null = null, extra: object = {}) => {
      const u = await prisma.user.create({ data: { email: `${TAG}-${n}@example.test`, role, agencyId, firstName: `${TAG}${n}`, lastName: 'Q', passwordHash: 'x', mustChangePassword: false, ...extra } });
      cleanup.userIds.push(u.id); return u;
    };
    const A = await mkAgency('Harbor');
    const D = await mkAgency('No AM');
    const owner = await mkUser('owner', 'ADMIN', A.id);
    const admin2 = await mkUser('admin2', 'ADMIN', A.id);
    const formerAdmin = await mkUser('formeradmin', 'ADMIN', A.id, { isActive: false });
    const producer = await mkUser('producer', 'AGENT', A.id);
    const csr = await mkUser('csr', 'CSR', A.id, { bookAccess: 'ALL' });
    const ownerD = await mkUser('ownerd', 'ADMIN', D.id);
    const am = await mkUser('am', 'ACCOUNT_MANAGER');
    const backup = await mkUser('backup', 'ACCOUNT_MANAGER');
    const otherAm = await mkUser('otheram', 'ACCOUNT_MANAGER');
    const ops = await mkUser('ops', 'DESK_ADMIN');
    const va = await mkUser('va', 'DESK_VA');
    const va2 = await mkUser('va2', 'DESK_VA');
    await prisma.agencyDeskAssignment.create({ data: { agencyId: A.id, primaryAmId: am.id, backupAmId: backup.id } });
    const pod = await prisma.pod.create({ data: { code: TAG, name: `${TAG} Pod` } }); cleanup.podIds.push(pod.id);
    await prisma.podMember.createMany({ data: [{ podId: pod.id, userId: va.id }, { podId: pod.id, userId: va2.id }] });
    await prisma.agencyPodAccess.create({ data: { agencyId: A.id, podId: pod.id } });
    const mail = (u: { email: string }) => u.email;
    const scope = (u: { id: string }) => resolveDeskScope(prisma, u.id);
    const [sOwner, sProducer, sAm, sVa, sOwnerD, sOps, sCsr] = await Promise.all([owner, producer, am, va, ownerD, ops, csr].map(scope));

    const file = async (s: DeskScope, title: string, extra: object = {}) => {
      const view = await submitTask(prisma, s, { type: 'COI', title: `${TAG} ${title}`, description: `${TAG} secret details for ${title}`, ...extra }) as Json;
      // Into our pod, so our VAs can work it whatever the shared routing rules say.
      await prisma.task.update({ where: { id: view.id }, data: { podId: pod.id } });
      return view.id as string;
    };
    const rows = (taskId: string) => prisma.deskNotification.findMany({ where: { taskId }, orderBy: { createdAt: 'asc' } });

    console.log('New request');
    take();
    const t1 = await file(sOwner, 'Owner request');
    let got = take();
    const t1Row = await prisma.task.findUniqueOrThrow({ where: { id: t1 } });
    ok('the agency\'s Account Manager is emailed, only them', to(got).join() === mail(am), to(got).join());
    ok('it names the agency and the request number', got[0]?.subject === `New request #${t1Row.reference} from ${TAG} Harbor`);
    ok('it links to the staff workspace', got[0]?.html.includes(`/desk-ops/tasks/${t1}`));
    ok('recorded: who, about what, sent', (await rows(t1)).map((r) => `${r.event}:${r.recipientId}:${r.status}:${r.providerId}`).join() === `REQUEST_RECEIVED:${am.id}:SENT:stub-1`);
    await file(sAm, 'Filed by the AM', { agencyId: A.id });
    ok('a request staff filed: nobody is emailed', take().length === 0);
    await file(sOwnerD, 'No AM agency');
    got = take();
    const opsIds = (await prisma.user.findMany({ where: { role: 'DESK_ADMIN', isActive: true }, select: { email: true } })).map((u) => u.email);
    ok('an agency with no Account Manager: the Operations Managers', to(got).includes(mail(ops)) && got.every((m) => opsIds.includes(m.to)), to(got).join());

    console.log('Assigned');
    await setTaskAssignee(prisma, sAm, t1, { assigneeId: va.id });
    got = take();
    ok('the VA it was given to is emailed', to(got).join() === mail(va));
    ok('by whom, and for which agency', got[0]?.subject === `Request #${t1Row.reference} is assigned to you` && got[0]?.text?.includes(`${TAG}am Q assigned you a request for ${TAG} Harbor`), got[0]?.text);
    const t2 = await file(sProducer, 'Producer request');
    take();
    await setTaskAssignee(prisma, sVa, t2, { assigneeId: va.id });
    ok('picking it up yourself: no email', take().length === 0);
    await setTaskAssignee(prisma, sAm, t2, { assigneeId: am.id });
    got = take();
    ok('reassigned by the AM to themselves: no email', got.length === 0, to(got).join());
    await setTaskAssignee(prisma, sAm, t2, { assigneeId: null });
    ok('unassigned: no email', take().length === 0);

    console.log('Needs attention, and the reply');
    await setTaskAssignee(prisma, sAm, t2, { assigneeId: va.id }); take();
    await setTaskStatus(prisma, sVa, t2, { status: 'IN_PROGRESS' });
    ok('a status the agency doesn\'t act on: no email', take().length === 0);
    await setTaskStatus(prisma, sVa, t2, { status: 'WAITING_ON_CARRIER', reason: 'carrier' });
    await setTaskStatus(prisma, sVa, t2, { status: 'IN_PROGRESS' });
    ok('waiting on the carrier, and back: no email', take().length === 0);
    await setTaskStatus(prisma, sVa, t2, { status: 'WAITING_ON_AGENCY', reason: `${TAG} which driver is this for?` });
    got = take();
    const t2Row = await prisma.task.findUniqueOrThrow({ where: { id: t2 } });
    ok('the producer who filed it is emailed, not the owners', to(got).join() === mail(producer), to(got).join());
    ok('"needs your attention", linking to the agency\'s request page', got[0]?.subject === `Request #${t2Row.reference} needs your attention` && got[0]?.html.includes(`/desk/requests/${t2}`));
    // Every event skips the person who acted before asking who to tell; the shared check holds on its own too.
    await notifyStatusChanged(prisma, await prisma.task.findUniqueOrThrow({ where: { id: t2 } }), producer.id);
    got = take();
    ok('whatever the event, the person who made the change is never emailed', got.length > 0 && !to(got).includes(mail(producer)), to(got).join());
    await postTaskNote(prisma, sProducer, t2, { body: `${TAG} it is for Dana` });
    got = take();
    ok('the agency replies: the VA who has it is emailed', to(got).join() === mail(va), to(got).join());
    ok('and told it\'s back in progress', got[0]?.text?.includes("It was waiting on them, so it's back in progress.") && got[0]?.subject === `${TAG} Harbor replied on request #${t2Row.reference}`);
    await postTaskNote(prisma, sVa, t2, { body: `${TAG} thanks`, visibility: 'AGENCY' });
    ok('a staff note: no email', take().length === 0);

    const t3 = await file(sAm, 'Staff filed, waits', { agencyId: A.id });
    take();
    await setTaskStatus(prisma, sAm, t3, { status: 'WAITING_ON_AGENCY', reason: 'Need the holder' });
    got = take();
    ok('filed by staff: the agency\'s active owners and admins', to(got).join() === [mail(owner), mail(admin2)].sort().join() && !to(got).includes(mail(formerAdmin)), to(got).join());
    const t9 = await file(sAm, 'Staff filed, VA asks', { agencyId: A.id });
    await setTaskAssignee(prisma, sAm, t9, { assigneeId: va.id });
    await setTaskStatus(prisma, sVa, t9, { status: 'IN_PROGRESS' });
    take();
    await setTaskStatus(prisma, sVa, t9, { status: 'WAITING_ON_AGENCY', reason: 'Need the VIN' });
    got = take();
    ok('the Account Manager who filed it isn\'t "the agency": its owners and admins', to(got).join() === [mail(owner), mail(admin2)].sort().join(), to(got).join());
    await postTaskNote(prisma, sOwner, t3, { body: 'Holder is ABC' });
    got = take();
    ok('a reply on an unassigned request: its Account Manager', to(got).join() === mail(am), to(got).join());

    console.log('Completed');
    await setTaskStatus(prisma, sVa, t2, { status: 'COMPLETED' });
    got = take();
    ok('the filer is told it\'s complete', to(got).join() === mail(producer) && got[0]?.subject === `Request #${t2Row.reference} is complete`);
    await prisma.user.update({ where: { id: producer.id }, data: { isActive: false } });
    await setTaskStatus(prisma, sAm, t2, { status: 'IN_PROGRESS', reason: 'One more change' });
    take();
    await setTaskStatus(prisma, sAm, t2, { status: 'COMPLETED' });
    got = take();
    ok('the filer has left: the owners and admins instead', to(got).join() === [mail(owner), mail(admin2)].sort().join(), to(got).join());
    await prisma.user.update({ where: { id: producer.id }, data: { isActive: true } });

    const sub = await file(sAm, 'A subtask', { agencyId: A.id });
    await prisma.task.update({ where: { id: sub }, data: { parentTaskId: t1 } });
    take();
    await setTaskStatus(prisma, sAm, sub, { status: 'WAITING_ON_AGENCY', reason: 'x' });
    ok('a subtask: the agency isn\'t emailed', take().length === 0);

    console.log('Only people who can open it');
    const t4 = await file(sOwner, 'Restricted');
    take();
    await prisma.task.update({ where: { id: t4 }, data: { restrictedToUserIds: [va2.id] } });
    await setTaskAssignee(prisma, sAm, t4, { assigneeId: va2.id });
    ok('restricted to one VA: that VA can be told', to(take()).join() === mail(va2));
    await prisma.task.update({ where: { id: t4 }, data: { restrictedToUserIds: [va.id] } });
    await postTaskNote(prisma, sOwner, t4, { body: 'note' });
    got = take();
    ok('the assignee can no longer open it: falls back to the AM', to(got).join() === mail(am), to(got).join());
    await prisma.user.update({ where: { id: am.id }, data: { isActive: false } });
    await prisma.user.update({ where: { id: backup.id }, data: { isActive: false } });
    await postTaskNote(prisma, sOwner, t4, { body: 'note again' });
    got = take();
    ok('its AM has left: the Operations Managers', to(got).includes(mail(ops)) && !to(got).includes(mail(am)) && got.every((m) => opsIds.includes(m.to)), to(got).join());
    await prisma.user.update({ where: { id: am.id }, data: { isActive: true } });
    await prisma.user.update({ where: { id: backup.id }, data: { isActive: true } });
    ok('another Account Manager is never told', !(await prisma.deskNotification.findMany({ where: { agencyId: A.id } })).some((r) => r.recipientId === otherAm.id));

    console.log('Messages');
    take();
    const m1 = await sendMessage(prisma, sOwner, A.id, { body: `${TAG} hello from Harbor` });
    got = take();
    ok('the agency writes: its primary and backup AMs', to(got).join() === [mail(am), mail(backup)].sort().join(), to(got).join());
    ok('"New message from" the agency, linking to its conversation', got[0]?.subject === `New message from ${TAG} Harbor` && got[0]?.html.includes(`/desk-ops/messages?agency=${A.id}`));
    ok('recorded against the message', (await prisma.deskNotification.count({ where: { messageId: m1.id, event: 'MESSAGE_RECEIVED' } })) === 2);
    await sendMessage(prisma, sCsr, A.id, { body: 'and another' });
    ok('another before they read it: no second email', take().length === 0);
    await readThread(prisma, sAm, A.id);
    await sendMessage(prisma, sOwner, A.id, { body: 'a third' });
    got = take();
    ok('once the AM has read it, the next one emails them again (not the backup, still unread)', to(got).join() === mail(am), to(got).join());
    await sendMessage(prisma, sAm, A.id, { body: `${TAG} hi from your AM` });
    got = take();
    ok('the AM writes: the agency\'s owners, admins and whole-book users (not the producer)', to(got).join() === [mail(owner), mail(admin2), mail(csr)].sort().join(), to(got).join());
    ok('"New message from your Desk team"', got[0]?.subject === 'New message from your Desk team' && got[0]?.html.includes('/desk/messages'));
    ok('the sender is never told', !to(got).includes(mail(am)));
    await sendMessage(prisma, sOps, A.id, { body: 'Ops here' });
    ok('more from the Desk before they read it: no email', take().length === 0);

    const everything = await prisma.deskNotification.count({ where: { agencyId: { in: [A.id, D.id] } } });
    ok('every email sent is recorded', everything === archive.length, `${everything} vs ${archive.length}`);

    console.log('Failures never fail the change');
    senderMode = 'fail';
    const t5 = await file(sOwner, 'Provider rejects');
    const r5 = await rows(t5);
    ok('rejected by the provider: the request is saved, the email FAILED with the reason', !!t5 && r5.length === 1 && r5[0].status === 'FAILED' && r5[0].error === 'rejected by provider');
    senderMode = 'throw';
    const t6 = await file(sOwner, 'Provider down');
    const r6 = await rows(t6);
    ok('the provider throws: still saved, FAILED', !!t6 && r6[0]?.status === 'FAILED' && r6[0].error === 'provider down');
    senderMode = 'skip';
    const t7 = await file(sOwner, 'Not configured');
    ok('email not configured: SKIPPED', (await rows(t7))[0]?.status === 'SKIPPED');
    senderMode = 'ok';

    console.log('The off switch');
    process.env.DESK_EMAIL_NOTIFICATIONS = 'off';
    take();
    const t8 = await file(sOwner, 'Switched off');
    ok('DESK_EMAIL_NOTIFICATIONS=off: nothing sent or recorded', take().length === 0 && (await rows(t8)).length === 0);
    delete process.env.DESK_EMAIL_NOTIFICATIONS;

    console.log('The real route');
    take();
    const token = await createSession(owner.id);
    const res = await tasksRoute(new NextRequest('http://local.test/api/desk/tasks', {
      method: 'POST', headers: { cookie: `session_token=${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'COI', title: `${TAG} via the route`, description: 'route secret' }),
    }));
    const routed = await res.json() as Json;
    ok('POST /api/desk/tasks: 201, and the AM emailed', res.status === 201 && to(take()).join() === mail(am) && (await rows(routed.id)).length === 1);

    console.log('Nothing private in any email');
    const words = ['secret details', 'route secret', 'Owner request', 'Producer request', 'which driver', 'it is for Dana', 'Holder is ABC', 'Need the holder', 'Need the VIN', 'Staff filed',
      'hello from Harbor', 'hi from your AM', 'and another', 'Ops here'];
    const leaked = words.filter((w) => archive.some((m) => `${m.subject}${m.html}${m.text}`.includes(w)));
    ok(`none of ${archive.length} emails holds a request title, details, a note, a reason or a message`, archive.length > 25 && !leaked.length, leaked.join());
    const agencyMails = archive.filter((m) => [owner, admin2, producer, csr, ownerD].some((u) => u.email === m.to));
    ok('no due date or target in what the agency is sent (Q5)', agencyMails.length > 5 && !agencyMails.some((m) => /\bdue\b|target|deadline/i.test(`${m.subject}${m.text}`)));
    ok('every email has a text version', archive.every((m) => !!m.text));
    const all = await prisma.deskNotification.findMany({ where: { agencyId: { in: [A.id, D.id] } } });
    ok('records hold no address, sent or failed', all.length === archive.length && all.some((r) => r.status === 'FAILED') && !JSON.stringify(all).includes('@'));
  } catch (err) {
    fail++;
    console.error(err);
  } finally {
    setNotificationSender(null);
    await wipe();
    const left = await prisma.deskNotification.count({ where: { agencyId: { in: cleanup.agencyIds } } })
      + await prisma.user.count({ where: { email: { startsWith: TAG } } }) + await prisma.task.count({ where: { title: { startsWith: TAG } } });
    ok('nothing left behind', left === 0);
    await prisma.$disconnect();
    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
  }
})();
