import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { deskAccessResponse, DeskAccessError } from '@/lib/desk/access';
import { deskUserRequest } from '@/lib/desk/admin-api';
import { getRestrictionCandidates, setTaskRestriction } from '@/lib/desk/task-api';

type Context = { params: Promise<{ id: string }> };

/** Who the request can be restricted to, and who it is restricted to now. Account and Operations Managers (Q4). */
export async function GET(request: NextRequest, { params }: Context) {
  try {
    const { id } = await params;
    const { scope, ctx } = await deskUserRequest(prisma, request);
    return NextResponse.json(await getRestrictionCandidates(prisma, scope, id, ctx));
  } catch (err) {
    return deskAccessResponse(err);
  }
}

/** Body: { userIds: string[], reason } to restrict or change who is named; { userIds: [] } to lift it. */
export async function POST(request: NextRequest, { params }: Context) {
  try {
    const { id } = await params;
    const { scope, ctx } = await deskUserRequest(prisma, request);
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new DeskAccessError(400, 'Invalid request.');
    return NextResponse.json(await setTaskRestriction(prisma, scope, id, body, ctx));
  } catch (err) {
    return deskAccessResponse(err);
  }
}
