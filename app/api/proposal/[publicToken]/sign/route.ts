import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { Prisma } from '@prisma/client';
import { resolveProposalToken, TOKEN_FAILURE_MESSAGE } from '@/lib/proposals/token';
import { recordProposalEvent, requestContext } from '@/lib/proposals/events';
import { assembleProposal } from '@/lib/proposals/assemble';
import {
  parseSignatureInput, ESIGN_CONSENT_TEXT, SignatureValidationError,
} from '@/lib/proposals/signature';

/**
 * The insured signs the proposal (requirement 9).
 *
 * POST → record the signature with its full audit trail, freeze the document as
 *        it stood at this moment, and lock the proposal.
 *
 * Three things happen atomically, in this order of importance:
 *   1. The signature row is written — the evidence.
 *   2. The proposal is snapshotted — what was signed.
 *   3. The proposal is locked — nothing may change it afterwards.
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

    // Signing twice is not a retry — the first signature already stands.
    if (proposal.lockedAt || proposal.status === 'SIGNED') {
      return NextResponse.json(
        { error: 'This proposal has already been signed.' },
        { status: 409 }
      );
    }

    // Requirement 8 puts selection before signature: a signature has to attach
    // to a specific option, or there is no record of what was agreed to.
    if (!proposal.selectedQuoteOptionId) {
      return NextResponse.json(
        { error: 'Please choose an option before signing.' },
        { status: 400 }
      );
    }

    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
    }

    const input = parseSignatureInput(body);

    const [lead, agency, options] = await Promise.all([
      prisma.lead.findUnique({ where: { id: proposal.leadId } }),
      prisma.agency.findUnique({ where: { id: proposal.agencyId } }),
      prisma.quoteOption.findMany({
        where: { leadId: proposal.leadId },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      }),
    ]);
    if (!lead || !agency) {
      return NextResponse.json({ error: 'This proposal is incomplete.' }, { status: 500 });
    }

    // The selected option must still exist and still belong here.
    const selected = options.find((o) => o.id === proposal.selectedQuoteOptionId);
    if (!selected) {
      return NextResponse.json(
        { error: 'The option you selected is no longer available. Please contact your agent.' },
        { status: 409 }
      );
    }

    const context = requestContext(request);
    const now = new Date();

    // Freeze exactly what the insured is agreeing to. Data sections normally
    // render from live quote options, so without this a later edit would change
    // the signed document retroactively.
    const snapshot = assembleProposal(
      { proposal, lead, agency, options },
      { audience: 'client' }
    );

    const [signature, updated] = await prisma.$transaction([
      prisma.proposalSignature.create({
        data: {
          proposalId: proposal.id,
          agencyId: proposal.agencyId,
          signerName: input.signerName,
          signerEmail: input.signerEmail,
          signerTitle: input.signerTitle,
          signatureType: input.signatureType,
          signatureData: input.signatureData,
          consentAccepted: true,
          // Stored verbatim: consent was to these words, not to whatever the
          // wording later becomes.
          consentText: ESIGN_CONSENT_TEXT,
          selectedQuoteOptionId: selected.id,
          proposalVersion: proposal.version,
          signedAt: now,
          ipAddress: context.ipAddress ?? null,
          userAgent: context.userAgent?.slice(0, 500) ?? null,
        },
      }),
      prisma.proposal.update({
        where: { id: proposal.id },
        data: {
          status: 'SIGNED',
          signedAt: now,
          lockedAt: now,
          signedSnapshot: snapshot as unknown as Prisma.InputJsonValue,
        },
      }),
    ]);

    await recordProposalEvent(proposal.id, proposal.agencyId, 'SIGNED', {
      ...context,
      metadata: {
        signatureId: signature.id,
        signerName: input.signerName,
        signatureType: input.signatureType,
        proposalVersion: proposal.version,
        selectedQuoteOptionId: selected.id,
      },
    });

    // Move the lead forward, but never to BOUND — Insurigence does not bind
    // coverage (requirement 13). PRESENTED is the furthest this may go on its own.
    if (['NEW', 'WAITING_ON_INFO', 'READY_TO_MARKET', 'QUOTED'].includes(lead.status)) {
      await prisma.lead
        .update({ where: { id: lead.id }, data: { status: 'PRESENTED' } })
        .catch((e) => console.error('[proposal-sign] lead status update failed:', e));
    }

    return NextResponse.json({
      signedAt: updated.signedAt?.toISOString() ?? null,
      status: updated.status,
      signerName: signature.signerName,
    });
  } catch (err) {
    if (err instanceof SignatureValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    console.error('[proposal-sign] POST failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
