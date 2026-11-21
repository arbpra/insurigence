/**
 * Turnaround (Module 42, client answer Q5): how long completed requests took,
 * by pod, person, agency and request type, in business time with waiting
 * periods taken out, and how many met their internal target.
 *
 * Measured per request:
 *  - From when its clock started (the request arriving, or complete
 *    information for a submission: slaTarget.appliedAt) to completion, in
 *    business minutes (business hours, weekends and holidays).
 *  - Less the business minutes it spent waiting on the agency, carrier or
 *    insured (slaPausedMinutes, Module 13).
 *  - Against the original commitment (slaDueAt), which never moves; moving
 *    the working due date doesn't turn a miss into a hit. A business-time
 *    target is met when the time worked is within the time it allowed. An
 *    expiration-tied target (renewal, remarketing) is met when the work was
 *    done by its date, since waiting doesn't move a policy's expiration.
 *
 * Managers only. An Account Manager sees only their own agencies' work (Q4);
 * VAs are refused, and agencies never see targets (Q5: internal, not
 * guarantees). Counts and times only: no request titles or text.
 * Subtasks (Module 38) are pieces of a request, so only the request counts.
 */
import type { Prisma, PrismaClient, TaskType } from '@prisma/client';
import { DeskAccessError, isObjectId, taskWhere, type DeskScope, type GuardContext } from './access';
import { businessMinutesBetween, loadBusinessCalendar, workdayMinutes, type BusinessCalendar } from './business-time';
import { managersOnly } from './manager-dashboard';
import { TASK_TYPE_LABELS } from './service-levels';
import { TOP_LEVEL } from './task-filters';

type Db = PrismaClient;

/** The periods offered, in calendar days back from now. */
export const TURNAROUND_PERIODS = [7, 30, 90, 365] as const;
export type TurnaroundPeriod = (typeof TURNAROUND_PERIODS)[number];
export const TURNAROUND_DEFAULT_PERIOD: TurnaroundPeriod = 30;
/** The most requests one report reads; beyond this it says it is partial. */
export const TURNAROUND_MAX_TASKS = 20_000;

export interface Measured {
  /** Business minutes worked: start to completion, less waiting. */
  worked: number;
  /** Business minutes spent waiting on someone else. */
  waited: number;
  /** Met the target: true or false; null when it had none. */
  met: boolean | null;
}

type MeasureInput = {
  createdAt: Date; completedAt: Date; slaDueAt: Date | null; slaTarget: Prisma.JsonValue | null;
  slaPausedMinutes: number | null; slaPausedAt: Date | null;
};

/** One completed request's turnaround. Pure. */
export function measureTurnaround(t: MeasureInput, cal: BusinessCalendar): Measured {
  const target = (t.slaTarget ?? null) as { kind?: string; appliedAt?: string } | null;
  const applied = target?.appliedAt ? new Date(target.appliedAt) : null;
  const start = applied && !Number.isNaN(applied.getTime()) ? applied : t.createdAt;
  const elapsed = t.completedAt > start ? businessMinutesBetween(start, t.completedAt, cal) : 0;
  // A wait still open at completion counts too (completing ends it anyway).
  const open = t.slaPausedAt && t.completedAt > t.slaPausedAt ? businessMinutesBetween(t.slaPausedAt, t.completedAt, cal) : 0;
  const waited = Math.min(elapsed, (t.slaPausedMinutes ?? 0) + open);
  const worked = elapsed - waited;
  let met: boolean | null = null;
  if (t.slaDueAt) {
    met = target?.kind === 'BEFORE_EXPIRATION'
      ? t.completedAt.getTime() <= t.slaDueAt.getTime()
      : worked <= (t.slaDueAt > start ? businessMinutesBetween(start, t.slaDueAt, cal) : 0);
  }
  return { worked, waited, met };
}

export interface TurnaroundStats {
  completed: number;
  /** Business minutes worked: the middle request, and the average. Null with none. */
  median: number | null;
  average: number | null;
  /** Nine in ten were done within this many business minutes. */
  p90: number | null;
  /** Average business minutes waited per request. */
  averageWaited: number | null;
  /** Of the requests with a target, how many met it. */
  withTarget: number;
  met: number;
}

/** Summary figures for a group of measured requests. Pure. */
export function turnaroundStats(rows: Measured[]): TurnaroundStats {
  const n = rows.length;
  if (!n) return { completed: 0, median: null, average: null, p90: null, averageWaited: null, withTarget: 0, met: 0 };
  const sorted = rows.map((r) => r.worked).sort((a, b) => a - b);
  const mid = Math.floor(n / 2);
  const median = n % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
  const p90 = sorted[Math.ceil(0.9 * n) - 1];
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
  const targeted = rows.filter((r) => r.met !== null);
  return {
    completed: n,
    median,
    average: Math.round(sum(sorted) / n),
    p90,
    averageWaited: Math.round(sum(rows.map((r) => r.waited)) / n),
    withTarget: targeted.length,
    met: targeted.filter((r) => r.met).length,
  };
}

const nameOf = (p: { firstName: string | null; lastName: string | null; email: string }) =>
  [p.firstName, p.lastName].filter(Boolean).join(' ') || p.email;

