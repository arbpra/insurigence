import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getAuthContext } from '@/lib/super-admin-auth';
import { callPrompt } from '@/lib/ai/aiService';
import { saveAiRun } from '@/lib/ai/persistence';
import { proposalLanguagePrompt } from '@/lib/ai/prompts';
import { AI_PURPOSES, AI_DISCLAIMER } from '@/lib/ai/config';

/**
 * Feature 4 — Proposal Language Assistant.
 * GET  → latest saved proposal language for the lead (free).
 * POST → generate proposal language from the evaluation + carrier fits and save it.
 */

async function loadLead(request: NextRequest, leadId: string) {
  const auth = await getAuthContext(request);
  if (!auth.valid || !auth.user) return { error: auth.response! };

  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    include: {
      intakeSubmission: true,
      carrierFits: { include: { carrier: true }, orderBy: { score: 'desc' } },
      proposals: { orderBy: { createdAt: 'desc' }, take: 1 },
    },
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
    where: { leadId: lead!.id, purpose: AI_PURPOSES.PROPOSAL_LANGUAGE, status: 'COMPLETED' },
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

  if (!lead!.marketClassification) {
    return NextResponse.json(
      { error: 'Lead has not been evaluated yet. Run an evaluation first.' },
      { status: 400 }
    );
  }

  const responses = (lead!.intakeSubmission?.responses as Record<string, unknown>) ?? {};
  const answers = (responses?.answers as Record<string, unknown>) ?? responses;

  // Assemble the structured input the model writes from — rules-engine output only.
  const input = {
    insured: {
      name: lead!.insuredName,
      industry: answers.industry ?? answers['ops.industry_primary'] ?? 'Not specified',
      revenue: answers.annualRevenue ?? answers['fin.annual_revenue'] ?? 'Not specified',
      yearsInBusiness: answers.yearsInBusiness ?? answers['insured.years_in_business'] ?? 'Not specified',
    },
    evaluation: {
      marketClassification: lead!.marketClassification,
      marketConfidence: lead!.marketConfidence,
      marketReasonCodes: lead!.marketReasonCodes,
    },
    topCarriers: lead!.carrierFits
      .filter((f) => f.tier !== 'NO_FIT')
      .slice(0, 5)
      .map((f) => ({ name: f.carrier.name, tier: f.tier, score: Number(f.score) })),
    agentNotes: lead!.proposals[0]?.agentRecommendation ?? null,
  };

  const result = await callPrompt(proposalLanguagePrompt, input);

  const aiRun = await saveAiRun({
    purpose: proposalLanguagePrompt.purpose,
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
