'use client';

import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useAdminAuth } from '../../../layout';

interface Carrier {
  id: string;
  name: string;
  marketType: string;
}

interface AppetiteRule {
  id: string;
  carrierId: string;
  carrier: { id: string; name: string; marketType: string };
  lob: string;
  version: number;
  allowedIndustries: string[];
  excludedIndustries: string[];
  allowedStates: string[];
  excludedStates: string[];
  minRevenue: number | null;
  maxRevenue: number | null;
  minEmployees: number | null;
  maxEmployees: number | null;
  minYearsInBusiness: number | null;
  lossHistoryYears: number;
  maxLossCount: number | null;
  maxLossAmount: number | null;
  summary: string | null;
  isActive: boolean;
  isAgencyOverride: boolean;
  createdAt: string;
}

const US_STATES = [
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA',
  'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD',
  'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
  'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC',
  'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY'
];

const COMMON_INDUSTRIES = [
  'Construction', 'Manufacturing', 'Retail', 'Restaurant', 'Healthcare',
  'Technology', 'Real Estate', 'Professional Services', 'Transportation',
  'Wholesale', 'Agriculture', 'Hospitality', 'Automotive', 'Education'
];

export default function AppetiteRulesPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const agencyId = params.id as string;
  const filterCarrierId = searchParams.get('carrierId');
  const { authFetch } = useAdminAuth();

  const [rules, setRules] = useState<AppetiteRule[]>([]);
  const [carriers, setCarriers] = useState<Carrier[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [editingRule, setEditingRule] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  const [formData, setFormData] = useState({
    carrierId: filterCarrierId || '',
    lob: 'COMMERCIAL_GL',
    allowedIndustries: [] as string[],
    excludedIndustries: [] as string[],
    allowedStates: [] as string[],
    excludedStates: [] as string[],
    minRevenue: '',
    maxRevenue: '',
    minEmployees: '',
    maxEmployees: '',
    minYearsInBusiness: '',
    maxLossCount: '',
    maxLossAmount: '',
    summary: '',
  });

  useEffect(() => {
    fetchData();
  }, [agencyId]);

  useEffect(() => {
    if (filterCarrierId) {
      setFormData(prev => ({ ...prev, carrierId: filterCarrierId }));
      setShowCreate(true);
    }
  }, [filterCarrierId]);

  const fetchData = async () => {
    try {
      const [rulesRes, carriersRes] = await Promise.all([
        authFetch(`/api/super-admin/agencies/${agencyId}/appetite-rules`),
        authFetch(`/api/super-admin/agencies/${agencyId}/carriers`),
      ]);
      if (rulesRes.ok && carriersRes.ok) {
        const rulesData = await rulesRes.json();
        const carriersData = await carriersRes.json();
        setRules(rulesData.rules);
        setCarriers(carriersData.carriers);
      }
    } finally {
      setIsLoading(false);
    }
  };

  const resetForm = () => {
    setFormData({
      carrierId: filterCarrierId || '',
      lob: 'COMMERCIAL_GL',
      allowedIndustries: [],
      excludedIndustries: [],
      allowedStates: [],
      excludedStates: [],
      minRevenue: '',
      maxRevenue: '',
      minEmployees: '',
      maxEmployees: '',
      minYearsInBusiness: '',
      maxLossCount: '',
      maxLossAmount: '',
      summary: '',
    });
  };

  const createRule = async () => {
    if (!formData.carrierId) return;
    setIsCreating(true);
    try {
      const payload = {
        carrierId: formData.carrierId,
        lob: formData.lob,
        allowedIndustries: formData.allowedIndustries,
        excludedIndustries: formData.excludedIndustries,
        allowedStates: formData.allowedStates,
        excludedStates: formData.excludedStates,
        minRevenue: formData.minRevenue ? parseInt(formData.minRevenue) : null,
        maxRevenue: formData.maxRevenue ? parseInt(formData.maxRevenue) : null,
        minEmployees: formData.minEmployees ? parseInt(formData.minEmployees) : null,
        maxEmployees: formData.maxEmployees ? parseInt(formData.maxEmployees) : null,
        minYearsInBusiness: formData.minYearsInBusiness ? parseInt(formData.minYearsInBusiness) : null,
        maxLossCount: formData.maxLossCount ? parseInt(formData.maxLossCount) : null,
        maxLossAmount: formData.maxLossAmount ? parseInt(formData.maxLossAmount) : null,
        summary: formData.summary || null,
      };

      const res = await authFetch(`/api/super-admin/agencies/${agencyId}/appetite-rules`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        resetForm();
        setShowCreate(false);
        fetchData();
      }
    } finally {
      setIsCreating(false);
    }
  };

  const toggleActive = async (ruleId: string, isActive: boolean) => {
    await authFetch(`/api/super-admin/agencies/${agencyId}/appetite-rules/${ruleId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isActive: !isActive }),
    });
    fetchData();
  };

  const deleteRule = async (ruleId: string) => {
    if (!confirm('Are you sure you want to delete this rule?')) return;
    await authFetch(`/api/super-admin/agencies/${agencyId}/appetite-rules/${ruleId}`, {
      method: 'DELETE',
    });
    fetchData();
  };

  const editRule = (rule: AppetiteRule) => {
    setEditingRule(rule.id);
    setFormData({
      carrierId: rule.carrierId,
      lob: rule.lob,
      allowedIndustries: rule.allowedIndustries,
      excludedIndustries: rule.excludedIndustries,
      allowedStates: rule.allowedStates,
      excludedStates: rule.excludedStates,
      minRevenue: rule.minRevenue?.toString() || '',
      maxRevenue: rule.maxRevenue?.toString() || '',
      minEmployees: rule.minEmployees?.toString() || '',
      maxEmployees: rule.maxEmployees?.toString() || '',
      minYearsInBusiness: rule.minYearsInBusiness?.toString() || '',
      maxLossCount: rule.maxLossCount?.toString() || '',
      maxLossAmount: rule.maxLossAmount?.toString() || '',
      summary: rule.summary || '',
    });
    setShowCreate(true);
  };

  const toggleArrayItem = (field: 'allowedIndustries' | 'excludedIndustries' | 'allowedStates' | 'excludedStates', item: string) => {
    setFormData(prev => {
      const arr = prev[field];
      if (arr.includes(item)) {
        return { ...prev, [field]: arr.filter(i => i !== item) };
      } else {
        return { ...prev, [field]: [...arr, item] };
      }
    });
  };

  const filteredRules = filterCarrierId 
    ? rules.filter(r => r.carrierId === filterCarrierId)
    : rules;

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-gray-500">Loading...</div>
      </div>
    );
  }

  const selectedCarrier = carriers.find(c => c.id === formData.carrierId);

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-6xl mx-auto px-4 py-8">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <Link href={`/super-admin/agencies/${agencyId}/carriers`} className="text-sm text-gray-500 hover:text-gray-700 mb-2 inline-block" data-testid="link-back">
              Back to Carriers
            </Link>
            <h1 className="text-2xl font-semibold text-gray-900">Appetite Rules</h1>
            {filterCarrierId && selectedCarrier && (
              <p className="text-sm text-gray-500 mt-1">Filtering by: {selectedCarrier.name}</p>
            )}
          </div>
          <button
            onClick={() => { setShowCreate(!showCreate); if (showCreate) { resetForm(); setEditingRule(null); } }}
            className="px-4 py-2 text-sm font-medium text-white bg-[#0D2137] rounded-md hover:bg-[#0a3350]"
            data-testid="button-create"
          >
            {showCreate ? 'Cancel' : 'Add Rule'}
          </button>
        </div>

        {showCreate && (
          <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
            <h3 className="text-lg font-medium text-gray-900 mb-4">
              {editingRule ? 'Edit Appetite Rule' : 'New Appetite Rule'}
            </h3>
            
            <div className="grid grid-cols-2 gap-4 mb-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Carrier</label>
                <select
                  value={formData.carrierId}
                  onChange={(e) => setFormData({ ...formData, carrierId: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-[#00E6A7]"
                  disabled={!!editingRule}
                  data-testid="select-carrier"
                >
                  <option value="">Select Carrier</option>
                  {carriers.map((c) => (
                    <option key={c.id} value={c.id}>{c.name} ({c.marketType === 'STANDARD' ? 'Standard' : 'E&S'})</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Line of Business</label>
                <select
                  value={formData.lob}
                  onChange={(e) => setFormData({ ...formData, lob: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-[#00E6A7]"
                  disabled={!!editingRule}
                  data-testid="select-lob"
                >
                  <option value="COMMERCIAL_GL">Commercial GL</option>
                </select>
              </div>
            </div>

            <div className="border-t border-gray-200 pt-4 mb-4">
              <h4 className="text-sm font-medium text-gray-900 mb-3">Geographic Restrictions</h4>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-2">Allowed States (leave empty for all)</label>
                  <div className="flex flex-wrap gap-1 max-h-32 overflow-y-auto border border-gray-200 rounded p-2">
                    {US_STATES.map(state => (
                      <button
                        key={`allowed-${state}`}
                        type="button"
                        onClick={() => toggleArrayItem('allowedStates', state)}
                        className={`px-2 py-0.5 text-xs rounded ${
                          formData.allowedStates.includes(state)
                            ? 'bg-green-100 text-green-800 font-medium'
                            : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                        }`}
                      >
                        {state}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-2">Excluded States</label>
                  <div className="flex flex-wrap gap-1 max-h-32 overflow-y-auto border border-gray-200 rounded p-2">
                    {US_STATES.map(state => (
                      <button
                        key={`excluded-${state}`}
                        type="button"
                        onClick={() => toggleArrayItem('excludedStates', state)}
                        className={`px-2 py-0.5 text-xs rounded ${
                          formData.excludedStates.includes(state)
                            ? 'bg-red-100 text-red-800 font-medium'
                            : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                        }`}
                      >
                        {state}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            <div className="border-t border-gray-200 pt-4 mb-4">
              <h4 className="text-sm font-medium text-gray-900 mb-3">Industry Restrictions</h4>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-2">Allowed Industries (leave empty for all)</label>
                  <div className="flex flex-wrap gap-1 border border-gray-200 rounded p-2">
                    {COMMON_INDUSTRIES.map(ind => (
                      <button
                        key={`allowed-${ind}`}
                        type="button"
                        onClick={() => toggleArrayItem('allowedIndustries', ind.toLowerCase())}
                        className={`px-2 py-0.5 text-xs rounded ${
                          formData.allowedIndustries.includes(ind.toLowerCase())
                            ? 'bg-green-100 text-green-800 font-medium'
                            : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                        }`}
                      >
                        {ind}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-2">Excluded Industries</label>
                  <div className="flex flex-wrap gap-1 border border-gray-200 rounded p-2">
                    {COMMON_INDUSTRIES.map(ind => (
                      <button
                        key={`excluded-${ind}`}
                        type="button"
                        onClick={() => toggleArrayItem('excludedIndustries', ind.toLowerCase())}
                        className={`px-2 py-0.5 text-xs rounded ${
                          formData.excludedIndustries.includes(ind.toLowerCase())
                            ? 'bg-red-100 text-red-800 font-medium'
                            : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                        }`}
                      >
                        {ind}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            <div className="border-t border-gray-200 pt-4 mb-4">
              <h4 className="text-sm font-medium text-gray-900 mb-3">Financial & Size Limits</h4>
              <div className="grid grid-cols-4 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Min Revenue ($)</label>
                  <input
                    type="number"
                    value={formData.minRevenue}
                    onChange={(e) => setFormData({ ...formData, minRevenue: e.target.value })}
                    placeholder="No min"
                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-[#00E6A7]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Max Revenue ($)</label>
                  <input
                    type="number"
                    value={formData.maxRevenue}
                    onChange={(e) => setFormData({ ...formData, maxRevenue: e.target.value })}
                    placeholder="No max"
                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-[#00E6A7]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Min Employees</label>
                  <input
                    type="number"
                    value={formData.minEmployees}
                    onChange={(e) => setFormData({ ...formData, minEmployees: e.target.value })}
                    placeholder="No min"
                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-[#00E6A7]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Max Employees</label>
                  <input
                    type="number"
                    value={formData.maxEmployees}
                    onChange={(e) => setFormData({ ...formData, maxEmployees: e.target.value })}
                    placeholder="No max"
                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-[#00E6A7]"
                  />
                </div>
              </div>
            </div>

            <div className="border-t border-gray-200 pt-4 mb-4">
              <h4 className="text-sm font-medium text-gray-900 mb-3">Experience & Loss History</h4>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Min Years in Business</label>
                  <input
                    type="number"
                    value={formData.minYearsInBusiness}
                    onChange={(e) => setFormData({ ...formData, minYearsInBusiness: e.target.value })}
                    placeholder="No min"
                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-[#00E6A7]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Max Loss Count (5yr)</label>
                  <input
                    type="number"
                    value={formData.maxLossCount}
                    onChange={(e) => setFormData({ ...formData, maxLossCount: e.target.value })}
                    placeholder="No max"
                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-[#00E6A7]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Max Loss Amount ($, 5yr)</label>
                  <input
                    type="number"
                    value={formData.maxLossAmount}
                    onChange={(e) => setFormData({ ...formData, maxLossAmount: e.target.value })}
                    placeholder="No max"
                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-[#00E6A7]"
                  />
                </div>
              </div>
            </div>

            <div className="border-t border-gray-200 pt-4 mb-6">
              <label className="block text-sm font-medium text-gray-700 mb-1">Summary / Notes</label>
              <textarea
                value={formData.summary}
                onChange={(e) => setFormData({ ...formData, summary: e.target.value })}
                placeholder="Optional summary of this carrier's appetite..."
                rows={2}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-[#00E6A7]"
              />
            </div>

            <div className="flex justify-end gap-2">
              <button
                onClick={() => { setShowCreate(false); resetForm(); setEditingRule(null); }}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200"
              >
                Cancel
              </button>
              <button
                onClick={createRule}
                disabled={isCreating || !formData.carrierId}
                className="px-4 py-2 text-sm font-medium text-white bg-[#00E6A7] rounded-md hover:bg-[#14a09c] disabled:opacity-50"
                data-testid="button-save"
              >
                {isCreating ? 'Saving...' : editingRule ? 'Save New Version' : 'Create Rule'}
              </button>
            </div>
          </div>
        )}

        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Carrier</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Version</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Restrictions Summary</th>
                <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Status</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {filteredRules.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-gray-500">
                    No appetite rules yet. Add your first rule above.
                  </td>
                </tr>
              ) : (
                filteredRules.map((rule) => (
                  <tr key={rule.id} className={`hover:bg-gray-50 ${!rule.isActive ? 'opacity-50' : ''}`} data-testid={`row-rule-${rule.id}`}>
                    <td className="px-4 py-3">
                      <div>
                        <span className="font-medium text-gray-900">{rule.carrier.name}</span>
                        <span className={`ml-2 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                          rule.carrier.marketType === 'STANDARD' ? 'bg-green-100 text-green-800' : 'bg-orange-100 text-orange-800'
                        }`}>
                          {rule.carrier.marketType === 'STANDARD' ? 'Std' : 'E&S'}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                        v{rule.version}
                      </span>
                      {rule.isAgencyOverride && (
                        <span className="ml-1 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-800">
                          Override
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-xs text-gray-600 space-y-0.5">
                        {rule.excludedStates.length > 0 && (
                          <div>Excludes: {rule.excludedStates.slice(0, 5).join(', ')}{rule.excludedStates.length > 5 ? '...' : ''}</div>
                        )}
                        {rule.allowedStates.length > 0 && (
                          <div>Only: {rule.allowedStates.slice(0, 5).join(', ')}{rule.allowedStates.length > 5 ? '...' : ''}</div>
                        )}
                        {rule.maxRevenue && <div>Max Rev: ${rule.maxRevenue.toLocaleString()}</div>}
                        {rule.maxLossCount && <div>Max Claims: {rule.maxLossCount}</div>}
                        {!rule.excludedStates.length && !rule.allowedStates.length && !rule.maxRevenue && !rule.maxLossCount && (
                          <div className="text-gray-400">No restrictions</div>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <button
                        onClick={() => toggleActive(rule.id, rule.isActive)}
                        className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                          rule.isActive ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'
                        }`}
                        data-testid={`button-toggle-${rule.id}`}
                      >
                        {rule.isActive ? 'Active' : 'Inactive'}
                      </button>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => editRule(rule)}
                        className="text-xs font-medium text-blue-600 hover:text-blue-800 mr-3"
                        data-testid={`button-edit-${rule.id}`}
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => deleteRule(rule.id)}
                        className="text-xs font-medium text-red-600 hover:text-red-800"
                        data-testid={`button-delete-${rule.id}`}
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="mt-6 bg-blue-50 border border-blue-200 rounded-lg p-4">
          <h3 className="text-sm font-medium text-blue-900 mb-2">How Appetite Rules Work</h3>
          <ul className="text-sm text-blue-800 space-y-1">
            <li>• Rules are evaluated during lead assessment to match carriers</li>
            <li>• <strong>Allowed</strong> lists are whitelist (if set, must match) / <strong>Excluded</strong> lists are blacklist</li>
            <li>• Creating a new rule for the same carrier/LOB creates a new <strong>version</strong></li>
            <li>• Only the latest <strong>active</strong> version is used during evaluation</li>
            <li>• Empty restrictions mean no limits on that criteria</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
