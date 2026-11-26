import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { deskAccessResponse } from '@/lib/desk/access';
import { deskAdminRequest } from '@/lib/desk/admin-api';
import { endCover } from '@/lib/desk/supervision';

type Context = { params: Promise<{ id: string }> };

/** Ends a cover now, or cancels one not started yet. */
export async function DELETE(request: NextRequest, { params }: Context) {
  try {
    const { id } = await params;
    const { scope, ctx } = await deskAdminRequest(prisma, request, ['team.manage']);
    return NextResponse.json(await endCover(prisma, scope, id, ctx));
  } catch (err) {
    return deskAccessResponse(err);
  }
}
