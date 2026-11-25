import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { deskAccessResponse, DeskAccessError } from '@/lib/desk/access';
import { deskAdminRequest } from '@/lib/desk/admin-api';
import { createPosition, listPositions } from '@/lib/desk/positions';

/** Positions, who holds them, and the Desk staff who could (Module 47). Super Admin only. */
export async function GET(request: NextRequest) {
  try {
    const { scope, ctx } = await deskAdminRequest(prisma, request, 'SUPER_ADMIN');
    return NextResponse.json(await listPositions(prisma, scope, ctx));
  } catch (err) {
    return deskAccessResponse(err);
  }
}

/** Body: { name, description?, department, reach, permissions, reportsToId? }. */
export async function POST(request: NextRequest) {
  try {
    const { scope, ctx } = await deskAdminRequest(prisma, request, 'SUPER_ADMIN');
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new DeskAccessError(400, 'Invalid request.');
    return NextResponse.json(await createPosition(prisma, scope, body, ctx), { status: 201 });
  } catch (err) {
    return deskAccessResponse(err);
  }
}
