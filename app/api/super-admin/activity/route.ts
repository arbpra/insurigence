import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { validateSuperAdmin } from '@/lib/super-admin-auth';

export async function GET(request: NextRequest) {
  const auth = await validateSuperAdmin(request);
  if (!auth.valid) return auth.response!;

  try {
    const { searchParams } = new URL(request.url);
    const range = searchParams.get('range') || '7d';
    const eventType = searchParams.get('eventType');
    const agencyId = searchParams.get('agencyId');
    const userId = searchParams.get('userId');
    const limit = parseInt(searchParams.get('limit') || '100', 10);

    const now = new Date();
    let startDate: Date;

    switch (range) {
      case '24h':
        startDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        break;
      case '7d':
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case '30d':
        startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        break;
      default:
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const where: any = {
      createdAt: { gte: startDate },
    };

    if (eventType) {
      where.eventType = eventType;
    }

    if (agencyId) {
      where.agencyId = agencyId;
    }

    if (userId) {
      where.userId = userId;
    }

    const events = await prisma.activityEvent.findMany({
      where,
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: {
        user: {
          select: {
            firstName: true,
            lastName: true,
            email: true,
          },
        },
      },
    });

    const countsByType = await prisma.activityEvent.groupBy({
      by: ['eventType'],
      where: {
        createdAt: { gte: startDate },
      },
      _count: {
        id: true,
      },
    });

    const agencies = await prisma.agency.findMany({
      select: { id: true, name: true },
    });

    const agencyMap = Object.fromEntries(agencies.map((a) => [a.id, a.name]));

    const formattedEvents = events.map((event) => ({
      id: event.id,
      eventType: event.eventType,
      agencyId: event.agencyId,
      agencyName: event.agencyId ? agencyMap[event.agencyId] || null : null,
      userId: event.userId,
      userName: event.user
        ? `${event.user.firstName || ''} ${event.user.lastName || ''}`.trim() ||
          event.user.email
        : null,
      leadId: event.leadId,
      metadata: event.metadata,
      ipAddress: event.ipAddress,
      createdAt: event.createdAt,
    }));

    const eventTypeSummary = countsByType.reduce(
      (acc, item) => {
        acc[item.eventType] = item._count.id;
        return acc;
      },
      {} as Record<string, number>
    );

    return NextResponse.json({
      events: formattedEvents,
      summary: eventTypeSummary,
      totalEvents: events.length,
      range,
    });
  } catch (error) {
    console.error('Error fetching activity:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
