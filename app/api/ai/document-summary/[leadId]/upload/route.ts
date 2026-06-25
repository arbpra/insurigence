import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getAuthContext } from '@/lib/super-admin-auth';
import { extractPdfText } from '@/lib/ai/pdf';
import { runDocumentSummary } from '@/lib/ai/runDocumentSummary';

/**
 * Feature 5 — Document Summary (PDF upload).
 * POST multipart/form-data with a `file` (PDF). Extracts the text and runs the
 * same Document Summary extraction as the pasted-text route.
 */

const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB
const MAX_TEXT_CHARS = 50000;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ leadId: string }> }
) {
  const auth = await getAuthContext(request);
  if (!auth.valid || !auth.user) return auth.response!;

  const { leadId } = await params;
  const lead = await prisma.lead.findUnique({ where: { id: leadId } });
  if (!lead) return NextResponse.json({ error: 'Lead not found' }, { status: 404 });
  if (auth.user.role !== 'SUPER_ADMIN' && lead.agencyId !== auth.user.agencyId) {
    return NextResponse.json({ error: 'Lead not found' }, { status: 404 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: 'Expected multipart form data' }, { status: 400 });
  }

  const file = form.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'No file provided' }, { status: 400 });
  }
  const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
  if (!isPdf) {
    return NextResponse.json({ error: 'Only PDF files are supported' }, { status: 400 });
  }
  if (file.size > MAX_FILE_BYTES) {
    return NextResponse.json({ error: 'File too large (max 10 MB)' }, { status: 400 });
  }

  let text: string;
  try {
    const buffer = await file.arrayBuffer();
    text = await extractPdfText(buffer);
  } catch {
    return NextResponse.json({ error: 'Could not read this PDF' }, { status: 422 });
  }

  if (!text) {
    return NextResponse.json(
      { error: 'No selectable text found — this may be a scanned/image PDF.' },
      { status: 422 }
    );
  }
  if (text.length > MAX_TEXT_CHARS) text = text.slice(0, MAX_TEXT_CHARS);

  const { result, aiRun } = await runDocumentSummary(text, {
    agencyId: lead.agencyId,
    leadId: lead.id,
    fileName: file.name,
  });

  if (!result.ok) {
    return NextResponse.json(
      { error: result.error || 'AI request failed', disclaimer: result.disclaimer },
      { status: 502 }
    );
  }

  return NextResponse.json({
    aiRunId: aiRun?.id ?? null,
    fileName: file.name,
    data: result.data,
    disclaimer: result.disclaimer,
    model: result.model,
    promptVersion: result.promptVersion,
    usage: result.usage,
  });
}
