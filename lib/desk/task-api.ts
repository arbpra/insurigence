/**
 * What the Task API reads and sends back. Changes themselves belong to the task
 * service (lib/desk/tasks.ts); this decides who is shown what.
 *
 * Three views of a task, none of them the raw record:
 *  - Agency: simplified status, no pod, staff, due dates or billing (client answer
 *    Q5: targets are internal, not guarantees).
 *  - VA: what the work needs, without billing or who a task is restricted to (Q4).
 *  - Account / Operations Manager: everything.
 *
 * Reads are always through taskWhere and taskEventWhere, so a filter can only
 * narrow what the person could already see.
 */
import { Prisma, TaskPriority, TaskType, type PrismaClient, type TaskEvent, type TaskStatus } from '@prisma/client';
import { can, DeskAccessError, getTaskForScope, insuredWhere, isObjectId, taskEventWhere, taskWhere, type DeskScope, type GuardContext } from './access';
import { recordAudit } from './audit';
import { literal } from './literal-match';
import { TASK_TYPE_LABELS } from './service-levels';
import { AGENCY_STATUS_LABELS, STATUS_LABELS, addTaskNote, agencyStatus, agencyTaskView, assignTask, changeTaskStatus, createSubtask, createTask, escalateTask, moveTaskToPod, restrictTask, restrictionCandidates, reviewTask, type AgencyStatus } from './tasks';
import { notForAgencies } from './task-queue';
import { statusMoves } from './task-statuses';
import { CLOSED_STATUSES, NOT_FOLLOW_UP, TOP_LEVEL, UNASSIGNED, UNROUTED } from './task-filters';
import { taskDocumentsFor } from './task-documents';
import { notifyAgencyNote, notifyEscalated, notifyStatusChanged, notifyTaskAssigned, notifyTaskCreated } from './notifications';

type Db = PrismaClient;

const MAX_PAGE_SIZE = 100;
const EVENT_LIMIT = 500;

const bad = (message: string) => new DeskAccessError(400, message);

const PERSON = { select: { id: true, firstName: true, lastName: true, email: true } } as const;
const RELATED = {
  agency: { select: { id: true, name: true } },
  insured: { select: { id: true, name: true } },
  policy: { select: { id: true, policyNumber: true, lineOfBusiness: true, carrierName: true, expirationDate: true } },
  pod: { select: { id: true, name: true } },
  am: PERSON,
  assignee: PERSON,
  parent: { select: { id: true, reference: true } },
} satisfies Prisma.TaskInclude;
type TaskRow = Prisma.TaskGetPayload<{ include: typeof RELATED }>;
type Person = { id: string; firstName: string | null; lastName: string | null; email: string };

const nameOf = (p: Person) => [p.firstName, p.lastName].filter(Boolean).join(' ') || p.email;
const personView = (p: Person | null) => (p ? { id: p.id, name: nameOf(p) } : null);
/** Hands work out (Module 48: `requests.assign`): sees targets and escalation, reassigns, reopens, moves pods. */
const isManager = (s: DeskScope) => can(s, 'requests.assign');
const isClosed = (status: TaskStatus) => (CLOSED_STATUSES as readonly TaskStatus[]).includes(status);

// ── Views ──

function viewFor(scope: DeskScope, task: TaskRow, now: Date) {
  const account = { insured: task.insured, policy: task.policy, typeLabel: TASK_TYPE_LABELS[task.type] };
  if (scope.kind === 'AGENCY') return { ...agencyTaskView(task), ...account };
  const staff = {
    id: task.id,
    reference: task.reference,
    type: task.type,
    title: task.title,
    description: task.description,
    priority: task.priority,
    complexity: task.complexity,
    status: task.status,
    statusLabel: STATUS_LABELS[task.status],
    source: task.source,
    // A subtask names its request by number; its title comes only with the detail, to those who can open it.
    parent: task.parent ? { id: task.parent.id, reference: task.parent.reference } : null,
    /** A follow-up: made by a rule when its request was completed (Module 39). */
    followUp: !!task.followUpRuleId,
    ...account,
    agency: task.agency,
    pod: task.pod,
    accountManager: personView(task.am),
    assignee: personView(task.assignee),
    dueAt: task.dueAt,
    overdue: !!task.dueAt && task.dueAt < now && !task.slaPausedAt && !isClosed(task.status),
    waitingSince: task.slaPausedAt,
    escalated: task.escalated,
    createdAt: task.createdAt,
    startedAt: task.startedAt,
    completedAt: task.completedAt,
    cancelledAt: task.cancelledAt,
    lastActivityAt: task.lastActivityAt,
  };
  // Each part only for a position that may act on it (Module 48).
  return {
    ...staff,
    ...(isManager(scope) ? {
      slaDueAt: task.slaDueAt,
      slaTarget: task.slaTarget,
      slaPausedMinutes: task.slaPausedMinutes,
      escalatedAt: task.escalatedAt,
      escalationReason: task.escalationReason,
    } : {}),
    ...(can(scope, 'requests.restrict') ? { restrictedToUserIds: task.restrictedToUserIds, restrictionReason: task.restrictionReason } : {}),
    ...(can(scope, 'requests.classify') ? {
      billing: {
        serviceCategory: task.serviceCategory, units: task.billableUnits, nonBillable: task.nonBillable,
        class: task.billingClass, status: task.billingStatus, period: task.billingPeriod,
      },
    } : {}),
  };
}

