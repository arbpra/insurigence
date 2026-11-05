import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { deskAccessResponse, DeskAccessError } from '@/lib/desk/access';
import { deskAdminRequest } from '@/lib/desk/admin-api';
import { addPodMember, removePodMember, updatePod } from '@/lib/desk/pod-admin';

type Context = { params: Promise<{ id: string }> };

/** Body: { action: 'update', name?, description?, isActive? } | { action: 'addMember' | 'removeMember', userId }. */
export async function PATCH(request: NextRequest, { params }: Context) {
  try {
    const { id } = await params;
    const { scope, ctx } = await deskAdminRequest(prisma, request);
    const body = await request.json().catch(() => null);
    switch (body?.action) {
      case 'update':
        await updatePod(prisma, scope, id, body, ctx);
        return NextResponse.json({ success: true });
      case 'addMember':
        await addPodMember(prisma, scope, id, body.userId, ctx);
        return NextResponse.json({ success: true });
      case 'removeMember':
        return NextResponse.json(await removePodMember(prisma, scope, id, body.userId, ctx));
      default:
        throw new DeskAccessError(400, 'Invalid request.');
    }
  } catch (err) {
    return deskAccessResponse(err);
  }
}
