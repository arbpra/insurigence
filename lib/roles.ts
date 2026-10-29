/**
 * Role groups. Pure (no server imports) so client components can use it too.
 *
 * Three kinds of user:
 *  - Platform:  SUPER_ADMIN — everything, no agency.
 *  - Agency:    ADMIN (Owner / Admin), AGENT (shown as "Producer"), CSR — belong
 *               to exactly one agency (agencyId required).
 *  - Desk:      DESK_ADMIN, ACCOUNT_MANAGER, DESK_VA — internal Insurigence staff
 *               for The Desk. They never carry an agencyId; which agencies they
 *               can see comes only from Desk assignments, never from User.agencyId.
 *
 * The invariant "agency role ⇔ agencyId set" is enforced by `agencyIdForRole`.
 */

export const USER_ROLES = [
  'SUPER_ADMIN',
  'ADMIN',
  'AGENT',
  'CSR',
  'DESK_ADMIN',
  'ACCOUNT_MANAGER',
  'DESK_VA',
] as const;

export type Role = (typeof USER_ROLES)[number];

export const AGENCY_ROLES = ['ADMIN', 'AGENT', 'CSR'] as const satisfies readonly Role[];
export const DESK_ROLES = ['DESK_ADMIN', 'ACCOUNT_MANAGER', 'DESK_VA'] as const satisfies readonly Role[];

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (USER_ROLES as readonly string[]).includes(value);
}

export function isAgencyRole(role: string): boolean {
  return (AGENCY_ROLES as readonly string[]).includes(role);
}

export function isDeskRole(role: string): boolean {
  return (DESK_ROLES as readonly string[]).includes(role);
}

/** Who may be set as an agency's primary or backup Account Manager. */
export function canBeAccountManager(role: string): boolean {
  return role === 'ACCOUNT_MANAGER';
}

/** Who may sit in a pod: VAs, and AMs (they cover QA initially). */
export function canBePodMember(role: string): boolean {
  return role === 'DESK_VA' || role === 'ACCOUNT_MANAGER';
}

export type BookAccessLevel = 'ALL' | 'ASSIGNED';

/**
 * How much of its agency's book an agency user sees in The Desk.
 *  - ADMIN always sees all; a stored value is ignored.
 *  - AGENT (Producer) and CSR default to their assigned accounts; the agency
 *    admin can grant ALL. Defaulting to ASSIGNED is need-to-know: a wider view
 *    is something an admin chooses, never something a user gets by accident.
 *  - Non-agency roles: null — their access is not about one agency's book.
 */
export function effectiveBookAccess(role: string, stored: BookAccessLevel | null | undefined): BookAccessLevel | null {
  if (role === 'ADMIN') return 'ALL';
  if (role === 'AGENT' || role === 'CSR') return stored ?? 'ASSIGNED';
  return null;
}

/** Who may be assigned to an insured (as its producer or service contact). */
export function canBeAssignedToInsured(role: string): boolean {
  return isAgencyRole(role);
}

/** The assignment role a user gets on an insured unless chosen otherwise. */
export function defaultAssignmentRole(role: string): 'PRODUCER' | 'SERVICE' {
  return role === 'CSR' ? 'SERVICE' : 'PRODUCER';
}

export const ROLE_LABELS: Record<Role, string> = {
  SUPER_ADMIN: 'Super Admin',
  ADMIN: 'Owner / Admin',
  AGENT: 'Producer',
  CSR: 'CSR',
  DESK_ADMIN: 'Operations Manager',
  ACCOUNT_MANAGER: 'Account Manager',
  DESK_VA: 'Desk VA',
};

export function roleLabel(role: string): string {
  return isRole(role) ? ROLE_LABELS[role] : role;
}

/**
 * The agencyId a user with `role` must have. Agency roles require one; every
 * other role is forced to null so no internal account can ever match an
 * agency's data through the `record.agencyId === user.agencyId` checks.
 */
export function agencyIdForRole(
  role: Role,
  agencyId: string | null | undefined
): { ok: true; agencyId: string | null } | { ok: false; error: string } {
  if (isAgencyRole(role)) {
    if (!agencyId) return { ok: false, error: 'Agency is required for agency admins and agents' };
    return { ok: true, agencyId };
  }
  return { ok: true, agencyId: null };
}
