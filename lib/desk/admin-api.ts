/**
 * Request guards for the Desk APIs. deskAdminRequest: signed in, Desk staff,
 * and a position allowing at least one of the permissions the route needs
 * (Module 48), or the Super Admin for 'SUPER_ADMIN'; refusals are logged.
 * deskUserRequest: signed in, with any Desk scope; what they can reach then
 * comes from the access layer.
 */
import type { PrismaClient } from '@prisma/client';
import { getSessionFromRequest } from '@/lib/auth';
import { can, DeskAccessError, isStaffScope, resolveDeskScope, type DeskScope, type GuardContext } from './access';
import type { PermissionKey } from './permission-catalogue';
import { auditRequestContext, recordAudit } from './audit';

export async function deskUserRequest(db: PrismaClient, request: Request): Promise<{ scope: DeskScope; ctx: GuardContext }> {
  const user = await getSessionFromRequest(request);
  if (!user) throw new DeskAccessError(401, 'Unauthorized');
  const scope = await resolveDeskScope(db, user.id);
  if (scope.kind === 'NONE') throw new DeskAccessError(403, 'The Desk is not available for this account.');
  return { scope, ctx: auditRequestContext(request) };
}

/** What a Desk setup or oversight route needs: any one of these permissions, or the Super Admin. */
export type AdminNeed = readonly PermissionKey[] | 'SUPER_ADMIN';

export function meetsNeed(scope: DeskScope, need: AdminNeed): boolean {
  if (need === 'SUPER_ADMIN') return scope.kind === 'PLATFORM' && scope.role === 'SUPER_ADMIN';
  return isStaffScope(scope) && need.some((p) => can(scope, p));
}

/**
 * `everyAgency`: the page covers every agency (workload, usage), so it also
 * needs a position that reaches every agency. Refused here, so the refusal is
 * logged like any other (Module 49).
 */
export async function deskAdminRequest(
  db: PrismaClient, request: Request, need: AdminNeed, agencyId?: string, opts: { everyAgency?: boolean } = {}
): Promise<{ scope: DeskScope; ctx: GuardContext }> {
  const user = await getSessionFromRequest(request);
  if (!user) throw new DeskAccessError(401, 'Unauthorized');
  const ctx = auditRequestContext(request);
  const scope = await resolveDeskScope(db, user.id);
  if (!meetsNeed(scope, need) || (opts.everyAgency && scope.kind !== 'PLATFORM')) {
    try {
      await recordAudit(db, {
        actor: { id: user.id, role: user.role }, action: 'access.denied', entityType: 'DeskSetup',
        metadata: { scope: scope.kind, needs: need, ...(opts.everyAgency ? { everyAgency: true } : {}), path: new URL(request.url).pathname, method: request.method, requestedAgencyId: agencyId?.slice(0, 64) ?? null },
        ip: ctx.ip, userAgent: ctx.userAgent,
      });
    } catch (err) {
      console.error('[desk/admin-api] could not log refused access', err);
    }
    throw new DeskAccessError(403, 'Forbidden');
  }
  return { scope, ctx };
}
