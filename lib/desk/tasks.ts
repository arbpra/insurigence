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
import { DeskAccessError, getTaskForScope, resolveDeskScope, resolveSubmission, taskWhere, type DeskScope } from './access';
import { defaultBilling } from './billing';
import { completionPeriod, decideBilling, giveBack, type BillingDecision } from './billing-capture';
import {
  businessMinutesBetween, computeDueAt, extendForPause, loadBusinessCalendar, type BusinessCalendar,
} from './business-time';
import { nextTaskReference } from './sequence';
import { pickServiceLevelTarget, targetSnapshot } from './service-levels';
import { UNASSIGNED } from './task-filters';
import { agencyMaySend } from './request-form';

type Db = PrismaClient;
type Tx = Prisma.TransactionClient;
interface Ctx { ip?: string | null; userAgent?: string | null }

/** Mongo transactions over the network need more than Prisma's 5 s default. */
const TX_OPTIONS = { timeout: 20_000, maxWait: 10_000 };

const bad = (message: string) => new DeskAccessError(400, message);
const conflict = (message: string) => new DeskAccessError(409, message);
const forbidden = (message: string) => new DeskAccessError(403, message);

const CHANGED_ELSEWHERE = 'The task was changed by someone else. Refresh and try again.';

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

export const STATUS_LABELS: Record<TaskStatus, string> = {
  NEW: 'New',
  ASSIGNED: 'Assigned',
  IN_PROGRESS: 'In progress',
  WAITING_ON_AGENCY: 'Waiting on agency',
  WAITING_ON_CARRIER: 'Waiting on carrier',
  WAITING_ON_INSURED: 'Waiting on insured',
  QA_REVIEW: 'QA review',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
};

/** The simplified statuses agencies see (build plan 5.4). */
export type AgencyStatus = 'RECEIVED' | 'IN_PROGRESS' | 'NEEDS_ATTENTION' | 'COMPLETED' | 'CANCELLED';

export const AGENCY_STATUS_LABELS: Record<AgencyStatus, string> = {
  RECEIVED: 'Received',
  IN_PROGRESS: 'In progress',
  NEEDS_ATTENTION: 'Needs your attention',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
};

export function agencyStatus(status: TaskStatus): AgencyStatus {
  switch (status) {
    case 'NEW': case 'ASSIGNED': return 'RECEIVED';
    case 'WAITING_ON_AGENCY': return 'NEEDS_ATTENTION';
    case 'COMPLETED': return 'COMPLETED';
    case 'CANCELLED': return 'CANCELLED';
    default: return 'IN_PROGRESS';
  }
}

export const WAITING_STATUSES: readonly TaskStatus[] = ['WAITING_ON_AGENCY', 'WAITING_ON_CARRIER', 'WAITING_ON_INSURED'];

/**
 * Allowed status changes. Assigning and unassigning (NEW ⇄ ASSIGNED) go
 * through assignTask, not here. Reopening a completed or cancelled task is
 * for Account Managers and Operations Managers only.
 */
const TRANSITIONS: Record<TaskStatus, readonly TaskStatus[]> = {
  NEW: ['WAITING_ON_AGENCY', 'CANCELLED'],
  ASSIGNED: ['IN_PROGRESS', 'WAITING_ON_AGENCY', 'WAITING_ON_CARRIER', 'WAITING_ON_INSURED', 'CANCELLED'],
  IN_PROGRESS: ['WAITING_ON_AGENCY', 'WAITING_ON_CARRIER', 'WAITING_ON_INSURED', 'QA_REVIEW', 'COMPLETED', 'CANCELLED'],
  WAITING_ON_AGENCY: ['IN_PROGRESS', 'WAITING_ON_CARRIER', 'WAITING_ON_INSURED', 'CANCELLED'],
  WAITING_ON_CARRIER: ['IN_PROGRESS', 'WAITING_ON_AGENCY', 'WAITING_ON_INSURED', 'CANCELLED'],
  WAITING_ON_INSURED: ['IN_PROGRESS', 'WAITING_ON_AGENCY', 'WAITING_ON_CARRIER', 'CANCELLED'],
  QA_REVIEW: ['IN_PROGRESS', 'COMPLETED', 'CANCELLED'],
  COMPLETED: ['IN_PROGRESS'],
  CANCELLED: ['NEW'],
};

