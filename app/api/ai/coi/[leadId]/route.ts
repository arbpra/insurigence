import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getAuthContext } from '@/lib/super-admin-auth';
import { callPrompt } from '@/lib/ai/aiService';
import { saveAiRun } from '@/lib/ai/persistence';
import { coiDraftPrompt } from '@/lib/ai/prompts';
import { AI_PURPOSES, AI_DISCLAIMER } from '@/lib/ai/config';

/**
 * Feature 6 — COI Assistant.
 * GET  → latest saved COI draft for the lead (free).
 * POST → draft a COI from insured info + available policy data + agent inputs.
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
    where: { leadId: lead!.id, purpose: AI_PURPOSES.COI_DRAFT, status: 'COMPLETED' },
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

  let body: {
    certificateHolder?: string;
    projectDetails?: string;
    additionalInsuredRequested?: boolean;
    waiverRequested?: boolean;
    specialWording?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!body.certificateHolder?.trim()) {
    return NextResponse.json({ error: 'Certificate holder is required' }, { status: 400 });
  }

  // Insured info from intake.
  const responses = (lead!.intakeSubmission?.responses as Record<string, unknown>) ?? {};
  const answers = (responses?.answers as Record<string, unknown>) ?? responses;

  // Pull policy data from the most recent Document Summary extraction, if any.
  const latestDoc = await prisma.aiRun.findFirst({
    where: { leadId: lead!.id, purpose: AI_PURPOSES.DOCUMENT_SUMMARY, status: 'COMPLETED' },
    orderBy: { createdAt: 'desc' },
  });

  const input = {
    insured: {
      name: lead!.insuredName,
      address: answers.address ?? answers['insured.address'] ?? '',
      industry: answers.industry ?? answers['ops.industry_primary'] ?? '',
    },
    policyData: latestDoc?.output ?? null,
    certificateHolder: body.certificateHolder.trim(),
    projectDetails: body.projectDetails?.trim() ?? '',
    additionalInsuredRequested: Boolean(body.additionalInsuredRequested),
    waiverRequested: Boolean(body.waiverRequested),
    specialWording: body.specialWording?.trim() ?? '',
  };

  const result = await callPrompt(coiDraftPrompt, input);

  const aiRun = await saveAiRun({
    purpose: coiDraftPrompt.purpose,
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
    usedPolicyData: Boolean(latestDoc),
    data: result.data,
    disclaimer: result.disclaimer,
    model: result.model,
    promptVersion: result.promptVersion,
    usage: result.usage,
  });
}
