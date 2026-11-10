import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { deskAccessResponse } from '@/lib/desk/access';
import { deskUserRequest } from '@/lib/desk/admin-api';
import { assigneesFor } from '@/lib/desk/task-queue';

type Context = { params: Promise<{ id: string }> };

/** Who this task may be assigned to, with how much open work each has. Account and Operations Managers only. */
export async function GET(request: NextRequest, { params }: Context) {
  try {
    const { id } = await params;
    const { scope, ctx } = await deskUserRequest(prisma, request);
    return NextResponse.json(await assigneesFor(prisma, scope, id, ctx));
  } catch (err) {
    return deskAccessResponse(err);
  }
}
