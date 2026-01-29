'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useAdminAuth } from '../layout';
import { 
  Building2, Plus, ArrowLeft, Users, FileText, CheckCircle, PauseCircle,
  Search, AlertCircle, Clock, X
} from 'lucide-react';

interface Agency {
  id: string;
  name: string;
  logoUrl: string | null;
  brandPrimaryColor: string | null;
  subscriptionTier: 'SOLO' | 'GROWTH' | 'MULTI_LOCATION';
  riskTolerance: 'CONSERVATIVE' | 'BALANCED' | 'AGGRESSIVE';
  status: 'ACTIVE' | 'PAUSED';
  allowedMarkets: string[];
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

interface AgencyHealth {
  id: string;
  healthBadge: 'green' | 'yellow' | 'red';
  lastActivityAt: string | null;
  activeUsersLast7Days: number;
  intakesLast30Days: number;
}

const tierLabels: Record<string, string> = {
  SOLO: 'Solo',
  GROWTH: 'Growth',
  MULTI_LOCATION: 'Multi-Location',
};

const tierColors: Record<string, string> = {
  SOLO: '#6B7280',
  GROWTH: '#00E6A7',
  MULTI_LOCATION: '#0D2137',
};

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

export default function AgenciesPage() {
  const searchParams = useSearchParams();
  const showCreateParam = searchParams.get('create') === 'true';
  const { authFetch } = useAdminAuth();
  
  const [agencies, setAgencies] = useState<Agency[]>([]);
  const [agencyHealthMap, setAgencyHealthMap] = useState<Record<string, AgencyHealth>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(showCreateParam);
  const [newAgencyName, setNewAgencyName] = useState('');
  const [newAgencyTier, setNewAgencyTier] = useState<'SOLO' | 'GROWTH' | 'MULTI_LOCATION'>('SOLO');
  const [isCreating, setIsCreating] = useState(false);
  const [createdAgency, setCreatedAgency] = useState<Agency | null>(null);
  
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [tierFilter, setTierFilter] = useState('');
  const [healthFilter, setHealthFilter] = useState('');

  const fetchAgencies = async () => {
    try {
      const res = await authFetch('/api/super-admin/agencies');
      if (res.ok) {
        const data = await res.json();
        setAgencies(data.agencies);
      }
    } finally {
      setIsLoading(false);
    }
  };

  const fetchHealth = async () => {
    const res = await authFetch('/api/super-admin/dashboard');
    if (res.ok) {
      const data = await res.json();
      const healthMap: Record<string, AgencyHealth> = {};
      for (const h of data.agencyHealth) {
        healthMap[h.id] = h;
      }
      setAgencyHealthMap(healthMap);
    }
  };

  useEffect(() => {
    fetchAgencies();
    fetchHealth();
  }, []);

  const createAgency = async () => {
    if (!newAgencyName.trim()) return;
    setIsCreating(true);
    try {
      const res = await authFetch('/api/super-admin/agencies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          name: newAgencyName,
          subscriptionTier: newAgencyTier,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setCreatedAgency(data.agency);
        setNewAgencyName('');
        setNewAgencyTier('SOLO');
        setShowCreate(false);
        fetchAgencies();
        fetchHealth();
      }
    } finally {
      setIsCreating(false);
    }
  };

  const filteredAgencies = agencies.filter((agency) => {
    if (searchTerm && !agency.name.toLowerCase().includes(searchTerm.toLowerCase())) {
      return false;
    }
    if (statusFilter && agency.status !== statusFilter) {
      return false;
    }
    if (tierFilter && agency.subscriptionTier !== tierFilter) {
      return false;
    }
    if (healthFilter) {
      const health = agencyHealthMap[agency.id];
      if (!health || health.healthBadge !== healthFilter) {
        return false;
      }
    }
    return true;
  });

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
        <div className="text-gray-500">Loading agencies...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen" style={{ backgroundColor: '#F5F7FA' }}>
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <Link 
            href="/super-admin" 
            className="inline-flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700 mb-2"
            data-testid="link-back"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Dashboard
          </Link>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div 
                className="w-10 h-10 rounded-lg flex items-center justify-center"
                style={{ backgroundColor: '#0D2137' }}
              >
                <Building2 className="w-5 h-5 text-white" />
              </div>
              <div>
                <h1 className="text-xl font-bold" style={{ color: '#0D2137' }}>Agencies</h1>
                <p className="text-sm text-gray-500">{agencies.length} total agencies</p>
              </div>
            </div>
            <button
              onClick={() => setShowCreate(!showCreate)}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white rounded-lg transition-colors"
              style={{ backgroundColor: '#00E6A7' }}
              data-testid="button-create-agency"
            >
              <Plus className="w-4 h-4" />
              Create Agency
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-8">
        {showCreate && (
          <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-gray-900">New Agency</h3>
              <button onClick={() => setShowCreate(false)} className="p-1 hover:bg-gray-100 rounded">
                <X className="w-4 h-4 text-gray-400" />
              </button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="md:col-span-2">
                <label className="block text-sm text-gray-600 mb-1">Agency Name</label>
                <input
                  type="text"
                  value={newAgencyName}
                  onChange={(e) => setNewAgencyName(e.target.value)}
                  placeholder="Enter agency name"
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#00E6A7]"
                  data-testid="input-agency-name"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">Subscription Tier</label>
                <select
                  value={newAgencyTier}
                  onChange={(e) => setNewAgencyTier(e.target.value as typeof newAgencyTier)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#00E6A7]"
                  data-testid="select-agency-tier"
                >
                  <option value="SOLO">Solo</option>
                  <option value="GROWTH">Growth</option>
                  <option value="MULTI_LOCATION">Multi-Location</option>
                </select>
              </div>
            </div>
            <div className="mt-4 flex justify-end gap-3">
              <button
                onClick={() => setShowCreate(false)}
                className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800"
              >
                Cancel
              </button>
              <button
                onClick={createAgency}
                disabled={isCreating || !newAgencyName.trim()}
                className="px-4 py-2 text-sm font-medium text-white rounded-lg disabled:opacity-50"
                style={{ backgroundColor: '#0D2137' }}
                data-testid="button-save-agency"
              >
                {isCreating ? 'Creating...' : 'Create Agency'}
              </button>
            </div>
          </div>
        )}

        {createdAgency && (
          <div className="bg-green-50 border border-green-200 rounded-xl p-4 mb-6">
            <div className="flex items-start gap-3">
              <CheckCircle className="w-5 h-5 text-green-600 mt-0.5" />
              <div className="flex-1">
                <h3 className="text-sm font-semibold text-green-800">Agency Created Successfully</h3>
                <p className="text-sm text-green-700 mt-1">
                  <span className="font-medium">{createdAgency.name}</span> has been created.
                </p>
                <div className="flex gap-3 mt-3">
                  <Link
                    href={`/super-admin/agencies/${createdAgency.id}`}
                    className="px-3 py-1.5 text-sm font-medium text-green-700 bg-green-100 rounded-lg hover:bg-green-200"
                    data-testid="link-manage-agency"
                  >
                    Manage Agency
                  </Link>
                  <button
                    onClick={() => setCreatedAgency(null)}
                    className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-800"
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200 flex flex-wrap items-center gap-4">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                placeholder="Search agencies..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#00E6A7]"
                data-testid="input-search-agencies"
              />
            </div>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#00E6A7]"
              data-testid="select-status-filter"
            >
              <option value="">All Status</option>
              <option value="ACTIVE">Active</option>
              <option value="PAUSED">Paused</option>
            </select>
            <select
              value={tierFilter}
              onChange={(e) => setTierFilter(e.target.value)}
              className="px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#00E6A7]"
              data-testid="select-tier-filter"
            >
              <option value="">All Tiers</option>
              <option value="SOLO">Solo</option>
              <option value="GROWTH">Growth</option>
              <option value="MULTI_LOCATION">Multi-Location</option>
            </select>
            <select
              value={healthFilter}
              onChange={(e) => setHealthFilter(e.target.value)}
              className="px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#00E6A7]"
              data-testid="select-health-filter"
            >
              <option value="">All Health</option>
              <option value="green">Healthy</option>
              <option value="yellow">Needs Attention</option>
              <option value="red">At Risk</option>
            </select>
          </div>
          
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Agency</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Status</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Health</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Tier</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase">Leads</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase">Users</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Last Activity</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredAgencies.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-12 text-center">
                      <Building2 className="w-12 h-12 text-gray-300 mx-auto mb-3" />
                      <p className="text-gray-500">
                        {agencies.length === 0 
                          ? 'No agencies yet. Create your first agency above.' 
                          : 'No agencies match your filters.'}
                      </p>
                    </td>
                  </tr>
                ) : (
                  filteredAgencies.map((agency) => {
                    const health = agencyHealthMap[agency.id];
                    return (
                      <tr key={agency.id} className="hover:bg-gray-50" data-testid={`row-agency-${agency.id}`}>
                        <td className="px-4 py-4">
                          <div className="flex items-center gap-3">
                            <div 
                              className="w-8 h-8 rounded-lg flex items-center justify-center text-white text-sm font-semibold"
                              style={{ backgroundColor: agency.brandPrimaryColor || '#0D2137' }}
                            >
                              {agency.name.charAt(0).toUpperCase()}
                            </div>
                            <Link
                              href={`/super-admin/agencies/${agency.id}`}
                              className="font-medium text-gray-900 hover:underline"
                            >
                              {agency.name}
                            </Link>
                          </div>
                        </td>
                        <td className="px-4 py-4">
                          <span 
                            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${
                              agency.status === 'ACTIVE' 
                                ? 'bg-green-100 text-green-700' 
                                : 'bg-yellow-100 text-yellow-700'
                            }`}
                          >
                            {agency.status === 'ACTIVE' ? (
                              <CheckCircle className="w-3 h-3" />
                            ) : (
                              <PauseCircle className="w-3 h-3" />
                            )}
                            {agency.status === 'ACTIVE' ? 'Active' : 'Paused'}
                          </span>
                        </td>
                        <td className="px-4 py-4">
                          {health ? (
                            <HealthBadge badge={health.healthBadge} />
                          ) : (
                            <span className="text-gray-400 text-xs">—</span>
                          )}
                        </td>
                        <td className="px-4 py-4">
                          <span 
                            className="inline-block px-2.5 py-1 rounded-full text-xs font-medium text-white"
                            style={{ backgroundColor: tierColors[agency.subscriptionTier] }}
                          >
                            {tierLabels[agency.subscriptionTier]}
                          </span>
                        </td>
                        <td className="px-4 py-4 text-center">
                          <span className="text-sm font-medium text-gray-900">{agency._count.leads}</span>
                        </td>
                        <td className="px-4 py-4 text-center">
                          <span className="text-sm font-medium text-gray-900">{agency._count.users}</span>
                        </td>
                        <td className="px-4 py-4 text-sm text-gray-500">
                          <span className="flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {health ? formatTimeAgo(health.lastActivityAt) : '—'}
                          </span>
                        </td>
                        <td className="px-4 py-4 text-right">
                          <Link
                            href={`/super-admin/agencies/${agency.id}`}
                            className="text-sm font-medium hover:underline"
                            style={{ color: '#00E6A7' }}
                            data-testid={`link-edit-${agency.id}`}
                          >
                            Manage
                          </Link>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </main>
    </div>
  );
}
