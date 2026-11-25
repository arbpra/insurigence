import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { deskAccessResponse, DeskAccessError } from '@/lib/desk/access';
import { deskAdminRequest } from '@/lib/desk/admin-api';
import { addPositionHolder, removePositionHolder } from '@/lib/desk/positions';

type Context = { params: Promise<{ id: string }> };

/** Body: { userId }. Gives the person this position. Super Admin only. */
export async function POST(request: NextRequest, { params }: Context) {
  try {
    const { id } = await params;
    const { scope, ctx } = await deskAdminRequest(prisma, request, 'SUPER_ADMIN');
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new DeskAccessError(400, 'Invalid request.');
    return NextResponse.json(await addPositionHolder(prisma, scope, id, body, ctx), { status: 201 });
  } catch (err) {
    return deskAccessResponse(err);
  }
}

/** ?userId=… Takes the position away from the person. Super Admin only. */
export async function DELETE(request: NextRequest, { params }: Context) {
  try {
    const { id } = await params;
    const { scope, ctx } = await deskAdminRequest(prisma, request, 'SUPER_ADMIN');
    const userId = new URL(request.url).searchParams.get('userId') ?? '';
    return NextResponse.json(await removePositionHolder(prisma, scope, id, userId, ctx));
  } catch (err) {
    return deskAccessResponse(err);
  }
}
