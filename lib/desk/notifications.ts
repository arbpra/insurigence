/**
 * Desk notification emails (Module 37).
 *
 *  - New request from an agency → its Account Manager.
 *  - Assigned → the person it was given to (not when they picked it up themselves).
 *  - Needs attention (waiting on the agency) → the agency.
 *  - Completed → the agency.
 *  - The agency replied on a request → whoever has it, else its Account Manager.
 *  - New message in an agency's conversation → the other side, once until
 *    they open the conversation.
 * When no Account Manager can be reached, the Operations Managers are told instead.
 *  - Escalated by hand → the Operations Managers and the task's Account Manager (Module 41).
 *  - The escalation ladder (Module 41, lib/desk/alerts.ts): due soon and
 *    overdue → the Account Manager; long overdue → the Operations Managers.
 *
 * Who is told is worked out again at sending time, through the same access
 * rules as everything else (lib/desk/access.ts): an email goes only to an
 * active person who could open the request or the conversation themselves,
 * and never to the person who made the change. On the agency side that's
 * whoever filed the request; when they can't be told (staff filed it, or they
 * have left), the agency's owners and admins.
 *
 * Emails carry no request text, account names, notes or messages (Q4), and
 * never a due date (Q5: targets are internal). They say what happened and
 * link to The Desk.
 *
 * Sending never fails the change that caused it: the change is already
 * saved. Each email is recorded in DeskNotification (who, about what, and
 * whether it went), which is also how a skipped or failed email is seen.
 *
 * DESK_EMAIL_NOTIFICATIONS=off turns them off entirely (nothing sent or
 * recorded), e.g. for a test or staging copy that shares real data.
 */
import type { DeskMessageSide, DeskNotificationEvent, PrismaClient, Task } from '@prisma/client';
import { APP_URL } from '@/lib/email/client';
import { sendEmail } from '@/lib/email/send';
import { deskNotificationEmail } from '@/lib/email/templates';
import { resolveDeskScope, taskWhere, type DeskScope } from './access';
import { sideFor } from './message-view';
import { coverRunning } from './supervision-reach';
import { TASK_TYPE_LABELS } from './service-levels';

type Db = PrismaClient;
type Sender = typeof sendEmail;
type NotifiableTask = Pick<Task, 'id' | 'reference' | 'agencyId' | 'type' | 'status' | 'source' | 'createdById' | 'amId' | 'assigneeId' | 'parentTaskId'>;

interface Person { id: string; email: string; firstName: string | null; lastName: string | null }
const PERSON = { id: true, email: true, firstName: true, lastName: true } as const;
const nameOf = (p: Pick<Person, 'firstName' | 'lastName' | 'email'>) => [p.firstName, p.lastName].filter(Boolean).join(' ') || p.email;

/** Provider reasons are kept short; they never hold content. */
const ERROR_MAX = 300;

let senderOverride: Sender | null = null;
/** Replaces the email sender, for tests only; null restores the real one. */
export function setNotificationSender(send: Sender | null): void {
  senderOverride = send;
}

const staffTaskUrl = (taskId: string) => `${APP_URL}/desk-ops/tasks/${taskId}`;
const agencyRequestUrl = (taskId: string) => `${APP_URL}/desk/requests/${taskId}`;

interface Content { headline: string; detail: string; actionUrl: string; actionLabel: string }
interface Notification { event: DeskNotificationEvent; agencyId: string; taskId?: string; messageId?: string }

/** Sends one email per person and records each outcome. Never throws. */
async function deliver(db: Db, n: Notification, people: Person[], content: (p: Person) => Content): Promise<void> {
  const send = senderOverride ?? sendEmail;
  await Promise.all(people.map(async (person) => {
    const email = deskNotificationEmail({ recipientName: person.firstName, ...content(person) });
    let result: Awaited<ReturnType<Sender>>;
    try {
      result = await send({ to: person.email, subject: email.subject, html: email.html, text: email.text });
    } catch (err) {
      result = { ok: false, error: err instanceof Error ? err.message : 'Email send failed.' };
    }
    try {
      await db.deskNotification.create({
        data: {
          event: n.event, recipientId: person.id, agencyId: n.agencyId, taskId: n.taskId ?? null, messageId: n.messageId ?? null,
          status: result.ok ? 'SENT' : result.skipped ? 'SKIPPED' : 'FAILED',
          error: result.ok ? null : (result.error ?? 'Email send failed.').slice(0, ERROR_MAX),
          providerId: result.id ?? null,
        },
      });
    } catch (err) {
      console.error('[desk/notifications] could not record a notification', err);
    }
  }));
}

export const notificationsOff = () => process.env.DESK_EMAIL_NOTIFICATIONS?.trim().toLowerCase() === 'off';

