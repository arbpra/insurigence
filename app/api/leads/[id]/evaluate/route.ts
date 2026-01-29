import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getAuthContext } from '@/lib/super-admin-auth';

interface AnswersMap {
  [key: string]: unknown;
}

interface ExtractedFacts {
  states: string[];
  revenue: number;
  employees: number;
  years: number;
  industry: string;
  lossAny: boolean;
  lossCount: number;
  lossTotal: number;
  subsUsed: boolean;
  cois: boolean;
  description: string;
  multiStateOps: boolean;
  subsUsedNoCois: boolean;
}

interface EvaluationReason {
  code: string;
  type: 'inclusion' | 'exclusion' | 'warning';
  message: string;
  details?: string;
}

interface CarrierFitResult {
  carrierId: string;
  carrierName: string;
  marketType: string;
  priorityRank: number;
  eligible: boolean;
  tier: 'GOOD_FIT' | 'POSSIBLE_FIT' | 'REVIEW_NEEDED' | 'NO_FIT';
  score: number;
  reasons: EvaluationReason[];
  hasValidRule: boolean;
}

function normalizeAnswers(responses: Record<string, unknown>): AnswersMap {
  const answers = (responses?.answers || responses) as AnswersMap;
  return answers;
}

function extractFacts(answers: AnswersMap): ExtractedFacts {
  const states = (answers['ops.states'] as string[]) || [];
  const revenue = Number(answers['fin.annual_revenue']) || 0;
  const employees = Number(answers['insured.employee_count']) || 0;
  const years = Number(answers['insured.years_in_business']) || 0;
  const industry = (answers['ops.industry_primary'] as string) || 'unknown';
  const lossAny = Boolean(answers['loss.any_5yr']);
  const lossCount = Number(answers['loss.count_5yr']) || 0;
  const lossTotal = Number(answers['loss.total_incurred_5yr']) || 0;
  const subsUsed = Boolean(answers['ops.subcontractors.used']);
  const cois = Boolean(answers['ops.subcontractors.cois_collected']);
  const description = (answers['ops.description'] as string) || '';

  return {
    states,
    revenue,
    employees,
    years,
    industry,
    lossAny,
    lossCount,
    lossTotal,
    subsUsed,
    cois,
    description,
    multiStateOps: states.length > 1,
    subsUsedNoCois: subsUsed && !cois,
  };
}

interface AppetiteRule {
  allowedIndustries: string[];
  excludedIndustries: string[];
  allowedStates: string[];
  excludedStates: string[];
  minRevenue: number | null;
  maxRevenue: number | null;
  minEmployees: number | null;
  maxEmployees: number | null;
  minYearsInBusiness: number | null;
  lossHistoryYears: number;
  maxLossCount: number | null;
  maxLossAmount: number | null;
}

