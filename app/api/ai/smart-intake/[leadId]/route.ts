import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getAuthContext } from '@/lib/super-admin-auth';
import { callPrompt } from '@/lib/ai/aiService';
import { saveAiRun } from '@/lib/ai/persistence';
import { smartIntakePrompt } from '@/lib/ai/prompts';
import { AI_PURPOSES, AI_DISCLAIMER } from '@/lib/ai/config';

/**
 * Feature 1 — Smart Intake Assistant.
 * GET  → return the latest saved Smart Intake output for a lead (no AI call,
 *        so opening the page is free).
 * POST → run the assistant on the lead's intake answers and save the result.
 */

/** Load the lead and enforce agency scoping. Returns the lead or an error response. */
async function loadLead(request: NextRequest, leadId: string) {
  const auth = await getAuthContext(request);
  if (!auth.valid || !auth.user) return { error: auth.response! };

  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    include: { intakeSubmission: true },
  });
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
    where: { leadId: lead!.id, purpose: AI_PURPOSES.SMART_INTAKE, status: 'COMPLETED' },
    orderBy: { createdAt: 'desc' },
  });

  if (!latest) return NextResponse.json({ data: null });

  return NextResponse.json({
    data: latest.output,
    aiRunId: latest.id,
    model: latest.model,
    promptVersion: latest.promptVersion,
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

  if (!lead!.intakeSubmission) {
    return NextResponse.json({ error: 'Lead has no intake submission' }, { status: 400 });
  }

  // Intake answers may be stored flat or nested under `answers`.
  const responses = lead!.intakeSubmission.responses as Record<string, unknown>;
  const answers = (responses?.answers as Record<string, unknown>) ?? responses;

  const result = await callPrompt(smartIntakePrompt, answers);

  const aiRun = await saveAiRun({
    purpose: smartIntakePrompt.purpose,
    result,
    input: answers,
    agencyId: lead!.agencyId,
    leadId: lead!.id,
  }).catch(() => null);

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
