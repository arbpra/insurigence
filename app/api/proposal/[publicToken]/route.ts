import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ publicToken: string }> }
) {
  try {
    const { publicToken } = await params;

    const proposal = await prisma.proposal.findUnique({
      where: { publicToken },
      include: {
        lead: {
          include: {
            intakeSubmission: true,
          },
        },
        agency: true,
      },
    });

    if (!proposal) {
      return NextResponse.json({ error: 'Proposal not found' }, { status: 404 });
    }

    if (proposal.status === 'DRAFT') {
      return NextResponse.json({ error: 'This proposal is not yet shared' }, { status: 403 });
    }

    if (!proposal.viewedAt) {
      await prisma.proposal.update({
        where: { id: proposal.id },
        data: { 
          viewedAt: new Date(),
          status: proposal.status === 'SHARED' ? 'VIEWED' : proposal.status,
        },
      });
    }

    const snapshot = proposal.snapshot as Record<string, unknown> || {};
    const responses = proposal.lead.intakeSubmission?.responses as Record<string, unknown> || {};
    const answers = (responses?.answers || responses) as Record<string, unknown>;
    const insuredSummary = (snapshot.insuredSummary || {}) as Record<string, unknown>;

    const topFits = (snapshot.topFits || []) as Array<{
      carrierName: string;
      tier: string;
      reasons: string[];
    }>;

    const clientSafeFits = topFits.map(fit => ({
      carrierName: fit.carrierName,
      tier: fit.tier,
      reason: fit.reasons?.[0] || 'Matches your risk profile',
    }));

    return NextResponse.json({
      proposal: {
        title: proposal.title,
        status: proposal.status,
        createdAt: proposal.createdAt,
      },
      insured: {
        name: proposal.lead.insuredName,
        industry: answers.industry || insuredSummary.industry || 'Not specified',
        states: answers.states_of_operation || answers.state || insuredSummary.states || [],
        revenue: answers.annual_revenue || answers.annualRevenue || insuredSummary.revenue || 'Not specified',
      },
      market: {
        classification: proposal.marketClassification,
        confidence: proposal.marketConfidence ? Math.round(Number(proposal.marketConfidence)) : null,
        explanation: proposal.marketSummary,
      },
      carrierFits: clientSafeFits,
      agentRecommendation: proposal.agentRecommendation,
      agency: {
        name: proposal.agency.name,
        logoUrl: proposal.agency.logoUrl,
        brandPrimaryColor: proposal.agency.brandPrimaryColor,
        footerText: proposal.agency.proposalFooterText,
      },
    });
  } catch (error) {
    console.error('Error fetching public proposal:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
