import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { Prisma } from '@prisma/client';
import { getAuthContext } from '@/lib/super-admin-auth';
import {
  parseQuoteOptionInput,
  serializeQuoteOption,
  assertIdentifiable,
  QuoteValidationError,
} from '@/lib/quotes/quoteOption';

/**
 * Quote options for a lead.
 *
 * GET  → every option on the lead in display order, plus the lead name and the
 *        agency's carriers. Those two come along because the quote-entry screen
 *        needs them and there is no agent-facing carrier endpoint — the carrier
 *        list is otherwise only reachable through super-admin routes.
 * POST → add a new option.
 *
 * An agent adds one option per quote received back from a carrier; a proposal
 * later presents several of them side by side.
 */

/** Hard cap so one lead cannot accumulate an unbounded comparison table. */
const MAX_OPTIONS_PER_LEAD = 20;

/**
 * Load the lead and confirm the caller may see it.
 *
 * A lead belonging to another agency returns 404 rather than 403: a 403 would
 * confirm the id exists, which is itself a leak across agency boundaries.
 */
async function authorizeLead(request: NextRequest, leadId: string) {
  const auth = await getAuthContext(request);
  if (!auth.valid || !auth.user) return { error: auth.response! };

  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    select: { id: true, agencyId: true, insuredName: true },
  });
  if (!lead) return { error: NextResponse.json({ error: 'Lead not found' }, { status: 404 }) };

  if (auth.user.role !== 'SUPER_ADMIN' && lead.agencyId !== auth.user.agencyId) {
    return { error: NextResponse.json({ error: 'Lead not found' }, { status: 404 }) };
  }
  return { lead, user: auth.user };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: leadId } = await params;
    const { lead, error } = await authorizeLead(request, leadId);
    if (error) return error;

    const [options, carriers] = await Promise.all([
      prisma.quoteOption.findMany({
        where: { leadId: lead!.id },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        include: { carrier: { select: { id: true, name: true, marketType: true } } },
      }),
      prisma.carrier.findMany({
        where: { agencyId: lead!.agencyId, isActive: true, enabled: true },
        orderBy: [{ priorityRank: 'asc' }, { name: 'asc' }],
        select: { id: true, name: true, marketType: true },
      }),
    ]);

    return NextResponse.json({
      lead: { id: lead!.id, insuredName: lead!.insuredName },
      carriers,
      quoteOptions: options.map((o) => ({
        ...serializeQuoteOption(o),
        carrier: o.carrier,
      })),
    });
  } catch (err) {
    console.error('[quote-options] GET failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: leadId } = await params;
    const { lead, error } = await authorizeLead(request, leadId);
    if (error) return error;

    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const existingCount = await prisma.quoteOption.count({ where: { leadId: lead!.id } });
    if (existingCount >= MAX_OPTIONS_PER_LEAD) {
      return NextResponse.json(
        { error: `A lead can have at most ${MAX_OPTIONS_PER_LEAD} quote options` },
        { status: 400 }
      );
    }

    const parsed = parseQuoteOptionInput(body);
    assertIdentifiable(parsed);

    // A named carrier must belong to this agency — otherwise an agent could
    // attach another agency's carrier record to their own quote.
    if (parsed.carrierId) {
      const carrier = await prisma.carrier.findUnique({
        where: { id: parsed.carrierId },
        select: { agencyId: true },
      });
      if (!carrier || carrier.agencyId !== lead!.agencyId) {
        return NextResponse.json({ error: 'Carrier not found' }, { status: 400 });
      }
    }

    const isRecommended = body.isRecommended === true;

    const created = await prisma.$transaction(async (tx) => {
      // Only one option per lead carries the recommendation.
      if (isRecommended) {
        await tx.quoteOption.updateMany({
          where: { leadId: lead!.id, isRecommended: true },
          data: { isRecommended: false },
        });
      }
      const data: Prisma.QuoteOptionUncheckedCreateInput = {
        ...parsed,
        agencyId: lead!.agencyId,
        leadId: lead!.id,
        optionLabel: parsed.optionLabel ?? `Option ${existingCount + 1}`,
        isRecommended,
        sortOrder: existingCount,
      };
      return tx.quoteOption.create({ data });
    });

    return NextResponse.json({ quoteOption: serializeQuoteOption(created) }, { status: 201 });
  } catch (err) {
    if (err instanceof QuoteValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    console.error('[quote-options] POST failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
