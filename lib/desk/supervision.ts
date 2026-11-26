/**
 * Account Managers: reporting lines, cover and reassignment (Module 50).
 *
 * Client, 24 Nov 2026: the Senior Account Manager "sees the agencies,
 * accounts and requests of the AMs they supervise; covers absences; reassigns
 * agencies between authorised AMs". The Director of Agency Operations
 * oversees all of them.
 *
 * Who may do what (permission `team.manage`):
 *  - reach every agency (COO, Director of Agency Operations): any authorised
 *    Account Manager, and who reports to whom;
 *  - supervised reach (Senior AM): themselves and the Account Managers below
 *    them. They can't change reporting lines, which would widen their own reach.
 *
 * An authorised Account Manager is an active person whose positions reach
 * assigned or supervised agencies (not a role).
 *
 * Every change is audited, and open work someone can no longer reach goes
 * back to the queue, as when a position changes.
 */
import { Prisma, type PrismaClient } from '@prisma/client';
import { isDeskRole } from '@/lib/roles';
import { can, DeskAccessError, isObjectId, type DeskScope, type GuardContext } from './access';
import { recordAudit } from './audit';
import { releaseUnreachable } from './positions';
import { looksLikeCredential } from './profile';
import { staffProfiles } from './staff-profile';
import { coverRunning, managesAgencies, supervisedTeam } from './supervision-reach';
import { CLOSED_STATUSES } from './task-filters';

type Db = PrismaClient;
type Tx = Prisma.TransactionClient;

const OPEN_TASK = { status: { notIn: [...CLOSED_STATUSES] } };
const TX_OPTIONS = { timeout: 30_000, maxWait: 10_000 };
const DAY = 24 * 60 * 60 * 1000;
/** The longest single cover; a longer absence is a reassignment. */
export const MAX_COVER_DAYS = 180;
const NOTE_MAX = 300;

const bad = (message: string) => new DeskAccessError(400, message);
const conflict = (message: string) => new DeskAccessError(409, message);
const notFound = () => new DeskAccessError(404, 'Not found');
const CHANGED_ELSEWHERE = 'Someone else just changed this. Reload and try again.';

const PERSON = { id: true, firstName: true, lastName: true, email: true, role: true, isActive: true } as const;
type Person = { id: string; firstName: string | null; lastName: string | null; email: string; role: string; isActive: boolean };
const personName = (u: { firstName: string | null; lastName: string | null; email: string }) =>
  [u.firstName, u.lastName].filter(Boolean).join(' ') || u.email;

async function inTransaction<T>(db: Db, fn: (tx: Tx) => Promise<T>): Promise<T> {
  try {
    return await db.$transaction(fn, TX_OPTIONS);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && (err.code === 'P2034' || err.code === 'P2002')) throw conflict(CHANGED_ELSEWHERE);
    throw err;
  }
}

// ── Who may act on whom ──

/** All authorised Account Managers, or only these people (themselves and their team). */
type Reach = { all: true } | { all: false; people: Set<string> };

async function refuse(db: Db, scope: DeskScope, ctx: GuardContext, entityType: string, entityId: string | null, op: string, message: string): Promise<never> {
  await recordAudit(db, {
    actor: { id: scope.userId, role: scope.role }, action: 'access.denied', entityType, entityId,
    metadata: { scope: scope.kind, op, needs: ['team.manage'] }, ip: ctx.ip, userAgent: ctx.userAgent,
  });
  throw new DeskAccessError(403, message);
}

/** Whose agencies and cover this person may arrange. Refused (and logged) without `team.manage`. */
export async function teamReach(db: Db, scope: DeskScope, ctx: GuardContext = {}): Promise<Reach> {
  if (scope.kind === 'PLATFORM' && can(scope, 'team.manage')) return { all: true };
  if (scope.kind === 'ACCOUNT_MANAGER' && can(scope, 'team.manage')) {
    // Read afresh: the scope's team is from the start of the request, which is what we want, but tests build scopes by hand.
    const team = scope.team ?? await supervisedTeam(db, scope.userId);
    return { all: false, people: new Set([scope.userId, ...team]) };
  }
  return refuse(db, scope, ctx, 'DeskTeam', null, 'team', 'Your position does not allow arranging cover or reassigning agencies.');
}

