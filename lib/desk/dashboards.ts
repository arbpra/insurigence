/**
 * Department dashboards (Module 52; client, 24 Nov 2026: "Department
 * dashboards for both Directors; a consolidated dashboard for the COO").
 *
 *  - Virtual Operations (`dashboard.virtual_ops`): per pod and per person,
 *    open work, what was completed, how much met its target, QA and capacity.
 *    The Director of Virtual Operations sees every pod; a Pod Leader, the pods
 *    they lead (Module 51), their completed work included (ledPodFigures). With `usage.view` and every agency in reach, the
 *    agencies' allowances, read-only.
 *  - Agency Operations (`dashboard.agency_ops`): per agency and per Account
 *    Manager, open work, completed work and targets, utilization against
 *    allowances, and work awaiting a decision. The Director of Agency
 *    Operations sees every agency; a Senior AM, the agencies in their reach
 *    (their own and their team's, Module 50).
 *  - The COO holds both and sees both on one page.
 *
 * Never prices or contract amounts, whatever else the person may see: those
 * stay on the Usage page for `billing.prices`. Counts only, no request text.
 *
 * Counted as elsewhere, so the figures agree: open work as on the Workload
 * page (requests and subtasks); completed work and targets as on the
 * Turnaround page (requests only, in business time less waiting); usage as on
 * the Usage page (this month). QA: a request sent from QA review back to work
 * was sent back for correction; one completed from QA review passed. Each is
 * counted for the pod and the person holding the request now.
 */
import type { Prisma, PrismaClient, TaskStatus } from '@prisma/client';
import { can, DeskAccessError, ledPodFigures, podLeadScope, taskWhere, type DeskScope, type GuardContext } from './access';
import { recordAudit } from './audit';
import { loadBusinessCalendar, workdayMinutes, type BusinessCalendar } from './business-time';
import { CLOSED_STATUSES, TOP_LEVEL } from './task-filters';
import { measureTurnaround, turnaroundStats, TURNAROUND_DEFAULT_PERIOD, TURNAROUND_PERIODS, type Measured, type TurnaroundPeriod, type TurnaroundStats } from './turnaround';
import { usageReport, type CategoryUsage } from './usage';
import { add, zero, type Counts } from './workload';

type Db = PrismaClient;

/** The most completed requests, or QA decisions, one dashboard reads; beyond this it says it is partial. */
export const DASHBOARD_MAX_ROWS = 20_000;

const OPEN: Prisma.TaskWhereInput = { status: { notIn: [...CLOSED_STATUSES] } };
const nameOf = (p: { firstName: string | null; lastName: string | null; email: string }) =>
  [p.firstName, p.lastName].filter(Boolean).join(' ') || p.email;
const put = <K, V>(map: Map<K, V[]>, key: K, v: V) => (map.get(key) ?? map.set(key, []).get(key)!).push(v);

/** Which pods: every one, or the pods a Pod Leader leads. Null when not theirs. */
export function virtualReach(scope: DeskScope): { scope: DeskScope; pods: string[] | null; where: Prisma.TaskWhereInput } | null {
  if (scope.kind === 'PLATFORM') return can(scope, 'dashboard.virtual_ops') ? { scope, pods: null, where: taskWhere(scope, { counts: true }) } : null;
  const lead = podLeadScope(scope);
  return lead && can(lead, 'dashboard.virtual_ops') ? { scope: lead, pods: [...lead.leads], where: ledPodFigures(lead) } : null;
}

/** Which agencies: every one, or those in an Account Manager's reach (a Senior AM: theirs and their team's). */
export function agencyReach(scope: DeskScope): { scope: DeskScope; agencyIds: string[] | null } | null {
  if (!can(scope, 'dashboard.agency_ops')) return null;
  if (scope.kind === 'PLATFORM') return { scope, agencyIds: null };
  if (scope.kind === 'ACCOUNT_MANAGER') return { scope, agencyIds: [...scope.agencyIds] };
  return null;
}

/** Reads ?days=; anything but the periods offered is refused. */
export function dashboardOptions(p: { days?: string | null }): { days: TurnaroundPeriod } {
  const days = p.days ? Number(p.days) : TURNAROUND_DEFAULT_PERIOD;
  if (!TURNAROUND_PERIODS.includes(days as TurnaroundPeriod)) throw new DeskAccessError(400, `Choose a period of ${TURNAROUND_PERIODS.join(', ')} days.`);
  return { days: days as TurnaroundPeriod };
}

