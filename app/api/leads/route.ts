import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getAuthContext } from '@/lib/super-admin-auth';

export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthContext(request);
    if (!auth.valid || !auth.user) return auth.response!;

    const user = auth.user;
    
    let agencyId: string | undefined;
    if (user.role === 'SUPER_ADMIN') {
      const agencyIdParam = request.nextUrl.searchParams.get('agencyId');
      agencyId = agencyIdParam || undefined;
    } else {
      if (!user.agencyId) {
        return NextResponse.json({ error: 'No agency assigned' }, { status: 403 });
      }
      agencyId = user.agencyId;
    }

    const showArchived = request.nextUrl.searchParams.get('archived') === 'true';
    // A lead is "active" when archivedAt is null OR unset. Legacy leads created
    // before this field existed have it unset, so both must be matched — Prisma's
    // MongoDB connector treats null and unset as distinct.
    const whereClause = {
      ...(agencyId ? { agencyId } : {}),
      ...(showArchived
        ? { archivedAt: { not: null } }
        : { OR: [{ archivedAt: null }, { archivedAt: { isSet: false } }] }),
    };

    const leads = await prisma.lead.findMany({
      where: whereClause,
      orderBy: { createdAt: 'desc' },
      include: {
        intakeSubmission: true,
        carrierFits: {
          include: { carrier: true },
          orderBy: { score: 'desc' },
          take: 2,
        },
        proposals: {
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const totalLeads = leads.length;
    const pendingReview = leads.filter(l => l.status === 'NEW' || l.status === 'WAITING_ON_INFO').length;
    const converted = leads.filter(l => l.status === 'BOUND').length;
    const thisMonth = leads.filter(l => new Date(l.createdAt) >= startOfMonth).length;
    const evaluated = leads.filter(l => l.marketClassification !== null).length;
    const standardCount = leads.filter(l => l.marketClassification === 'STANDARD').length;
    const esCount = leads.filter(l => l.marketClassification === 'EXCESS_SURPLUS').length;
    const borderlineCount = leads.filter(l => l.marketClassification === 'BORDERLINE').length;

    return NextResponse.json({
      leads,
      stats: {
        totalLeads,
        pendingReview,
        converted,
        thisMonth,
        evaluated,
        standardCount,
        esCount,
        borderlineCount,
      },
    });
  } catch (error) {
    console.error('Error fetching leads:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
