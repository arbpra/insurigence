import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { deskAccessResponse, DeskAccessError } from '@/lib/desk/access';
import { deskUserRequest } from '@/lib/desk/admin-api';
import { assignInsuredStaff, unassignInsuredStaff } from '@/lib/desk/book';

type Context = { params: Promise<{ id: string }> };

/** Body: { userId, role?: 'PRODUCER' | 'SERVICE' } */
export async function PUT(request: NextRequest, { params }: Context) {
  try {
    const { id } = await params;
    const { scope, ctx } = await deskUserRequest(prisma, request);
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new DeskAccessError(400, 'Invalid request.');
    await assignInsuredStaff(prisma, scope, id, body, ctx);
    return NextResponse.json({ success: true });
  } catch (err) {
    return deskAccessResponse(err);
  }
}

/** ?userId= */
export async function DELETE(request: NextRequest, { params }: Context) {
  try {
    const { id } = await params;
    const { scope, ctx } = await deskUserRequest(prisma, request);
    await unassignInsuredStaff(prisma, scope, id, request.nextUrl.searchParams.get('userId'), ctx);
    return NextResponse.json({ success: true });
  } catch (err) {
    return deskAccessResponse(err);
  }
}
