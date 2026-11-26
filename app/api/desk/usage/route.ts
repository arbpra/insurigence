import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { deskAccessResponse } from '@/lib/desk/access';
import { deskAdminRequest } from '@/lib/desk/admin-api';
import { getUsage } from '@/lib/desk/usage';

/** Operations Managers and the Super Admin only: every agency's month against its allowances. ?period=YYYY-MM */
export async function GET(request: NextRequest) {
  try {
    const { scope } = await deskAdminRequest(prisma, request, ['usage.view'], undefined, { everyAgency: true });
    return NextResponse.json(await getUsage(prisma, scope, { period: request.nextUrl.searchParams.get('period') }));
  } catch (err) {
    return deskAccessResponse(err);
  }
}
