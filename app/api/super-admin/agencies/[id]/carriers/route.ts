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

    const carriers = await prisma.carrier.findMany({
      where: { agencyId },
      orderBy: [{ priorityRank: 'asc' }, { name: 'asc' }],
      include: {
        appetiteRules: {
          where: { isActive: true },
          orderBy: { version: 'desc' },
          take: 1,
        },
        _count: {
          select: { appetiteGuides: true },
        },
      },
    });

    return NextResponse.json({ carriers });
  } catch (error) {
    console.error('Error fetching carriers:', error);
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
    const { name, marketType, enabled, priorityRank, notes } = body;

    if (!name || typeof name !== 'string') {
      return NextResponse.json({ error: 'Name is required' }, { status: 400 });
    }

    const carrier = await prisma.carrier.create({
      data: {
        agencyId,
        name,
        marketType: marketType || 'STANDARD',
        enabled: enabled !== false,
        priorityRank: priorityRank || 100,
        notes: notes || null,
        isActive: true,
      },
    });

    return NextResponse.json({ carrier }, { status: 201 });
  } catch (error) {
    console.error('Error creating carrier:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
