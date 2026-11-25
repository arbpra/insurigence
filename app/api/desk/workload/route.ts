import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { deskAccessResponse } from '@/lib/desk/access';
import { deskAdminRequest } from '@/lib/desk/admin-api';
import { getWorkload } from '@/lib/desk/workload';

/**
 * Operations Managers and the Super Admin only. The counts, and one page of tasks:
 * ?q= &status= &type= &priority= &agencyId= &podId=(id|none) &assignee=(id|none) &overdue=1 &escalated=1 &open=1 &sort= &page=
 */
export async function GET(request: NextRequest) {
  try {
    const { scope } = await deskAdminRequest(prisma, request, ['workload.view']);
    const p = request.nextUrl.searchParams;
    return NextResponse.json(await getWorkload(prisma, scope, {
      q: p.get('q'), status: p.get('status'), type: p.get('type'), priority: p.get('priority'),
      agencyId: p.get('agencyId'), podId: p.get('podId'), assignee: p.get('assignee'),
      overdue: p.get('overdue') === '1', escalated: p.get('escalated') === '1', open: p.get('open') === '1',
      sort: p.get('sort'), page: Number(p.get('page')) || 1, pageSize: 50,
    }));
  } catch (err) {
    return deskAccessResponse(err);
  }
}
