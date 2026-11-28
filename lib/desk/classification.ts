/**
 * Module 53: account and request classification.
 *
 * Small Commercial, Middle-Market or Complex / Custom, on the account by
 * default; a request may have its own (set through the request's
 * reclassification, lib/desk/tasks.ts `reviewTask`). Rules (client,
 * 24 Nov 2026):
 *  - `classification.set` (Account Managers and up): where none is set yet;
 *  - `classification.override` (Senior AM, Director of Agency Operations,
 *    COO): a classification already set, with a reason;
 *  - `classification.flag` (VAs, Pod Leaders, Account Managers): ask for a
 *    change, with a reason. A flag changes nothing; it is settled when the
 *    classification changes or someone who could change it dismisses it.
 *
 * Internal throughout: agency users never see a classification, a flag or
 * their history. Reasons are kept with the change (the account's history, or
 * the request's internal history); the audit log records the facts.
 */
import { Prisma, type ClassFlagTarget, type PrismaClient, type ServiceClass, type Task } from '@prisma/client';
import { can, DeskAccessError, getInsuredForScope, getTaskForScope, isStaffScope, scopeIn, type DeskScope, type GuardContext } from './access';
import { recordAudit } from './audit';
import { CLASS_REASON_MAX, FLAG_NOTE_MAX, isServiceClass, mayChange, type ClassRights } from './classification-view';
import { CLOSED_STATUSES } from './task-filters';

type Db = PrismaClient;
type Tx = Prisma.TransactionClient;
const TX_OPTIONS = { timeout: 20_000, maxWait: 10_000 };
const CHANGED_ELSEWHERE = 'The classification was changed by someone else. Refresh and try again.';
const HISTORY_LIMIT = 20;

const bad = (m: string) => new DeskAccessError(400, m);
const conflict = (m: string) => new DeskAccessError(409, m);
const actorOf = (s: DeskScope) => ({ id: s.userId, role: s.role });
const isClosed = (t: Pick<Task, 'status'>) => (CLOSED_STATUSES as readonly string[]).includes(t.status);
type Person = { id: string; firstName: string | null; lastName: string | null; email: string };
const nameOf = (p: Person) => [p.firstName, p.lastName].filter(Boolean).join(' ') || p.email;

async function inTransaction<T>(db: Db, fn: (tx: Tx) => Promise<T>): Promise<T> {
  try {
    return await db.$transaction(fn, TX_OPTIONS);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && (err.code === 'P2034' || err.code === 'P2002')) throw conflict(CHANGED_ELSEWHERE);
    throw err;
  }
}

/** A refusal, logged like the other Desk refusals before it is thrown. */
async function refuse(db: Db, scope: DeskScope, ctx: GuardContext, entityType: 'InsuredAccount' | 'Task', entityId: string, agencyId: string, op: string, message: string): Promise<never> {
  try {
    await recordAudit(db, { actor: actorOf(scope), action: 'access.denied', entityType, entityId, agencyId, metadata: { op, scope: scope.kind }, ip: ctx.ip, userAgent: ctx.userAgent });
  } catch (err) {
    console.error('[desk/classification] could not log refused action', err);
  }
  throw new DeskAccessError(403, message);
}

/** What this person may do with classifications in this agency (and pod, for a request). */
export function classRights(scope: DeskScope, agencyId: string, podId?: string | null): ClassRights {
  const s = podId === undefined ? scopeIn(scope, agencyId) : scopeIn(scope, agencyId, podId);
  if (!isStaffScope(s)) return { set: false, override: false, flag: false };
  return { set: can(s, 'classification.set'), override: can(s, 'classification.override'), flag: can(s, 'classification.flag') };
}

const refusal = (current: ServiceClass | null) => current
  ? 'Only a Senior Account Manager, the Director of Agency Operations or the COO can change a classification already set. Flag it for them instead.'
  : 'Your position does not allow classifying accounts.';

function reasonOf(value: unknown, required: boolean, max = CLASS_REASON_MAX): string | null {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) {
    if (required) throw bad('Give a reason.');
    return null;
  }
  if (text.length > max) throw bad(`The reason can be at most ${max} characters.`);
  return text;
}

