/**
 * Editing follow-up rules (Module 39): "when a request of type X is
 * completed, create a follow-up of type Y". Insurigence admins only; every
 * change is audited with before and after.
 *
 * A follow-up is a subtask of the request it follows (lib/desk/tasks.ts), so
 * the agency never sees it. Changes apply to requests completed from now on;
 * follow-ups already made stay as they are.
 *
 * Nothing is deleted: the Desk seeder recreates a missing default, so a rule
 * is switched off instead, and saving the same pair again switches it back on.
 */
import { Prisma, TaskType, type PrismaClient } from '@prisma/client';
import { DeskAccessError, isObjectId, type DeskScope, type GuardContext } from './access';
import { assertDeskPlatform } from './agency-setup';
import { recordAudit } from './audit';
import { followUpTitle, templateProblem } from './follow-ups';
import { TASK_TYPE_LABELS } from './service-levels';

type Db = PrismaClient;

const TX_OPTIONS = { timeout: 20_000, maxWait: 10_000 };
const bad = (message: string) => new DeskAccessError(400, message);
const conflict = (message: string) => new DeskAccessError(409, message);
const notFound = () => new DeskAccessError(404, 'Not found');
const CHANGED_ELSEWHERE = 'Someone else just changed this. Reload and try again.';

const isType = (v: unknown): v is TaskType => typeof v === 'string' && (Object.values(TaskType) as string[]).includes(v);

/** How the editor's examples are filled in. */
const EXAMPLE = { reference: 1042, insuredName: 'Acme Trucking' };

async function inTransaction<T>(db: Db, fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  try {
    return await db.$transaction(fn, TX_OPTIONS);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && (err.code === 'P2034' || err.code === 'P2002')) throw conflict(CHANGED_ELSEWHERE);
    throw err;
  }
}

/** Every rule (on and off), with where its follow-ups go today, and the choices for the form. */
export async function getFollowUpSetup(db: Db, scope: DeskScope) {
  assertDeskPlatform(scope);
  const [rules, pods, routing] = await Promise.all([
    db.taskFollowUpRule.findMany({ where: { triggerStatus: 'COMPLETED' }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] }),
    db.pod.findMany({ orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }], select: { id: true, name: true, isActive: true } }),
    db.taskRoutingRule.findMany({ where: { isActive: true }, select: { taskType: true, pod: { select: { id: true, name: true, isActive: true } } } }),
  ]);
  const podName = new Map(pods.map((p) => [p.id, p]));
  // Where a follow-up of this type goes when its rule names no pod (or a pod that is off): as any task of its type.
  const routedTo = (type: TaskType) => routing.find((r) => r.taskType === type && r.pod.isActive)?.pod.name ?? null;
  return {
    pods: pods.filter((p) => p.isActive).map(({ id, name }) => ({ id, name })),
    types: (Object.keys(TASK_TYPE_LABELS) as TaskType[]).map((type) => ({ type, label: TASK_TYPE_LABELS[type], routedTo: routedTo(type) })),
    example: EXAMPLE,
    rules: rules.map((r) => {
      const pod = r.podId ? podName.get(r.podId) : null;
      const goesTo = pod?.isActive ? pod.name : routedTo(r.createType);
      return {
        id: r.id, triggerType: r.triggerType, triggerLabel: TASK_TYPE_LABELS[r.triggerType],
        createType: r.createType, createLabel: TASK_TYPE_LABELS[r.createType],
        podId: pod?.isActive ? r.podId : null,
        goesTo, viaRouting: !pod?.isActive,
        titleTemplate: r.titleTemplate, example: followUpTitle(r.titleTemplate, EXAMPLE),
        billable: r.billable, isActive: r.isActive,
      };
    }),
  };
}

export interface FollowUpRuleInput {
  /** Present when editing; which request types it links then can't change. */
  id?: unknown;
  triggerType?: unknown;
  createType?: unknown;
  /** null or empty: wherever its type is routed. */
  podId?: unknown;
  titleTemplate?: unknown;
  billable?: unknown;
}

type RuleValues = { podId: string | null; titleTemplate: string; billable: boolean };

const describe = (r: { triggerType: TaskType; createType: TaskType } & RuleValues) =>
  ({ triggerType: r.triggerType, createType: r.createType, podId: r.podId, titleTemplate: r.titleTemplate, billable: r.billable });

