import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { deskAccessResponse } from '@/lib/desk/access';
import { deskUserRequest } from '@/lib/desk/admin-api';
import { agencyTracker } from '@/lib/desk/agency-tracker';

/** Agency users only: requests counted by simplified status, and what is waiting on the agency. */
export async function GET(request: NextRequest) {
  try {
    const { scope, ctx } = await deskUserRequest(prisma, request);
    return NextResponse.json(await agencyTracker(prisma, scope, ctx));
  } catch (err) {
    return deskAccessResponse(err);
  }
}