export function canTransition(from: TaskStatus, to: TaskStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

/** Statuses that need a reason: what is being waited for, or why it was cancelled / reopened. */
const NEEDS_REASON: readonly TaskStatus[] = [...WAITING_STATUSES, 'CANCELLED'];

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

const isStaff = (s: DeskScope) => s.kind === 'VA' || s.kind === 'ACCOUNT_MANAGER' || s.kind === 'PLATFORM';
const isManager = (s: DeskScope) => s.kind === 'ACCOUNT_MANAGER' || s.kind === 'PLATFORM';
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

  const [rule, desk, targets, policy, calendar] = await Promise.all([
    db.taskRoutingRule.findFirst({ where: { taskType: type, isActive: true, pod: { isActive: true } }, select: { podId: true, defaultPriority: true } }),
    db.agencyDeskAssignment.findUnique({
      where: { agencyId },
      select: { primaryAm: { select: { id: true, isActive: true } }, backupAm: { select: { id: true, isActive: true } } },
    }),
    db.serviceLevelTarget.findMany({ where: { taskType: type, isActive: true } }),
    policyId ? db.policy.findUnique({ where: { id: policyId }, select: { expirationDate: true } }) : null,
    loadBusinessCalendar(db),
  ]);
  const priority = (input.priority ?? rule?.defaultPriority ?? 'NORMAL') as TaskPriority;

  const now = new Date();
  const target = pickServiceLevelTarget(targets, { type, complexity, priority, agencyId });
  const due = target ? computeDueAt(target, { startAt: now, expirationDate: policy?.expirationDate }, calendar) : null;
  const slaTarget = target
    ? { ...targetSnapshot(target), appliedAt: now.toISOString(), opensAt: due?.opensAt?.toISOString() ?? null, dueAt: due?.dueAt.toISOString() ?? null }
    : null;

  const reference = await nextTaskReference(db);
  const podId = rule?.podId ?? null;
  // New work never goes to someone who has left.
  const amId = [desk?.primaryAm, desk?.backupAm].find((am) => am?.isActive)?.id ?? null;

  return inTransaction(db, async (tx) => {
    const task = await tx.task.create({
      data: {
        reference, agencyId, insuredId, policyId, type, title, description, priority, complexity,
        podId, amId,
        dueAt: due?.dueAt ?? null,
        slaDueAt: due?.dueAt ?? null,
        slaTarget: slaTarget ?? undefined,
        source: scope.kind === 'AGENCY' ? 'AGENCY' : 'INTERNAL',
        createdById: scope.userId,
        restrictedToUserIds: [],
        ...defaultBilling(type),
        lastActivityAt: now,
      },
    });
    await tx.taskEvent.create({
      data: { taskId: task.id, agencyId, actorId: scope.userId, kind: 'CREATED', visibility: 'AGENCY', body: title, toStatus: 'NEW' },
    });
    if (podId) {
      await tx.taskEvent.create({
        data: { taskId: task.id, agencyId, actorId: null, kind: 'ROUTED', metadata: { podId, automatic: true } },
      });
    }
    await recordAudit(tx, {
      actor: actorOf(scope), action: 'task.created', entityType: 'Task', entityId: task.id, agencyId,
      metadata: { reference, type, priority, complexity, podId, amId, insuredId, policyId, targetId: target?.id ?? null, dueAt: due?.dueAt.toISOString() ?? null },
      ...ctx,
    });
    return task;
  });
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
    } else if (scope.kind === 'VA') {
      if (task.assigneeId !== scope.userId) throw forbidden('Pick up the task before changing its status.');
    } else if (!isManager(scope)) {
      throw forbidden('You cannot change this task.');
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
        metadata: { reference: task.reference, from, to: toStatus, hasReason: !!reason, ...metadata },
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
    if (scope.kind === 'VA') {
      const pickUp = assigneeId === scope.userId && !task.assigneeId;
      const release = assigneeId === null && task.assigneeId === scope.userId;
      if (!pickUp && !release) throw forbidden('You can pick up unassigned tasks or release your own; ask your Account Manager to reassign.');
    }
  });
  if (task.status === 'COMPLETED' || task.status === 'CANCELLED') throw conflict('This task is closed.');

  if (assigneeId) {
    const assigneeScope = await resolveDeskScope(db, assigneeId);
    if (assigneeScope.kind !== 'VA' && assigneeScope.kind !== 'ACCOUNT_MANAGER') throw bad('Tasks can be assigned to Desk VAs and Account Managers only.');
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
