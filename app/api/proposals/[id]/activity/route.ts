import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getAuthContext } from '@/lib/super-admin-auth';
import { describeDevice } from '@/lib/proposals/signature';

/**
 * E-Sign Activity log for a proposal (requirement 10).
 *
 * GET → every recorded event in order, plus the signature audit record.
 *
 * Available to the Agent and the Agency Admin, agency-scoped like everything
 * else. Nothing here is ever exposed to the insured.
 */

/** Plain wording for each event type, for a reader who is not a developer. */
const EVENT_LABEL: Record<string, string> = {
  CREATED: 'Proposal created',
  SENT: 'Proposal sent',
  RESENT: 'Proposal resent',
  OPENED: 'Proposal opened by the client',
  VIEWED: 'Proposal viewed again',
  OPTION_SELECTED: 'Option selected',
  OPTION_CHANGED: 'Selection changed',
  SIGNED: 'Proposal electronically signed',
  PDF_GENERATED: 'PDF downloaded',
  LINK_REVOKED: 'Link withdrawn',
  VERSION_CREATED: 'New version created',
  EXPIRED: 'Link expired',
};

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await getAuthContext(request);
    if (!auth.valid || !auth.user) return auth.response!;

    const { id } = await params;
    const proposal = await prisma.proposal.findUnique({ where: { id } });
    if (!proposal) {
      return NextResponse.json({ error: 'Proposal not found' }, { status: 404 });
    }
    if (auth.user.role !== 'SUPER_ADMIN' && proposal.agencyId !== auth.user.agencyId) {
      return NextResponse.json({ error: 'Proposal not found' }, { status: 404 });
    }

    const [events, signature] = await Promise.all([
      prisma.proposalActivityEvent.findMany({
        where: { proposalId: proposal.id },
        orderBy: { createdAt: 'asc' },
        take: 500,
      }),
      prisma.proposalSignature.findFirst({
        where: { proposalId: proposal.id },
        orderBy: { signedAt: 'desc' },
      }),
    ]);

    return NextResponse.json({
      events: events.map((e) => ({
        id: e.id,
        type: e.eventType,
        label: EVENT_LABEL[e.eventType] ?? e.eventType,
        at: e.createdAt.toISOString(),
        ipAddress: e.ipAddress,
        device: describeDevice(e.userAgent),
        metadata: e.metadata ?? null,
      })),
      // The signature image itself is deliberately not returned — the log is a
      // record of what happened, and the image belongs on the signed document.
      signature: signature && {
        signerName: signature.signerName,
        signerTitle: signature.signerTitle,
        signerEmail: signature.signerEmail,
        signedAt: signature.signedAt.toISOString(),
        ipAddress: signature.ipAddress,
        device: describeDevice(signature.userAgent),
        signatureType: signature.signatureType,
        proposalVersion: signature.proposalVersion,
        consentAccepted: signature.consentAccepted,
        consentText: signature.consentText,
      },
      status: proposal.status,
    });
  } catch (err) {
    console.error('[proposal-activity] GET failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
