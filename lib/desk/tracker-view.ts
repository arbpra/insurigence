/**
 * The agency tracker's tabs and filters, and how a history entry reads to the
 * agency. Pure — safe for server and browser.
 */
import type { TaskEventKind } from '@prisma/client';
import { TASK_TYPE_LABELS } from './service-levels';
import type { AgencyStatus } from './task-statuses';

export const TRACKER_PAGE_SIZE = 25;
export const AGENCY_NOTE_MAX = 5_000;

/** The tabs, and the simplified statuses behind each. */
export const TRACKER_TABS = {
  attention: { label: 'Needs your attention', statuses: ['NEEDS_ATTENTION'] },
  open: { label: 'Open', statuses: ['RECEIVED', 'IN_PROGRESS', 'NEEDS_ATTENTION'] },
  completed: { label: 'Completed', statuses: ['COMPLETED'] },
  all: { label: 'All', statuses: [] },
} as const satisfies Record<string, { label: string; statuses: readonly AgencyStatus[] }>;
export type TrackerTab = keyof typeof TRACKER_TABS;

export interface TrackerFilters {
  tab: TrackerTab;
  q: string;
  type: string;
  mine: boolean;
  page: number;
}

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';

/** The page's filters from its address. Anything unknown falls back to the default rather than failing. */
export function parseTrackerFilters(params: Record<string, string | string[] | undefined>): TrackerFilters {
  const tab = first(params.tab);
  const type = first(params.type);
  const page = Math.trunc(Number(first(params.page)));
  return {
    tab: Object.hasOwn(TRACKER_TABS, tab) ? (tab as TrackerTab) : 'open',
    q: first(params.q).trim().slice(0, 200),
    type: Object.hasOwn(TASK_TYPE_LABELS, type) ? type : '',
    mine: first(params.mine) === '1',
    page: page >= 1 && page <= 10_000 ? page : 1,
  };
}

/** The page's own address for a set of filters (defaults left out). */
export function trackerPageQuery(f: TrackerFilters): string {
  const p = new URLSearchParams();
  if (f.tab !== 'open') p.set('tab', f.tab);
  if (f.q) p.set('q', f.q);
  if (f.type) p.set('type', f.type);
  if (f.mine) p.set('mine', '1');
  if (f.page > 1) p.set('page', String(f.page));
  const s = p.toString();
  return s ? `?${s}` : '';
}

/** What the page asks the task list for. Completed work is listed by when it was completed. */
export function trackerApiQuery(f: TrackerFilters): string {
  const p = new URLSearchParams();
  const statuses = TRACKER_TABS[f.tab].statuses;
  if (statuses.length) p.set('status', statuses.join(','));
  if (f.tab === 'completed') p.set('sort', 'completed');
  if (f.q) p.set('q', f.q);
  if (f.type) p.set('type', f.type);
  if (f.mine) p.set('mine', '1');
  p.set('page', String(f.page));
  p.set('pageSize', String(TRACKER_PAGE_SIZE));
  return p.toString();
}

/** A history entry as the agency is sent it (lib/desk/task-api.ts, agencyEventView). */
export interface AgencyEvent {
  id: string;
  kind: TaskEventKind;
  actorName: string;
  body: string | null;
  status: AgencyStatus | null;
  statusLabel: string | null;
  fromStatus: AgencyStatus | null;
  fromStatusLabel: string | null;
  createdAt: string;
}

/** The headline of an entry for the agency. The body (a note, what is needed, a file name) goes under it. */
export function agencyEventTitle(e: AgencyEvent): string {
  switch (e.kind) {
    case 'CREATED': return 'Request sent';
    case 'STATUS_CHANGED':
      if (e.status === 'NEEDS_ATTENTION') return 'Your Desk team needs something from you';
      if (e.fromStatus === 'NEEDS_ATTENTION') return 'Back with your Desk team';
      if (e.fromStatus === 'COMPLETED' || e.fromStatus === 'CANCELLED') return 'Reopened';
      if (e.status === 'COMPLETED') return 'Completed';
      if (e.status === 'CANCELLED') return 'Cancelled';
      if (e.fromStatusLabel && e.statusLabel) return `${e.fromStatusLabel} → ${e.statusLabel}`;
      return e.statusLabel ? `Now ${e.statusLabel.toLowerCase()}` : 'Status changed';
    case 'NOTE': return 'Note';
    case 'DOCUMENT_ADDED': return 'Document added';
    case 'DOCUMENT_REMOVED': return 'Document removed';
    default: return 'Updated';
  }
}

/** The badge colours for each simplified status; "Needs your attention" stands out. */
export const AGENCY_STATUS_BADGE: Record<AgencyStatus, string> = {
  RECEIVED: 'bg-slate-100 text-slate-800',
  IN_PROGRESS: 'bg-sky-100 text-sky-800',
  NEEDS_ATTENTION: 'bg-amber-100 text-amber-900',
  COMPLETED: 'bg-emerald-100 text-emerald-800',
  CANCELLED: 'bg-slate-100 text-slate-500',
};
