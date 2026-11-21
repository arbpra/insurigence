/**
 * The audit log viewer (Module 43, client answer Q4: "All actions should be
 * logged"). Operations Managers and the Super Admin read the Desk's security
 * trail (lib/desk/audit.ts): who did what, to which record, for which agency,
 * when and from where. Filters, pages of 50, and a CSV export.
 *
 * Reading the log is itself logged (audit.viewed, audit.exported), with the
 * filters used. The log is read-only: nothing here changes or removes an
 * entry. Secret-looking values were already redacted when written.
 */
import type { Prisma, PrismaClient } from '@prisma/client';
import { DeskAccessError, isObjectId, type DeskScope, type GuardContext } from './access';
import { AUDIT_ACTIONS, recordAudit } from './audit';
import { addCalendarDays, loadBusinessCalendar, zonedInstant } from './business-time';
import { literal } from './literal-match';

type Db = PrismaClient;

export const AUDIT_PAGE_SIZE = 50;
export const AUDIT_EXPORT_MAX = 5000;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TEXT_MAX = 100;

/** Groups of actions, by what they are about ("task.", "document." …). */
export const AUDIT_ACTION_GROUPS = [...new Set(AUDIT_ACTIONS.map((a) => a.split('.')[0]))];

export interface AuditFilters {
  /** One action ("task.viewed") or a group ("task"). */
  action: string | null;
  agencyId: string | null;
  /** Who did it: part of a name or email, or "system" for automatic actions. */
  actor: string | null;
  entityType: string | null;
  entityId: string | null;
  /** Calendar days in the Desk time zone, inclusive. */
  from: string | null;
  to: string | null;
  page: number;
}

function opsOnly(scope: DeskScope) {
  if (scope.kind !== 'PLATFORM') throw new DeskAccessError(403, 'Only Operations Managers can read the audit log.');
}

const realDate = (d: string) => DATE.test(d) && new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10) === d;

/** Reads the filters strictly: anything malformed is refused, not guessed. */
export function auditFilters(p: { get(name: string): string | null }): AuditFilters {
  const text = (name: string) => {
    const v = p.get(name)?.trim() || null;
    if (v && v.length > TEXT_MAX) throw new DeskAccessError(400, 'That filter is too long.');
    return v;
  };
  const action = text('action');
  if (action && !(AUDIT_ACTIONS as readonly string[]).includes(action) && !AUDIT_ACTION_GROUPS.includes(action)) throw new DeskAccessError(400, 'Unknown action.');
  const agencyId = text('agencyId');
  if (agencyId && !isObjectId(agencyId)) throw new DeskAccessError(400, 'Unknown agency.');
  const from = text('from'), to = text('to');
  if ((from && !realDate(from)) || (to && !realDate(to))) throw new DeskAccessError(400, 'Choose dates as YYYY-MM-DD.');
  if (from && to && from > to) throw new DeskAccessError(400, 'The start date is after the end date.');
  const page = p.get('page') ? Number(p.get('page')) : 1;
  if (!Number.isInteger(page) || page < 1 || page > 10_000) throw new DeskAccessError(400, 'Unknown page.');
  return { action, agencyId, actor: text('actor'), entityType: text('entityType'), entityId: text('entityId'), from, to, page };
}


async function whereFor(db: Db, f: AuditFilters): Promise<Prisma.DeskAuditLogWhereInput> {
  const and: Prisma.DeskAuditLogWhereInput[] = [];
  if (f.action) and.push(f.action.includes('.') ? { action: f.action } : { action: { startsWith: literal(`${f.action}.`) } });
  if (f.agencyId) and.push({ agencyId: f.agencyId });
  if (f.entityType) and.push({ entityType: f.entityType });
  if (f.entityId) and.push({ entityId: f.entityId });
  if (f.actor) {
    if (f.actor.toLowerCase() === 'system') and.push({ OR: [{ actorId: null }, { actorId: { isSet: false } }] });
    else {
      // Searched for as typed: punctuation is not a pattern (lib/desk/literal-match.ts).
      const words = f.actor.split(/\s+/).filter(Boolean).map(literal);
      const people = await db.user.findMany({
        where: { AND: words.map((w) => ({ OR: [{ email: { contains: w, mode: 'insensitive' } }, { firstName: { contains: w, mode: 'insensitive' } }, { lastName: { contains: w, mode: 'insensitive' } }] })) },
        select: { id: true }, take: 200,
      });
      and.push({ actorId: { in: people.map((u) => u.id) } });
    }
  }
  if (f.from || f.to) {
    const tz = (await loadBusinessCalendar(db)).timeZone;
    and.push({
      createdAt: {
        ...(f.from ? { gte: zonedInstant(f.from, 0, tz) } : {}),
        ...(f.to ? { lt: zonedInstant(addCalendarDays(f.to, 1), 0, tz) } : {}),
      },
    });
  }
  return and.length ? { AND: and } : {};
}

