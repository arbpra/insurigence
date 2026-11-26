/**
 * The Desk's navigation: which area each user may enter, where they land
 * after login, and what their sidebar shows. Pure (no server imports) so the
 * client shell and the server gates share one source of truth.
 *
 * Three route areas:
 *  - AGENCY  `/desk`             agency users in a Desk-enabled agency
 *  - OPS     `/desk-ops`         Desk staff (and Super Admin)
 *  - ADMIN   `/super-admin/desk` Desk setup: Super Admin, and staff whose
 *                                position allows some part of setup
 *
 * Desk staff items depend on the person's positions (Module 48): the
 * permissions they hold and, for all-agency pages, their reach. Agency items
 * still depend on the agency role. A bare role stands for that role's default
 * position (used by tests and before positions are loaded).
 *
 * The sidebar only decides what is shown. What a user can actually read is
 * still decided per record by lib/desk/access.ts.
 */
import type { DeskScope } from './access';
import { DEFAULT_POSITIONS, PERMISSION_KEYS, type PermissionKey } from './permission-catalogue';
import { DESK_NOT_ENABLED } from './scope-reasons';

export type DeskArea = 'AGENCY' | 'OPS' | 'ADMIN';

export const AREA_ROOTS: Record<DeskArea, string> = {
  AGENCY: '/desk',
  OPS: '/desk-ops',
  ADMIN: '/super-admin/desk',
};

export const AREA_TITLES: Record<DeskArea, string> = {
  AGENCY: 'The Desk',
  OPS: 'Desk Operations',
  ADMIN: 'Desk Setup',
};

export type DeskIcon =
  | 'home' | 'inbox' | 'plus' | 'users' | 'upload' | 'chat' | 'shield'
  | 'queue' | 'check' | 'building' | 'layers' | 'chart' | 'receipt'
  | 'staff' | 'route' | 'calendar' | 'repeat';

export interface DeskNavItem {
  label: string;
  href: string;
  icon: DeskIcon;
  /** The build-plan module that delivers the page (shown on placeholders). */
  module: number;
  /** One line describing what the page will do. */
  summary: string;
  /** Roles that see the item; omitted = any role. Used for agency roles and the Super Admin. */
  roles?: readonly string[];
  /** Desk staff: any one of these permissions; omitted = none needed. */
  permissions?: readonly PermissionKey[];
  /** Desk staff: the scope kinds (reach) the page works for; omitted = any. */
  kinds?: readonly DeskScope['kind'][];
}

/** What navigation needs to know about a person: plain data, so the browser shell can use it. */
export interface NavAccess {
  role: string;
  kind: DeskScope['kind'];
  permissions: readonly string[];
}

/** Any of these opens Desk setup. */
export const SETUP_PERMISSIONS: readonly PermissionKey[] = ['agencies.setup', 'staff.manage', 'pods.manage', 'documents.grant', 'settings.operations', 'plans.manage'];

const WORK: readonly PermissionKey[] = ['requests.work', 'requests.assign'];
const MANAGED: readonly DeskScope['kind'][] = ['PLATFORM', 'ACCOUNT_MANAGER'];
const ALL_AGENCIES: readonly DeskScope['kind'][] = ['PLATFORM'];

/** The navigation view of a resolved scope. */
export function navAccess(scope: DeskScope): NavAccess {
  return { role: scope.role, kind: scope.kind, permissions: 'permissions' in scope ? [...scope.permissions] : [] };
}

/** A bare role read as its default position (the Super Admin has everything). */
function accessForRole(role: string): NavAccess {
  if (role === 'SUPER_ADMIN') return { role, kind: 'PLATFORM', permissions: PERMISSION_KEYS };
  const preset = DEFAULT_POSITIONS.find((p) => p.legacyRole === role);
  if (!preset) return { role, kind: role === 'ADMIN' || role === 'AGENT' || role === 'CSR' ? 'AGENCY' : 'NONE', permissions: [] };
  const kind = preset.reach === 'ALL' ? 'PLATFORM' : preset.reach === 'POD' ? 'VA' : 'ACCOUNT_MANAGER';
  return { role, kind, permissions: preset.permissions };
}

const asAccess = (who: NavAccess | string): NavAccess => (typeof who === 'string' ? accessForRole(who) : who);
const hasSetup = (who: NavAccess) => who.role === 'SUPER_ADMIN' || (who.kind !== 'AGENCY' && who.kind !== 'NONE' && SETUP_PERMISSIONS.some((p) => who.permissions.includes(p)));
const isStaffKind = (who: NavAccess) => who.kind === 'PLATFORM' || who.kind === 'ACCOUNT_MANAGER' || who.kind === 'VA';

function shows(item: DeskNavItem, who: NavAccess): boolean {
  if (item.roles && !item.roles.includes(who.role)) return false;
  if (item.permissions && !item.permissions.some((p) => who.permissions.includes(p))) return false;
  if (item.kinds && !item.kinds.includes(who.kind)) return false;
  return true;
}

