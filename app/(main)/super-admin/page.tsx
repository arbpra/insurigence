'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useAdminAuth } from './layout';
import { 
  Building2, Users, FileText, TrendingUp, LogOut, Plus, 
  Activity, ChevronRight, AlertCircle, CheckCircle, Clock,
  BarChart3, UserPlus
} from 'lucide-react';

interface KPIs {
  totalAgencies: number;
  activeAgencies: number;
  totalUsers: number;
  activeUsersLast7Days: number;
  leadsLast30Days: number;
  evaluationsLast30Days: number;
  proposalsLast30Days: number;
}

interface AgencyHealth {
  id: string;
  name: string;
  status: string;
  subscriptionTier: string;
  lastActivityAt: string | null;
  activeUsersLast7Days: number;
  intakesLast30Days: number;
  evaluationsLast30Days: number;
  proposalsLast30Days: number;
  healthBadge: 'green' | 'yellow' | 'red';
  totalUsers: number;
  totalLeads: number;
}

interface ActivityEvent {
  id: string;
  eventType: string;
  agencyId: string | null;
  userId: string | null;
  leadId: string | null;
  userName: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

function formatEventType(eventType: string): string {
  const mapping: Record<string, string> = {
    INTAKE_SUBMITTED_INTERNAL: 'Internal Intake',
    INTAKE_SUBMITTED_EXTERNAL: 'External Intake',
    LEAD_EVALUATED: 'Lead Evaluated',
    PROPOSAL_CREATED: 'Proposal Created',
    PROPOSAL_SHARED: 'Proposal Shared',
    PROPOSAL_VIEWED: 'Proposal Viewed',
    USER_LOGIN: 'User Login',
    USER_CREATED: 'User Created',
    USER_UPDATED: 'User Updated',
    USER_DEACTIVATED: 'User Deactivated',
    AGENCY_CREATED: 'Agency Created',
    AGENCY_UPDATED: 'Agency Updated',
  };
  return mapping[eventType] || eventType.replace(/_/g, ' ');
}

function formatTimeAgo(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

function HealthBadge({ badge }: { badge: 'green' | 'yellow' | 'red' }) {
  const config = {
    green: { bg: 'bg-green-100', text: 'text-green-700', icon: CheckCircle, label: 'Healthy' },
    yellow: { bg: 'bg-amber-100', text: 'text-amber-700', icon: AlertCircle, label: 'Attention' },
    red: { bg: 'bg-red-100', text: 'text-red-700', icon: AlertCircle, label: 'At Risk' },
  };
  const { bg, text, icon: Icon, label } = config[badge];
  
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${bg} ${text}`}>
      <Icon className="w-3 h-3" />
      {label}
    </span>
  );
}

export default function SuperAdminHome() {
  const { logout, authFetch } = useAdminAuth();
  const [kpis, setKpis] = useState<KPIs | null>(null);
  const [agencyHealth, setAgencyHealth] = useState<AgencyHealth[]>([]);
  const [recentActivity, setRecentActivity] = useState<ActivityEvent[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchDashboard = async () => {
      try {
        const res = await authFetch('/api/super-admin/dashboard');
        if (res.ok) {
          const data = await res.json();
          setKpis(data.kpis);
          setAgencyHealth(data.agencyHealth);
          setRecentActivity(data.recentActivity);
        }
      } finally {
        setIsLoading(false);
      }
    };
    fetchDashboard();
  }, [authFetch]);

  const kpiCards = [
    { label: 'Total Agencies', value: kpis?.totalAgencies || 0, icon: Building2, color: '#0D2137' },
    { label: 'Active Agencies', value: kpis?.activeAgencies || 0, icon: TrendingUp, color: '#00E6A7' },
    { label: 'Total Users', value: kpis?.totalUsers || 0, icon: Users, color: '#0D2137' },
    { label: 'Active Users (7d)', value: kpis?.activeUsersLast7Days || 0, icon: Users, color: '#00E6A7' },
    { label: 'Leads (30d)', value: kpis?.leadsLast30Days || 0, icon: FileText, color: '#0D2137' },
    { label: 'Evaluations (30d)', value: kpis?.evaluationsLast30Days || 0, icon: BarChart3, color: '#00E6A7' },
    { label: 'Proposals (30d)', value: kpis?.proposalsLast30Days || 0, icon: FileText, color: '#0D2137' },
  ];

  return (
    <div className="min-h-screen" style={{ backgroundColor: '#F5F7FA' }}>
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div 
              className="w-10 h-10 rounded-lg flex items-center justify-center"
              style={{ backgroundColor: '#0D2137' }}
            >
              <Building2 className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold" style={{ color: '#0D2137' }}>Super Admin Console</h1>
              <p className="text-sm text-gray-500">Insurigence Platform Management</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <nav className="hidden md:flex items-center gap-1">
              <Link
                href="/super-admin/agencies"
                className="px-3 py-2 text-sm font-medium text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg"
              >
                Agencies
              </Link>
              <Link
                href="/super-admin/users"
                className="px-3 py-2 text-sm font-medium text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg"
              >
                Users
              </Link>
              <Link
                href="/super-admin/activity"
                className="px-3 py-2 text-sm font-medium text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg"
              >
                Activity
              </Link>
            </nav>
            <button
              onClick={logout}
              className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700 transition-colors"
              data-testid="button-logout"
            >
              <LogOut className="w-4 h-4" />
              Logout
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-8">
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4 mb-8">
          {kpiCards.map((kpi, idx) => (
            <div key={idx} className="bg-white rounded-xl border border-gray-200 p-4" data-testid={`kpi-${kpi.label.toLowerCase().replace(/[^a-z0-9]/g, '-')}`}>
              <div className="flex items-center gap-2 mb-2">
                <kpi.icon className="w-4 h-4" style={{ color: kpi.color }} />
                <span className="text-xs text-gray-500 truncate">{kpi.label}</span>
              </div>
              <p className="text-2xl font-bold" style={{ color: kpi.color }} data-testid={`value-${kpi.label.toLowerCase().replace(/[^a-z0-9]/g, '-')}`}>
                {isLoading ? '...' : kpi.value}
              </p>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap gap-3 mb-8">
          <Link
            href="/super-admin/agencies?create=true"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-white text-sm font-medium"
            style={{ backgroundColor: '#0D2137' }}
            data-testid="button-create-agency"
          >
            <Plus className="w-4 h-4" />
            Create Agency
          </Link>
          <Link
            href="/super-admin/users?create=true"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-white text-sm font-medium"
            style={{ backgroundColor: '#00E6A7' }}
            data-testid="button-add-user"
          >
            <UserPlus className="w-4 h-4" />
            Add User
          </Link>
          <Link
            href="/super-admin/activity"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-300 bg-white text-gray-700 text-sm font-medium hover:bg-gray-50"
            data-testid="button-view-activity"
          >
            <Activity className="w-4 h-4" />
            View All Activity
          </Link>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2">
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
                <h2 className="text-lg font-semibold text-gray-900">Agency Health</h2>
                <Link 
                  href="/super-admin/agencies" 
                  className="text-sm font-medium flex items-center gap-1"
                  style={{ color: '#00E6A7' }}
                >
                  View All
                  <ChevronRight className="w-4 h-4" />
                </Link>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-200">
                      <th className="text-left text-xs font-medium text-gray-500 uppercase px-6 py-3">Agency</th>
                      <th className="text-left text-xs font-medium text-gray-500 uppercase px-4 py-3">Status</th>
                      <th className="text-left text-xs font-medium text-gray-500 uppercase px-4 py-3">Health</th>
                      <th className="text-center text-xs font-medium text-gray-500 uppercase px-4 py-3">Users (7d)</th>
                      <th className="text-center text-xs font-medium text-gray-500 uppercase px-4 py-3">Intakes (30d)</th>
                      <th className="text-center text-xs font-medium text-gray-500 uppercase px-4 py-3">Evals (30d)</th>
                      <th className="text-center text-xs font-medium text-gray-500 uppercase px-4 py-3">Proposals (30d)</th>
                      <th className="text-left text-xs font-medium text-gray-500 uppercase px-4 py-3">Last Activity</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {isLoading ? (
                      <tr>
                        <td colSpan={8} className="px-6 py-8 text-center text-gray-500">
                          Loading...
                        </td>
                      </tr>
                    ) : agencyHealth.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="px-6 py-8 text-center text-gray-500">
                          No agencies found
                        </td>
                      </tr>
                    ) : (
                      agencyHealth.map((agency) => (
                        <tr key={agency.id} className="hover:bg-gray-50" data-testid={`row-agency-health-${agency.id}`}>
                          <td className="px-6 py-4">
                            <Link 
                              href={`/super-admin/agencies/${agency.id}`}
                              className="font-medium text-gray-900 hover:underline"
                              data-testid={`link-agency-${agency.id}`}
                            >
                              {agency.name}
                            </Link>
                            <p className="text-xs text-gray-500">{agency.subscriptionTier}</p>
                          </td>
                          <td className="px-4 py-4">
                            <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
                              agency.status === 'ACTIVE' 
                                ? 'bg-green-100 text-green-700' 
                                : 'bg-gray-100 text-gray-600'
                            }`}>
                              {agency.status}
                            </span>
                          </td>
                          <td className="px-4 py-4">
                            <HealthBadge badge={agency.healthBadge} />
                          </td>
                          <td className="px-4 py-4 text-center text-sm text-gray-600">
                            {agency.activeUsersLast7Days}
                          </td>
                          <td className="px-4 py-4 text-center text-sm text-gray-600">
                            {agency.intakesLast30Days}
                          </td>
                          <td className="px-4 py-4 text-center text-sm text-gray-600">
                            {agency.evaluationsLast30Days}
                          </td>
                          <td className="px-4 py-4 text-center text-sm text-gray-600">
                            {agency.proposalsLast30Days}
                          </td>
                          <td className="px-4 py-4 text-sm text-gray-500">
                            {agency.lastActivityAt ? (
                              <span className="flex items-center gap-1">
                                <Clock className="w-3 h-3" />
                                {formatTimeAgo(agency.lastActivityAt)}
                              </span>
                            ) : (
                              <span className="text-gray-400">Never</span>
                            )}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <div className="lg:col-span-1">
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
                <h2 className="text-lg font-semibold text-gray-900">Recent Activity</h2>
                <Link 
                  href="/super-admin/activity" 
                  className="text-sm font-medium flex items-center gap-1"
                  style={{ color: '#00E6A7' }}
                >
                  View All
                  <ChevronRight className="w-4 h-4" />
                </Link>
              </div>
              <div className="divide-y divide-gray-100 max-h-[500px] overflow-y-auto">
                {isLoading ? (
                  <div className="px-6 py-8 text-center text-gray-500">Loading...</div>
                ) : recentActivity.length === 0 ? (
                  <div className="px-6 py-8 text-center text-gray-500">No recent activity</div>
                ) : (
                  recentActivity.slice(0, 15).map((event) => (
                    <div key={event.id} className="px-4 py-3 hover:bg-gray-50" data-testid={`activity-event-${event.id}`}>
                      <div className="flex items-start gap-3">
                        <div 
                          className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5"
                          style={{ backgroundColor: '#0D213715' }}
                        >
                          <Activity className="w-4 h-4" style={{ color: '#0D2137' }} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-900">
                            {formatEventType(event.eventType)}
                          </p>
                          {event.userName && (
                            <p className="text-xs text-gray-500 truncate">by {event.userName}</p>
                          )}
                          {event.metadata && Boolean((event.metadata as Record<string, unknown>).insuredName) && (
                            <p className="text-xs text-gray-500 truncate">
                              {String((event.metadata as Record<string, unknown>).insuredName)}
                            </p>
                          )}
                          <p className="text-xs text-gray-400 mt-1">
                            {formatTimeAgo(event.createdAt)}
                          </p>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
