/**
 * Messaging (Module 36): each agency's general conversation with its Desk
 * team, and a list of the latest conversations on requests.
 *
 * Who takes part in an agency's general conversation:
 *  - the agency's owners and admins, and anyone with its whole book (a
 *    producer limited to their own accounts doesn't: the conversation can be
 *    about any account, Q4 need-to-know);
 *  - its primary and backup Account Managers, and Operations Managers.
 * VAs don't; they work from requests. Anyone else is refused as not found,
 * and logged.
 *
 * A conversation about one request is that request's shared notes (Module
 * 28); this lists the latest of them, through taskEventWhere, so each person
 * sees only requests they could open anyway.
 *
 * Credentials never go in a message (Q4): anything that looks like one is
 * refused. Reading and sending are logged, with facts only, never the text.
 */
import type { DeskMessageSide, PrismaClient } from '@prisma/client';
import { DeskAccessError, isObjectId, taskEventWhere, type DeskScope, type GuardContext } from './access';
import { recordAudit } from './audit';
import { looksLikeCredential } from './profile';
import { MESSAGE_MAX, THREAD_LIMIT, CONVERSATIONS_LIMIT, sideFor, snippet } from './message-view';
import { notifyMessage } from './notifications';

type Db = PrismaClient;
const TX_OPTIONS = { timeout: 20_000, maxWait: 10_000 };

const PERSON = { id: true, firstName: true, lastName: true, email: true, agencyId: true } as const;
type Person = { id: string; firstName: string | null; lastName: string | null; email: string; agencyId: string | null };
const nameOf = (p: Person) => [p.firstName, p.lastName].filter(Boolean).join(' ') || p.email;

async function refuse(db: Db, scope: DeskScope, agencyId: string | null, op: string, ctx: GuardContext): Promise<never> {
  await recordAudit(db, {
    actor: { id: scope.userId, role: scope.role }, action: 'access.denied', entityType: 'DeskMessage',
    entityId: null, agencyId: agencyId && isObjectId(agencyId) ? agencyId : null,
    metadata: { scope: scope.kind, op }, ip: ctx.ip, userAgent: ctx.userAgent,
  });
  throw new DeskAccessError(404, 'Not found.');
}

/** The agency, if this person may use its conversation; refused (and logged) otherwise. */
async function threadAgency(db: Db, scope: DeskScope, agencyId: string, op: string, ctx: GuardContext) {
  const side = isObjectId(agencyId) ? sideFor(scope, agencyId) : null;
  const agency = side ? await db.agency.findFirst({ where: { id: agencyId, deskEnabled: true }, select: { id: true, name: true } }) : null;
  if (!side || !agency) return refuse(db, scope, agencyId, op, ctx);
  return { agency, side };
}

/** Unread: messages from the other side since this person last read the conversation. */
async function unreadFor(db: Db, userId: string, side: DeskMessageSide, agencyIds: string[]) {
  if (!agencyIds.length) return new Map<string, number>();
  const reads = await db.deskMessageRead.findMany({ where: { userId, agencyId: { in: agencyIds } }, select: { agencyId: true, lastReadAt: true } });
  const since = new Map(reads.map((r) => [r.agencyId, r.lastReadAt]));
  const other: DeskMessageSide = side === 'AGENCY' ? 'DESK' : 'AGENCY';
  const counts = await Promise.all(agencyIds.map((agencyId) => db.deskMessage.count({
    where: { agencyId, side: other, ...(since.has(agencyId) ? { createdAt: { gt: since.get(agencyId)! } } : {}) },
  })));
  return new Map(agencyIds.map((id, i) => [id, counts[i]]));
}

/** How the author of a message is named to the reader. The agency knows its Account Managers by name. */
function authorLabel(author: Person | undefined, side: DeskMessageSide): string {
  if (!author) return side === 'DESK' ? 'Your Desk team' : 'Former user';
  return nameOf(author);
}

// ── The inbox ──

/**
 * What the Messages page opens on: the conversations this person takes part
 * in, each with its latest message and how many are unread, and the latest
 * conversations on requests.
 */
export async function messageInbox(db: Db, scope: DeskScope, ctx: GuardContext = {}) {
  if (scope.kind === 'VA' || scope.kind === 'NONE') await refuse(db, scope, null, 'inbox', ctx);

  let agencies: { id: string; name: string }[] = [];
  let canMessage = true;
  if (scope.kind === 'AGENCY') {
    canMessage = scope.book === 'ALL';
    agencies = canMessage ? await db.agency.findMany({ where: { id: scope.agencyId, deskEnabled: true }, select: { id: true, name: true } }) : [];
  } else {
    agencies = await db.agency.findMany({
      where: scope.kind === 'ACCOUNT_MANAGER' ? { id: { in: scope.agencyIds }, deskEnabled: true } : { deskEnabled: true },
      select: { id: true, name: true }, orderBy: { name: 'asc' },
    });
  }
  const side: DeskMessageSide = scope.kind === 'AGENCY' ? 'AGENCY' : 'DESK';
  const ids = agencies.map((a) => a.id);
  const [unread, latest] = await Promise.all([
    unreadFor(db, scope.userId, side, ids),
    Promise.all(ids.map((agencyId) => db.deskMessage.findFirst({ where: { agencyId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], select: { side: true, body: true, createdAt: true } }))),
  ]);
  const threads = agencies
    .map((a, i) => ({
      agencyId: a.id, agencyName: a.name, unread: unread.get(a.id) ?? 0,
      last: latest[i] ? { side: latest[i]!.side, snippet: snippet(latest[i]!.body), at: latest[i]!.createdAt } : null,
    }))
    // Unread first, then the most recent conversation, then by name.
    .sort((x, y) => Number(y.unread > 0) - Number(x.unread > 0)
      || (y.last?.at.getTime() ?? 0) - (x.last?.at.getTime() ?? 0)
      || x.agencyName.localeCompare(y.agencyName));

  return { canMessage, threads, requestConversations: await requestConversations(db, scope) };
}