export const DESK_NAV: Record<DeskArea, readonly DeskNavItem[]> = {
  AGENCY: [
    { label: 'Overview', href: '/desk', icon: 'home', module: 33, summary: 'What needs your attention, open requests and recently completed work.' },
    { label: 'Requests', href: '/desk/requests', icon: 'inbox', module: 33, summary: 'Every service request for your agency, with its current status.' },
    { label: 'New request', href: '/desk/requests/new', icon: 'plus', module: 29, summary: 'Send a service request to your Desk team for one of your accounts.' },
    { label: 'Accounts', href: '/desk/accounts', icon: 'users', module: 21, summary: 'Your insured accounts and their policies.' },
    { label: 'Import', href: '/desk/import', icon: 'upload', module: 25, summary: 'Upload your book of business from any AMS export.', roles: ['ADMIN'] },
    { label: 'Messages', href: '/desk/messages', icon: 'chat', module: 36, summary: 'Conversation with your Account Manager.' },
    { label: 'Team access', href: '/desk/team', icon: 'shield', module: 23, summary: 'Who in your agency sees which accounts.', roles: ['ADMIN'] },
  ],
  OPS: [
    { label: 'Overview', href: '/desk-ops', icon: 'home', module: 34, summary: 'Open, due-soon and overdue work across your agencies.' },
    { label: 'Pod queue', href: '/desk-ops/queue', icon: 'queue', module: 31, summary: 'Unassigned work in your pods, ready to pick up.', permissions: WORK },
    { label: 'My tasks', href: '/desk-ops/my-tasks', icon: 'check', module: 31, summary: 'Work assigned to you.', permissions: WORK },
    { label: 'Agencies', href: '/desk-ops/agencies', icon: 'building', module: 35, summary: 'Your agencies, their accounts and their work.', permissions: ['accounts.view'], kinds: MANAGED },
    { label: 'Messages', href: '/desk-ops/messages', icon: 'chat', module: 36, summary: 'Conversations with your agencies.', permissions: ['messages.agency'], kinds: MANAGED },
    { label: 'Account Managers', href: '/desk-ops/account-managers', icon: 'staff', module: 50, summary: 'Who reports to whom, cover for absences, and moving agencies between Account Managers.', permissions: ['team.manage'], kinds: MANAGED },
    { label: 'Workload', href: '/desk-ops/workload', icon: 'layers', module: 40, summary: 'All work across agencies and pods; reassign and escalate.', permissions: ['workload.view'], kinds: ALL_AGENCIES },
    { label: 'Turnaround', href: '/desk-ops/metrics', icon: 'chart', module: 42, summary: 'Turnaround by pod, VA and agency, in business time.', permissions: ['turnaround.view'], kinds: MANAGED },
    { label: 'Usage & audit', href: '/desk-ops/usage', icon: 'receipt', module: 43, summary: 'Monthly usage against plan allowances, and the audit log.', permissions: ['usage.view', 'audit.view'], kinds: ALL_AGENCIES },
  ],
  ADMIN: [
    { label: 'Overview', href: '/super-admin/desk', icon: 'home', module: 14, summary: 'Desk setup at a glance.' },
    { label: 'Agencies', href: '/super-admin/desk/agencies', icon: 'building', module: 15, summary: 'Turn The Desk on per agency, assign Account Managers, plans and profiles.', permissions: ['agencies.setup'] },
    { label: 'Staff', href: '/super-admin/desk/staff', icon: 'staff', module: 16, summary: 'Invite and manage Account Managers, VAs and Operations Managers.', permissions: ['staff.manage'] },
    { label: 'Positions', href: '/super-admin/desk/positions', icon: 'shield', module: 47, summary: 'Positions, their permissions and agency reach, and who holds them.', roles: ['SUPER_ADMIN'] },
    { label: 'Pods', href: '/super-admin/desk/pods', icon: 'layers', module: 17, summary: 'Pods, their members, agency authorization and VA permissions.', permissions: ['pods.manage', 'agencies.setup', 'documents.grant'] },
    { label: 'Routing & targets', href: '/super-admin/desk/routing', icon: 'route', module: 18, summary: 'Where each request type goes and its service-level targets.', permissions: ['settings.operations'] },
    { label: 'Business calendar', href: '/super-admin/desk/calendar', icon: 'calendar', module: 19, summary: 'Business hours, time zone and holidays.', permissions: ['settings.operations'] },
    { label: 'Follow-up rules', href: '/super-admin/desk/follow-ups', icon: 'repeat', module: 39, summary: 'Follow-up work created automatically when a request is completed.', permissions: ['settings.operations'] },
  ],
};

/** The sidebar for one area, for a person's access (or a bare role's default position). */
export function navFor(area: DeskArea, who: NavAccess | string): DeskNavItem[] {
  const access = asAccess(who);
  return DESK_NAV[area].filter((item) => shows(item, access));
}

