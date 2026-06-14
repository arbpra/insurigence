import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getAuthContext } from '@/lib/super-admin-auth';
import { callPrompt } from '@/lib/ai/aiService';
import { saveAiRun } from '@/lib/ai/persistence';
import { coverageExplanationPrompt } from '@/lib/ai/prompts';
import { AI_PURPOSES, AI_DISCLAIMER } from '@/lib/ai/config';

/**
 * Feature 3 — Coverage Explanation Assistant.
 * GET  → latest saved explanations for the lead (free).
 * POST → generate explanations for the agent-selected coverages and save them.
 */

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
    where: { leadId: lead!.id, purpose: AI_PURPOSES.COVERAGE_EXPLANATION, status: 'COMPLETED' },
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

  let body: { coverages?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const coverages = Array.isArray(body.coverages)
    ? body.coverages.filter((c): c is string => typeof c === 'string' && c.trim().length > 0)
    : [];
  if (coverages.length === 0) {
    return NextResponse.json({ error: 'Select at least one coverage' }, { status: 400 });
  }
  if (coverages.length > 15) {
    return NextResponse.json({ error: 'Too many coverages (max 15)' }, { status: 400 });
  }

  const responses = (lead!.intakeSubmission?.responses as Record<string, unknown>) ?? {};
  const businessContext = (responses?.answers as Record<string, unknown>) ?? responses;

  const input = { businessContext, coverages };
  const result = await callPrompt(coverageExplanationPrompt, input);

  const aiRun = await saveAiRun({
    purpose: coverageExplanationPrompt.purpose,
    result,
    input,
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
