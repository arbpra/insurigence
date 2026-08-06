import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getAuthContext } from '@/lib/super-admin-auth';
import { extractPdfText } from '@/lib/ai/pdf';
import { ocrExtractText } from '@/lib/ai/ocr';
import { runDocumentSummary } from '@/lib/ai/runDocumentSummary';

/**
 * Feature 5 — Document Summary (file upload).
 * POST multipart/form-data with a `file` (PDF or image). Text-based PDFs are
 * parsed directly; scanned PDFs and images are read via OCR (vision). The
 * extracted text then runs through the same Document Summary extraction.
 */

const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB
const MAX_TEXT_CHARS = 50000;
const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'];

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
  const name = file.name.toLowerCase();
  const isPdf = file.type === 'application/pdf' || name.endsWith('.pdf');
  const isImage = IMAGE_TYPES.includes(file.type) || /\.(png|jpe?g|webp)$/.test(name);
  if (!isPdf && !isImage) {
    return NextResponse.json({ error: 'Only PDF or image files are supported' }, { status: 400 });
  }
  if (file.size > MAX_FILE_BYTES) {
    return NextResponse.json({ error: 'File too large (max 10 MB)' }, { status: 400 });
  }

  const buffer = new Uint8Array(await file.arrayBuffer());
  let text = '';
  let usedOcr = false;

  if (isPdf) {
    try {
      text = await extractPdfText(buffer);
    } catch {
      text = '';
    }
    // Scanned/image-only PDF (no selectable text) → OCR fallback.
    if (!text) {
      try {
        text = await ocrExtractText(buffer, 'application/pdf', file.name);
        usedOcr = true;
      } catch {
        return NextResponse.json({ error: 'Could not read this PDF' }, { status: 422 });
      }
    }
  } else {
    // Image upload → OCR directly.
    try {
      text = await ocrExtractText(buffer, file.type || 'image/png', file.name);
      usedOcr = true;
    } catch {
      return NextResponse.json({ error: 'Could not read this image' }, { status: 422 });
    }
  }

  if (!text) {
    return NextResponse.json(
      { error: 'No readable text found in this document.' },
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
    usedOcr,
    data: result.data,
    disclaimer: result.disclaimer,
    model: result.model,
    promptVersion: result.promptVersion,
    usage: result.usage,
  });
}
