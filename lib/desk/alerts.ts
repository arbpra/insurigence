/**
 * The escalation ladder (Module 41, client answer Q5: "overdue alerts,
 * escalation to the AM then the Operations Manager").
 *
 * A scheduled check climbs each open task up three rungs, measured in
 * business time against its working due date:
 *   1. Due soon — within ALERT_SOON_MINUTES business minutes: its Account Manager is told.
 *   2. Overdue — past its due time: its Account Manager is told.
 *   3. Escalated — more than ALERT_ESCALATE_MINUTES business minutes overdue:
 *      the Operations Managers are told and the task is escalated (unless a
 *      manager already escalated it).
 * Each rung is sent once per due date. When the due date moves (a manager
 * changes it, or a wait pushes it out) the ladder starts again for the new
 * date. Work waiting on someone else is skipped: its clock is stopped.
 * A check that finds a task several rungs up (the schedule was off for a
 * while) sends only the highest rung, telling the Account Manager too.
 *
 * Safe to run from several places at once: a task climbs only if nothing
 * changed it since it was read, so no alert is sent twice. Nothing runs while
 * DESK_EMAIL_NOTIFICATIONS=off, so a test or staging copy sharing real data
 * never uses up the real alerts.
 *
 * Targets are internal (Q5): agencies see none of this. VAs see that an
 * alert went out, not to whom.
 */
import { Prisma, type PrismaClient, type Task } from '@prisma/client';
import { recordAudit } from './audit';
import { addBusinessMinutes, businessMinutesBetween, loadBusinessCalendar, type BusinessCalendar } from './business-time';
import { notificationsOff, sendAlert, type AlertRung } from './notifications';
import { closeEndedCovers } from './supervision';
import { WAITING_STATUSES } from './task-statuses';

type Db = PrismaClient;

/** Due soon: this many business minutes or fewer left (as dueState in business-time.ts). */
export const ALERT_SOON_MINUTES = 120;
/** Escalated to the Operations Managers: this many business minutes overdue. */
export const ALERT_ESCALATE_MINUTES = 240;
/** Tasks looked at per run, most urgent first; the rest wait for the next run. */
export const ALERT_BATCH_MAX = 500;
export const ALERT_JOB_ID = 'alerts';
export const AUTO_ESCALATION_REASON = `Overdue by more than ${ALERT_ESCALATE_MINUTES / 60} business hours (escalated automatically).`;

export const RUNG_KEYS = { 1: 'due_soon', 2: 'overdue', 3: 'escalated' } as const;
const TX_OPTIONS = { timeout: 20_000, maxWait: 10_000 };
const ERROR_MAX = 300;

/** The rung a task should be on now: 0 none yet, 1 due soon, 2 overdue, 3 escalate. Pure. */
export function rungFor(now: Date, dueAt: Date, cal: BusinessCalendar): 0 | AlertRung {
  if (now.getTime() > dueAt.getTime()) {
    return businessMinutesBetween(dueAt, now, cal) >= ALERT_ESCALATE_MINUTES ? 3 : 2;
  }
  return businessMinutesBetween(now, dueAt, cal) <= ALERT_SOON_MINUTES ? 1 : 0;
}

/** The rung already sent for the task's current due date. */
export function rungSent(task: Pick<Task, 'dueAt' | 'alertLevel' | 'alertDueAt'>): number {
  if (!task.dueAt || !task.alertDueAt || task.alertDueAt.getTime() !== task.dueAt.getTime()) return 0;
  return task.alertLevel ?? 0;
}

/** Equal to a value, or (for null) null or never set — MongoDB treats those apart. */
const same = <K extends 'alertLevel' | 'alertDueAt'>(field: K, value: Task[K]): Prisma.TaskWhereInput =>
  value === null ? { OR: [{ [field]: null }, { [field]: { isSet: false } }] } : { [field]: value };

export interface AlertRunResult {
  ran: boolean;
  /** Why it didn't run. */
  reason?: string;
  checked: number;
  dueSoon: number;
  overdue: number;
  escalated: number;
  /** Of those escalated, how many this check escalated (the rest a manager already had). */
  autoEscalated: number;
  emails: number;
  failed: number;
  /** Covers for absent Account Managers that ended since the last check (Module 50); only when any did. */
  coversClosed?: number;
}

/** Climbs one task to `rung`, if nothing changed it meanwhile. Returns false if it had changed. */
async function climb(db: Db, task: Task, rung: AlertRung, now: Date): Promise<{ claimed: boolean; autoEscalated: boolean; eventId?: string }> {
  const autoEscalate = rung === 3 && !task.escalated;
  try {
    return await db.$transaction(async (tx) => {
      const { count } = await tx.task.updateMany({
        where: {
          AND: [
            { id: task.id, status: task.status, dueAt: task.dueAt, escalated: task.escalated },
            same('alertLevel', task.alertLevel), same('alertDueAt', task.alertDueAt),
          ],
        },
        data: {
          alertLevel: rung, alertDueAt: task.dueAt,
          ...(autoEscalate ? { escalated: true, escalatedAt: now, escalationReason: AUTO_ESCALATION_REASON } : {}),
        },
      });
      if (count !== 1) return { claimed: false, autoEscalated: false };
      const event = await tx.taskEvent.create({
        data: { taskId: task.id, agencyId: task.agencyId, actorId: null, kind: 'ALERTED', metadata: { automatic: RUNG_KEYS[rung] } },
        select: { id: true },
      });
      await recordAudit(tx, {
        actor: null, action: 'task.alerted', entityType: 'Task', entityId: task.id, agencyId: task.agencyId,
        metadata: { reference: task.reference, rung: RUNG_KEYS[rung] },
      });
      if (autoEscalate) {
        await tx.taskEvent.create({
          data: { taskId: task.id, agencyId: task.agencyId, actorId: null, kind: 'ESCALATED', metadata: { automatic: 'overdue', reason: AUTO_ESCALATION_REASON } },
        });
        await recordAudit(tx, {
          actor: null, action: 'task.escalated', entityType: 'Task', entityId: task.id, agencyId: task.agencyId,
          metadata: { reference: task.reference, escalated: true, automatic: 'overdue' },
        });
      }
      return { claimed: true, autoEscalated: autoEscalate, eventId: event.id };
    }, TX_OPTIONS);
  } catch (err) {
    // Another check, or a person, wrote the task at the same moment: theirs stands.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2034') return { claimed: false, autoEscalated: false };
    throw err;
  }
}