/** The nav entry for a path (exact match), for placeholder pages. */
export function navItemFor(href: string): DeskNavItem | undefined {
  for (const items of Object.values(DESK_NAV)) {
    const hit = items.find((item) => item.href === href);
    if (hit) return hit;
  }
  return undefined;
}

/** May this person (or a bare role) open the page at `href`? Unknown paths are refused. */
export function itemAllowed(href: string, who: NavAccess | string): boolean {
  const item = navItemFor(href);
  return !!item && shows(item, asAccess(who));
}

/** Highlight rule: an area root matches only itself; other items match their subtree. */
export function isActivePath(pathname: string, href: string): boolean {
  if ((Object.values(AREA_ROOTS) as string[]).includes(href)) return pathname === href;
  if (pathname === href) return true;
  // "Requests" stays lit on /desk/requests/123 but not on /desk/requests/new,
  // which has its own entry.
  if (!pathname.startsWith(href + '/')) return false;
  return !navItemFor(pathname);
}

/** Links to the user's other areas, shown under the sidebar. */
export function otherAreaLinks(area: DeskArea, who: NavAccess | string): { label: string; href: string }[] {
  const access = asAccess(who);
  const role = access.role;
  const links: { label: string; href: string }[] = [];
  // Staff who may use some of Desk setup move between it and Desk Operations.
  if (hasSetup(access) && isStaffKind(access)) {
    if (area !== 'OPS') links.push({ label: AREA_TITLES.OPS, href: AREA_ROOTS.OPS });
    if (area !== 'ADMIN') links.push({ label: AREA_TITLES.ADMIN, href: AREA_ROOTS.ADMIN });
  }
  if (role === 'SUPER_ADMIN') links.push({ label: 'Super Admin', href: '/super-admin' });
  if (role === 'ADMIN' || role === 'AGENT' || role === 'CSR') links.push({ label: 'Placement (leads & proposals)', href: '/dashboard' });
  return links;
}

/** Where a user goes after signing in. */
export function landingPath(role: string): string {
  switch (role) {
    case 'SUPER_ADMIN':
      return '/super-admin';
    case 'DESK_ADMIN':
    case 'ACCOUNT_MANAGER':
    case 'DESK_VA':
      return AREA_ROOTS.OPS;
    default:
      return '/dashboard';
  }
}

/**
 * Internal Desk staff have nothing in the agency app (leads, proposals…); they
 * may reach Desk setup, where the Desk layout then checks their positions
 * (Module 48: a position, not the role, decides who uses setup). Everyone else
 * is unaffected.
 */
export function mainAppAllowed(role: string, pathname: string): boolean {
  if (role === 'DESK_ADMIN' || role === 'ACCOUNT_MANAGER' || role === 'DESK_VA') return isWithin(pathname, AREA_ROOTS.ADMIN);
  return true;
}

/** Super Admin pages: Super Admin everywhere, Desk staff only in Desk setup (which checks their positions). */
export function superAdminAreaAllowed(role: string, pathname: string): boolean {
  if (role === 'SUPER_ADMIN') return true;
  return (role === 'DESK_ADMIN' || role === 'ACCOUNT_MANAGER' || role === 'DESK_VA') && isWithin(pathname, AREA_ROOTS.ADMIN);
}

function isWithin(pathname: string, root: string): boolean {
  return pathname === root || pathname.startsWith(root + '/');
}

export type AreaGate =
  | { ok: true }
  /** The user belongs elsewhere: send them to their own landing page. */
  | { ok: false; redirect: string }
  /** The user belongs here, but cannot use it yet (shown, not redirected). */
  | { ok: false; notice: 'DESK_NOT_ENABLED' };

/**
 * May this user enter the area? Uses the resolved Desk scope, so "agency has
 * The Desk enabled" and "user is active" come from the database, not the role.
 */
export function gateArea(area: DeskArea, role: string, scope: DeskScope): AreaGate {
  // A user refused an area must never be sent back into it (a redirect loop,
  // e.g. an account deactivated mid-session); they sign in again instead.
  const landing = landingPath(role);
  const home = { ok: false as const, redirect: isWithin(landing, AREA_ROOTS[area]) ? '/login' : landing };
  switch (area) {
    case 'AGENCY':
      if (scope.kind === 'AGENCY') return { ok: true };
      if (scope.kind === 'NONE' && scope.reason === DESK_NOT_ENABLED) {
        return { ok: false, notice: 'DESK_NOT_ENABLED' };
      }
      return home;
    case 'OPS':
      return scope.kind === 'PLATFORM' || scope.kind === 'ACCOUNT_MANAGER' || scope.kind === 'VA' ? { ok: true } : home;
    case 'ADMIN':
      return hasSetup(navAccess(scope)) ? { ok: true } : home;
  }
}

/** A `?redirect=` target is followed only if it is a path on this site. */
export function safeRedirect(target: string | null | undefined): string | null {
  if (!target || !target.startsWith('/') || target.startsWith('//') || target.includes('\\')) return null;
  return target;
}
