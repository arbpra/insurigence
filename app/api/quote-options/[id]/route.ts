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
import {
  parseCoverageInput,
  normalizeCoverages,
  markAgentEdits,
  CoverageValidationError,
} from '@/lib/quotes/coverage';

/**
 * A single quote option.
 *
 * GET    → read one option.
 * PATCH  → update any subset of fields, including the recommended flag.
 * DELETE → remove the option and close the gap in the display order.
 */

/**
 * Load the option and confirm the caller's agency owns it. Cross-agency access
 * returns 404 rather than 403 so the response never confirms the id exists.
 */
async function authorizeOption(request: NextRequest, optionId: string) {
  const auth = await getAuthContext(request);
  if (!auth.valid || !auth.user) return { error: auth.response! };

  const option = await prisma.quoteOption.findUnique({ where: { id: optionId } });
  if (!option) {
    return { error: NextResponse.json({ error: 'Quote option not found' }, { status: 404 }) };
  }

  if (auth.user.role !== 'SUPER_ADMIN' && option.agencyId !== auth.user.agencyId) {
    return { error: NextResponse.json({ error: 'Quote option not found' }, { status: 404 }) };
  }
  return { option, user: auth.user };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { option, error } = await authorizeOption(request, id);
    if (error) return error;
    return NextResponse.json({ quoteOption: serializeQuoteOption(option!) });
  } catch (err) {
    console.error('[quote-option] GET failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { option, error } = await authorizeOption(request, id);
    if (error) return error;

    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const parsed = parseQuoteOptionInput(body, { partial: true });

    // Identity is only re-checked when the caller actually touches those fields.
    if ('carrierId' in parsed || 'carrierName' in parsed) {
      assertIdentifiable({
        carrierId: 'carrierId' in parsed ? parsed.carrierId : option!.carrierId,
        carrierName: 'carrierName' in parsed ? parsed.carrierName : option!.carrierName,
      });
    }

    if (parsed.carrierId) {
      const carrier = await prisma.carrier.findUnique({
        where: { id: parsed.carrierId },
        select: { agencyId: true },
      });
      if (!carrier || carrier.agencyId !== option!.agencyId) {
        return NextResponse.json({ error: 'Carrier not found' }, { status: 400 });
      }
    }

    // Date ordering must hold against the stored values too, not just the payload.
    const effective = 'effectiveDate' in parsed ? parsed.effectiveDate : option!.effectiveDate;
    const expiration = 'expirationDate' in parsed ? parsed.expirationDate : option!.expirationDate;
    if (effective && expiration && expiration <= effective) {
      return NextResponse.json(
        { error: 'Expiration date must be after the effective date' },
        { status: 400 }
      );
    }

    // Recomputing the total needs the stored parts when only one part changed.
    if (
      ('premiumAnnual' in body || 'taxes' in body || 'fees' in body) &&
      !('totalAnnual' in body)
    ) {
      const premium = 'premiumAnnualCents' in parsed ? parsed.premiumAnnualCents : option!.premiumAnnualCents;
      const taxes = 'taxesCents' in parsed ? parsed.taxesCents : option!.taxesCents;
      const fees = 'feesCents' in parsed ? parsed.feesCents : option!.feesCents;
      const zero = BigInt(0);
      parsed.totalAnnualCents = (premium ?? zero) + (taxes ?? zero) + (fees ?? zero);
    }

    // Coverages get their own validation, plus server-side edit detection so the
    // review flag reflects what actually changed rather than what the client claimed.
    if ('coverages' in body) {
      const incoming = parseCoverageInput(body.coverages);
      const stored = normalizeCoverages(option!.coverages);
      parsed.coverages = markAgentEdits(stored, incoming) as unknown as Prisma.InputJsonValue;
    }

    const setRecommended =
      typeof body.isRecommended === 'boolean' ? body.isRecommended : undefined;

    const updated = await prisma.$transaction(async (tx) => {
      if (setRecommended === true) {
        await tx.quoteOption.updateMany({
          where: { leadId: option!.leadId, isRecommended: true, id: { not: option!.id } },
          data: { isRecommended: false },
        });
      }
      const data: Prisma.QuoteOptionUncheckedUpdateInput = {
        ...parsed,
        ...(setRecommended === undefined ? {} : { isRecommended: setRecommended }),
      };
      return tx.quoteOption.update({ where: { id: option!.id }, data });
    });

    return NextResponse.json({ quoteOption: serializeQuoteOption(updated) });
  } catch (err) {
    if (err instanceof QuoteValidationError || err instanceof CoverageValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    console.error('[quote-option] PATCH failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { option, error } = await authorizeOption(request, id);
    if (error) return error;

    await prisma.$transaction(async (tx) => {
      await tx.quoteOption.delete({ where: { id: option!.id } });
      // Close the gap so sortOrder stays contiguous for the options left behind.
      const remaining = await tx.quoteOption.findMany({
        where: { leadId: option!.leadId },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        select: { id: true },
      });
      await Promise.all(
        remaining.map((o, i) => tx.quoteOption.update({ where: { id: o.id }, data: { sortOrder: i } }))
      );
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[quote-option] DELETE failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
