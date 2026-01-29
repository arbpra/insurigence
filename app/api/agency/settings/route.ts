import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getAuthContext } from '@/lib/super-admin-auth';

export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthContext(request);
    if (!auth.valid || !auth.user) return auth.response!;

    const user = auth.user;
    
    if (!user.agencyId && user.role !== 'SUPER_ADMIN') {
      return NextResponse.json({ error: 'No agency assigned' }, { status: 403 });
    }

    const agencyId = user.agencyId || request.nextUrl.searchParams.get('agencyId');
    
    if (!agencyId) {
      return NextResponse.json({ error: 'Agency not configured' }, { status: 400 });
    }

    if (user.role !== 'SUPER_ADMIN' && user.agencyId !== agencyId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const agency = await prisma.agency.findUnique({
      where: { id: agencyId },
      select: {
        id: true,
        name: true,
        riskTolerance: true,
        allowedMarkets: true,
        esRecommendationsEnabled: true,
        placementNotes: true,
        subscriptionTier: true,
        status: true,
      },
    });

    if (!agency) {
      return NextResponse.json({ error: 'Agency not found' }, { status: 404 });
    }

    return NextResponse.json({ agency });
  } catch (error) {
    console.error('Error fetching agency settings:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const auth = await getAuthContext(request);
    if (!auth.valid || !auth.user) return auth.response!;

    const user = auth.user;
    
    if (!user.agencyId && user.role !== 'SUPER_ADMIN') {
      return NextResponse.json({ error: 'No agency assigned' }, { status: 403 });
    }

    const agencyId = user.agencyId || request.nextUrl.searchParams.get('agencyId');
    
    if (!agencyId) {
      return NextResponse.json({ error: 'Agency not configured' }, { status: 400 });
    }

    if (user.role !== 'SUPER_ADMIN' && user.agencyId !== agencyId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    if (user.role === 'AGENT') {
      return NextResponse.json({ error: 'Only admins can update settings' }, { status: 403 });
    }

    const body = await request.json();
    const { 
      riskTolerance,
      esRecommendationsEnabled,
      placementNotes,
    } = body;

    const agency = await prisma.agency.update({
      where: { id: agencyId },
      data: {
        ...(riskTolerance !== undefined && { riskTolerance }),
        ...(esRecommendationsEnabled !== undefined && { esRecommendationsEnabled }),
        ...(placementNotes !== undefined && { placementNotes }),
      },
      select: {
        id: true,
        name: true,
        riskTolerance: true,
        allowedMarkets: true,
        esRecommendationsEnabled: true,
        placementNotes: true,
        subscriptionTier: true,
        status: true,
      },
    });

    return NextResponse.json({ agency });
  } catch (error) {
    console.error('Error updating agency settings:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
