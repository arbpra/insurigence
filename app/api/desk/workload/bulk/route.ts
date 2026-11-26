import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { deskAccessResponse, DeskAccessError } from '@/lib/desk/access';
import { deskAdminRequest } from '@/lib/desk/admin-api';
import { changeWorkload } from '@/lib/desk/workload';

/** Body: { taskIds, assigneeId } (null returns them to the queue) or { taskIds, podId }. */
export async function POST(request: NextRequest) {
  try {
    const { scope, ctx } = await deskAdminRequest(prisma, request, ['workload.view'], undefined, { everyAgency: true });
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new DeskAccessError(400, 'Invalid request.');
    return NextResponse.json(await changeWorkload(prisma, scope, body, ctx));
  } catch (err) {
    return deskAccessResponse(err);
  }
}
