/**
 * Editing routing and service-level targets (client answer Q5). Super Admin
 * and Operations Managers only; every change is audited with before and after.
 *
 * Changes apply to new requests. Open tasks keep the pod they were routed to
 * and the target snapshot taken when they were created (Task.slaTarget), so a
 * promise already made never changes silently.
 *
 * Nothing here is deleted: the Desk seeder recreates a missing default, so
 * "unrouted" and "removed" switch the record off, and a later save of the same
 * combination switches it back on.
 */
import { Prisma, SlaTargetKind, TaskComplexity, TaskPriority, TaskType, type PrismaClient, type ServiceLevelTarget } from '@prisma/client';
import { DeskAccessError, isObjectId, type DeskScope, type GuardContext } from './access';
import { assertDeskPlatform } from './agency-setup';
import { recordAudit } from './audit';
import { describeTarget, pickServiceLevelTarget, TASK_TYPE_LABELS, validateTarget } from './service-levels';

type Db = PrismaClient;

const TX_OPTIONS = { timeout: 20_000, maxWait: 10_000 };
const MAX_HOURS = 2_000;
const MAX_DAYS = 730;

const bad = (message: string) => new DeskAccessError(400, message);
const conflict = (message: string) => new DeskAccessError(409, message);
const CHANGED_ELSEWHERE = 'Someone else just changed this. Reload and try again.';

const oneOf = <T extends string>(values: Record<string, T>, v: unknown): v is T =>
  typeof v === 'string' && (Object.values(values) as string[]).includes(v);

const TASK_TYPES = Object.values(TaskType);

async function inTransaction<T>(db: Db, fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  try {
    return await db.$transaction(fn, TX_OPTIONS);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && (err.code === 'P2034' || err.code === 'P2002')) throw conflict(CHANGED_ELSEWHERE);
    throw err;
  }
}

const targetView = (t: ServiceLevelTarget) => ({
  id: t.id, taskType: t.taskType, complexity: t.complexity, priority: t.priority, agencyId: t.agencyId, kind: t.kind,
  businessHours: t.businessHours, businessDays: t.businessDays,
  opensDaysBeforeExpiration: t.opensDaysBeforeExpiration, dueDaysBeforeExpiration: t.dueDaysBeforeExpiration,
  note: t.note, description: describeTarget(t),
});

/** Routing and targets per request type, for the Desk or for one agency's agreement. */
export async function getRoutingSetup(db: Db, scope: DeskScope, agencyId: string | null = null) {
  assertDeskPlatform(scope);
  if (agencyId !== null && (!isObjectId(agencyId) || !(await db.agency.findUnique({ where: { id: agencyId }, select: { id: true } })))) {
    throw new DeskAccessError(404, 'Not found');
  }
  const [rules, targets, pods, agencies] = await Promise.all([
    db.taskRoutingRule.findMany({ select: { taskType: true, podId: true, defaultPriority: true, isActive: true, pod: { select: { name: true, isActive: true } } } }),
    db.serviceLevelTarget.findMany({ where: { isActive: true } }),
    db.pod.findMany({ where: { isActive: true }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }], select: { id: true, name: true } }),
    db.agency.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true } }),
  ]);
  const applicable = targets.filter((t) => t.agencyId === null || t.agencyId === agencyId);
  return {
    agencyId,
    pods,
    agencies,
    types: TASK_TYPES.map((type) => {
      const rule = rules.find((r) => r.taskType === type);
      const routed = !!rule?.isActive && !!rule.pod.isActive;
      // What a normal-priority request would get here today.
      const applies = (complexity: TaskComplexity) => {
        const hit = pickServiceLevelTarget(applicable, { type, complexity, priority: 'NORMAL', agencyId: agencyId ?? '' });
        return hit ? { description: describeTarget(hit), fromAgreement: hit.agencyId !== null } : null;
      };
      return {
        type,
        label: TASK_TYPE_LABELS[type],
        podId: routed ? rule!.podId : null,
        podName: routed ? rule!.pod.name : null,
        defaultPriority: rule?.defaultPriority ?? 'NORMAL',
        targets: targets.filter((t) => t.taskType === type && t.agencyId === agencyId).map(targetView),
        effective: { standard: applies('STANDARD'), complex: applies('COMPLEX') },
      };
    }),
  };
}

