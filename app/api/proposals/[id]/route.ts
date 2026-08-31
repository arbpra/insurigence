import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getAuthContext } from '@/lib/super-admin-auth';

/**
 * Single proposal read/update.
 *
 * Scoping previously came from a DEV_AGENCY_ID environment variable rather than
 * the caller's session, which meant any authenticated user could reach another
 * agency's proposals once that variable was set. It now uses the session like
 * every other endpoint.
 */
async function authorize(request: NextRequest, proposalId: string) {
  const auth = await getAuthContext(request);
  if (!auth.valid || !auth.user) return { error: auth.response! };

  const proposal = await prisma.proposal.findUnique({
    where: { id: proposalId },
    include: { lead: true },
  });
  if (!proposal) {
    return { error: NextResponse.json({ error: 'Proposal not found' }, { status: 404 }) };
  }
  // Cross-agency access returns 404 rather than 403, as elsewhere.
  if (auth.user.role !== 'SUPER_ADMIN' && proposal.agencyId !== auth.user.agencyId) {
    return { error: NextResponse.json({ error: 'Proposal not found' }, { status: 404 }) };
  }
  return { proposal, user: auth.user };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: proposalId } = await params;
    const { proposal, error } = await authorize(request, proposalId);
    if (error) return error;

    return NextResponse.json({
      proposal: {
        id: proposal.id,
        title: proposal.title,
        status: proposal.status,
        marketClassification: proposal.marketClassification,
        marketConfidence: proposal.marketConfidence ? Number(proposal.marketConfidence) : null,
        marketSummary: proposal.marketSummary,
        agentRecommendation: proposal.agentRecommendation,
        snapshot: proposal.snapshot,
        publicToken: proposal.publicToken,
        sentAt: proposal.sentAt,
        viewedAt: proposal.viewedAt,
        createdAt: proposal.createdAt,
        updatedAt: proposal.updatedAt,
        lead: {
          id: proposal.lead.id,
          insuredName: proposal.lead.insuredName,
        },
      },
    });
  } catch (error) {
    console.error('Error fetching proposal:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: proposalId } = await params;
    const { proposal, error } = await authorize(request, proposalId);
    if (error) return error;

    // A signed proposal is immutable, the same rule the builder enforces.
    if (proposal!.lockedAt) {
      return NextResponse.json(
        { error: 'This proposal has been signed and can no longer be edited.' },
        { status: 409 }
      );
    }

    const body = await request.json();
    const { agentRecommendation, status } = body;

    const updateData: Record<string, unknown> = {};
    
    if (agentRecommendation !== undefined) {
      updateData.agentRecommendation = agentRecommendation;
    }
    
    if (status !== undefined) {
      updateData.status = status;
      if (status === 'SENT' && !proposal!.sentAt) {
        updateData.sentAt = new Date();
      }
    }

    const updated = await prisma.proposal.update({
      where: { id: proposalId },
      data: updateData,
    });

    return NextResponse.json({
      proposal: {
        id: updated.id,
        title: updated.title,
        status: updated.status,
        agentRecommendation: updated.agentRecommendation,
        publicToken: updated.publicToken,
        sentAt: updated.sentAt,
        updatedAt: updated.updatedAt,
      },
    });
  } catch (error) {
    console.error('Error updating proposal:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
