import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { deskAccessResponse, DeskAccessError } from '@/lib/desk/access';
import { deskAdminRequest } from '@/lib/desk/admin-api';
import { getFollowUpSetup, saveFollowUpRule, setFollowUpRuleActive } from '@/lib/desk/follow-up-admin';

const body = async (request: NextRequest) => {
  const data = await request.json().catch(() => null);
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new DeskAccessError(400, 'Invalid request.');
  return data as Record<string, unknown>;
};

export async function GET(request: NextRequest) {
  try {
    const { scope } = await deskAdminRequest(prisma, request, ['settings.operations']);
    return NextResponse.json(await getFollowUpSetup(prisma, scope));
  } catch (err) {
    return deskAccessResponse(err);
  }
}

/** Body: { triggerType, createType, podId | null, titleTemplate, billable }, or { id, podId, titleTemplate, billable } to edit. */
export async function POST(request: NextRequest) {
  try {
    const { scope, ctx } = await deskAdminRequest(prisma, request, ['settings.operations']);
    return NextResponse.json(await saveFollowUpRule(prisma, scope, await body(request), ctx));
  } catch (err) {
    return deskAccessResponse(err);
  }
}

/** Body: { id, isActive } switches a rule off or on. */
export async function PATCH(request: NextRequest) {
  try {
    const { scope, ctx } = await deskAdminRequest(prisma, request, ['settings.operations']);
    const { id, isActive } = await body(request);
    await setFollowUpRuleActive(prisma, scope, id, isActive, ctx);
    return NextResponse.json({ success: true });
  } catch (err) {
    return deskAccessResponse(err);
  }
}
