/**
 * The Desk's permission catalogue and default positions (Module 47; client,
 * 24 Nov 2026: "make roles, permissions, reporting relationships … configurable
 * through the Super Admin portal").
 *
 * Pure (no server imports) so the Super Admin screen can show the same labels.
 *
 * A position is a set of these permissions plus an agency reach
 * (DeskAgencyReach). Neither a position nor a reporting line opens another
 * agency's data or Financial / Personal documents by itself: the reach decides
 * which agencies, and `documents.all_categories` or an individual grant decides
 * sensitive documents (client answer Q4).
 *
 * Managing positions is not a permission: only the Super Admin does it, so no
 * one can give themselves more access.
 */
import type { DeskAgencyReach, DeskDepartment, UserRole } from '@prisma/client';

export const PERMISSION_GROUPS = ['Requests', 'Agencies', 'Oversight', 'Documents', 'Administration'] as const;
export type PermissionGroup = (typeof PERMISSION_GROUPS)[number];

export interface PermissionDef {
  key: string;
  group: PermissionGroup;
  label: string;
  description: string;
}

export const PERMISSIONS = [
  // Requests
  { key: 'requests.work', group: 'Requests', label: 'Work requests', description: 'Pick up requests in reach and work them: statuses, notes, documents, subtasks.' },
  { key: 'requests.assign', group: 'Requests', label: 'Assign and reassign', description: 'Hand requests to other people, or take them back to the queue.' },
  { key: 'requests.escalate', group: 'Requests', label: 'Escalate', description: 'Escalate a request, or clear an escalation.' },
  { key: 'requests.restrict', group: 'Requests', label: 'Restrict to named people', description: 'Limit a request and its subtasks to named VAs.' },
  { key: 'requests.classify', group: 'Requests', label: 'Reclassify and review billing', description: 'Change complexity and the billing review of a request.' },
  // Agencies
  { key: 'accounts.view', group: 'Agencies', label: 'Open agency books', description: 'Open the accounts and policies of agencies in reach, not only through requests.' },
  { key: 'accounts.edit', group: 'Agencies', label: 'Edit agency books', description: 'Add and change accounts and policies, and import books, for agencies in reach.' },
  { key: 'messages.agency', group: 'Agencies', label: 'Message agencies', description: 'Read and send the agency conversation.' },
  { key: 'agencies.setup', group: 'Agencies', label: 'Agency Desk setup', description: 'Turn The Desk on, assign Account Managers, AMS, instructions and which pods may work for the agency.' },
  // Oversight
  { key: 'workload.view', group: 'Oversight', label: 'Workload', description: 'See all work in reach across pods and people.' },
  { key: 'turnaround.view', group: 'Oversight', label: 'Turnaround reports', description: 'Turnaround by pod, person and agency.' },
  { key: 'usage.view', group: 'Oversight', label: 'Allowances and utilization', description: 'Monthly usage against plan allowances, without prices.' },
  { key: 'billing.prices', group: 'Oversight', label: 'Prices and contract amounts', description: 'Plan prices, overage prices and agency contract amounts.' },
  { key: 'audit.view', group: 'Oversight', label: 'Audit log', description: 'Read and export the audit log.' },
  // Documents
  { key: 'documents.all_categories', group: 'Documents', label: 'Financial and Personal documents', description: 'Open Financial and Personal documents in reach without an individual grant.' },
  { key: 'documents.grant', group: 'Documents', label: 'Grant document permissions', description: 'Give or remove individual Financial and Personal permissions.' },
  // Administration
  { key: 'staff.manage', group: 'Administration', label: 'Staff', description: 'Invite, rename, deactivate and reactivate Desk staff whose positions allow less than theirs.' },
  { key: 'pods.manage', group: 'Administration', label: 'Pods', description: 'Create pods and change their members. Which agencies a pod may work for is part of agency setup.' },
  { key: 'settings.operations', group: 'Administration', label: 'Operating rules', description: 'Routing, targets, follow-up rules and the business calendar.' },
  { key: 'plans.manage', group: 'Administration', label: 'Plans and pricing', description: 'Change the plan, price and contracted allowances of an agency. Needs prices and contract amounts too.' },
] as const satisfies readonly PermissionDef[];

export type PermissionKey = (typeof PERMISSIONS)[number]['key'];
export const PERMISSION_KEYS: readonly PermissionKey[] = PERMISSIONS.map((p) => p.key);
const KEYS = new Set<string>(PERMISSION_KEYS);
export const isPermissionKey = (value: unknown): value is PermissionKey => typeof value === 'string' && KEYS.has(value);

export const DEPARTMENT_LABELS: Record<DeskDepartment, string> = {
  EXECUTIVE: "COO's office",
  VIRTUAL_OPERATIONS: 'Virtual Operations',
  AGENCY_OPERATIONS: 'Agency Operations',
};