type Actor = { id: string; firstName: string | null; lastName: string | null; email: string; agencyId: string | null };

/**
 * A status reason reaches the agency only when it's addressed to them: what is
 * needed from them, or why a request was cancelled. A reason for waiting on a
 * carrier, or for reopening, is the team's own note.
 */
const REASON_FOR_AGENCY: readonly AgencyStatus[] = ['NEEDS_ATTENTION', 'CANCELLED'];

function agencyEventView(event: TaskEvent, agencyId: string, actors: Map<string, Actor>) {
  const actor = event.actorId ? actors.get(event.actorId) : undefined;
  const status = event.toStatus ? agencyStatus(event.toStatus) : null;
  const fromStatus = event.fromStatus ? agencyStatus(event.fromStatus) : null;
  const isStatusChange = event.kind === 'STATUS_CHANGED';
  return {
    id: event.id,
    kind: event.kind,
    // Colleagues by name; Desk staff are one team to the agency.
    actorName: actor?.agencyId === agencyId ? ([actor.firstName, actor.lastName].filter(Boolean).join(' ') || 'A colleague') : 'Your Desk team',
    body: isStatusChange && !(status && REASON_FOR_AGENCY.includes(status)) ? null : event.body,
    status,
    statusLabel: status ? AGENCY_STATUS_LABELS[status] : null,
    fromStatus,
    fromStatusLabel: fromStatus ? AGENCY_STATUS_LABELS[fromStatus] : null,
    createdAt: event.createdAt,
  };
}

/** Listed, not removed: anything added to an event's details later stays from VAs until it's chosen here. */
const VA_EVENT_DETAILS = ['clock', 'automatic', 'reference', 'followUp'];

function staffEventView(scope: DeskScope, event: TaskEvent, actors: Map<string, Actor>) {
  const metadata = (event.metadata ?? {}) as Record<string, unknown>;
  const person = (id: unknown) => {
    if (typeof id !== 'string') return null;
    const found = actors.get(id);
    return found ? nameOf(found) : 'Former user';
  };
  // The full record (who is named, why, billing) only for those who may restrict; others get the short allowlist.
  const details = can(scope, 'requests.restrict') ? metadata : Object.fromEntries(Object.entries(metadata).filter(([k]) => VA_EVENT_DETAILS.includes(k)));
  return {
    id: event.id,
    kind: event.kind,
    visibility: event.visibility,
    actorName: event.actorId ? person(event.actorId) : 'The Desk',
    body: event.body,
    fromStatus: event.fromStatus,
    toStatus: event.toStatus,
    ...(event.kind === 'ASSIGNED' || event.kind === 'UNASSIGNED' ? { assignedFrom: person(metadata.from), assignedTo: person(metadata.to) } : {}),
    details,
    createdAt: event.createdAt,
  };
}

// ── List ──

export interface TaskListOptions {
  q?: string | null;
  status?: string | null;
  type?: string | null;
  priority?: string | null;
  insuredId?: string | null;
  open?: boolean;
  mine?: boolean;
  /** Staff only, from here down. Agency users' filters never touch internal fields. */
  agencyId?: string | null;
  podId?: string | null;
  assignee?: string | null;
  overdue?: boolean;
  /** Escalated work only (Module 40). */
  escalated?: boolean;
  sort?: string | null;
  page?: number;
  pageSize?: number;
}

function listOf<T extends string>(text: string | null | undefined, allowed: Record<string, unknown>, what: string): T[] {
  if (!text) return [];
  return text.split(',').map((part) => {
    const value = part.trim();
    if (!Object.hasOwn(allowed, value)) throw bad(`Choose a valid ${what}.`);
    return value as T;
  });
}

