import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { deskAccessResponse, DeskAccessError } from '@/lib/desk/access';
import { deskUserRequest } from '@/lib/desk/admin-api';
import { dismissClassificationFlag, flagClassification } from '@/lib/desk/classification';

type Context = { params: Promise<{ id: string }> };

async function bodyOf(request: NextRequest) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new DeskAccessError(400, 'Invalid request.');
  return body as Record<string, unknown>;
}

/** Body: { target: 'ACCOUNT' | 'REQUEST', suggested, reason }. Flags the classification for a change (Module 53). */
export async function POST(request: NextRequest, { params }: Context) {
  try {
    const { id } = await params;
    const { scope, ctx } = await deskUserRequest(prisma, request);
    return NextResponse.json(await flagClassification(prisma, scope, id, await bodyOf(request), ctx));
  } catch (err) {
    return deskAccessResponse(err);
  }
}

/** Body: { note? }. Dismisses the open flag. A request's own classification is changed through /review. */
export async function DELETE(request: NextRequest, { params }: Context) {
  try {
    const { id } = await params;
    const { scope, ctx } = await deskUserRequest(prisma, request);
    return NextResponse.json(await dismissClassificationFlag(prisma, scope, id, await bodyOf(request), ctx));
  } catch (err) {
    return deskAccessResponse(err);
  }
}
