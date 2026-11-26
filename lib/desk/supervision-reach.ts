/**
 * Whose agencies an Account Manager-type position reaches (Module 50).
 *
 *  - Themselves: the agencies where they are primary or backup AM.
 *  - With a position whose reach is "supervised agencies": also everyone who
 *    reports to them, directly or further down (DeskReportingLine), whose
 *    positions reach assigned or supervised agencies. Someone deactivated
 *    still counts, so their supervisor can reassign their agencies.
 *    A reporting line gives a person with only "assigned" reach nothing.
 *  - Cover they are giving today (DeskCoverage): the agencies the absent
 *    person is assigned to, never what that person supervises.
 *
 * The access layer (lib/desk/access.ts) turns these people into agencies.
 * Document categories, restricted requests and permissions still come only
 * from the person's own positions and grants (client: reporting relationships
 * "should not automatically grant unrestricted access to sensitive documents
 * or unauthorized agency data").
 */
import type { Prisma } from '@prisma/client';
import { staffProfiles } from './staff-profile';

type Db = Prisma.TransactionClient;

/** How far down a reporting line is followed, so a mistake can't loop. */
const MAX_DEPTH = 10;

/** A cover that is running now and hasn't been ended early. */
export function coverRunning(now: Date): Prisma.DeskCoverageWhereInput {
  return { startsAt: { lte: now }, endsAt: { gt: now }, OR: [{ endedAt: null }, { endedAt: { isSet: false } }] };
}

/** Does this profile manage agencies (assigned or supervised reach)? */
export const managesAgencies = (reaches: readonly string[]) => reaches.includes('ASSIGNED') || reaches.includes('SUPERVISED');

/** Everyone below this person in the reporting lines, nearest first, active or not. */
export async function reportsBelow(db: Db, managerId: string): Promise<{ id: string; role: string }[]> {
  const seen = new Set<string>([managerId]);
  const found: { id: string; role: string }[] = [];
  let level = [managerId];
  for (let depth = 0; depth < MAX_DEPTH && level.length; depth += 1) {
    const lines = await db.deskReportingLine.findMany({
      where: { managerId: { in: level } },
      select: { user: { select: { id: true, role: true } } },
    });
    level = [];
    for (const { user } of lines) {
      if (seen.has(user.id)) continue;
      seen.add(user.id);
      level.push(user.id);
      found.push({ id: user.id, role: user.role });
    }
  }
  return found;
}

/** The people below them who manage agencies: their team, for a supervised reach. */
export async function supervisedTeam(db: Db, managerId: string): Promise<string[]> {
  const below = await reportsBelow(db, managerId);
  if (!below.length) return [];
  const profiles = await staffProfiles(db, below);
  return below.filter((u) => managesAgencies(profiles.get(u.id)?.reaches ?? [])).map((u) => u.id);
}

/** The people this person covers right now. */
export async function coveringFor(db: Db, userId: string, now = new Date()): Promise<string[]> {
  const rows = await db.deskCoverage.findMany({ where: { coverUserId: userId, ...coverRunning(now) }, select: { absentUserId: true } });
  return [...new Set(rows.map((r) => r.absentUserId))];
}

export interface ManagedReach {
  /** Whose primary / backup assignments count: themselves, their team, and those they cover. */
  people: string[];
  /** The people below them who manage agencies (supervised reach only). */
  team: string[];
  /** The people they cover today. */
  covering: string[];
}

export async function managedReach(db: Db, userId: string, supervised: boolean, now = new Date()): Promise<ManagedReach> {
  const [team, covering] = await Promise.all([supervised ? supervisedTeam(db, userId) : Promise.resolve([]), coveringFor(db, userId, now)]);
  return { people: [...new Set([userId, ...team, ...covering])], team, covering };
}
