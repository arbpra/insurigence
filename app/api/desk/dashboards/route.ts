import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { deskAccessResponse } from '@/lib/desk/access';
import { deskAdminRequest } from '@/lib/desk/admin-api';
import { dashboardOptions, getDashboards } from '@/lib/desk/dashboards';

/**
 * The department dashboards (Module 52): Virtual Operations, Agency Operations, or both for the COO.
 * Pod Leaders for the pods they lead; a Senior AM for the agencies in their reach. ?days=7|30|90|365 (default 30)
 */
export async function GET(request: NextRequest) {
  try {
    const { scope, ctx } = await deskAdminRequest(prisma, request, ['dashboard.virtual_ops', 'dashboard.agency_ops'], undefined, { podLeads: true });
    const opts = dashboardOptions({ days: request.nextUrl.searchParams.get('days') });
    return NextResponse.json(await getDashboards(prisma, scope, opts, ctx));
  } catch (err) {
    return deskAccessResponse(err);
  }
}
