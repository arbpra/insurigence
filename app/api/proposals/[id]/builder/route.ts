import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { Prisma } from '@prisma/client';
import { getAuthContext } from '@/lib/super-admin-auth';
import { parseSectionInput, SectionValidationError } from '@/lib/proposals/sections';
import { assembleProposal, readinessProblems } from '@/lib/proposals/assemble';

/**
 * Save the proposal being built.
 *
 * PATCH → title, client message, and the section layout (order, titles,
 *         enabled state, and the prose of content sections).
 *
 * A locked proposal is rejected: once signed, the document an insured agreed to
 * is immutable. Editing a sent proposal is allowed here and creates a new
 * version in Phase 10 — for now it simply saves.
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
    const { proposal, error } = await authorizeProposal(request, id);
    if (error) return error;

    // A signed proposal is evidence, not a draft.
    if (proposal!.lockedAt) {
      return NextResponse.json(
        { error: 'This proposal has been signed and can no longer be edited.' },
        { status: 409 }
      );
    }

    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
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

    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
    }

    const updated = await prisma.proposal.update({ where: { id: proposal!.id }, data });

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
      readiness: readinessProblems(assembled),
    });
  } catch (err) {
    if (err instanceof SectionValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    console.error('[proposal-builder] PATCH failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
