import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { Prisma } from '@prisma/client';
import { getAuthContext } from '@/lib/super-admin-auth';
import { callPrompt } from '@/lib/ai/aiService';
import { saveAiRun } from '@/lib/ai/persistence';
import { coverageBreakdownPrompt } from '@/lib/ai/prompts';
import { AI_DISCLAIMER } from '@/lib/ai/config';
import { normalizeCoverages, mergeAiProse, needsAgentReview } from '@/lib/quotes/coverage';
import { fromCents } from '@/lib/quotes/money';

/**
 * AI coverage breakdown for a lead's quote options.
 *
 * POST → draft plain-language prose for every coverage across every option, then
 *        write it back onto the options.
 *
 * Scoped to the lead rather than a single option because "how this differs from
 * the other options" cannot be written without seeing all of them at once.
 *
 * The model never supplies a limit, deductible, or premium: those are sent as
 * read-only context and echoed back from storage. See lib/quotes/coverage.ts.
 */

async function authorizeLead(request: NextRequest, leadId: string) {
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

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: leadId } = await params;
    const { lead, error } = await authorizeLead(request, leadId);
    if (error) return error;

    let body: { overwriteEdited?: boolean } = {};
    try {
      body = await request.json();
    } catch {
      // No body is fine — every field is optional.
    }
    const overwriteEdited = body.overwriteEdited === true;

    const options = await prisma.quoteOption.findMany({
      where: { leadId: lead!.id },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });

    if (options.length === 0) {
      return NextResponse.json(
        { error: 'Add at least one quote option before generating a coverage breakdown.' },
        { status: 400 }
      );
    }

    const normalized = options.map((o) => ({
      option: o,
      coverages: normalizeCoverages(o.coverages),
    }));

    const totalCoverages = normalized.reduce((n, o) => n + o.coverages.length, 0);
    if (totalCoverages === 0) {
      return NextResponse.json(
        { error: 'Add coverages to your quote options before generating a breakdown.' },
        { status: 400 }
      );
    }

    const responses = (lead!.intakeSubmission?.responses as Record<string, unknown>) ?? {};
    const answers = (responses?.answers as Record<string, unknown>) ?? responses;

    // The model sees limits and deductibles so its comparisons are accurate, but
    // it has no field in the output schema to send one back.
    const input = {
      insured: {
        name: lead!.insuredName,
        industry: answers.industry ?? answers['ops.industry_primary'] ?? 'Not specified',
        revenue: answers.annualRevenue ?? answers['fin.annual_revenue'] ?? 'Not specified',
        yearsInBusiness: answers.yearsInBusiness ?? answers['insured.years_in_business'] ?? 'Not specified',
      },
      options: normalized.map(({ option, coverages }) => ({
        optionLabel: option.optionLabel ?? option.carrierName ?? 'Option',
        carrier: option.carrierName ?? 'Not specified',
        totalAnnualCost: fromCents(option.totalAnnualCents),
        coverages: coverages.map((c) => ({
          key: c.key,
          name: c.name,
          limit: c.limit,
          deductible: c.deductible,
          included: c.included,
        })),
      })),
    };

    const result = await callPrompt(coverageBreakdownPrompt, input);

    const aiRun = await saveAiRun({
      purpose: coverageBreakdownPrompt.purpose,
      result,
      input,
      agencyId: lead!.agencyId,
      leadId: lead!.id,
    }).catch(() => null);

    if (!result.ok || !result.data) {
      return NextResponse.json(
        { error: result.error || 'AI request failed', disclaimer: AI_DISCLAIMER },
        { status: 502 }
      );
    }

    // Merge prose onto stored coverages — the guardrail boundary.
    const aiItems = result.data.coverages ?? [];
    const allUnknownKeys: string[] = [];
    let totalUpdated = 0;

    const writes = normalized.map(({ option, coverages }) => {
      const { coverages: merged, report } = mergeAiProse(coverages, aiItems, { overwriteEdited });
      totalUpdated += report.updated;
      allUnknownKeys.push(...report.unknownKeys);
      return { option, merged };
    });

    // Keys the model returned that we never sent are invented coverages. They
    // are already discarded; log them because repeated drift is worth knowing.
    const uniqueUnknown = [...new Set(allUnknownKeys)];
    if (uniqueUnknown.length > 0) {
      console.warn(
        `[coverage-breakdown] discarded ${uniqueUnknown.length} coverage(s) the model invented for lead ${lead!.id}`
      );
    }

    await prisma.$transaction(
      writes.map(({ option, merged }) =>
        prisma.quoteOption.update({
          where: { id: option.id },
          data: { coverages: merged as unknown as Prisma.InputJsonValue },
        })
      )
    );

    const pendingReview = writes.reduce((n, w) => n + needsAgentReview(w.merged).length, 0);

    return NextResponse.json({
      aiRunId: aiRun?.id ?? null,
      coveragesUpdated: totalUpdated,
      coveragesSkipped: totalCoverages - totalUpdated,
      inventedDiscarded: uniqueUnknown.length,
      pendingAgentReview: pendingReview,
      options: writes.map(({ option, merged }) => ({ id: option.id, coverages: merged })),
      disclaimer: AI_DISCLAIMER,
      model: result.model,
      promptVersion: result.promptVersion,
      usage: result.usage,
    });
  } catch (err) {
    console.error('[coverage-breakdown] POST failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