/** Where a request type goes and its default priority. podId null = unrouted, for the AM to triage. */
export async function setRouting(
  db: Db, scope: DeskScope, input: { taskType?: unknown; podId?: unknown; defaultPriority?: unknown }, ctx: GuardContext = {}
): Promise<void> {
  assertDeskPlatform(scope);
  if (!oneOf(TaskType, input.taskType)) throw bad('Choose a valid request type.');
  const taskType = input.taskType;
  const podId = input.podId === null || input.podId === '' || input.podId === undefined ? null : input.podId;
  if (input.defaultPriority !== undefined && !oneOf(TaskPriority, input.defaultPriority)) throw bad('Choose a valid priority.');

  const current = await db.taskRoutingRule.findUnique({ where: { taskType } });
  const defaultPriority = (input.defaultPriority ?? current?.defaultPriority ?? 'NORMAL') as TaskPriority;

  if (podId !== null) {
    if (!isObjectId(podId)) throw bad('Choose a pod.');
    const pod = await db.pod.findUnique({ where: { id: podId }, select: { isActive: true } });
    if (!pod) throw bad('Choose a pod.');
    if (!pod.isActive) throw conflict('That pod is switched off.');
  }

  // No rule and nothing to route to: already unrouted, and a priority alone has nowhere to live.
  if (!current && podId === null) {
    if (defaultPriority !== 'NORMAL') throw bad('Choose a pod to set a default priority.');
    return;
  }

  const before = current?.isActive ? current.podId : null;
  const priorityBefore = current?.defaultPriority ?? 'NORMAL';
  if (before === podId && priorityBefore === defaultPriority) return;

  await inTransaction(db, async (tx) => {
    // Not an upsert: unrouting keeps the rule's last pod, so there is nothing to create with.
    if (current) {
      await tx.taskRoutingRule.update({ where: { taskType }, data: { ...(podId ? { podId } : {}), defaultPriority, isActive: podId !== null } });
    } else {
      await tx.taskRoutingRule.create({ data: { taskType, podId: podId as string, defaultPriority } });
    }
    await recordAudit(tx, {
      actor: { id: scope.userId, role: scope.role }, action: 'routing.changed', entityType: 'TaskRoutingRule', entityId: taskType,
      metadata: { taskType, from: { podId: before, defaultPriority: priorityBefore }, to: { podId, defaultPriority } },
      ip: ctx.ip, userAgent: ctx.userAgent,
    });
  });
}

export interface TargetInput {
  /** Present when editing; which request the target covers then cannot change. */
  id?: unknown;
  taskType?: unknown;
  complexity?: unknown;
  priority?: unknown;
  agencyId?: unknown;
  kind?: unknown;
  businessHours?: unknown;
  businessDays?: unknown;
  opensDaysBeforeExpiration?: unknown;
  dueDaysBeforeExpiration?: unknown;
  note?: unknown;
}

function whole(value: unknown, field: string, max: number): number | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > max) throw bad(`${field} must be a whole number from 1 to ${max.toLocaleString('en-US')}.`);
  return value;
}

/** Values only, with those that do not belong to the kind cleared and checked by validateTarget. */
function parseValues(input: TargetInput) {
  if (!oneOf(SlaTargetKind, input.kind)) throw bad('Choose how the target is measured.');
  const kind = input.kind;
  const business = kind === 'BUSINESS_TIME';
  const values = {
    kind,
    businessHours: business ? whole(input.businessHours, 'Business hours', MAX_HOURS) : null,
    businessDays: business ? whole(input.businessDays, 'Business days', MAX_DAYS) : null,
    opensDaysBeforeExpiration: business ? null : whole(input.opensDaysBeforeExpiration, 'Opening days', MAX_DAYS),
    dueDaysBeforeExpiration: business ? null : whole(input.dueDaysBeforeExpiration, 'Due days', MAX_DAYS),
  };
  const problem = validateTarget(values);
  if (problem) throw bad(problem);
  // Left out = keep what is there; empty = clear it.
  let note: string | null | undefined;
  if (input.note === null) note = null;
  else if (input.note !== undefined) {
    if (typeof input.note !== 'string') throw bad('Note must be text.');
    note = input.note.trim() || null;
    if (note && note.length > 300) throw bad('Note must be 300 characters or fewer.');
  }
  return { ...values, note };
}

