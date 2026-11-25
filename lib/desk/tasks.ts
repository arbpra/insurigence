/**
 * The Desk task service: the only code that creates or changes tasks.
 * The API (lib/desk/task-api.ts) wraps these and decides what each person is shown.
 *
 * Every function takes the caller's DeskScope (lib/desk/access.ts), finds the
 * task through the access layer (404 when out of scope), checks the role's
 * rules, and writes the change, its TaskEvent and its audit entry in one
 * transaction — so a change that cannot be logged does not happen.
 *
 * The service-level clock stops in the waiting statuses and restarts when
 * work resumes (clockChange); completed work is classified for billing
 * against the agency's monthly allowance (lib/desk/billing-capture.ts).
 */
import {
  Prisma, TaskComplexity, TaskPriority, TaskType,
  type PrismaClient, type Task, type TaskStatus, type DeskVisibility,
} from '@prisma/client';
import { recordAudit } from './audit';
import { can, DeskAccessError, getTaskForScope, isStaffScope, isObjectId, resolveDeskScope, resolveSubmission, taskWhere, type DeskScope } from './access';
import { defaultBilling } from './billing';
import { completionPeriod, decideBilling, giveBack, type BillingDecision } from './billing-capture';
import {
  addBusinessMinutes, businessMinutesBetween, computeDueAt, extendForPause, loadBusinessCalendar, type BusinessCalendar,
} from './business-time';
import { nextTaskReference } from './sequence';
import { pickServiceLevelTarget, targetSnapshot } from './service-levels';
import { CLOSED_STATUSES, NOT_FOLLOW_UP, UNASSIGNED, UNROUTED } from './task-filters';
import { returnToQueue } from './task-release';
import { followUpTitle } from './follow-ups';
import { agencyMaySend } from './request-form';
import { AGENCY_STATUS_LABELS, NEEDS_REASON, STATUS_LABELS, WAITING_STATUSES, agencyStatus, canTransition } from './task-statuses';

type Db = PrismaClient;
type Tx = Prisma.TransactionClient;
interface Ctx { ip?: string | null; userAgent?: string | null }

/** Mongo transactions over the network need more than Prisma's 5 s default. */
const TX_OPTIONS = { timeout: 20_000, maxWait: 10_000 };

const bad = (message: string) => new DeskAccessError(400, message);
const conflict = (message: string) => new DeskAccessError(409, message);
const forbidden = (message: string) => new DeskAccessError(403, message);

const CLOSED = new Set<TaskStatus>(CLOSED_STATUSES);
const CHANGED_ELSEWHERE = 'The task was changed by someone else. Refresh and try again.';
/** The parent completion rule: a request is complete only when all its subtasks are closed. */
const openSubtasksError = (n: number) =>
  new DeskAccessError(409, `Finish or cancel ${n === 1 ? 'its open subtask' : `its ${n} open subtasks`} first.`, 'OPEN_SUBTASKS');

/**
 * Runs the change, its timeline event and its audit entry atomically. When
 * two people change the same task at once, MongoDB aborts one transaction
 * with a write conflict (P2034); that person gets a 409, not a server error.
 */
async function inTransaction<T>(db: Db, fn: (tx: Tx) => Promise<T>): Promise<T> {
  try {
    return await db.$transaction(fn, TX_OPTIONS);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2034') throw conflict(CHANGED_ELSEWHERE);
    throw err;
  }
}

// ── Statuses ──
// Labels and allowed moves live in a pure module so screens offer exactly what this service accepts.

export { AGENCY_STATUS_LABELS, STATUS_LABELS, WAITING_STATUSES, agencyStatus, canTransition, type AgencyStatus } from './task-statuses';

/**
 * Runs a role check on a task the user can see. A 403 refusal is written to
 * the audit log (as out-of-scope 404s are by the access layer) before it is
 * thrown; invalid input and conflicts (400 / 409) are not access attempts and
 * are not logged. A logging failure still refuses.
 */
async function checkRules(
  db: Db, scope: DeskScope, task: Task, attempt: Record<string, unknown>, ctx: Ctx, rules: () => Promise<void>
): Promise<void> {
  try {
    await rules();
  } catch (err) {
    if (err instanceof DeskAccessError && err.status === 403) {
      try {
        await recordAudit(db, {
          actor: actorOf(scope), action: 'access.denied', entityType: 'Task', entityId: task.id, agencyId: task.agencyId,
          metadata: { reference: task.reference, ...attempt, reason: err.message }, ...ctx,
        });
      } catch (logErr) {
        console.error('[desk/tasks] could not log refused action', logErr);
      }
    }
    throw err;
  }
}

/** Desk staff whose position works requests or hands them out (Module 48). */
const isStaff = (s: DeskScope) => isStaffScope(s) && (can(s, 'requests.work') || can(s, 'requests.assign'));
/** Hands work to others, reopens, moves pods: Account Managers, Pod Leaders and up. Without it, a person works only what they hold. */
const isManager = (s: DeskScope) => isStaffScope(s) && can(s, 'requests.assign');
const actorOf = (s: DeskScope) => ({ id: s.userId, role: s.role });

// ── Create ──

export interface CreateTaskInput {
  type: string;
  title: string;
  description?: string | null;
  priority?: string | null;
  complexity?: string | null;
  insuredId?: string | null;
  policyId?: string | null;
  /** Only for Account Managers / Operations Managers filing on an agency's behalf. */
  agencyId?: string | null;
}

const oneOf = <T extends string>(values: Record<string, T>, v: unknown): v is T =>
  typeof v === 'string' && (Object.values(values) as string[]).includes(v);

function cleanText(v: unknown, field: string, max: number, required: boolean): string | null {
  if (v === undefined || v === null || (typeof v === 'string' && !v.trim())) {
    if (required) throw bad(`${field} is required.`);
    return null;
  }
  if (typeof v !== 'string') throw bad(`${field} must be text.`);
  const t = v.trim();
  if (t.length > max) throw bad(`${field} must be ${max} characters or fewer.`);
  return t;
}

/**
 * Files a new request. The agency, account and policy come from the access
 * layer (D4: only accounts the user can see). Then, automatically:
 *  - routed to the pod for its type (unrouted when no active rule: AM triage);
 *  - the agency's primary AM attached (backup when there is no primary);
 *  - the matching service-level target applied and its due date set
 *    (none for types without a target, decision D5);
 *  - billing category and billable flag set from the type.
 */
