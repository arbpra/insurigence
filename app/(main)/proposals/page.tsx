'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AppLayout } from '@/components/AppLayout';
import { PageHeader, Badge, Button, DataTable } from '@/components/ui';

interface Proposal {
  id: string;
  status: string;
  createdAt: string;
  lead: {
    id: string;
    insuredName: string;
    lob: string;
    marketClassification: string | null;
  };
}

export default function ProposalsPage() {
  const router = useRouter();
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetchProposals();
  }, []);

  const fetchProposals = async () => {
    try {
      const response = await fetch('/api/leads');
      if (response.ok) {
        const data = await response.json();
        const leadsWithProposals = (data.leads || [])
          .filter((lead: { proposals?: Proposal[] }) => lead.proposals && lead.proposals.length > 0)
          .flatMap((lead: { id: string; insuredName: string; lob: string; marketClassification: string | null; proposals: Proposal[] }) => 
            lead.proposals.map((proposal: Proposal) => ({
              ...proposal,
              lead: {
                id: lead.id,
                insuredName: lead.insuredName,
                lob: lead.lob,
                marketClassification: lead.marketClassification,
              }
            }))
          );
        setProposals(leadsWithProposals);
      }
    } finally {
      setIsLoading(false);
    }
  };

  const getLobLabel = (lob: string) => {
    switch (lob) {
      case 'COMMERCIAL_GL': return 'Commercial GL';
      case 'COMMERCIAL_PROPERTY': return 'Commercial Property';
      case 'WORKERS_COMP': return 'Workers Comp';
      default: return lob.replace(/_/g, ' ');
    }
  };

  const getStatusBadgeVariant = (status: string): 'pending' | 'reviewed' | 'converted' | 'new' => {
    switch (status) {
      case 'DRAFT': return 'new';
      case 'SHARED': return 'reviewed';
      case 'VIEWED': return 'converted';
      default: return 'new';
    }
  };

  const tableColumns = [
    {
      key: 'insuredName',
      header: 'Company',
      render: (proposal: Proposal) => (
        <div>
          <p className="font-medium text-slate-900">{proposal.lead.insuredName}</p>
          <p className="text-xs text-slate-500">{getLobLabel(proposal.lead.lob)}</p>
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (proposal: Proposal) => (
        <Badge variant={getStatusBadgeVariant(proposal.status)}>
          {proposal.status}
        </Badge>
      ),
    },
    {
      key: 'createdAt',
      header: 'Created',
      render: (proposal: Proposal) => (
        <span className="text-slate-500">
          {new Date(proposal.createdAt).toLocaleDateString()}
        </span>
      ),
    },
    {
      key: 'actions',
      header: '',
      className: 'text-right',
      render: (proposal: Proposal) => (
        <Button
          variant="secondary"
          size="sm"
          href={`/leads/${proposal.lead.id}/proposal`}
          testId={`button-view-${proposal.id}`}
        >
          View
        </Button>
      ),
    },
  ];

  if (isLoading) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center py-20">
          <div className="flex flex-col items-center gap-4">
            <div className="w-10 h-10 border-3 border-slate-200 rounded-full animate-spin" style={{ borderTopColor: 'var(--brand-primary)' }}></div>
            <p style={{ color: 'var(--brand-text-muted)' }} className="text-sm font-medium">Loading proposals...</p>
          </div>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <PageHeader
        title="Proposals"
        subtitle="View and manage all generated proposals"
      />

      <div className="bg-white rounded-xl border border-slate-200/80 shadow-sm">
        <div className="p-4 border-b border-slate-100">
          <h2 className="text-lg font-semibold" style={{ color: 'var(--brand-primary)' }}>
            All Proposals ({proposals.length})
          </h2>
        </div>
        
        {proposals.length === 0 ? (
          <div className="p-12 text-center">
            <div className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4" style={{ backgroundColor: 'rgba(11, 60, 93, 0.05)' }}>
              <svg className="w-8 h-8" style={{ color: 'var(--brand-primary)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 7v8a2 2 0 002 2h6M8 7V5a2 2 0 012-2h4.586a1 1 0 01.707.293l4.414 4.414a1 1 0 01.293.707V15a2 2 0 01-2 2h-2M8 7H6a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2v-2" />
              </svg>
            </div>
            <h3 className="text-lg font-semibold mb-2" style={{ color: 'var(--brand-primary)' }}>No proposals yet</h3>
            <p className="text-sm text-slate-500 mb-6">Proposals are created after evaluating leads. Evaluate a lead to generate a proposal.</p>
            <Button variant="primary" href="/dashboard">Go to Dashboard</Button>
          </div>
        ) : (
          <DataTable
            columns={tableColumns}
            data={proposals}
            keyExtractor={(proposal) => proposal.id}
            onRowClick={(proposal) => router.push(`/leads/${proposal.lead.id}/proposal`)}
            testId="proposals-table"
          />
        )}
      </div>
    </AppLayout>
  );
}