/** Runs a notification without ever failing the caller. */
async function safely(what: string, fn: () => Promise<void>): Promise<void> {
  if (notificationsOff()) return;
  try {
    await fn();
  } catch (err) {
    console.error(`[desk/notifications] ${what} failed`, err);
  }
}

/**
 * Active people, other than the one who acted, who pass the check. Order kept.
 * Anyone covering one of them today (Module 50) comes right after them.
 */
async function eligible(db: Db, ids: (string | null | undefined)[], actorId: string, check: (scope: DeskScope) => Promise<boolean> | boolean): Promise<Person[]> {
  const named = [...new Set(ids.filter((id): id is string => !!id))];
  const covers = named.length
    ? await db.deskCoverage.findMany({ where: { absentUserId: { in: named }, ...coverRunning(new Date()) }, select: { absentUserId: true, coverUserId: true } })
    : [];
  const withCover = named.flatMap((id) => [id, ...covers.filter((c) => c.absentUserId === id).map((c) => c.coverUserId)]);
  const wanted = [...new Set(withCover.filter((id) => id !== actorId))];
  if (!wanted.length) return [];
  const people = await db.user.findMany({ where: { id: { in: wanted }, isActive: true }, select: PERSON });
  const byId = new Map(people.map((p) => [p.id, p]));
  const ok = await Promise.all(wanted.map(async (id) => byId.has(id) && check(await resolveDeskScope(db, id))));
  return wanted.filter((_, i) => ok[i]).map((id) => byId.get(id)!);
}

/** Could this person open the task themselves? */
const canOpen = (db: Db, taskId: string) => async (scope: DeskScope) =>
  scope.kind !== 'NONE' && (await db.task.count({ where: { AND: [{ id: taskId }, taskWhere(scope)] } })) > 0;

const operationsManagerIds = async (db: Db) =>
  (await db.user.findMany({ where: { role: 'DESK_ADMIN', isActive: true }, select: { id: true } })).map((u) => u.id);

/** The first group with anyone who can be told; Operations Managers when none can. */
async function firstReachable(db: Db, groups: (string | null | undefined)[][], actorId: string, check: (scope: DeskScope) => Promise<boolean> | boolean) {
  for (const ids of groups) {
    const people = await eligible(db, ids, actorId, check);
    if (people.length) return people;
  }
  return eligible(db, await operationsManagerIds(db), actorId, check);
}

/** On the agency side: whoever filed the request, else the agency's owners and admins. */
async function agencyRecipients(db: Db, task: NotifiableTask, actorId: string): Promise<Person[]> {
  const open = canOpen(db, task.id);
  const asAgency = async (scope: DeskScope) => scope.kind === 'AGENCY' && scope.agencyId === task.agencyId && open(scope);
  const filer = await eligible(db, [task.createdById], actorId, asAgency);
  if (filer.length) return filer;
  const admins = await db.user.findMany({ where: { agencyId: task.agencyId, role: 'ADMIN', isActive: true }, select: { id: true } });
  return eligible(db, admins.map((a) => a.id), actorId, asAgency);
}

const agencyName = async (db: Db, agencyId: string) =>
  (await db.agency.findUnique({ where: { id: agencyId }, select: { name: true } }))?.name ?? 'An agency';

// ── Requests ──

/** A request the agency sent: tell its Account Manager. Requests filed by staff aren't announced. */
export async function notifyTaskCreated(db: Db, task: NotifiableTask, actorId: string): Promise<void> {
  if (task.source !== 'AGENCY') return;
  await safely('new request', async () => {
    const people = await firstReachable(db, [[task.amId]], actorId, canOpen(db, task.id));
    if (!people.length) return;
    const agency = await agencyName(db, task.agencyId);
    await deliver(db, { event: 'REQUEST_RECEIVED', agencyId: task.agencyId, taskId: task.id }, people, () => ({
      headline: `New request #${task.reference} from ${agency}`,
      detail: `${agency} sent a new request (${TASK_TYPE_LABELS[task.type]}).`,
      actionUrl: staffTaskUrl(task.id), actionLabel: 'Open the request',
    }));
  });
}

/** Assigned to someone other than the person who did it. */
export async function notifyTaskAssigned(db: Db, task: NotifiableTask, actorId: string): Promise<void> {
  if (!task.assigneeId || task.assigneeId === actorId) return;
  await safely('assignment', async () => {
    const people = await eligible(db, [task.assigneeId], actorId, canOpen(db, task.id));
    if (!people.length) return;
    const [agency, actor] = await Promise.all([
      agencyName(db, task.agencyId),
      db.user.findUnique({ where: { id: actorId }, select: PERSON }),
    ]);
    await deliver(db, { event: 'TASK_ASSIGNED', agencyId: task.agencyId, taskId: task.id }, people, () => ({
      headline: `Request #${task.reference} is assigned to you`,
      detail: `${actor ? nameOf(actor) : 'Your Account Manager'} assigned you a request for ${agency} (${TASK_TYPE_LABELS[task.type]}).`,
      actionUrl: staffTaskUrl(task.id), actionLabel: 'Open the request',
    }));
  });
}

