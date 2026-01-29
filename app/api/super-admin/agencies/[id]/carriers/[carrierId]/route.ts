import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { validateSuperAdmin } from '@/lib/super-admin-auth';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; carrierId: string }> }
) {
  const auth = await validateSuperAdmin(request);
  if (!auth.valid) return auth.response!;

  try {
    const { carrierId } = await params;
    const body = await request.json();
    const { name, marketType, enabled, priorityRank, notes, isActive } = body;

    const carrier = await prisma.carrier.update({
      where: { id: carrierId },
      data: {
        ...(name !== undefined && { name }),
        ...(marketType !== undefined && { marketType }),
        ...(enabled !== undefined && { enabled }),
        ...(priorityRank !== undefined && { priorityRank }),
        ...(notes !== undefined && { notes }),
        ...(isActive !== undefined && { isActive }),
      },
    });

    return NextResponse.json({ carrier });
  } catch (error) {
    console.error('Error updating carrier:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; carrierId: string }> }
) {
  const auth = await validateSuperAdmin(request);
  if (!auth.valid) return auth.response!;

  try {
    const { carrierId } = await params;

    await prisma.carrier.delete({
      where: { id: carrierId },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting carrier:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