export async function accountClassOf(db: Db | Tx, insuredId: string | null): Promise<ServiceClass | null> {
  if (!insuredId) return null;
  return (await db.accountClassification.findUnique({ where: { insuredId }, select: { serviceClass: true } }))?.serviceClass ?? null;
}

async function names(db: Db, ids: (string | null | undefined)[]): Promise<Map<string, string>> {
  const want = [...new Set(ids.filter((x): x is string => !!x))];
  if (!want.length) return new Map();
  const people = await db.user.findMany({ where: { id: { in: want } }, select: { id: true, firstName: true, lastName: true, email: true } });
  return new Map(people.map((p) => [p.id, nameOf(p)]));
}

// ── The account ──

/**
 * The account's classification for Desk staff (null for anyone else). Those
 * who may classify also get its history and the open flags asking for a change.
 */
export async function accountClassification(db: Db, scope: DeskScope, account: { id: string; agencyId: string }) {
  if (!isStaffScope(scope)) return null;
  const rights = classRights(scope, account.agencyId);
  const current = await db.accountClassification.findUnique({ where: { insuredId: account.id } });
  const manages = rights.set || rights.override;
  const [history, flags] = manages
    ? await Promise.all([
      db.accountClassificationChange.findMany({ where: { insuredId: account.id }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: HISTORY_LIMIT }),
      db.classificationFlag.findMany({ where: { insuredId: account.id, target: 'ACCOUNT', closedAt: null }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: HISTORY_LIMIT }),
    ])
    : [[], []];
  const refs = flags.length ? await db.task.findMany({ where: { id: { in: flags.map((f) => f.taskId) } }, select: { id: true, reference: true } }) : [];
  const refOf = new Map(refs.map((t) => [t.id, t.reference]));
  const who = await names(db, [current?.setById, ...history.map((h) => h.actorId), ...flags.map((f) => f.flaggedById)]);
  return {
    serviceClass: current?.serviceClass ?? null,
    setAt: current?.setAt.toISOString() ?? null,
    setBy: current ? who.get(current.setById) ?? 'Former user' : null,
    /** Sent back with a change, so two people changing it at once can't overwrite each other. */
    version: current?.updatedAt.toISOString() ?? null,
    can: { change: mayChange(rights, current?.serviceClass ?? null), flag: rights.flag },
    ...(manages ? {
      history: history.map((h) => ({ id: h.id, from: h.fromClass, to: h.toClass, reason: h.reason, by: who.get(h.actorId) ?? 'Former user', at: h.createdAt.toISOString() })),
      flags: flags.map((f) => ({ id: f.id, taskId: f.taskId, reference: refOf.get(f.taskId) ?? null, suggested: f.suggested, reason: f.reason, by: who.get(f.flaggedById) ?? 'Former user', at: f.createdAt.toISOString() })),
    } : {}),
  };
}

/** Closes the open flags a change settles, each with a line in its request's history. */
async function settleFlags(tx: Tx, scope: DeskScope, where: Prisma.ClassificationFlagWhereInput, to: ServiceClass | null, now: Date): Promise<number> {
  const open = await tx.classificationFlag.findMany({ where: { AND: [where, { closedAt: null }] }, select: { id: true, taskId: true, agencyId: true, target: true } });
  if (!open.length) return 0;
  await tx.classificationFlag.updateMany({ where: { id: { in: open.map((f) => f.id) } }, data: { closedAt: now, closedById: scope.userId, outcome: 'CHANGED' } });
  await tx.taskEvent.createMany({
    data: open.map((f) => ({ taskId: f.taskId, agencyId: f.agencyId, actorId: scope.userId, kind: 'CLASS_FLAG_CLOSED' as const, metadata: { target: f.target, outcome: 'CHANGED', to } })),
  });
  return open.length;
}

/**
 * Body: { serviceClass, reason?, version? }. Sets the account's
 * classification, or changes it (an override: a reason is required). Settles
 * the open flags on the account.
 */
