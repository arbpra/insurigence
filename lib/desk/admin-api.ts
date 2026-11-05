/**
 * Request guard for the Desk setup APIs: signed in, and a Desk scope of
 * PLATFORM (Super Admin or Operations Manager). Refusals are logged.
 */
import type { PrismaClient } from '@prisma/client';
import { getSessionFromRequest } from '@/lib/auth';
import { DeskAccessError, resolveDeskScope, type DeskScope, type GuardContext } from './access';
import { auditRequestContext, recordAudit } from './audit';

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