export async function createTask(db: Db, scope: DeskScope, input: CreateTaskInput, ctx: Ctx = {}): Promise<Task> {
  if (!oneOf(TaskType, input.type)) throw bad('Choose a valid request type.');
  // QA review is the Desk team's own step; agencies choose from the request types their form lists.
  if (scope.kind === 'AGENCY' && !agencyMaySend(input.type)) throw bad('Choose a valid request type.');
  const title = cleanText(input.title, 'Title', 200, true)!;
  const description = cleanText(input.description, 'Details', 10_000, false);
  if (input.complexity != null && !oneOf(TaskComplexity, input.complexity)) throw bad('Choose standard or complex.');
  if (input.priority != null && !oneOf(TaskPriority, input.priority)) throw bad('Choose a valid priority.');
  const type = input.type as TaskType;
  const complexity = (input.complexity ?? 'STANDARD') as TaskComplexity;

  const { agencyId, insuredId, policyId } = await resolveSubmission(db, scope, input, ctx);
  return insertTask(db, scope, {
    agencyId, insuredId, policyId, type, title, description, complexity,
    priority: (input.priority ?? null) as TaskPriority | null, parent: null,
  }, ctx);
}

interface NewTask {
  agencyId: string; insuredId: string | null; policyId: string | null;
  type: TaskType; title: string; description: string | null; complexity: TaskComplexity;
  priority: TaskPriority | null;
  /** Set for a subtask: it is worked within its parent's request. */
  parent: Task | null;
  /** Set for a follow-up (a subtask made by a rule when its request was completed). */
  followUp?: { ruleId: string; podId: string | null; billable: boolean } | null;
}

type PreparedTask = Awaited<ReturnType<typeof prepareTask>>;

/**
 * Routes, targets and saves a new task (or subtask), with its history and
 * audit entry. A subtask goes to the pod for its type, else its parent's;
 * keeps its parent's need-to-know restriction; and is
 * non-billable unless a manager decides otherwise, being part of the parent's
 * service. The parent's history records it, and the parent is touched in the
 * same transaction, so a subtask can't slip in while the parent is closing.
 */
async function insertTask(db: Db, scope: DeskScope, input: NewTask, ctx: Ctx): Promise<Task> {
  const prepared = await prepareTask(db, input);
  return inTransaction(db, (tx) => writeTask(tx, scope, prepared, ctx));
}

/**
 * Everything read before a new task is saved: its routing, target, Account
 * Manager and reference number. Kept apart from the save so a completion can
 * write its follow-ups in its own transaction.
 */
async function prepareTask(db: Db, input: NewTask) {
  const { agencyId, policyId, type, complexity, parent, followUp } = input;
  const [rule, desk, targets, policy, calendar, rulePod] = await Promise.all([
    db.taskRoutingRule.findFirst({ where: { taskType: type, isActive: true, pod: { isActive: true } }, select: { podId: true, defaultPriority: true } }),
    db.agencyDeskAssignment.findUnique({
      where: { agencyId },
      select: { primaryAm: { select: { id: true, isActive: true } }, backupAm: { select: { id: true, isActive: true } } },
    }),
    db.serviceLevelTarget.findMany({ where: { taskType: type, isActive: true } }),
    policyId ? db.policy.findUnique({ where: { id: policyId }, select: { expirationDate: true } }) : null,
    loadBusinessCalendar(db),
    followUp?.podId ? db.pod.findUnique({ where: { id: followUp.podId }, select: { isActive: true } }) : null,
  ]);
  const priority = (input.priority ?? parent?.priority ?? rule?.defaultPriority ?? 'NORMAL') as TaskPriority;

  const now = new Date();
  const target = pickServiceLevelTarget(targets, { type, complexity, priority, agencyId });
  const due = target ? computeDueAt(target, { startAt: now, expirationDate: policy?.expirationDate }, calendar) : null;
  const slaTarget = target
    ? { ...targetSnapshot(target), appliedAt: now.toISOString(), opensAt: due?.opensAt?.toISOString() ?? null, dueAt: due?.dueAt.toISOString() ?? null }
    : null;

  const reference = await nextTaskReference(db);
  // A follow-up goes to its rule's pod while that pod is on; otherwise like any task of its type.
  const podId = (rulePod?.isActive ? followUp!.podId : null) ?? rule?.podId ?? parent?.podId ?? null;
  // New work never goes to someone who has left.
  const amId = [desk?.primaryAm, desk?.backupAm].find((am) => am?.isActive)?.id ?? parent?.amId ?? null;
  return { ...input, priority, now, target, due, slaTarget, reference, podId, amId };
}

async function writeTask(tx: Prisma.TransactionClient, scope: DeskScope, p: PreparedTask, ctx: Ctx): Promise<Task> {
  const { agencyId, insuredId, policyId, type, title, description, complexity, parent, followUp, priority, now, target, due, slaTarget, reference, podId, amId } = p;
  // A follow-up is made as its request completes, inside that save. Any other subtask needs an open request.
  if (parent && !followUp) {
    // Only while the parent is still open; this write also makes a simultaneous completion conflict.
    const { count } = await tx.task.updateMany({
      where: { id: parent.id, status: { notIn: ['COMPLETED', 'CANCELLED'] } },
      data: { lastActivityAt: now },
    });
    if (count !== 1) throw conflict('The request is closed. Reopen it to add a subtask.');
  }
  // A subtask is part of its request's service, so non-billable; a follow-up is unless its rule says billable.
  const billing = followUp ? (followUp.billable ? {} : { nonBillable: true }) : parent ? { nonBillable: true } : {};
  const automatic = followUp ? { automatic: 'follow_up', followUpRuleId: followUp.ruleId } : null;
  const task = await tx.task.create({
    data: {
      reference, agencyId, insuredId, policyId, type, title, description, priority, complexity,
      podId, amId,
      parentTaskId: parent?.id ?? null,
      followUpRuleId: followUp?.ruleId ?? null,
      dueAt: due?.dueAt ?? null,
      slaDueAt: due?.dueAt ?? null,
      slaTarget: slaTarget ?? undefined,
      source: scope.kind === 'AGENCY' ? 'AGENCY' : 'INTERNAL',
      createdById: scope.userId,
      restrictedToUserIds: parent?.restrictedToUserIds ?? [],
      restrictionReason: parent?.restrictionReason ?? null,
      ...defaultBilling(type),
      ...billing,
      lastActivityAt: now,
    },
  });
  await tx.taskEvent.create({
    // A subtask is the team's own work: its history is internal. A follow-up is made by its rule, not a person.
    data: {
      taskId: task.id, agencyId, actorId: followUp ? null : scope.userId, kind: 'CREATED', visibility: parent ? 'INTERNAL' : 'AGENCY', body: title, toStatus: 'NEW',
      ...(automatic ? { metadata: automatic } : {}),
    },
  });
  if (parent) {
    await tx.taskEvent.create({
      data: {
        taskId: parent.id, agencyId, actorId: followUp ? null : scope.userId, kind: 'SUBTASK_CREATED', body: title,
        metadata: { subtaskId: task.id, reference, ...(followUp ? { followUp: true } : {}) },
      },
    });
  }
  if (podId) {
    await tx.taskEvent.create({
      data: { taskId: task.id, agencyId, actorId: null, kind: 'ROUTED', metadata: { podId, automatic: true } },
    });
  }
  await recordAudit(tx, {
    actor: actorOf(scope), action: 'task.created', entityType: 'Task', entityId: task.id, agencyId,
    metadata: {
      reference, type, priority, complexity, podId, amId, insuredId, policyId, targetId: target?.id ?? null, dueAt: due?.dueAt.toISOString() ?? null,
      ...(parent ? { parentTaskId: parent.id, parentReference: parent.reference } : {}),
      ...(automatic ?? {}),
    },
    ...ctx,
  });
  return task;
}

