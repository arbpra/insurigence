'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useAdminAuth } from '../../layout';
import { 
  Building2, ArrowLeft, Users, FileText, Briefcase, Settings, 
  CheckCircle, PauseCircle, TrendingUp, AlertTriangle, Activity,
  LayoutDashboard, Palette, User, Clock, AlertCircle
} from 'lucide-react';

interface Agency {
  id: string;
  name: string;
  logoUrl: string | null;
  brandPrimaryColor: string | null;
  proposalFooterText: string | null;
  subscriptionTier: 'SOLO' | 'GROWTH' | 'MULTI_LOCATION';
  riskTolerance: 'CONSERVATIVE' | 'BALANCED' | 'AGGRESSIVE';
  status: 'ACTIVE' | 'PAUSED';
  allowedMarkets: string[];
  placementNotes: string | null;
  esRecommendationsEnabled: boolean;
  createdAt: string;
  _count: {
    leads: number;
    carriers: number;
    appetiteRules: number;
    intakeForms: number;
    proposals: number;
    users: number;
  };
}

interface Metrics {
  evaluatedLeads: number;
  thisMonthLeads: number;
}

interface AgencyUser {
  id: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  role: string;
  isActive: boolean;
  lastLoginAt: string | null;
}

interface AgencyHealth {
  healthBadge: 'green' | 'yellow' | 'red';
  lastActivityAt: string | null;
  activeUsersLast7Days: number;
  intakesLast30Days: number;
  evaluationsLast30Days: number;
  proposalsLast30Days: number;
}

const tierLabels: Record<string, string> = {
  SOLO: 'Solo',
  GROWTH: 'Growth',
  MULTI_LOCATION: 'Multi-Location',
};

const toleranceLabels: Record<string, string> = {
  CONSERVATIVE: 'Conservative',
  BALANCED: 'Balanced',
  AGGRESSIVE: 'Aggressive',
};

type TabType = 'overview' | 'settings' | 'branding' | 'users';

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

