import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { deskAccessResponse } from '@/lib/desk/access';
import { deskUserRequest } from '@/lib/desk/admin-api';
import { queueOptions } from '@/lib/desk/task-queue';

/** For the Pod queue and My tasks: the pods and agencies to filter by, and how much is waiting. Staff only. */
export async function GET(request: NextRequest) {
  try {
    const { scope, ctx } = await deskUserRequest(prisma, request);
    return NextResponse.json(await queueOptions(prisma, scope, ctx));
  } catch (err) {
    return deskAccessResponse(err);
  }
}
