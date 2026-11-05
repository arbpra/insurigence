import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { deskAccessResponse, DeskAccessError } from '@/lib/desk/access';
import { deskAdminRequest } from '@/lib/desk/admin-api';
import { removeTarget, saveTarget } from '@/lib/desk/routing-admin';

/** Creates a target, or edits it when the body has an `id`. */
export async function POST(request: NextRequest) {
  try {
    const { scope, ctx } = await deskAdminRequest(prisma, request);
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new DeskAccessError(400, 'Invalid request.');
    return NextResponse.json(await saveTarget(prisma, scope, body, ctx));
  } catch (err) {
    return deskAccessResponse(err);
  }
}

/** ?id= */
export async function DELETE(request: NextRequest) {
  try {
    const { scope, ctx } = await deskAdminRequest(prisma, request);
    await removeTarget(prisma, scope, request.nextUrl.searchParams.get('id'), ctx);
    return NextResponse.json({ success: true });
  } catch (err) {
    return deskAccessResponse(err);
  }
}
