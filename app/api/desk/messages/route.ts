import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { deskAccessResponse } from '@/lib/desk/access';
import { deskUserRequest } from '@/lib/desk/admin-api';
import { messageInbox } from '@/lib/desk/messages';

/** The conversations this person takes part in, with unread counts, and the latest conversations on requests. */
export async function GET(request: NextRequest) {
  try {
    const { scope, ctx } = await deskUserRequest(prisma, request);
    return NextResponse.json(await messageInbox(prisma, scope, ctx));
  } catch (err) {
    return deskAccessResponse(err);
  }
}