/**
 * After a status change: the agency is told when a request needs them
 * (waiting on the agency) and when it's completed. Only requests the agency
 * sees (not a task's subtasks).
 */
export async function notifyStatusChanged(db: Db, task: NotifiableTask, actorId: string): Promise<void> {
  if (task.parentTaskId) return;
  const event: DeskNotificationEvent | null =
    task.status === 'WAITING_ON_AGENCY' ? 'NEEDS_ATTENTION' : task.status === 'COMPLETED' ? 'REQUEST_COMPLETED' : null;
  if (!event) return;
  await safely('status change', async () => {
    const people = await agencyRecipients(db, task, actorId);
    if (!people.length) return;
    const type = TASK_TYPE_LABELS[task.type];
    await deliver(db, { event, agencyId: task.agencyId, taskId: task.id }, people, () => (event === 'NEEDS_ATTENTION'
      ? {
          headline: `Request #${task.reference} needs your attention`,
          detail: `Your Desk team needs something from you to continue your request (${type}). Reply on the request's page.`,
          actionUrl: agencyRequestUrl(task.id), actionLabel: "See what's needed",
        }
      : {
          headline: `Request #${task.reference} is complete`,
          detail: `Your Desk team has completed your request (${type}).`,
          actionUrl: agencyRequestUrl(task.id), actionLabel: 'View the request',
        }));
  });
}

/** The agency added a note on a request: tell whoever has it, else its Account Manager. */
export async function notifyAgencyNote(db: Db, task: NotifiableTask, actorId: string, resumed: boolean): Promise<void> {
  await safely('agency reply', async () => {
    const people = await firstReachable(db, [[task.assigneeId], [task.amId]], actorId, async (scope) =>
      scope.kind !== 'AGENCY' && canOpen(db, task.id)(scope));
    if (!people.length) return;
    const agency = await agencyName(db, task.agencyId);
    await deliver(db, { event: 'AGENCY_REPLIED', agencyId: task.agencyId, taskId: task.id }, people, () => ({
      headline: `${agency} replied on request #${task.reference}`,
      detail: `There's a new note from ${agency} on a request (${TASK_TYPE_LABELS[task.type]}).${resumed ? " It was waiting on them, so it's back in progress." : ''}`,
      actionUrl: staffTaskUrl(task.id), actionLabel: 'Open the request',
    }));
  });
}

// ── Messages ──

/**
 * A new message in an agency's conversation: the other side is told, once
 * until they open the conversation. Further messages before then don't send
 * another email.
 */
export async function notifyMessage(
  db: Db, message: { id: string; agencyId: string; side: DeskMessageSide; authorId: string }
): Promise<void> {
  await safely('message', async () => {
    const other: DeskMessageSide = message.side === 'AGENCY' ? 'DESK' : 'AGENCY';
    const takesPart = (scope: DeskScope) => sideFor(scope, message.agencyId) === other;
    let people: Person[];
    if (other === 'AGENCY') {
      const members = await db.user.findMany({ where: { agencyId: message.agencyId, isActive: true }, select: { id: true } });
      people = await eligible(db, members.map((m) => m.id), message.authorId, takesPart);
    } else {
      const desk = await db.agencyDeskAssignment.findUnique({ where: { agencyId: message.agencyId }, select: { primaryAmId: true, backupAmId: true } });
      people = await firstReachable(db, [[desk?.primaryAmId, desk?.backupAmId]], message.authorId, takesPart);
    }
    if (!people.length) return;

    // Only those with nothing unread from this side yet.
    const reads = await db.deskMessageRead.findMany({
      where: { agencyId: message.agencyId, userId: { in: people.map((p) => p.id) } }, select: { userId: true, lastReadAt: true },
    });
    const since = new Map(reads.map((r) => [r.userId, r.lastReadAt]));
    const earlier = await Promise.all(people.map((p) => db.deskMessage.count({
      where: {
        agencyId: message.agencyId, side: message.side, id: { not: message.id },
        ...(since.has(p.id) ? { createdAt: { gt: since.get(p.id)! } } : {}),
      },
    })));
    people = people.filter((_, i) => earlier[i] === 0);
    if (!people.length) return;

    const agency = other === 'DESK' ? await agencyName(db, message.agencyId) : '';
    await deliver(db, { event: 'MESSAGE_RECEIVED', agencyId: message.agencyId, messageId: message.id }, people, () => (other === 'AGENCY'
      ? {
          headline: 'New message from your Desk team',
          detail: 'Your Desk team sent you a message in The Desk.',
          actionUrl: `${APP_URL}/desk/messages`, actionLabel: 'Read the message',
        }
      : {
          headline: `New message from ${agency}`,
          detail: `${agency} sent your Desk team a message.`,
          actionUrl: `${APP_URL}/desk-ops/messages?agency=${message.agencyId}`, actionLabel: 'Read the message',
        }));
  });
}

