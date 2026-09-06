import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { resolveProposalToken, TOKEN_FAILURE_MESSAGE } from '@/lib/proposals/token';
import { recordProposalEvent, requestContext } from '@/lib/proposals/events';
import { assembleProposal } from '@/lib/proposals/assemble';
import { markExpiredIfLapsed, syncLeadStatus } from '@/lib/proposals/status';
import { notifyAgentOfActivity } from '@/lib/proposals/notify';

/**
 * The insured's view of a proposal. No account, no session — the token is the
 * only credential, and every access rule lives in resolveProposalToken.
 *
 * Two shapes come back, distinguished by `kind`:
 *   'quote'  — the quote proposal built in Phases 1-5, assembled for the client
 *              audience so nothing internal is included.
 *   'legacy' — the original market-classification presentation, unchanged.
 *
 * Opening the link marks the proposal viewed and records the event.
 */

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ publicToken: string }> }
) {
  try {
    const { publicToken } = await params;

    const resolution = await resolveProposalToken(publicToken);
    if (!resolution.ok) {
      // 410 for a link that existed and no longer works, 404 for one that never
      // did — enough for an honest message, not enough to probe for valid tokens.
      const status = resolution.reason === 'not_found' ? 404 : 410;
      return NextResponse.json(
        { error: TOKEN_FAILURE_MESSAGE[resolution.reason], reason: resolution.reason },
        { status }
      );
    }

    const proposal = await prisma.proposal.findUniqueOrThrow({
      where: { id: resolution.proposal.id },
      include: { lead: { include: { intakeSubmission: true } }, agency: true },
    });

    // A lapsed proposal reads as SENT in the agent's list until this runs.
    await markExpiredIfLapsed(proposal);

    const isFirstView = !proposal.viewedAt;

    // Viewing never advances a proposal past a decision the insured already
    // made: someone re-reading after selecting or signing stays where they are.
    if (proposal.status === 'SENT') {
      await prisma.proposal.update({
        where: { id: proposal.id },
        data: { viewedAt: proposal.viewedAt ?? new Date(), status: 'VIEWED' },
      });
    } else if (isFirstView) {
      await prisma.proposal.update({
        where: { id: proposal.id },
        data: { viewedAt: new Date() },
      });
    }

    await recordProposalEvent(
      proposal.id,
      proposal.agencyId,
      isFirstView ? 'OPENED' : 'VIEWED',
      requestContext(request)
    );

    if (isFirstView) {
      // Only the first open is worth an email — re-reads are not news, and the
      // agent should not be pinged every time a client scrolls back.
      void notifyAgentOfActivity(proposal, 'opened');
      void syncLeadStatus(proposal.leadId, 'VIEWED');
    }

    // A quote proposal is the one with sections.
    const isQuoteProposal = Array.isArray(proposal.sections);

    if (isQuoteProposal) {
      // Once signed, serve the frozen document rather than re-assembling from
      // live data — the insured must always see exactly what they signed.
      if (proposal.signedSnapshot && proposal.lockedAt) {
        const signature = await prisma.proposalSignature.findFirst({
          where: { proposalId: proposal.id },
          orderBy: { signedAt: 'desc' },
        });
        return NextResponse.json({
          kind: 'quote',
          proposal: proposal.signedSnapshot,
          selectedQuoteOptionId: proposal.selectedQuoteOptionId,
          signedAt: proposal.signedAt?.toISOString() ?? null,
          signature: signature && {
            signerName: signature.signerName,
            signerTitle: signature.signerTitle,
            signedAt: signature.signedAt.toISOString(),
            signatureType: signature.signatureType,
            signatureData: signature.signatureData,
          },
        });
      }

      const [options, createdBy] = await Promise.all([
        prisma.quoteOption.findMany({
          where: { leadId: proposal.leadId },
          orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        }),
        proposal.createdByUserId
          ? prisma.user.findUnique({
              where: { id: proposal.createdByUserId },
              select: { firstName: true, lastName: true, email: true },
            })
          : null,
      ]);

      const assembled = assembleProposal(
        { proposal, lead: proposal.lead, agency: proposal.agency, options, createdBy },
        { audience: 'client' }
      );

      return NextResponse.json({
        kind: 'quote',
        proposal: assembled,
        selectedQuoteOptionId: proposal.selectedQuoteOptionId,
        signedAt: proposal.signedAt?.toISOString() ?? null,
      });
    }

    // ── Legacy market-classification presentation ──
    const snapshot = (proposal.snapshot as Record<string, unknown>) || {};
    const responses = (proposal.lead.intakeSubmission?.responses as Record<string, unknown>) || {};
    const answers = (responses?.answers || responses) as Record<string, unknown>;
    const insuredSummary = (snapshot.insuredSummary || {}) as Record<string, unknown>;

    const topFits = (snapshot.topFits || []) as Array<{
      carrierName: string;
      tier: string;
      reasons: string[];
    }>;

    return NextResponse.json({
      kind: 'legacy',
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
      carrierFits: topFits.map((fit) => ({
        carrierName: fit.carrierName,
        tier: fit.tier,
        reason: fit.reasons?.[0] || 'Matches your risk profile',
      })),
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
