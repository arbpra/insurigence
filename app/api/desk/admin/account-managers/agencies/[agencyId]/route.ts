import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { deskAccessResponse, DeskAccessError } from '@/lib/desk/access';
import { deskAdminRequest } from '@/lib/desk/admin-api';
import { reassignAgency } from '@/lib/desk/supervision';

type Context = { params: Promise<{ agencyId: string }> };

/** Body: { primaryAmId?, backupAmId?, version? }. Moves an agency between authorised Account Managers. */
export async function PUT(request: NextRequest, { params }: Context) {
  try {
    const { agencyId } = await params;
    const { scope, ctx } = await deskAdminRequest(prisma, request, ['team.manage'], agencyId);
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new DeskAccessError(400, 'Invalid request.');
    return NextResponse.json(await reassignAgency(prisma, scope, agencyId, body, ctx));
  } catch (err) {
    return deskAccessResponse(err);
  }
}