/**
 * The follow-ups a request's completion creates: one per active rule for its
 * type, unless that rule already made one for this request (it was completed
 * before, then reopened). Read before the completion is saved; written in its
 * transaction. Subtasks never trigger rules, so a follow-up can't start a chain.
 */
async function prepareFollowUps(db: Db, task: Task): Promise<PreparedTask[]> {
  if (task.parentTaskId) return [];
  const rules = await db.taskFollowUpRule.findMany({ where: { triggerType: task.type, triggerStatus: 'COMPLETED', isActive: true }, orderBy: { createdAt: 'asc' } });
  if (!rules.length) return [];
  const made = new Set((await db.task.findMany({
    where: { parentTaskId: task.id, followUpRuleId: { in: rules.map((r) => r.id) } }, select: { followUpRuleId: true },
  })).map((t) => t.followUpRuleId));
  const due = rules.filter((r) => !made.has(r.id));
  if (!due.length) return [];
  const insuredName = task.insuredId && due.some((r) => r.titleTemplate.includes('{insured}'))
    ? (await db.insuredAccount.findUnique({ where: { id: task.insuredId }, select: { name: true } }))?.name ?? null
    : null;
  return Promise.all(due.map((rule) => prepareTask(db, {
    agencyId: task.agencyId, insuredId: task.insuredId, policyId: task.policyId,
    type: rule.createType, title: followUpTitle(rule.titleTemplate, { reference: task.reference, insuredName }),
    description: null, complexity: 'STANDARD', priority: null, parent: task,
    followUp: { ruleId: rule.id, podId: rule.podId, billable: rule.billable },
  })));
}

// ── Subtasks ──

export interface SubtaskInput {
  type: string;
  title: string;
  description?: string | null;
  priority?: string | null;
}

/**
 * Adds a subtask to an open request: a piece of the work, done by the team
 * (for example the AMS update after a renewal). Desk staff only: a manager on
 * any request they can see, a VA on one they hold. One level only. The agency
 * never sees subtasks; to them it's all one request.
 */
export async function createSubtask(db: Db, scope: DeskScope, parentId: string, input: SubtaskInput, ctx: Ctx = {}): Promise<Task> {
  const parent = await getTaskForScope(db, scope, parentId, ctx);
  await checkRules(db, scope, parent, { op: 'subtask' }, ctx, async () => {
    if (!isStaff(scope)) throw forbidden('Subtasks are added by the Desk team.');
    if (!isManager(scope) && parent.assigneeId !== scope.userId) throw forbidden('Pick up the request before adding a subtask to it.');
  });
  if (parent.parentTaskId) throw bad("A subtask can't have subtasks of its own. Add it to the request instead.");
  if (parent.status === 'COMPLETED' || parent.status === 'CANCELLED') throw conflict('The request is closed. Reopen it to add a subtask.');
  if (!oneOf(TaskType, input.type)) throw bad('Choose a valid task type.');
  if (input.priority != null && !oneOf(TaskPriority, input.priority)) throw bad('Choose a valid priority.');
  const title = cleanText(input.title, 'Title', 200, true)!;
  const description = cleanText(input.description, 'Details', 10_000, false);
  return insertTask(db, scope, {
    agencyId: parent.agencyId, insuredId: parent.insuredId, policyId: parent.policyId,
    type: input.type as TaskType, title, description, complexity: 'STANDARD',
    priority: (input.priority ?? null) as TaskPriority | null, parent,
  }, ctx);
}

// ── Status ──

/**
 * Moves a task to a new status.
 *  - Desk VA: only on tasks assigned to them.
 *  - Account / Operations Manager: any task they can see; only they reopen.
 *  - Agency users: may only cancel, and only before work starts (New / Assigned).
 * Waiting and cancelling need a reason. The agency is shown it only when it's
 * addressed to them: what is needed from them, or why a request was cancelled
 * (lib/desk/task-api.ts). A concurrent change is a 409, never a silent overwrite.
 */