/** What a dashboard row says about completed work: how many, the typical time and targets met. */
type Done = Pick<TurnaroundStats, 'completed' | 'median' | 'withTarget' | 'met'>;
const done = (ms: Measured[] | undefined): Done => {
  const s = turnaroundStats(ms ?? []);
  return { completed: s.completed, median: s.median, withTarget: s.withTarget, met: s.met };
};

interface Qa { inReview: number; passed: number; sentBack: number }
const noQa = (): Qa => ({ inReview: 0, passed: 0, sentBack: 0 });

/** The dashboards this person may see, for the requests completed in the last `days` days. */
export async function getDashboards(db: Db, scope: DeskScope, opts: { days?: TurnaroundPeriod; now?: Date } = {}, ctx: GuardContext = {}) {
  const virtual = virtualReach(scope);
  const agency = agencyReach(scope);
  if (!virtual && !agency) {
    await recordAudit(db, {
      actor: { id: scope.userId, role: scope.role }, action: 'access.denied', entityType: 'DeskSetup', entityId: null,
      agencyId: scope.kind === 'AGENCY' ? scope.agencyId : null,
      metadata: { scope: scope.kind, op: 'dashboards' }, ip: ctx.ip, userAgent: ctx.userAgent,
    });
    throw new DeskAccessError(403, 'Your position does not include a department dashboard.');
  }
  const now = opts.now ?? new Date();
  const days = opts.days ?? TURNAROUND_DEFAULT_PERIOD;
  const from = new Date(now.getTime() - days * 86_400_000);
  const cal = await loadBusinessCalendar(db);
  const [v, a] = await Promise.all([
    virtual ? virtualDashboard(db, virtual, now, from, cal) : null,
    agency ? agencyDashboard(db, agency, now, from, cal) : null,
  ]);
  return {
    period: { days, from: from.toISOString(), to: now.toISOString() },
    calendar: { timeZone: cal.timeZone, workdayMinutes: workdayMinutes(cal) },
    virtual: v,
    agency: a,
  };
}

const COMPLETED_SELECT = {
  id: true, agencyId: true, podId: true, assigneeId: true,
  createdAt: true, completedAt: true, slaDueAt: true, slaTarget: true, slaPausedMinutes: true, slaPausedAt: true,
} as const;

/** Requests completed in the period, measured. */
async function completedIn(db: Db, where: Prisma.TaskWhereInput, from: Date, now: Date, cal: BusinessCalendar) {
  const rows = await db.task.findMany({
    where: { AND: [where, TOP_LEVEL, { agency: { is: { deskEnabled: true } } }, { status: 'COMPLETED', completedAt: { gte: from, lte: now } }] },
    select: COMPLETED_SELECT, orderBy: { completedAt: 'desc' }, take: DASHBOARD_MAX_ROWS + 1,
  });
  const truncated = rows.length > DASHBOARD_MAX_ROWS;
  if (truncated) rows.length = DASHBOARD_MAX_ROWS;
  return { truncated, rows: rows.map((t) => ({ ...t, m: measureTurnaround({ ...t, completedAt: t.completedAt! }, cal) })) };
}

/** QA decisions in the period on requests in reach: passed (completed from QA review) or sent back to work. */
async function qaDecisions(db: Db, where: Prisma.TaskWhereInput, from: Date, now: Date) {
  const events = await db.taskEvent.findMany({
    where: { kind: 'STATUS_CHANGED', fromStatus: 'QA_REVIEW', toStatus: { in: ['IN_PROGRESS', 'COMPLETED'] }, createdAt: { gte: from, lte: now } },
    select: { taskId: true, toStatus: true }, orderBy: { createdAt: 'desc' }, take: DASHBOARD_MAX_ROWS + 1,
  });
  const truncated = events.length > DASHBOARD_MAX_ROWS;
  if (truncated) events.length = DASHBOARD_MAX_ROWS;
  const tasks = events.length
    ? await db.task.findMany({ where: { AND: [where, TOP_LEVEL, { id: { in: [...new Set(events.map((e) => e.taskId))] } }] }, select: { id: true, agencyId: true, podId: true, assigneeId: true } })
    : [];
  const byId = new Map(tasks.map((t) => [t.id, t]));
  return {
    truncated,
    rows: events.flatMap((e) => {
      const t = byId.get(e.taskId);
      return t ? [{ ...t, passed: e.toStatus === 'COMPLETED' }] : [];
    }),
  };
}

