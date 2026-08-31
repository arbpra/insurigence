import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { resolveProposalToken, TOKEN_FAILURE_MESSAGE } from '@/lib/proposals/token';
import { recordProposalEvent, requestContext } from '@/lib/proposals/events';

/**
 * The insured chooses an option (requirement 8).
 *
 * POST → record the selection, its timestamp, and which proposal and option it
 *        belongs to. Selecting again before signing is allowed and simply
 *        replaces the previous choice.
 *
 * Selecting is explicitly NOT signing. It records a preference and notifies the
 * agent; nothing is bound and nothing is locked until a signature exists.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ publicToken: string }> }
) {
  try {
    const { publicToken } = await params;

    const resolution = await resolveProposalToken(publicToken);
    if (!resolution.ok) {
      const status = resolution.reason === 'not_found' ? 404 : 410;
      return NextResponse.json(
        { error: TOKEN_FAILURE_MESSAGE[resolution.reason], reason: resolution.reason },
        { status }
      );
    }
    const proposal = resolution.proposal;

    // Once signed, the selection is part of what was agreed to.
    if (proposal.lockedAt || proposal.status === 'SIGNED') {
      return NextResponse.json(
        { error: 'This proposal has been signed. Contact your agent to make a change.' },
        { status: 409 }
      );
    }

    let body: { quoteOptionId?: unknown };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
    }

    const quoteOptionId = typeof body.quoteOptionId === 'string' ? body.quoteOptionId : null;
    if (!quoteOptionId) {
      return NextResponse.json({ error: 'Choose an option first.' }, { status: 400 });
    }

    // The option must belong to this proposal's lead. Without this check the
    // token would authorise selecting any option in the database.
    const option = await prisma.quoteOption.findFirst({
      where: { id: quoteOptionId, leadId: proposal.leadId, agencyId: proposal.agencyId },
      select: { id: true, optionLabel: true, carrierName: true },
    });
    if (!option) {
      return NextResponse.json({ error: 'That option is not part of this proposal.' }, { status: 400 });
    }

    const isChange = Boolean(proposal.selectedQuoteOptionId) &&
      proposal.selectedQuoteOptionId !== option.id;

    const updated = await prisma.proposal.update({
      where: { id: proposal.id },
      data: {
        selectedQuoteOptionId: option.id,
        // The first selection stamps the time; changing the mind does not
        // rewrite when the insured first decided.
        selectedAt: proposal.selectedAt ?? new Date(),
        status: 'OPTION_SELECTED',
      },
    });

    await recordProposalEvent(
      updated.id,
      updated.agencyId,
      isChange ? 'OPTION_CHANGED' : 'OPTION_SELECTED',
      {
        ...requestContext(request),
        metadata: {
          quoteOptionId: option.id,
          optionLabel: option.optionLabel ?? option.carrierName ?? 'Option',
          ...(isChange ? { previousQuoteOptionId: proposal.selectedQuoteOptionId } : {}),
        },
      }
    );

    return NextResponse.json({
      selectedQuoteOptionId: updated.selectedQuoteOptionId,
      selectedAt: updated.selectedAt?.toISOString() ?? null,
      status: updated.status,
    });
  } catch (err) {
    console.error('[proposal-select] POST failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
