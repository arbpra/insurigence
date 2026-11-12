import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { deskAccessResponse, DeskAccessError } from '@/lib/desk/access';
import { deskUserRequest } from '@/lib/desk/admin-api';
import { readThread, sendMessage } from '@/lib/desk/messages';

type Context = { params: Promise<{ agencyId: string }> };

/** One agency's conversation with its Desk team. Opening it marks it read. */
export async function GET(request: NextRequest, { params }: Context) {
  try {
    const { agencyId } = await params;
    const { scope, ctx } = await deskUserRequest(prisma, request);
    return NextResponse.json(await readThread(prisma, scope, agencyId, ctx));
  } catch (err) {
    return deskAccessResponse(err);
  }
}

/** Body: { body } */
export async function POST(request: NextRequest, { params }: Context) {
  try {
    const { agencyId } = await params;
    const { scope, ctx } = await deskUserRequest(prisma, request);
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new DeskAccessError(400, 'Invalid request.');
    return NextResponse.json(await sendMessage(prisma, scope, agencyId, body, ctx), { status: 201 });
  } catch (err) {
    return deskAccessResponse(err);
  }
}
