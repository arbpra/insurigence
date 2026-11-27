/**
 * The Pod queue and "My tasks" (Module 31): what a staff member can filter by,
 * how much is waiting, and who a task may be handed to.
 *
 * Every count and list here goes through the same access rules as the task
 * list (listWhere / taskWhere), so a number on screen can never include work
 * the person couldn't open.
 */
import type { PrismaClient } from '@prisma/client';
import { can, DeskAccessError, getTaskForScope, isStaffScope, isObjectId, resolveDeskScope, scopeIn, taskWhere, type DeskScope, type GuardContext } from './access';
import { recordAudit } from './audit';
import { CLOSED_STATUSES } from './task-filters';
import { listWhere } from './task-api';

type Db = PrismaClient;

const notFound = () => new DeskAccessError(404, 'Not found');
/** Hands work out (Module 48: `requests.assign`). */
const isManager = (s: DeskScope) => can(s, 'requests.assign');
/** Desk staff whose position works requests or hands them out. */
const isStaff = (s: DeskScope) => isStaffScope(s) && (can(s, 'requests.work') || isManager(s));
const nameOf = (p: { firstName: string | null; lastName: string | null; email: string }) =>
  [p.firstName, p.lastName].filter(Boolean).join(' ') || p.email;

/**
 * The queue is the Desk team's: anyone else gets the same "not found" as anything
 * out of reach, logged like any other refusal (Q4).
 */
/** Agency users never learn about the Desk team's own tools: "not found", and logged. */
export async function notForAgencies(db: Db, scope: DeskScope, op: string, entityId: string | null, ctx: GuardContext): Promise<never> {
  await recordAudit(db, {
    actor: { id: scope.userId, role: scope.role }, action: 'access.denied', entityType: 'Task',
    entityId: entityId && isObjectId(entityId) ? entityId : null, agencyId: scope.kind === 'AGENCY' ? scope.agencyId : null,
    metadata: { scope: scope.kind, op }, ip: ctx.ip, userAgent: ctx.userAgent,
  });
  throw notFound();
}

/** The pods and agencies a staff member can filter the queue by, and how much is waiting. */
export async function queueOptions(db: Db, scope: DeskScope, ctx: GuardContext = {}) {
  // Agency users have their own Requests list; the queue is the Desk team's.
  if (!isStaff(scope)) await notForAgencies(db, scope, 'queue', null, ctx);
  const now = new Date();

  let podWhere: { id?: { in: string[] }; isActive?: boolean } = { isActive: true };
  let agencyIds: string[] | null = null;
  if (scope.kind === 'VA') {
    podWhere = { id: { in: [...new Set(scope.grants.map((g) => g.podId))] } };
    agencyIds = [...new Set(scope.grants.map((g) => g.agencyId))];
  } else if (scope.kind === 'ACCOUNT_MANAGER') {
    // Their agencies, plus pod work another of their positions reaches.
    agencyIds = [...new Set([...scope.agencyIds, ...scope.grants.map((g) => g.agencyId)])];
    const served = await db.agencyPodAccess.findMany({ where: { agencyId: { in: scope.agencyIds } }, select: { podId: true } });
    podWhere = { id: { in: [...new Set([...served.map((s) => s.podId), ...scope.grants.map((g) => g.podId)])] }, isActive: true };
  }

  const [pods, agencies, waiting, overdue, unrouted, mine] = await Promise.all([
    db.pod.findMany({ where: podWhere, select: { id: true, name: true }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] }),
    db.agency.findMany({
      where: agencyIds ? { id: { in: agencyIds }, deskEnabled: true } : { deskEnabled: true },
      select: { id: true, name: true }, orderBy: { name: 'asc' },
    }),
    db.task.count({ where: listWhere(scope, { open: true, assignee: 'none' }, now) }),
    db.task.count({ where: listWhere(scope, { open: true, assignee: 'none', overdue: true }, now) }),
    // Work no pod has been chosen for yet; only managers see it, and route it.
    isManager(scope) ? db.task.count({ where: listWhere(scope, { open: true, assignee: 'none', podId: 'none' }, now) }) : Promise.resolve(0),
    db.task.count({ where: listWhere(scope, { open: true, mine: true }, now) }),
  ]);

  return {
    canAssign: isManager(scope),
    /**
     * Where they hand work out (Module 51), so each row offers what the server
     * allows: null = wherever they reach; otherwise their own agencies and the
     * pods they lead. Elsewhere they pick work up like any pod member.
     */
    assignIn: scope.kind === 'VA'
      ? { agencies: [] as string[], pods: [...scope.leads] }
      : scope.kind === 'ACCOUNT_MANAGER' && scope.grants.length ? { agencies: [...scope.agencyIds], pods: [...scope.leads] } : null,
    pods,
    agencies,
    counts: { waiting, overdue, unrouted, mine },
  };
}

