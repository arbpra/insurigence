/**
 * The Pod queue and "My tasks" screens: their filters, how those become the
 * address and the API query, and how a due date is described. Pure — safe for
 * server and browser. The server applies access rules to every query.
 */
import type { TaskPriority, TaskStatus, TaskType } from '@prisma/client';
import { PRIORITY_LABELS, TASK_TYPE_LABELS } from './service-levels';

export type QueueMode = 'queue' | 'mine';

/** "My tasks" is split by what the work needs next. */
export const MINE_VIEWS = {
  open: { label: 'All open', statuses: [] as TaskStatus[] },
  todo: { label: 'To start', statuses: ['ASSIGNED'] as TaskStatus[] },
  working: { label: 'In progress', statuses: ['IN_PROGRESS'] as TaskStatus[] },
  waiting: { label: 'Waiting', statuses: ['WAITING_ON_AGENCY', 'WAITING_ON_CARRIER', 'WAITING_ON_INSURED'] as TaskStatus[] },
  qa: { label: 'QA review', statuses: ['QA_REVIEW'] as TaskStatus[] },
  closed: { label: 'Completed', statuses: ['COMPLETED', 'CANCELLED'] as TaskStatus[] },
} as const;
export type MineView = keyof typeof MINE_VIEWS;

export const QUEUE_SORTS = { due: 'Due soonest', newest: 'Newest first' } as const;
export type QueueSort = keyof typeof QUEUE_SORTS;

export const QUEUE_PAGE_SIZE = 25;

export interface QueueFilters {
  q: string;
  /** A pod's id, 'none' for work not yet routed to a pod, or '' for all. */
  podId: string;
  agencyId: string;
  type: TaskType | '';
  priority: TaskPriority | '';
  overdue: boolean;
  sort: QueueSort;
  view: MineView;
  page: number;
}

const ID = /^[a-f0-9]{24}$/i;
const pick = <T extends string>(value: string | null, allowed: Record<string, unknown>, fallback: T): T =>
  value && Object.hasOwn(allowed, value) ? (value as T) : fallback;

/** Reads the address. Anything unrecognised falls back to the default rather than failing. */
export function parseQueueFilters(params: URLSearchParams): QueueFilters {
  const pod = params.get('pod') ?? '';
  const agency = params.get('agency') ?? '';
  const page = Math.trunc(Number(params.get('page')));
  return {
    q: (params.get('q') ?? '').trim().slice(0, 200),
    podId: pod === 'none' || ID.test(pod) ? pod : '',
    agencyId: ID.test(agency) ? agency : '',
    type: pick<TaskType | ''>(params.get('type'), TASK_TYPE_LABELS, ''),
    priority: pick<TaskPriority | ''>(params.get('priority'), PRIORITY_LABELS, ''),
    overdue: params.get('overdue') === '1',
    sort: pick<QueueSort>(params.get('sort'), QUEUE_SORTS, 'due'),
    view: pick<MineView>(params.get('view'), MINE_VIEWS, 'open'),
    page: Number.isFinite(page) && page > 1 ? page : 1,
  };
}

export const DEFAULT_QUEUE_FILTERS: QueueFilters = parseQueueFilters(new URLSearchParams());

/** The address for these filters, leaving out defaults so a plain link stays plain. */
export function queuePageQuery(f: QueueFilters, mode: QueueMode): string {
  const p = new URLSearchParams();
  if (f.q) p.set('q', f.q);
  if (mode === 'mine' && f.view !== 'open') p.set('view', f.view);
  if (f.podId) p.set('pod', f.podId);
  if (f.agencyId) p.set('agency', f.agencyId);
  if (f.type) p.set('type', f.type);
  if (f.priority) p.set('priority', f.priority);
  if (f.overdue) p.set('overdue', '1');
  if (f.sort !== 'due') p.set('sort', f.sort);
  if (f.page > 1) p.set('page', String(f.page));
  return p.toString();
}

/**
 * The task list query. The queue is open work nobody holds yet; "My tasks" is
 * the person's own, by stage. Completed work is listed most recent first.
 */
export function queueApiQuery(f: QueueFilters, mode: QueueMode): string {
  const p = new URLSearchParams();
  if (mode === 'queue') {
    p.set('open', '1');
    p.set('assignee', 'none');
  } else {
    p.set('mine', '1');
    const statuses = MINE_VIEWS[f.view].statuses;
    if (statuses.length) p.set('status', statuses.join(','));
    else p.set('open', '1');
  }
  if (f.q) p.set('q', f.q);
  if (f.podId) p.set('podId', f.podId);
  if (f.agencyId) p.set('agencyId', f.agencyId);
  if (f.type) p.set('type', f.type);
  if (f.priority) p.set('priority', f.priority);
  // Overdue means open and not waiting, so it has no meaning for completed work.
  if (f.overdue && !(mode === 'mine' && f.view === 'closed')) p.set('overdue', '1');
  p.set('sort', mode === 'mine' && f.view === 'closed' ? 'activity' : f.sort);
  p.set('page', String(f.page));
  p.set('pageSize', String(QUEUE_PAGE_SIZE));
  return p.toString();
}

export function hasQueueFilters(f: QueueFilters): boolean {
  return !!(f.q || f.podId || f.agencyId || f.type || f.priority || f.overdue);
}

export const lastQueuePage = (total: number) => Math.max(1, Math.ceil(total / QUEUE_PAGE_SIZE));

export type DueTone = 'overdue' | 'soon' | 'normal' | 'waiting' | 'none' | 'closed';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function span(ms: number): string {
  if (ms < HOUR) {
    const m = Math.max(1, Math.round(ms / MINUTE));
    return `${m} min`;
  }
  if (ms < DAY) {
    const h = Math.round(ms / HOUR);
    return `${h} ${h === 1 ? 'hour' : 'hours'}`;
  }
  const d = Math.round(ms / DAY);
  return `${d} ${d === 1 ? 'day' : 'days'}`;
}

/** Due within this long is "soon". */
export const DUE_SOON_MS = 4 * HOUR;

/**
 * How a task's internal target reads in a list. Waiting work has its clock
 * stopped, so its due date would mislead; it says what it's waiting on instead.
 */
export function dueLabel(
  task: { dueAt: string | Date | null; waitingSince: string | Date | null; status: TaskStatus; completedAt?: string | Date | null },
  now: Date,
): { text: string; tone: DueTone } {
  if (task.status === 'COMPLETED' || task.status === 'CANCELLED') return { text: task.status === 'COMPLETED' ? 'Completed' : 'Cancelled', tone: 'closed' };
  if (task.waitingSince) return { text: `Clock stopped ${span(now.getTime() - new Date(task.waitingSince).getTime())} ago`, tone: 'waiting' };
  if (!task.dueAt) return { text: 'No target', tone: 'none' };
  const left = new Date(task.dueAt).getTime() - now.getTime();
  if (left < 0) return { text: `Overdue by ${span(-left)}`, tone: 'overdue' };
  return { text: `Due in ${span(left)}`, tone: left <= DUE_SOON_MS ? 'soon' : 'normal' };
}

/** Which priorities are worth a badge; Normal and Low aren't. */
export const PRIORITY_BADGE: Partial<Record<TaskPriority, string>> = { URGENT: 'Urgent', HIGH: 'High' };
