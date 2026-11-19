/**
 * The workload screen's filters (Module 40), kept in the page address so a
 * view can be shared or reloaded. Pure — safe for server and browser.
 */
import type { TaskStatus } from '@prisma/client';
import { STATUS_LABELS } from './task-statuses';

export const WORKLOAD_SORTS = { due: 'Due soonest', newest: 'Newest', activity: 'Last activity' } as const;
export type WorkloadSort = keyof typeof WORKLOAD_SORTS;

export interface WorkloadFilters {
  q: string;
  agencyId: string;
  /** A pod's id, or 'none' for work no pod has yet. */
  podId: string;
  /** A person's id, or 'none' for work nobody holds. */
  assignee: string;
  status: TaskStatus | '';
  overdue: boolean;
  escalated: boolean;
  /** Closed work too: off by default, since workload is about what is still to do. */
  closed: boolean;
  sort: WorkloadSort;
  page: number;
}

export const EMPTY_WORKLOAD_FILTERS: WorkloadFilters = {
  q: '', agencyId: '', podId: '', assignee: '', status: '', overdue: false, escalated: false, closed: false, sort: 'due', page: 1,
};

const ID = /^[0-9a-f]{24}$/i;
const idOr = (v: string | null, extra?: string) => (v && (ID.test(v) || v === extra) ? v : '');

export function parseWorkloadFilters(p: URLSearchParams): WorkloadFilters {
  const status = p.get('status') ?? '';
  const sort = p.get('sort') ?? '';
  const page = Math.trunc(Number(p.get('page')));
  return {
    q: (p.get('q') ?? '').slice(0, 200),
    agencyId: idOr(p.get('agencyId')),
    podId: idOr(p.get('podId'), 'none'),
    assignee: idOr(p.get('assignee'), 'none'),
    status: Object.hasOwn(STATUS_LABELS, status) ? (status as TaskStatus) : '',
    overdue: p.get('overdue') === '1',
    escalated: p.get('escalated') === '1',
    closed: p.get('closed') === '1',
    sort: Object.hasOwn(WORKLOAD_SORTS, sort) ? (sort as WorkloadSort) : 'due',
    page: page > 1 ? page : 1,
  };
}

/** The page address: only what differs from the defaults. */
export function workloadPageQuery(f: WorkloadFilters): string {
  const p = new URLSearchParams();
  if (f.q.trim()) p.set('q', f.q.trim());
  if (f.agencyId) p.set('agencyId', f.agencyId);
  if (f.podId) p.set('podId', f.podId);
  if (f.assignee) p.set('assignee', f.assignee);
  if (f.status) p.set('status', f.status);
  if (f.overdue) p.set('overdue', '1');
  if (f.escalated) p.set('escalated', '1');
  if (f.closed) p.set('closed', '1');
  if (f.sort !== 'due') p.set('sort', f.sort);
  if (f.page > 1) p.set('page', String(f.page));
  return p.toString();
}

/** The API's query for the same view. Open work only unless closed work is asked for, or a closed status chosen. */
export function workloadApiQuery(f: WorkloadFilters): string {
  const p = new URLSearchParams(workloadPageQuery(f));
  p.delete('closed');
  if (!f.closed && !(f.status === 'COMPLETED' || f.status === 'CANCELLED')) p.set('open', '1');
  p.set('sort', f.sort);
  return p.toString();
}

export const hasWorkloadFilters = (f: WorkloadFilters) =>
  workloadPageQuery({ ...f, page: 1, sort: 'due' }) !== '';

/** What a change to several tasks did, in one sentence for the screen. */
export function bulkSummary(r: { done: { reference: number }[]; failed: { reference: number | null; message: string }[] }, verb: string): string {
  const done = r.done.length ? `${verb} ${r.done.length} ${r.done.length === 1 ? 'task' : 'tasks'}.` : '';
  const failed = r.failed.map((f) => `${f.reference ? `#${f.reference}` : 'A task'}: ${f.message}`);
  if (!failed.length) return done;
  return [done, `${failed.length === 1 ? 'One was' : `${failed.length} were`} not changed.`, ...failed].filter(Boolean).join(' ');
}