/**
 * Who a task may be handed to: members of its pod and the agency's Account
 * Managers, each checked against their own access the same way assigning
 * checks it, so the list never offers someone the server would refuse.
 */
export async function assigneesFor(db: Db, scope: DeskScope, taskId: string, ctx: GuardContext = {}) {
  // Agency users never learn who works on the Desk team.
  if (!isStaff(scope)) await notForAgencies(db, scope, 'assignees', taskId, ctx);
  const task = await getTaskForScope(db, scope, taskId, ctx);
  // As the task service will judge it: in this agency and pod (Modules 49, 51).
  scope = scopeIn(scope, task.agencyId, task.podId);
  if (!isManager(scope)) throw new DeskAccessError(403, 'Pick up unassigned work yourself, or ask your Account Manager to reassign.');
  if ((CLOSED_STATUSES as readonly string[]).includes(task.status)) throw new DeskAccessError(409, 'This task is closed.');

  const [members, ams] = await Promise.all([
    task.podId ? db.podMember.findMany({ where: { podId: task.podId }, select: { userId: true, isLead: true } }) : Promise.resolve([]),
    db.agencyDeskAssignment.findUnique({ where: { agencyId: task.agencyId }, select: { primaryAmId: true, backupAmId: true } }),
  ]);
  const leads = new Set(members.filter((m) => m.isLead).map((m) => m.userId));
  const ids = [...new Set([...members.map((m) => m.userId), ams?.primaryAmId, ams?.backupAmId].filter((id): id is string => !!id))];
  if (!ids.length) return { assigneeId: task.assigneeId ?? null, people: [] };

  const users = await db.user.findMany({ where: { id: { in: ids }, isActive: true }, select: { id: true, firstName: true, lastName: true, email: true } });
  const eligible: { id: string; name: string; kind: 'VA' | 'ACCOUNT_MANAGER'; lead: boolean }[] = [];
  for (const user of users) {
    const theirs = await resolveDeskScope(db, user.id);
    if ((theirs.kind !== 'VA' && theirs.kind !== 'ACCOUNT_MANAGER') || !can(theirs, 'requests.work')) continue;
    const visible = await db.task.count({ where: { AND: [{ id: task.id }, taskWhere(theirs)] } });
    if (visible) eligible.push({ id: user.id, name: nameOf(user), kind: theirs.kind, lead: leads.has(user.id) });
  }

  const load = await db.task.groupBy({
    by: ['assigneeId'],
    where: { assigneeId: { in: eligible.map((p) => p.id) }, status: { notIn: [...CLOSED_STATUSES] } },
    _count: { _all: true },
  });
  const openTasks = new Map(load.map((l) => [l.assigneeId, l._count._all]));
  const people = eligible
    .map((p) => ({ ...p, openTasks: openTasks.get(p.id) ?? 0 }))
    // VAs first, the least busy at the top; then Account Managers.
    .sort((a, b) => (a.kind === b.kind ? a.openTasks - b.openTasks || a.name.localeCompare(b.name) : a.kind === 'VA' ? -1 : 1));
  return { assigneeId: task.assigneeId ?? null, people };
}
