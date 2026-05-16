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
  NEW: { label: 'New', dot: 'bg-white', bg: 'bg-green-100', text: 'text-white' },
  WAITING_ON_INFO: { label: 'Evaluated', dot: 'bg-white', bg: 'bg-blue-50', text: 'text-blue-600' },
  READY_TO_MARKET: { label: 'Evaluated', dot: 'bg-white', bg: 'bg-blue-50', text: 'text-blue-600' },
  QUOTED: { label: 'Quoted', dot: 'bg-white', bg: 'bg-orange-50', text: 'text-orange-600' },
  PRESENTED: { label: 'Proposal Sent', dot: 'bg-white', bg: 'bg-green-50', text: 'text-green-600' },
  BOUND: { label: 'Bound', dot: 'bg-white', bg: 'bg-teal-50', text: 'text-teal-600' },
  LOST: { label: 'Lost', dot: 'bg-white', bg: 'bg-red-50', text: 'text-red-500' },
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
      borderClass: '#185FA5',
    },
    {
      label: 'EVALUATED',
      value: kpis?.evaluationsLast30Days ?? 0,
      subtext: `${kpis?.awaitingReviewCount ?? 0} awaiting review`,
      subtextClass: 'text-gray-400',
      borderClass: '#1D9E75',
    },
    {
      label: 'QUOTED',
      value: kpis?.quotedLeadsLast30Days ?? 0,
      subtext: '',
      subtextClass: 'text-gray-400',
      borderClass: '#D85A30',
    },
    {
      label: 'PROPOSALS SENT',
      value: kpis?.proposalsSentLast30Days ?? 0,
      subtext: `${kpis?.proposalsClosedThisWeek ?? 0} closed this week`,
      subtextClass: 'text-gray-400',
      borderClass: '#00E9B0',
    },
    {
      label: 'TOTAL AGENCIES',
      value: kpis?.totalAgencies ?? 0,
      subtext: `${kpis?.agenciesOnboardedThisWeek ?? 0} onboarded this week`,
      subtextClass: 'text-[#00e6a7]',
      borderClass: '#FF6B6B',
    },
    {
      label: 'ACTIVE AGENCIES',
      value: kpis?.activeAgencies ?? 0,
      subtext: 'Active in last 7 days',
      subtextClass: 'text-gray-400',
      borderClass: '#185FA5',
    },
    {
      label: 'TOTAL USERS',
      value: kpis?.totalUsers ?? 0,
      subtext: 'Across all agencies',
      subtextClass: 'text-gray-400',
      borderClass: '#1D9E75',
    },
    {
      label: 'ACTIVE USERS',
      value: kpis?.activeUsersLast7Days ?? 0,
      subtext: 'Logged in last 7 days',
      subtextClass: 'text-gray-400',
      borderClass: '#D85A30',
    },
  ];

  return (
    <div className="min-h-screen bg-[#F5F7FA]">
      {/* ── Header ── */}
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-start justify-between gap-4">
          <div>
            <p className="text-sm text-600 mb-1">{formatPageDate()}</p>
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-2xl font-bold text-[#0D2137] leading-tight">
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
      </header>

      {/* ── Main ── */}

      <main className="max-w-7xl mx-auto px-6 py-8">

        {/* Stat cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-16 gap-3 mb-8">
          {statCards.map((card, i) => (
            <div
              key={i}
              className="bg-white rounded-xl border-gray-200 p-4"
              data-testid={`kpi-${card.label.toLowerCase().replace(/[^a-z0-9]/g, '-')}`}
              style={{ borderTop: `4px solid ${card.borderClass}`, borderBottom: '1px solid #dee2e6', borderLeft: '1px solid #dee2e6', borderRight: '1px solid #dee2e6'}}
            >
              <p className="text-xs uppercase text-gray-600 font-bold mb-2" >
                {card.label}
              </p>
              <p
                className="text-[2rem] font-medium text-[#0D2137] leading-none mb-2"
                data-testid={`value-${card.label.toLowerCase().replace(/[^a-z0-9]/g, '-')}`}
                style={{color:`${card.borderClass}`}}
              >
                {isLoading ? '—' : card.value}
              </p>
              {card.subtext && (
                <p className={`text-2xs leading-tight ${card.subtextClass}`}>{card.subtext}</p>
              )}
            </div>
          ))}
        </div>

        {/* Bottom panels */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

          {/* Recent Leads */}
          <div className="lg:col-span-2 bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="px-6 py-4 flex items-center justify-between border-b border-gray-100">
              <h2 className="text-xl font-semibold text-[#07496C]" style={{ margin: '0px' }}>Recent Leads</h2>
              <Link
                href="/super-admin/agencies"
                className="text-2sm font-medium text-[#1D9E75] hover:opacity-75 transition-opacity"
              >
                View all →
              </Link>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200" style={{ backgroundColor: 'rgb(92, 104, 124)' }}>
                    {['Business', 'Type', 'Coverage', 'Submitted', 'Agent', 'Status'].map((h) => (
                      <th
                        key={h}
                        className="text-center text-xs font-medium uppercase px-6 py-3" style={{ color: '#fff' }}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
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
                        dot: 'bg-white',
                        bg: 'bg-gray-100',
                        text: 'text-white',
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
                                  className="px-1.5 py-0.5 bg-gray-100 text-white text-[11px] rounded font-medium"
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
              <h2 className="text-xl font-semibold text-[#07496C]" style={{ margin: '0px' }}>Recent Activity</h2>
            </div>
            <div className="divide-y divide-gray-200 max-h-[540px] overflow-y-auto">
              {isLoading ? (
                <div className="px-6 py-10 text-center text-gray-400 text-sm">Loading…</div>
              ) : recentActivity.length === 0 ? (
                <div className="px-6 py-10 text-center text-gray-400 text-sm">No recent activity</div>
              ) : (
                recentActivity.slice(0, 12).map((event) => (
                  <div key={event.id} className="px-4 py-4 flex items-start gap-3 hover:bg-gray-50 transition-colors">
                    <div className="w-9 h-9 rounded-full bg-green-600 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-400 leading-snug">
                        {ACTIVITY_LABEL[event.eventType] || event.eventType.replace(/_/g, ' ')}
                      </p>
                      <p className="text-sm font-semibold text-[#0D2137] truncate leading-snug mt-0.5">
                        {event.entityName ||
                          (event.metadata?.insuredName as string) ||
                          (event.metadata?.agencyName as string) ||
                          'Unknown'}
                      </p>
                      <p className="text-xs text-400 mt-1">
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