function idFilter(value: string | null | undefined, what: string): string | null {
  if (!value) return null;
  if (!isObjectId(value)) throw bad(`Choose a valid ${what}.`);
  return value;
}

/** Internal statuses behind the simplified ones an agency chooses from. */
function internalStatuses(chosen: AgencyStatus[]): TaskStatus[] {
  return (Object.keys(STATUS_LABELS) as TaskStatus[]).filter((s) => chosen.includes(agencyStatus(s)));
}

const OPEN: Prisma.TaskWhereInput = { status: { notIn: [...CLOSED_STATUSES] } };
const NO_DUE_DATE: Prisma.TaskWhereInput = { OR: [{ dueAt: null }, { dueAt: { isSet: false } }] };
const NOT_WAITING: Prisma.TaskWhereInput = { OR: [{ slaPausedAt: null }, { slaPausedAt: { isSet: false } }] };

/**
 * `searchAccounts`: for people who see only their assigned accounts, the
 * accounts whose name matches the search, looked up first (searchAccountIds).
 * Their scope already filters on the account's assignments, and MongoDB
 * refuses a query that also filters on the account's name (it fails on
 * requests with no account), so the name is matched by id instead.
 */
export function listWhere(scope: DeskScope, opts: TaskListOptions, now: Date, searchAccounts?: string[]): Prisma.TaskWhereInput {
  const agency = scope.kind === 'AGENCY';
  const statuses = agency
    ? internalStatuses(listOf<AgencyStatus>(opts.status, AGENCY_STATUS_LABELS, 'status'))
    : listOf<TaskStatus>(opts.status, STATUS_LABELS, 'status');
  const types = listOf<TaskType>(opts.type, TaskType, 'request type');
  const priorities = listOf<TaskPriority>(opts.priority, TaskPriority, 'priority');
  const insuredId = idFilter(opts.insuredId, 'account');
  const parts: Prisma.TaskWhereInput[] = [taskWhere(scope)];
  // To an agency a subtask is part of its parent's request, not a request of its own.
  if (agency) parts.push(TOP_LEVEL);
  if (statuses.length) parts.push({ status: { in: statuses } });
  if (types.length) parts.push({ type: { in: types } });
  if (priorities.length) parts.push({ priority: { in: priorities } });
  if (insuredId) parts.push({ insuredId });
  if (opts.open) parts.push(OPEN);
  if (opts.mine) {
    // A person's own work: staff, what they hold; agency users, what they sent or their accounts' requests.
    parts.push(agency
      ? { OR: [{ createdById: scope.userId }, { insured: { is: { assignments: { some: { userId: scope.userId } } } } }] }
      : { assigneeId: scope.userId });
  }
  const q = opts.q?.trim().slice(0, 200);
  if (q) {
    const text = literal(q);
    const reference = /^#?(\d{1,9})$/.exec(q);
    parts.push({
      OR: [
        { title: { contains: text, mode: 'insensitive' } },
        searchAccounts ? { insuredId: { in: searchAccounts } } : { insured: { is: { name: { contains: text, mode: 'insensitive' } } } },
        ...(reference ? [{ reference: Number(reference[1]) }] : []),
      ],
    });
  }
  if (!agency) {
    const agencyId = idFilter(opts.agencyId, 'agency');
    if (agencyId) parts.push({ agencyId });
    if (opts.podId === 'none') parts.push(UNROUTED);
    else {
      const podId = idFilter(opts.podId, 'pod');
      if (podId) parts.push({ podId });
    }
    if (opts.assignee === 'none') parts.push(UNASSIGNED);
    else {
      const assigneeId = opts.assignee === 'me' ? scope.userId : idFilter(opts.assignee, 'person');
      if (assigneeId) parts.push({ assigneeId });
    }
    if (opts.overdue) parts.push(OPEN, NOT_WAITING, { dueAt: { lt: now } });
    if (opts.escalated) parts.push({ escalated: true });
  }
  return { AND: parts };
}