/** Reads ?days=, ?type= and ?agencyId=; anything else offered is refused rather than guessed. */
export function turnaroundOptions(p: { days?: string | null; type?: string | null; agencyId?: string | null }) {
  const days = p.days ? Number(p.days) : TURNAROUND_DEFAULT_PERIOD;
  if (!TURNAROUND_PERIODS.includes(days as TurnaroundPeriod)) throw new DeskAccessError(400, `Choose a period of ${TURNAROUND_PERIODS.join(', ')} days.`);
  const type = p.type || null;
  if (type && !(type in TASK_TYPE_LABELS)) throw new DeskAccessError(400, 'Unknown request type.');
  const agencyId = p.agencyId || null;
  if (agencyId && !isObjectId(agencyId)) throw new DeskAccessError(400, 'Unknown agency.');
  return { days: days as TurnaroundPeriod, type: type as TaskType | null, agencyId };
}

/** The report: totals and each breakdown, for the requests completed in the period. */
export async function getTurnaround(
  db: Db, scope: DeskScope,
  opts: { days?: TurnaroundPeriod; type?: TaskType | null; agencyId?: string | null; now?: Date } = {},
  ctx: GuardContext = {}
) {
  await managersOnly(db, scope, ctx, 'turnaround');
  const now = opts.now ?? new Date();
  const days = opts.days ?? TURNAROUND_DEFAULT_PERIOD;
  const from = new Date(now.getTime() - days * 86_400_000);
  const where: Prisma.TaskWhereInput = {
    AND: [
      taskWhere(scope), TOP_LEVEL,
      // As on the dashboard: agencies with The Desk switched off are left out.
      { agency: { is: { deskEnabled: true } } },
      { status: 'COMPLETED', completedAt: { gte: from, lte: now } },
      ...(opts.type ? [{ type: opts.type }] : []),
      ...(opts.agencyId ? [{ agencyId: opts.agencyId }] : []),
    ],
  };
  const [cal, tasks] = await Promise.all([
    loadBusinessCalendar(db),
    db.task.findMany({
      where,
      select: {
        agencyId: true, podId: true, assigneeId: true, type: true,
        createdAt: true, completedAt: true, slaDueAt: true, slaTarget: true, slaPausedMinutes: true, slaPausedAt: true,
      },
      orderBy: { completedAt: 'desc' },
      take: TURNAROUND_MAX_TASKS + 1,
    }),
  ]);
  const truncated = tasks.length > TURNAROUND_MAX_TASKS;
  if (truncated) tasks.length = TURNAROUND_MAX_TASKS;

  const all: Measured[] = [];
  const groups = { pod: new Map<string, Measured[]>(), person: new Map<string, Measured[]>(), agency: new Map<string, Measured[]>(), type: new Map<string, Measured[]>() };
  const put = (map: Map<string, Measured[]>, key: string, m: Measured) => (map.get(key) ?? map.set(key, []).get(key)!).push(m);
  for (const t of tasks) {
    const m = measureTurnaround({ ...t, completedAt: t.completedAt! }, cal);
    all.push(m);
    put(groups.pod, t.podId ?? 'none', m);
    put(groups.person, t.assigneeId ?? 'none', m);
    put(groups.agency, t.agencyId, m);
    put(groups.type, t.type, m);
  }

  const ids = (map: Map<string, Measured[]>) => [...map.keys()].filter((k) => k !== 'none');
  const [pods, people, agencies] = await Promise.all([
    db.pod.findMany({ where: { id: { in: ids(groups.pod) } }, select: { id: true, name: true, isActive: true } }),
    db.user.findMany({ where: { id: { in: ids(groups.person) } }, select: { id: true, firstName: true, lastName: true, email: true, role: true, isActive: true } }),
    db.agency.findMany({ where: { id: { in: ids(groups.agency) } }, select: { id: true, name: true } }),
  ]);
  const byCount = <T extends { name: string } & TurnaroundStats>(rows: T[]) => rows.sort((a, b) => b.completed - a.completed || a.name.localeCompare(b.name));
  const rowsOf = <T extends { id: string }>(map: Map<string, Measured[]>, found: T[], describe: (x: T) => { name: string } & Record<string, unknown>, none: string) => {
    const known = new Map(found.map((x) => [x.id, x]));
    return byCount([...map.entries()].map(([id, ms]) => {
      const x = known.get(id);
      return { id, ...(x ? describe(x) : { name: id === 'none' ? none : 'Removed' }), ...turnaroundStats(ms) };
    }));
  };

  return {
    period: { days, from: from.toISOString(), to: now.toISOString() },
    filters: { type: opts.type ?? null, agencyId: opts.agencyId ?? null },
    /** For reading the figures: business minutes in a working day, and the Desk's time zone. */
    calendar: { timeZone: cal.timeZone, workdayMinutes: workdayMinutes(cal) },
    truncated,
    total: turnaroundStats(all),
    pods: rowsOf(groups.pod, pods, (p) => ({ name: p.name, isActive: p.isActive }), 'No pod'),
    people: rowsOf(groups.person, people, (u) => ({
      name: nameOf(u), isActive: u.isActive,
      kind: u.role === 'DESK_VA' ? 'VA' : u.role === 'ACCOUNT_MANAGER' ? 'ACCOUNT_MANAGER' : 'OTHER',
    }), 'Nobody assigned'),
    agencies: rowsOf(groups.agency, agencies, (a) => ({ name: a.name }), 'Removed'),
    types: byCount([...groups.type.entries()].map(([id, ms]) => ({ id, name: TASK_TYPE_LABELS[id as TaskType] ?? id, ...turnaroundStats(ms) }))),
    /** The agencies this manager may filter by. */
    agencyChoices: (await db.agency.findMany({
      where: { deskEnabled: true, ...(scope.kind === 'ACCOUNT_MANAGER' ? { id: { in: scope.agencyIds } } : {}) },
      select: { id: true, name: true }, orderBy: { name: 'asc' },
    })),
  };
}

export type TurnaroundReport = Awaited<ReturnType<typeof getTurnaround>>;
