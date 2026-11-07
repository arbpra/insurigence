import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { deskAccessResponse } from '@/lib/desk/access';
import { deskUserRequest } from '@/lib/desk/admin-api';
import { getImportPreview } from '@/lib/desk/import-commit';

type Context = { params: Promise<{ id: string }> };

/** ?onExisting=ADD|SKIP: what to do with accounts already in the book. */
export async function GET(request: NextRequest, { params }: Context) {
  try {
    const { id } = await params;
    const { scope, ctx } = await deskUserRequest(prisma, request);
    return NextResponse.json(await getImportPreview(prisma, scope, id, { onExisting: request.nextUrl.searchParams.get('onExisting') }, ctx));
  } catch (err) {
    return deskAccessResponse(err);
  }
}