export async function changeTaskStatus(
  db: Db, scope: DeskScope, taskId: string, to: string, opts: { reason?: string | null } = {}, ctx: Ctx = {}
): Promise<Task> {
  const task = await getTaskForScope(db, scope, taskId, ctx);
  if (typeof to !== 'string' || !Object.hasOwn(STATUS_LABELS, to)) throw bad('Choose a valid status.');
  const toStatus = to as TaskStatus;
  const from = task.status;

  await checkRules(db, scope, task, { op: 'status', from, to: toStatus }, ctx, async () => {
    if (scope.kind === 'AGENCY') {
      if (toStatus !== 'CANCELLED' || (from !== 'NEW' && from !== 'ASSIGNED')) {
        throw forbidden('Your agency can cancel a request until work starts. For anything else, message your Account Manager.');
      }
    } else if (!isStaff(scope)) {
      throw forbidden('You cannot change this task.');
    } else if (!isManager(scope)) {
      if (task.assigneeId !== scope.userId) throw forbidden('Pick up the task before changing its status.');
    }
    if ((from === 'COMPLETED' || from === 'CANCELLED') && !isManager(scope)) {
      throw forbidden('Only an Account Manager can reopen a closed task.');
    }
  });
  if (from === toStatus) throw conflict(`The task is already ${STATUS_LABELS[from].toLowerCase()}.`);
  if (!canTransition(from, toStatus)) throw conflict(`A task cannot go from ${STATUS_LABELS[from]} to ${STATUS_LABELS[toStatus]}.`);
  if (toStatus === 'IN_PROGRESS' && !task.assigneeId) throw conflict('Assign the task before starting it.');
  if (from === 'COMPLETED' && task.billingStatus === 'BILLED') {
    throw conflict('This work has been invoiced and cannot be reopened. File a new request instead.');
  }
  if (toStatus === 'COMPLETED') {
    const open = await db.task.count({ where: { AND: [{ parentTaskId: task.id, status: { notIn: ['COMPLETED', 'CANCELLED'] } }, NOT_FOLLOW_UP] } });
    if (open) throw openSubtasksError(open);
  }
  // A subtask is reopened only within an open request. A follow-up comes after its request, so it may be.
  if ((from === 'COMPLETED' || from === 'CANCELLED') && task.parentTaskId && !task.followUpRuleId) {
    const parent = await db.task.findUnique({ where: { id: task.parentTaskId }, select: { reference: true, status: true } });
    if (parent && (parent.status === 'COMPLETED' || parent.status === 'CANCELLED')) throw conflict(`Request #${parent.reference} is closed. Reopen it first.`);
  }
  const reason = cleanText(opts.reason, 'Reason', 2_000, NEEDS_REASON.includes(toStatus) || from === 'COMPLETED' || from === 'CANCELLED');

  const now = new Date();
  const calendar = await loadBusinessCalendar(db);
  const data: Prisma.TaskUncheckedUpdateManyInput = { status: toStatus, lastActivityAt: now };
  if (toStatus === 'IN_PROGRESS' && !task.startedAt) data.startedAt = now;
  if (toStatus === 'COMPLETED') data.completedAt = now;
  if (toStatus === 'CANCELLED') data.cancelledAt = now;
  if (from === 'COMPLETED') data.completedAt = null;
  if (from === 'CANCELLED') { data.cancelledAt = null; data.assigneeId = null; }

  // Service-level clock: stops when waiting starts, restarts (pushing the due time out) when it ends.
  const clock = clockChange(task, toStatus, now, calendar);
  Object.assign(data, clock.data);

  // Billing: classified once, at completion; undone if the task is reopened.
  let billing: BillingDecision | null = null;
  if (toStatus === 'COMPLETED') {
    billing = await decideBilling(db, task, completionPeriod(now, calendar.timeZone));
    Object.assign(data, { billingClass: billing.billingClass, billingStatus: billing.billingStatus, billingPeriod: billing.billingPeriod });
  }
  const reopened = from === 'COMPLETED' && task.billingPeriod ? task : null;
  // Completing a request starts its follow-ups (Module 39), saved with the completion.
  const followUps = toStatus === 'COMPLETED' ? await prepareFollowUps(db, task) : [];
  if (reopened) Object.assign(data, { billingClass: null, billingStatus: null, billingPeriod: null });

  const agencyFacing = agencyStatus(from) !== agencyStatus(toStatus);
  const metadata = {
    ...(clock.meta ? { clock: clock.meta } : {}),
    ...(billing ? { billing: { class: billing.billingClass, reason: billing.reason, period: billing.billingPeriod } } : {}),
    ...(reopened ? { billingUndone: { class: reopened.billingClass, period: reopened.billingPeriod } } : {}),
  };
  let saved: Task;
  try {
    saved = await inTransaction(db, async (tx) => {
      // Only applies if nobody changed the status since it was read.
      const { count } = await tx.task.updateMany({ where: { id: task.id, status: from }, data });
      if (count !== 1) throw conflict(CHANGED_ELSEWHERE);
      // Counted inside the transaction: a subtask added meanwhile touches this task and conflicts.
      // Follow-ups aren't part of the request: they don't hold it open and aren't cancelled with it.
      const openSubtasks = await tx.task.findMany({
        where: { AND: [{ parentTaskId: task.id, status: { notIn: ['COMPLETED', 'CANCELLED'] } }, NOT_FOLLOW_UP] }, select: { id: true, status: true },
      });
      if (toStatus === 'COMPLETED' && openSubtasks.length) {
        throw openSubtasksError(openSubtasks.length);
      }
      if (toStatus === 'CANCELLED') {
        // Cancelling a request cancels the work left on it.
        for (const sub of openSubtasks) {
          const moved = await tx.task.updateMany({ where: { id: sub.id, status: sub.status }, data: { status: 'CANCELLED', cancelledAt: now, lastActivityAt: now } });
          if (moved.count !== 1) throw conflict(CHANGED_ELSEWHERE);
          await tx.taskEvent.create({
            data: {
              taskId: sub.id, agencyId: task.agencyId, actorId: scope.userId, kind: 'STATUS_CHANGED', visibility: 'INTERNAL',
              fromStatus: sub.status, toStatus: 'CANCELLED', body: `Request #${task.reference} was cancelled.`, metadata: { automatic: 'parent_cancelled' },
            },
          });
        }
      }
      const created: Task[] = [];
      for (const followUp of followUps) created.push(await writeTask(tx, scope, followUp, ctx));
      await tx.taskEvent.create({
        data: {
          taskId: task.id, agencyId: task.agencyId, actorId: scope.userId, kind: 'STATUS_CHANGED',
          visibility: agencyFacing ? 'AGENCY' : 'INTERNAL',
          fromStatus: from, toStatus, body: reason,
          ...(Object.keys(metadata).length ? { metadata } : {}),
        },
      });
      await recordAudit(tx, {
        actor: actorOf(scope), action: 'task.status_changed', entityType: 'Task', entityId: task.id, agencyId: task.agencyId,
        metadata: {
          reference: task.reference, from, to: toStatus, hasReason: !!reason, ...metadata,
          ...(toStatus === 'CANCELLED' && openSubtasks.length ? { subtasksCancelled: openSubtasks.map((t) => t.id) } : {}),
          ...(created.length ? { followUpsCreated: created.map((t) => t.id) } : {}),
        },
        ...ctx,
      });
      return tx.task.findUniqueOrThrow({ where: { id: task.id } });
    });
  } catch (err) {
    // The completion was not saved: return any allowance it took.
    if (billing?.consumed) await giveBack(db, task.agencyId, billing.billingPeriod, task.serviceCategory ?? 'SERVICE', billing.consumed);
    throw err;
  }
  // Reopened after counting toward the allowance: give the units back.
  if (reopened?.billingClass === 'INCLUDED') {
    await giveBack(db, reopened.agencyId, reopened.billingPeriod!, reopened.serviceCategory ?? 'SERVICE', Math.max(0, reopened.billableUnits))
      .catch((err) => console.error('[desk/tasks] could not return allowance units', err));
  }
  return saved;
}

/**
 * The service-level clock fields for a status change.
 *  - Entering a waiting status from active work: stop the clock (slaPausedAt).
 *  - Moving between waiting statuses: still stopped, nothing changes.
 *  - Leaving waiting: add the business minutes waited to slaPausedMinutes and
 *    push dueAt out by the same amount. Expiration-anchored targets (renewal,
 *    remarketing) keep their date: the policy expires when it expires.
 * slaDueAt — the original commitment — never moves.
 */
export function clockChange(
  task: Pick<Task, 'status' | 'slaPausedAt' | 'slaPausedMinutes' | 'dueAt' | 'slaTarget'>,
  toStatus: TaskStatus,
  now: Date,
  calendar: BusinessCalendar
): { data: Prisma.TaskUncheckedUpdateManyInput; meta: Prisma.InputJsonObject | null } {
  const wasWaiting = WAITING_STATUSES.includes(task.status);
  const isWaiting = WAITING_STATUSES.includes(toStatus);
  if (!wasWaiting && isWaiting) return { data: { slaPausedAt: now }, meta: { paused: true } };
  if (!wasWaiting || isWaiting || !task.slaPausedAt) return { data: {}, meta: null };

  const waited = businessMinutesBetween(task.slaPausedAt, now, calendar);
  const data: Prisma.TaskUncheckedUpdateManyInput = { slaPausedAt: null, slaPausedMinutes: (task.slaPausedMinutes ?? 0) + waited };
  const anchored = (task.slaTarget as { kind?: string } | null)?.kind === 'BEFORE_EXPIRATION';
  let dueAt: Date | null = task.dueAt;
  if (task.dueAt && !anchored && waited > 0 && toStatus !== 'CANCELLED') {
    dueAt = extendForPause(task.dueAt, { from: task.slaPausedAt, to: now }, calendar);
    data.dueAt = dueAt;
  }
  return {
    data,
    meta: { resumed: true, waitedMinutes: waited, dueAtFrom: task.dueAt?.toISOString() ?? null, dueAtTo: dueAt?.toISOString() ?? null },
  };
}

