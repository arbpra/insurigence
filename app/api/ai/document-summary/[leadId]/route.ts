import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getAuthContext } from '@/lib/super-admin-auth';
import { runDocumentSummary } from '@/lib/ai/runDocumentSummary';
import { AI_PURPOSES, AI_DISCLAIMER } from '@/lib/ai/config';

/**
 * Feature 5 — Document Summary.
 * GET  → latest saved extraction for the lead (free).
 * POST → extract key fields from pasted policy/quote text and save the result.
 * (Binary PDF upload + text extraction is added in a later step.)
 */

const MAX_TEXT_CHARS = 50000;

async function loadLead(request: NextRequest, leadId: string) {
  const auth = await getAuthContext(request);
  if (!auth.valid || !auth.user) return { error: auth.response! };

  const lead = await prisma.lead.findUnique({ where: { id: leadId } });
  if (!lead) return { error: NextResponse.json({ error: 'Lead not found' }, { status: 404 }) };

  if (auth.user.role !== 'SUPER_ADMIN' && lead.agencyId !== auth.user.agencyId) {
    return { error: NextResponse.json({ error: 'Lead not found' }, { status: 404 }) };
  }
  return { lead };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ leadId: string }> }
) {
  const { leadId } = await params;
  const { lead, error } = await loadLead(request, leadId);
  if (error) return error;

  const latest = await prisma.aiRun.findFirst({
    where: { leadId: lead!.id, purpose: AI_PURPOSES.DOCUMENT_SUMMARY, status: 'COMPLETED' },
    orderBy: { createdAt: 'desc' },
  });

  if (!latest) return NextResponse.json({ data: null });

  return NextResponse.json({
    data: latest.output,
    aiRunId: latest.id,
    reviewedAt: latest.reviewedAt,
    createdAt: latest.createdAt,
    disclaimer: AI_DISCLAIMER,
  });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ leadId: string }> }
) {
  const { leadId } = await params;
  const { lead, error } = await loadLead(request, leadId);
  if (error) return error;

  let body: { text?: unknown; fileName?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const text = typeof body.text === 'string' ? body.text.trim() : '';
  const fileName = typeof body.fileName === 'string' ? body.fileName : null;
  if (!text) {
    return NextResponse.json({ error: 'Document text is required' }, { status: 400 });
  }
  if (text.length > MAX_TEXT_CHARS) {
    return NextResponse.json(
      { error: `Document is too long (max ${MAX_TEXT_CHARS} characters)` },
      { status: 400 }
    );
  }

  const { result, aiRun } = await runDocumentSummary(text, {
    agencyId: lead!.agencyId,
    leadId: lead!.id,
    fileName,
  });

  if (!result.ok) {
    return NextResponse.json(
      { error: result.error || 'AI request failed', disclaimer: result.disclaimer },
      { status: 502 }
    );
  }

  return NextResponse.json({
    aiRunId: aiRun?.id ?? null,
    data: result.data,
    disclaimer: result.disclaimer,
    model: result.model,
    promptVersion: result.promptVersion,
    usage: result.usage,
  });
}