/** MongoDB sorts missing values first, so tasks with no due date are fetched after the dated ones. */
async function pageByDueDate(db: Db, where: Prisma.TaskWhereInput, skip: number, take: number): Promise<TaskRow[]> {
  const dated: Prisma.TaskWhereInput = { AND: [where, { dueAt: { not: null } }] };
  const datedTotal = await db.task.count({ where: dated });
  const first = skip < datedTotal
    ? await db.task.findMany({ where: dated, include: RELATED, orderBy: [{ dueAt: 'asc' }, { id: 'asc' }], skip, take })
    : [];
  if (first.length === take) return first;
  const rest = await db.task.findMany({
    where: { AND: [where, NO_DUE_DATE] }, include: RELATED, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    skip: Math.max(0, skip - datedTotal), take: take - first.length,
  });
  return [...first, ...rest];
}

/** The accounts a search names, for people who see only their assigned accounts (see listWhere). */
async function searchAccountIds(db: Db, scope: DeskScope, q: string | null | undefined): Promise<string[] | undefined> {
  const text = q?.trim().slice(0, 200);
  if (!text || scope.kind !== 'AGENCY' || scope.book === 'ALL') return undefined;
  const found = await db.insuredAccount.findMany({
    where: { AND: [insuredWhere(scope), { name: { contains: literal(text), mode: 'insensitive' } }] },
    select: { id: true },
  });
  return found.map((a) => a.id);
}

export async function listTasks(db: Db, scope: DeskScope, opts: TaskListOptions = {}) {
  const now = new Date();
  const where = listWhere(scope, opts, now, await searchAccountIds(db, scope, opts.q));
  const pageSize = Math.min(Math.max(1, Math.trunc(opts.pageSize ?? 25) || 25), MAX_PAGE_SIZE);
  const page = Math.max(1, Math.trunc(opts.page ?? 1) || 1);
  const skip = (page - 1) * pageSize;
  // Due dates and activity times are internal, so an agency's list can't be ordered by them.
  const sort = scope.kind === 'AGENCY' ? (opts.sort === 'completed' ? 'completed' : 'newest') : opts.sort ?? 'newest';
  if (!['newest', 'activity', 'due', 'completed'].includes(sort)) throw bad('Choose a valid sort order.');
  const ORDER: Record<string, Prisma.TaskOrderByWithRelationInput[]> = {
    newest: [{ createdAt: 'desc' }, { id: 'desc' }],
    activity: [{ lastActivityAt: 'desc' }, { id: 'desc' }],
    // Never-completed requests sort last (missing values are lowest in MongoDB).
    completed: [{ completedAt: 'desc' }, { id: 'desc' }],
  };
  const [total, rows] = await Promise.all([
    db.task.count({ where }),
    sort === 'due'
      ? pageByDueDate(db, where, skip, pageSize)
      : db.task.findMany({
          where, include: RELATED, skip, take: pageSize,
          orderBy: ORDER[sort],
        }),
  ]);
  return {
    total, page, pageSize,
    rows: rows.map((t) => {
      const { description: _omitted, ...row } = viewFor(scope, t, now);
      return row;
    }),
  };
}

// ── Detail ──

/** One task and the history this person may see. Opening it is logged (Q4), and if that can't be logged, it doesn't open. */
export async function getTaskDetail(db: Db, scope: DeskScope, taskId: string, ctx: GuardContext = {}) {
  const found = await getTaskForScope(db, scope, taskId, ctx);
  const task = await db.task.findUniqueOrThrow({ where: { id: found.id }, include: RELATED });
  const where: Prisma.TaskEventWhereInput = { AND: [{ taskId: task.id }, taskEventWhere(scope)] };
  const [newestFirst, eventsTotal] = await Promise.all([
    db.taskEvent.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: EVENT_LIMIT }),
    db.taskEvent.count({ where }),
  ]);
  const events = newestFirst.reverse();
  const ids = new Set<string>();
  for (const e of events) {
    if (e.actorId) ids.add(e.actorId);
    const details = (e.metadata ?? {}) as Record<string, unknown>;
    if (scope.kind !== 'AGENCY' && (e.kind === 'ASSIGNED' || e.kind === 'UNASSIGNED')) {
      for (const id of [details.from, details.to]) if (typeof id === 'string') ids.add(id);
    }
  }
  const people = ids.size
    ? await db.user.findMany({ where: { id: { in: [...ids] } }, select: { id: true, firstName: true, lastName: true, email: true, agencyId: true } })
    : [];
  const actors = new Map<string, Actor>(people.map((p) => [p.id, p]));
  const documents = await taskDocumentsFor(db, scope, task);
  const family = scope.kind === 'AGENCY' ? null : await subtaskFamily(db, scope, task);
  await recordAudit(db, {
    actor: { id: scope.userId, role: scope.role }, action: 'task.viewed', entityType: 'Task', entityId: task.id, agencyId: task.agencyId,
    // Which files were listed, so a later question about who saw a file can be answered.
    metadata: { reference: task.reference, documentIds: documents.map((d) => d.id) }, ...ctx,
  });
  return {
    ...viewFor(scope, task, new Date()),
    ...(scope.kind === 'AGENCY' ? {} : { permissions: staffPermissions(scope, task, (family && 'openSubtasks' in family ? family.openSubtasks : 0) ?? 0) }),
    documents,
    ...(family ?? {}),
    // The pods a manager can move it to.
    ...(isManager(scope) ? { pods: await db.pod.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] }) } : {}),
    eventsTotal,
    events: events.map((e) => (scope.kind === 'AGENCY' ? agencyEventView(e, task.agencyId, actors) : staffEventView(scope, e, actors))),
  };
}