// ── Assignment ──

/**
 * Assigns a task to a Desk staff member, or unassigns it (assigneeId null).
 *  - A VA may pick up an unassigned task, or release their own.
 *  - An Account / Operations Manager may assign anyone eligible.
 *  - Agency users may not assign.
 * The new assignee must be an active VA or AM who could see the task under
 * their own need-to-know scope — so work can never be handed to someone
 * the agency has not authorised. New ⇄ Assigned follows automatically.
 */
export async function assignTask(
  db: Db, scope: DeskScope, taskId: string, assigneeId: string | null, ctx: Ctx = {}
): Promise<Task> {
  const task = await getTaskForScope(db, scope, taskId, ctx);
  if (task.assigneeId === assigneeId) throw conflict(assigneeId ? 'Already assigned to this person.' : 'The task is not assigned.');
  await checkRules(db, scope, task, { op: 'assign', from: task.assigneeId ?? null, to: assigneeId }, ctx, async () => {
    if (!isStaff(scope)) throw forbidden('Only Desk staff assign tasks.');
    if (!isManager(scope)) {
      const pickUp = assigneeId === scope.userId && !task.assigneeId && can(scope, 'requests.work');
      const release = assigneeId === null && task.assigneeId === scope.userId;
      if (!pickUp && !release) throw forbidden('You can pick up unassigned tasks or release your own; ask your Account Manager to reassign.');
    }
  });
  if (task.status === 'COMPLETED' || task.status === 'CANCELLED') throw conflict('This task is closed.');

  if (assigneeId) {
    const assigneeScope = await resolveDeskScope(db, assigneeId);
    // People who hold work: a position that works requests, reaching by pod or by assignment (all-agency positions oversee).
    if ((assigneeScope.kind !== 'VA' && assigneeScope.kind !== 'ACCOUNT_MANAGER') || !can(assigneeScope, 'requests.work')) throw bad('Tasks can be assigned to Desk VAs and Account Managers only.');
    const visible = await db.task.count({ where: { AND: [{ id: task.id }, taskWhere(assigneeScope)] } });
    if (!visible) throw bad('That person is not authorised for this agency, pod or task.');
  }

  // Released work goes back to the queue as New, even if it had been started: nobody
  // is working it any more (the same rule as when someone loses access). Waiting
  // work stays waiting, with its clock still stopped.
  const status: TaskStatus = assigneeId
    ? (task.status === 'NEW' ? 'ASSIGNED' : task.status)
    : (task.status === 'ASSIGNED' || task.status === 'IN_PROGRESS' ? 'NEW' : task.status);

  return inTransaction(db, async (tx) => {
    const { count } = await tx.task.updateMany({
      // A never-assigned task has no assigneeId field at all, which a bare null misses.
      where: { AND: [{ id: task.id, status: task.status }, task.assigneeId ? { assigneeId: task.assigneeId } : UNASSIGNED] },
      data: { assigneeId, status, lastActivityAt: new Date() },
    });
    if (count !== 1) throw conflict(CHANGED_ELSEWHERE);
    await tx.taskEvent.create({
      data: {
        taskId: task.id, agencyId: task.agencyId, actorId: scope.userId,
        kind: assigneeId ? 'ASSIGNED' : 'UNASSIGNED',
        fromStatus: task.status !== status ? task.status : null, toStatus: task.status !== status ? status : null,
        metadata: { from: task.assigneeId ?? null, to: assigneeId },
      },
    });
    await recordAudit(tx, {
      actor: actorOf(scope), action: 'task.assigned', entityType: 'Task', entityId: task.id, agencyId: task.agencyId,
      metadata: { reference: task.reference, from: task.assigneeId ?? null, to: assigneeId },
      ...ctx,
    });
    return tx.task.findUniqueOrThrow({ where: { id: task.id } });
  });
}

// ── Escalation and moving between pods (Module 40) ──

export const ESCALATION_REASON_MAX = 500;

/**
 * An Account Manager or Operations Manager flags open work that needs a
 * manager's attention, with a reason, or clears the flag. The reason is kept
 * in the internal history's details, which VAs aren't shown (Q4); the audit
 * entry records the fact, not the reason. The automatic ladder for overdue
 * work is Module 41.
 */
export async function escalateTask(
  db: Db, scope: DeskScope, taskId: string, input: { escalate: unknown; reason?: unknown }, ctx: Ctx = {}
): Promise<Task> {
  const task = await getTaskForScope(db, scope, taskId, ctx);
  await checkRules(db, scope, task, { op: input.escalate === false ? 'deescalate' : 'escalate' }, ctx, async () => {
    if (!can(scope, 'requests.escalate')) throw forbidden('Your position does not allow escalating work.');
  });
  if (typeof input.escalate !== 'boolean') throw bad('Choose to escalate or to clear the escalation.');
  if (task.status === 'COMPLETED' || task.status === 'CANCELLED') throw conflict('This task is closed.');
  const escalate = input.escalate;
  if (escalate && task.escalated) throw conflict('This task is already escalated.');
  if (!escalate && !task.escalated) throw conflict('This task is not escalated.');
  const reason = cleanText(input.reason, 'Reason', ESCALATION_REASON_MAX, escalate);
  const now = new Date();

  return inTransaction(db, async (tx) => {
    const { count } = await tx.task.updateMany({
      where: { id: task.id, status: task.status, escalated: task.escalated },
      data: escalate
        ? { escalated: true, escalatedAt: now, escalationReason: reason, lastActivityAt: now }
        : { escalated: false, escalatedAt: null, escalationReason: null, lastActivityAt: now },
    });
    if (count !== 1) throw conflict(CHANGED_ELSEWHERE);
    await tx.taskEvent.create({
      data: {
        taskId: task.id, agencyId: task.agencyId, actorId: scope.userId, kind: escalate ? 'ESCALATED' : 'DEESCALATED',
        metadata: reason ? { reason } : {},
      },
    });
    await recordAudit(tx, {
      actor: actorOf(scope), action: 'task.escalated', entityType: 'Task', entityId: task.id, agencyId: task.agencyId,
      metadata: { reference: task.reference, escalated: escalate }, ...ctx,
    });
    return tx.task.findUniqueOrThrow({ where: { id: task.id } });
  });
}

