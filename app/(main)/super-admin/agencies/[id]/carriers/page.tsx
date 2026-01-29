'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useAdminAuth } from '../../../layout';

interface AppetiteRule {
  id: string;
  version: number;
  isActive: boolean;
}

interface Carrier {
  id: string;
  name: string;
  marketType: string;
  enabled: boolean;
  priorityRank: number;
  notes: string | null;
  isActive: boolean;
  createdAt: string;
  appetiteRules: AppetiteRule[];
  _count: { appetiteGuides: number };
}

export default function CarriersPage() {
  const params = useParams();
  const agencyId = params.id as string;
  const { authFetch } = useAdminAuth();

  const [carriers, setCarriers] = useState<Carrier[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [newCarrier, setNewCarrier] = useState({ 
    name: '', 
    marketType: 'STANDARD',
    priorityRank: 100,
    notes: '',
  });
  const [isCreating, setIsCreating] = useState(false);
  const [editingCarrier, setEditingCarrier] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Partial<Carrier>>({});

  useEffect(() => {
    fetchCarriers();
  }, [agencyId]);

  const fetchCarriers = async () => {
    try {
      const res = await authFetch(`/api/super-admin/agencies/${agencyId}/carriers`);
      if (res.ok) {
        const data = await res.json();
        setCarriers(data.carriers);
      }
    } finally {
      setIsLoading(false);
    }
  };

  const createCarrier = async () => {
    if (!newCarrier.name.trim()) return;
    setIsCreating(true);
    try {
      const res = await authFetch(`/api/super-admin/agencies/${agencyId}/carriers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newCarrier),
      });
      if (res.ok) {
        setNewCarrier({ name: '', marketType: 'STANDARD', priorityRank: 100, notes: '' });
        setShowCreate(false);
        fetchCarriers();
      }
    } finally {
      setIsCreating(false);
    }
  };

  const toggleEnabled = async (carrierId: string, enabled: boolean) => {
    await authFetch(`/api/super-admin/agencies/${agencyId}/carriers/${carrierId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: !enabled }),
    });
    fetchCarriers();
  };

  const saveEdit = async () => {
    if (!editingCarrier) return;
    await authFetch(`/api/super-admin/agencies/${agencyId}/carriers/${editingCarrier}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(editForm),
    });
    setEditingCarrier(null);
    setEditForm({});
    fetchCarriers();
  };

  const deleteCarrier = async (carrierId: string) => {
    if (!confirm('Are you sure you want to delete this carrier? This will also delete all appetite rules and guides.')) return;
    await authFetch(`/api/super-admin/agencies/${agencyId}/carriers/${carrierId}`, {
      method: 'DELETE',
    });
    fetchCarriers();
  };

  const startEdit = (carrier: Carrier) => {
    setEditingCarrier(carrier.id);
    setEditForm({
      name: carrier.name,
      marketType: carrier.marketType,
      priorityRank: carrier.priorityRank,
      notes: carrier.notes || '',
    });
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-gray-500">Loading...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-6xl mx-auto px-4 py-8">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <Link href={`/super-admin/agencies/${agencyId}`} className="text-sm text-gray-500 hover:text-gray-700 mb-2 inline-block" data-testid="link-back">
              Back to Agency
            </Link>
            <h1 className="text-2xl font-semibold text-gray-900">Carrier Registry</h1>
            <p className="text-sm text-gray-500 mt-1">Manage carriers and their appetite rules for this agency</p>
          </div>
          <button
            onClick={() => setShowCreate(!showCreate)}
            className="px-4 py-2 text-sm font-medium text-white bg-[#0D2137] rounded-md hover:bg-[#0a3350]"
            data-testid="button-create"
          >
            Add Carrier
          </button>
        </div>

        {showCreate && (
          <div className="bg-white rounded-lg border border-gray-200 p-4 mb-6">
            <h3 className="text-sm font-medium text-gray-900 mb-3">New Carrier</h3>
            <div className="grid grid-cols-2 gap-3 mb-3">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Name</label>
                <input
                  type="text"
                  value={newCarrier.name}
                  onChange={(e) => setNewCarrier({ ...newCarrier, name: e.target.value })}
                  placeholder="e.g., Hartford, Travelers, Markel"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-[#00E6A7]"
                  data-testid="input-carrier-name"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Market Type</label>
                <select
                  value={newCarrier.marketType}
                  onChange={(e) => setNewCarrier({ ...newCarrier, marketType: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-[#00E6A7]"
                  data-testid="select-market-type"
                >
                  <option value="STANDARD">Standard Market</option>
                  <option value="EXCESS_SURPLUS">E&S Market</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Priority Rank</label>
                <input
                  type="number"
                  value={newCarrier.priorityRank}
                  onChange={(e) => setNewCarrier({ ...newCarrier, priorityRank: parseInt(e.target.value) || 100 })}
                  min={1}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-[#00E6A7]"
                  data-testid="input-priority"
                />
                <p className="text-xs text-gray-500 mt-1">Lower number = higher priority</p>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Notes (optional)</label>
                <input
                  type="text"
                  value={newCarrier.notes}
                  onChange={(e) => setNewCarrier({ ...newCarrier, notes: e.target.value })}
                  placeholder="Internal notes about this carrier"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-[#00E6A7]"
                  data-testid="input-notes"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowCreate(false)}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200"
                data-testid="button-cancel"
              >
                Cancel
              </button>
              <button
                onClick={createCarrier}
                disabled={isCreating || !newCarrier.name.trim()}
                className="px-4 py-2 text-sm font-medium text-white bg-[#00E6A7] rounded-md hover:bg-[#14a09c] disabled:opacity-50"
                data-testid="button-save"
              >
                {isCreating ? 'Adding...' : 'Add Carrier'}
              </button>
            </div>
          </div>
        )}

        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Priority</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Carrier</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Market</th>
                <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Appetite Rules</th>
                <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Guides</th>
                <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Enabled</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {carriers.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-gray-500">
                    No carriers yet. Add your first carrier above.
                  </td>
                </tr>
              ) : (
                carriers.map((carrier) => (
                  <tr key={carrier.id} className="hover:bg-gray-50" data-testid={`row-carrier-${carrier.id}`}>
                    {editingCarrier === carrier.id ? (
                      <>
                        <td className="px-4 py-3">
                          <input
                            type="number"
                            value={editForm.priorityRank || 100}
                            onChange={(e) => setEditForm({ ...editForm, priorityRank: parseInt(e.target.value) || 100 })}
                            className="w-16 px-2 py-1 border border-gray-300 rounded text-sm"
                            min={1}
                          />
                        </td>
                        <td className="px-4 py-3">
                          <input
                            type="text"
                            value={editForm.name || ''}
                            onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                            className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
                          />
                        </td>
                        <td className="px-4 py-3">
                          <select
                            value={editForm.marketType || 'STANDARD'}
                            onChange={(e) => setEditForm({ ...editForm, marketType: e.target.value })}
                            className="px-2 py-1 border border-gray-300 rounded text-sm"
                          >
                            <option value="STANDARD">Standard</option>
                            <option value="EXCESS_SURPLUS">E&S</option>
                          </select>
                        </td>
                        <td className="px-4 py-3 text-center">-</td>
                        <td className="px-4 py-3 text-center">-</td>
                        <td className="px-4 py-3 text-center">-</td>
                        <td className="px-4 py-3 text-right">
                          <button
                            onClick={saveEdit}
                            className="text-xs font-medium text-green-600 hover:text-green-800 mr-3"
                          >
                            Save
                          </button>
                          <button
                            onClick={() => { setEditingCarrier(null); setEditForm({}); }}
                            className="text-xs font-medium text-gray-600 hover:text-gray-800"
                          >
                            Cancel
                          </button>
                        </td>
                      </>
                    ) : (
                      <>
                        <td className="px-4 py-3">
                          <span className="text-sm font-medium text-gray-600">#{carrier.priorityRank}</span>
                        </td>
                        <td className="px-4 py-3">
                          <div>
                            <span className="font-medium text-gray-900">{carrier.name}</span>
                            {carrier.notes && (
                              <p className="text-xs text-gray-500 mt-0.5">{carrier.notes}</p>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                            carrier.marketType === 'STANDARD' ? 'bg-green-100 text-green-800' : 'bg-orange-100 text-orange-800'
                          }`}>
                            {carrier.marketType === 'STANDARD' ? 'Standard' : 'E&S'}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-center">
                          {carrier.appetiteRules.length > 0 ? (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                              v{carrier.appetiteRules[0].version}
                            </span>
                          ) : (
                            <span className="text-xs text-gray-400">None</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span className="text-sm text-gray-600">{carrier._count.appetiteGuides}</span>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <button
                            onClick={() => toggleEnabled(carrier.id, carrier.enabled)}
                            className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                              carrier.enabled ? 'bg-[#00E6A7]' : 'bg-gray-200'
                            }`}
                            data-testid={`button-toggle-${carrier.id}`}
                          >
                            <span className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                              carrier.enabled ? 'translate-x-4' : 'translate-x-0'
                            }`} />
                          </button>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <Link
                            href={`/super-admin/agencies/${agencyId}/appetite-rules?carrierId=${carrier.id}`}
                            className="text-xs font-medium text-[#00E6A7] hover:text-[#14a09c] mr-3"
                            data-testid={`link-rules-${carrier.id}`}
                          >
                            Rules
                          </Link>
                          <button
                            onClick={() => startEdit(carrier)}
                            className="text-xs font-medium text-blue-600 hover:text-blue-800 mr-3"
                            data-testid={`button-edit-${carrier.id}`}
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => deleteCarrier(carrier.id)}
                            className="text-xs font-medium text-red-600 hover:text-red-800"
                            data-testid={`button-delete-${carrier.id}`}
                          >
                            Delete
                          </button>
                        </td>
                      </>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="mt-6 bg-blue-50 border border-blue-200 rounded-lg p-4">
          <h3 className="text-sm font-medium text-blue-900 mb-2">How Carrier Registry Works</h3>
          <ul className="text-sm text-blue-800 space-y-1">
            <li>• Only <strong>enabled</strong> carriers are considered during lead evaluation</li>
            <li>• <strong>Priority rank</strong> determines order when multiple carriers are equally fit</li>
            <li>• Each carrier needs <strong>appetite rules</strong> configured to be evaluated</li>
            <li>• Upload <strong>appetite guides</strong> (PDF/DOC) for reference during manual review</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
