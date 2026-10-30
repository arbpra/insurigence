/**
 * The Desk's navigation: which area each user may enter, where they land
 * after login, and what their sidebar shows. Pure (no server imports) so the
 * client shell and the server gates share one source of truth.
 *
 * Three route areas:
 *  - AGENCY  `/desk`             agency users in a Desk-enabled agency
 *  - OPS     `/desk-ops`         Account Managers, VAs, Operations Managers (and Super Admin)
 *  - ADMIN   `/super-admin/desk` Desk setup: Super Admin and Operations Managers
 *
 * The sidebar only decides what is shown. What a user can actually read is
 * still decided per record by lib/desk/access.ts.
 */
import type { DeskScope } from './access';
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
  /** Roles that see the item; omitted = everyone allowed into the area. */
  roles?: readonly string[];
}

const MANAGERS = ['SUPER_ADMIN', 'DESK_ADMIN'] as const;

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
    { label: 'Pod queue', href: '/desk-ops/queue', icon: 'queue', module: 31, summary: 'Unassigned work in your pods, ready to pick up.' },
    { label: 'My tasks', href: '/desk-ops/my-tasks', icon: 'check', module: 31, summary: 'Work assigned to you.' },
    { label: 'Agencies', href: '/desk-ops/agencies', icon: 'building', module: 35, summary: 'Your agencies, their accounts and their work.', roles: ['ACCOUNT_MANAGER', ...MANAGERS] },
    { label: 'Messages', href: '/desk-ops/messages', icon: 'chat', module: 36, summary: 'Conversations with your agencies.', roles: ['ACCOUNT_MANAGER', ...MANAGERS] },
    { label: 'Workload', href: '/desk-ops/workload', icon: 'layers', module: 40, summary: 'All work across agencies and pods; reassign and escalate.', roles: MANAGERS },
    { label: 'Turnaround', href: '/desk-ops/metrics', icon: 'chart', module: 42, summary: 'Turnaround by pod, VA and agency, in business time.', roles: ['ACCOUNT_MANAGER', ...MANAGERS] },
    { label: 'Usage & audit', href: '/desk-ops/usage', icon: 'receipt', module: 43, summary: 'Monthly usage against plan allowances, and the audit log.', roles: MANAGERS },
  ],
  ADMIN: [
    { label: 'Overview', href: '/super-admin/desk', icon: 'home', module: 14, summary: 'Desk setup at a glance.' },
    { label: 'Agencies', href: '/super-admin/desk/agencies', icon: 'building', module: 15, summary: 'Turn The Desk on per agency, assign Account Managers, plans and profiles.' },
    { label: 'Staff', href: '/super-admin/desk/staff', icon: 'staff', module: 16, summary: 'Invite and manage Account Managers, VAs and Operations Managers.' },
    { label: 'Pods', href: '/super-admin/desk/pods', icon: 'layers', module: 17, summary: 'Pods, their members, agency authorization and VA permissions.' },
    { label: 'Routing & targets', href: '/super-admin/desk/routing', icon: 'route', module: 18, summary: 'Where each request type goes and its service-level targets.' },
    { label: 'Business calendar', href: '/super-admin/desk/calendar', icon: 'calendar', module: 19, summary: 'Business hours, time zone and holidays.' },
    { label: 'Follow-up rules', href: '/super-admin/desk/follow-ups', icon: 'repeat', module: 39, summary: 'Work created automatically when a task completes.' },
  ],
};

/** The sidebar for one area and role. */
export function navFor(area: DeskArea, role: string): DeskNavItem[] {
  return DESK_NAV[area].filter((item) => !item.roles || item.roles.includes(role));
}

/** The nav entry for a path (exact match), for placeholder pages. */
export function navItemFor(href: string): DeskNavItem | undefined {
  for (const items of Object.values(DESK_NAV)) {
    const hit = items.find((item) => item.href === href);
    if (hit) return hit;
  }
  return undefined;
}

/** May this role open the page at `href`? Unknown paths are refused. */
export function itemAllowed(href: string, role: string): boolean {
  const item = navItemFor(href);
  return !!item && (!item.roles || item.roles.includes(role));
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
export function otherAreaLinks(area: DeskArea, role: string): { label: string; href: string }[] {
  const links: { label: string; href: string }[] = [];
  if (role === 'SUPER_ADMIN' || role === 'DESK_ADMIN') {
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
 * Internal Desk staff have nothing in the agency app (leads, proposals…);
 * Operations Managers may also reach Desk setup. Everyone else is unaffected.
 */
export function mainAppAllowed(role: string, pathname: string): boolean {
  if (role === 'DESK_ADMIN') return isWithin(pathname, AREA_ROOTS.ADMIN);
  if (role === 'ACCOUNT_MANAGER' || role === 'DESK_VA') return false;
  return true;
}

/** Super Admin pages: Super Admin everywhere, Operations Managers only in Desk setup. */
export function superAdminAreaAllowed(role: string, pathname: string): boolean {
  if (role === 'SUPER_ADMIN') return true;
  return role === 'DESK_ADMIN' && isWithin(pathname, AREA_ROOTS.ADMIN);
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
      return scope.kind === 'PLATFORM' ? { ok: true } : home;
  }
}

/** A `?redirect=` target is followed only if it is a path on this site. */
export function safeRedirect(target: string | null | undefined): string | null {
  if (!target || !target.startsWith('/') || target.startsWith('//') || target.includes('\\')) return null;
  return target;
}