function tallyQa(map: Map<string, Qa>, key: string, passed: boolean) {
  const q = map.get(key) ?? map.set(key, noQa()).get(key)!;
  if (passed) q.passed += 1; else q.sentBack += 1;
}

type OpenRow = { agencyId: string; podId: string | null; assigneeId: string | null; dueAt: Date | null; slaPausedAt: Date | null; escalated: boolean; status: TaskStatus };
const OPEN_SELECT = { agencyId: true, podId: true, assigneeId: true, dueAt: true, slaPausedAt: true, escalated: true, status: true } as const;

async function virtualDashboard(db: Db, reach: NonNullable<ReturnType<typeof virtualReach>>, now: Date, from: Date, cal: BusinessCalendar) {
  const { scope, pods: led } = reach;
  const inReach: Prisma.TaskWhereInput = { AND: [reach.where, ...(led ? [{ podId: { in: led } }] : [])] };
  const [open, completed, qa, pods, members] = await Promise.all([
    db.task.findMany({ where: { AND: [inReach, OPEN] }, select: OPEN_SELECT }) as Promise<OpenRow[]>,
    completedIn(db, inReach, from, now, cal),
    qaDecisions(db, inReach, from, now),
    db.pod.findMany({ where: led ? { id: { in: led } } : {}, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }], select: { id: true, name: true, isActive: true } }),
    db.podMember.findMany({
      where: { ...(led ? { podId: { in: led } } : {}), user: { is: { isActive: true } } },
      select: { podId: true, userId: true },
    }),
  ]);

  const total = zero();
  const totalQa = noQa();
  const podOpen = new Map<string, Counts>();
  const personOpen = new Map<string, Counts>();
  const podQa = new Map<string, Qa>();
  const personQa = new Map<string, Qa>();
  const bucket = (map: Map<string, Counts>, key: string) => map.get(key) ?? map.set(key, zero()).get(key)!;
  const qaBucket = (map: Map<string, Qa>, key: string) => map.get(key) ?? map.set(key, noQa()).get(key)!;
  for (const t of open) {
    add(total, t, now);
    add(bucket(podOpen, t.podId ?? 'none'), t, now);
    if (t.assigneeId) add(bucket(personOpen, t.assigneeId), t, now);
    if (t.status === 'QA_REVIEW') {
      totalQa.inReview += 1;
      qaBucket(podQa, t.podId ?? 'none').inReview += 1;
      if (t.assigneeId) qaBucket(personQa, t.assigneeId).inReview += 1;
    }
  }
  for (const d of qa.rows) {
    if (d.passed) totalQa.passed += 1; else totalQa.sentBack += 1;
    tallyQa(podQa, d.podId ?? 'none', d.passed);
    if (d.assigneeId) tallyQa(personQa, d.assigneeId, d.passed);
  }
  const podDone = new Map<string, Measured[]>();
  const personDone = new Map<string, Measured[]>();
  for (const t of completed.rows) {
    put(podDone, t.podId ?? 'none', t.m);
    if (t.assigneeId) put(personDone, t.assigneeId, t.m);
  }

  const membersOf = new Map<string, string[]>();
  for (const m of members) put(membersOf, m.podId, m.userId);
  const peopleIds = new Set([...members.map((m) => m.userId), ...personOpen.keys(), ...personDone.keys(), ...personQa.keys()]);
  const users = await db.user.findMany({
    where: { id: { in: [...peopleIds] } },
    select: { id: true, firstName: true, lastName: true, email: true, role: true, isActive: true },
  });
  const podName = new Map(pods.map((p) => [p.id, p.name]));
  const podsOf = new Map<string, string[]>();
  for (const m of members) if (podName.has(m.podId)) put(podsOf, m.userId, podName.get(m.podId)!);

  const people = users
    .map((u) => ({
      id: u.id, name: nameOf(u), isActive: u.isActive,
      kind: u.role === 'DESK_VA' ? 'VA' as const : u.role === 'ACCOUNT_MANAGER' ? 'ACCOUNT_MANAGER' as const : 'OTHER' as const,
      pods: podsOf.get(u.id) ?? [],
      ...(personOpen.get(u.id) ?? zero()),
      done: done(personDone.get(u.id)),
      qa: personQa.get(u.id) ?? noQa(),
    }))
    .sort((x, y) => y.open - x.open || y.done.completed - x.done.completed || x.name.localeCompare(y.name));
  const activeUser = new Set(users.filter((u) => u.isActive).map((u) => u.id));

  const podRows = [
    ...pods
      .filter((p) => p.isActive || podOpen.has(p.id) || podDone.has(p.id))
      .map((p) => {
        const ids = (membersOf.get(p.id) ?? []).filter((id) => activeUser.has(id));
        const counts = podOpen.get(p.id) ?? zero();
        return {
          id: p.id, name: p.name, isActive: p.isActive,
          ...counts,
          done: done(podDone.get(p.id)),
          qa: podQa.get(p.id) ?? noQa(),
          capacity: {
            people: ids.length,
            idle: ids.filter((id) => !(personOpen.get(id)?.open)).length,
            /** Open work in the pod per active member, to one decimal. Null with nobody in it. */
            openPerPerson: ids.length ? Math.round((counts.open / ids.length) * 10) / 10 : null,
          },
        };
      }),
    ...(!led && (podOpen.has('none') || podDone.has('none'))
      ? [{ id: 'none', name: 'No pod yet', isActive: true, ...(podOpen.get('none') ?? zero()), done: done(podDone.get('none')), qa: podQa.get('none') ?? noQa(), capacity: null }]
      : []),
  ];

  const working = people.filter((p) => p.isActive && (p.pods.length > 0 || p.open > 0));
  // Allowances read-only, only with usage and every agency in reach; never prices.
  const allowances = !led && can(scope, 'usage.view') ? allowanceSummary(await usageReport(db, scope, { now })) : null;

  return {
    /** ALL: every pod; LED_PODS: the pods this Pod Leader leads. */
    reach: led ? 'LED_PODS' as const : 'ALL' as const,
    truncated: completed.truncated || qa.truncated,
    total: { ...total, done: done(completed.rows.map((t) => t.m)), qa: totalQa },
    capacity: {
      people: working.length,
      idle: working.filter((p) => p.open === 0).length,
      openPerPerson: working.length ? Math.round((working.reduce((s, p) => s + p.open, 0) / working.length) * 10) / 10 : null,
      busiest: working.reduce((m, p) => Math.max(m, p.open), 0),
    },
    pods: podRows,
    people,
    allowances,
  };
}

