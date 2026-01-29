import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getAuthContext } from '@/lib/super-admin-auth';

export async function POST(request: NextRequest) {
  try {
    const auth = await getAuthContext(request);
    if (!auth.valid || !auth.user) return auth.response!;

    const user = auth.user;
    
    if (!user.agencyId) {
      return NextResponse.json({ error: 'No agency assigned' }, { status: 403 });
    }

    const agencyId = user.agencyId;
    const body = await request.json();

    const {
      companyName,
      yearsInBusiness,
      industry,
      annualRevenue,
      numberOfEmployees,
      requestedLimits,
      effectiveDate,
      priorClaims,
      priorClaimsDetails,
      contactName,
      contactEmail,
      contactPhone,
      additionalNotes,
    } = body;

    if (!companyName || !contactName || !contactEmail || !industry) {
      return NextResponse.json(
        { error: 'Missing required fields: companyName, contactName, contactEmail, and industry are required' },
        { status: 400 }
      );
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(contactEmail)) {
      return NextResponse.json(
        { error: 'Invalid email address' },
        { status: 400 }
      );
    }

    const agency = await prisma.agency.findUnique({
      where: { id: agencyId },
    });

    if (!agency) {
      return NextResponse.json({ error: 'Agency not found' }, { status: 404 });
    }

    const intakeForm = await prisma.intakeForm.findFirst({
      where: { agencyId, lob: 'COMMERCIAL_GL', isActive: true },
    });

    if (!intakeForm) {
      return NextResponse.json(
        { error: 'No active Commercial GL intake form found' },
        { status: 500 }
      );
    }

    const responses = {
      companyName,
      yearsInBusiness: yearsInBusiness ? parseInt(yearsInBusiness, 10) : null,
      industry,
      annualRevenue: annualRevenue || null,
      numberOfEmployees: numberOfEmployees ? parseInt(numberOfEmployees, 10) : null,
      requestedLimits: requestedLimits || null,
      effectiveDate: effectiveDate || null,
      priorClaims: priorClaims || false,
      priorClaimsDetails: priorClaimsDetails || null,
      contactName,
      contactEmail,
      contactPhone: contactPhone || null,
      additionalNotes: additionalNotes || null,
    };

    const requiredFields = ['companyName', 'contactName', 'contactEmail', 'industry'];
    const filledRequired = requiredFields.filter(f => responses[f as keyof typeof responses]).length;
    const completenessScore = Math.round((filledRequired / requiredFields.length) * 100);

    const intakeSubmission = await prisma.intakeSubmission.create({
      data: {
        agencyId,
        intakeFormId: intakeForm.id,
        insuredName: companyName,
        contactEmail,
        responses,
        completenessScore,
      },
    });

    const lead = await prisma.lead.create({
      data: {
        agencyId,
        intakeSubmissionId: intakeSubmission.id,
        insuredName: companyName,
        primaryContactEmail: contactEmail,
        lob: 'COMMERCIAL_GL',
        status: 'NEW',
        source: 'INTERNAL',
        assignedToId: user.id,
      },
    });

    await prisma.activityEvent.create({
      data: {
        agencyId,
        userId: user.id,
        leadId: lead.id,
        eventType: 'INTAKE_SUBMITTED_INTERNAL',
        metadata: { insuredName: companyName },
      },
    });

    return NextResponse.json(
      {
        success: true,
        leadId: lead.id,
        submissionId: intakeSubmission.id,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('Error submitting intake:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