/**
 * An Account Manager or Operations Manager moves open work to another pod:
 * to triage a request no routing rule placed, or to balance the load. If the
 * person holding it can't see it in its new pod (they aren't authorised for
 * the agency there), it goes back to that pod's queue, as when someone loses
 * access. The history records the move.
 */
export async function moveTaskToPod(db: Db, scope: DeskScope, taskId: string, podId: unknown, ctx: Ctx = {}): Promise<Task> {
  const task = await getTaskForScope(db, scope, taskId, ctx);
  await checkRules(db, scope, task, { op: 'move_pod', from: task.podId ?? null, to: typeof podId === 'string' ? podId : null }, ctx, async () => {
    if (!isManager(scope)) throw forbidden('Your position does not allow moving work to another pod.');
  });
  if (!isObjectId(podId)) throw bad('Choose a pod.');
  if (task.status === 'COMPLETED' || task.status === 'CANCELLED') throw conflict('This task is closed.');
  if (task.podId === podId) throw conflict('The task is already in this pod.');
  const [pod, before] = await Promise.all([
    db.pod.findUnique({ where: { id: podId }, select: { id: true, name: true, isActive: true } }),
    task.podId ? db.pod.findUnique({ where: { id: task.podId }, select: { name: true } }) : null,
  ]);
  if (!pod) throw bad('Choose a pod.');
  if (!pod.isActive) throw conflict('That pod is switched off.');
  const holder = task.assigneeId ? await resolveDeskScope(db, task.assigneeId) : null;
  const now = new Date();

  return inTransaction(db, async (tx) => {
    const { count } = await tx.task.updateMany({
      where: { AND: [{ id: task.id, status: task.status, updatedAt: task.updatedAt }, task.podId ? { podId: task.podId } : UNROUTED] },
      data: { podId, lastActivityAt: now },
    });
    if (count !== 1) throw conflict(CHANGED_ELSEWHERE);
    await tx.taskEvent.create({
      data: {
        taskId: task.id, agencyId: task.agencyId, actorId: scope.userId, kind: 'ROUTED',
        metadata: { podId, from: task.podId ?? null, fromName: before?.name ?? null, toName: pod.name },
      },
    });
    // Checked after the move, inside the save: what the holder could see in the new pod.
    const keeps = !holder || (await tx.task.count({ where: { AND: [{ id: task.id }, taskWhere(holder)] } })) > 0;
    if (!keeps) await returnToQueue(tx, [{ id: task.id, agencyId: task.agencyId, status: task.status, assigneeId: task.assigneeId }], scope.userId, 'moved_pod');
    await recordAudit(tx, {
      actor: actorOf(scope), action: 'task.routed', entityType: 'Task', entityId: task.id, agencyId: task.agencyId,
      metadata: { reference: task.reference, from: task.podId ?? null, to: podId, ...(keeps ? {} : { released: task.assigneeId }) }, ...ctx,
    });
    return tx.task.findUniqueOrThrow({ where: { id: task.id } });
  });
}

// ── Restricting a request to named VAs (Q4) ──

export const RESTRICTION_REASON_MAX = 500;
export const RESTRICTION_MAX_PEOPLE = 20;

/** Can this VA be named on work for this agency in this pod? Only if the agency authorised them there. */
export const restrictionEligible = (scope: DeskScope, agencyId: string, podId: string | null | undefined) =>
  scope.kind === 'VA' && !!podId && scope.grants.some((g) => g.agencyId === agencyId && g.podId === podId);

/**
 * An Account Manager or Operations Manager restricts a request to named VAs
 * ("restrict certain agencies or tasks to specific employees", Q4), changes
 * who is named, or lifts it (an empty list). The request's Account Managers
 * and the Operations Managers always keep access. Set on the request, it
 * applies to its subtasks and follow-ups too, so no piece of the work stays
 * open to the rest of a pod. Each person named must be a VA the agency
 * authorised in the pod of the request or of one of its subtasks. Anyone
 * holding open work they could no longer see goes back to its queue, as when
 * someone loses access. The reason is internal: VAs and the agency never see
 * who is named or why (lib/desk/task-api.ts).
 */
export async function restrictTask(
  db: Db, scope: DeskScope, taskId: string, input: { userIds: unknown; reason?: unknown }, ctx: Ctx = {}
): Promise<{ task: Task; subtasks: number; released: number }> {
  const task = await getTaskForScope(db, scope, taskId, ctx);
  await checkRules(db, scope, task, { op: 'restrict' }, ctx, async () => {
    if (!can(scope, 'requests.restrict')) throw forbidden('Your position does not allow restricting a request.');
  });
  if (task.parentTaskId) throw bad('Restrict the main request; its subtasks follow it.');
  if (!Array.isArray(input.userIds) || !input.userIds.every((id) => isObjectId(id))) throw bad('Choose the people to restrict it to.');
  const userIds = [...new Set(input.userIds as string[])];
  if (userIds.length > RESTRICTION_MAX_PEOPLE) throw bad(`Name up to ${RESTRICTION_MAX_PEOPLE} people.`);
  const restricting = userIds.length > 0;
  if (!restricting && !task.restrictedToUserIds.length) throw conflict('This request is not restricted.');
  const before = [...task.restrictedToUserIds].sort();
  if (restricting && before.length === userIds.length && [...userIds].sort().every((id, i) => id === before[i])) {
    throw conflict('It is already restricted to exactly these people.');
  }
  const reason = cleanText(input.reason, 'Reason', RESTRICTION_REASON_MAX, restricting);

  const family = await db.task.findMany({
    where: { OR: [{ id: task.id }, { parentTaskId: task.id }] },
    select: { id: true, agencyId: true, podId: true, status: true, assigneeId: true },
  });
  const pods = new Set(family.map((t) => t.podId).filter((id): id is string => !!id));
  const names: string[] = [];
  for (const id of userIds) {
    const [user, theirs] = await Promise.all([
      db.user.findUnique({ where: { id }, select: { firstName: true, lastName: true, email: true, isActive: true } }),
      resolveDeskScope(db, id),
    ]);
    if (!user?.isActive || ![...pods].some((podId) => restrictionEligible(theirs, task.agencyId, podId))) {
      throw bad('Each person named must be a VA this agency has authorised in the pod doing the work.');
    }
    names.push([user.firstName, user.lastName].filter(Boolean).join(' ') || user.email);
  }

  // Who holds open work now, checked against the new restriction inside the save.
  const holders = new Map<string, DeskScope>();
  for (const t of family) {
    if (t.assigneeId && !CLOSED.has(t.status) && !holders.has(t.assigneeId)) holders.set(t.assigneeId, await resolveDeskScope(db, t.assigneeId));
  }
  const now = new Date();

  return inTransaction(db, async (tx) => {
    const { count } = await tx.task.updateMany({
      where: { id: task.id, updatedAt: task.updatedAt },
      data: { restrictedToUserIds: userIds, restrictionReason: restricting ? reason : null, lastActivityAt: now },
    });
    if (count !== 1) throw conflict(CHANGED_ELSEWHERE);
    const subtaskIds = family.filter((t) => t.id !== task.id).map((t) => t.id);
    if (subtaskIds.length) {
      await tx.task.updateMany({ where: { id: { in: subtaskIds } }, data: { restrictedToUserIds: userIds, restrictionReason: restricting ? reason : null } });
    }
    const release: Parameters<typeof returnToQueue>[1] = [];
    for (const t of family) {
      const holder = t.assigneeId && !CLOSED.has(t.status) ? holders.get(t.assigneeId) : undefined;
      if (!holder) continue;
      const keeps = (await tx.task.count({ where: { AND: [{ id: t.id }, taskWhere(holder)] } })) > 0;
      if (!keeps) release.push({ id: t.id, agencyId: t.agencyId, status: t.status, assigneeId: t.assigneeId });
    }
    await returnToQueue(tx, release, scope.userId, 'restricted');
    const details = { to: userIds, names, from: task.restrictedToUserIds, subtasks: subtaskIds.length, released: release.length, ...(reason ? { reason } : {}) };
    await tx.taskEvent.createMany({
      data: family.map((t) => ({ taskId: t.id, agencyId: t.agencyId, actorId: scope.userId, kind: 'RESTRICTED' as const, metadata: t.id === task.id ? details : { ...details, onRequest: task.reference } })),
    });
    await recordAudit(tx, {
      actor: actorOf(scope), action: 'task.restricted', entityType: 'Task', entityId: task.id, agencyId: task.agencyId,
      metadata: { reference: task.reference, from: task.restrictedToUserIds, to: userIds, subtasks: subtaskIds.length, released: release.map((r) => r.assigneeId) }, ...ctx,
    });
    return { task: await tx.task.findUniqueOrThrow({ where: { id: task.id } }), subtasks: subtaskIds.length, released: release.length };
  });
}

