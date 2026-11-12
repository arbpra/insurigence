import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { deskAccessResponse } from '@/lib/desk/access';
import { deskUserRequest } from '@/lib/desk/admin-api';
import { managedAgencies } from '@/lib/desk/agency-view';

/** Account and Operations Managers: the agencies they look after, with their work at a glance. */
export async function GET(request: NextRequest) {
  try {
    const { scope, ctx } = await deskUserRequest(prisma, request);
    return NextResponse.json(await managedAgencies(prisma, scope, ctx));
  } catch (err) {
    return deskAccessResponse(err);
  }
}
