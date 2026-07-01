import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getAuthContext } from '@/lib/super-admin-auth';

/**
 * Single lead management.
 * PATCH  → archive / unarchive (sets or clears archivedAt).
 * DELETE → permanently delete the lead and its dependent records.
 */

async function loadLead(request: NextRequest, leadId: string) {
  const auth = await getAuthContext(request);
  if (!auth.valid || !auth.user) return { error: auth.response! };

  const lead = await prisma.lead.findUnique({ where: { id: leadId } });
  if (!lead) return { error: NextResponse.json({ error: 'Lead not found' }, { status: 404 }) };

  if (auth.user.role !== 'SUPER_ADMIN' && lead.agencyId !== auth.user.agencyId) {
    return { error: NextResponse.json({ error: 'Lead not found' }, { status: 404 }) };
  }
  return { lead, user: auth.user };
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { lead, error } = await loadLead(request, id);
  if (error) return error;

  let body: { archived?: boolean };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (typeof body.archived !== 'boolean') {
    return NextResponse.json({ error: 'archived (boolean) is required' }, { status: 400 });
  }

  const updated = await prisma.lead.update({
    where: { id: lead!.id },
    data: { archivedAt: body.archived ? new Date() : null },
  });

  return NextResponse.json({ lead: updated, archived: Boolean(updated.archivedAt) });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { lead, error } = await loadLead(request, id);
  if (error) return error;

  const intakeSubmissionId = lead!.intakeSubmissionId;

  // Remove dependent records first (MongoDB has no cascading deletes).
  await prisma.$transaction([
    prisma.leadCarrierFit.deleteMany({ where: { leadId: id } }),
    prisma.quote.deleteMany({ where: { leadId: id } }),
    prisma.proposal.deleteMany({ where: { leadId: id } }),
    prisma.aiRun.deleteMany({ where: { leadId: id } }),
    prisma.acordDraft.deleteMany({ where: { leadId: id } }),
    prisma.lead.delete({ where: { id } }),
  ]);

  // The lead's intake submission is its data — remove it too.
  if (intakeSubmissionId) {
    await prisma.intakeSubmission.delete({ where: { id: intakeSubmissionId } }).catch(() => null);
  }

  return NextResponse.json({ success: true });
}
