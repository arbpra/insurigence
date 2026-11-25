/**
 * The Account Manager's overview (also an Operations Manager's): open work,
 * what is overdue or due soon, what needs a manager's review, each agency at
 * a glance, and the policies coming up for renewal.
 *
 * Managers only. Everything is read through taskWhere / policyWhere, so an
 * Account Manager sees only their own agencies. VAs have My tasks and the Pod
 * queue; agency-wide figures are more than their work needs (Q4).
 */
import type { Prisma, PrismaClient, TaskStatus } from '@prisma/client';
import { can, DeskAccessError, policyWhere, taskWhere, type DeskScope, type GuardContext } from './access';
import { recordAudit } from './audit';
import { TASK_TYPE_LABELS } from './service-levels';
import { STATUS_LABELS } from './task-statuses';
import { CLOSED_STATUSES, UNROUTED } from './task-filters';
import { DUE_SOON_HOURS, RENEWAL_WINDOWS, REVIEW_LIMIT, OVERDUE_LIMIT, RENEWAL_LIMIT, AGENCY_LIMIT, type ReviewReason } from './dashboard-view';

type Db = PrismaClient;

const OPEN: Prisma.TaskWhereInput = { status: { notIn: [...CLOSED_STATUSES] } };
const NOT_WAITING: Prisma.TaskWhereInput = { OR: [{ slaPausedAt: null }, { slaPausedAt: { isSet: false } }] };
/** Needs a manager: QA sign-off, an escalation, or no pod chosen yet. */
const NEEDS_REVIEW: Prisma.TaskWhereInput = { OR: [{ status: 'QA_REVIEW' }, { escalated: true }, UNROUTED] };

const isManager = (s: DeskScope) => s.kind === 'ACCOUNT_MANAGER' || s.kind === 'PLATFORM';

export async function managersOnly(db: Db, scope: DeskScope, ctx: GuardContext, op = 'dashboard'): Promise<void> {
  if (isManager(scope)) return;
  await recordAudit(db, {
    actor: { id: scope.userId, role: scope.role }, action: 'access.denied', entityType: 'Task', entityId: null,
    agencyId: scope.kind === 'AGENCY' ? scope.agencyId : null,
    metadata: { scope: scope.kind, op }, ip: ctx.ip, userAgent: ctx.userAgent,
  });
  throw new DeskAccessError(404, 'Not found.');
}

const PERSON = { select: { id: true, firstName: true, lastName: true, email: true } } as const;
type Person = { id: string; firstName: string | null; lastName: string | null; email: string };
const nameOf = (p: Person | null) => (p ? [p.firstName, p.lastName].filter(Boolean).join(' ') || p.email : null);

