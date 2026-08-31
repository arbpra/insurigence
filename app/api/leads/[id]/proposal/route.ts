import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { randomBytes } from 'crypto';
import { getAuthContext } from '@/lib/super-admin-auth';

function generatePublicToken(): string {
  return randomBytes(32).toString('hex');
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await getAuthContext(request);
    if (!auth.valid || !auth.user) return auth.response!;

    const { id: leadId } = await params;

    const lead = await prisma.lead.findUnique({
      where: { id: leadId },
      include: {
        intakeSubmission: true,
        carrierFits: {
          include: { carrier: true },
          orderBy: { score: 'desc' },
        },
      },
    });

    if (!lead) {
      return NextResponse.json({ error: 'Lead not found' }, { status: 404 });
    }

    if (auth.user.role !== 'SUPER_ADMIN' && lead.agencyId !== auth.user.agencyId) {
      return NextResponse.json({ error: 'Lead not found' }, { status: 404 });
    }

    const agencyId = lead.agencyId;

    const responses = lead.intakeSubmission?.responses as Record<string, unknown> || {};
    const answers = (responses?.answers || responses) as Record<string, unknown>;

    const insuredSummary = {
      name: lead.insuredName,
      industry: answers.industry || 'Not specified',
      states: answers.states_of_operation || [],
      revenue: answers.annual_revenue || 'Not specified',
      yearsInBusiness: answers.years_in_business || 'Not specified',
    };

    const topFits = lead.carrierFits
      .filter(f => f.tier !== 'NO_FIT')
      .slice(0, 5)
      .map(f => ({
        carrierId: f.carrierId,
        carrierName: f.carrier.name,
        tier: f.tier,
        score: Number(f.score),
        reasons: f.reasons,
      }));

    const snapshot = {
      insuredSummary,
      marketClassification: lead.marketClassification,
      marketConfidence: lead.marketConfidence ? Number(lead.marketConfidence) : null,
      marketReasonCodes: lead.marketReasonCodes,
      topFits,
      generatedAt: new Date().toISOString(),
    };

    const marketExplanations: Record<string, string> = {
      STANDARD: 'This risk qualifies for placement with standard market carriers, which typically offer the most competitive rates and broadest coverage options.',
      EXCESS_SURPLUS: 'This risk is best suited for the Excess & Surplus (E&S) market due to specific risk characteristics that fall outside standard carrier appetites.',
      BORDERLINE: 'This risk falls between standard and E&S markets. We recommend exploring both options to find the best coverage and pricing combination.',
    };

    const marketSummary = lead.marketClassification 
      ? marketExplanations[lead.marketClassification] || 'Market classification pending evaluation.'
      : 'This lead has not yet been evaluated for market classification.';

    const publicToken = generatePublicToken();

    const proposal = await prisma.proposal.create({
      data: {
        agencyId,
        leadId,
        title: `Market Summary - ${lead.insuredName}`,
        status: 'DRAFT',
        marketClassification: lead.marketClassification,
        marketConfidence: lead.marketConfidence,
        marketSummary,
        snapshot,
        publicToken,
      },
    });

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
        createdAt: proposal.createdAt,
      },
    });
  } catch (error) {
    console.error('Error generating proposal:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await getAuthContext(request);
    if (!auth.valid || !auth.user) return auth.response!;

    const { id: leadId } = await params;

    const lead = await prisma.lead.findUnique({
      where: { id: leadId },
      include: {
        intakeSubmission: true,
        carrierFits: {
          include: { carrier: true },
          orderBy: { score: 'desc' },
        },
        proposals: {
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
        agency: true,
      },
    });

    if (!lead) {
      return NextResponse.json({ error: 'Lead not found' }, { status: 404 });
    }

    if (auth.user.role !== 'SUPER_ADMIN' && lead.agencyId !== auth.user.agencyId) {
      return NextResponse.json({ error: 'Lead not found' }, { status: 404 });
    }

    const responses = lead.intakeSubmission?.responses as Record<string, unknown> || {};
    const answers = (responses?.answers || responses) as Record<string, unknown>;

    const insuredSummary = {
      name: lead.insuredName,
      industry: answers.industry || 'Not specified',
      states: answers.states_of_operation || answers.state || [],
      revenue: answers.annual_revenue || answers.annualRevenue || 'Not specified',
      yearsInBusiness: answers.years_in_business || answers.yearsInBusiness || 'Not specified',
      employees: answers.numberOfEmployees || 'Not specified',
    };

    const carrierFits = lead.carrierFits.map(f => ({
      carrierId: f.carrierId,
      carrierName: f.carrier.name,
      tier: f.tier,
      score: Number(f.score),
      reasons: f.reasons,
    }));

    const latestProposal = lead.proposals[0] || null;

    return NextResponse.json({
      lead: {
        id: lead.id,
        insuredName: lead.insuredName,
        lob: lead.lob,
        status: lead.status,
        marketClassification: lead.marketClassification,
        marketConfidence: lead.marketConfidence ? Number(lead.marketConfidence) : null,
        marketReasonCodes: lead.marketReasonCodes,
      },
      insuredSummary,
      carrierFits,
      agency: {
        name: lead.agency.name,
        logoUrl: lead.agency.logoUrl,
        brandPrimaryColor: lead.agency.brandPrimaryColor,
        proposalFooterText: lead.agency.proposalFooterText,
      },
      latestProposal: latestProposal ? {
        id: latestProposal.id,
        title: latestProposal.title,
        status: latestProposal.status,
        marketClassification: latestProposal.marketClassification,
        marketConfidence: latestProposal.marketConfidence ? Number(latestProposal.marketConfidence) : null,
        marketSummary: latestProposal.marketSummary,
        agentRecommendation: latestProposal.agentRecommendation,
        snapshot: latestProposal.snapshot,
        publicToken: latestProposal.publicToken,
        createdAt: latestProposal.createdAt,
      } : null,
    });
  } catch (error) {
    console.error('Error fetching lead for proposal:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await getAuthContext(request);
    if (!auth.valid || !auth.user) return auth.response!;

    const { id: leadId } = await params;
    const body = await request.json();
    const { proposalId, agentRecommendation, status } = body;

    const proposal = await prisma.proposal.findUnique({
      where: { id: proposalId },
    });

    if (
      !proposal ||
      proposal.leadId !== leadId ||
      (auth.user.role !== 'SUPER_ADMIN' && proposal.agencyId !== auth.user.agencyId)
    ) {
      return NextResponse.json({ error: 'Proposal not found' }, { status: 404 });
    }

    const updateData: Record<string, unknown> = {};
    if (agentRecommendation !== undefined) {
      updateData.agentRecommendation = agentRecommendation;
    }
    if (status !== undefined) {
      updateData.status = status;
      if (status === 'SENT') {
        updateData.sentAt = new Date();
      }
    }

    const updatedProposal = await prisma.proposal.update({
      where: { id: proposalId },
      data: updateData,
    });

    return NextResponse.json({
      proposal: {
        id: updatedProposal.id,
        title: updatedProposal.title,
        status: updatedProposal.status,
        agentRecommendation: updatedProposal.agentRecommendation,
        publicToken: updatedProposal.publicToken,
      },
    });
  } catch (error) {
    console.error('Error updating proposal:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
