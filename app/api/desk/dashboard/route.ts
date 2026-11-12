import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { deskAccessResponse } from '@/lib/desk/access';
import { deskUserRequest } from '@/lib/desk/admin-api';
import { managerDashboard } from '@/lib/desk/manager-dashboard';

/** Account and Operations Managers: ?renewals=30|60|90 (days ahead; default 60). */
export async function GET(request: NextRequest) {
  try {
    const { scope, ctx } = await deskUserRequest(prisma, request);
    return NextResponse.json(await managerDashboard(prisma, scope, { renewalDays: request.nextUrl.searchParams.get('renewals') }, ctx));
  } catch (err) {
    return deskAccessResponse(err);
  }
}
