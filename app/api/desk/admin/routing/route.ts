import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { deskAccessResponse, DeskAccessError } from '@/lib/desk/access';
import { deskAdminRequest } from '@/lib/desk/admin-api';
import { getRoutingSetup, setRouting } from '@/lib/desk/routing-admin';

/** ?agencyId= shows that agency's agreement; without it, the Desk defaults. */
export async function GET(request: NextRequest) {
  try {
    const { scope } = await deskAdminRequest(prisma, request, ['settings.operations']);
    return NextResponse.json(await getRoutingSetup(prisma, scope, request.nextUrl.searchParams.get('agencyId')));
  } catch (err) {
    return deskAccessResponse(err);
  }
}

/** Body: { taskType, podId | null, defaultPriority? } */
export async function PUT(request: NextRequest) {
  try {
    const { scope, ctx } = await deskAdminRequest(prisma, request, ['settings.operations']);
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new DeskAccessError(400, 'Invalid request.');
    await setRouting(prisma, scope, body, ctx);
    return NextResponse.json({ success: true });
  } catch (err) {
    return deskAccessResponse(err);
  }
}
