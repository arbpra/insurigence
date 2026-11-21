import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { deskAccessResponse } from '@/lib/desk/access';
import { deskAdminRequest } from '@/lib/desk/admin-api';
import { getAgencyUsage } from '@/lib/desk/usage';

type Context = { params: Promise<{ agencyId: string }> };

/** Operations Managers and the Super Admin only: one agency's completed work in the month. ?period=YYYY-MM. Logged. */
export async function GET(request: NextRequest, { params }: Context) {
  try {
    const { agencyId } = await params;
    const { scope, ctx } = await deskAdminRequest(prisma, request, agencyId);
    return NextResponse.json(await getAgencyUsage(prisma, scope, agencyId, { period: request.nextUrl.searchParams.get('period') }, ctx));
  } catch (err) {
    return deskAccessResponse(err);
  }
}
