import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { validateSuperAdmin } from '@/lib/super-admin-auth';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await validateSuperAdmin(request);
  if (!auth.valid) return auth.response!;

  try {
    const { id: agencyId } = await params;

    const forms = await prisma.intakeForm.findMany({
      where: { agencyId },
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json({ forms });
  } catch (error) {
    console.error('Error fetching intake forms:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await validateSuperAdmin(request);
  if (!auth.valid) return auth.response!;

  try {
    const { id: agencyId } = await params;
    const body = await request.json();
    const { name, lob, definition, isActive } = body;

    if (!definition || typeof definition !== 'object') {
      return NextResponse.json({ error: 'Definition JSON is required' }, { status: 400 });
    }

    const form = await prisma.intakeForm.create({
      data: {
        agencyId,
        name: name || 'Intake Form',
        lob: lob || 'COMMERCIAL_GL',
        definition,
        isActive: isActive !== false,
      },
    });

    return NextResponse.json({ form }, { status: 201 });
  } catch (error) {
    console.error('Error creating intake form:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
