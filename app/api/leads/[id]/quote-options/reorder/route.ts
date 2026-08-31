import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getAuthContext } from '@/lib/super-admin-auth';

/**
 * Reorder a lead's quote options in one call.
 *
 * The client sends the complete list of option ids in their new display order.
 * Requiring the whole list (rather than a from/to pair) keeps sortOrder
 * contiguous and makes the operation idempotent.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await getAuthContext(request);
    if (!auth.valid || !auth.user) return auth.response!;

    const { id: leadId } = await params;

    const lead = await prisma.lead.findUnique({
      where: { id: leadId },
      select: { id: true, agencyId: true },
    });
    if (!lead) return NextResponse.json({ error: 'Lead not found' }, { status: 404 });

    if (auth.user.role !== 'SUPER_ADMIN' && lead.agencyId !== auth.user.agencyId) {
      return NextResponse.json({ error: 'Lead not found' }, { status: 404 });
    }

    let body: { orderedIds?: unknown };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const orderedIds = body.orderedIds;
    if (!Array.isArray(orderedIds) || orderedIds.some((v) => typeof v !== 'string')) {
      return NextResponse.json(
        { error: 'orderedIds must be an array of quote option ids' },
        { status: 400 }
      );
    }

    const existing = await prisma.quoteOption.findMany({
      where: { leadId: lead.id },
      select: { id: true },
    });

    // The payload must be exactly this lead's options — no more, no fewer. That
    // rejects both a stale client list and an attempt to move another lead's
    // option into this one.
    const existingIds = new Set(existing.map((o) => o.id));
    const sent = new Set(orderedIds as string[]);
    if (sent.size !== orderedIds.length) {
      return NextResponse.json({ error: 'orderedIds contains duplicates' }, { status: 400 });
    }
    if (sent.size !== existingIds.size || [...sent].some((id) => !existingIds.has(id))) {
      return NextResponse.json(
        { error: "orderedIds must list exactly this lead's quote options" },
        { status: 400 }
      );
    }

    await prisma.$transaction(
      (orderedIds as string[]).map((id, index) =>
        prisma.quoteOption.update({ where: { id }, data: { sortOrder: index } })
      )
    );

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[quote-options] reorder failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
