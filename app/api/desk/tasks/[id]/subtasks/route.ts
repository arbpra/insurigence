import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { deskAccessResponse, DeskAccessError } from '@/lib/desk/access';
import { deskUserRequest } from '@/lib/desk/admin-api';
import { submitSubtask } from '@/lib/desk/task-api';

type Context = { params: Promise<{ id: string }> };

/** Body: { type, title, description?, priority? }. Adds a subtask to request {id}; Desk staff only. */
export async function POST(request: NextRequest, { params }: Context) {
  try {
    const { id } = await params;
    const { scope, ctx } = await deskUserRequest(prisma, request);
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new DeskAccessError(400, 'Invalid request.');
    return NextResponse.json(await submitSubtask(prisma, scope, id, body, ctx), { status: 201 });
  } catch (err) {
    return deskAccessResponse(err);
  }
}
