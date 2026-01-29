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

    const rules = await prisma.carrierAppetiteRule.findMany({
      where: { agencyId },
      include: { carrier: { select: { id: true, name: true, marketType: true } } },
      orderBy: [{ carrierId: 'asc' }, { version: 'desc' }],
    });

    return NextResponse.json({ rules });
  } catch (error) {
    console.error('Error fetching appetite rules:', error);
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
    const {
      carrierId,
      lob,
      allowedIndustries,
      excludedIndustries,
      allowedStates,
      excludedStates,
      minRevenue,
      maxRevenue,
      minEmployees,
      maxEmployees,
      minYearsInBusiness,
      lossHistoryYears,
      maxLossCount,
      maxLossAmount,
      summary,
      isAgencyOverride,
    } = body;

    if (!carrierId) {
      return NextResponse.json({ error: 'Carrier ID is required' }, { status: 400 });
    }

    const existingRule = await prisma.carrierAppetiteRule.findFirst({
      where: { carrierId, lob: lob || 'COMMERCIAL_GL' },
      orderBy: { version: 'desc' },
    });

    const nextVersion = existingRule ? existingRule.version + 1 : 1;

    const rule = await prisma.carrierAppetiteRule.create({
      data: {
        agencyId,
        carrierId,
        lob: lob || 'COMMERCIAL_GL',
        version: nextVersion,
        allowedIndustries: allowedIndustries || [],
        excludedIndustries: excludedIndustries || [],
        allowedStates: allowedStates || [],
        excludedStates: excludedStates || [],
        minRevenue: minRevenue || null,
        maxRevenue: maxRevenue || null,
        minEmployees: minEmployees || null,
        maxEmployees: maxEmployees || null,
        minYearsInBusiness: minYearsInBusiness || null,
        lossHistoryYears: lossHistoryYears || 5,
        maxLossCount: maxLossCount || null,
        maxLossAmount: maxLossAmount || null,
        summary: summary || null,
        isAgencyOverride: isAgencyOverride || false,
        isActive: true,
      },
      include: { carrier: { select: { id: true, name: true, marketType: true } } },
    });

    if (existingRule) {
      await prisma.carrierAppetiteRule.update({
        where: { id: existingRule.id },
        data: { isActive: false },
      });
    }

    return NextResponse.json({ rule }, { status: 201 });
  } catch (error) {
    console.error('Error creating appetite rule:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
