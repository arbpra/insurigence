import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: proposalId } = await params;
    const agencyId = process.env.DEV_AGENCY_ID;

    if (!agencyId) {
      return NextResponse.json({ error: 'DEV_AGENCY_ID not configured' }, { status: 500 });
    }

    const proposal = await prisma.proposal.findUnique({
      where: { id: proposalId },
      include: {
        lead: true,
      },
    });

    if (!proposal) {
      return NextResponse.json({ error: 'Proposal not found' }, { status: 404 });
    }

    if (proposal.agencyId !== agencyId) {
      return NextResponse.json({ error: 'Proposal not found' }, { status: 404 });
    }

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
        sharedAt: proposal.sharedAt,
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
    const agencyId = process.env.DEV_AGENCY_ID;

    if (!agencyId) {
      return NextResponse.json({ error: 'DEV_AGENCY_ID not configured' }, { status: 500 });
    }

    const body = await request.json();
    const { agentRecommendation, status } = body;

    const proposal = await prisma.proposal.findUnique({
      where: { id: proposalId },
    });

    if (!proposal) {
      return NextResponse.json({ error: 'Proposal not found' }, { status: 404 });
    }

    if (proposal.agencyId !== agencyId) {
      return NextResponse.json({ error: 'Proposal not found' }, { status: 404 });
    }

    const updateData: Record<string, unknown> = {};
    
    if (agentRecommendation !== undefined) {
      updateData.agentRecommendation = agentRecommendation;
    }
    
    if (status !== undefined) {
      updateData.status = status;
      if (status === 'SHARED' && !proposal.sharedAt) {
        updateData.sharedAt = new Date();
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
        sharedAt: updated.sharedAt,
        updatedAt: updated.updatedAt,
      },
    });
  } catch (error) {
    console.error('Error updating proposal:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
