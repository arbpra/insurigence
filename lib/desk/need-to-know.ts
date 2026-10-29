/**
 * Need-to-know rules for Desk staff. Pure — safe for server and browser.
 * The access layer (Modules 9–10) combines these with agency authorisation,
 * pod membership and task assignment; this file only answers the two
 * questions that do not need the database.
 */
import type { DocumentSensitivity } from '@prisma/client';
import { isAgencyRole } from '../roles';

/** What every authorised Desk VA may open without an individual grant. */
export const DEFAULT_STAFF_SENSITIVITIES: readonly DocumentSensitivity[] = ['GENERAL', 'POLICY'];

export const SENSITIVITY_LABELS: Record<DocumentSensitivity, string> = {
  GENERAL: 'General',
  POLICY: 'Policy documents',
  FINANCIAL: 'Financial',
  PERSONAL: 'Personal information',
};

/** Roles that oversee agencies and so see every category for those agencies. */
const OVERSIGHT_ROLES = new Set(['SUPER_ADMIN', 'DESK_ADMIN', 'ACCOUNT_MANAGER']);

/**
 * May this user open a document of this sensitivity, assuming they can
 * already see the task it belongs to?
 *  - agency users: yes — it is their agency's own document;
 *  - Super Admin, Operations Manager, Account Manager: yes (oversight);
 *  - Desk VA: General and Policy, plus any category individually granted;
 *  - anyone else: no.
 */
export function maySeeSensitivity(
  role: string,
  sensitivity: DocumentSensitivity,
  granted: readonly DocumentSensitivity[] = []
): boolean {
  if (isAgencyRole(role) || OVERSIGHT_ROLES.has(role)) return true;
  if (role !== 'DESK_VA') return false;
  return DEFAULT_STAFF_SENSITIVITIES.includes(sensitivity) || granted.includes(sensitivity);
}

/**
 * Does a task's named-staff restriction let this user through? Unrestricted
 * tasks (empty list) always do. When restricted: Super Admin and Operations
 * Managers always; an Account Manager when they manage the task's agency
 * (the caller knows that from the assignment); anyone else only if named.
 * Agency users are never subject to it (the restriction is about Desk staff).
 */
export function restrictionAllows(
  restrictedToUserIds: readonly string[] | null | undefined,
  user: { id: string; role: string },
  isAgencysAccountManager = false
): boolean {
  if (!restrictedToUserIds || restrictedToUserIds.length === 0) return true;
  if (isAgencyRole(user.role)) return true;
  if (user.role === 'SUPER_ADMIN' || user.role === 'DESK_ADMIN') return true;
  if (user.role === 'ACCOUNT_MANAGER' && isAgencysAccountManager) return true;
  return restrictedToUserIds.includes(user.id);
}
