import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { isAgencyRole } from '@/lib/roles';

export async function GET(request: NextRequest) {
  try {
    const user = await getSessionFromRequest(request);
    
    if (!user) {
      return NextResponse.json({ user: null }, { status: 200 });
    }

    // Shows or hides "The Desk" links only; the Desk pages check access themselves.
    const deskEnabled = isAgencyRole(user.role) && user.agencyId
      ? !!(await prisma.agency.findUnique({ where: { id: user.agencyId }, select: { deskEnabled: true } }))?.deskEnabled
      : false;

    return NextResponse.json({
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        agencyId: user.agencyId,
        mustChangePassword: user.mustChangePassword,
        deskEnabled,
      },
    });
  } catch (error) {
    console.error('Session check error:', error);
    return NextResponse.json({ user: null }, { status: 200 });
  }
}
