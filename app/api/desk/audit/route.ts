import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { deskAccessResponse } from '@/lib/desk/access';
import { deskAdminRequest } from '@/lib/desk/admin-api';
import { auditFilters, exportAudit, listAudit } from '@/lib/desk/audit-log';

/**
 * Operations Managers and the Super Admin only. Reading or exporting is logged.
 * ?action= &agencyId= &actor= &entityType= &entityId= &from= &to= (YYYY-MM-DD) &page= ; &format=csv to download.
 */
export async function GET(request: NextRequest) {
  try {
    const { scope, ctx } = await deskAdminRequest(prisma, request);
    const p = request.nextUrl.searchParams;
    const filters = auditFilters(p);
    if (p.get('format') === 'csv') {
      const { csv } = await exportAudit(prisma, scope, filters, ctx);
      return new NextResponse(csv, {
        headers: {
          'content-type': 'text/csv; charset=utf-8',
          'content-disposition': `attachment; filename="desk-audit-${new Date().toISOString().slice(0, 10)}.csv"`,
          'cache-control': 'no-store',
        },
      });
    }
    return NextResponse.json(await listAudit(prisma, scope, filters, ctx));
  } catch (err) {
    return deskAccessResponse(err);
  }
}
