import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { deskAccessResponse, DeskAccessError } from '@/lib/desk/access';
import { deskAdminRequest } from '@/lib/desk/admin-api';
import { getCalendarSetup, saveCalendar } from '@/lib/desk/calendar-admin';

export async function GET(request: NextRequest) {
  try {
    const { scope } = await deskAdminRequest(prisma, request);
    return NextResponse.json(await getCalendarSetup(prisma, scope));
  } catch (err) {
    return deskAccessResponse(err);
  }
}

/** Body: { version?, timeZone, workDays, dayStartMinute, dayEndMinute } */
export async function PUT(request: NextRequest) {
  try {
    const { scope, ctx } = await deskAdminRequest(prisma, request);
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new DeskAccessError(400, 'Invalid request.');
    const changed = await saveCalendar(prisma, scope, body, ctx);
    return NextResponse.json({ changed, setup: await getCalendarSetup(prisma, scope) });
  } catch (err) {
    return deskAccessResponse(err);
  }
}
