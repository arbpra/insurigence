import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getAuthContext } from '@/lib/super-admin-auth';
import { recordProposalEvent, requestContext } from '@/lib/proposals/events';

/**
 * Withdraw a proposal link.
 *
 * POST → mark the token revoked so the link stops working immediately.
 *
 * The token is kept rather than cleared: an audit trail should be able to show
 * which link was withdrawn and when. `resolveProposalToken` refuses any proposal
 * with `tokenRevokedAt` set, so retaining the value is not a way back in.
 */
export async function POST(
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

    // A signed proposal is a record of what the insured agreed to. Withdrawing
    // the link would take away their own copy of it.
    if (proposal.lockedAt || proposal.status === 'SIGNED') {
      return NextResponse.json(
        { error: 'This proposal has been signed — its link cannot be withdrawn.' },
        { status: 409 }
      );
    }

    if (!proposal.publicToken) {
      return NextResponse.json({ error: 'This proposal has no link to withdraw.' }, { status: 400 });
    }

    const updated = await prisma.proposal.update({
      where: { id: proposal.id },
      data: { tokenRevokedAt: new Date(), status: 'REVOKED' },
    });

    await recordProposalEvent(updated.id, updated.agencyId, 'LINK_REVOKED', requestContext(request));

    return NextResponse.json({
      status: updated.status,
      revokedAt: updated.tokenRevokedAt?.toISOString() ?? null,
    });
  } catch (err) {
    console.error('[proposal-revoke] POST failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