/** Today at midnight UTC: policy dates are calendar days, stored at midnight UTC. */
function startOfUtcDay(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

export const countBy = (rows: { agencyId: string; _count: { _all: number } }[]) => new Map(rows.map((r) => [r.agencyId, r._count._all]));

/**
 * What each figure counts, for one manager. Shared by the overview and the
 * agency pages so the same work is counted the same way everywhere.
 */
export function workFilters(scope: DeskScope, now: Date, renewalDays = 60) {
  const soon = new Date(now.getTime() + DUE_SOON_HOURS * 3_600_000);
  const today = startOfUtcDay(now);
  const until = new Date(today.getTime() + (renewalDays + 1) * 86_400_000); // through the last day of the window
  // Agencies with The Desk switched off are left out, as in the agency table.
  const visible: Prisma.TaskWhereInput = { AND: [taskWhere(scope), { agency: { is: { deskEnabled: true } } }] };
  return {
    today,
    agencies: (scope.kind === 'ACCOUNT_MANAGER' ? { id: { in: scope.agencyIds }, deskEnabled: true } : { deskEnabled: true }) as Prisma.AgencyWhereInput,
    visible,
    open: { AND: [visible, OPEN] } as Prisma.TaskWhereInput,
    overdue: { AND: [visible, OPEN, NOT_WAITING, { dueAt: { lt: now } }] } as Prisma.TaskWhereInput,
    dueSoon: { AND: [visible, OPEN, NOT_WAITING, { dueAt: { gte: now, lt: soon } }] } as Prisma.TaskWhereInput,
    waiting: { AND: [visible, { status: 'WAITING_ON_AGENCY' }] } as Prisma.TaskWhereInput,
    review: { AND: [visible, OPEN, NEEDS_REVIEW] } as Prisma.TaskWhereInput,
    unrouted: { AND: [visible, OPEN, UNROUTED] } as Prisma.TaskWhereInput,
    renewals: {
      AND: [
        policyWhere(scope, { status: 'ACTIVE' }), // on an active account
        { status: { in: ['ACTIVE', 'PENDING'] }, expirationDate: { gte: today, lt: until } },
        { agency: { is: { deskEnabled: true } } },
      ],
    } as Prisma.PolicyWhereInput,
  };
}

/** Adds one agency to each filter. */
export function forAgency<T extends Record<string, unknown>>(where: T, agencyId: string): T {
  return { AND: [where, { agencyId }] } as unknown as T;
}

export async function managerDashboard(db: Db, scope: DeskScope, opts: { renewalDays?: unknown } = {}, ctx: GuardContext = {}) {
  await managersOnly(db, scope, ctx);
  const days = opts.renewalDays === undefined || opts.renewalDays === null || opts.renewalDays === '' ? 60 : Number(opts.renewalDays);
  if (!(RENEWAL_WINDOWS as readonly number[]).includes(days)) throw new DeskAccessError(400, 'Choose 30, 60 or 90 days for renewals.');

  const now = new Date();
  const f = workFilters(scope, now, days);
  const { today, visible, open } = f;
  const agencyFilter = f.agencies;
  const overdueWhere = f.overdue;
  const dueSoonWhere = f.dueSoon;
  const waitingWhere = f.waiting;
  const reviewWhere = f.review;
  const unroutedWhere = f.unrouted;
  const renewalWhere = f.renewals;

  const [
    agencies, openN, overdueN, dueSoonN, waitingN, reviewN, unroutedN,
    openBy, overdueBy, waitingBy, reviewBy, renewalBy,
    reviewRows, overdueRows, renewals, renewalN,
  ] = await Promise.all([
    db.agency.findMany({ where: agencyFilter, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    db.task.count({ where: open }),
    db.task.count({ where: overdueWhere }),
    db.task.count({ where: dueSoonWhere }),
    db.task.count({ where: waitingWhere }),
    db.task.count({ where: reviewWhere }),
    db.task.count({ where: unroutedWhere }),
    db.task.groupBy({ by: ['agencyId'], where: open, _count: { _all: true } }),
    db.task.groupBy({ by: ['agencyId'], where: overdueWhere, _count: { _all: true } }),
    db.task.groupBy({ by: ['agencyId'], where: waitingWhere, _count: { _all: true } }),
    db.task.groupBy({ by: ['agencyId'], where: reviewWhere, _count: { _all: true } }),
    db.policy.groupBy({ by: ['agencyId'], where: renewalWhere, _count: { _all: true } }),
    db.task.findMany({
      where: reviewWhere,
      select: { id: true, reference: true, type: true, title: true, status: true, escalated: true, escalationReason: true, podId: true, createdAt: true, dueAt: true, agency: { select: { id: true, name: true } } },
      // Escalations first, then the oldest.
      orderBy: [{ escalated: 'desc' }, { createdAt: 'asc' }, { id: 'asc' }],
      take: REVIEW_LIMIT,
    }),
    db.task.findMany({
      where: overdueWhere,
      select: { id: true, reference: true, type: true, title: true, status: true, dueAt: true, agency: { select: { id: true, name: true } }, assignee: PERSON },
      orderBy: [{ dueAt: 'asc' }, { id: 'asc' }],
      take: OVERDUE_LIMIT,
    }),
    listRenewals(db, renewalWhere, visible, today, RENEWAL_LIMIT),
    db.policy.count({ where: renewalWhere }),
  ]);

  const [openA, overdueA, waitingA, reviewA, renewalA] = [openBy, overdueBy, waitingBy, reviewBy, renewalBy].map(countBy);
  const agencyRows = agencies
    .map((a) => ({
      id: a.id, name: a.name,
      open: openA.get(a.id) ?? 0, overdue: overdueA.get(a.id) ?? 0, waitingOnAgency: waitingA.get(a.id) ?? 0,
      review: reviewA.get(a.id) ?? 0, renewals: renewalA.get(a.id) ?? 0,
    }))
    // The agencies needing most attention first.
    .sort((x, y) => y.overdue - x.overdue || y.review - x.review || y.open - x.open || x.name.localeCompare(y.name));

  return {
    renewalDays: days,
    /** Whether each agency's name links to its page. */
    opensAgencies: can(scope, 'accounts.view'),
    counts: { open: openN, overdue: overdueN, dueSoon: dueSoonN, waitingOnAgency: waitingN, review: reviewN, unrouted: unroutedN, renewals: renewalN, agencies: agencies.length },
    agencies: agencyRows.slice(0, AGENCY_LIMIT),
    review: reviewRows.map((t) => {
      const reasons: ReviewReason[] = [];
      if (t.escalated) reasons.push('ESCALATED');
      if (t.status === 'QA_REVIEW') reasons.push('QA');
      if (!t.podId) reasons.push('UNROUTED');
      return {
        id: t.id, reference: t.reference, title: t.title, typeLabel: TASK_TYPE_LABELS[t.type], statusLabel: STATUS_LABELS[t.status as TaskStatus],
        agency: t.agency, reasons, escalationReason: t.escalationReason, createdAt: t.createdAt, dueAt: t.dueAt,
      };
    }),
    overdue: overdueRows.map((t) => ({
      id: t.id, reference: t.reference, title: t.title, typeLabel: TASK_TYPE_LABELS[t.type], statusLabel: STATUS_LABELS[t.status as TaskStatus],
      agency: t.agency, assignee: nameOf(t.assignee), dueAt: t.dueAt,
    })),
    renewals,
  };
}

/**
 * Policies coming up for renewal, soonest first, each with its latest renewal
 * request (a cancelled one doesn't count) and how far along it is.
 */
export async function listRenewals(db: Db, where: Prisma.PolicyWhereInput, visibleTasks: Prisma.TaskWhereInput, today: Date, take: number) {
  const rows = await db.policy.findMany({
    where,
    select: {
      id: true, policyNumber: true, lineOfBusiness: true, carrierName: true, expirationDate: true,
      agency: { select: { id: true, name: true } }, insured: { select: { id: true, name: true } },
    },
    orderBy: [{ expirationDate: 'asc' }, { id: 'asc' }],
    take,
  });
  const tasks = rows.length
    ? await db.task.findMany({
        where: { AND: [visibleTasks, { policyId: { in: rows.map((p) => p.id) }, type: 'RENEWAL', status: { not: 'CANCELLED' } }] },
        select: { id: true, reference: true, status: true, policyId: true },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      })
    : [];
  const latest = new Map<string, (typeof tasks)[number]>();
  for (const t of tasks) if (t.policyId && !latest.has(t.policyId)) latest.set(t.policyId, t);
  return rows.map((p) => {
    const task = latest.get(p.id);
    return {
      id: p.id, policyNumber: p.policyNumber, lineOfBusiness: p.lineOfBusiness, carrierName: p.carrierName,
      expirationDate: p.expirationDate!.toISOString().slice(0, 10),
      daysLeft: Math.round((p.expirationDate!.getTime() - today.getTime()) / 86_400_000),
      agency: p.agency, insured: p.insured,
      renewalTask: task ? { id: task.id, reference: task.reference, statusLabel: STATUS_LABELS[task.status] } : null,
    };
  });
}
