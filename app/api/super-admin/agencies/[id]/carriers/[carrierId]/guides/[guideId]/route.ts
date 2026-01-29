import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { validateSuperAdmin } from '@/lib/super-admin-auth';
import { unlink } from 'fs/promises';
import path from 'path';

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; carrierId: string; guideId: string }> }
) {
  const auth = await validateSuperAdmin(request);
  if (!auth.valid) return auth.response!;

  try {
    const { guideId } = await params;

    const guide = await prisma.appetiteGuide.findUnique({
      where: { id: guideId },
    });

    if (!guide) {
      return NextResponse.json({ error: 'Guide not found' }, { status: 404 });
    }

    try {
      const filePath = path.join('.', guide.fileUrl);
      await unlink(filePath);
    } catch {
    }

    await prisma.appetiteGuide.delete({
      where: { id: guideId },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting appetite guide:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; carrierId: string; guideId: string }> }
) {
  const auth = await validateSuperAdmin(request);
  if (!auth.valid) return auth.response!;

  try {
    const { guideId } = await params;
    const body = await request.json();
    const { notes } = body;

    const guide = await prisma.appetiteGuide.update({
      where: { id: guideId },
      data: {
        ...(notes !== undefined && { notes }),
      },
    });

    return NextResponse.json({ guide });
  } catch (error) {
    console.error('Error updating appetite guide:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
