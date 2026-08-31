import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getAuthContext } from '@/lib/super-admin-auth';
import { generateProposalPdf, pdfDownloadHeaders } from '@/lib/proposals/pdf/generate';
import { recordProposalEvent, requestContext } from '@/lib/proposals/events';

/**
 * The agent's copy of the proposal PDF.
 *
 * GET → the unsigned proposal, or the signed version once it exists. Which one
 *       comes back is determined by the proposal's own state, not a parameter,
 *       so an agent cannot accidentally hand out an unsigned copy of a signed
 *       document (or the reverse).
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await getAuthContext(request);
    if (!auth.valid || !auth.user) return auth.response!;

    const { id } = await params;
    const proposal = await prisma.proposal.findUnique({ where: { id } });
    if (!proposal) {
      return NextResponse.json({ error: 'Proposal not found' }, { status: 404 });
    }
    if (auth.user.role !== 'SUPER_ADMIN' && proposal.agencyId !== auth.user.agencyId) {
      return NextResponse.json({ error: 'Proposal not found' }, { status: 404 });
    }

    const pdf = await generateProposalPdf(proposal);
    if (!pdf) {
      return NextResponse.json({ error: 'This proposal is incomplete.' }, { status: 500 });
    }

    await recordProposalEvent(proposal.id, proposal.agencyId, 'PDF_GENERATED', {
      ...requestContext(request),
      metadata: { signed: pdf.signed, by: 'agent' },
    });

    return new NextResponse(Buffer.from(pdf.bytes), {
      headers: pdfDownloadHeaders(pdf.filename, pdf.bytes),
    });
  } catch (err) {
    console.error('[proposal-pdf] agent download failed:', err);
    return NextResponse.json({ error: 'Could not produce the PDF.' }, { status: 500 });
  }
}