/**
 * Who a manager can name on a request: the VAs the agency authorised in the
 * pod of the request or of one of its subtasks, and who is named now.
 */
export async function restrictionCandidates(db: Db, scope: DeskScope, taskId: string, ctx: Ctx = {}) {
  const task = await getTaskForScope(db, scope, taskId, ctx);
  await checkRules(db, scope, task, { op: 'restriction_candidates' }, ctx, async () => {
    if (!can(scope, 'requests.restrict')) throw forbidden('Your position does not allow restricting a request.');
  });
  if (task.parentTaskId) throw bad('Restrict the main request; its subtasks follow it.');
  const family = await db.task.findMany({ where: { OR: [{ id: task.id }, { parentTaskId: task.id }] }, select: { podId: true } });
  const podIds = [...new Set(family.map((t) => t.podId).filter((id): id is string => !!id))];
  const [members, podRows] = await Promise.all([
    db.podMember.findMany({ where: { podId: { in: podIds } }, select: { userId: true, podId: true } }),
    db.pod.findMany({ where: { id: { in: podIds } }, select: { id: true, name: true } }),
  ]);
  const podName = new Map(podRows.map((p) => [p.id, p.name]));
  const ids = [...new Set([...members.map((m) => m.userId), ...task.restrictedToUserIds])];
  const users = ids.length ? await db.user.findMany({ where: { id: { in: ids } }, select: { id: true, firstName: true, lastName: true, email: true, isActive: true } }) : [];
  const people: { id: string; name: string; pods: string[]; named: boolean; eligible: boolean }[] = [];
  for (const user of users) {
    const theirs = await resolveDeskScope(db, user.id);
    const where = podIds.filter((podId) => restrictionEligible(theirs, task.agencyId, podId));
    const named = task.restrictedToUserIds.includes(user.id);
    if (!where.length && !named) continue;
    people.push({
      id: user.id, name: [user.firstName, user.lastName].filter(Boolean).join(' ') || user.email,
      pods: where.map((id) => podName.get(id) ?? 'A pod'), named, eligible: !!user.isActive && where.length > 0,
    });
  }
  people.sort((a, b) => a.name.localeCompare(b.name));
  return { restricted: task.restrictedToUserIds.length > 0, reason: task.restrictionReason ?? null, people };
}

// ── Reclassification and billing review ──

export const MAX_BILLABLE_UNITS = 50;

export interface ReviewInput {
  complexity?: unknown;
  priority?: unknown;
  billableUnits?: unknown;
  nonBillable?: unknown;
  reason?: unknown;
}

/**
 * An Account or Operations Manager reclassifies open work (complexity,
 * priority) or reviews how it will bill (units, non-billable). A new
 * complexity or priority can mean a different service-level target: the due
 * date is worked out again from when the clock started, and time already
 * spent waiting still doesn't count. Billing is decided at completion, so a
 * closed task must be reopened first. Every change needs a reason, kept in
 * the internal history; the audit entry records the facts, not the reason.
 */
