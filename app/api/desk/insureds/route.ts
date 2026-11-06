import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { deskAccessResponse, DeskAccessError } from '@/lib/desk/access';
import { deskUserRequest } from '@/lib/desk/admin-api';
import { createInsured, listInsureds } from '@/lib/desk/book';

/** ?q= &status=ACTIVE|INACTIVE &mine=1 &agencyId= &page= &pageSize= */
export async function GET(request: NextRequest) {
  try {
    const { scope } = await deskUserRequest(prisma, request);
    const p = request.nextUrl.searchParams;
    const status = p.get('status');
    return NextResponse.json(await listInsureds(prisma, scope, {
      q: p.get('q') ?? undefined,
      status: status === 'ACTIVE' || status === 'INACTIVE' ? status : undefined,
      mine: p.get('mine') === '1',
      agencyId: p.get('agencyId') ?? undefined,
      page: Number(p.get('page')) || 1,
      pageSize: Number(p.get('pageSize')) || 25,
    }));
  } catch (err) {
    return deskAccessResponse(err);
  }
}

export async function POST(request: NextRequest) {
  try {
    const { scope, ctx } = await deskUserRequest(prisma, request);
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new DeskAccessError(400, 'Invalid request.');
    return NextResponse.json(await createInsured(prisma, scope, body, ctx), { status: 201 });
  } catch (err) {
    return deskAccessResponse(err);
  }
}