export async function classifyAccount(db: Db, scope: DeskScope, insuredId: string, body: Record<string, unknown>, ctx: GuardContext = {}) {
  const account = await getInsuredForScope(db, scope, insuredId, ctx, { id: true, agencyId: true });
  const current = await db.accountClassification.findUnique({ where: { insuredId: account.id } });
  const from = current?.serviceClass ?? null;
  if (!mayChange(classRights(scope, account.agencyId), from)) return refuse(db, scope, ctx, 'InsuredAccount', account.id, account.agencyId, 'classify', refusal(from));
  if (!isServiceClass(body.serviceClass)) throw bad('Choose Small Commercial, Middle-Market or Complex / Custom.');
  const to = body.serviceClass;
  if (to === from) throw bad('Nothing has changed.');
  const reason = reasonOf(body.reason, !!current);
  if (current && body.version != null && body.version !== current.updatedAt.toISOString()) throw conflict(CHANGED_ELSEWHERE);
  if (!current && body.version != null) throw conflict(CHANGED_ELSEWHERE);

  const now = new Date();
  await inTransaction(db, async (tx) => {
    if (current) {
      const { count } = await tx.accountClassification.updateMany({ where: { id: current.id, updatedAt: current.updatedAt }, data: { serviceClass: to, setById: scope.userId, setAt: now } });
      if (count !== 1) throw conflict(CHANGED_ELSEWHERE);
    } else {
      if (await tx.accountClassification.count({ where: { insuredId: account.id } })) throw conflict(CHANGED_ELSEWHERE);
      await tx.accountClassification.create({ data: { agencyId: account.agencyId, insuredId: account.id, serviceClass: to, setById: scope.userId, setAt: now } });
    }
    await tx.accountClassificationChange.create({ data: { agencyId: account.agencyId, insuredId: account.id, fromClass: from, toClass: to, reason, actorId: scope.userId } });
    const flagsClosed = await settleFlags(tx, scope, { insuredId: account.id, target: 'ACCOUNT' }, to, now);
    await recordAudit(tx, {
      actor: actorOf(scope), action: 'insured.classified', entityType: 'InsuredAccount', entityId: account.id, agencyId: account.agencyId,
      metadata: { from, to, override: !!current, flagsClosed }, ...ctx,
    });
  });
  return accountClassification(db, scope, account);
}

// ── A request ──

/**
 * A request's classification for Desk staff (null for agency users and for
 * subtasks, which take their request's): its own or the account's, the open
 * flag, and what this person may do.
 */
export async function taskClassification(db: Db, scope: DeskScope, task: Pick<Task, 'id' | 'agencyId' | 'podId' | 'insuredId' | 'serviceClass' | 'status' | 'parentTaskId'>) {
  if (!isStaffScope(scope) || task.parentTaskId) return null;
  const [account, flag] = await Promise.all([
    accountClassOf(db, task.insuredId),
    db.classificationFlag.findFirst({ where: { taskId: task.id, closedAt: null }, orderBy: { createdAt: 'desc' } }),
  ]);
  const effective = task.serviceClass ?? account;
  const onRequest = classRights(scope, task.agencyId, task.podId);
  const onAccount = classRights(scope, task.agencyId);
  const open = !isClosed(task);
  const who = flag ? await names(db, [flag.flaggedById]) : new Map<string, string>();
  return {
    serviceClass: effective,
    source: task.serviceClass ? 'REQUEST' as const : account ? 'ACCOUNT' as const : null,
    account,
    request: task.serviceClass,
    hasAccount: !!task.insuredId,
    flag: flag ? { id: flag.id, target: flag.target, suggested: flag.suggested, reason: flag.reason, by: who.get(flag.flaggedById) ?? 'Former user', at: flag.createdAt.toISOString() } : null,
    can: {
      /** This request's own classification (through the reclassification form). */
      change: open && mayChange(onRequest, effective),
      flag: open && onRequest.flag && !flag,
      dismiss: !!flag && (flag.target === 'ACCOUNT' ? mayChange(onAccount, account) : mayChange(onRequest, effective)),
    },
  };
}

