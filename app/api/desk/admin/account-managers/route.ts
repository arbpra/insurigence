import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { deskAccessResponse } from '@/lib/desk/access';
import { deskAdminRequest } from '@/lib/desk/admin-api';
import { getTeam } from '@/lib/desk/supervision';

/** Account Managers in reach: who reports to whom, their agencies and cover (Module 50). */
export async function GET(request: NextRequest) {
  try {
    const { scope, ctx } = await deskAdminRequest(prisma, request, ['team.manage']);
    return NextResponse.json(await getTeam(prisma, scope, ctx));
  } catch (err) {
    return deskAccessResponse(err);
  }
}
