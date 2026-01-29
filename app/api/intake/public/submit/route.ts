import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { headers } from 'next/headers';

const rateLimitMap = new Map<string, { count: number; resetTime: number }>();
const RATE_LIMIT_WINDOW = 60 * 1000;
const RATE_LIMIT_MAX = 10;

function getRateLimitKey(ip: string, formId: string): string {
  return `${ip}:${formId}`;
}

function checkRateLimit(ip: string, formId: string): boolean {
  const key = getRateLimitKey(ip, formId);
  const now = Date.now();
  const record = rateLimitMap.get(key);

  if (!record || now > record.resetTime) {
    rateLimitMap.set(key, { count: 1, resetTime: now + RATE_LIMIT_WINDOW });
    return true;
  }

  if (record.count >= RATE_LIMIT_MAX) {
    return false;
  }

  record.count++;
  return true;
}

export async function POST(request: NextRequest) {
  try {
    const headersList = await headers();
    const forwardedFor = headersList.get('x-forwarded-for');
    const ip = forwardedFor?.split(',')[0]?.trim() || 'unknown';
    const userAgent = headersList.get('user-agent') || 'unknown';

    const body = await request.json();
    const {
      formId,
      token,
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

    if (!formId || !token) {
      return NextResponse.json(
        { error: 'Missing formId or token' },
        { status: 400 }
      );
    }

    if (!checkRateLimit(ip, formId)) {
      return NextResponse.json(
        { error: 'Too many requests. Please try again later.' },
        { status: 429 }
      );
    }

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

    const intakeForm = await prisma.intakeForm.findUnique({
      where: { id: formId },
      include: {
        agency: true,
      },
    });

    if (!intakeForm) {
      return NextResponse.json(
        { error: 'Form not found' },
        { status: 404 }
      );
    }

    if (!intakeForm.isPublic || intakeForm.publicToken !== token) {
      return NextResponse.json(
        { error: 'Invalid or unauthorized form access' },
        { status: 401 }
      );
    }

    if (!intakeForm.isActive) {
      return NextResponse.json(
        { error: 'This form is no longer accepting submissions' },
        { status: 410 }
      );
    }

    const agencyId = intakeForm.agencyId;

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
      submissionSource: 'EXTERNAL',
      submissionIp: ip,
      submissionUserAgent: userAgent,
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
        source: 'EXTERNAL',
      },
    });

    await prisma.activityEvent.create({
      data: {
        agencyId,
        leadId: lead.id,
        eventType: 'INTAKE_SUBMITTED_EXTERNAL',
        metadata: {
          formId: intakeForm.id,
          formName: intakeForm.name,
          insuredName: companyName,
          contactEmail,
        },
        ipAddress: ip,
        userAgent,
      },
    });

    return NextResponse.json({
      success: true,
      message: 'Intake submitted successfully',
      leadId: lead.id,
    });
  } catch (error) {
    console.error('Error submitting public intake:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
