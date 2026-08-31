import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { Prisma } from '@prisma/client';
import { getAuthContext } from '@/lib/super-admin-auth';
import { defaultSections } from '@/lib/proposals/sections';
import { assembleProposal, readinessProblems } from '@/lib/proposals/assemble';

/**
 * The quote proposal being built for a lead.
 *
 * GET → the lead's draft quote proposal, assembled and ready to render. Creates
 *       one on first visit so the builder always has something to work on.
 *
 * A quote proposal is distinguished from the older market-classification
 * proposal by having `sections` set. Both share the Proposal table; the legacy
 * feature is untouched.
 */

async function authorizeLead(request: NextRequest, leadId: string) {
  const auth = await getAuthContext(request);
  if (!auth.valid || !auth.user) return { error: auth.response! };

  const lead = await prisma.lead.findUnique({ where: { id: leadId } });
  if (!lead) return { error: NextResponse.json({ error: 'Lead not found' }, { status: 404 }) };

  if (auth.user.role !== 'SUPER_ADMIN' && lead.agencyId !== auth.user.agencyId) {
    return { error: NextResponse.json({ error: 'Lead not found' }, { status: 404 }) };
  }
  return { lead, user: auth.user };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: leadId } = await params;
    const { lead, user, error } = await authorizeLead(request, leadId);
    if (error) return error;

    const [agency, options] = await Promise.all([
      prisma.agency.findUnique({ where: { id: lead!.agencyId } }),
      prisma.quoteOption.findMany({
        where: { leadId: lead!.id },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      }),
    ]);
    if (!agency) return NextResponse.json({ error: 'Agency not found' }, { status: 404 });

    // The newest quote proposal on this lead — one that has sections.
    let proposal = await prisma.proposal.findFirst({
      where: { leadId: lead!.id, NOT: { sections: { equals: null } } },
      orderBy: [{ version: 'desc' }, { createdAt: 'desc' }],
    });

    if (!proposal) {
      proposal = await prisma.proposal.create({
        data: {
          agencyId: lead!.agencyId,
          leadId: lead!.id,
          createdByUserId: user!.id,
          title: `Insurance Proposal — ${lead!.insuredName}`,
          status: 'DRAFT',
          version: 1,
          sections: defaultSections() as unknown as Prisma.InputJsonValue,
        },
      });
    }

    const createdBy = proposal.createdByUserId
      ? await prisma.user.findUnique({
          where: { id: proposal.createdByUserId },
          select: { firstName: true, lastName: true, email: true },
        })
      : null;

    const assembled = assembleProposal(
      { proposal, lead: lead!, agency, options, createdBy },
      { audience: 'agent' }
    );

    return NextResponse.json({
      proposal: assembled,
      readiness: readinessProblems(assembled),
    });
  } catch (err) {
    console.error('[proposal-builder] GET failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
