import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { deskAccessResponse, DeskAccessError } from '@/lib/desk/access';
import { deskUserRequest } from '@/lib/desk/admin-api';
import { listTasks, submitTask } from '@/lib/desk/task-api';

/**
 * ?q= &status= &type= &priority= (comma-separated) &insuredId= &open=1 &mine=1 &page= &pageSize= &sort=(newest|completed)
 * Staff also: &agencyId= &podId=(id|none) &assignee=(id|me|none) &overdue=1 &escalated=1 &sort=(also activity|due)
 */
export async function GET(request: NextRequest) {
  try {
    const { scope } = await deskUserRequest(prisma, request);
    const p = request.nextUrl.searchParams;
    return NextResponse.json(await listTasks(prisma, scope, {
      q: p.get('q'), status: p.get('status'), type: p.get('type'), priority: p.get('priority'), insuredId: p.get('insuredId'),
      open: p.get('open') === '1', mine: p.get('mine') === '1',
      agencyId: p.get('agencyId'), podId: p.get('podId'), assignee: p.get('assignee'), overdue: p.get('overdue') === '1', escalated: p.get('escalated') === '1', sort: p.get('sort'),
      page: Number(p.get('page')) || 1, pageSize: Number(p.get('pageSize')) || 25,
    }));
  } catch (err) {
    return deskAccessResponse(err);
  }
}

/** Body: { type, title, description, priority, complexity, insuredId, policyId, agencyId (staff filing for an agency) } */
export async function POST(request: NextRequest) {
  try {
    const { scope, ctx } = await deskUserRequest(prisma, request);
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new DeskAccessError(400, 'Invalid request.');
    return NextResponse.json(await submitTask(prisma, scope, body, ctx), { status: 201 });
  } catch (err) {
    return deskAccessResponse(err);
  }
}