/**
 * One run of the check. Called by the schedule (instrumentation.ts), the
 * scheduler route (/api/desk/cron/alerts) or script/desk-alert-check.ts.
 * Records when it ran and what it did (counts only) in DeskJobRun.
 */
export async function runAlertCheck(
  db: Db,
  opts: {
    now?: Date;
    /** Tests only: check just these agencies' work, and record the run under another name. */
    agencyIds?: string[]; jobId?: string;
  } = {}
): Promise<AlertRunResult> {
  const now = opts.now ?? new Date();
  const jobId = opts.jobId ?? ALERT_JOB_ID;
  const result: AlertRunResult = { ran: false, checked: 0, dueSoon: 0, overdue: 0, escalated: 0, autoEscalated: 0, emails: 0, failed: 0 };
  // Covers whose dates have passed end, and their open work goes back to the queue (Module 50).
  // Not on test runs, which pass their own time or agencies and must not touch real covers.
  if (!opts.now && !opts.agencyIds && !opts.jobId) {
    try {
      const closed = await closeEndedCovers(db, now);
      if (closed) result.coversClosed = closed;
    } catch (err) {
      console.error('[desk/alerts] closing ended covers failed', err);
    }
  }
  if (notificationsOff()) return { ...result, reason: 'Desk email notifications are switched off (DESK_EMAIL_NOTIFICATIONS=off).' };
  result.ran = true;
  let firstError: string | null = null;
  try {
    const cal = await loadBusinessCalendar(db);
    // Anything due before this instant has at most ALERT_SOON_MINUTES business minutes left.
    const horizon = addBusinessMinutes(now, ALERT_SOON_MINUTES + 1, cal);
    const tasks = await db.task.findMany({
      where: {
        status: { notIn: ['COMPLETED', 'CANCELLED', ...WAITING_STATUSES] },
        dueAt: { lt: horizon },
        OR: [{ slaPausedAt: null }, { slaPausedAt: { isSet: false } }],
        ...(opts.agencyIds ? { agencyId: { in: opts.agencyIds } } : {}),
      },
      orderBy: { dueAt: 'asc' },
      take: ALERT_BATCH_MAX,
    });
    result.checked = tasks.length;
    for (const task of tasks) {
      const rung = rungFor(now, task.dueAt!, cal);
      const sent = rungSent(task);
      if (rung === 0 || rung <= sent) continue;
      try {
        const { claimed, autoEscalated, eventId } = await climb(db, task, rung, now);
        if (!claimed) continue;
        if (rung === 1) result.dueSoon += 1;
        else if (rung === 2) result.overdue += 1;
        else result.escalated += 1;
        if (autoEscalated) result.autoEscalated += 1;
        const n = await sendAlert(db, task, rung, {
          alsoAccountManager: sent < 2, soonHours: ALERT_SOON_MINUTES / 60, overdueHours: ALERT_ESCALATE_MINUTES / 60,
        });
        result.emails += n;
        await db.taskEvent.update({ where: { id: eventId }, data: { metadata: { automatic: RUNG_KEYS[rung], sentTo: n } } });
      } catch (err) {
        result.failed += 1;
        firstError ??= err instanceof Error ? err.message : String(err);
        console.error(`[desk/alerts] task ${task.reference} failed`, err);
      }
    }
  } catch (err) {
    firstError ??= err instanceof Error ? err.message : String(err);
    result.failed += 1;
    console.error('[desk/alerts] the check failed', err);
  }
  const run = { startedAt: now, finishedAt: new Date(), result: { ...result } as unknown as Prisma.InputJsonValue, error: firstError?.slice(0, ERROR_MAX) ?? null };
  try {
    await db.deskJobRun.upsert({ where: { id: jobId }, create: { id: jobId, ...run }, update: run });
  } catch (err) {
    console.error('[desk/alerts] could not record the run', err);
  }
  return result;
}

/** When the check last ran, for the Workload page. Null if it never has. */
export async function lastAlertRun(db: Db, jobId = ALERT_JOB_ID) {
  const run = await db.deskJobRun.findUnique({ where: { id: jobId } });
  if (!run) return null;
  const r = (run.result ?? {}) as Partial<AlertRunResult>;
  return {
    at: (run.finishedAt ?? run.startedAt).toISOString(),
    sent: (r.dueSoon ?? 0) + (r.overdue ?? 0) + (r.escalated ?? 0),
    failed: r.failed ?? 0,
    error: run.error,
  };
}
