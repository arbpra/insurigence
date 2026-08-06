import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { getAuthContext } from '@/lib/super-admin-auth';
import { callPrompt } from '@/lib/ai/aiService';
import { saveAiRun } from '@/lib/ai/persistence';
import { coverageRecommendationExplanationPrompt } from '@/lib/ai/prompts';
import { AI_PURPOSES } from '@/lib/ai/config';
import { buildExposureFactsFromIntake } from '@/lib/coverage/factsFromIntake';
import { computeCoverageRecommendations, applyAiExplanations } from '@/lib/coverage/engine';
import { loadCoverageConfigs, applyCoverageConfigs } from '@/lib/coverage/config';
import { COVERAGE_NAMES } from '@/lib/coverage/library';
import { COVERAGE_RECOMMENDATIONS_DISCLAIMER } from '@/lib/coverage/constants';
import type { CoverageRecommendation } from '@/lib/coverage/types';

/**
 * Coverage Recommendations — editable set for the proposal builder.
 * GET   → the lead's saved editable set (+ library names + disclaimer).
 * POST  → (re)generate from intake exposures (deterministic + AI-refined text), save DRAFT.
 * PATCH → save agent edits (add/edit/remove) and/or approve (REVIEWED + review trail).
 * The agent has full control — this is the human-review layer before proposal use.
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
  return { lead, user: auth.user };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ leadId: string }> }
) {
  const { leadId } = await params;
  const { lead, error } = await loadLead(request, leadId);
  if (error) return error;

  const set = await prisma.coverageRecommendationSet.findUnique({ where: { leadId: lead!.id } });
  return NextResponse.json({
    set,
    coverageNames: COVERAGE_NAMES,
    disclaimer: COVERAGE_RECOMMENDATIONS_DISCLAIMER,
  });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ leadId: string }> }
) {
  const { leadId } = await params;
  const { lead, error } = await loadLead(request, leadId);
  if (error) return error;

  const responses = (lead!.intakeSubmission?.responses as Record<string, unknown>) ?? {};
  const answers = (responses?.answers as Record<string, unknown>) ?? responses;

  const facts = buildExposureFactsFromIntake(answers);
  let recommendations = computeCoverageRecommendations(facts);

  // AI refines the plain-English explanations only (levels stay deterministic).
  const explain = await callPrompt(coverageRecommendationExplanationPrompt, {
    businessContext: { industry: facts.industry, description: answers.description ?? answers.additionalNotes ?? '' },
    recommendations: recommendations.map((r) => ({
      coverageName: r.coverageName,
      recommendationLevel: r.recommendationLevel,
      reason: r.reason,
    })),
  }).catch(() => null);
  if (explain?.ok && explain.data?.explanations) {
    recommendations = applyAiExplanations(recommendations, explain.data.explanations);
  }
  // Super-admin overrides win.
  recommendations = applyCoverageConfigs(recommendations, await loadCoverageConfigs());

  const recsJson = recommendations as unknown as Prisma.InputJsonValue;
  const set = await prisma.coverageRecommendationSet.upsert({
    where: { leadId: lead!.id },
    create: { agencyId: lead!.agencyId, leadId: lead!.id, recommendations: recsJson, status: 'DRAFT' },
    update: { recommendations: recsJson, status: 'DRAFT', reviewedById: null, reviewedAt: null },
  });

  await saveAiRun({
    purpose: AI_PURPOSES.COVERAGE_RECOMMENDATIONS,
    result: {
      ok: true,
      data: { coverageRecommendations: recommendations },
      raw: JSON.stringify(recommendations),
      model: explain?.model ?? 'rules-engine',
      usage: null,
      disclaimer: COVERAGE_RECOMMENDATIONS_DISCLAIMER,
      promptVersion: coverageRecommendationExplanationPrompt.version,
    },
    input: { source: 'proposal-builder', facts },
    agencyId: lead!.agencyId,
    leadId: lead!.id,
  }).catch(() => null);

  return NextResponse.json({ set, disclaimer: COVERAGE_RECOMMENDATIONS_DISCLAIMER });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ leadId: string }> }
) {
  const { leadId } = await params;
  const { lead, user, error } = await loadLead(request, leadId);
  if (error) return error;

  const existing = await prisma.coverageRecommendationSet.findUnique({ where: { leadId: lead!.id } });
  if (!existing) return NextResponse.json({ error: 'No recommendation set to update' }, { status: 404 });

  let body: { recommendations?: unknown; status?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const data: Record<string, unknown> = {};

  if (Array.isArray(body.recommendations)) {
    // Normalize agent-edited recommendations; always (re)attach the item disclaimer.
    data.recommendations = (body.recommendations as CoverageRecommendation[]).map((r) => ({
      coverageName: String(r.coverageName ?? '').trim(),
      recommendationLevel: r.recommendationLevel ?? 'CONSIDER',
      reason: String(r.reason ?? ''),
      agentExplanation: String(r.agentExplanation ?? ''),
      triggeringExposures: Array.isArray(r.triggeringExposures) ? r.triggeringExposures : [],
      crossSellOpportunity: Boolean(r.crossSellOpportunity),
      disclaimer: r.disclaimer ?? '',
    })).filter((r) => r.coverageName);
  }

  if (body.status === 'REVIEWED') {
    data.status = 'REVIEWED';
    data.reviewedById = user!.id;
    data.reviewedAt = new Date();
  } else if (body.status === 'DRAFT') {
    data.status = 'DRAFT';
    data.reviewedById = null;
    data.reviewedAt = null;
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
  }

  const set = await prisma.coverageRecommendationSet.update({ where: { leadId: lead!.id }, data });
  return NextResponse.json({ set });
}