export const REACH_LABELS: Record<DeskAgencyReach, { label: string; description: string }> = {
  ALL: { label: 'All agencies', description: 'Every agency with The Desk on.' },
  SUPERVISED: { label: 'Supervised agencies', description: 'Their own agencies and those of the Account Managers they supervise.' },
  ASSIGNED: { label: 'Assigned agencies', description: 'Agencies where they are the primary or backup Account Manager.' },
  POD: { label: 'Pod authorisation', description: 'Only work in their pods, for agencies that authorise the pod or them by name.' },
};

export interface DefaultPosition {
  code: string;
  name: string;
  department: DeskDepartment;
  reach: DeskAgencyReach;
  reportsTo: string | null;
  legacyRole: UserRole | null;
  description: string;
  permissions: readonly PermissionKey[];
}

const ALL_PERMISSIONS = PERMISSION_KEYS;

/**
 * The organisation the client described on 24 Nov 2026. The CEO is the Super
 * Admin (a platform role, above positions). Defaults only: the Super Admin can
 * change any of them, and the seed never overwrites a change.
 */
export const DEFAULT_POSITIONS: readonly DefaultPosition[] = [
  {
    code: 'COO', name: 'Chief Operating Officer', department: 'EXECUTIVE', reach: 'ALL', reportsTo: null, legacyRole: 'DESK_ADMIN',
    description: 'Runs both departments. Replaces the Operations Manager.',
    permissions: ALL_PERMISSIONS,
  },
  {
    code: 'DIRECTOR_VIRTUAL_OPS', name: 'Director of Virtual Operations', department: 'VIRTUAL_OPERATIONS', reach: 'ALL', reportsTo: 'COO', legacyRole: null,
    description: 'Oversees Pod Leaders and VAs: staffing, workload, productivity, quality and execution. Allowances read-only, no prices.',
    permissions: ['requests.work', 'requests.assign', 'requests.escalate', 'workload.view', 'turnaround.view', 'usage.view', 'staff.manage', 'pods.manage', 'settings.operations'],
  },
  {
    code: 'POD_LEADER', name: 'Pod Leader', department: 'VIRTUAL_OPERATIONS', reach: 'POD', reportsTo: 'DIRECTOR_VIRTUAL_OPS', legacyRole: null,
    description: 'Leads a pod: assigns, reassigns and escalates its work.',
    permissions: ['requests.work', 'requests.assign', 'requests.escalate', 'workload.view', 'turnaround.view'],
  },
  {
    code: 'VA', name: 'Virtual Agent', department: 'VIRTUAL_OPERATIONS', reach: 'POD', reportsTo: 'POD_LEADER', legacyRole: 'DESK_VA',
    description: 'Works requests in their pods, for the agencies that authorise them.',
    permissions: ['requests.work'],
  },
  {
    code: 'DIRECTOR_AGENCY_OPS', name: 'Director of Agency Operations', department: 'AGENCY_OPERATIONS', reach: 'ALL', reportsTo: 'COO', legacyRole: null,
    description: 'Oversees Senior Account Managers, Account Managers and the agency relationships, settings, billing and utilization.',
    permissions: ['requests.assign', 'requests.escalate', 'requests.restrict', 'requests.classify', 'accounts.view', 'accounts.edit', 'messages.agency', 'agencies.setup', 'workload.view', 'turnaround.view', 'usage.view', 'billing.prices', 'documents.all_categories'],
  },
  {
    code: 'SENIOR_AM', name: 'Senior Account Manager', department: 'AGENCY_OPERATIONS', reach: 'SUPERVISED', reportsTo: 'DIRECTOR_AGENCY_OPS', legacyRole: null,
    description: 'Supervises Account Managers and covers for them. Cannot change contracts, pricing or contracted allowances.',
    permissions: ['requests.work', 'requests.assign', 'requests.escalate', 'requests.restrict', 'requests.classify', 'accounts.view', 'accounts.edit', 'messages.agency', 'turnaround.view', 'usage.view', 'billing.prices', 'documents.all_categories'],
  },
  {
    code: 'AM', name: 'Account Manager', department: 'AGENCY_OPERATIONS', reach: 'ASSIGNED', reportsTo: 'SENIOR_AM', legacyRole: 'ACCOUNT_MANAGER',
    description: 'Owns the relationship with their assigned agencies.',
    permissions: ['requests.work', 'requests.assign', 'requests.escalate', 'requests.restrict', 'requests.classify', 'accounts.view', 'accounts.edit', 'messages.agency', 'turnaround.view', 'documents.all_categories'],
  },
];

/** Reach from widest to narrowest, for showing the widest a person has. */
export const REACH_ORDER: readonly DeskAgencyReach[] = ['ALL', 'SUPERVISED', 'ASSIGNED', 'POD'];
