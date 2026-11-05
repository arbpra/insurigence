import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { deskAccessResponse, DeskAccessError } from '@/lib/desk/access';
import { deskAdminRequest } from '@/lib/desk/admin-api';
import { createPod, listPods } from '@/lib/desk/pod-admin';

export async function GET(request: NextRequest) {
  try {
    const { scope } = await deskAdminRequest(prisma, request);
    return NextResponse.json(await listPods(prisma, scope));
  } catch (err) {
    return deskAccessResponse(err);
  }
}

export async function POST(request: NextRequest) {
  try {
    const { scope, ctx } = await deskAdminRequest(prisma, request);
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new DeskAccessError(400, 'Invalid request.');
    return NextResponse.json(await createPod(prisma, scope, body, ctx), { status: 201 });
  } catch (err) {
    return deskAccessResponse(err);
  }
}