export async function reviewTask(db: Db, scope: DeskScope, taskId: string, input: ReviewInput, ctx: Ctx = {}): Promise<Task> {
  const task = await getTaskForScope(db, scope, taskId, ctx);
  await checkRules(db, scope, task, { op: 'review' }, ctx, async () => {
    if (!can(scope, 'requests.classify')) throw forbidden('Your position does not allow reclassifying work or changing its billing.');
  });
  if (task.status === 'COMPLETED' || task.status === 'CANCELLED') {
    throw conflict('This task is closed. Reopen it to change its classification or billing.');
  }

  const from: Record<string, string | number | boolean> = {};
  const to: Record<string, string | number | boolean> = {};
  if (input.complexity !== undefined) {
    if (!oneOf(TaskComplexity, input.complexity)) throw bad('Choose standard or complex.');
    if (input.complexity !== task.complexity) { from.complexity = task.complexity; to.complexity = input.complexity; }
  }
  if (input.priority !== undefined) {
    if (!oneOf(TaskPriority, input.priority)) throw bad('Choose a valid priority.');
    if (input.priority !== task.priority) { from.priority = task.priority; to.priority = input.priority; }
  }
  if (input.billableUnits !== undefined) {
    const units = input.billableUnits;
    if (typeof units !== 'number' || !Number.isInteger(units) || units < 1 || units > MAX_BILLABLE_UNITS) {
      throw bad(`Billable units must be a whole number from 1 to ${MAX_BILLABLE_UNITS}.`);
    }
    if (units !== task.billableUnits) { from.billableUnits = task.billableUnits; to.billableUnits = units; }
  }
  if (input.nonBillable !== undefined) {
    if (typeof input.nonBillable !== 'boolean') throw bad('Choose billable or non-billable.');
    if (input.nonBillable !== task.nonBillable) { from.nonBillable = task.nonBillable; to.nonBillable = input.nonBillable; }
  }
  if (!Object.keys(to).length) throw bad('Nothing has changed.');
  const reason = cleanText(input.reason, 'Reason', 500, true)!;

  const now = new Date();
  const data: Prisma.TaskUncheckedUpdateManyInput = { ...to, lastActivityAt: now };
  let due: { from: string | null; to: string | null; targetFrom: string | null; targetTo: string | null } | null = null;
  if ('complexity' in to || 'priority' in to) {
    const complexity = (to.complexity ?? task.complexity) as TaskComplexity;
    const priority = (to.priority ?? task.priority) as TaskPriority;
    const [targets, policy, calendar] = await Promise.all([
      db.serviceLevelTarget.findMany({ where: { taskType: task.type, isActive: true } }),
      task.policyId ? db.policy.findUnique({ where: { id: task.policyId }, select: { expirationDate: true } }) : null,
      loadBusinessCalendar(db),
    ]);
    const target = pickServiceLevelTarget(targets, { type: task.type, complexity, priority, agencyId: task.agencyId });
    const applied = (task.slaTarget ?? null) as { targetId?: string; appliedAt?: string } | null;
    const targetFrom = applied?.targetId ?? null;
    if ((target?.id ?? null) !== targetFrom) {
      // The clock started when the request arrived (or when a submission was complete), not now.
      const startAt = applied?.appliedAt ? new Date(applied.appliedAt) : task.createdAt;
      const computed = target ? computeDueAt(target, { startAt, expirationDate: policy?.expirationDate }, calendar) : null;
      let dueAt = computed?.dueAt ?? null;
      const anchored = target?.kind === 'BEFORE_EXPIRATION';
      if (dueAt && !anchored && task.slaPausedMinutes > 0) dueAt = addBusinessMinutes(dueAt, task.slaPausedMinutes, calendar);
      data.dueAt = dueAt;
      data.slaDueAt = computed?.dueAt ?? null;
      data.slaTarget = target
        ? { ...targetSnapshot(target), appliedAt: startAt.toISOString(), opensAt: computed?.opensAt?.toISOString() ?? null, dueAt: computed?.dueAt.toISOString() ?? null, reclassifiedAt: now.toISOString() }
        : null;
      due = { from: task.dueAt?.toISOString() ?? null, to: dueAt?.toISOString() ?? null, targetFrom, targetTo: target?.id ?? null };
    }
  }

  return inTransaction(db, async (tx) => {
    const { count } = await tx.task.updateMany({ where: { id: task.id, status: task.status, updatedAt: task.updatedAt }, data });
    if (count !== 1) throw conflict(CHANGED_ELSEWHERE);
    const details = { from, to, ...(due ? { dueAtFrom: due.from, dueAtTo: due.to } : {}) };
    await tx.taskEvent.create({
      data: { taskId: task.id, agencyId: task.agencyId, actorId: scope.userId, kind: 'RECLASSIFIED', body: reason, metadata: details },
    });
    await recordAudit(tx, {
      actor: actorOf(scope), action: 'task.reclassified', entityType: 'Task', entityId: task.id, agencyId: task.agencyId,
      metadata: { reference: task.reference, ...details, ...(due ? { targetFrom: due.targetFrom, targetTo: due.targetTo } : {}) },
      ...ctx,
    });
    return tx.task.findUniqueOrThrow({ where: { id: task.id } });
  });
}

// ── Notes ──

/**
 * Adds a note to a task's timeline. Agency users' notes are always visible to
 * the agency; staff choose, defaulting to internal. When the agency replies
 * to a task waiting on them, it goes back to In Progress automatically.
 */
export async function addTaskNote(
  db: Db, scope: DeskScope, taskId: string, input: { body: string; visibility?: string | null }, ctx: Ctx = {}
): Promise<{ task: Task; resumed: boolean }> {
  const task = await getTaskForScope(db, scope, taskId, ctx);
  const body = cleanText(input.body, 'Note', 5_000, true)!;
  let visibility: DeskVisibility = 'INTERNAL';
  if (scope.kind === 'AGENCY') visibility = 'AGENCY';
  else if (input.visibility === 'AGENCY') visibility = 'AGENCY';
  else if (input.visibility != null && input.visibility !== 'INTERNAL') throw bad('Choose internal or shared with the agency.');

  const resume = scope.kind === 'AGENCY' && task.status === 'WAITING_ON_AGENCY';
  // Back to work if someone has it; otherwise back to the queue.
  const resumeTo: TaskStatus = task.assigneeId ? 'IN_PROGRESS' : 'NEW';
  const now = new Date();
  // Restarting the clock needs the calendar; only load it when resuming.
  const clock = resume ? clockChange(task, resumeTo, now, await loadBusinessCalendar(db)) : null;
  return inTransaction(db, async (tx) => {
    await tx.taskEvent.create({
      data: { taskId: task.id, agencyId: task.agencyId, actorId: scope.userId, kind: 'NOTE', visibility, body },
    });
    let resumed = false;
    if (resume) {
      const { count } = await tx.task.updateMany({
        where: { id: task.id, status: 'WAITING_ON_AGENCY' },
        data: { status: resumeTo, lastActivityAt: now, ...clock!.data },
      });
      if (count === 1) {
        resumed = true;
        await tx.taskEvent.create({
          data: {
            taskId: task.id, agencyId: task.agencyId, actorId: scope.userId, kind: 'STATUS_CHANGED', visibility: 'AGENCY',
            fromStatus: 'WAITING_ON_AGENCY', toStatus: resumeTo,
            metadata: { automatic: 'agency_replied', ...(clock!.meta ? { clock: clock!.meta } : {}) },
          },
        });
      }
    } else {
      await tx.task.update({ where: { id: task.id }, data: { lastActivityAt: new Date() } });
    }
    // The audit trail records that a note was added, not its text.
    await recordAudit(tx, {
      actor: actorOf(scope), action: 'task.note_added', entityType: 'Task', entityId: task.id, agencyId: task.agencyId,
      metadata: { reference: task.reference, visibility, length: body.length, resumed },
      ...ctx,
    });
    return { task: await tx.task.findUniqueOrThrow({ where: { id: task.id } }), resumed };
  });
}

// ── Agency view ──

/**
 * What an agency user is shown of a task: the simplified status, and none of
 * the internal fields (pod, assignee, named-staff restriction, billing, due
 * dates, escalation, or when the team last touched it). Targets are internal,
 * not guarantees (client answer Q5).
 */
export function agencyTaskView(task: Task) {
  const status = agencyStatus(task.status);
  return {
    id: task.id,
    reference: task.reference,
    type: task.type,
    title: task.title,
    description: task.description,
    priority: task.priority,
    complexity: task.complexity,
    insuredId: task.insuredId,
    policyId: task.policyId,
    status,
    statusLabel: AGENCY_STATUS_LABELS[status],
    createdAt: task.createdAt,
    completedAt: task.completedAt,
    cancelledAt: task.cancelledAt,
  };
}