async function parseValues(db: Db, input: FollowUpRuleInput): Promise<RuleValues> {
  if (typeof input.titleTemplate !== 'string') throw bad('Enter a title for the follow-up.');
  const problem = templateProblem(input.titleTemplate);
  if (problem) throw bad(problem);
  if (input.billable !== undefined && typeof input.billable !== 'boolean') throw bad('Choose whether follow-ups are billable.');
  const podId = input.podId === null || input.podId === undefined || input.podId === '' ? null : input.podId;
  if (podId !== null) {
    const pod = isObjectId(podId) ? await db.pod.findUnique({ where: { id: podId }, select: { isActive: true } }) : null;
    if (!pod) throw bad('Choose a pod.');
    if (!pod.isActive) throw conflict('That pod is switched off.');
  }
  return { podId: podId as string | null, titleTemplate: input.titleTemplate.trim(), billable: input.billable === true };
}

/** Creates a rule, or edits one when `id` is given. Returns the rule's id. */
export async function saveFollowUpRule(db: Db, scope: DeskScope, input: FollowUpRuleInput, ctx: GuardContext = {}): Promise<{ id: string }> {
  assertDeskPlatform(scope);
  const audit = (tx: Prisma.TransactionClient, id: string, metadata: Record<string, unknown>) => recordAudit(tx, {
    actor: { id: scope.userId, role: scope.role }, action: 'follow_up_rule.changed', entityType: 'TaskFollowUpRule', entityId: id,
    metadata, ip: ctx.ip, userAgent: ctx.userAgent,
  });

  if (input.id !== undefined) {
    if (!isObjectId(input.id)) throw notFound();
    const id = input.id;
    const current = await db.taskFollowUpRule.findUnique({ where: { id } });
    if (!current) throw notFound();
    const values = await parseValues(db, { billable: current.billable, ...input });
    if (values.podId === current.podId && values.titleTemplate === current.titleTemplate && values.billable === current.billable) return { id };
    await inTransaction(db, async (tx) => {
      // Only if nobody saved it since it was read.
      const { count } = await tx.taskFollowUpRule.updateMany({ where: { id, updatedAt: current.updatedAt }, data: values });
      if (count !== 1) throw conflict(CHANGED_ELSEWHERE);
      await audit(tx, id, { from: describe(current), to: describe({ ...current, ...values }) });
    });
    return { id };
  }

  if (!isType(input.triggerType)) throw bad('Choose the request type that starts the follow-up.');
  if (!isType(input.createType)) throw bad('Choose the type of follow-up to create.');
  const triggerType = input.triggerType;
  const createType = input.createType;
  const values = await parseValues(db, input);
  const key = { triggerType, triggerStatus: 'COMPLETED' as const, createType };
  const existing = await db.taskFollowUpRule.findUnique({ where: { triggerType_triggerStatus_createType: key } });
  if (existing?.isActive) throw conflict(`There is already a rule creating ${TASK_TYPE_LABELS[createType]} when ${TASK_TYPE_LABELS[triggerType]} is completed. Edit that one instead.`);

  return inTransaction(db, async (tx) => {
    const saved = existing
      ? await tx.taskFollowUpRule.update({ where: { id: existing.id }, data: { ...values, isActive: true } })
      : await tx.taskFollowUpRule.create({ data: { ...key, ...values } });
    await audit(tx, saved.id, { from: existing ? { ...describe(existing), isActive: false } : null, to: describe(saved) });
    return { id: saved.id };
  });
}

/** Switches a rule off (no more follow-ups from it) or back on. */
export async function setFollowUpRuleActive(db: Db, scope: DeskScope, id: unknown, isActive: unknown, ctx: GuardContext = {}): Promise<void> {
  assertDeskPlatform(scope);
  if (!isObjectId(id)) throw notFound();
  if (typeof isActive !== 'boolean') throw bad('Choose on or off.');
  const current = await db.taskFollowUpRule.findUnique({ where: { id } });
  if (!current) throw notFound();
  if (current.isActive === isActive) return;
  if (isActive && current.podId) {
    const pod = await db.pod.findUnique({ where: { id: current.podId }, select: { isActive: true } });
    if (!pod?.isActive) throw conflict('Its pod is switched off. Choose another pod for the rule first.');
  }
  await inTransaction(db, async (tx) => {
    const { count } = await tx.taskFollowUpRule.updateMany({ where: { id, isActive: current.isActive }, data: { isActive } });
    if (count !== 1) throw conflict(CHANGED_ELSEWHERE);
    await recordAudit(tx, {
      actor: { id: scope.userId, role: scope.role }, action: 'follow_up_rule.changed', entityType: 'TaskFollowUpRule', entityId: id,
      metadata: { ...describe(current), from: { isActive: current.isActive }, to: { isActive } }, ip: ctx.ip, userAgent: ctx.userAgent,
    });
  });
}
