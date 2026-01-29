'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { AppLayout } from '@/components/AppLayout';
import { PageHeader, StatCard, Badge, Button, DataTable } from '@/components/ui';

interface Lead {
  id: string;
  insuredName: string;
  primaryContactEmail: string | null;
  lob: string;
  status: string;
  source: 'INTERNAL' | 'EXTERNAL';
  marketClassification: string | null;
  marketConfidence: number | null;
  marketReasonCodes: string[];
  createdAt: string;
  intakeSubmission?: {
    id: string;
    responses: Record<string, unknown>;
  };
  carrierFits?: Array<{
    carrierId: string;
    carrier: { name: string };
    tier: string;
    score: number;
  }>;
  proposals?: Array<{
    id: string;
    status: string;
  }>;
}

interface Stats {
  totalLeads: number;
  pendingReview: number;
  converted: number;
  thisMonth: number;
  evaluated: number;
  standardCount: number;
  esCount: number;
  borderlineCount: number;
}

type MarketFilter = 'all' | 'STANDARD' | 'EXCESS_SURPLUS' | 'BORDERLINE' | 'pending';
type StatusFilter = 'all' | 'NEW' | 'EVALUATED' | 'QUOTED' | 'BOUND';

export default function DashboardPage() {
  const searchParams = useSearchParams();
  const showSuccess = searchParams.get('success') === 'true';
  
  const [leads, setLeads] = useState<Lead[]>([]);
  const [stats, setStats] = useState<Stats>({
    totalLeads: 0,
    pendingReview: 0,
    converted: 0,
    thisMonth: 0,
    evaluated: 0,
    standardCount: 0,
    esCount: 0,
    borderlineCount: 0,
  });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showSuccessToast, setShowSuccessToast] = useState(showSuccess);
  const [evaluatingLeadId, setEvaluatingLeadId] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [marketFilter, setMarketFilter] = useState<MarketFilter>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

  useEffect(() => {
    fetchLeads();
  }, []);

  const evaluateLead = async (leadId: string) => {
    setEvaluatingLeadId(leadId);
    try {
      const response = await fetch(`/api/leads/${leadId}/evaluate`, {
        method: 'POST',
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to evaluate lead');
      }
      await fetchLeads();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to evaluate lead');
    } finally {
      setEvaluatingLeadId(null);
    }
  };

  useEffect(() => {
    if (showSuccessToast) {
      const timer = setTimeout(() => setShowSuccessToast(false), 5000);
      return () => clearTimeout(timer);
    }
  }, [showSuccessToast]);

  const fetchLeads = async () => {
    try {
      const response = await fetch('/api/leads');
      if (!response.ok) {
        throw new Error('Failed to fetch leads');
      }
      const data = await response.json();
      setLeads(data.leads || []);
      setStats(data.stats || {
        totalLeads: 0,
        pendingReview: 0,
        converted: 0,
        thisMonth: 0,
        evaluated: 0,
        standardCount: 0,
        esCount: 0,
        borderlineCount: 0,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setIsLoading(false);
    }
  };

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await fetchLeads();
    setIsRefreshing(false);
  };

  const exportCSV = () => {
    const csvContent = leads.length > 0 
      ? ['Company,LOB,Status,Market,Created']
          .concat(leads.map(l => 
            `"${l.insuredName}","${getLobLabel(l.lob)}","${l.status}","${l.marketClassification || 'Pending'}","${new Date(l.createdAt).toLocaleDateString()}"`
          ))
          .join('\n')
      : 'Company,LOB,Status,Market,Created';
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `leads-export-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
  };

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

  const filteredLeads = leads.filter(lead => {
    if (marketFilter !== 'all') {
      if (marketFilter === 'pending' && lead.marketClassification !== null) return false;
      if (marketFilter !== 'pending' && lead.marketClassification !== marketFilter) return false;
    }
    if (statusFilter !== 'all' && lead.status !== statusFilter) return false;
    return true;
  });

  const sortedLeads = [...filteredLeads].sort((a, b) => {
    if (!a.marketClassification && b.marketClassification) return -1;
    if (a.marketClassification && !b.marketClassification) return 1;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });

  const tableColumns = [
    {
      key: 'insuredName',
      header: 'Company',
      render: (lead: Lead) => (
        <div>
          <div className="flex items-center gap-2">
            <p className="font-medium text-slate-900">{lead.insuredName}</p>
            {lead.source === 'EXTERNAL' && (
              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-purple-100 text-purple-700">
                External
              </span>
            )}
          </div>
          <p className="text-xs text-slate-500">{getLobLabel(lead.lob)}</p>
        </div>
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
      render: (lead: Lead) => {
        const needsEvaluation = !lead.marketClassification;
        const isEvaluating = evaluatingLeadId === lead.id;
        
        return (
          <div className="flex items-center justify-end gap-2">
            {needsEvaluation ? (
              <Button
                variant="accent"
                size="sm"
                onClick={() => evaluateLead(lead.id)}
                loading={isEvaluating}
                testId={`button-evaluate-${lead.id}`}
              >
                Evaluate
              </Button>
            ) : (
              <Button
                variant="secondary"
                size="sm"
                href={`/leads/${lead.id}/proposal`}
                testId={`button-proposal-${lead.id}`}
              >
                Proposal
              </Button>
            )}
          </div>
        );
      },
    },
  ];

  if (isLoading) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center py-20">
          <div className="flex flex-col items-center gap-4">
            <div className="w-10 h-10 border-3 border-slate-200 rounded-full animate-spin" style={{ borderTopColor: 'var(--brand-primary)' }}></div>
            <p style={{ color: 'var(--brand-text-muted)' }} className="text-sm font-medium">Loading dashboard...</p>
          </div>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      {showSuccessToast && (
        <div className="fixed top-20 right-6 z-50 bg-white border border-slate-200 rounded-xl shadow-lg p-4 flex items-center gap-3" data-testid="toast-success">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: 'var(--market-standard-bg)' }}>
            <svg className="w-4 h-4" style={{ color: 'var(--market-standard)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <div>
            <p className="text-sm font-medium text-slate-900">Lead Created</p>
            <p className="text-xs text-slate-500">Ready for evaluation</p>
          </div>
          <button
            onClick={() => setShowSuccessToast(false)}
            className="p-1 hover:bg-slate-100 rounded-lg transition-colors text-slate-400"
            data-testid="button-close-toast"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      <PageHeader
        title="Dashboard"
        subtitle="Overview of your placement pipeline"
        actions={
          <>
            <Button
              variant="ghost"
              size="icon"
              onClick={handleRefresh}
              loading={isRefreshing}
              testId="button-refresh"
              icon={
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              }
            >
              Refresh
            </Button>
            <Button
              variant="secondary"
              onClick={exportCSV}
              testId="button-export"
              icon={
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
              }
            >
              Export
            </Button>
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
          </>
        }
      />

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-6 flex items-center gap-3" data-testid="error-state">
          <div className="w-8 h-8 bg-red-100 rounded-lg flex items-center justify-center flex-shrink-0">
            <svg className="w-4 h-4 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <div className="flex-1">
            <p className="text-sm font-medium text-red-800">{error}</p>
          </div>
          <button onClick={fetchLeads} className="text-sm text-red-600 hover:text-red-800 font-medium">
            Retry
          </button>
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-8" data-testid="kpi-cards">
        <StatCard
          label="Total Leads"
          value={stats.totalLeads}
          variant="default"
          testId="stat-total-leads"
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          }
        />
        <StatCard
          label="Evaluated"
          value={stats.evaluated}
          variant="accent"
          testId="stat-evaluated"
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          }
        />
        <StatCard
          label="Standard"
          value={stats.standardCount}
          variant="standard"
          testId="stat-standard"
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5 13l4 4L19 7" />
            </svg>
          }
        />
        <StatCard
          label="E&S"
          value={stats.esCount}
          variant="es"
          testId="stat-es"
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          }
        />
        <StatCard
          label="Borderline"
          value={stats.borderlineCount}
          variant="borderline"
          testId="stat-borderline"
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          }
        />
      </div>

      <div className="bg-white rounded-xl border border-slate-200/80 shadow-sm mb-6">
        <div className="p-4 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <h2 className="text-lg font-semibold" style={{ color: 'var(--brand-primary)' }}>
            Recent Leads
          </h2>
          <div className="flex items-center gap-3 flex-wrap">
            <select
              value={marketFilter}
              onChange={(e) => setMarketFilter(e.target.value as MarketFilter)}
              className="text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-offset-1"
              style={{ ['--tw-ring-color' as string]: 'var(--brand-accent)' }}
              data-testid="filter-market"
            >
              <option value="all">All Markets</option>
              <option value="STANDARD">Standard</option>
              <option value="EXCESS_SURPLUS">E&S</option>
              <option value="BORDERLINE">Borderline</option>
              <option value="pending">Pending</option>
            </select>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
              className="text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-offset-1"
              style={{ ['--tw-ring-color' as string]: 'var(--brand-accent)' }}
              data-testid="filter-status"
            >
              <option value="all">All Statuses</option>
              <option value="NEW">New</option>
              <option value="EVALUATED">Evaluated</option>
              <option value="QUOTED">Quoted</option>
              <option value="BOUND">Bound</option>
            </select>
          </div>
        </div>

        {leads.length === 0 ? (
          <div className="p-12 text-center">
            <div className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4" style={{ backgroundColor: 'rgba(11, 60, 93, 0.05)' }}>
              <svg className="w-8 h-8" style={{ color: 'var(--brand-primary)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <h3 className="text-lg font-semibold mb-2" style={{ color: 'var(--brand-primary)' }}>Welcome to Insurigence</h3>
            <p className="text-sm text-slate-500 mb-6 max-w-sm mx-auto">
              Create your first intake to start evaluating risks and generating proposals.
            </p>
            <Button
              variant="primary"
              href="/intake/commercial-gl"
              icon={
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
              }
            >
              Create First Intake
            </Button>
          </div>
        ) : sortedLeads.length === 0 ? (
          <div className="p-8 text-center">
            <p className="text-sm text-slate-500">No leads match your filters</p>
          </div>
        ) : (
          <DataTable
            columns={tableColumns}
            data={sortedLeads}
            keyExtractor={(lead) => lead.id}
            testId="leads-table"
          />
        )}
      </div>
    </AppLayout>
  );
}
