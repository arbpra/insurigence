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
import { DeskAccessError, getTaskForScope, isObjectId, taskEventWhere, taskWhere, type DeskScope, type GuardContext } from './access';
import { recordAudit } from './audit';
import { literal } from './literal-match';
import { TASK_TYPE_LABELS } from './service-levels';
import { AGENCY_STATUS_LABELS, STATUS_LABELS, addTaskNote, agencyStatus, agencyTaskView, assignTask, changeTaskStatus, createTask, reviewTask, type AgencyStatus } from './tasks';
import { statusMoves } from './task-statuses';
import { CLOSED_STATUSES, TOP_LEVEL, UNASSIGNED, UNROUTED } from './task-filters';
import { taskDocumentsFor } from './task-documents';

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
} satisfies Prisma.TaskInclude;
type TaskRow = Prisma.TaskGetPayload<{ include: typeof RELATED }>;
type Person = { id: string; firstName: string | null; lastName: string | null; email: string };

const nameOf = (p: Person) => [p.firstName, p.lastName].filter(Boolean).join(' ') || p.email;
const personView = (p: Person | null) => (p ? { id: p.id, name: nameOf(p) } : null);
const isManager = (s: DeskScope) => s.kind === 'ACCOUNT_MANAGER' || s.kind === 'PLATFORM';
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
  if (!isManager(scope)) return staff;
  return {
    ...staff,
    slaDueAt: task.slaDueAt,
    slaTarget: task.slaTarget,
    slaPausedMinutes: task.slaPausedMinutes,
    escalatedAt: task.escalatedAt,
    escalationReason: task.escalationReason,
    restrictedToUserIds: task.restrictedToUserIds,
    restrictionReason: task.restrictionReason,
    billing: {
      serviceCategory: task.serviceCategory, units: task.billableUnits, nonBillable: task.nonBillable,
      class: task.billingClass, status: task.billingStatus, period: task.billingPeriod,
    },
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
const VA_EVENT_DETAILS = ['clock', 'automatic'];

function staffEventView(scope: DeskScope, event: TaskEvent, actors: Map<string, Actor>) {
  const metadata = (event.metadata ?? {}) as Record<string, unknown>;
  const person = (id: unknown) => {
    if (typeof id !== 'string') return null;
    const found = actors.get(id);
    return found ? nameOf(found) : 'Former user';
  };
  const details = isManager(scope) ? metadata : Object.fromEntries(Object.entries(metadata).filter(([k]) => VA_EVENT_DETAILS.includes(k)));
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

export function listWhere(scope: DeskScope, opts: TaskListOptions, now: Date): Prisma.TaskWhereInput {
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
        { insured: { is: { name: { contains: text, mode: 'insensitive' } } } },
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

export async function listTasks(db: Db, scope: DeskScope, opts: TaskListOptions = {}) {
  const now = new Date();
  const where = listWhere(scope, opts, now);
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
  await recordAudit(db, {
    actor: { id: scope.userId, role: scope.role }, action: 'task.viewed', entityType: 'Task', entityId: task.id, agencyId: task.agencyId,
    // Which files were listed, so a later question about who saw a file can be answered.
    metadata: { reference: task.reference, documentIds: documents.map((d) => d.id) }, ...ctx,
  });
  return {
    ...viewFor(scope, task, new Date()),
    ...(scope.kind === 'AGENCY' ? {} : { permissions: staffPermissions(scope, task) }),
    documents,
    eventsTotal,
    events: events.map((e) => (scope.kind === 'AGENCY' ? agencyEventView(e, task.agencyId, actors) : staffEventView(scope, e, actors))),
  };
}

/**
 * What the workspace offers this person on this task. Only a guide for the
 * screen: the task service checks every change again.
 */
function staffPermissions(scope: DeskScope, task: TaskRow) {
  const manager = isManager(scope);
  const holdsIt = task.assigneeId === scope.userId;
  const open = !isClosed(task.status);
  return {
    statusMoves: statusMoves(task.status, { manager, holdsIt, assigned: !!task.assigneeId }),
    pickUp: scope.kind === 'VA' && open && !task.assigneeId,
    release: open && holdsIt,
    assign: manager && open,
    review: manager && open,
    addDocuments: open,
  };
}

// ── Changes: the service makes them, and the answer is the person's own view ──

async function viewById(db: Db, scope: DeskScope, taskId: string) {
  return viewFor(scope, await db.task.findUniqueOrThrow({ where: { id: taskId }, include: RELATED }), new Date());
}

export async function submitTask(db: Db, scope: DeskScope, body: Record<string, unknown>, ctx: GuardContext = {}) {
  const task = await createTask(db, scope, {
    type: body.type as string, title: body.title as string,
    description: body.description as string | null, priority: body.priority as string | null, complexity: body.complexity as string | null,
    insuredId: body.insuredId as string | null, policyId: body.policyId as string | null, agencyId: body.agencyId as string | null,
  }, ctx);
  return viewById(db, scope, task.id);
}

export async function setTaskStatus(db: Db, scope: DeskScope, taskId: string, body: Record<string, unknown>, ctx: GuardContext = {}) {
  const task = await changeTaskStatus(db, scope, taskId, body.status as string, { reason: body.reason as string | null }, ctx);
  return viewById(db, scope, task.id);
}

export async function setTaskAssignee(db: Db, scope: DeskScope, taskId: string, body: Record<string, unknown>, ctx: GuardContext = {}) {
  // Null means unassign, so a missing or malformed person mustn't be read as that.
  if (body.assigneeId !== null && !isObjectId(body.assigneeId)) throw bad('Choose who to assign, or null to unassign.');
  const task = await assignTask(db, scope, taskId, body.assigneeId, ctx);
  return viewById(db, scope, task.id);
}

/** Body: any of { complexity, priority, billableUnits, nonBillable }, and a reason. Managers only. */
export async function reviewTaskFields(db: Db, scope: DeskScope, taskId: string, body: Record<string, unknown>, ctx: GuardContext = {}) {
  const task = await reviewTask(db, scope, taskId, body, ctx);
  return viewById(db, scope, task.id);
}

export async function postTaskNote(db: Db, scope: DeskScope, taskId: string, body: Record<string, unknown>, ctx: GuardContext = {}) {
  const { task, resumed } = await addTaskNote(db, scope, taskId, { body: body.body as string, visibility: body.visibility as string | null }, ctx);
  return { task: await viewById(db, scope, task.id), resumed };
}
