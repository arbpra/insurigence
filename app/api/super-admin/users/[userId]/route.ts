import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { validateSuperAdmin } from '@/lib/super-admin-auth';
import { hashPassword, generateTempPassword } from '@/lib/auth';
import { isRole, isDeskRole, agencyIdForRole } from '@/lib/roles';
import { deskAccessResponse, DeskAccessError, resolveDeskScope } from '@/lib/desk/access';
import { deactivateStaff, reactivateStaff } from '@/lib/desk/staff';

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
    // Role and agency are resolved together so a role change can never leave a
    // stale agencyId behind (e.g. an agent promoted to Account Manager).
    if (role !== undefined || agencyId !== undefined) {
      const finalRole = role ?? existingUser.role;
      if (!isRole(finalRole)) {
        return NextResponse.json({ error: 'Invalid role' }, { status: 400 });
      }
      const scoped = agencyIdForRole(
        finalRole,
        agencyId !== undefined ? agencyId : existingUser.agencyId
      );
      if (!scoped.ok) {
        return NextResponse.json({ error: scoped.error }, { status: 400 });
      }
      updateData.role = finalRole;
      updateData.agencyId = scoped.agencyId;
    }
    if (isActive !== undefined) updateData.isActive = isActive;

    // Desk staff follow the same rules as the Desk staff screen: signed out at
    // once, open work back in the queue, Account Manager cover moved on.
    if (isDeskRole(existingUser.role) && isActive !== undefined && isActive !== existingUser.isActive) {
      const scope = await resolveDeskScope(prisma, auth.user!.id);
      if (isActive === false) await deactivateStaff(prisma, scope, userId);
      else await reactivateStaff(prisma, scope, userId);
      delete updateData.isActive;
    }

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
    if (error instanceof DeskAccessError) return deskAccessResponse(error);
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

    // See PATCH: Desk staff follow the same rules as the Desk staff screen.
    if (isDeskRole(existingUser.role) && existingUser.isActive) {
      await deactivateStaff(prisma, await resolveDeskScope(prisma, auth.user!.id), userId);
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
    if (error instanceof DeskAccessError) return deskAccessResponse(error);
    console.error('Error deactivating user:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
