import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { validateSuperAdmin } from '@/lib/super-admin-auth';

function computeHealthBadge(
  lastActivityAt: Date | null,
  evaluationsLast14Days: number,
  loginsLast30Days: number
): 'green' | 'yellow' | 'red' {
  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

  if (!lastActivityAt || loginsLast30Days === 0) {
    return 'red';
  }

  if (lastActivityAt < fourteenDaysAgo) {
    return 'red';
  }

  if (lastActivityAt >= sevenDaysAgo && evaluationsLast14Days >= 2) {
    return 'green';
  }

  return 'yellow';
}

export async function GET(request: NextRequest) {
  const auth = await validateSuperAdmin(request);
  if (!auth.valid) return auth.response!;

  try {
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

    const agencies = await prisma.agency.findMany({
      include: {
        _count: {
          select: {
            leads: true,
            users: true,
            carriers: true,
            intakeForms: true,
            proposals: true,
          },
        },
        users: {
          select: {
            id: true,
            lastLoginAt: true,
            lastActivityAt: true,
          },
        },
      },
    });

    const allUsers = await prisma.user.findMany({
      select: {
        id: true,
        role: true,
        isActive: true,
        lastLoginAt: true,
        lastActivityAt: true,
        agencyId: true,
      },
    });

    const leadsLast30Days = await prisma.lead.count({
      where: { createdAt: { gte: thirtyDaysAgo } },
    });

    const evaluationsLast30Days = await prisma.activityEvent.count({
      where: {
        eventType: 'LEAD_EVALUATED',
        createdAt: { gte: thirtyDaysAgo },
      },
    });

    const proposalsLast30Days = await prisma.proposal.count({
      where: { createdAt: { gte: thirtyDaysAgo } },
    });

    const recentActivity = await prisma.activityEvent.findMany({
      take: 25,
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

    const activeUsers = allUsers.filter(
      (u) => u.isActive && u.lastActivityAt && u.lastActivityAt >= sevenDaysAgo
    );

    const agencyHealthPromises = agencies.map(async (agency) => {
      const intakesLast30Days = await prisma.lead.count({
        where: {
          agencyId: agency.id,
          createdAt: { gte: thirtyDaysAgo },
        },
      });

      const evaluationsLast14Days = await prisma.activityEvent.count({
        where: {
          agencyId: agency.id,
          eventType: 'LEAD_EVALUATED',
          createdAt: { gte: fourteenDaysAgo },
        },
      });

      const agencyProposalsLast30Days = await prisma.proposal.count({
        where: {
          agencyId: agency.id,
          createdAt: { gte: thirtyDaysAgo },
        },
      });

      const lastActivityEvent = await prisma.activityEvent.findFirst({
        where: { agencyId: agency.id },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      });

      const activeUsersLast7Days = await prisma.user.count({
        where: {
          agencyId: agency.id,
          isActive: true,
          lastActivityAt: { gte: sevenDaysAgo },
        },
      });

      const loginsLast30Days = agency.users.filter(
        (u) => u.lastLoginAt && u.lastLoginAt >= thirtyDaysAgo
      ).length;

      const healthBadge = computeHealthBadge(
        lastActivityEvent?.createdAt || null,
        evaluationsLast14Days,
        loginsLast30Days
      );

      return {
        id: agency.id,
        name: agency.name,
        status: agency.status,
        subscriptionTier: agency.subscriptionTier,
        lastActivityAt: lastActivityEvent?.createdAt || null,
        activeUsersLast7Days,
        intakesLast30Days,
        evaluationsLast30Days: evaluationsLast14Days,
        proposalsLast30Days: agencyProposalsLast30Days,
        healthBadge,
        totalUsers: agency._count.users,
        totalLeads: agency._count.leads,
      };
    });

    const agencyHealth = await Promise.all(agencyHealthPromises);

    const kpis = {
      totalAgencies: agencies.length,
      activeAgencies: agencies.filter((a) => a.status === 'ACTIVE').length,
      totalUsers: allUsers.length,
      activeUsersLast7Days: activeUsers.length,
      leadsLast30Days,
      evaluationsLast30Days,
      proposalsLast30Days,
    };

    const formattedActivity = recentActivity.map((event) => ({
      id: event.id,
      eventType: event.eventType,
      agencyId: event.agencyId,
      userId: event.userId,
      leadId: event.leadId,
      userName: event.user
        ? `${event.user.firstName || ''} ${event.user.lastName || ''}`.trim() ||
          event.user.email
        : null,
      metadata: event.metadata,
      createdAt: event.createdAt,
    }));

    return NextResponse.json({
      kpis,
      agencyHealth: agencyHealth.sort((a, b) => {
        const order = { red: 0, yellow: 1, green: 2 };
        return order[a.healthBadge] - order[b.healthBadge];
      }),
      recentActivity: formattedActivity,
    });
  } catch (error) {
    console.error('Error fetching super admin dashboard:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
