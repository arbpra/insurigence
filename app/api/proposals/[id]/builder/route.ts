import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { Prisma } from '@prisma/client';
import { getAuthContext } from '@/lib/super-admin-auth';
import { parseSectionInput, SectionValidationError } from '@/lib/proposals/sections';
import { assembleProposal, proposalReadiness } from '@/lib/proposals/assemble';
import { needsNewVersion, createNextVersion } from '@/lib/proposals/versioning';

/**
 * Save the proposal being built.
 *
 * PATCH → title, client message, and the section layout (order, titles,
 *         enabled state, and the prose of content sections).
 *
 * A DRAFT is edited in place. A proposal the insured already has a link to is
 * never overwritten silently (requirement 14): the caller must pass
 * `createVersion: true`, which forks it into the next version and edits that.
 * A signed proposal is never mutated at all.
 */

const MAX_TITLE = 200;
const MAX_MESSAGE = 5000;

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

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { proposal, user, error } = await authorizeProposal(request, id);
    if (error) return error;

    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    // Requirement 14: a proposal the insured already has a link to is never
    // overwritten silently. Forking is opt-in so the builder's autosave cannot
    // spawn versions while someone is simply typing — the UI asks first.
    let target = proposal!;
    let createdVersion = false;

    if (needsNewVersion(target)) {
      if (body.createVersion !== true) {
        return NextResponse.json(
          {
            error: target.lockedAt
              ? 'This proposal has been signed and cannot be edited. Create a new version to make changes.'
              : 'This proposal has already been sent. Editing it will create a new version.',
            canCreateVersion: true,
            currentVersion: target.version,
            signed: Boolean(target.lockedAt),
          },
          { status: 409 }
        );
      }
      target = await createNextVersion(target, user?.id ?? null);
      createdVersion = true;
    }

    const data: Prisma.ProposalUncheckedUpdateInput = {};

    if ('title' in body) {
      const title = String(body.title ?? '').trim().slice(0, MAX_TITLE);
      if (title === '') {
        return NextResponse.json({ error: 'A proposal needs a title' }, { status: 400 });
      }
      data.title = title;
    }

    if ('clientMessage' in body) {
      const message = body.clientMessage === null
        ? null
        : String(body.clientMessage ?? '').trim().slice(0, MAX_MESSAGE);
      data.clientMessage = message === '' ? null : message;
    }

    if ('sections' in body) {
      data.sections = parseSectionInput(body.sections) as unknown as Prisma.InputJsonValue;
    }

    if (Object.keys(data).length === 0 && !createdVersion) {
      return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
    }

    const updated = await prisma.proposal.update({ where: { id: target.id }, data });

    const [lead, agency, options, createdBy] = await Promise.all([
      prisma.lead.findUnique({ where: { id: updated.leadId } }),
      prisma.agency.findUnique({ where: { id: updated.agencyId } }),
      prisma.quoteOption.findMany({
        where: { leadId: updated.leadId },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      }),
      updated.createdByUserId
        ? prisma.user.findUnique({
            where: { id: updated.createdByUserId },
            select: { firstName: true, lastName: true, email: true },
          })
        : null,
    ]);

    if (!lead || !agency) {
      return NextResponse.json({ error: 'Proposal is missing its lead or agency' }, { status: 500 });
    }

    const assembled = assembleProposal(
      { proposal: updated, lead, agency, options, createdBy },
      { audience: 'agent' }
    );

    return NextResponse.json({
      proposal: assembled,
      readiness: proposalReadiness(assembled),
      // The builder must switch to the new proposal id when a fork happened.
      createdVersion,
      ...(createdVersion ? { newProposalId: target.id, version: target.version } : {}),
    });
  } catch (err) {
    if (err instanceof SectionValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    console.error('[proposal-builder] PATCH failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
