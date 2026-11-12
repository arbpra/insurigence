import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { deskAccessResponse } from '@/lib/desk/access';
import { deskUserRequest } from '@/lib/desk/admin-api';
import { agencySummary } from '@/lib/desk/agency-view';

type Context = { params: Promise<{ id: string }> };

/** One agency for its Account Manager (or an Operations Manager). Opening it is logged. */
export async function GET(request: NextRequest, { params }: Context) {
  try {
    const { id } = await params;
    const { scope, ctx } = await deskUserRequest(prisma, request);
    return NextResponse.json(await agencySummary(prisma, scope, id, ctx));
  } catch (err) {
    return deskAccessResponse(err);
  }
}
