import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { deskAccessResponse } from '@/lib/desk/access';
import { deskUserRequest } from '@/lib/desk/admin-api';
import { getTurnaround, turnaroundOptions } from '@/lib/desk/turnaround';

/**
 * Account and Operations Managers (an Account Manager sees their own agencies only):
 * ?days=7|30|90|365 (default 30) &type=<request type> &agencyId=
 */
export async function GET(request: NextRequest) {
  try {
    const { scope, ctx } = await deskUserRequest(prisma, request);
    const p = request.nextUrl.searchParams;
    const opts = turnaroundOptions({ days: p.get('days'), type: p.get('type'), agencyId: p.get('agencyId') });
    return NextResponse.json(await getTurnaround(prisma, scope, opts, ctx));
  } catch (err) {
    return deskAccessResponse(err);
  }
}
