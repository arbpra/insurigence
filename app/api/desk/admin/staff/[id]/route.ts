import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { deskAccessResponse, DeskAccessError } from '@/lib/desk/access';
import { deskAdminRequest } from '@/lib/desk/admin-api';
import { deactivateStaff, reactivateStaff, renameStaff, resendStaffInvite } from '@/lib/desk/staff';

type Context = { params: Promise<{ id: string }> };

/** Body: { action: 'rename', firstName, lastName } | { action: 'resend' | 'deactivate' | 'reactivate' }. */
export async function PATCH(request: NextRequest, { params }: Context) {
  try {
    const { id } = await params;
    const { scope, ctx } = await deskAdminRequest(prisma, request, ['staff.manage']);
    const body = await request.json().catch(() => null);
    switch (body?.action) {
      case 'rename':
        await renameStaff(prisma, scope, id, body, ctx);
        return NextResponse.json({ success: true });
      case 'resend':
        return NextResponse.json(await resendStaffInvite(prisma, scope, id, ctx));
      case 'deactivate':
        return NextResponse.json(await deactivateStaff(prisma, scope, id, ctx));
      case 'reactivate':
        await reactivateStaff(prisma, scope, id, ctx);
        return NextResponse.json({ success: true });
      default:
        throw new DeskAccessError(400, 'Invalid request.');
    }
  } catch (err) {
    return deskAccessResponse(err);
  }
}