function evaluateAgainstRule(
  facts: ExtractedFacts,
  rule: AppetiteRule,
  carrierName: string
): { eligible: boolean; score: number; reasons: EvaluationReason[] } {
  const reasons: EvaluationReason[] = [];
  let eligible = true;
  let score = 50;

  if (rule.excludedStates.length > 0) {
    const excludedMatch = facts.states.filter(s => 
      rule.excludedStates.map(es => es.toUpperCase()).includes(s.toUpperCase())
    );
    if (excludedMatch.length > 0) {
      eligible = false;
      reasons.push({
        code: 'state_excluded',
        type: 'exclusion',
        message: `${carrierName} does not write in ${excludedMatch.join(', ')}`,
        details: `States ${excludedMatch.join(', ')} are on the exclusion list`,
      });
    }
  }

  if (eligible && rule.allowedStates.length > 0) {
    const allowedUpper = rule.allowedStates.map(s => s.toUpperCase());
    const notAllowed = facts.states.filter(s => !allowedUpper.includes(s.toUpperCase()));
    if (notAllowed.length > 0) {
      eligible = false;
      reasons.push({
        code: 'state_not_allowed',
        type: 'exclusion',
        message: `${carrierName} only writes in specific states`,
        details: `States ${notAllowed.join(', ')} are not on the allowed list`,
      });
    } else if (facts.states.length > 0) {
      score += 10;
      reasons.push({
        code: 'state_match',
        type: 'inclusion',
        message: `Operating states match ${carrierName}'s territory`,
      });
    }
  } else if (facts.states.length > 0 && rule.excludedStates.length === 0) {
    score += 5;
    reasons.push({
      code: 'state_acceptable',
      type: 'inclusion',
      message: 'No state restrictions from carrier',
    });
  }

  if (rule.excludedIndustries.length > 0) {
    const industryLower = facts.industry.toLowerCase();
    const excluded = rule.excludedIndustries.some(ei => 
      industryLower.includes(ei.toLowerCase()) || ei.toLowerCase().includes(industryLower)
    );
    if (excluded) {
      eligible = false;
      reasons.push({
        code: 'industry_excluded',
        type: 'exclusion',
        message: `${carrierName} does not write ${facts.industry} risks`,
        details: `Industry "${facts.industry}" is on the exclusion list`,
      });
    }
  }

  if (eligible && rule.allowedIndustries.length > 0) {
    const industryLower = facts.industry.toLowerCase();
    const allowed = rule.allowedIndustries.some(ai => 
      industryLower.includes(ai.toLowerCase()) || ai.toLowerCase().includes(industryLower)
    );
    if (!allowed && facts.industry !== 'unknown') {
      eligible = false;
      reasons.push({
        code: 'industry_not_allowed',
        type: 'exclusion',
        message: `${carrierName} only writes specific industries`,
        details: `Industry "${facts.industry}" is not on the allowed list`,
      });
    } else if (allowed) {
      score += 15;
      reasons.push({
        code: 'industry_match',
        type: 'inclusion',
        message: `${facts.industry} is a preferred class for ${carrierName}`,
      });
    }
  } else if (facts.industry !== 'unknown' && rule.excludedIndustries.length === 0) {
    score += 5;
    reasons.push({
      code: 'industry_acceptable',
      type: 'inclusion',
      message: 'Industry not restricted by carrier',
    });
  }

  if (rule.minRevenue !== null && facts.revenue < rule.minRevenue) {
    eligible = false;
    reasons.push({
      code: 'revenue_below_min',
      type: 'exclusion',
      message: `Revenue below ${carrierName}'s minimum`,
      details: `$${facts.revenue.toLocaleString()} is below minimum $${rule.minRevenue.toLocaleString()}`,
    });
  }

  if (eligible && rule.maxRevenue !== null && facts.revenue > rule.maxRevenue) {
    eligible = false;
    reasons.push({
      code: 'revenue_above_max',
      type: 'exclusion',
      message: `Revenue exceeds ${carrierName}'s maximum`,
      details: `$${facts.revenue.toLocaleString()} exceeds maximum $${rule.maxRevenue.toLocaleString()}`,
    });
  }

  if (eligible && facts.revenue > 0) {
    const inRange = (rule.minRevenue === null || facts.revenue >= rule.minRevenue) &&
                   (rule.maxRevenue === null || facts.revenue <= rule.maxRevenue);
    if (inRange) {
      score += 10;
      reasons.push({
        code: 'revenue_in_range',
        type: 'inclusion',
        message: 'Revenue within acceptable range',
      });
    }
  }

  if (rule.minEmployees !== null && facts.employees < rule.minEmployees) {
    eligible = false;
    reasons.push({
      code: 'employees_below_min',
      type: 'exclusion',
      message: `Employee count below ${carrierName}'s minimum`,
      details: `${facts.employees} employees below minimum ${rule.minEmployees}`,
    });
  }

  if (eligible && rule.maxEmployees !== null && facts.employees > rule.maxEmployees) {
    eligible = false;
    reasons.push({
      code: 'employees_above_max',
      type: 'exclusion',
      message: `Employee count exceeds ${carrierName}'s maximum`,
      details: `${facts.employees} employees exceeds maximum ${rule.maxEmployees}`,
    });
  }

  if (rule.minYearsInBusiness !== null && facts.years < rule.minYearsInBusiness) {
    eligible = false;
    reasons.push({
      code: 'years_below_min',
      type: 'exclusion',
      message: `Not enough years in business for ${carrierName}`,
      details: `${facts.years} years is below minimum ${rule.minYearsInBusiness} years`,
    });
  } else if (facts.years >= 3) {
    score += 5;
    reasons.push({
      code: 'established_business',
      type: 'inclusion',
      message: 'Established business history',
    });
  }

  if (rule.maxLossCount !== null && facts.lossCount > rule.maxLossCount) {
    eligible = false;
    reasons.push({
      code: 'loss_count_exceeded',
      type: 'exclusion',
      message: `Too many claims for ${carrierName}`,
      details: `${facts.lossCount} claims exceeds maximum ${rule.maxLossCount}`,
    });
  }

  if (eligible && rule.maxLossAmount !== null && facts.lossTotal > rule.maxLossAmount) {
    eligible = false;
    reasons.push({
      code: 'loss_amount_exceeded',
      type: 'exclusion',
      message: `Total claims amount too high for ${carrierName}`,
      details: `$${facts.lossTotal.toLocaleString()} exceeds maximum $${rule.maxLossAmount.toLocaleString()}`,
    });
  }

  if (eligible && !facts.lossAny) {
    score += 15;
    reasons.push({
      code: 'clean_loss_history',
      type: 'inclusion',
      message: 'Clean loss history',
    });
  } else if (eligible && facts.lossCount <= 1 && facts.lossTotal < 25000) {
    score += 5;
    reasons.push({
      code: 'acceptable_loss_history',
      type: 'inclusion',
      message: 'Minimal loss history',
    });
  }

  if (facts.subsUsedNoCois) {
    score -= 10;
    reasons.push({
      code: 'subcontractors_no_cois',
      type: 'warning',
      message: 'Uses subcontractors without COIs',
      details: 'Recommend obtaining COIs from all subcontractors',
    });
  }

  if (facts.multiStateOps) {
    score -= 5;
    reasons.push({
      code: 'multi_state_ops',
      type: 'warning',
      message: 'Multi-state operations',
      details: `Operations in ${facts.states.length} states may require additional review`,
    });
  }

  return {
    eligible,
    score: Math.max(0, Math.min(100, score)),
    reasons,
  };
}

