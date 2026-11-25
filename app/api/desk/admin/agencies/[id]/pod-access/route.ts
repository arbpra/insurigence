import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { deskAccessResponse, DeskAccessError } from '@/lib/desk/access';
import { deskAdminRequest } from '@/lib/desk/admin-api';
import { getAgencyPodAccess, setAgencyPodAccess } from '@/lib/desk/pod-admin';

type Context = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: Context) {
  try {
    const { id } = await params;
    const { scope } = await deskAdminRequest(prisma, request, ['agencies.setup', 'pods.manage'], id);
    return NextResponse.json(await getAgencyPodAccess(prisma, scope, id));
  } catch (err) {
    return deskAccessResponse(err);
  }
}

/** Body: { podId, mode: 'NONE' | 'WHOLE' | 'NAMED', userIds? }. */
export async function PUT(request: NextRequest, { params }: Context) {
  try {
    const { id } = await params;
    const { scope, ctx } = await deskAdminRequest(prisma, request, ['agencies.setup'], id);
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new DeskAccessError(400, 'Invalid request.');
    return NextResponse.json(await setAgencyPodAccess(prisma, scope, id, body, ctx));
  } catch (err) {
    return deskAccessResponse(err);
  }
}
