'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useAdminAuth } from './layout';
import { Bell, ChevronDown } from 'lucide-react';
import Logo from '@/app/components/Logo';

interface KPIs {
  totalAgencies: number;
  activeAgencies: number;
  totalUsers: number;
  activeUsersLast7Days: number;
  newLeadsLast30Days: number;
  evaluationsLast30Days: number;
  quotedLeadsLast30Days: number;
  proposalsSentLast30Days: number;
  newLeadsThisWeek: number;
  newLeadsPrevWeek: number;
  awaitingReviewCount: number;
  agenciesOnboardedThisWeek: number;
  proposalsClosedThisWeek: number;
}

interface RecentLead {
  id: string;
  insuredName: string;
  status: string;
  lob: string;
  createdAt: string;
  agentName: string | null;
  coverageTags: string[];
  businessType: string | null;
}

interface ActivityEvent {
  id: string;
  eventType: string;
  userName: string | null;
  entityName: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

const STATUS_CONFIG: Record<string, { label: string; dot: string; bg: string; text: string }> = {
  NEW: { label: 'New', dot: 'bg-gray-400', bg: 'bg-gray-100', text: 'text-gray-600' },
  WAITING_ON_INFO: { label: 'Evaluated', dot: 'bg-blue-400', bg: 'bg-blue-50', text: 'text-blue-600' },
  READY_TO_MARKET: { label: 'Evaluated', dot: 'bg-blue-400', bg: 'bg-blue-50', text: 'text-blue-600' },
  QUOTED: { label: 'Quoted', dot: 'bg-orange-400', bg: 'bg-orange-50', text: 'text-orange-600' },
  PRESENTED: { label: 'Proposal Sent', dot: 'bg-green-400', bg: 'bg-green-50', text: 'text-green-600' },
  BOUND: { label: 'Bound', dot: 'bg-teal-400', bg: 'bg-teal-50', text: 'text-teal-600' },
  LOST: { label: 'Lost', dot: 'bg-red-400', bg: 'bg-red-50', text: 'text-red-500' },
};

const ACTIVITY_LABEL: Record<string, string> = {
  INTAKE_SUBMITTED_INTERNAL: 'Internal intake submitted for',
  INTAKE_SUBMITTED_EXTERNAL: 'External intake submitted for',
  LEAD_EVALUATED: 'Risk evaluation run on',
  PROPOSAL_CREATED: 'Proposal created for',
  PROPOSAL_SHARED: 'Proposal sent to',
  PROPOSAL_VIEWED: 'Proposal viewed for',
  USER_LOGIN: 'New User Login',
  USER_CREATED: 'User created for',
  USER_UPDATED: 'User updated',
  USER_DEACTIVATED: 'User deactivated',
  AGENCY_CREATED: 'Agency created',
  AGENCY_UPDATED: 'Agency updated',
};

function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good Morning';
  if (h < 17) return 'Good Afternoon';
  return 'Good Evening';
}