const inReach = (reach: Reach, id: string) => reach.all || reach.people.has(id);

/** Active people whose positions reach assigned or supervised agencies. */
export async function authorisedManagers(db: Db | Tx, ids?: string[]): Promise<Person[]> {
  const people = await db.user.findMany({
    where: { role: { in: ['DESK_ADMIN', 'ACCOUNT_MANAGER', 'DESK_VA'] }, isActive: true, ...(ids ? { id: { in: ids } } : {}) },
    select: PERSON, orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }, { email: 'asc' }],
  });
  const profiles = await staffProfiles(db, people);
  return people.filter((p) => managesAgencies(profiles.get(p.id)?.reaches ?? []));
}

export async function isAuthorisedManager(db: Db | Tx, userId: string): Promise<boolean> {
  return isObjectId(userId) && (await authorisedManagers(db, [userId])).length === 1;
}

async function assertManagerInReach(db: Db, scope: DeskScope, reach: Reach, userId: unknown, ctx: GuardContext, what: string): Promise<string> {
  if (typeof userId !== 'string' || !(await isAuthorisedManager(db, userId))) throw bad(`Choose an active Account Manager ${what}.`);
  if (!inReach(reach, userId)) await refuse(db, scope, ctx, 'User', userId, 'team', 'You can only choose yourself or Account Managers who report to you.');
  return userId;
}

// ── Reading ──

export interface CoverView {
  id: string;
  absent: { id: string; name: string };
  cover: { id: string; name: string };
  startsAt: string;
  endsAt: string;
  note: string | null;
  running: boolean;
  canEnd: boolean;
}

export interface TeamView {
  /** Reaches every agency: sees every Account Manager and sets reporting lines. */
  everyAgency: boolean;
  managers: {
    id: string; name: string; email: string; isSelf: boolean;
    reportsTo: { id: string; name: string } | null;
    agencies: { id: string; name: string; as: 'PRIMARY' | 'BACKUP' }[];
  }[];
  agencies: { id: string; name: string; version: string; primary: { id: string; name: string } | null; backup: { id: string; name: string } | null }[];
  covers: CoverView[];
  /** Who people may report to (everyAgency only): active Desk staff. */
  possibleManagers: { id: string; name: string }[];
}

