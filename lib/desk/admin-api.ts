/**
 * Request guards for the Desk APIs. deskAdminRequest: signed in, and a Desk
 * scope of PLATFORM (Super Admin or Operations Manager), with refusals logged.
 * deskUserRequest: signed in, with any Desk scope; what they can reach then
 * comes from the access layer.
 */
import type { PrismaClient } from '@prisma/client';
import { getSessionFromRequest } from '@/lib/auth';
import { DeskAccessError, resolveDeskScope, type DeskScope, type GuardContext } from './access';
import { auditRequestContext, recordAudit } from './audit';

export async function deskUserRequest(db: PrismaClient, request: Request): Promise<{ scope: DeskScope; ctx: GuardContext }> {
  const user = await getSessionFromRequest(request);
  if (!user) throw new DeskAccessError(401, 'Unauthorized');
  const scope = await resolveDeskScope(db, user.id);
  if (scope.kind === 'NONE') throw new DeskAccessError(403, 'The Desk is not available for this account.');
  return { scope, ctx: auditRequestContext(request) };
}

export async function deskAdminRequest(db: PrismaClient, request: Request, agencyId?: string): Promise<{ scope: DeskScope; ctx: GuardContext }> {
  const user = await getSessionFromRequest(request);
  if (!user) throw new DeskAccessError(401, 'Unauthorized');
  const ctx = auditRequestContext(request);
  const scope = await resolveDeskScope(db, user.id);
  if (scope.kind !== 'PLATFORM') {
    try {
      await recordAudit(db, {
        actor: { id: user.id, role: user.role }, action: 'access.denied', entityType: 'DeskSetup',
        metadata: { scope: scope.kind, path: new URL(request.url).pathname, method: request.method, requestedAgencyId: agencyId?.slice(0, 64) ?? null },
        ip: ctx.ip, userAgent: ctx.userAgent,
      });
    } catch (err) {
      console.error('[desk/admin-api] could not log refused access', err);
    }
    throw new DeskAccessError(403, 'Forbidden');
  }
  return { scope, ctx };
}
