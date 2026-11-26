import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { deskAccessResponse, DeskAccessError } from '@/lib/desk/access';
import { deskAdminRequest } from '@/lib/desk/admin-api';
import { setReportingLine } from '@/lib/desk/supervision';

/** Body: { userId, managerId | null }. Who a person reports to; only someone who reaches every agency. */
export async function PUT(request: NextRequest) {
  try {
    const { scope, ctx } = await deskAdminRequest(prisma, request, ['team.manage']);
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object' || typeof body.userId !== 'string' || !('managerId' in body)) throw new DeskAccessError(400, 'Invalid request.');
    return NextResponse.json(await setReportingLine(prisma, scope, body.userId, body.managerId, ctx));
  } catch (err) {
    return deskAccessResponse(err);
  }
}
