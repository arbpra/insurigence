import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getAuthContext } from '@/lib/super-admin-auth';
import { sendEmail } from '@/lib/email/send';
import { proposalSentEmail } from '@/lib/email/templates';
import { APP_URL } from '@/lib/email/client';
import { generateProposalToken, defaultExpiry, proposalUrl } from '@/lib/proposals/token';
import { recordProposalEvent, requestContext } from '@/lib/proposals/events';
import { resolveDisclaimer } from '@/lib/proposals/branding';
import { assembleProposal, proposalReadiness } from '@/lib/proposals/assemble';

/**
 * Send a proposal to the insured.
 *
 * POST → mint the secure link if the proposal does not have one, freeze the
 *        disclaimer, move the status to SENT, and optionally email the link.
 *
 * Re-sending an already-sent proposal reuses the same token so a link the
 * insured already has keeps working. `?resend=true` is a reminder, not a new
 * proposal.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function authorizeProposal(request: NextRequest, proposalId: string) {
  const auth = await getAuthContext(request);
  if (!auth.valid || !auth.user) return { error: auth.response! };

  const proposal = await prisma.proposal.findUnique({ where: { id: proposalId } });
  if (!proposal) {
    return { error: NextResponse.json({ error: 'Proposal not found' }, { status: 404 }) };
  }
  if (auth.user.role !== 'SUPER_ADMIN' && proposal.agencyId !== auth.user.agencyId) {
    return { error: NextResponse.json({ error: 'Proposal not found' }, { status: 404 }) };
  }
  return { proposal, user: auth.user };
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { proposal, error } = await authorizeProposal(request, id);
    if (error) return error;

    if (proposal!.lockedAt) {
      return NextResponse.json(
        { error: 'This proposal has been signed and cannot be resent. Create a new version instead.' },
        { status: 409 }
      );
    }

    let body: { email?: unknown; sendEmail?: unknown; resend?: unknown } = {};
    try {
      body = await request.json();
    } catch {
      // Body is optional — sending without emailing is valid.
    }

    const isResend = body.resend === true;
    const shouldEmail = body.sendEmail !== false;

    const [lead, agency, options] = await Promise.all([
      prisma.lead.findUnique({ where: { id: proposal!.leadId } }),
      prisma.agency.findUnique({ where: { id: proposal!.agencyId } }),
      prisma.quoteOption.findMany({
        where: { leadId: proposal!.leadId },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      }),
    ]);
    if (!lead || !agency) {
      return NextResponse.json({ error: 'Proposal is missing its lead or agency' }, { status: 500 });
    }

    // Refuse to put an incomplete proposal in front of an insured. The builder
    // shows the same list, but an agent can reach this endpoint another way.
    const preflight = assembleProposal(
      { proposal: proposal!, lead, agency, options },
      { audience: 'agent' }
    );
    // Hints are not blockers — an empty optional section simply does not render.
    const { blockers } = proposalReadiness(preflight);
    if (blockers.length > 0) {
      return NextResponse.json(
        { error: 'This proposal is not ready to send.', problems: blockers },
        { status: 400 }
      );
    }

    const recipient = typeof body.email === 'string' && body.email.trim() !== ''
      ? body.email.trim().toLowerCase()
      : lead.primaryContactEmail?.trim().toLowerCase() ?? null;

    if (shouldEmail) {
      if (!recipient) {
        return NextResponse.json(
          { error: 'No email address for this insured. Add one, or copy the link instead.' },
          { status: 400 }
        );
      }
      if (!EMAIL_RE.test(recipient)) {
        return NextResponse.json({ error: 'That email address is not valid.' }, { status: 400 });
      }
    }

    const now = new Date();

    // Reuse an existing token so a link already in the insured's inbox keeps
    // working; only mint one when there is none, or when a revoked link is
    // being reinstated (in which case the old one must stay dead).
    const reinstating = Boolean(proposal!.tokenRevokedAt);
    const token = proposal!.publicToken && !reinstating
      ? proposal!.publicToken
      : generateProposalToken();

    // An existing expiry is kept only while it is still in the future. A lapsed
    // one must be extended: otherwise resending an expired proposal would send a
    // link that is already dead, which looks like a successful send to the agent.
    const expiryStillValid =
      proposal!.expiresAt !== null && proposal!.expiresAt.getTime() > now.getTime();

    const updated = await prisma.proposal.update({
      where: { id: proposal!.id },
      data: {
        publicToken: token,
        tokenRevokedAt: null,
        status: 'SENT',
        sentAt: proposal!.sentAt ?? now,
        expiresAt: expiryStillValid ? proposal!.expiresAt : defaultExpiry(now),
        // Freeze the disclaimer at send time so later agency edits cannot
        // change what this insured was shown.
        disclaimerText: proposal!.disclaimerText
          ?? resolveDisclaimer(agency.proposalDisclaimerText),
      },
    });

    const url = proposalUrl(token, APP_URL);

    let emailed = false;
    let emailError: string | null = null;
    if (shouldEmail && recipient) {
      const createdBy = updated.createdByUserId
        ? await prisma.user.findUnique({
            where: { id: updated.createdByUserId },
            select: { firstName: true, lastName: true },
          })
        : null;
      const agentName = createdBy
        ? [createdBy.firstName, createdBy.lastName].filter(Boolean).join(' ').trim() || null
        : null;

      const mail = proposalSentEmail({
        insuredName: lead.insuredName,
        agencyName: agency.name,
        agentName,
        proposalUrl: url,
        clientMessage: updated.clientMessage,
        expiresAt: updated.expiresAt,
        isResend,
      });
      const result = await sendEmail({
        to: recipient,
        subject: mail.subject,
        html: mail.html,
        text: mail.text,
        replyTo: agency.primaryEmail ?? undefined,
      });
      emailed = result.ok;
      if (!result.ok) emailError = result.error ?? 'Email could not be sent.';
    }

    await recordProposalEvent(
      updated.id,
      updated.agencyId,
      isResend ? 'RESENT' : 'SENT',
      { ...requestContext(request), metadata: { emailed, recipient: recipient ?? null } }
    );

    return NextResponse.json({
      proposalUrl: url,
      status: updated.status,
      sentAt: updated.sentAt?.toISOString() ?? null,
      expiresAt: updated.expiresAt?.toISOString() ?? null,
      emailed,
      // The link is minted regardless — a failed email must not lose it.
      emailError,
      recipient: recipient ?? null,
    });
  } catch (err) {
    console.error('[proposal-send] POST failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