/** The latest shared notes on requests this person can open, one per request, newest first. */
async function requestConversations(db: Db, scope: DeskScope) {
  const notes = await db.taskEvent.findMany({
    where: { AND: [taskEventWhere(scope), { kind: 'NOTE', visibility: 'AGENCY' }] },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: CONVERSATIONS_LIMIT * 5,
    select: { taskId: true, actorId: true, body: true, createdAt: true, task: { select: { id: true, reference: true, title: true, agencyId: true, agency: { select: { name: true } } } } },
  });
  const seen = new Set<string>();
  const latest = notes.filter((n) => (seen.has(n.taskId) ? false : (seen.add(n.taskId), true))).slice(0, CONVERSATIONS_LIMIT);
  const actorIds = [...new Set(latest.map((n) => n.actorId).filter((x): x is string => !!x))];
  const people = actorIds.length ? await db.user.findMany({ where: { id: { in: actorIds } }, select: PERSON }) : [];
  const byId = new Map(people.map((p) => [p.id, p]));
  return latest.map((n) => {
    const actor = n.actorId ? byId.get(n.actorId) : undefined;
    const fromAgency = !!actor && actor.agencyId === n.task.agencyId;
    return {
      taskId: n.task.id, reference: n.task.reference, title: n.task.title,
      ...(scope.kind === 'AGENCY' ? {} : { agencyName: n.task.agency.name }),
      // To an agency the Desk team is one team; staff see who wrote it.
      from: fromAgency ? 'AGENCY' as const : 'DESK' as const,
      author: scope.kind === 'AGENCY' ? (fromAgency && actor ? nameOf(actor) : 'Your Desk team') : (actor ? nameOf(actor) : 'Former user'),
      snippet: snippet(n.body ?? ''),
      at: n.createdAt,
    };
  });
}

// ── One conversation ──

/** An agency's conversation, oldest first (the latest THREAD_LIMIT). Opening it marks it read, and is logged. */
export async function readThread(db: Db, scope: DeskScope, agencyId: string, ctx: GuardContext = {}) {
  const { agency, side } = await threadAgency(db, scope, agencyId, 'read', ctx);
  const [newestFirst, total] = await Promise.all([
    db.deskMessage.findMany({ where: { agencyId: agency.id }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: THREAD_LIMIT }),
    db.deskMessage.count({ where: { agencyId: agency.id } }),
  ]);
  const messages = newestFirst.reverse();
  const authorIds = [...new Set(messages.map((m) => m.authorId).filter((x): x is string => !!x))];
  const people = authorIds.length ? await db.user.findMany({ where: { id: { in: authorIds } }, select: PERSON }) : [];
  const byId = new Map(people.map((p) => [p.id, p]));
  const now = new Date();
  await db.deskMessageRead.upsert({
    where: { agencyId_userId: { agencyId: agency.id, userId: scope.userId } },
    create: { agencyId: agency.id, userId: scope.userId, lastReadAt: now },
    update: { lastReadAt: now },
  });
  await recordAudit(db, {
    actor: { id: scope.userId, role: scope.role }, action: 'message.viewed', entityType: 'Agency', entityId: agency.id, agencyId: agency.id,
    metadata: { messages: messages.length }, ...ctx,
  });
  return {
    agency, yourSide: side, total,
    messages: messages.map((m) => ({
      id: m.id, side: m.side, mine: m.authorId === scope.userId,
      author: authorLabel(m.authorId ? byId.get(m.authorId) : undefined, m.side),
      body: m.body, at: m.createdAt,
    })),
  };
}

/** Sends a message to an agency's conversation. Logged with its length, never its text. */
export async function sendMessage(db: Db, scope: DeskScope, agencyId: string, input: { body?: unknown }, ctx: GuardContext = {}) {
  const { agency, side } = await threadAgency(db, scope, agencyId, 'send', ctx);
  const body = typeof input.body === 'string' ? input.body.trim() : '';
  if (!body) throw new DeskAccessError(400, 'Write a message first.');
  if (body.length > MESSAGE_MAX) throw new DeskAccessError(400, `Keep a message to ${MESSAGE_MAX.toLocaleString('en-US')} characters.`);
  const credential = looksLikeCredential(body);
  if (credential) throw new DeskAccessError(400, credential);
  const now = new Date();
  // The message and its audit entry are saved together: if it can't be logged, it isn't sent.
  const message = await db.$transaction(async (tx) => {
    const created = await tx.deskMessage.create({ data: { agencyId: agency.id, authorId: scope.userId, side, body, createdAt: now } });
    // Your own message doesn't count as unread for you.
    await tx.deskMessageRead.upsert({
      where: { agencyId_userId: { agencyId: agency.id, userId: scope.userId } },
      create: { agencyId: agency.id, userId: scope.userId, lastReadAt: now },
      update: { lastReadAt: now },
    });
    await recordAudit(tx, {
      actor: { id: scope.userId, role: scope.role }, action: 'message.sent', entityType: 'DeskMessage', entityId: created.id, agencyId: agency.id,
      metadata: { side, length: body.length }, ...ctx,
    });
    return created;
  }, TX_OPTIONS);
  // The other side is emailed, once until they open the conversation; this never fails the send.
  await notifyMessage(db, { id: message.id, agencyId: agency.id, side, authorId: scope.userId });
  return { id: message.id, side, mine: true, body, at: message.createdAt };
}
