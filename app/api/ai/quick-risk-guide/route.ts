import { NextRequest, NextResponse } from 'next/server';
import { getAuthContext } from '@/lib/super-admin-auth';
import { callPrompt } from '@/lib/ai/aiService';
import { saveAiRun } from '@/lib/ai/persistence';
import {
  quickRiskGuidePrompt,
  premiumExplanationPrompt,
  coverageRecommendationExplanationPrompt,
} from '@/lib/ai/prompts';
import { PREMIUM_INDICATION_DISCLAIMER } from '@/lib/ai/config';
import { computePremiumIndication } from '@/lib/premium/benchmark';
import type { RiskFacts } from '@/lib/premium/types';
import { computeCoverageRecommendations, applyAiExplanations } from '@/lib/coverage/engine';
import { loadCoverageConfigs, applyCoverageConfigs } from '@/lib/coverage/config';
import { COVERAGE_RECOMMENDATIONS_DISCLAIMER } from '@/lib/coverage/constants';
import type { RiskExposureFacts } from '@/lib/coverage/types';

/**
 * Feature 2 — Quick Risk Guide (agent-facing) + Premium Indication.
 *
 * Flow: (1) AI parses the free text into guidance + structured facts.
 * (2) The DETERMINISTIC benchmark computes a premium indication range from those
 * facts — AI never invents pricing. (3) AI writes a plain-language explanation of
 * the computed range. Both the risk guide and the premium indication are saved
 * for audit/history.
 */
export async function POST(request: NextRequest) {
  const auth = await getAuthContext(request);
  if (!auth.valid || !auth.user) return auth.response!;

  let body: { description?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const description = body.description?.trim();
  if (!description) {
    return NextResponse.json({ error: 'description is required' }, { status: 400 });
  }
  if (description.length > 2000) {
    return NextResponse.json({ error: 'description is too long (max 2000 chars)' }, { status: 400 });
  }

  const result = await callPrompt(quickRiskGuidePrompt, description);

  const aiRun = await saveAiRun({
    purpose: quickRiskGuidePrompt.purpose,
    result,
    input: description,
    agencyId: auth.user.agencyId,
  }).catch(() => null);

  if (!result.ok || !result.data) {
    return NextResponse.json(
      { error: result.error || 'AI request failed', disclaimer: result.disclaimer },
      { status: 502 }
    );
  }

  // --- Premium Indication: deterministic benchmark, AI explanation only ---
  const parsed = result.data.parsedFacts ?? {};
  const facts: RiskFacts = {
    industry: parsed.industry || result.data.suggestedClassification?.notes || null,
    revenue: parsed.revenue,
    employees: parsed.employees,
    state: parsed.state || null,
    yearsInBusiness: parsed.yearsInBusiness,
    priorLosses: parsed.priorLosses,
    marketType: result.data.likelyMarketDirection,
    requestedLimit: parsed.requestedLimit,
  };

  const benchmark = computePremiumIndication(facts);

  let reasoning: string;
  if (benchmark.insufficient) {
    reasoning = 'Insufficient information to provide a reliable indication.';
  } else {
    const explain = await callPrompt(premiumExplanationPrompt, {
      facts,
      annualLow: benchmark.annualLow,
      annualHigh: benchmark.annualHigh,
      confidence: benchmark.confidence,
      factorsConsidered: benchmark.factorsConsidered,
    });
    reasoning =
      explain.ok && explain.data?.reasoning
        ? explain.data.reasoning
        : benchmark.basis || 'Indication based on general benchmarks for this class and revenue.';
  }

  const premiumIndication = {
    ...benchmark,
    reasoning,
    disclaimer: PREMIUM_INDICATION_DISCLAIMER,
  };

  // Save the premium indication separately for audit/history.
  await saveAiRun({
    purpose: premiumExplanationPrompt.purpose,
    result: {
      ok: true,
      data: premiumIndication,
      raw: JSON.stringify(premiumIndication),
      model: result.model,
      usage: null,
      disclaimer: PREMIUM_INDICATION_DISCLAIMER,
      promptVersion: premiumExplanationPrompt.version,
    },
    input: { description, facts },
    agencyId: auth.user.agencyId,
  }).catch(() => null);

  // --- Coverage Recommendations: deterministic engine, AI explains only ---
  const exposureFacts: RiskExposureFacts = {
    industry: parsed.industry || null,
    revenue: parsed.revenue,
    employees: parsed.employees,
    state: parsed.state || null,
    yearsInBusiness: parsed.yearsInBusiness,
    priorLosses: parsed.priorLosses,
    hasBusinessVehicles: parsed.hasBusinessVehicles,
    customerPropertyInCare: parsed.customerPropertyInCare,
    mobileEquipment: parsed.mobileEquipment,
    storesCustomerData: parsed.storesCustomerData,
    ownsOrLeasesProperty: parsed.ownsOrLeasesProperty,
    higherLimitsDesired: parsed.higherLimitsDesired,
  };

  let coverageRecommendations = computeCoverageRecommendations(exposureFacts);

  // AI refines the plain-English explanations only (levels stay deterministic).
  const coverageExplain = await callPrompt(coverageRecommendationExplanationPrompt, {
    businessContext: { industry: parsed.industry, description },
    recommendations: coverageRecommendations.map((r) => ({
      coverageName: r.coverageName,
      recommendationLevel: r.recommendationLevel,
      reason: r.reason,
    })),
  }).catch(() => null);

  if (coverageExplain?.ok && coverageExplain.data?.explanations) {
    coverageRecommendations = applyAiExplanations(coverageRecommendations, coverageExplain.data.explanations);
  }
  // Super-admin overrides win (enable/disable, explanation, custom coverages).
  coverageRecommendations = applyCoverageConfigs(coverageRecommendations, await loadCoverageConfigs());

  await saveAiRun({
    purpose: coverageRecommendationExplanationPrompt.purpose,
    result: {
      ok: true,
      data: { coverageRecommendations },
      raw: JSON.stringify(coverageRecommendations),
      model: result.model,
      usage: null,
      disclaimer: COVERAGE_RECOMMENDATIONS_DISCLAIMER,
      promptVersion: coverageRecommendationExplanationPrompt.version,
    },
    input: { description, exposureFacts },
    agencyId: auth.user.agencyId,
  }).catch(() => null);

  return NextResponse.json({
    aiRunId: aiRun?.id ?? null,
    data: {
      ...result.data,
      premiumIndication,
      coverageRecommendations,
      coverageDisclaimer: COVERAGE_RECOMMENDATIONS_DISCLAIMER,
    },
    disclaimer: result.disclaimer,
    model: result.model,
    promptVersion: result.promptVersion,
    usage: result.usage,
  });
}
