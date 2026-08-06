import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getAuthContext } from '@/lib/super-admin-auth';
import { getAcordForm } from '@/lib/acord';
import { generateAcordPdf } from '@/lib/acord/pdf';
import { fillAcordTemplate } from '@/lib/acord/templateFill';

/**
 * Export an ACORD draft to PDF. Only REVIEWED (or already EXPORTED) drafts can be
 * exported — agent approval is required before export, per the AI build direction.
 * On first export the draft is marked EXPORTED.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ leadId: string; draftId: string }> }
) {
  const auth = await getAuthContext(request);
  if (!auth.valid || !auth.user) return auth.response!;

  const { leadId, draftId } = await params;
  const draft = await prisma.acordDraft.findUnique({ where: { id: draftId } });
  if (!draft || draft.leadId !== leadId) {
    return NextResponse.json({ error: 'Draft not found' }, { status: 404 });
  }
  if (auth.user.role !== 'SUPER_ADMIN' && draft.agencyId !== auth.user.agencyId) {
    return NextResponse.json({ error: 'Draft not found' }, { status: 404 });
  }

  if (draft.status === 'DRAFT') {
    return NextResponse.json(
      { error: 'Approve the draft (agent review) before exporting.' },
      { status: 400 }
    );
  }

  const spec = getAcordForm(draft.formType);
  if (!spec) return NextResponse.json({ error: 'Unsupported form' }, { status: 400 });

  const fields = (draft.fields as Record<string, string>) ?? {};

  // Prefer the official fillable ACORD template if the agency has provided one;
  // otherwise export the generated data PDF.
  const filled = await fillAcordTemplate(draft.formType, fields).catch(() => null);
  const pdfBytes =
    filled ??
    (await generateAcordPdf(spec, {
      fields,
      status: draft.status,
      missingFields: draft.missingFields,
    }));

  // Mark EXPORTED on first export (keep the review trail intact).
  if (draft.status === 'REVIEWED') {
    await prisma.acordDraft.update({ where: { id: draftId }, data: { status: 'EXPORTED' } }).catch(() => null);
  }

  const fileName = `${draft.formType}_${leadId}.pdf`;
  return new NextResponse(Buffer.from(pdfBytes), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${fileName}"`,
      'Cache-Control': 'no-store',
    },
  });
}
