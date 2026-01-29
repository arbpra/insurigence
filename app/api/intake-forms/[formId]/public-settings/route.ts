import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { validateSuperAdmin } from '@/lib/super-admin-auth';
import { PresentationMode } from '@prisma/client';
import crypto from 'crypto';

function generatePublicToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ formId: string }> }
) {
  const auth = await validateSuperAdmin(request);
  if (!auth.valid) return auth.response!;

  try {
    const { formId } = await params;

    const intakeForm = await prisma.intakeForm.findUnique({
      where: { id: formId },
      select: {
        id: true,
        name: true,
        isPublic: true,
        publicToken: true,
        agencyId: true,
        presentationMode: true,
        allowModeToggle: true,
      },
    });

    if (!intakeForm) {
      return NextResponse.json(
        { error: 'Intake form not found' },
        { status: 404 }
      );
    }

    const baseUrl = request.headers.get('host') || 'localhost:5000';
    const protocol = baseUrl.includes('localhost') ? 'http' : 'https';
    
    let publicUrl = null;
    let embedCode = null;

    if (intakeForm.isPublic && intakeForm.publicToken) {
      publicUrl = `${protocol}://${baseUrl}/intake/public/${intakeForm.id}?token=${intakeForm.publicToken}`;
      embedCode = `<iframe src="${publicUrl}" style="width:100%; height:1100px; border:none;"></iframe>`;
    }

    return NextResponse.json({
      formId: intakeForm.id,
      formName: intakeForm.name,
      isPublic: intakeForm.isPublic,
      hasToken: !!intakeForm.publicToken,
      publicUrl,
      embedCode,
      presentationMode: intakeForm.presentationMode,
      allowModeToggle: intakeForm.allowModeToggle,
    });
  } catch (error) {
    console.error('Error fetching public settings:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ formId: string }> }
) {
  const auth = await validateSuperAdmin(request);
  if (!auth.valid) return auth.response!;

  try {
    const { formId } = await params;
    const body = await request.json();
    const { isPublic, regenerateToken, presentationMode, allowModeToggle } = body;

    const intakeForm = await prisma.intakeForm.findUnique({
      where: { id: formId },
    });

    if (!intakeForm) {
      return NextResponse.json(
        { error: 'Intake form not found' },
        { status: 404 }
      );
    }

    const updateData: { isPublic?: boolean; publicToken?: string | null; presentationMode?: PresentationMode; allowModeToggle?: boolean } = {};

    if (typeof isPublic === 'boolean') {
      updateData.isPublic = isPublic;
      
      if (isPublic && !intakeForm.publicToken) {
        updateData.publicToken = generatePublicToken();
      }
      
      if (!isPublic) {
        updateData.publicToken = null;
      }
    }

    if (regenerateToken === true && (intakeForm.isPublic || updateData.isPublic)) {
      updateData.publicToken = generatePublicToken();
    }

    if (presentationMode !== undefined) {
      updateData.presentationMode = presentationMode as PresentationMode;
    }

    if (typeof allowModeToggle === 'boolean') {
      updateData.allowModeToggle = allowModeToggle;
    }

    const updatedForm = await prisma.intakeForm.update({
      where: { id: formId },
      data: updateData,
      select: {
        id: true,
        name: true,
        isPublic: true,
        publicToken: true,
        presentationMode: true,
        allowModeToggle: true,
      },
    });

    const baseUrl = request.headers.get('host') || 'localhost:5000';
    const protocol = baseUrl.includes('localhost') ? 'http' : 'https';
    
    let publicUrl = null;
    let embedCode = null;

    if (updatedForm.isPublic && updatedForm.publicToken) {
      publicUrl = `${protocol}://${baseUrl}/intake/public/${updatedForm.id}?token=${updatedForm.publicToken}`;
      embedCode = `<iframe src="${publicUrl}" style="width:100%; height:1100px; border:none;"></iframe>`;
    }

    return NextResponse.json({
      formId: updatedForm.id,
      formName: updatedForm.name,
      isPublic: updatedForm.isPublic,
      hasToken: !!updatedForm.publicToken,
      publicUrl,
      embedCode,
      presentationMode: updatedForm.presentationMode,
      allowModeToggle: updatedForm.allowModeToggle,
    });
  } catch (error) {
    console.error('Error updating public settings:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