/**
 * A request's subtasks this person can see, and how many are still open in
 * all (the completion rule counts every one); for a subtask, its request,
 * with the title only if they could open it.
 */
async function subtaskFamily(db: Db, scope: DeskScope, task: TaskRow) {
  if (task.parentTaskId) {
    const parent = await db.task.findFirst({
      where: { AND: [{ id: task.parentTaskId }, taskWhere(scope)] },
      select: { id: true, reference: true, title: true, status: true },
    });
    return {
      parentRequest: parent
        ? { id: parent.id, reference: parent.reference, title: parent.title, status: parent.status, statusLabel: STATUS_LABELS[parent.status], canOpen: true, followUp: !!task.followUpRuleId }
        : { id: null, reference: task.parent?.reference ?? null, title: null, status: null, statusLabel: null, canOpen: false, followUp: !!task.followUpRuleId },
    };
  }
  const [rows, openTotal] = await Promise.all([
    db.task.findMany({
      where: { AND: [{ parentTaskId: task.id }, taskWhere(scope)] },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { id: true, reference: true, type: true, title: true, status: true, followUpRuleId: true, assignee: { select: PERSON.select }, pod: { select: { id: true, name: true } } },
    }),
    // Every open one, seen or not, except follow-ups: they come after the request and don't hold it open.
    db.task.count({ where: { AND: [{ parentTaskId: task.id, status: { notIn: [...CLOSED_STATUSES] } }, NOT_FOLLOW_UP] } }),
  ]);
  return {
    subtasks: rows.map((r) => ({
      id: r.id, reference: r.reference, typeLabel: TASK_TYPE_LABELS[r.type], title: r.title,
      status: r.status, statusLabel: STATUS_LABELS[r.status], assignee: personView(r.assignee), pod: r.pod, followUp: !!r.followUpRuleId,
    })),
    openSubtasks: openTotal,
    hiddenSubtasks: Math.max(0, (await db.task.count({ where: { parentTaskId: task.id } })) - rows.length),
  };
}

/**
 * What the workspace offers this person on this task. Only a guide for the
 * screen: the task service checks every change again.
 */
function staffPermissions(scope: DeskScope, task: TaskRow, openSubtasks: number) {
  const manager = isManager(scope);
  const holdsIt = task.assigneeId === scope.userId;
  const open = !isClosed(task.status);
  return {
    // Not completed while a subtask is open (the parent completion rule).
    statusMoves: statusMoves(task.status, { manager, holdsIt, assigned: !!task.assigneeId }).filter((to) => to !== 'COMPLETED' || !openSubtasks),
    pickUp: !manager && can(scope, 'requests.work') && open && !task.assigneeId,
    release: open && holdsIt,
    assign: manager && open,
    review: can(scope, 'requests.classify') && open,
    addDocuments: open,
    // One level only; a VA on a request they hold.
    addSubtask: open && !task.parentTaskId && (manager || holdsIt),
    // Module 40: flag for a manager's attention, or move to another pod.
    escalate: can(scope, 'requests.escalate') && open,
    movePod: manager && open,
    // Q4: on the request, at any stage (a dispute can come after the work); subtasks follow it.
    restrict: can(scope, 'requests.restrict') && !task.parentTaskId,
  };
}

// ── Changes: the service makes them, and the answer is the person's own view ──
// Once a change is saved, the people it concerns are emailed (lib/desk/notifications.ts);
// that never fails the change.

async function viewById(db: Db, scope: DeskScope, taskId: string) {
  return viewFor(scope, await db.task.findUniqueOrThrow({ where: { id: taskId }, include: RELATED }), new Date());
}

