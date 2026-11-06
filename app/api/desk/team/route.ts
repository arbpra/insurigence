import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { deskAccessResponse } from '@/lib/desk/access';
import { deskUserRequest } from '@/lib/desk/admin-api';
import { listTeam } from '@/lib/desk/team';

/** ?agencyId= for Operations Managers and Super Admin. */
export async function GET(request: NextRequest) {
  try {
    const { scope, ctx } = await deskUserRequest(prisma, request);
    return NextResponse.json(await listTeam(prisma, scope, { agencyId: request.nextUrl.searchParams.get('agencyId') }, ctx));
  } catch (err) {
    return deskAccessResponse(err);
  }
}