function determineTier(score: number, eligible: boolean): 'GOOD_FIT' | 'POSSIBLE_FIT' | 'REVIEW_NEEDED' | 'NO_FIT' {
  if (!eligible) return 'NO_FIT';
  if (score >= 80) return 'GOOD_FIT';
  if (score >= 60) return 'POSSIBLE_FIT';
  if (score >= 40) return 'REVIEW_NEEDED';
  return 'NO_FIT';
}

function classifyMarket(carrierFits: CarrierFitResult[]): {
  classification: 'STANDARD' | 'EXCESS_SURPLUS' | 'BORDERLINE';
  confidence: number;
  reasonCodes: string[];
} {
  let standardGoodFit = 0;
  let standardPossibleFit = 0;
  let standardEligible = 0;
  let esPossibleFitPlus = 0;
  let esEligible = 0;

  for (const fit of carrierFits) {
    if (!fit.hasValidRule) continue;
    
    const isStandard = fit.marketType === 'STANDARD';
    const isES = fit.marketType === 'EXCESS_SURPLUS';

    if (isStandard) {
      if (fit.eligible) standardEligible++;
      if (fit.tier === 'GOOD_FIT') standardGoodFit++;
      if (fit.tier === 'POSSIBLE_FIT') standardPossibleFit++;
    }

    if (isES) {
      if (fit.eligible) esEligible++;
      if (fit.tier === 'GOOD_FIT' || fit.tier === 'POSSIBLE_FIT') esPossibleFitPlus++;
    }
  }

  let classification: 'STANDARD' | 'EXCESS_SURPLUS' | 'BORDERLINE';
  let reasonCodes: string[];
  let confidence = 0.60;

  if (standardGoodFit >= 1 || standardPossibleFit >= 2) {
    classification = 'STANDARD';
    reasonCodes = ['standard_viable'];
    confidence += 0.10;
    const additionalSupport = Math.max(0, standardGoodFit + standardPossibleFit - 1);
    confidence += Math.min(additionalSupport * 0.05, 0.25);
  } else if (standardEligible === 0 && esPossibleFitPlus >= 1) {
    classification = 'EXCESS_SURPLUS';
    reasonCodes = ['no_standard_eligible', 'es_viable'];
    confidence += 0.10;
    const additionalSupport = Math.max(0, esPossibleFitPlus - 1);
    confidence += Math.min(additionalSupport * 0.05, 0.20);
  } else {
    classification = 'BORDERLINE';
    if (standardEligible > 0 && esEligible > 0) {
      reasonCodes = ['mixed_market_signals'];
    } else {
      reasonCodes = ['review_required_by_underwriting'];
    }
    confidence -= 0.10;
  }

  return {
    classification,
    confidence: Math.max(0.40, Math.min(0.95, confidence)),
    reasonCodes,
  };
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await getAuthContext(request);
    if (!auth.valid || !auth.user) return auth.response!;

    const user = auth.user;
    const { id: leadId } = await params;

    const lead = await prisma.lead.findUnique({
      where: { id: leadId },
      include: { intakeSubmission: true },
    });

    if (!lead) {
      return NextResponse.json({ error: 'Lead not found' }, { status: 404 });
    }

    if (user.role !== 'SUPER_ADMIN' && lead.agencyId !== user.agencyId) {
      return NextResponse.json({ error: 'Lead not found' }, { status: 404 });
    }

    const agencyId = lead.agencyId;

    if (!lead.intakeSubmission) {
      return NextResponse.json({ error: 'Lead has no intake submission' }, { status: 400 });
    }

    const responses = lead.intakeSubmission.responses as Record<string, unknown>;
    const answers = normalizeAnswers(responses);
    const facts = extractFacts(answers);

    const carriers = await prisma.carrier.findMany({
      where: { agencyId, isActive: true, enabled: true },
      orderBy: [{ priorityRank: 'asc' }, { name: 'asc' }],
    });

    const appetiteRules = await prisma.carrierAppetiteRule.findMany({
      where: {
        agencyId,
        isActive: true,
        lob: 'COMMERCIAL_GL',
        carrierId: { in: carriers.map(c => c.id) },
      },
      orderBy: { version: 'desc' },
    });

    const rulesByCarrier = new Map<string, typeof appetiteRules[0]>();
    for (const rule of appetiteRules) {
      if (!rulesByCarrier.has(rule.carrierId)) {
        rulesByCarrier.set(rule.carrierId, rule);
      }
    }

    const carrierFits: CarrierFitResult[] = [];
    const skippedCarriers: { carrierId: string; carrierName: string; reason: string }[] = [];

    for (const carrier of carriers) {
      const rule = rulesByCarrier.get(carrier.id);
      if (!rule) {
        skippedCarriers.push({
          carrierId: carrier.id,
          carrierName: carrier.name,
          reason: 'No appetite rules configured',
        });
        carrierFits.push({
          carrierId: carrier.id,
          carrierName: carrier.name,
          marketType: carrier.marketType,
          priorityRank: carrier.priorityRank,
          eligible: false,
          tier: 'NO_FIT',
          score: 0,
          reasons: [{
            code: 'no_appetite_rule',
            type: 'exclusion',
            message: `No appetite rules configured for ${carrier.name}`,
          }],
          hasValidRule: false,
        });
        continue;
      }

      const appetiteRule: AppetiteRule = {
        allowedIndustries: rule.allowedIndustries,
        excludedIndustries: rule.excludedIndustries,
        allowedStates: rule.allowedStates,
        excludedStates: rule.excludedStates,
        minRevenue: rule.minRevenue,
        maxRevenue: rule.maxRevenue,
        minEmployees: rule.minEmployees,
        maxEmployees: rule.maxEmployees,
        minYearsInBusiness: rule.minYearsInBusiness,
        lossHistoryYears: rule.lossHistoryYears,
        maxLossCount: rule.maxLossCount,
        maxLossAmount: rule.maxLossAmount,
      };

      const { eligible, score, reasons } = evaluateAgainstRule(facts, appetiteRule, carrier.name);
      const tier = determineTier(score, eligible);

      carrierFits.push({
        carrierId: carrier.id,
        carrierName: carrier.name,
        marketType: carrier.marketType,
        priorityRank: carrier.priorityRank,
        eligible,
        tier,
        score,
        reasons,
        hasValidRule: true,
      });

      const reasonCodes = reasons.map(r => r.code);
      const summaryParts = reasons
        .filter(r => r.type !== 'warning')
        .slice(0, 3)
        .map(r => r.message);

      await prisma.leadCarrierFit.upsert({
        where: {
          leadId_carrierId: { leadId, carrierId: carrier.id },
        },
        create: {
          agencyId,
          leadId,
          carrierId: carrier.id,
          tier,
          score: parseFloat(score.toFixed(3)),
          reasons: reasonCodes,
          notes: `${tier}: ${summaryParts.join('; ')}`,
        },
        update: {
          tier,
          score: parseFloat(score.toFixed(3)),
          reasons: reasonCodes,
          notes: `${tier}: ${summaryParts.join('; ')}`,
        },
      });
    }

    const { classification, confidence, reasonCodes } = classifyMarket(carrierFits);

    await prisma.lead.update({
      where: { id: leadId },
      data: {
        marketClassification: classification,
        marketConfidence: parseFloat(confidence.toFixed(3)),
        marketReasonCodes: reasonCodes,
        updatedAt: new Date(),
      },
    });

    const tierOrder = { GOOD_FIT: 0, POSSIBLE_FIT: 1, REVIEW_NEEDED: 2, NO_FIT: 3 };
    carrierFits.sort((a, b) => {
      const tierDiff = tierOrder[a.tier] - tierOrder[b.tier];
      if (tierDiff !== 0) return tierDiff;
      if (a.score !== b.score) return b.score - a.score;
      return a.priorityRank - b.priorityRank;
    });

    const recommended = carrierFits.filter(cf => cf.tier === 'GOOD_FIT' || cf.tier === 'POSSIBLE_FIT');
    const excluded = carrierFits.filter(cf => cf.tier === 'NO_FIT' && cf.hasValidRule);
    const needsReview = carrierFits.filter(cf => cf.tier === 'REVIEW_NEEDED');

    return NextResponse.json({
      leadId,
      marketClassification: classification,
      marketConfidence: confidence,
      marketReasonCodes: reasonCodes,
      summary: {
        recommendedCount: recommended.length,
        excludedCount: excluded.length,
        reviewNeededCount: needsReview.length,
        skippedCount: skippedCarriers.length,
      },
      recommended: recommended.map(cf => ({
        carrierId: cf.carrierId,
        carrierName: cf.carrierName,
        marketType: cf.marketType,
        tier: cf.tier,
        score: cf.score,
        reasons: cf.reasons.filter(r => r.type === 'inclusion'),
        warnings: cf.reasons.filter(r => r.type === 'warning'),
      })),
      excluded: excluded.map(cf => ({
        carrierId: cf.carrierId,
        carrierName: cf.carrierName,
        marketType: cf.marketType,
        reasons: cf.reasons.filter(r => r.type === 'exclusion'),
      })),
      needsReview: needsReview.map(cf => ({
        carrierId: cf.carrierId,
        carrierName: cf.carrierName,
        marketType: cf.marketType,
        score: cf.score,
        reasons: cf.reasons,
      })),
      skippedCarriers,
    });
  } catch (error) {
    console.error('Error evaluating lead:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
