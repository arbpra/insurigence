import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getAuthContext } from '@/lib/super-admin-auth';
import { callPrompt } from '@/lib/ai/aiService';
import { saveAiRun } from '@/lib/ai/persistence';
import { recommendationRationalePrompt } from '@/lib/ai/prompts';
import { AI_DISCLAIMER } from '@/lib/ai/config';
import { serializeQuoteOption } from '@/lib/quotes/quoteOption';
import { buildComparison, differenceSummaries, costSummaries } from '@/lib/quotes/comparison';
import { fromCents } from '@/lib/quotes/money';

/**
 * "Why We Recommend This Option".
 *
 * POST → draft the rationale with AI for whichever option is currently marked
 *        recommended. The agent's choice of option is an input, never an output:
 *        the model explains a decision that has already been made.
 *
 * The draft is stored on the option with `rationaleAiDrafted: true` so the UI
 * can flag it as unreviewed. Editing it (via PATCH) clears that flag.
 */

const MAX_RATIONALE = 4000;

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

    const options = await prisma.quoteOption.findMany({
      where: { leadId: lead!.id },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });

    const recommended = options.find((o) => o.isRecommended);
    if (!recommended) {
      return NextResponse.json(
        { error: 'Mark an option as recommended before drafting the rationale.' },
        { status: 400 }
      );
    }
    if (options.length < 2) {
      return NextResponse.json(
        { error: 'Add a second option — a recommendation needs something to compare against.' },
        { status: 400 }
      );
    }

    // Reuse the same diff engine the table renders, so the prose and the table
    // can never disagree about what differs.
    const comparison = buildComparison(options.map(serializeQuoteOption));

    const responses = (lead!.intakeSubmission?.responses as Record<string, unknown>) ?? {};
    const answers = (responses?.answers as Record<string, unknown>) ?? responses;

    const input = {
      insured: {
        name: lead!.insuredName,
        industry: answers.industry ?? answers['ops.industry_primary'] ?? 'Not specified',
      },
      options: options.map((o) => ({
        label: o.optionLabel ?? o.carrierName ?? 'Option',
        carrier: o.carrierName ?? 'Not specified',
        totalAnnualCost: fromCents(o.totalAnnualCents),
        isTheRecommendedOne: o.id === recommended.id,
      })),
      recommendedOption: recommended.optionLabel ?? recommended.carrierName ?? 'Option',
      factualDifferences: differenceSummaries(comparison),
      // Cost stated in words rather than left as raw totals — a model handed
      // only the numbers will sometimes invert the comparison.
      costFacts: costSummaries(comparison),
    };

    const result = await callPrompt(recommendationRationalePrompt, input);

    const aiRun = await saveAiRun({
      purpose: recommendationRationalePrompt.purpose,
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

    const rationale = String(result.data.rationale ?? '').trim().slice(0, MAX_RATIONALE);
    if (rationale === '') {
      return NextResponse.json(
        { error: 'The model returned no rationale. Try again or write it yourself.' },
        { status: 502 }
      );
    }

    const updated = await prisma.quoteOption.update({
      where: { id: recommended.id },
      data: { recommendationRationale: rationale, rationaleAiDrafted: true },
    });

    return NextResponse.json({
      aiRunId: aiRun?.id ?? null,
      quoteOption: serializeQuoteOption(updated),
      differencesUsed: input.factualDifferences.length,
      disclaimer: AI_DISCLAIMER,
      model: result.model,
      promptVersion: result.promptVersion,
    });
  } catch (err) {
    console.error('[recommendation] POST failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
