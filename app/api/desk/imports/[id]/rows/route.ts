import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { deskAccessResponse } from '@/lib/desk/access';
import { deskUserRequest } from '@/lib/desk/admin-api';
import { getImportRows } from '@/lib/desk/imports';

type Context = { params: Promise<{ id: string }> };

/** ?page, ?pageSize, ?all=1 to include the rows above the header row. */
export async function GET(request: NextRequest, { params }: Context) {
  try {
    const { id } = await params;
    const { scope, ctx } = await deskUserRequest(prisma, request);
    const q = request.nextUrl.searchParams;
    return NextResponse.json(await getImportRows(prisma, scope, id, { page: q.get('page') ?? undefined, pageSize: q.get('pageSize') ?? undefined, all: q.get('all') === '1' }, ctx));
  } catch (err) {
    return deskAccessResponse(err);
  }
}