export async function submitTask(db: Db, scope: DeskScope, body: Record<string, unknown>, ctx: GuardContext = {}) {
  const task = await createTask(db, scope, {
    type: body.type as string, title: body.title as string,
    description: body.description as string | null, priority: body.priority as string | null, complexity: body.complexity as string | null,
    insuredId: body.insuredId as string | null, policyId: body.policyId as string | null, agencyId: body.agencyId as string | null,
  }, ctx);
  await notifyTaskCreated(db, task, scope.userId);
  return viewById(db, scope, task.id);
}

/** Body: { type, title, description?, priority? }. Desk staff only; answers with the subtask, as this person sees it. */
export async function submitSubtask(db: Db, scope: DeskScope, parentId: string, body: Record<string, unknown>, ctx: GuardContext = {}) {
  const task = await createSubtask(db, scope, parentId, {
    type: body.type as string, title: body.title as string,
    description: body.description as string | null, priority: body.priority as string | null,
  }, ctx);
  return viewById(db, scope, task.id);
}

export async function setTaskStatus(db: Db, scope: DeskScope, taskId: string, body: Record<string, unknown>, ctx: GuardContext = {}) {
  const task = await changeTaskStatus(db, scope, taskId, body.status as string, { reason: body.reason as string | null }, ctx);
  await notifyStatusChanged(db, task, scope.userId);
  return viewById(db, scope, task.id);
}

export async function setTaskAssignee(db: Db, scope: DeskScope, taskId: string, body: Record<string, unknown>, ctx: GuardContext = {}) {
  // Null means unassign, so a missing or malformed person mustn't be read as that.
  if (body.assigneeId !== null && !isObjectId(body.assigneeId)) throw bad('Choose who to assign, or null to unassign.');
  const task = await assignTask(db, scope, taskId, body.assigneeId, ctx);
  await notifyTaskAssigned(db, task, scope.userId);
  return viewById(db, scope, task.id);
}

/** Body: { escalate: true, reason } or { escalate: false, reason? }. Managers only (Module 40). */
export async function setTaskEscalation(db: Db, scope: DeskScope, taskId: string, body: Record<string, unknown>, ctx: GuardContext = {}) {
  const task = await escalateTask(db, scope, taskId, { escalate: body.escalate, reason: body.reason }, ctx);
  await notifyEscalated(db, task, scope.userId);
  return viewById(db, scope, task.id);
}

/** Body: { userIds, reason }; an empty list lifts it. Account and Operations Managers, on a request (Q4). */
export async function setTaskRestriction(db: Db, scope: DeskScope, taskId: string, body: Record<string, unknown>, ctx: GuardContext = {}) {
  if (scope.kind === 'AGENCY') await notForAgencies(db, scope, 'restrict', taskId, ctx);
  const { task, subtasks, released } = await restrictTask(db, scope, taskId, { userIds: body.userIds, reason: body.reason }, ctx);
  return { task: await viewById(db, scope, task.id), subtasks, released };
}

/** Who can be named, and who is named now. Account and Operations Managers. */
export async function getRestrictionCandidates(db: Db, scope: DeskScope, taskId: string, ctx: GuardContext = {}) {
  if (scope.kind === 'AGENCY') await notForAgencies(db, scope, 'restriction', taskId, ctx);
  return restrictionCandidates(db, scope, taskId, ctx);
}

/** Body: { podId }. Managers only (Module 40). */
export async function setTaskPod(db: Db, scope: DeskScope, taskId: string, body: Record<string, unknown>, ctx: GuardContext = {}) {
  const task = await moveTaskToPod(db, scope, taskId, body.podId, ctx);
  return viewById(db, scope, task.id);
}

/** Body: any of { complexity, priority, billableUnits, nonBillable }, and a reason. Managers only. */
export async function reviewTaskFields(db: Db, scope: DeskScope, taskId: string, body: Record<string, unknown>, ctx: GuardContext = {}) {
  const task = await reviewTask(db, scope, taskId, body, ctx);
  return viewById(db, scope, task.id);
}

export async function postTaskNote(db: Db, scope: DeskScope, taskId: string, body: Record<string, unknown>, ctx: GuardContext = {}) {
  const { task, resumed } = await addTaskNote(db, scope, taskId, { body: body.body as string, visibility: body.visibility as string | null }, ctx);
  if (scope.kind === 'AGENCY') await notifyAgencyNote(db, task, scope.userId, resumed);
  return { task: await viewById(db, scope, task.id), resumed };
}
