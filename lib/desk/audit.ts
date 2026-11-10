import type { Prisma, PrismaClient } from '@prisma/client';

/**
 * The Desk's security trail. Every create, change, view, download and refused
 * attempt is recorded here (client requirement, 27 Oct 2026).
 *
 * Fails closed: recordAudit throws if the entry cannot be written, so callers
 * must write the audit entry before (or in the same transaction as) the action
 * — an action that cannot be logged does not happen.
 */

/** Known actions. Kept as strings in the database so new ones need no migration. */
export const AUDIT_ACTIONS = [
  'task.created', 'task.viewed', 'task.updated', 'task.status_changed', 'task.assigned', 'task.reclassified',
  'task.routed', 'task.restricted', 'task.escalated', 'task.note_added', 'task.billing_classified',
  'document.uploaded', 'document.viewed', 'document.downloaded', 'document.removed',
  'insured.created', 'insured.viewed', 'insured.updated', 'insured.assigned',
  'policy.created', 'policy.updated', 'policy.removed',
  'import.staged', 'import.rejected', 'import.viewed', 'import.header_changed', 'import.mapped', 'import.previewed', 'import.discarded', 'import.committed', 'import.undone',
  'agency.desk_updated', 'permission.changed',
  'staff.invited', 'staff.invite_resent', 'staff.updated', 'staff.deactivated', 'staff.reactivated',
  'pod.created', 'pod.updated', 'pod.member_added', 'pod.member_removed', 'pod.access_changed',
  'routing.changed', 'service_level.changed',
  'calendar.changed', 'holiday.added', 'holiday.removed',
  'access.denied',
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export interface AuditEntry {
  actor: { id: string; role: string } | null;
  action: AuditAction;
  entityType: string;
  entityId?: string | null;
  agencyId?: string | null;
  metadata?: Record<string, unknown>;
  ip?: string | null;
  userAgent?: string | null;
}

const SECRET_KEY = /pass(word|wd|code)?|secret|token|api[_-]?key|credential|pin$/i;

/** Copies metadata with any value under a secret-looking key replaced. */
export function redactMetadata(value: unknown, depth = 0): unknown {
  if (depth > 8 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((v) => redactMetadata(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    out[k] = SECRET_KEY.test(k) ? '[redacted]' : redactMetadata(v, depth + 1);
  }
  return out;
}

/** Caller IP (first hop of x-forwarded-for) and user agent from a request. */
export function auditRequestContext(request: Request): { ip: string | null; userAgent: string | null } {
  const fwd = request.headers.get('x-forwarded-for');
  return {
    ip: (fwd ? fwd.split(',')[0].trim() : request.headers.get('x-real-ip')) || null,
    userAgent: request.headers.get('user-agent'),
  };
}

type AuditClient = Pick<PrismaClient, 'deskAuditLog'> | Prisma.TransactionClient;

/** Writes one audit entry. Throws on failure (fail closed). */
export async function recordAudit(db: AuditClient, entry: AuditEntry): Promise<void> {
  await db.deskAuditLog.create({
    data: {
      actorId: entry.actor?.id ?? null,
      actorRole: entry.actor?.role ?? null,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId ?? null,
      agencyId: entry.agencyId ?? null,
      metadata: entry.metadata ? (redactMetadata(entry.metadata) as Prisma.InputJsonValue) : undefined,
      ipAddress: entry.ip ?? null,
      userAgent: entry.userAgent ?? null,
    },
  });
}
