import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { deskAccessResponse } from '@/lib/desk/access';
import { deskUserRequest } from '@/lib/desk/admin-api';
import { importTemplateCsv } from '@/lib/desk/import-plan';
import { importAgency } from '@/lib/desk/imports';

/** A blank starting file. Insurigence admins name the agency with ?agencyId, as for an upload. */
export async function GET(request: NextRequest) {
  try {
    const { scope, ctx } = await deskUserRequest(prisma, request);
    await importAgency(prisma, scope, request.nextUrl.searchParams.get('agencyId'), ctx);
    return new NextResponse(importTemplateCsv(), {
      headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="the-desk-import-template.csv"', 'Cache-Control': 'no-store' },
    });
  } catch (err) {
    return deskAccessResponse(err);
  }
}
