/**
 * Server-side entry to a Desk area: who is signed in, their Desk scope, and
 * whether they may enter. Used by the area layouts, so the check runs on the
 * server for every page and never relies on the sidebar hiding a link.
 */
import type { PrismaClient } from '@prisma/client';
import { getCurrentUser, type AuthUser } from '@/lib/auth';
import { roleLabel } from '@/lib/roles';
import { resolveDeskScope, type DeskScope } from './access';
import { AREA_ROOTS, gateArea, type AreaGate, type DeskArea } from './navigation';

export interface DeskSession {
  user: AuthUser;
  scope: DeskScope;
  gate: AreaGate;
}

/** null = not signed in (the caller sends them to /login). */
export async function enterDeskArea(db: PrismaClient, area: DeskArea): Promise<DeskSession | null> {
  const user = await getCurrentUser();
  if (!user) return null;
  const scope = await resolveDeskScope(db, user.id);
  return { user, scope, gate: gateArea(area, user.role, scope) };
}

export function loginRedirectFor(area: DeskArea): string {
  return `/login?redirect=${encodeURIComponent(AREA_ROOTS[area])}`;
}

/** Name and role line for the shell's header. */
export function shellIdentity(user: AuthUser): { name: string; roleLabel: string; initials: string } {
  const name = [user.firstName, user.lastName].filter(Boolean).join(' ') || user.email;
  const initials = ((user.firstName?.[0] ?? '') + (user.lastName?.[0] ?? '')).toUpperCase() || user.email[0].toUpperCase();
  return { name, roleLabel: roleLabel(user.role), initials };
}

export interface OverviewFact {
  label: string;
  value: string;
}

/**
 * A few facts about the user's Desk access for the placeholder overview
 * pages, read through the same scope the access layer uses — so what a page
 * says a user can reach matches what the access layer will let them reach.
 */
export async function overviewFacts(db: PrismaClient, area: DeskArea, scope: DeskScope): Promise<OverviewFact[]> {
  if (area === 'AGENCY' && scope.kind === 'AGENCY') {
    const [agency, assignment] = await Promise.all([
      db.agency.findUnique({ where: { id: scope.agencyId }, select: { name: true } }),
      db.agencyDeskAssignment.findUnique({
        where: { agencyId: scope.agencyId },
        select: { primaryAm: { select: { firstName: true, lastName: true, email: true } } },
      }),
    ]);
    const am = assignment?.primaryAm;
    return [
      { label: 'Agency', value: agency?.name ?? '—' },
      { label: 'Your accounts', value: scope.book === 'ALL' ? 'Whole book' : 'Accounts assigned to you' },
      { label: 'Account Manager', value: am ? [am.firstName, am.lastName].filter(Boolean).join(' ') || am.email : 'Not assigned yet' },
    ];
  }

  if (area === 'OPS') {
    if (scope.kind === 'ACCOUNT_MANAGER') {
      return [{ label: 'Agencies you manage', value: String(scope.agencyIds.length) }];
    }
    if (scope.kind === 'VA') {
      const podIds = [...new Set(scope.grants.map((g) => g.podId))];
      const agencyIds = [...new Set(scope.grants.map((g) => g.agencyId))];
      const pods = podIds.length ? await db.pod.findMany({ where: { id: { in: podIds } }, select: { name: true }, orderBy: { name: 'asc' } }) : [];
      return [
        { label: 'Your pods', value: pods.length ? pods.map((p) => p.name).join(', ') : 'None yet' },
        { label: 'Agencies you can work for', value: String(agencyIds.length) },
      ];
    }
  }

  if ((area === 'OPS' || area === 'ADMIN') && scope.kind === 'PLATFORM') {
    const [agencies, pods, staff] = await Promise.all([
      db.agency.count({ where: { deskEnabled: true } }),
      db.pod.count({ where: { isActive: true } }),
      db.user.count({ where: { role: { in: ['DESK_ADMIN', 'ACCOUNT_MANAGER', 'DESK_VA'] }, isActive: true } }),
    ]);
    return [
      { label: 'Agencies using The Desk', value: String(agencies) },
      { label: 'Active pods', value: String(pods) },
      { label: 'Active Desk staff', value: String(staff) },
    ];
  }

  return [];
}
