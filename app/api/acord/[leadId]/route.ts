import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getAuthContext } from '@/lib/super-admin-auth';
import { buildAcordDraft, getAcordForm, detectMissing, ACORD_FORMS } from '@/lib/acord';
import { AI_PURPOSES } from '@/lib/ai/config';

/**
 * ACORD draft generation (deterministic field mapping).
 * GET  → existing drafts for the lead + supported form list/specs.
 * POST → map intake data into the requested ACORD form, detect missing required
 *        fields, and save an AcordDraft (stored separately from intake).
 */

async function loadLead(request: NextRequest, leadId: string) {
  const auth = await getAuthContext(request);
  if (!auth.valid || !auth.user) return { error: auth.response! };

  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    include: { intakeSubmission: true, agency: true },
  });
  if (!lead) return { error: NextResponse.json({ error: 'Lead not found' }, { status: 404 }) };

  if (auth.user.role !== 'SUPER_ADMIN' && lead.agencyId !== auth.user.agencyId) {
    return { error: NextResponse.json({ error: 'Lead not found' }, { status: 404 }) };
  }
  return { lead };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ leadId: string }> }
) {
  const { leadId } = await params;
  const { lead, error } = await loadLead(request, leadId);
  if (error) return error;

  const drafts = await prisma.acordDraft.findMany({
    where: { leadId: lead!.id },
    orderBy: { updatedAt: 'desc' },
  });

  return NextResponse.json({
    drafts,
    supportedForms: Object.values(ACORD_FORMS).map((f) => ({
      formType: f.formType,
      title: f.title,
      fields: f.fields,
    })),
  });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ leadId: string }> }
) {
  const { leadId } = await params;
  const { lead, error } = await loadLead(request, leadId);
  if (error) return error;

  let body: { formType?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const formType = body.formType ?? '';
  const spec = getAcordForm(formType);
  if (!spec) {
    return NextResponse.json(
      { error: `Unsupported form type. Supported: ${Object.keys(ACORD_FORMS).join(', ')}` },
      { status: 400 }
    );
  }

  const responses = (lead!.intakeSubmission?.responses as Record<string, unknown>) ?? {};
  const answers = (responses?.answers as Record<string, unknown>) ?? responses;

  const draft = buildAcordDraft(formType, {
    lead: { insuredName: lead!.insuredName, primaryContactEmail: lead!.primaryContactEmail },
    answers,
    agency: { name: lead!.agency.name },
  })!;

  // AI-assisted description cleanup: reuse the lead's latest Smart Intake output
  // (Feature 1) for the Description of Operations field, if available.
  let aiAssistedDescription = false;
  if ('descriptionOfOperations' in draft.fields) {
    const smartIntake = await prisma.aiRun.findFirst({
      where: { leadId: lead!.id, purpose: AI_PURPOSES.SMART_INTAKE, status: 'COMPLETED' },
      orderBy: { createdAt: 'desc' },
    });
    const cleaned = (smartIntake?.output as Record<string, unknown> | null)?.cleanBusinessDescription;
    if (typeof cleaned === 'string' && cleaned.trim()) {
      draft.fields.descriptionOfOperations = cleaned.trim();
      draft.missingFields = detectMissing(spec, draft.fields);
      aiAssistedDescription = true;
    }
  }

  const saved = await prisma.acordDraft.create({
    data: {
      agencyId: lead!.agencyId,
      leadId: lead!.id,
      formType: spec.formType as never,
      fields: draft.fields,
      missingFields: draft.missingFields,
    },
  });

  return NextResponse.json({
    draft: saved,
    title: draft.title,
    fieldSpec: spec.fields,
    aiAssistedDescription,
  });
}
