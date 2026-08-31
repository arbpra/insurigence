/**
 * Proposal activity events — the raw material for the E-Sign Activity log
 * (requirement 10).
 *
 * Recording is best-effort and never throws: losing a log line is bad, but
 * failing an insured's signature because the audit write hiccupped would be
 * worse. Failures are logged loudly instead.
 *
 * Phase 9 builds the log UI on top of what is written here.
 */

import prisma from '../prisma';
import type { ProposalEventType } from '@prisma/client';
import type { NextRequest } from 'next/server';

export interface EventContext {
  ipAddress?: string | null;
  userAgent?: string | null;
  metadata?: Record<string, unknown>;
}

/**
 * Client IP from the proxy headers DigitalOcean/Cloudflare set.
 *
 * `x-forwarded-for` is a client-controllable header, so this value is evidence
 * of origin, not proof of it. It is recorded for the audit trail and must never
 * be used for an access decision.
 */
export function requestContext(request: NextRequest): EventContext {
  const forwarded = request.headers.get('x-forwarded-for');
  const ip =
    request.headers.get('cf-connecting-ip') ??
    (forwarded ? forwarded.split(',')[0].trim() : null) ??
    request.headers.get('x-real-ip');

  return {
    ipAddress: ip,
    userAgent: request.headers.get('user-agent'),
  };
}

export async function recordProposalEvent(
  proposalId: string,
  agencyId: string,
  eventType: ProposalEventType,
  context: EventContext = {}
): Promise<void> {
  try {
    await prisma.proposalActivityEvent.create({
      data: {
        proposalId,
        agencyId,
        eventType,
        ipAddress: context.ipAddress ?? null,
        userAgent: context.userAgent?.slice(0, 500) ?? null,
        metadata: (context.metadata ?? undefined) as never,
      },
    });
  } catch (err) {
    console.error(`[proposal-events] failed to record ${eventType} for ${proposalId}:`, err);
  }
}
