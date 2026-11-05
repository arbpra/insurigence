import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { deskAccessResponse } from '@/lib/desk/access';
import { deskAdminRequest } from '@/lib/desk/admin-api';
import { listDeskAgencies } from '@/lib/desk/agency-setup';

export async function GET(request: NextRequest) {
  try {
    const { scope } = await deskAdminRequest(prisma, request);
    const params = request.nextUrl.searchParams;
    const desk = params.get('desk');
    const agencies = await listDeskAgencies(prisma, scope, {
      q: params.get('q') ?? undefined,
      desk: desk === 'on' || desk === 'off' ? desk : undefined,
    });
    return NextResponse.json({ agencies });
  } catch (err) {
    return deskAccessResponse(err);
  }
}
