import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const formId = searchParams.get('formId');
    const token = searchParams.get('token');

    if (!formId || !token) {
      return NextResponse.json(
        { error: 'Missing formId or token' },
        { status: 400 }
      );
    }

    const intakeForm = await prisma.intakeForm.findUnique({
      where: { id: formId },
      include: {
        agency: {
          select: {
            id: true,
            name: true,
            logoUrl: true,
            brandPrimaryColor: true,
          },
        },
      },
    });

    if (!intakeForm) {
      return NextResponse.json(
        { error: 'Form not found' },
        { status: 404 }
      );
    }

    if (!intakeForm.isPublic) {
      return NextResponse.json(
        { error: 'This form is not available for public submissions' },
        { status: 403 }
      );
    }

    if (intakeForm.publicToken !== token) {
      return NextResponse.json(
        { error: 'Invalid access token' },
        { status: 401 }
      );
    }

    if (!intakeForm.isActive) {
      return NextResponse.json(
        { error: 'This form is no longer active' },
        { status: 410 }
      );
    }

    return NextResponse.json({
      form: {
        id: intakeForm.id,
        name: intakeForm.name,
        agencyId: intakeForm.agency.id,
        agencyName: intakeForm.agency.name,
        agencyLogo: intakeForm.agency.logoUrl,
        brandColor: intakeForm.agency.brandPrimaryColor,
        presentationMode: intakeForm.presentationMode,
        allowModeToggle: intakeForm.allowModeToggle,
        definition: intakeForm.definition,
      },
    });
  } catch (error) {
    console.error('Error validating public intake form:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
