import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { deskAccessResponse, DeskAccessError } from '@/lib/desk/access';
import { deskAdminRequest } from '@/lib/desk/admin-api';
import { GRANTABLE_SENSITIVITIES, listVaPermissions, setVaPermissions } from '@/lib/desk/pod-admin';

export async function GET(request: NextRequest) {
  try {
    const { scope } = await deskAdminRequest(prisma, request, ['documents.grant']);
    return NextResponse.json({ vas: await listVaPermissions(prisma, scope), grantable: GRANTABLE_SENSITIVITIES });
  } catch (err) {
    return deskAccessResponse(err);
  }
}

/** Body: { userId, granted: DocumentSensitivity[] } */
export async function PUT(request: NextRequest) {
  try {
    const { scope, ctx } = await deskAdminRequest(prisma, request, ['documents.grant']);
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object' || typeof body.userId !== 'string') throw new DeskAccessError(400, 'Invalid request.');
    await setVaPermissions(prisma, scope, body.userId, body.granted, ctx);
    return NextResponse.json({ success: true });
  } catch (err) {
    return deskAccessResponse(err);
  }
}
