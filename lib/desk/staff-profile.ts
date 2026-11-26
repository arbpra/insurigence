/**
 * What one Desk staff member may do and which agencies they reach, from the
 * positions they hold (Module 48). Kept apart from positions.ts so the access
 * layer can use it without an import cycle.
 *
 *  - Super Admin: every permission, every agency.
 *  - Desk staff holding positions: the union of their active positions. A
 *    position that is switched off gives nothing, so someone whose positions
 *    are all switched off has no Desk access.
 *  - Desk staff holding none: the client's default position for their role
 *    (DESK_ADMIN → COO, ACCOUNT_MANAGER → Account Manager, DESK_VA → VA). This
 *    covers the time between deploying and running `npm run db:seed:desk`,
 *    which gives everyone a position; afterwards nobody is without one (an
 *    active person's last position can't be removed).
 *  - Anyone else: nothing.
 */
import type { DeskAgencyReach, PrismaClient, Prisma, UserRole } from '@prisma/client';
import { isDeskRole } from '../roles';
import { DEFAULT_POSITIONS, PERMISSION_KEYS, isPermissionKey, type PermissionKey } from './permission-catalogue';

type Db = PrismaClient | Prisma.TransactionClient;

export interface StaffProfile {
  permissions: PermissionKey[];
  reaches: DeskAgencyReach[];
  /** What their pod positions (reach POD) allow on their own: all they may do in an agency reached only through a pod (Module 49). */
  podPermissions: PermissionKey[];
  positions: { id: string; code: string; name: string }[];
  /** True when the person holds no position and their role's default was used. */
  fallback: boolean;
}

const NOTHING: StaffProfile = { permissions: [], reaches: [], podPermissions: [], positions: [], fallback: false };

const POSITION = { id: true, code: true, name: true, reach: true, permissions: true, isActive: true } as const;
type HeldPosition = Prisma.DeskPositionGetPayload<{ select: typeof POSITION }>;

export async function staffProfile(db: Db, user: { id: string; role: string }): Promise<StaffProfile> {
  return (await staffProfiles(db, [user])).get(user.id)!;
}

/** The profiles of several people, in one query. */
export async function staffProfiles(db: Db, users: { id: string; role: string }[]): Promise<Map<string, StaffProfile>> {
  const staff = users.filter((u) => isDeskRole(u.role)).map((u) => u.id);
  const rows = staff.length
    ? await db.deskPositionHolder.findMany({ where: { userId: { in: staff } }, select: { userId: true, position: { select: POSITION } } })
    : [];
  const held = new Map<string, HeldPosition[]>();
  for (const r of rows) held.set(r.userId, [...(held.get(r.userId) ?? []), r.position]);
  return new Map(users.map((u) => [u.id, profileOf(u.role, held.get(u.id) ?? [])]));
}

/** What someone newly invited with this role starts with: the active position for it, else its default. */
export async function startingPermissions(db: Db, role: UserRole): Promise<PermissionKey[]> {
  const position = await db.deskPosition.findFirst({ where: { legacyRole: role, isActive: true }, orderBy: { sortOrder: 'asc' }, select: POSITION });
  return profileOf(role, position ? [position] : []).permissions;
}

function profileOf(role: string, held: HeldPosition[]): StaffProfile {
  if (role === 'SUPER_ADMIN') return { permissions: [...PERMISSION_KEYS], reaches: ['ALL'], podPermissions: [], positions: [], fallback: false };
  if (!isDeskRole(role)) return NOTHING;
  if (held.length === 0) {
    const preset = DEFAULT_POSITIONS.find((p) => p.legacyRole === role);
    return preset ? { permissions: [...preset.permissions], reaches: [preset.reach], podPermissions: preset.reach === 'POD' ? [...preset.permissions] : [], positions: [], fallback: true } : NOTHING;
  }
  const keys = new Set<string>();
  const podKeys = new Set<string>();
  const reaches = new Set<DeskAgencyReach>();
  const positions: StaffProfile['positions'] = [];
  for (const p of held) {
    if (!p.isActive) continue;
    reaches.add(p.reach);
    for (const k of p.permissions) { keys.add(k); if (p.reach === 'POD') podKeys.add(k); }
    positions.push({ id: p.id, code: p.code, name: p.name });
  }
  const known = (set: Set<string>) => PERMISSION_KEYS.filter((k) => set.has(k) && isPermissionKey(k));
  return { permissions: known(keys), reaches: [...reaches], podPermissions: known(podKeys), positions, fallback: false };
}
