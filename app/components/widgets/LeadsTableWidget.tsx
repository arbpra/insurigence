'use client';

import Link from 'next/link';

interface Lead {
  id: string;
  insuredName: string;
  primaryContactEmail: string | null;
  lob: string;
  status: string;
  marketClassification: string | null;
  marketConfidence: number | null;
  createdAt: string;
  carrierFits?: Array<{
    carrierId: string;
    carrier: { name: string };
    tier: string;
    score: number;
  }>;
}

interface LeadsTableWidgetProps {
  leads: Lead[];
  onEvaluate: (id: string) => void;
  evaluatingLeadId: string | null;
  isDragging?: boolean;
}

export function LeadsTableWidget({ leads, onEvaluate, evaluatingLeadId, isDragging }: LeadsTableWidgetProps) {
  const formatStatus = (status: string): string => {
    return status.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
  };

  const formatLob = (lob: string): string => {
    switch (lob) {
      case 'COMMERCIAL_GL':
        return 'Commercial GL';
      default:
        return lob;
    }
  };

  const formatDate = (dateString: string): string => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  const getStatusBadgeClass = (status: string): string => {
    switch (status) {
      case 'NEW':
        return 'bg-blue-100 text-blue-800';
      case 'WAITING_ON_INFO':
        return 'bg-yellow-100 text-yellow-800';
      case 'READY_TO_MARKET':
        return 'bg-purple-100 text-purple-800';
      case 'QUOTED':
        return 'bg-indigo-100 text-indigo-800';
      case 'PRESENTED':
        return 'bg-cyan-100 text-cyan-800';
      case 'BOUND':
        return 'bg-green-100 text-green-800';
      case 'LOST':
        return 'bg-red-100 text-red-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  return (
    <div
      className={`bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden transition-all ${
        isDragging ? 'shadow-lg ring-2 ring-blue-400 opacity-90' : ''
      }`}
      data-testid="widget-leads-table"
    >
      <div className="px-4 py-3 border-b border-gray-200 bg-gray-50">
        <h3 className="text-sm font-medium text-gray-700">Recent Leads</h3>
      </div>
      {leads.length === 0 ? (
        <div className="p-8 text-center">
          <p className="text-gray-500 text-sm">No leads yet</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full" data-testid="table-leads">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-600 uppercase">Company</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-600 uppercase">Type</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-600 uppercase">Market</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-600 uppercase">Status</th>
                <th className="px-4 py-2 text-right text-xs font-medium text-gray-600 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {leads.slice(0, 5).map((lead) => (
                <tr key={lead.id} className="hover:bg-gray-50" data-testid={`row-lead-${lead.id}`}>
                  <td className="px-4 py-3">
                    <p className="text-sm font-medium text-gray-900">{lead.insuredName}</p>
                    <p className="text-xs text-gray-500">{formatDate(lead.createdAt)}</p>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-sm text-gray-700">{formatLob(lead.lob)}</span>
                  </td>
                  <td className="px-4 py-3">
                    {lead.marketClassification ? (
                      <div>
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                          lead.marketClassification === 'STANDARD' ? 'bg-green-100 text-green-800' :
                          lead.marketClassification === 'EXCESS_SURPLUS' ? 'bg-orange-100 text-orange-800' :
                          'bg-yellow-100 text-yellow-800'
                        }`}>
                          {formatStatus(lead.marketClassification)}
                        </span>
                        {lead.carrierFits && lead.carrierFits.length > 0 && (
                          <div className="mt-1 flex items-center gap-1">
                            <span className={`w-1.5 h-1.5 rounded-full ${
                              lead.carrierFits[0].tier === 'GOOD_FIT' ? 'bg-green-500' :
                              lead.carrierFits[0].tier === 'POSSIBLE_FIT' ? 'bg-blue-500' :
                              'bg-yellow-500'
                            }`}></span>
                            <span className="text-xs text-gray-500">{lead.carrierFits[0].carrier.name}</span>
                          </div>
                        )}
                      </div>
                    ) : (
                      <span className="text-xs text-gray-400">Not evaluated</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${getStatusBadgeClass(lead.status)}`}>
                      {formatStatus(lead.status)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() => onEvaluate(lead.id)}
                        disabled={evaluatingLeadId === lead.id}
                        className={`text-xs font-medium px-2 py-1 rounded transition-colors ${
                          evaluatingLeadId === lead.id
                            ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                            : 'bg-purple-50 text-purple-700 hover:bg-purple-100'
                        }`}
                        data-testid={`button-evaluate-${lead.id}`}
                      >
                        {evaluatingLeadId === lead.id ? 'Evaluating...' : 'Evaluate'}
                      </button>
                      <Link
                        href={`/leads/${lead.id}/proposal`}
                        className="text-xs font-medium px-2 py-1 rounded bg-blue-50 text-blue-700 hover:bg-blue-100 transition-colors"
                        data-testid={`link-proposal-${lead.id}`}
                      >
                        Proposal
                      </Link>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
