import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { validateSuperAdmin } from '@/lib/super-admin-auth';

export async function GET(request: NextRequest) {
  const auth = await validateSuperAdmin(request);
  if (!auth.valid) return auth.response!;

  try {
    const agencies = await prisma.agency.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        _count: {
          select: {
            leads: true,
            carriers: true,
            appetiteRules: true,
            intakeForms: true,
            proposals: true,
            users: true,
          },
        },
      },
    });

    const totalLeads = await prisma.lead.count();
    const totalAgencies = agencies.length;
    const activeAgencies = agencies.filter(a => a.status === 'ACTIVE').length;

    return NextResponse.json({ 
      agencies,
      stats: {
        totalAgencies,
        activeAgencies,
        totalLeads,
      }
    });
  } catch (error) {
    console.error('Error fetching agencies:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const auth = await validateSuperAdmin(request);
  if (!auth.valid) return auth.response!;

  try {
    const body = await request.json();
    const { 
      name, 
      logoUrl, 
      brandPrimaryColor, 
      proposalFooterText,
      subscriptionTier,
      allowedMarkets,
      riskTolerance,
      status,
      placementNotes,
      esRecommendationsEnabled,
    } = body;

    if (!name || typeof name !== 'string') {
      return NextResponse.json({ error: 'Name is required' }, { status: 400 });
    }

    const agency = await prisma.agency.create({
      data: {
        name,
        logoUrl: logoUrl || null,
        brandPrimaryColor: brandPrimaryColor || null,
        proposalFooterText: proposalFooterText || null,
        subscriptionTier: subscriptionTier || 'SOLO',
        allowedMarkets: allowedMarkets || ['standard'],
        riskTolerance: riskTolerance || 'BALANCED',
        status: status || 'ACTIVE',
        placementNotes: placementNotes || null,
        esRecommendationsEnabled: esRecommendationsEnabled !== false,
      },
    });

    return NextResponse.json({ agency }, { status: 201 });
  } catch (error) {
    console.error('Error creating agency:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