const nameOf = (p: { firstName: string | null; lastName: string | null; email: string }) => [p.firstName, p.lastName].filter(Boolean).join(' ') || p.email;

async function readRows(db: Db, where: Prisma.DeskAuditLogWhereInput, skip: number, take: number) {
  const rows = await db.deskAuditLog.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip, take });
  const [people, agencies] = await Promise.all([
    db.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.actorId).filter((x): x is string => !!x))] } }, select: { id: true, firstName: true, lastName: true, email: true } }),
    db.agency.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.agencyId).filter((x): x is string => !!x))] } }, select: { id: true, name: true } }),
  ]);
  const person = new Map(people.map((u) => [u.id, u]));
  const agency = new Map(agencies.map((a) => [a.id, a.name]));
  return rows.map((r) => {
    const u = r.actorId ? person.get(r.actorId) : null;
    return {
      id: r.id, at: r.createdAt.toISOString(), action: r.action,
      actor: r.actorId ? { id: r.actorId, name: u ? nameOf(u) : 'Removed user', email: u?.email ?? null, role: r.actorRole } : null,
      entityType: r.entityType, entityId: r.entityId,
      agency: r.agencyId ? { id: r.agencyId, name: agency.get(r.agencyId) ?? 'Removed agency' } : null,
      metadata: r.metadata, ip: r.ipAddress, userAgent: r.userAgent,
    };
  });
}

const logged = (f: AuditFilters) => Object.fromEntries(Object.entries(f).filter(([k, v]) => v !== null && k !== 'page'));

/** One page of the log, newest first, with the choices for the filters. */
export async function listAudit(db: Db, scope: DeskScope, f: AuditFilters, ctx: GuardContext = {}) {
  opsOnly(scope);
  const where = await whereFor(db, f);
  const [total, rows, agencies] = await Promise.all([
    db.deskAuditLog.count({ where }),
    readRows(db, where, (f.page - 1) * AUDIT_PAGE_SIZE, AUDIT_PAGE_SIZE),
    db.agency.findMany({ where: { deskEnabled: true }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
  ]);
  await recordAudit(db, {
    actor: { id: scope.userId, role: scope.role }, action: 'audit.viewed', entityType: 'AuditLog', entityId: null, agencyId: f.agencyId,
    metadata: { filters: logged(f), page: f.page }, ip: ctx.ip, userAgent: ctx.userAgent,
  });
  return { total, page: f.page, pageSize: AUDIT_PAGE_SIZE, rows, choices: { actions: AUDIT_ACTIONS, groups: AUDIT_ACTION_GROUPS, agencies } };
}

/**
 * One CSV field. Quoted, and a value a spreadsheet would run as a formula
 * (starting =, +, -, @, tab or return) is prefixed with an apostrophe, so an
 * exported log can't carry a formula into someone's spreadsheet.
 */
export function csvField(value: unknown): string {
  let s = value === null || value === undefined ? '' : typeof value === 'string' ? value : JSON.stringify(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

/** The filtered log as CSV, newest first, up to AUDIT_EXPORT_MAX rows. Exporting is logged. */
export async function exportAudit(db: Db, scope: DeskScope, f: AuditFilters, ctx: GuardContext = {}) {
  opsOnly(scope);
  const where = await whereFor(db, f);
  const total = await db.deskAuditLog.count({ where });
  const rows = await readRows(db, where, 0, AUDIT_EXPORT_MAX);
  await recordAudit(db, {
    actor: { id: scope.userId, role: scope.role }, action: 'audit.exported', entityType: 'AuditLog', entityId: null, agencyId: f.agencyId,
    metadata: { filters: logged(f), rows: rows.length, total }, ip: ctx.ip, userAgent: ctx.userAgent,
  });
  const head = ['When (UTC)', 'Action', 'Who', 'Email', 'Role', 'Record type', 'Record', 'Agency', 'Details', 'IP address', 'Browser'];
  const lines = rows.map((r) => [
    r.at, r.action, r.actor?.name ?? 'System', r.actor?.email, r.actor?.role, r.entityType, r.entityId, r.agency?.name, r.metadata, r.ip, r.userAgent,
  ].map(csvField).join(','));
  return { csv: [head.map(csvField).join(','), ...lines].join('\r\n') + '\r\n', rows: rows.length, total, truncated: total > rows.length };
}

export type AuditPage = Awaited<ReturnType<typeof listAudit>>;
