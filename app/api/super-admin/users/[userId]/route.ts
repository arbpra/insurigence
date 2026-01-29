import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { validateSuperAdmin } from '@/lib/super-admin-auth';
import { hashPassword, generateTempPassword } from '@/lib/auth';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  const auth = await validateSuperAdmin(request);
  if (!auth.valid) return auth.response!;

  try {
    const { userId } = await params;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        agency: {
          select: {
            id: true,
            name: true,
          },
        },
        _count: {
          select: {
            leads: true,
          },
        },
        activityEvents: {
          take: 20,
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!user) {
      return NextResponse.json(
        { error: 'User not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({ user });
  } catch (error) {
    console.error('Error fetching user:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  const auth = await validateSuperAdmin(request);
  if (!auth.valid) return auth.response!;

  try {
    const { userId } = await params;
    const body = await request.json();
    const { firstName, lastName, role, agencyId, isActive } = body;

    const existingUser = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!existingUser) {
      return NextResponse.json(
        { error: 'User not found' },
        { status: 404 }
      );
    }

    const updateData: Record<string, unknown> = {};

    if (firstName !== undefined) updateData.firstName = firstName;
    if (lastName !== undefined) updateData.lastName = lastName;
    if (role !== undefined) updateData.role = role;
    if (agencyId !== undefined) {
      updateData.agencyId = role === 'SUPER_ADMIN' ? null : agencyId;
    }
    if (isActive !== undefined) updateData.isActive = isActive;

    const user = await prisma.user.update({
      where: { id: userId },
      data: updateData,
      include: {
        agency: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    const eventType = isActive === false ? 'USER_DEACTIVATED' : 'USER_UPDATED';
    await prisma.activityEvent.create({
      data: {
        agencyId: user.agencyId,
        userId: user.id,
        eventType,
        metadata: {
          changes: Object.keys(updateData),
          newRole: role,
          newAgencyId: agencyId,
        },
      },
    });

    return NextResponse.json({ user });
  } catch (error) {
    console.error('Error updating user:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  const auth = await validateSuperAdmin(request);
  if (!auth.valid) return auth.response!;

  try {
    const { userId } = await params;

    const existingUser = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!existingUser) {
      return NextResponse.json(
        { error: 'User not found' },
        { status: 404 }
      );
    }

    const user = await prisma.user.update({
      where: { id: userId },
      data: { isActive: false },
    });

    await prisma.activityEvent.create({
      data: {
        agencyId: user.agencyId,
        userId: user.id,
        eventType: 'USER_DEACTIVATED',
        metadata: {
          deactivatedAt: new Date().toISOString(),
        },
      },
    });

    return NextResponse.json({ success: true, user });
  } catch (error) {
    console.error('Error deactivating user:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
