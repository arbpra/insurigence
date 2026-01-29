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
    const { id } = await params;

    const agency = await prisma.agency.findUnique({
      where: { id },
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

    if (!agency) {
      return NextResponse.json({ error: 'Agency not found' }, { status: 404 });
    }

    const evaluatedLeads = await prisma.lead.count({
      where: {
        agencyId: id,
        marketClassification: { not: null },
      },
    });

    const thisMonthLeads = await prisma.lead.count({
      where: {
        agencyId: id,
        createdAt: {
          gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
        },
      },
    });

    return NextResponse.json({ 
      agency,
      metrics: {
        evaluatedLeads,
        thisMonthLeads,
      }
    });
  } catch (error) {
    console.error('Error fetching agency:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await validateSuperAdmin(request);
  if (!auth.valid) return auth.response!;

  try {
    const { id } = await params;
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

    const agency = await prisma.agency.update({
      where: { id },
      data: {
        ...(name !== undefined && { name }),
        ...(logoUrl !== undefined && { logoUrl }),
        ...(brandPrimaryColor !== undefined && { brandPrimaryColor }),
        ...(proposalFooterText !== undefined && { proposalFooterText }),
        ...(subscriptionTier !== undefined && { subscriptionTier }),
        ...(allowedMarkets !== undefined && { allowedMarkets }),
        ...(riskTolerance !== undefined && { riskTolerance }),
        ...(status !== undefined && { status }),
        ...(placementNotes !== undefined && { placementNotes }),
        ...(esRecommendationsEnabled !== undefined && { esRecommendationsEnabled }),
      },
    });

    return NextResponse.json({ agency });
  } catch (error) {
    console.error('Error updating agency:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await validateSuperAdmin(request);
  if (!auth.valid) return auth.response!;

  try {
    const { id } = await params;

    await prisma.agency.delete({
      where: { id },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting agency:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
