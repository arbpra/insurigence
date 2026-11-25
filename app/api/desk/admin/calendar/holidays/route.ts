import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { deskAccessResponse, DeskAccessError } from '@/lib/desk/access';
import { deskAdminRequest } from '@/lib/desk/admin-api';
import { addHoliday, removeHoliday } from '@/lib/desk/calendar-admin';

/** Body: { date: 'YYYY-MM-DD', name } */
export async function POST(request: NextRequest) {
  try {
    const { scope, ctx } = await deskAdminRequest(prisma, request, ['settings.operations']);
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new DeskAccessError(400, 'Invalid request.');
    return NextResponse.json(await addHoliday(prisma, scope, body, ctx), { status: 201 });
  } catch (err) {
    return deskAccessResponse(err);
  }
}

/** ?id= */
export async function DELETE(request: NextRequest) {
  try {
    const { scope, ctx } = await deskAdminRequest(prisma, request, ['settings.operations']);
    await removeHoliday(prisma, scope, request.nextUrl.searchParams.get('id'), ctx);
    return NextResponse.json({ success: true });
  } catch (err) {
    return deskAccessResponse(err);
  }
}
