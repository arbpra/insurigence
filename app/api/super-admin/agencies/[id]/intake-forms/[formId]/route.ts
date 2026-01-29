import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { validateSuperAdmin } from '@/lib/super-admin-auth';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; formId: string }> }
) {
  const auth = await validateSuperAdmin(request);
  if (!auth.valid) return auth.response!;

  try {
    const { formId } = await params;
    const body = await request.json();
    const { lob, version, definition, isActive, presentationMode, allowModeToggle } = body;

    const form = await prisma.intakeForm.update({
      where: { id: formId },
      data: {
        ...(lob !== undefined && { lob }),
        ...(version !== undefined && { version }),
        ...(definition !== undefined && { definition }),
        ...(isActive !== undefined && { isActive }),
        ...(presentationMode !== undefined && { presentationMode }),
        ...(allowModeToggle !== undefined && { allowModeToggle }),
      },
    });

    return NextResponse.json({ form });
  } catch (error) {
    console.error('Error updating intake form:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; formId: string }> }
) {
  const auth = await validateSuperAdmin(request);
  if (!auth.valid) return auth.response!;

  try {
    const { formId } = await params;

    await prisma.intakeForm.delete({
      where: { id: formId },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting intake form:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