/** Body: { target: 'ACCOUNT' | 'REQUEST', suggested, reason }. Asks for a change; changes nothing. */
export async function flagClassification(db: Db, scope: DeskScope, taskId: string, body: Record<string, unknown>, ctx: GuardContext = {}) {
  const task = await getTaskForScope(db, scope, taskId, ctx);
  if (!classRights(scope, task.agencyId, task.podId).flag) {
    return refuse(db, scope, ctx, 'Task', task.id, task.agencyId, 'flag-classification', 'Your position does not allow flagging a classification.');
  }
  if (task.parentTaskId) throw bad('A subtask takes its request\'s classification. Flag the request itself.');
  if (isClosed(task)) throw conflict('This request is closed.');
  const target = body.target as ClassFlagTarget;
  if (target !== 'ACCOUNT' && target !== 'REQUEST') throw bad('Choose the account or this request.');
  if (target === 'ACCOUNT' && !task.insuredId) throw bad('This request has no account. Flag the request instead.');
  if (!isServiceClass(body.suggested)) throw bad('Choose the classification you suggest.');
  const suggested = body.suggested;
  const account = await accountClassOf(db, task.insuredId);
  const current = target === 'ACCOUNT' ? account : task.serviceClass ?? account;
  if (current === suggested) throw bad('That is already its classification.');
  const reason = reasonOf(body.reason, true)!;

  await inTransaction(db, async (tx) => {
    if (await tx.classificationFlag.count({ where: { taskId: task.id, closedAt: null } })) throw conflict('This request is already flagged for reclassification.');
    // closedAt written as null, not left out: MongoDB's `closedAt: null` filters match only a stored null.
    await tx.classificationFlag.create({ data: { agencyId: task.agencyId, taskId: task.id, insuredId: task.insuredId, target, suggested, reason, flaggedById: scope.userId, closedAt: null } });
    await tx.taskEvent.create({ data: { taskId: task.id, agencyId: task.agencyId, actorId: scope.userId, kind: 'CLASS_FLAGGED', body: reason, metadata: { target, suggested, from: current } } });
    await recordAudit(tx, {
      actor: actorOf(scope), action: 'classification.flagged', entityType: 'Task', entityId: task.id, agencyId: task.agencyId,
      metadata: { reference: task.reference, target, suggested, from: current }, ...ctx,
    });
  });
  return taskClassification(db, scope, await db.task.findUniqueOrThrow({ where: { id: task.id } }));
}

/** Body: { note? }. Dismisses the open flag: for someone who could make the change it asks for. */
export async function dismissClassificationFlag(db: Db, scope: DeskScope, taskId: string, body: Record<string, unknown>, ctx: GuardContext = {}) {
  const task = await getTaskForScope(db, scope, taskId, ctx);
  const flag = await db.classificationFlag.findFirst({ where: { taskId: task.id, closedAt: null } });
  if (!flag) throw conflict('This request has no open classification flag.');
  const account = await accountClassOf(db, task.insuredId);
  const allowed = flag.target === 'ACCOUNT'
    ? mayChange(classRights(scope, task.agencyId), account)
    : mayChange(classRights(scope, task.agencyId, task.podId), task.serviceClass ?? account);
  if (!allowed) return refuse(db, scope, ctx, 'Task', task.id, task.agencyId, 'dismiss-classification-flag', 'Only someone who could make the change can dismiss the flag.');
  const note = reasonOf(body.note, false, FLAG_NOTE_MAX);

  await inTransaction(db, async (tx) => {
    const { count } = await tx.classificationFlag.updateMany({ where: { id: flag.id, closedAt: null }, data: { closedAt: new Date(), closedById: scope.userId, outcome: 'DISMISSED', closeNote: note } });
    if (count !== 1) throw conflict(CHANGED_ELSEWHERE);
    await tx.taskEvent.create({ data: { taskId: task.id, agencyId: task.agencyId, actorId: scope.userId, kind: 'CLASS_FLAG_CLOSED', body: note, metadata: { target: flag.target, outcome: 'DISMISSED' } } });
    await recordAudit(tx, {
      actor: actorOf(scope), action: 'classification.flag_dismissed', entityType: 'Task', entityId: task.id, agencyId: task.agencyId,
      metadata: { reference: task.reference, target: flag.target, suggested: flag.suggested }, ...ctx,
    });
  });
  return taskClassification(db, scope, await db.task.findUniqueOrThrow({ where: { id: task.id } }));
}

/** Used by the request's reclassification: settles a flag on this request once its own classification changes. */
export const settleRequestFlags = (tx: Tx, scope: DeskScope, taskId: string, to: ServiceClass | null, now: Date) =>
  settleFlags(tx, scope, { taskId, target: 'REQUEST' }, to, now);