type UsageReport = Awaited<ReturnType<typeof usageReport>>;
const usageCategories = (cs: CategoryUsage[]) =>
  cs.map((c) => ({ category: c.category, label: c.label, allowance: c.allowance, included: c.included, overage: c.overage, pending: c.pending, remaining: c.remaining }));

/** Allowances and use this month, per agency: units only, never prices. */
function allowanceSummary(u: UsageReport) {
  return {
    period: u.period,
    agencies: u.agencies.map((a) => ({
      id: a.id, name: a.name, plan: a.plan?.name ?? null,
      totals: { included: a.totals.included, overage: a.totals.overage, pending: a.totals.pending },
      categories: usageCategories(a.categories),
    })),
    totals: { agencies: u.totals.agencies, overAllowance: u.totals.overAllowance, pending: u.totals.pending, noPlan: u.totals.noPlan },
  };
}

async function agencyDashboard(db: Db, reach: { scope: DeskScope; agencyIds: string[] | null }, now: Date, from: Date, cal: BusinessCalendar) {
  const { scope, agencyIds } = reach;
  const agencies = await db.agency.findMany({
    where: { deskEnabled: true, ...(agencyIds ? { id: { in: agencyIds } } : {}) },
    select: { id: true, name: true, deskAssignment: { select: { primaryAmId: true } } },
    orderBy: { name: 'asc' },
  });
  const ids = agencies.map((a) => a.id);
  const inReach: Prisma.TaskWhereInput = { AND: [taskWhere(scope, { counts: true }), { agencyId: { in: ids } }] };
  const [open, completed, usage] = await Promise.all([
    db.task.findMany({ where: { AND: [inReach, OPEN] }, select: OPEN_SELECT }) as Promise<OpenRow[]>,
    completedIn(db, inReach, from, now, cal),
    can(scope, 'usage.view') ? usageReport(db, scope, { now, agencyIds: ids }) : Promise.resolve(null),
  ]);
  // Module 53: requests flagged for reclassification, waiting on someone who may change it.
  const classFlags = await db.classificationFlag.count({ where: { agencyId: { in: ids }, closedAt: null } });

  type Extra = { waitingOnAgency: number; inReview: number };
  const total = { ...zero(), waitingOnAgency: 0, inReview: 0 };
  const byAgency = new Map<string, Counts & Extra>();
  for (const t of open) {
    const row = byAgency.get(t.agencyId) ?? byAgency.set(t.agencyId, { ...zero(), waitingOnAgency: 0, inReview: 0 }).get(t.agencyId)!;
    for (const c of [total, row]) {
      add(c, t, now);
      if (t.status === 'WAITING_ON_AGENCY') c.waitingOnAgency += 1;
      if (t.status === 'QA_REVIEW') c.inReview += 1;
    }
  }
  const doneBy = new Map<string, Measured[]>();
  for (const t of completed.rows) put(doneBy, t.agencyId, t.m);
  const used = new Map((usage?.agencies ?? []).map((u) => [u.id, u]));

  const amOf = new Map(agencies.map((a) => [a.id, a.deskAssignment?.primaryAmId ?? null]));
  const amIds = [...new Set([...amOf.values()].filter((x): x is string => !!x))];
  const ams = await db.user.findMany({ where: { id: { in: amIds } }, select: { id: true, firstName: true, lastName: true, email: true, isActive: true } });
  const amName = new Map(ams.map((u) => [u.id, nameOf(u)]));

  const agencyRows = agencies.map((a) => {
    const u = used.get(a.id);
    const am = amOf.get(a.id) ?? null;
    return {
      id: a.id, name: a.name,
      am: am ? { id: am, name: amName.get(am) ?? 'Removed' } : null,
      ...(byAgency.get(a.id) ?? { ...zero(), waitingOnAgency: 0, inReview: 0 }),
      done: done(doneBy.get(a.id)),
      usage: u ? { plan: u.plan?.name ?? null, included: u.totals.included, overage: u.totals.overage, pending: u.totals.pending, categories: usageCategories(u.categories) } : null,
    };
  });

  // Each Account Manager's agencies together: the work of the agencies they are primary for.
  const byAm = new Map<string, typeof agencyRows>();
  for (const r of agencyRows) put(byAm, r.am?.id ?? 'none', r);
  const managers = [...byAm.entries()].map(([id, rows]) => {
    const sum = (f: 'open' | 'overdue' | 'escalated' | 'waitingOnAgency' | 'inReview' | 'unassigned') => rows.reduce((s, r) => s + r[f], 0);
    const ms = rows.flatMap((r) => doneBy.get(r.id) ?? []);
    return {
      id, name: id === 'none' ? 'No Account Manager' : amName.get(id) ?? 'Removed',
      isActive: id === 'none' ? true : ams.find((u) => u.id === id)?.isActive ?? false,
      agencies: rows.length,
      open: sum('open'), overdue: sum('overdue'), escalated: sum('escalated'), waitingOnAgency: sum('waitingOnAgency'), inReview: sum('inReview'), unassigned: sum('unassigned'),
      done: done(ms),
    };
  }).sort((x, y) => Number(x.id === 'none') - Number(y.id === 'none') || y.overdue - x.overdue || y.open - x.open || x.name.localeCompare(y.name));

  return {
    /** ALL: every agency; ASSIGNED: the agencies in this person's reach. */
    reach: agencyIds ? 'IN_REACH' as const : 'ALL' as const,
    truncated: completed.truncated,
    total: { agencies: agencies.length, ...total, done: done(completed.rows.map((t) => t.m)) },
    agencies: agencyRows.sort((x, y) => y.overdue - x.overdue || y.escalated - x.escalated || y.open - x.open || x.name.localeCompare(y.name)),
    managers,
    /** Usage this month (units, never prices): null without `usage.view`. */
    utilization: usage
      ? { period: usage.period, overAllowance: usage.totals.overAllowance, pending: usage.totals.pending, overageUnbilled: usage.totals.overageUnbilled, noPlan: usage.totals.noPlan }
      : null,
    /** What waits on a manager: QA sign-off, escalations, and completed work awaiting a billing decision. */
    awaiting: { inReview: total.inReview, escalated: total.escalated, billing: usage ? usage.totals.pending : null, classFlags },
  };
}

export type Dashboards = Awaited<ReturnType<typeof getDashboards>>;
