import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getAuthContext } from '@/lib/super-admin-auth';
import { getAcordForm, detectMissing } from '@/lib/acord';

/**
 * A single ACORD draft.
 * GET   → draft + its field spec (labels/sections/required).
 * PATCH → save agent edits to fields and/or mark the draft REVIEWED (approval).
 *         missingFields is recomputed deterministically on every field change.
 */

async function loadDraft(request: NextRequest, leadId: string, draftId: string) {
  const auth = await getAuthContext(request);
  if (!auth.valid || !auth.user) return { error: auth.response! };

  const draft = await prisma.acordDraft.findUnique({ where: { id: draftId } });
  if (!draft || draft.leadId !== leadId) {
    return { error: NextResponse.json({ error: 'Draft not found' }, { status: 404 }) };
  }
  if (auth.user.role !== 'SUPER_ADMIN' && draft.agencyId !== auth.user.agencyId) {
    return { error: NextResponse.json({ error: 'Draft not found' }, { status: 404 }) };
  }
  return { draft, user: auth.user };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ leadId: string; draftId: string }> }
) {
  const { leadId, draftId } = await params;
  const { draft, error } = await loadDraft(request, leadId, draftId);
  if (error) return error;

  const spec = getAcordForm(draft!.formType);
  return NextResponse.json({ draft, fieldSpec: spec?.fields ?? [] });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ leadId: string; draftId: string }> }
) {
  const { leadId, draftId } = await params;
  const { draft, user, error } = await loadDraft(request, leadId, draftId);
  if (error) return error;

  let body: { fields?: Record<string, unknown>; status?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const spec = getAcordForm(draft!.formType);
  if (!spec) return NextResponse.json({ error: 'Unsupported form' }, { status: 400 });

  const data: Record<string, unknown> = {};

  if (body.fields && typeof body.fields === 'object') {
    // Only accept known field keys; coerce values to strings.
    const allowed = new Set(spec.fields.map((f) => f.key));
    const current = (draft!.fields as Record<string, string>) ?? {};
    const merged: Record<string, string> = { ...current };
    for (const [k, v] of Object.entries(body.fields)) {
      if (allowed.has(k)) merged[k] = v == null ? '' : String(v);
    }
    data.fields = merged;
    data.missingFields = detectMissing(spec, merged);
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

  const updated = await prisma.acordDraft.update({ where: { id: draftId }, data });
  return NextResponse.json({ draft: updated });
}
