import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { deskAccessResponse, DeskAccessError } from '@/lib/desk/access';
import { deskAdminRequest } from '@/lib/desk/admin-api';
import { updatePosition } from '@/lib/desk/positions';

type Context = { params: Promise<{ id: string }> };

/** Body: any of { name, description, department, reach, permissions, reportsToId, isActive }. Super Admin only. */
export async function PATCH(request: NextRequest, { params }: Context) {
  try {
    const { id } = await params;
    const { scope, ctx } = await deskAdminRequest(prisma, request, 'SUPER_ADMIN');
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new DeskAccessError(400, 'Invalid request.');
    return NextResponse.json(await updatePosition(prisma, scope, id, body, ctx));
  } catch (err) {
    return deskAccessResponse(err);
  }
}