/** Creates a target, or edits one when `id` is given. Returns the saved target's id. */
export async function saveTarget(db: Db, scope: DeskScope, input: TargetInput, ctx: GuardContext = {}): Promise<{ id: string }> {
  assertDeskPlatform(scope);
  const values = parseValues(input);
  const audit = (tx: Prisma.TransactionClient, id: string, agencyId: string | null, metadata: Record<string, unknown>) => recordAudit(tx, {
    actor: { id: scope.userId, role: scope.role }, action: 'service_level.changed', entityType: 'ServiceLevelTarget', entityId: id, agencyId,
    metadata, ip: ctx.ip, userAgent: ctx.userAgent,
  });

  if (input.id !== undefined) {
    if (!isObjectId(input.id)) throw new DeskAccessError(404, 'Not found');
    const id = input.id;
    const current = await db.serviceLevelTarget.findUnique({ where: { id } });
    if (!current || !current.isActive) throw new DeskAccessError(404, 'Not found');
    const same = (Object.keys(values) as (keyof typeof values)[]).every((k) => values[k] === undefined || values[k] === (current[k] ?? null));
    if (same) return { id };
    await inTransaction(db, async (tx) => {
      await tx.serviceLevelTarget.update({ where: { id }, data: values });
      await audit(tx, id, current.agencyId, { taskType: current.taskType, from: describeTarget(current), to: describeTarget(values) });
    });
    return { id };
  }

  if (!oneOf(TaskType, input.taskType)) throw bad('Choose a valid request type.');
  const taskType = input.taskType;
  const complexity = input.complexity === null || input.complexity === undefined || input.complexity === '' ? null : input.complexity;
  if (complexity !== null && !oneOf(TaskComplexity, complexity)) throw bad('Choose standard, complex or both.');
  const priority = input.priority === null || input.priority === undefined || input.priority === '' ? null : input.priority;
  if (priority !== null && !oneOf(TaskPriority, priority)) throw bad('Choose a valid priority.');
  const agencyId = input.agencyId === null || input.agencyId === undefined || input.agencyId === '' ? null : input.agencyId;
  if (agencyId !== null && (!isObjectId(agencyId) || !(await db.agency.findUnique({ where: { id: agencyId }, select: { id: true } })))) throw bad('Choose an agency.');

  // Compared in memory: an empty field reads as null whether it was written or omitted.
  const rows = await db.serviceLevelTarget.findMany({ where: { taskType } });
  const existing = rows.find((t) => t.complexity === complexity && t.priority === priority && t.agencyId === agencyId);
  if (existing?.isActive) throw conflict('A target for this combination already exists. Edit that one instead.');

  return inTransaction(db, async (tx) => {
    const saved = existing
      ? await tx.serviceLevelTarget.update({ where: { id: existing.id }, data: { ...values, isActive: true } })
      : await tx.serviceLevelTarget.create({ data: { taskType, complexity: complexity as TaskComplexity | null, priority: priority as TaskPriority | null, agencyId: agencyId as string | null, ...values } });
    await audit(tx, saved.id, agencyId as string | null, { taskType, complexity, priority, from: null, to: describeTarget(values) });
    return { id: saved.id };
  });
}

export async function removeTarget(db: Db, scope: DeskScope, id: unknown, ctx: GuardContext = {}): Promise<void> {
  assertDeskPlatform(scope);
  if (!isObjectId(id)) throw new DeskAccessError(404, 'Not found');
  const current = await db.serviceLevelTarget.findUnique({ where: { id } });
  if (!current || !current.isActive) throw new DeskAccessError(404, 'Not found');
  await inTransaction(db, async (tx) => {
    await tx.serviceLevelTarget.update({ where: { id }, data: { isActive: false } });
    await recordAudit(tx, {
      actor: { id: scope.userId, role: scope.role }, action: 'service_level.changed', entityType: 'ServiceLevelTarget', entityId: id, agencyId: current.agencyId,
      metadata: { taskType: current.taskType, from: describeTarget(current), to: null }, ip: ctx.ip, userAgent: ctx.userAgent,
    });
  });
}