export default function AgencyDetailPage() {
  const params = useParams();
  const agencyId = params.id as string;
  const { authFetch } = useAdminAuth();

  const [agency, setAgency] = useState<Agency | null>(null);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [health, setHealth] = useState<AgencyHealth | null>(null);
  const [users, setUsers] = useState<AgencyUser[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<TabType>('overview');
  const [form, setForm] = useState({
    name: '',
    subscriptionTier: 'SOLO' as 'SOLO' | 'PRO' | 'ENTERPRISE',
    riskTolerance: 'BALANCED' as 'CONSERVATIVE' | 'BALANCED' | 'AGGRESSIVE',
    status: 'ACTIVE' as 'ACTIVE' | 'PAUSED',
    allowedMarkets: ['standard'] as string[],
    placementNotes: '',
    esRecommendationsEnabled: true,
    logoUrl: '',
    brandPrimaryColor: '',
    proposalFooterText: '',
  });

  useEffect(() => {
    fetchAgency();
    fetchHealth();
    fetchUsers();
  }, [agencyId]);

  const fetchAgency = async () => {
    try {
      const res = await authFetch(`/api/super-admin/agencies/${agencyId}`);
      if (res.ok) {
        const data = await res.json();
        setAgency(data.agency);
        setMetrics(data.metrics);
        setForm({
          name: data.agency.name || '',
          subscriptionTier: data.agency.subscriptionTier || 'SOLO',
          riskTolerance: data.agency.riskTolerance || 'BALANCED',
          status: data.agency.status || 'ACTIVE',
          allowedMarkets: data.agency.allowedMarkets || ['standard'],
          placementNotes: data.agency.placementNotes || '',
          esRecommendationsEnabled: data.agency.esRecommendationsEnabled !== false,
          logoUrl: data.agency.logoUrl || '',
          brandPrimaryColor: data.agency.brandPrimaryColor || '',
          proposalFooterText: data.agency.proposalFooterText || '',
        });
      }
    } finally {
      setIsLoading(false);
    }
  };

  const fetchHealth = async () => {
    const res = await authFetch('/api/super-admin/dashboard');
    if (res.ok) {
      const data = await res.json();
      const agencyHealth = data.agencyHealth.find((h: AgencyHealth & { id: string }) => h.id === agencyId);
      if (agencyHealth) {
        setHealth(agencyHealth);
      }
    }
  };

  const fetchUsers = async () => {
    const res = await authFetch(`/api/super-admin/users?agencyId=${agencyId}`);
    if (res.ok) {
      const data = await res.json();
      setUsers(data.users);
    }
  };

  const saveAgency = async () => {
    setIsSaving(true);
    try {
      const res = await authFetch(`/api/super-admin/agencies/${agencyId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (res.ok) {
        const data = await res.json();
        setAgency({ ...agency!, ...data.agency });
      }
    } finally {
      setIsSaving(false);
    }
  };

  const toggleMarket = (market: string) => {
    if (form.allowedMarkets.includes(market)) {
      if (form.allowedMarkets.length > 1) {
        setForm({ ...form, allowedMarkets: form.allowedMarkets.filter(m => m !== market) });
      }
    } else {
      setForm({ ...form, allowedMarkets: [...form.allowedMarkets, market] });
    }
  };

  const formatTimeAgo = (dateStr: string | null) => {
    if (!dateStr) return 'Never';
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / 86400000);
    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#F5F7FA' }}>
        <div className="text-gray-500">Loading agency...</div>
      </div>
    );
  }

  if (!agency) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#F5F7FA' }}>
        <div className="bg-white rounded-xl border border-gray-200 p-8 max-w-md text-center">
          <AlertTriangle className="w-12 h-12 text-yellow-500 mx-auto mb-4" />
          <h1 className="text-xl font-semibold text-gray-900 mb-2">Agency Not Found</h1>
          <Link href="/super-admin/agencies" className="text-sm" style={{ color: '#00E6A7' }}>
            Back to Agencies
          </Link>
        </div>
      </div>
    );
  }

  const tabs = [
    { id: 'overview' as const, label: 'Overview', icon: LayoutDashboard },
    { id: 'settings' as const, label: 'Settings', icon: Settings },
    { id: 'branding' as const, label: 'Branding', icon: Palette },
    { id: 'users' as const, label: 'Users', icon: Users },
  ];

  return (
    <div className="min-h-screen" style={{ backgroundColor: '#F5F7FA' }}>
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <Link 
            href="/super-admin/agencies" 
            className="inline-flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700 mb-2"
            data-testid="link-back"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Agencies
          </Link>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div 
                className="w-12 h-12 rounded-xl flex items-center justify-center text-white text-lg font-bold"
                style={{ backgroundColor: agency.brandPrimaryColor || '#0D2137' }}
              >
                {agency.name.charAt(0).toUpperCase()}
              </div>
              <div>
                <h1 className="text-xl font-bold text-gray-900">{agency.name}</h1>
                <div className="flex items-center gap-2 mt-1">
                  <span 
                    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
                      agency.status === 'ACTIVE' 
                        ? 'bg-green-100 text-green-700' 
                        : 'bg-yellow-100 text-yellow-700'
                    }`}
                  >
                    {agency.status === 'ACTIVE' ? <CheckCircle className="w-3 h-3" /> : <PauseCircle className="w-3 h-3" />}
                    {agency.status === 'ACTIVE' ? 'Active' : 'Paused'}
                  </span>
                  {health && <HealthBadge badge={health.healthBadge} />}
                  <span className="text-xs text-gray-400">ID: {agency.id.slice(0, 8)}...</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-8">
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="border-b border-gray-200">
            <nav className="flex overflow-x-auto">
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center gap-2 px-6 py-4 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                    activeTab === tab.id
                      ? 'border-[#0D2137] text-[#0D2137]'
                      : 'border-transparent text-gray-500 hover:text-gray-700'
                  }`}
                  data-testid={`tab-${tab.id}`}
                >
                  <tab.icon className="w-4 h-4" />
                  {tab.label}
                </button>
              ))}
            </nav>
          </div>

          <div className="p-6">
            {activeTab === 'overview' && (
              <div className="space-y-6">
                <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                  <div className="bg-gray-50 rounded-lg p-4" data-testid="stat-total-leads">
                    <p className="text-sm text-gray-500">Total Leads</p>
                    <p className="text-2xl font-bold" style={{ color: '#0D2137' }}>{agency._count.leads}</p>
                  </div>
                  <div className="bg-gray-50 rounded-lg p-4" data-testid="stat-evaluated">
                    <p className="text-sm text-gray-500">Evaluated</p>
                    <p className="text-2xl font-bold" style={{ color: '#00E6A7' }}>{metrics?.evaluatedLeads || 0}</p>
                  </div>
                  <div className="bg-gray-50 rounded-lg p-4" data-testid="stat-this-month">
                    <p className="text-sm text-gray-500">This Month</p>
                    <p className="text-2xl font-bold" style={{ color: '#0D2137' }}>{metrics?.thisMonthLeads || 0}</p>
                  </div>
                  <div className="bg-gray-50 rounded-lg p-4" data-testid="stat-proposals">
                    <p className="text-sm text-gray-500">Proposals</p>
                    <p className="text-2xl font-bold" style={{ color: '#0D2137' }}>{agency._count.proposals}</p>
                  </div>
                  <div className="bg-gray-50 rounded-lg p-4" data-testid="stat-users">
                    <p className="text-sm text-gray-500">Users</p>
                    <p className="text-2xl font-bold" style={{ color: '#0D2137' }}>{agency._count.users}</p>
                  </div>
                </div>

                {health && (
                  <div className="bg-gray-50 rounded-lg p-4">
                    <h3 className="text-sm font-medium text-gray-700 mb-3">Activity (Last 30 Days)</h3>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                      <div>
                        <p className="text-xs text-gray-500">Active Users (7d)</p>
                        <p className="text-lg font-semibold" style={{ color: '#0D2137' }}>{health.activeUsersLast7Days}</p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-500">Intakes</p>
                        <p className="text-lg font-semibold" style={{ color: '#0D2137' }}>{health.intakesLast30Days}</p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-500">Evaluations</p>
                        <p className="text-lg font-semibold" style={{ color: '#00E6A7' }}>{health.evaluationsLast30Days}</p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-500">Last Activity</p>
                        <p className="text-lg font-semibold flex items-center gap-1" style={{ color: '#0D2137' }}>
                          <Clock className="w-4 h-4" />
                          {formatTimeAgo(health.lastActivityAt)}
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <Link
                    href={`/super-admin/agencies/${agencyId}/carriers`}
                    className="bg-gray-50 rounded-lg p-4 hover:bg-gray-100 transition-colors group"
                    data-testid="link-carriers"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ backgroundColor: '#0D213715' }}>
                          <Briefcase className="w-5 h-5" style={{ color: '#0D2137' }} />
                        </div>
                        <div>
                          <p className="font-medium text-gray-900">Carriers</p>
                          <p className="text-2xl font-bold" style={{ color: '#0D2137' }}>{agency._count.carriers}</p>
                        </div>
                      </div>
                      <ArrowLeft className="w-5 h-5 text-gray-300 rotate-180 group-hover:translate-x-1 transition-transform" />
                    </div>
                  </Link>

                  <Link
                    href={`/super-admin/agencies/${agencyId}/appetite-rules`}
                    className="bg-gray-50 rounded-lg p-4 hover:bg-gray-100 transition-colors group"
                    data-testid="link-rules"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ backgroundColor: '#00E6A715' }}>
                          <Settings className="w-5 h-5" style={{ color: '#00E6A7' }} />
                        </div>
                        <div>
                          <p className="font-medium text-gray-900">Appetite Rules</p>
                          <p className="text-2xl font-bold" style={{ color: '#00E6A7' }}>{agency._count.appetiteRules}</p>
                        </div>
                      </div>
                      <ArrowLeft className="w-5 h-5 text-gray-300 rotate-180 group-hover:translate-x-1 transition-transform" />
                    </div>
                  </Link>

                  <Link
                    href={`/super-admin/agencies/${agencyId}/intake-forms`}
                    className="bg-gray-50 rounded-lg p-4 hover:bg-gray-100 transition-colors group"
                    data-testid="link-forms"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ backgroundColor: '#0D213715' }}>
                          <FileText className="w-5 h-5" style={{ color: '#0D2137' }} />
                        </div>
                        <div>
                          <p className="font-medium text-gray-900">Intake Forms</p>
                          <p className="text-2xl font-bold" style={{ color: '#0D2137' }}>{agency._count.intakeForms}</p>
                        </div>
                      </div>
                      <ArrowLeft className="w-5 h-5 text-gray-300 rotate-180 group-hover:translate-x-1 transition-transform" />
                    </div>
                  </Link>
                </div>

                <div className="bg-gray-50 rounded-lg p-4">
                  <h3 className="text-sm font-medium text-gray-700 mb-3">Agency Details</h3>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                    <div>
                      <p className="text-gray-500">Subscription Tier</p>
                      <p className="font-medium text-gray-900">{tierLabels[agency.subscriptionTier]}</p>
                    </div>
                    <div>
                      <p className="text-gray-500">Risk Tolerance</p>
                      <p className="font-medium text-gray-900">{toleranceLabels[agency.riskTolerance]}</p>
                    </div>
                    <div>
                      <p className="text-gray-500">Allowed Markets</p>
                      <p className="font-medium text-gray-900">{agency.allowedMarkets.join(', ')}</p>
                    </div>
                    <div>
                      <p className="text-gray-500">Created</p>
                      <p className="font-medium text-gray-900">{new Date(agency.createdAt).toLocaleDateString()}</p>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'settings' && (
              <div className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Agency Name</label>
                    <input
                      type="text"
                      value={form.name}
                      onChange={(e) => setForm({ ...form, name: e.target.value })}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#00E6A7]"
                      data-testid="input-name"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Status</label>
                    <select
                      value={form.status}
                      onChange={(e) => setForm({ ...form, status: e.target.value as 'ACTIVE' | 'PAUSED' })}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#00E6A7]"
                      data-testid="select-status"
                    >
                      <option value="ACTIVE">Active</option>
                      <option value="PAUSED">Paused</option>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Subscription Tier</label>
                    <select
                      value={form.subscriptionTier}
                      onChange={(e) => setForm({ ...form, subscriptionTier: e.target.value as typeof form.subscriptionTier })}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#00E6A7]"
                      data-testid="select-tier"
                    >
                      <option value="SOLO">Solo</option>
                      <option value="GROWTH">Growth</option>
                      <option value="MULTI_LOCATION">Multi-Location</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Risk Tolerance</label>
                    <select
                      value={form.riskTolerance}
                      onChange={(e) => setForm({ ...form, riskTolerance: e.target.value as typeof form.riskTolerance })}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#00E6A7]"
                      data-testid="select-tolerance"
                    >
                      <option value="CONSERVATIVE">Conservative</option>
                      <option value="BALANCED">Balanced</option>
                      <option value="AGGRESSIVE">Aggressive</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Allowed Markets</label>
                  <div className="flex gap-4">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={form.allowedMarkets.includes('standard')}
                        onChange={() => toggleMarket('standard')}
                        className="w-4 h-4 rounded border-gray-300 text-[#00E6A7] focus:ring-[#00E6A7]"
                        data-testid="checkbox-standard"
                      />
                      <span className="text-sm text-gray-700">Standard Market</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={form.allowedMarkets.includes('es')}
                        onChange={() => toggleMarket('es')}
                        className="w-4 h-4 rounded border-gray-300 text-[#00E6A7] focus:ring-[#00E6A7]"
                        data-testid="checkbox-es"
                      />
                      <span className="text-sm text-gray-700">E&S Market</span>
                    </label>
                  </div>
                </div>

                <div>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={form.esRecommendationsEnabled}
                      onChange={(e) => setForm({ ...form, esRecommendationsEnabled: e.target.checked })}
                      className="w-4 h-4 rounded border-gray-300 text-[#00E6A7] focus:ring-[#00E6A7]"
                      data-testid="checkbox-es-recommendations"
                    />
                    <span className="text-sm font-medium text-gray-700">Enable E&S Recommendations</span>
                  </label>
                  <p className="text-xs text-gray-500 mt-1 ml-6">When enabled, E&S carriers will be included in market recommendations.</p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Internal Placement Notes</label>
                  <textarea
                    value={form.placementNotes}
                    onChange={(e) => setForm({ ...form, placementNotes: e.target.value })}
                    placeholder="Add internal notes about placement preferences, preferred carriers, or special instructions..."
                    rows={4}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#00E6A7] resize-none"
                    data-testid="textarea-notes"
                  />
                </div>

                <div className="pt-4 border-t border-gray-200 flex justify-end">
                  <button
                    onClick={saveAgency}
                    disabled={isSaving}
                    className="px-6 py-2 text-sm font-medium text-white rounded-lg disabled:opacity-50"
                    style={{ backgroundColor: '#0D2137' }}
                    data-testid="button-save"
                  >
                    {isSaving ? 'Saving...' : 'Save Changes'}
                  </button>
                </div>
              </div>
            )}

            {activeTab === 'branding' && (
              <div className="space-y-6">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Logo URL</label>
                  <input
                    type="text"
                    value={form.logoUrl}
                    onChange={(e) => setForm({ ...form, logoUrl: e.target.value })}
                    placeholder="https://example.com/logo.png"
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#00E6A7]"
                    data-testid="input-logo"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Brand Primary Color</label>
                  <div className="flex gap-3">
                    <input
                      type="text"
                      value={form.brandPrimaryColor}
                      onChange={(e) => setForm({ ...form, brandPrimaryColor: e.target.value })}
                      placeholder="#0D2137"
                      className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#00E6A7]"
                      data-testid="input-color"
                    />
                    {form.brandPrimaryColor && (
                      <div 
                        className="w-10 h-10 rounded-lg border border-gray-200"
                        style={{ backgroundColor: form.brandPrimaryColor }}
                      />
                    )}
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Proposal Footer Text</label>
                  <textarea
                    value={form.proposalFooterText}
                    onChange={(e) => setForm({ ...form, proposalFooterText: e.target.value })}
                    placeholder="Contact us at info@agency.com for questions."
                    rows={3}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#00E6A7] resize-none"
                    data-testid="input-footer"
                  />
                </div>

                <div className="pt-4 border-t border-gray-200 flex justify-end">
                  <button
                    onClick={saveAgency}
                    disabled={isSaving}
                    className="px-6 py-2 text-sm font-medium text-white rounded-lg disabled:opacity-50"
                    style={{ backgroundColor: '#0D2137' }}
                    data-testid="button-save-branding"
                  >
                    {isSaving ? 'Saving...' : 'Save Changes'}
                  </button>
                </div>
              </div>
            )}

            {activeTab === 'users' && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-medium text-gray-700">Agency Users ({users.length})</h3>
                  <Link
                    href={`/super-admin/users?agencyId=${agencyId}&create=true`}
                    className="inline-flex items-center gap-2 px-3 py-1.5 text-sm font-medium rounded-lg text-white"
                    style={{ backgroundColor: '#00E6A7' }}
                    data-testid="button-add-user"
                  >
                    Add User
                  </Link>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-gray-200">
                        <th className="text-left text-xs font-medium text-gray-500 uppercase py-3">User</th>
                        <th className="text-left text-xs font-medium text-gray-500 uppercase py-3">Role</th>
                        <th className="text-left text-xs font-medium text-gray-500 uppercase py-3">Status</th>
                        <th className="text-left text-xs font-medium text-gray-500 uppercase py-3">Last Login</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {users.length === 0 ? (
                        <tr>
                          <td colSpan={4} className="py-8 text-center text-gray-500">No users in this agency</td>
                        </tr>
                      ) : (
                        users.map((user) => (
                          <tr key={user.id} className="hover:bg-gray-50" data-testid={`row-user-${user.id}`}>
                            <td className="py-3">
                              <div className="flex items-center gap-3">
                                <div className="w-8 h-8 rounded-full flex items-center justify-center" style={{ backgroundColor: '#0D213715' }}>
                                  <User className="w-4 h-4" style={{ color: '#0D2137' }} />
                                </div>
                                <div>
                                  <p className="font-medium text-gray-900">
                                    {user.firstName || user.lastName
                                      ? `${user.firstName || ''} ${user.lastName || ''}`.trim()
                                      : 'Unnamed User'}
                                  </p>
                                  <p className="text-xs text-gray-500">{user.email || 'No email'}</p>
                                </div>
                              </div>
                            </td>
                            <td className="py-3">
                              <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
                                user.role === 'ADMIN' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-700'
                              }`}>
                                {user.role === 'ADMIN' ? 'Admin' : 'Agent'}
                              </span>
                            </td>
                            <td className="py-3">
                              <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
                                user.isActive ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                              }`}>
                                {user.isActive ? 'Active' : 'Inactive'}
                              </span>
                            </td>
                            <td className="py-3 text-sm text-gray-500">
                              {user.lastLoginAt ? formatTimeAgo(user.lastLoginAt) : 'Never'}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
