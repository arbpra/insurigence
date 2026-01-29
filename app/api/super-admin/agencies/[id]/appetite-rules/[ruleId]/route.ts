import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { validateSuperAdmin } from '@/lib/super-admin-auth';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; ruleId: string }> }
) {
  const auth = await validateSuperAdmin(request);
  if (!auth.valid) return auth.response!;

  try {
    const { ruleId } = await params;

    const rule = await prisma.carrierAppetiteRule.findUnique({
      where: { id: ruleId },
      include: { carrier: { select: { id: true, name: true, marketType: true } } },
    });

    if (!rule) {
      return NextResponse.json({ error: 'Rule not found' }, { status: 404 });
    }

    return NextResponse.json({ rule });
  } catch (error) {
    console.error('Error fetching appetite rule:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; ruleId: string }> }
) {
  const auth = await validateSuperAdmin(request);
  if (!auth.valid) return auth.response!;

  try {
    const { ruleId } = await params;
    const body = await request.json();
    const {
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
      isActive,
    } = body;

    const rule = await prisma.carrierAppetiteRule.update({
      where: { id: ruleId },
      data: {
        ...(allowedIndustries !== undefined && { allowedIndustries }),
        ...(excludedIndustries !== undefined && { excludedIndustries }),
        ...(allowedStates !== undefined && { allowedStates }),
        ...(excludedStates !== undefined && { excludedStates }),
        ...(minRevenue !== undefined && { minRevenue }),
        ...(maxRevenue !== undefined && { maxRevenue }),
        ...(minEmployees !== undefined && { minEmployees }),
        ...(maxEmployees !== undefined && { maxEmployees }),
        ...(minYearsInBusiness !== undefined && { minYearsInBusiness }),
        ...(lossHistoryYears !== undefined && { lossHistoryYears }),
        ...(maxLossCount !== undefined && { maxLossCount }),
        ...(maxLossAmount !== undefined && { maxLossAmount }),
        ...(summary !== undefined && { summary }),
        ...(isActive !== undefined && { isActive }),
      },
      include: { carrier: { select: { id: true, name: true, marketType: true } } },
    });

    return NextResponse.json({ rule });
  } catch (error) {
    console.error('Error updating appetite rule:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; ruleId: string }> }
) {
  const auth = await validateSuperAdmin(request);
  if (!auth.valid) return auth.response!;

  try {
    const { ruleId } = await params;

    await prisma.carrierAppetiteRule.delete({
      where: { id: ruleId },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting appetite rule:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