function formatPageDate() {
  return new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

function formatSubmitted(dateStr: string) {
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  const hrs = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins} minutes ago`;
  if (hrs < 24) return `${hrs} hours ago`;
  if (days === 1) return 'Yesterday';
  return `${days} days ago`;
}

export default function SuperAdminHome() {
  const { logout, authFetch, user } = useAdminAuth();
  const [kpis, setKpis] = useState<KPIs | null>(null);
  const [recentLeads, setRecentLeads] = useState<RecentLead[]>([]);
  const [recentActivity, setRecentActivity] = useState<ActivityEvent[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    authFetch('/api/super-admin/dashboard')
      .then((res) => res.ok ? res.json() : null)
      .then((data) => {
        if (data) {
          setKpis(data.kpis);
          setRecentLeads(data.recentLeads || []);
          setRecentActivity(data.recentActivity || []);
        }
      })
      .finally(() => setIsLoading(false));
  }, [authFetch]);

  const firstName = user?.firstName || 'Admin';
  const lastName = user?.lastName || '';
  const initials = `${firstName[0] || ''}${lastName[0] || ''}`.toUpperCase();

  const weeklyChange = kpis
    ? kpis.newLeadsPrevWeek === 0
      ? kpis.newLeadsThisWeek > 0 ? 100 : 0
      : Math.round(((kpis.newLeadsThisWeek - kpis.newLeadsPrevWeek) / kpis.newLeadsPrevWeek) * 100)
    : 0;

  const statCards = [
    {
      label: 'NEW LEADS',
      value: kpis?.newLeadsLast30Days ?? 0,
      subtext: `${weeklyChange >= 0 ? '↑' : '↓'} ${Math.abs(weeklyChange)}% this week`,
      subtextClass: weeklyChange >= 0 ? 'text-green-600' : 'text-red-500',
    },
    {
      label: 'EVALUATED',
      value: kpis?.evaluationsLast30Days ?? 0,
      subtext: `${kpis?.awaitingReviewCount ?? 0} awaiting review`,
      subtextClass: 'text-gray-400',
    },
    {
      label: 'QUOTED',
      value: kpis?.quotedLeadsLast30Days ?? 0,
      subtext: '',
      subtextClass: 'text-gray-400',
    },
    {
      label: 'PROPOSALS SENT',
      value: kpis?.proposalsSentLast30Days ?? 0,
      subtext: `${kpis?.proposalsClosedThisWeek ?? 0} closed this week`,
      subtextClass: 'text-gray-400',
    },
    {
      label: 'TOTAL AGENCIES',
      value: kpis?.totalAgencies ?? 0,
      subtext: `${kpis?.agenciesOnboardedThisWeek ?? 0} onboarded this week`,
      subtextClass: 'text-[#00e6a7]',
    },
    {
      label: 'ACTIVE AGENCIES',
      value: kpis?.activeAgencies ?? 0,
      subtext: 'Active in last 7 days',
      subtextClass: 'text-gray-400',
    },
    {
      label: 'TOTAL USERS',
      value: kpis?.totalUsers ?? 0,
      subtext: 'Across all agencies',
      subtextClass: 'text-gray-400',
    },
    {
      label: 'ACTIVE USERS',
      value: kpis?.activeUsersLast7Days ?? 0,
      subtext: 'Logged in last 7 days',
      subtextClass: 'text-gray-400',
    },
  ];

  return (
    <div className="min-h-screen bg-[#F5F7FA]">
      {/* ── Header ── */}
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-8">
            <Logo size="sm" />
            <nav className="hidden md:flex items-center">
              {[
                { label: 'Overview', href: '/super-admin', active: true },
                { label: 'Leads', href: '/super-admin/agencies' },
                { label: 'Proposals', href: '#' },
                { label: 'Reports', href: '/super-admin/activity' },
                { label: 'Intake', href: '#' },
              ].map((item) => (
                <Link
                  key={item.label}
                  href={item.href}
                  className={`px-4 h-16 flex items-center text-sm font-medium border-b-2 transition-colors ${
                    item.active
                      ? 'border-[#0D2137] text-[#0D2137]'
                      : 'border-transparent text-gray-500 hover:text-gray-800'
                  }`}
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          </div>
          <div className="flex items-center gap-2">
            <button className="p-2 text-gray-400 hover:text-gray-600 rounded-lg">
              <Bell className="w-5 h-5" />
            </button>
            <button
              onClick={logout}
              className="flex items-center gap-1.5 ml-1"
              data-testid="button-logout"
            >
              <div
                className="w-9 h-9 rounded-full border-2 border-[#0D2137] flex items-center justify-center text-xs font-bold text-[#0D2137]"
              >
                {initials || 'SA'}
              </div>
              <ChevronDown className="w-4 h-4 text-gray-400" />
            </button>
          </div>
        </div>
      </header>

      {/* ── Main ── */}
      <main className="max-w-7xl mx-auto px-6 py-8">

        {/* Greeting row */}
        <div className="flex items-start justify-between mb-8">
          <div>
            <p className="text-sm text-gray-400 mb-1">{formatPageDate()}</p>
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-[2rem] font-bold text-[#0D2137] leading-tight">
                {getGreeting()}, {firstName}
              </h1>
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full border border-gray-200 bg-white text-xs font-medium text-gray-600">
                <span className="w-1.5 h-1.5 rounded-full bg-[#00e6a7]" />
                Super Admin
              </span>
            </div>
          </div>
          <div className="hidden md:flex items-center gap-6 pt-3">
            <Link href="/super-admin/agencies" className="text-sm text-gray-500 hover:text-[#0D2137] transition-colors">
              Agencies
            </Link>
            <Link href="/super-admin/users" className="text-sm text-gray-500 hover:text-[#0D2137] transition-colors">
              Users
            </Link>
            <Link href="/super-admin/activity" className="text-sm text-gray-500 hover:text-[#0D2137] transition-colors">
              Activity Insights
            </Link>
          </div>
        </div>

        {/* Stat cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3 mb-8">
          {statCards.map((card, i) => (
            <div
              key={i}
              className="bg-white rounded-xl border border-gray-200 p-4"
              data-testid={`kpi-${card.label.toLowerCase().replace(/[^a-z0-9]/g, '-')}`}
            >
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-2 leading-tight">
                {card.label}
              </p>
              <p
                className="text-[2rem] font-light text-[#0D2137] leading-none mb-1.5"
                data-testid={`value-${card.label.toLowerCase().replace(/[^a-z0-9]/g, '-')}`}
              >
                {isLoading ? '—' : card.value}
              </p>
              {card.subtext && (
                <p className={`text-xs leading-tight ${card.subtextClass}`}>{card.subtext}</p>
              )}
            </div>
          ))}
        </div>

        {/* Bottom panels */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

          {/* Recent Leads */}
          <div className="lg:col-span-2 bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="px-6 py-4 flex items-center justify-between border-b border-gray-100">
              <h2 className="text-base font-semibold text-[#0D2137]">Recent Leads</h2>
              <Link
                href="/super-admin/agencies"
                className="text-sm font-medium text-[#00e6a7] hover:opacity-75 transition-opacity"
              >
                View all →
              </Link>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100">
                    {['Business', 'Type', 'Coverage', 'Submitted', 'Agent', 'Status'].map((h) => (
                      <th
                        key={h}
                        className="text-left text-[10px] font-semibold text-[#00e6a7] uppercase tracking-wide px-5 py-3 first:pl-6"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {isLoading ? (
                    <tr>
                      <td colSpan={6} className="px-6 py-10 text-center text-gray-400 text-sm">
                        Loading…
                      </td>
                    </tr>
                  ) : recentLeads.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-6 py-10 text-center text-gray-400 text-sm">
                        No leads found
                      </td>
                    </tr>
                  ) : (
                    recentLeads.map((lead) => {
                      const s = STATUS_CONFIG[lead.status] || {
                        label: lead.status,
                        dot: 'bg-gray-400',
                        bg: 'bg-gray-100',
                        text: 'text-gray-600',
                      };
                      return (
                        <tr key={lead.id} className="hover:bg-gray-50 transition-colors">
                          <td className="pl-6 pr-4 py-3">
                            <p className="font-medium text-[#0D2137]">{lead.insuredName}</p>
                          </td>
                          <td className="px-5 py-3 text-gray-500">{lead.businessType || '—'}</td>
                          <td className="px-5 py-3">
                            <div className="flex gap-1 flex-wrap">
                              {(lead.coverageTags?.length ? lead.coverageTags : ['GL']).map((tag) => (
                                <span
                                  key={tag}
                                  className="px-1.5 py-0.5 bg-gray-100 text-gray-600 text-[11px] rounded font-medium"
                                >
                                  {tag}
                                </span>
                              ))}
                            </div>
                          </td>
                          <td className="px-5 py-3 text-gray-500 whitespace-nowrap">
                            {formatSubmitted(lead.createdAt)}
                          </td>
                          <td className="px-5 py-3 text-gray-500">{lead.agentName || '—'}</td>
                          <td className="px-5 py-3">
                            <span
                              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${s.bg} ${s.text}`}
                            >
                              <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />
                              {s.label}
                            </span>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Recent Activity */}
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100">
              <h2 className="text-base font-semibold text-[#0D2137]">Recent Activity</h2>
            </div>
            <div className="divide-y divide-gray-100 max-h-[540px] overflow-y-auto">
              {isLoading ? (
                <div className="px-6 py-10 text-center text-gray-400 text-sm">Loading…</div>
              ) : recentActivity.length === 0 ? (
                <div className="px-6 py-10 text-center text-gray-400 text-sm">No recent activity</div>
              ) : (
                recentActivity.slice(0, 12).map((event) => (
                  <div key={event.id} className="px-4 py-4 flex items-start gap-3 hover:bg-gray-50 transition-colors">
                    <div className="w-9 h-9 rounded-full bg-gray-100 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-gray-400 leading-snug">
                        {ACTIVITY_LABEL[event.eventType] || event.eventType.replace(/_/g, ' ')}
                      </p>
                      <p className="text-sm font-semibold text-[#0D2137] truncate leading-snug mt-0.5">
                        {event.entityName ||
                          (event.metadata?.insuredName as string) ||
                          (event.metadata?.agencyName as string) ||
                          'Unknown'}
                      </p>
                      <p className="text-xs text-gray-400 mt-1">
                        {timeAgo(event.createdAt)}
                        {event.userName ? ` · ${event.userName}` : ''}
                      </p>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

        </div>
      </main>
    </div>
  );
}
