import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { deskAccessResponse, DeskAccessError } from '@/lib/desk/access';
import { deskUserRequest } from '@/lib/desk/admin-api';
import { getTeamMember, updateTeamMember } from '@/lib/desk/team';

type Context = { params: Promise<{ userId: string }> };

export async function GET(request: NextRequest, { params }: Context) {
  try {
    const { userId } = await params;
    const { scope, ctx } = await deskUserRequest(prisma, request);
    return NextResponse.json(await getTeamMember(prisma, scope, userId, ctx));
  } catch (err) {
    return deskAccessResponse(err);
  }
}

/** Body: { version?, role?, bookAccess? } */
export async function PATCH(request: NextRequest, { params }: Context) {
  try {
    const { userId } = await params;
    const { scope, ctx } = await deskUserRequest(prisma, request);
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new DeskAccessError(400, 'Invalid request.');
    return NextResponse.json(await updateTeamMember(prisma, scope, userId, body, ctx));
  } catch (err) {
    return deskAccessResponse(err);
  }
}