// ── Escalation (Module 41) ──

/** Escalated by hand: the Operations Managers and the task's Account Manager, other than whoever did it. */
export async function notifyEscalated(db: Db, task: NotifiableTask & { escalated: boolean }, actorId: string): Promise<void> {
  if (!task.escalated) return;
  await safely('escalation', async () => {
    const people = await eligible(db, [...(await operationsManagerIds(db)), task.amId], actorId, canOpen(db, task.id));
    if (!people.length) return;
    const [agency, actor] = await Promise.all([agencyName(db, task.agencyId), db.user.findUnique({ where: { id: actorId }, select: PERSON })]);
    await deliver(db, { event: 'TASK_ESCALATED', agencyId: task.agencyId, taskId: task.id }, people, () => ({
      headline: `Request #${task.reference} was escalated`,
      detail: `${actor ? nameOf(actor) : 'Someone'} escalated a request for ${agency} (${TASK_TYPE_LABELS[task.type]}). The reason is on the request.`,
      actionUrl: staffTaskUrl(task.id), actionLabel: 'Open the request',
    }));
  });
}

export type AlertRung = 1 | 2 | 3;

/** The task's Account Manager, else the agency's, else the Operations Managers. */
async function accountManagers(db: Db, task: NotifiableTask, open: (scope: DeskScope) => Promise<boolean>) {
  const desk = await db.agencyDeskAssignment.findUnique({ where: { agencyId: task.agencyId }, select: { primaryAmId: true, backupAmId: true } });
  return firstReachable(db, [[task.amId], [desk?.primaryAmId, desk?.backupAmId]], '', open);
}

/**
 * One rung of the ladder (lib/desk/alerts.ts). Due soon and overdue go to the
 * Account Manager; escalated goes to the Operations Managers, and to the
 * Account Manager too when they weren't told it was overdue. Returns how
 * many people it was sent to (0 when notifications are off). Never throws.
 */
export async function sendAlert(db: Db, task: NotifiableTask, rung: AlertRung, opts: { alsoAccountManager?: boolean; soonHours: number; overdueHours: number }): Promise<number> {
  if (notificationsOff()) return 0;
  try {
    const open = canOpen(db, task.id);
    let people: Person[];
    if (rung < 3) people = await accountManagers(db, task, open);
    else {
      people = await eligible(db, await operationsManagerIds(db), '', open);
      if (opts.alsoAccountManager || !people.length) {
        const seen = new Set(people.map((p) => p.id));
        people = [...people, ...(await accountManagers(db, task, open)).filter((p) => !seen.has(p.id))];
      }
    }
    if (!people.length) return 0;
    const agency = await agencyName(db, task.agencyId);
    const what = `a request for ${agency} (${TASK_TYPE_LABELS[task.type]})`;
    const event: DeskNotificationEvent = rung === 1 ? 'TASK_DUE_SOON' : rung === 2 ? 'TASK_OVERDUE' : 'TASK_ESCALATED';
    await deliver(db, { event, agencyId: task.agencyId, taskId: task.id }, people, () => (rung === 1
      ? { headline: `Request #${task.reference} is due soon`, detail: `${what[0].toUpperCase()}${what.slice(1)} reaches its internal target within ${opts.soonHours} business hours and isn't done yet.`, actionUrl: staffTaskUrl(task.id), actionLabel: 'Open the request' }
      : rung === 2
        ? { headline: `Request #${task.reference} is overdue`, detail: `${what[0].toUpperCase()}${what.slice(1)} has passed its internal target and isn't done yet.`, actionUrl: staffTaskUrl(task.id), actionLabel: 'Open the request' }
        : { headline: `Request #${task.reference} is escalated: overdue`, detail: `${what[0].toUpperCase()}${what.slice(1)} is more than ${opts.overdueHours} business hours past its internal target and isn't done yet, so it has been escalated to the Operations Managers.`, actionUrl: staffTaskUrl(task.id), actionLabel: 'Open the request' }));
    return people.length;
  } catch (err) {
    console.error('[desk/notifications] alert failed', err);
    return 0;
  }
}