export async function getTeam(db: Db, scope: DeskScope, ctx: GuardContext = {}, now = new Date()): Promise<TeamView> {
  const reach = await teamReach(db, scope, ctx);
  const managers = (await authorisedManagers(db)).filter((m) => inReach(reach, m.id));
  const ids = managers.map((m) => m.id);
  // Agencies: those of everyone in reach, including someone deactivated whose agencies need a new AM.
  const owners = reach.all ? ids : [...reach.people];
  const [lines, assignments, covers, staff] = await Promise.all([
    db.deskReportingLine.findMany({ where: { userId: { in: ids } }, select: { userId: true, manager: { select: PERSON } } }),
    db.agencyDeskAssignment.findMany({
      where: reach.all ? { agency: { deskEnabled: true } } : { OR: [{ primaryAmId: { in: owners } }, { backupAmId: { in: owners } }], agency: { deskEnabled: true } },
      select: { agencyId: true, primaryAmId: true, backupAmId: true, agency: { select: { name: true, updatedAt: true } }, primaryAm: { select: PERSON }, backupAm: { select: PERSON } },
    }),
    db.deskCoverage.findMany({
      where: { endsAt: { gt: now }, OR: [{ endedAt: null }, { endedAt: { isSet: false } }], ...(reach.all ? {} : { AND: [{ OR: [{ absentUserId: { in: ids } }, { coverUserId: { in: ids } }] }] }) },
      orderBy: { startsAt: 'asc' },
      select: { id: true, startsAt: true, endsAt: true, note: true, absentUserId: true, coverUserId: true, absent: { select: PERSON }, cover: { select: PERSON } },
    }),
    reach.all ? db.user.findMany({ where: { role: { in: ['DESK_ADMIN', 'ACCOUNT_MANAGER', 'DESK_VA'] }, isActive: true }, select: PERSON, orderBy: [{ firstName: 'asc' }, { email: 'asc' }] }) : Promise.resolve([]),
  ]);
  // Agencies with The Desk on but no assignment yet can be given an AM by whoever reaches every agency.
  const unassigned = reach.all
    ? await db.agency.findMany({ where: { deskEnabled: true, deskAssignment: { is: null } }, select: { id: true, name: true, updatedAt: true } })
    : [];
  const reportsTo = new Map(lines.map((l) => [l.userId, { id: l.manager.id, name: personName(l.manager) }]));
  const ref = (u: Person | null) => (u ? { id: u.id, name: personName(u) } : null);
  return {
    everyAgency: reach.all,
    managers: managers.map((m) => ({
      id: m.id, name: personName(m), email: m.email, isSelf: m.id === scope.userId,
      reportsTo: reportsTo.get(m.id) ?? null,
      agencies: assignments
        .filter((a) => a.primaryAmId === m.id || a.backupAmId === m.id)
        .map((a) => ({ id: a.agencyId, name: a.agency.name, as: a.primaryAmId === m.id ? 'PRIMARY' as const : 'BACKUP' as const }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    })),
    agencies: [
      ...assignments.map((a) => ({ id: a.agencyId, name: a.agency.name, version: a.agency.updatedAt.toISOString(), primary: ref(a.primaryAm), backup: ref(a.backupAm) })),
      ...unassigned.map((a) => ({ id: a.id, name: a.name, version: a.updatedAt.toISOString(), primary: null, backup: null })),
    ].sort((a, b) => a.name.localeCompare(b.name)),
    covers: covers.map((c) => ({
      id: c.id, absent: ref(c.absent)!, cover: ref(c.cover)!, startsAt: c.startsAt.toISOString(), endsAt: c.endsAt.toISOString(), note: c.note,
      running: c.startsAt <= now, canEnd: inReach(reach, c.absentUserId),
    })),
    possibleManagers: staff.map((u) => ({ id: u.id, name: personName(u) })),
  };
}

// ── Reporting lines ──

/** Who `userId` reports to; null removes the line. Only someone who reaches every agency sets it. */
export async function setReportingLine(db: Db, scope: DeskScope, userId: string, managerId: string | null, ctx: GuardContext = {}): Promise<{ tasksReturned: number }> {
  const reach = await teamReach(db, scope, ctx);
  if (!reach.all) return refuse(db, scope, ctx, 'User', isObjectId(userId) ? userId : null, 'reporting_line', 'Only someone who reaches every agency sets who reports to whom.');
  if (!isObjectId(userId)) throw notFound();
  const user = await db.user.findUnique({ where: { id: userId }, select: { id: true, role: true } });
  if (!user || !isDeskRole(user.role)) throw notFound();
  if (userId === scope.userId) return refuse(db, scope, ctx, 'User', userId, 'reporting_line', 'You can\'t change who you report to.');
  if (managerId !== null) {
    if (typeof managerId !== 'string' || !isObjectId(managerId)) throw bad('Choose who they report to.');
    const manager = await db.user.findUnique({ where: { id: managerId }, select: { role: true, isActive: true } });
    if (!manager || !isDeskRole(manager.role) || !manager.isActive) throw bad('Choose an active member of the Desk team.');
    if (managerId === userId) throw bad('Nobody reports to themselves.');
    // No loops: the new manager must not report to this person, however far up.
    let at: string | null = managerId;
    for (let i = 0; at && i < 50; i += 1) {
      if (at === userId) throw bad('That would make a loop: they already manage the person you chose, directly or further down.');
      at = (await db.deskReportingLine.findUnique({ where: { userId: at }, select: { managerId: true } }))?.managerId ?? null;
    }
  }
  return inTransaction(db, async (tx) => {
    const before = await tx.deskReportingLine.findUnique({ where: { userId }, select: { managerId: true } });
    const from = before?.managerId ?? null;
    if (from === managerId) return { tasksReturned: 0 };
    if (managerId) {
      await tx.deskReportingLine.upsert({ where: { userId }, create: { userId, managerId, assignedById: scope.userId }, update: { managerId, assignedById: scope.userId } });
    } else {
      await tx.deskReportingLine.delete({ where: { userId } });
    }
    // Everyone who was above them may have lost their agencies.
    const above: string[] = [];
    for (let at: string | null = from, i = 0; at && i < 50; i += 1) {
      above.push(at);
      at = (await tx.deskReportingLine.findUnique({ where: { userId: at }, select: { managerId: true } }))?.managerId ?? null;
    }
    const tasksReturned = above.length ? await releaseUnreachable(tx, above, scope.userId, 'reporting_line_changed') : 0;
    await recordAudit(tx, {
      actor: { id: scope.userId, role: scope.role }, action: 'staff.reporting_line_changed', entityType: 'User', entityId: userId,
      metadata: { from, to: managerId, tasksReturned }, ip: ctx.ip, userAgent: ctx.userAgent,
    });
    return { tasksReturned };
  });
}

// ── Cover ──

function parseInstant(value: unknown, field: string): Date {
  const d = typeof value === 'string' ? new Date(value) : null;
  if (!d || Number.isNaN(d.getTime())) throw bad(`${field} must be a date and time.`);
  return d;
}

export interface CoverInput { absentUserId?: unknown; coverUserId?: unknown; startsAt?: unknown; endsAt?: unknown; note?: unknown }

/** Cover for an absent Account Manager, for set dates. */
export async function arrangeCover(db: Db, scope: DeskScope, input: CoverInput, ctx: GuardContext = {}, now = new Date()): Promise<{ id: string }> {
  const reach = await teamReach(db, scope, ctx);
  const absentUserId = await assertManagerInReach(db, scope, reach, input.absentUserId, ctx, 'who is away');
  const coverUserId = await assertManagerInReach(db, scope, reach, input.coverUserId, ctx, 'to cover');
  if (absentUserId === coverUserId) throw bad('Choose someone else to cover.');
  const startsAt = input.startsAt === undefined || input.startsAt === null || input.startsAt === '' ? now : parseInstant(input.startsAt, 'The start');
  const endsAt = parseInstant(input.endsAt, 'The end');
  if (endsAt <= startsAt) throw bad('The cover must end after it starts.');
  if (endsAt <= now) throw bad('The cover must end in the future.');
  if (endsAt.getTime() - startsAt.getTime() > MAX_COVER_DAYS * DAY) throw bad(`A cover can last at most ${MAX_COVER_DAYS} days. For longer, reassign the agencies.`);
  const note = typeof input.note === 'string' && input.note.trim() ? input.note.trim() : null;
  if (input.note !== undefined && input.note !== null && typeof input.note !== 'string') throw bad('The note must be text.');
  if (note && note.length > NOTE_MAX) throw bad(`The note must be ${NOTE_MAX} characters or fewer.`);
  const credential = looksLikeCredential(note);
  if (credential) throw bad(credential);
  return inTransaction(db, async (tx) => {
    const overlapping = await tx.deskCoverage.count({
      where: { absentUserId, startsAt: { lt: endsAt }, endsAt: { gt: startsAt }, OR: [{ endedAt: null }, { endedAt: { isSet: false } }] },
    });
    if (overlapping) throw conflict('They already have cover for part of that time. End or change that cover first.');
    // A cover who is away themselves at the time can't cover.
    const coverAway = await tx.deskCoverage.count({
      where: { absentUserId: coverUserId, startsAt: { lt: endsAt }, endsAt: { gt: startsAt }, OR: [{ endedAt: null }, { endedAt: { isSet: false } }] },
    });
    if (coverAway) throw conflict('The person you chose is away for part of that time.');
    const made = await tx.deskCoverage.create({ data: { absentUserId, coverUserId, startsAt, endsAt, note, createdById: scope.userId, endedAt: null } });
    await recordAudit(tx, {
      actor: { id: scope.userId, role: scope.role }, action: 'coverage.arranged', entityType: 'DeskCoverage', entityId: made.id,
      metadata: { absentUserId, coverUserId, startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString() }, ip: ctx.ip, userAgent: ctx.userAgent,
    });
    return { id: made.id };
  });
}

/** Ends a cover now (or cancels one not started). The cover's open work there goes back to the queue. */
export async function endCover(db: Db, scope: DeskScope, coverId: string, ctx: GuardContext = {}, now = new Date()): Promise<{ tasksReturned: number }> {
  const reach = await teamReach(db, scope, ctx);
  if (!isObjectId(coverId)) throw notFound();
  const cover = await db.deskCoverage.findUnique({ where: { id: coverId } });
  if (!cover || cover.endedAt || cover.endsAt <= now) throw notFound();
  if (!inReach(reach, cover.absentUserId)) throw notFound();
  return inTransaction(db, async (tx) => {
    const { count } = await tx.deskCoverage.updateMany({ where: { id: coverId, OR: [{ endedAt: null }, { endedAt: { isSet: false } }] }, data: { endedAt: now, endedById: scope.userId } });
    if (count !== 1) throw conflict(CHANGED_ELSEWHERE);
    const tasksReturned = await releaseUnreachable(tx, [cover.coverUserId], scope.userId, 'cover_ended');
    await recordAudit(tx, {
      actor: { id: scope.userId, role: scope.role }, action: 'coverage.ended', entityType: 'DeskCoverage', entityId: coverId,
      metadata: { absentUserId: cover.absentUserId, coverUserId: cover.coverUserId, early: cover.startsAt <= now, tasksReturned }, ip: ctx.ip, userAgent: ctx.userAgent,
    });
    return { tasksReturned };
  });
}

/**
 * Covers whose dates have passed: marked ended, and the cover's open work
 * they can no longer reach goes back to the queue. Run by the scheduled check.
 */
export async function closeEndedCovers(db: Db, now = new Date()): Promise<number> {
  const ended = await db.deskCoverage.findMany({ where: { endsAt: { lte: now }, OR: [{ endedAt: null }, { endedAt: { isSet: false } }] }, take: 200 });
  for (const cover of ended) {
    await inTransaction(db, async (tx) => {
      const { count } = await tx.deskCoverage.updateMany({ where: { id: cover.id, OR: [{ endedAt: null }, { endedAt: { isSet: false } }] }, data: { endedAt: cover.endsAt } });
      if (count !== 1) return;
      const tasksReturned = await releaseUnreachable(tx, [cover.coverUserId], null, 'cover_ended');
      await recordAudit(tx, {
        actor: null, action: 'coverage.ended', entityType: 'DeskCoverage', entityId: cover.id,
        metadata: { absentUserId: cover.absentUserId, coverUserId: cover.coverUserId, automatic: true, tasksReturned },
      });
    });
  }
  return ended.length;
}

/** The people covering for these people right now. */
export async function coversOf(db: Db | Tx, userIds: string[], now = new Date()): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (!userIds.length) return out;
  const rows = await db.deskCoverage.findMany({ where: { absentUserId: { in: userIds }, ...coverRunning(now) }, select: { absentUserId: true, coverUserId: true } });
  for (const r of rows) out.set(r.absentUserId, [...(out.get(r.absentUserId) ?? []), r.coverUserId]);
  return out;
}

// ── Reassigning an agency ──

export interface ReassignInput { primaryAmId?: unknown; backupAmId?: unknown; version?: unknown }

export async function reassignAgency(db: Db, scope: DeskScope, agencyId: string, input: ReassignInput, ctx: GuardContext = {}): Promise<{ openTasksMoved: number; stillAssigned: number }> {
  const reach = await teamReach(db, scope, ctx);
  if (!isObjectId(agencyId)) throw notFound();
  const agency = await db.agency.findUnique({
    where: { id: agencyId },
    select: { id: true, updatedAt: true, deskEnabled: true, deskAssignment: { select: { primaryAmId: true, backupAmId: true } } },
  });
  if (!agency || !agency.deskEnabled) throw notFound();
  const before = { primary: agency.deskAssignment?.primaryAmId ?? null, backup: agency.deskAssignment?.backupAmId ?? null };
  // A Senior AM reassigns only agencies their team manages; anything else is "not found".
  if (!reach.all && ![before.primary, before.backup].some((id) => id && reach.people.has(id))) {
    await recordAudit(db, {
      actor: { id: scope.userId, role: scope.role }, action: 'access.denied', entityType: 'Agency', entityId: agencyId, agencyId,
      metadata: { scope: scope.kind, op: 'reassign' }, ip: ctx.ip, userAgent: ctx.userAgent,
    });
    throw notFound();
  }
  if (input.version !== undefined && input.version !== agency.updatedAt.toISOString()) throw conflict(CHANGED_ELSEWHERE);
  const pick = (v: unknown, current: string | null, field: string): string | null => {
    if (v === undefined) return current;
    if (v === null || v === '') return null;
    if (typeof v !== 'string') throw bad(`Choose a ${field} Account Manager.`);
    return v;
  };
  const after = { primary: pick(input.primaryAmId, before.primary, 'primary'), backup: pick(input.backupAmId, before.backup, 'backup') };
  if (!after.primary) throw bad('An agency with The Desk on needs a primary Account Manager.');
  if (after.primary === after.backup) throw bad('The primary and backup Account Manager must be different people.');
  // Only newly chosen people are checked, as in agency setup.
  if (after.primary !== before.primary) await assertManagerInReach(db, scope, reach, after.primary, ctx, 'as primary');
  if (after.backup && after.backup !== before.backup) await assertManagerInReach(db, scope, reach, after.backup, ctx, 'as backup');
  if (after.primary === before.primary && after.backup === before.backup) return { openTasksMoved: 0, stillAssigned: 0 };

  const result = await inTransaction(db, async (tx) => {
    const { count } = await tx.agency.updateMany({ where: { id: agencyId, updatedAt: agency.updatedAt }, data: { updatedAt: new Date() } });
    if (count !== 1) throw conflict(CHANGED_ELSEWHERE);
    await tx.agencyDeskAssignment.upsert({
      where: { agencyId },
      create: { agencyId, primaryAmId: after.primary, backupAmId: after.backup },
      update: { primaryAmId: after.primary, backupAmId: after.backup },
    });
    // Open work follows the agency's Account Manager, as in agency setup.
    const effective = { before: before.primary ?? before.backup, after: after.primary ?? after.backup };
    const openTasksMoved = effective.after !== effective.before
      ? (await tx.task.updateMany({ where: { agencyId, ...OPEN_TASK }, data: { amId: effective.after } })).count
      : 0;
    // Whoever lost the agency (and anyone whose reach ran through them) may hold work there they can no longer see.
    const removed = [before.primary, before.backup].filter((id): id is string => !!id && id !== after.primary && id !== after.backup);
    const returned = removed.length ? await releaseUnreachable(tx, removed, scope.userId, 'agency_reassigned') : 0;
    await recordAudit(tx, {
      actor: { id: scope.userId, role: scope.role }, action: 'agency.am_reassigned', entityType: 'Agency', entityId: agencyId, agencyId,
      metadata: { from: before, to: after, openTasksMoved, tasksReturned: returned }, ip: ctx.ip, userAgent: ctx.userAgent,
    });
    return { openTasksMoved, removed };
  });
  // Work assigned to someone removed who can still see it (say, through a pod) stays; say so.
  const stillAssigned = result.removed.length ? await db.task.count({ where: { agencyId, assigneeId: { in: result.removed }, ...OPEN_TASK } }) : 0;
  return { openTasksMoved: result.openTasksMoved, stillAssigned };
}
