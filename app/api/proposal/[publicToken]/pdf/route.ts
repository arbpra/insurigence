import { NextRequest, NextResponse } from 'next/server';
import { resolveProposalToken, TOKEN_FAILURE_MESSAGE } from '@/lib/proposals/token';
import { generateProposalPdf, pdfDownloadHeaders } from '@/lib/proposals/pdf/generate';
import { recordProposalEvent, requestContext } from '@/lib/proposals/events';

/**
 * The insured's copy of their proposal (requirement 7: "download a PDF copy
 * after completion").
 *
 * GET → the proposal as a PDF. Before signing this is the unsigned document;
 *       after signing it is the signed version with the certification page.
 *
 * The same token gate as the web view — revocation, expiry, and not-yet-sent all
 * apply, so a withdrawn link cannot be used to pull a PDF.
 */
export async function GET(
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

    const pdf = await generateProposalPdf(resolution.proposal);
    if (!pdf) {
      return NextResponse.json({ error: 'This proposal is not available.' }, { status: 500 });
    }

    await recordProposalEvent(
      resolution.proposal.id,
      resolution.proposal.agencyId,
      'PDF_GENERATED',
      { ...requestContext(request), metadata: { signed: pdf.signed, by: 'insured' } }
    );

    return new NextResponse(Buffer.from(pdf.bytes), {
      headers: pdfDownloadHeaders(pdf.filename, pdf.bytes),
    });
  } catch (err) {
    console.error('[proposal-pdf] insured download failed:', err);
    return NextResponse.json({ error: 'Could not produce the PDF.' }, { status: 500 });
  }
}
