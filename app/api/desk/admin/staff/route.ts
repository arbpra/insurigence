import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { deskAccessResponse, DeskAccessError } from '@/lib/desk/access';
import { deskAdminRequest } from '@/lib/desk/admin-api';
import { invitableRoles, inviteStaff, listStaff } from '@/lib/desk/staff';

export async function GET(request: NextRequest) {
  try {
    const { scope } = await deskAdminRequest(prisma, request, ['staff.manage']);
    const params = request.nextUrl.searchParams;
    const status = params.get('status');
    const staff = await listStaff(prisma, scope, {
      q: params.get('q') ?? undefined,
      role: params.get('role') ?? undefined,
      status: status === 'active' || status === 'inactive' ? status : undefined,
    });
    return NextResponse.json({ staff, inviteRoles: await invitableRoles(prisma, scope) });
  } catch (err) {
    return deskAccessResponse(err);
  }
}

export async function POST(request: NextRequest) {
  try {
    const { scope, ctx } = await deskAdminRequest(prisma, request, ['staff.manage']);
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new DeskAccessError(400, 'Invalid request.');
    return NextResponse.json(await inviteStaff(prisma, scope, body, ctx), { status: 201 });
  } catch (err) {
    return deskAccessResponse(err);
  }
}
