import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { validateSuperAdmin } from '@/lib/super-admin-auth';
import { hashPassword, generateTempPassword } from '@/lib/auth';

export async function GET(request: NextRequest) {
  const auth = await validateSuperAdmin(request);
  if (!auth.valid) return auth.response!;

  try {
    const { searchParams } = new URL(request.url);
    const agencyId = searchParams.get('agencyId');
    const role = searchParams.get('role');
    const status = searchParams.get('status');
    const search = searchParams.get('search');

    const where: Record<string, unknown> = {};

    if (agencyId) {
      where.agencyId = agencyId;
    }

    if (role) {
      where.role = role;
    }

    if (status === 'active') {
      where.isActive = true;
    } else if (status === 'inactive') {
      where.isActive = false;
    }

    if (search) {
      where.OR = [
        { email: { contains: search, mode: 'insensitive' } },
        { firstName: { contains: search, mode: 'insensitive' } },
        { lastName: { contains: search, mode: 'insensitive' } },
      ];
    }

    const users = await prisma.user.findMany({
      where,
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
      },
      orderBy: { createdAt: 'desc' },
    });

    const stats = {
      totalUsers: users.length,
      activeUsers: users.filter((u) => u.isActive).length,
      superAdmins: users.filter((u) => String(u.role) === 'SUPER_ADMIN').length,
      admins: users.filter((u) => String(u.role) === 'ADMIN').length,
      agents: users.filter((u) => String(u.role) === 'AGENT').length,
    };

    return NextResponse.json({ users, stats });
  } catch (error) {
    console.error('Error fetching users:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const auth = await validateSuperAdmin(request);
  if (!auth.valid || !auth.user) return auth.response!;

  try {
    const body = await request.json();
    const { email, firstName, lastName, role, agencyId } = body;

    if (!email) {
      return NextResponse.json(
        { error: 'Email is required' },
        { status: 400 }
      );
    }

    if (role !== 'SUPER_ADMIN' && !agencyId) {
      return NextResponse.json(
        { error: 'Agency is required for non-super-admin users' },
        { status: 400 }
      );
    }

    const existingUser = await prisma.user.findFirst({
      where: { email: email.toLowerCase().trim() },
    });

    if (existingUser) {
      return NextResponse.json(
        { error: 'A user with this email already exists' },
        { status: 409 }
      );
    }

    const tempPassword = generateTempPassword();
    const passwordHash = await hashPassword(tempPassword);

    const user = await prisma.user.create({
      data: {
        email: email.toLowerCase().trim(),
        passwordHash,
        firstName,
        lastName,
        role: role || 'AGENT',
        agencyId: role === 'SUPER_ADMIN' ? null : agencyId,
        isActive: true,
        mustChangePassword: true,
      },
      include: {
        agency: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    await prisma.activityEvent.create({
      data: {
        agencyId: user.agencyId,
        userId: auth.user.id,
        eventType: 'USER_CREATED',
        metadata: {
          createdUserId: user.id,
          email: user.email,
          role: user.role,
        },
      },
    });

    return NextResponse.json({ 
      user,
      tempPassword,
    }, { status: 201 });
  } catch (error) {
    console.error('Error creating user:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
