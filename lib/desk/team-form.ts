/**
 * The Team access screens' logic and wording. Pure, so the browser screens and
 * the server share it.
 */

export const MAX_BULK_ASSIGN = 5000;
export const MEMBER_PAGE_SIZE = 25;

export type BookAccessValue = 'ALL' | 'ASSIGNED';
export type AssignmentRoleValue = 'PRODUCER' | 'SERVICE';
/** Which accounts a person's page lists. */
export type MemberView = 'ASSIGNED' | 'NOT_ASSIGNED' | 'ALL';

export const BOOK_ACCESS_LABELS: Record<BookAccessValue, string> = {
  ASSIGNED: 'Assigned accounts only',
  ALL: 'Whole book',
};

export const ASSIGNMENT_ROLE_LABELS: Record<AssignmentRoleValue, string> = {
  PRODUCER: 'Producer',
  SERVICE: 'Service',
};

export const MEMBER_VIEW_LABELS: Record<MemberView, string> = {
  ASSIGNED: 'Assigned to them',
  NOT_ASSIGNED: 'Not assigned to them',
  ALL: 'All accounts',
};

/** One line on what this person can see, as the page's explanation. */
export function accessSummary(role: string, book: BookAccessValue): string {
  if (role === 'ADMIN') return 'Owner / Admin: sees every account, whatever is assigned. Assigning them marks who looks after an account.';
  if (book === 'ALL') return 'Sees every account in the agency, because they have whole-book access. Assigning them marks who looks after an account.';
  return 'Sees only the accounts assigned to them, so assigning or removing an account changes what they can see.';
}

export const inviteLabel = (accepted: boolean) => (accepted ? null : 'Invite pending');

/** The accounts query for a person's page. An account is listed whatever its status, unless the view is for adding. */
export function memberAccountsQuery(userId: string, view: MemberView, q: string, page: number): string {
  const p = new URLSearchParams();
  if (q.trim()) p.set('q', q.trim());
  if (view === 'ASSIGNED') p.set('assignedTo', userId);
  else {
    p.set('status', 'ACTIVE');
    if (view === 'NOT_ASSIGNED') p.set('notAssignedTo', userId);
  }
  p.set('page', String(page));
  p.set('pageSize', String(MEMBER_PAGE_SIZE));
  return p.toString();
}

// ── Choosing accounts ──

/** Tick or untick every row on the page. */
export function togglePage(selected: ReadonlySet<string>, pageIds: readonly string[]): Set<string> {
  const next = new Set(selected);
  const allOn = allSelected(selected, pageIds);
  for (const id of pageIds) {
    if (allOn) next.delete(id);
    else next.add(id);
  }
  return next;
}

export function toggleOne(selected: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(selected);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

export const allSelected = (selected: ReadonlySet<string>, pageIds: readonly string[]) =>
  pageIds.length > 0 && pageIds.every((id) => selected.has(id));

/** What a bulk action covers: the ticked rows, or everything the current search matches. */
export type BulkTarget =
  | { kind: 'IDS'; ids: string[] }
  | { kind: 'MATCHING'; view: MemberView; q: string };

export function bulkRequestBody(action: 'assign' | 'unassign', target: BulkTarget, role?: AssignmentRoleValue) {
  return {
    action,
    ...(action === 'assign' && role ? { role } : {}),
    ...(target.kind === 'IDS' ? { insuredIds: target.ids } : { matching: { view: target.view, q: target.q.trim() } }),
  };
}

export function bulkDoneMessage(action: 'assign' | 'unassign', changed: number): string {
  if (changed === 0) return action === 'assign' ? 'Those accounts were already assigned.' : 'None of those accounts were assigned.';
  const accounts = `${changed.toLocaleString('en-US')} account${changed === 1 ? '' : 's'}`;
  return action === 'assign' ? `${accounts} assigned.` : `${accounts} removed.`;
}
