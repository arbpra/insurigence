import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { deskAccessResponse, DeskAccessError } from '@/lib/desk/access';
import { deskUserRequest } from '@/lib/desk/admin-api';
import { discardImport, getImport, setImportHeaderRow } from '@/lib/desk/imports';

type Context = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: Context) {
  try {
    const { id } = await params;
    const { scope, ctx } = await deskUserRequest(prisma, request);
    return NextResponse.json(await getImport(prisma, scope, id, ctx));
  } catch (err) {
    return deskAccessResponse(err);
  }
}

/** Body: { headerRow, version } */
export async function PATCH(request: NextRequest, { params }: Context) {
  try {
    const { id } = await params;
    const { scope, ctx } = await deskUserRequest(prisma, request);
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new DeskAccessError(400, 'Invalid request.');
    return NextResponse.json(await setImportHeaderRow(prisma, scope, id, body, ctx));
  } catch (err) {
    return deskAccessResponse(err);
  }
}

export async function DELETE(request: NextRequest, { params }: Context) {
  try {
    const { id } = await params;
    const { scope, ctx } = await deskUserRequest(prisma, request);
    return NextResponse.json(await discardImport(prisma, scope, id, ctx));
  } catch (err) {
    return deskAccessResponse(err);
  }
}
