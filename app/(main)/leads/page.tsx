'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AppLayout } from '@/components/AppLayout';
import { PageHeader, StatCard, Badge, Button, DataTable } from '@/components/ui';
import LeadDetailsModal from '@/components/LeadDetailsModal';

interface Lead {
  id: string;
  insuredName: string;
  primaryContactEmail: string | null;
  lob: string;
  status: string;
  source: 'INTERNAL' | 'EXTERNAL';
  marketClassification: string | null;
  marketConfidence: number | null;
  marketReasonCodes?: string[];
  archivedAt?: string | null;
  createdAt: string;
  intakeSubmission?: { responses: Record<string, unknown> };
}

interface Stats {
  totalLeads: number;
  evaluated: number;
  standardCount: number;
  esCount: number;
  borderlineCount: number;
}

type MarketFilter = 'all' | 'STANDARD' | 'EXCESS_SURPLUS' | 'BORDERLINE' | 'evaluated';

export default function LeadsPage() {
  const router = useRouter();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [stats, setStats] = useState<Stats>({
    totalLeads: 0,
    evaluated: 0,
    standardCount: 0,
    esCount: 0,
    borderlineCount: 0,
  });
  const [isLoading, setIsLoading] = useState(true);
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [marketFilter, setMarketFilter] = useState<MarketFilter>('all');
  const [view, setView] = useState<'active' | 'archived'>('active');
  const leadsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setIsLoading(true);
    fetchLeads();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  const fetchLeads = async () => {
    try {
      const response = await fetch(`/api/leads${view === 'archived' ? '?archived=true' : ''}`);
      if (response.ok) {
        const data = await response.json();
        setLeads(data.leads || []);
        setStats(data.stats || {});
      }
    } finally {
      setIsLoading(false);
    }
  };

  // Click a KPI card → filter the table to that category and scroll to it.
  const drillDown = (filter: MarketFilter) => {
    setMarketFilter(filter);
    setTimeout(() => leadsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
  };

  const filteredLeads = leads.filter((lead) => {
    if (marketFilter === 'all') return true;
    if (marketFilter === 'evaluated') return lead.marketClassification !== null;
    return lead.marketClassification === marketFilter;
  });

  const getLobLabel = (lob: string) => {
    switch (lob) {
      case 'COMMERCIAL_GL': return 'Commercial GL';
      case 'COMMERCIAL_PROPERTY': return 'Commercial Property';
      case 'WORKERS_COMP': return 'Workers Comp';
      default: return lob.replace(/_/g, ' ');
    }
  };

  const getMarketBadgeVariant = (classification: string | null): 'standard' | 'es' | 'borderline' | 'new' => {
    switch (classification) {
      case 'STANDARD': return 'standard';
      case 'EXCESS_SURPLUS': return 'es';
      case 'BORDERLINE': return 'borderline';
      default: return 'new';
    }
  };

  const getMarketLabel = (classification: string | null) => {
    switch (classification) {
      case 'STANDARD': return 'Standard';
      case 'EXCESS_SURPLUS': return 'E&S';
      case 'BORDERLINE': return 'Borderline';
      default: return 'Pending';
    }
  };

  const getStatusBadgeVariant = (status: string): 'pending' | 'reviewed' | 'converted' | 'new' => {
    switch (status) {
      case 'NEW': return 'new';
      case 'EVALUATED': return 'reviewed';
      case 'QUOTED': return 'pending';
      case 'BOUND': return 'converted';
      default: return 'new';
    }
  };

  const tableColumns = [
    {
      key: 'insuredName',
      header: 'Company',
      render: (lead: Lead) => (
        <div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setSelectedLead(lead); }}
              className="font-medium text-slate-900 hover:text-[var(--brand-accent)] hover:underline text-left"
              data-testid={`button-lead-details-${lead.id}`}
            >
              {lead.insuredName}
            </button>
            {lead.source === 'EXTERNAL' && (
              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-purple-100 text-purple-700">
                External
              </span>
            )}
          </div>
          <p className="text-xs text-slate-500">{lead.primaryContactEmail}</p>
        </div>
      ),
    },
    {
      key: 'lob',
      header: 'Line of Business',
      render: (lead: Lead) => (
        <span className="text-slate-600">{getLobLabel(lead.lob)}</span>
      ),
    },
    {
      key: 'marketClassification',
      header: 'Market',
      render: (lead: Lead) => (
        <Badge variant={getMarketBadgeVariant(lead.marketClassification)}>
          {getMarketLabel(lead.marketClassification)}
        </Badge>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (lead: Lead) => (
        <Badge variant={getStatusBadgeVariant(lead.status)}>
          {lead.status.replace('_', ' ')}
        </Badge>
      ),
    },
    {
      key: 'createdAt',
      header: 'Created',
      render: (lead: Lead) => (
        <span className="text-slate-500">
          {new Date(lead.createdAt).toLocaleDateString()}
        </span>
      ),
    },
    {
      key: 'actions',
      header: '',
      className: 'text-right',
      render: (lead: Lead) => (
        // The row itself is clickable, so a click on these buttons would bubble
        // up and navigate to the row's destination instead of the button's.
        <div
          className="flex items-center justify-end gap-2"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Entry point to quote entry and the proposal builder. Without this
              the whole quote-proposal flow is only reachable by typing a URL. */}
          <Button
            variant="primary"
            size="sm"
            href={`/leads/${lead.id}/quotes`}
            testId={`button-quotes-${lead.id}`}
          >
            Quotes &amp; Proposal
          </Button>
          <Button
            variant="secondary"
            size="sm"
            href={`/leads/${lead.id}/proposal`}
            testId={`button-view-${lead.id}`}
          >
            View
          </Button>
        </div>
      ),
    },
  ];

  if (isLoading) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center py-20">
          <div className="flex flex-col items-center gap-4">
            <div className="w-10 h-10 border-3 border-slate-200 rounded-full animate-spin" style={{ borderTopColor: 'var(--brand-primary)' }}></div>
            <p style={{ color: 'var(--brand-text-muted)' }} className="text-sm font-medium">Loading leads...</p>
          </div>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <PageHeader
        title="All Leads"
        subtitle="View and manage all leads in your pipeline"
        actions={
          <Button
            variant="primary"
            href="/intake/commercial-gl"
            testId="button-new-intake"
            icon={
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
            }
          >
            New Intake
          </Button>
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-8">
        <StatCard label="Total Leads" value={stats.totalLeads} variant="default" onClick={() => drillDown('all')} active={marketFilter === 'all'} />
        <StatCard label="Evaluated" value={stats.evaluated} variant="accent" onClick={() => drillDown('evaluated')} active={marketFilter === 'evaluated'} />
        <StatCard label="Standard" value={stats.standardCount} variant="standard" onClick={() => drillDown('STANDARD')} active={marketFilter === 'STANDARD'} />
        <StatCard label="E&S" value={stats.esCount} variant="es" onClick={() => drillDown('EXCESS_SURPLUS')} active={marketFilter === 'EXCESS_SURPLUS'} />
        <StatCard label="Borderline" value={stats.borderlineCount} variant="borderline" onClick={() => drillDown('BORDERLINE')} active={marketFilter === 'BORDERLINE'} />
      </div>

      <div ref={leadsRef} className="bg-white rounded-xl border border-slate-200/80 shadow-sm scroll-mt-6">
        <div className="p-4 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-semibold" style={{ color: 'var(--brand-primary)' }}>
              {view === 'archived' ? 'Archived Leads' : 'All Leads'} ({filteredLeads.length})
            </h2>
            {marketFilter !== 'all' && (
              <button
                onClick={() => setMarketFilter('all')}
                className="text-xs text-slate-500 hover:text-slate-800 underline"
              >
                Clear filter
              </button>
            )}
          </div>
          <div className="inline-flex rounded-lg border border-slate-200 overflow-hidden text-xs">
            <button
              onClick={() => setView('active')}
              className={`px-3 py-1.5 ${view === 'active' ? 'bg-[#07496C] text-white' : 'bg-white text-slate-500'}`}
              data-testid="view-active"
            >
              Active
            </button>
            <button
              onClick={() => setView('archived')}
              className={`px-3 py-1.5 ${view === 'archived' ? 'bg-[#07496C] text-white' : 'bg-white text-slate-500'}`}
              data-testid="view-archived"
            >
              Archived
            </button>
          </div>
        </div>

        {leads.length === 0 ? (
          <div className="p-12 text-center">
            <div className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4" style={{ backgroundColor: 'rgba(11, 60, 93, 0.05)' }}>
              <svg className="w-8 h-8" style={{ color: 'var(--brand-primary)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </div>
            <h3 className="text-lg font-semibold mb-2" style={{ color: 'var(--brand-primary)' }}>
              {view === 'archived' ? 'No archived leads' : 'No leads yet'}
            </h3>
            {view === 'active' && (
              <>
                <p className="text-sm text-slate-500 mb-6">Create your first intake to start building your pipeline.</p>
                <Button variant="primary" href="/intake/commercial-gl">Create First Intake</Button>
              </>
            )}
          </div>
        ) : filteredLeads.length === 0 ? (
          <div className="p-8 text-center">
            <p className="text-sm text-slate-500">No leads match this filter.</p>
          </div>
        ) : (
          <DataTable
            columns={tableColumns}
            data={filteredLeads}
            keyExtractor={(lead) => lead.id}
            onRowClick={(lead) => router.push(`/leads/${lead.id}/proposal`)}
            testId="leads-table"
          />
        )}
      </div>

      {selectedLead && (
        <LeadDetailsModal
          lead={selectedLead}
          onClose={() => setSelectedLead(null)}
          onChanged={() => {
            setSelectedLead(null);
            fetchLeads();
          }}
        />
      )}
    </AppLayout>
  );
}
