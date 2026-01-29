'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';

interface InsuredSummary {
  name: string;
  industry: string;
  states: string[];
  revenue: string;
  yearsInBusiness: string;
}

interface CarrierFit {
  carrierId: string;
  carrierName: string;
  tier: string;
  score: number;
  reasons: string[];
}

interface Lead {
  id: string;
  insuredName: string;
  lob: string;
  status: string;
  marketClassification: string | null;
  marketConfidence: number | null;
  marketReasonCodes: string[];
}

interface Proposal {
  id: string;
  title: string;
  status: string;
  marketSummary: string | null;
  agentRecommendation: string | null;
  publicToken: string | null;
  createdAt: string;
}

export default function ProposalPage() {
  const params = useParams();
  const leadId = params.id as string;

  const [lead, setLead] = useState<Lead | null>(null);
  const [insuredSummary, setInsuredSummary] = useState<InsuredSummary | null>(null);
  const [carrierFits, setCarrierFits] = useState<CarrierFit[]>([]);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [agentRecommendation, setAgentRecommendation] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showCopied, setShowCopied] = useState(false);
  const [showDetails, setShowDetails] = useState(false);

  useEffect(() => {
    fetchData();
  }, [leadId]);

  const fetchData = async () => {
    try {
      const response = await fetch(`/api/leads/${leadId}/proposal`);
      if (!response.ok) {
        throw new Error('Failed to fetch lead data');
      }
      const data = await response.json();
      setLead(data.lead);
      setInsuredSummary(data.insuredSummary);
      setCarrierFits(data.carrierFits);
      if (data.latestProposal) {
        setProposal(data.latestProposal);
        setAgentRecommendation(data.latestProposal.agentRecommendation || '');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setIsLoading(false);
    }
  };

  const generateProposal = async () => {
    setIsGenerating(true);
    try {
      const response = await fetch(`/api/leads/${leadId}/proposal`, {
        method: 'POST',
      });
      if (!response.ok) {
        throw new Error('Failed to generate proposal');
      }
      const data = await response.json();
      setProposal(data.proposal);
      setAgentRecommendation(data.proposal.agentRecommendation || '');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate proposal');
    } finally {
      setIsGenerating(false);
    }
  };

  const saveRecommendation = async () => {
    if (!proposal) return;
    setIsSaving(true);
    try {
      const response = await fetch(`/api/leads/${leadId}/proposal`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ proposalId: proposal.id, agentRecommendation }),
      });
      if (!response.ok) {
        throw new Error('Failed to save recommendation');
      }
      const data = await response.json();
      setProposal({ ...proposal, agentRecommendation: data.proposal.agentRecommendation });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setIsSaving(false);
    }
  };

  const shareProposal = async () => {
    if (!proposal) return;
    try {
      const response = await fetch(`/api/leads/${leadId}/proposal`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ proposalId: proposal.id, status: 'SHARED' }),
      });
      if (response.ok) {
        setProposal({ ...proposal, status: 'SHARED' });
      }
    } catch (err) {
      console.error('Failed to share proposal:', err);
    }
  };

  const copyShareLink = () => {
    if (!proposal?.publicToken) return;
    const url = `${window.location.origin}/proposal/${proposal.publicToken}`;
    navigator.clipboard.writeText(url);
    setShowCopied(true);
    setTimeout(() => setShowCopied(false), 2000);
  };

  const getMarketDirection = (classification: string | null) => {
    switch (classification) {
      case 'STANDARD':
        return { 
          label: 'Standard Market', 
          bgColor: 'var(--market-standard-bg)', 
          textColor: 'var(--market-standard)', 
          borderColor: 'var(--market-standard-border)',
          dotColor: 'var(--market-standard)'
        };
      case 'EXCESS_SURPLUS':
        return { 
          label: 'E&S Market', 
          bgColor: 'var(--market-es-bg)', 
          textColor: 'var(--market-es)', 
          borderColor: 'var(--market-es-border)',
          dotColor: 'var(--market-es)'
        };
      case 'BORDERLINE':
        return { 
          label: 'Borderline', 
          bgColor: 'var(--market-borderline-bg)', 
          textColor: 'var(--market-borderline)', 
          borderColor: 'var(--market-borderline-border)',
          dotColor: 'var(--market-borderline)'
        };
      default:
        return { 
          label: 'Pending', 
          bgColor: '#F8FAFC', 
          textColor: '#64748B', 
          borderColor: '#E2E8F0',
          dotColor: '#94A3B8'
        };
    }
  };

  const getHumanReadableReasons = (reasonCodes: string[]): string[] => {
    const reasonMap: Record<string, string> = {
      'HIGH_REVENUE': 'Higher revenue may require specialized underwriting',
      'NEW_BUSINESS': 'Newer businesses often need E&S placement',
      'HIGH_RISK_INDUSTRY': 'Industry classification requires careful carrier selection',
      'CLAIMS_HISTORY': 'Claims history is a factor in market placement',
      'MULTI_STATE': 'Multi-state operations add complexity',
      'STANDARD_RISK': 'Risk profile fits standard market criteria',
      'ESTABLISHED_BUSINESS': 'Business tenure supports standard placement',
      'CLEAN_HISTORY': 'Clean claims history is favorable',
      'LOW_REVENUE': 'Revenue level fits standard market appetite',
    };
    return reasonCodes.map(code => reasonMap[code] || code.replace(/_/g, ' ').toLowerCase());
  };

  const getTopCarriers = () => {
    return carrierFits
      .filter(f => f.tier !== 'NO_FIT')
      .slice(0, 3);
  };

  const getCarrierSummary = (fit: CarrierFit): string => {
    const tierMessages: Record<string, string> = {
      GOOD_FIT: 'Strong appetite for this risk profile',
      POSSIBLE_FIT: 'May provide competitive terms',
      REVIEW_NEEDED: 'Worth exploring based on specific terms',
    };
    return tierMessages[fit.tier] || 'Available for consideration';
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: 'var(--brand-background)' }}>
        <div className="flex flex-col items-center gap-4">
          <div className="w-10 h-10 border-4 border-slate-200 rounded-full animate-spin" style={{ borderTopColor: 'var(--brand-primary)' }}></div>
          <p style={{ color: 'var(--brand-text-muted)' }} className="text-sm">Loading proposal...</p>
        </div>
      </div>
    );
  }

  if (error || !lead) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6" style={{ backgroundColor: 'var(--brand-background)' }}>
        <div className="brand-card p-10 max-w-md text-center">
          <div className="w-14 h-14 bg-red-50 rounded-full flex items-center justify-center mx-auto mb-5">
            <svg className="w-7 h-7 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <h2 className="text-xl font-semibold mb-2" style={{ color: 'var(--brand-primary)' }}>Unable to Load</h2>
          <p className="mb-6" style={{ color: 'var(--brand-text-muted)' }}>{error || 'Lead not found'}</p>
          <Link 
            href="/dashboard" 
            className="inline-flex items-center gap-2 text-sm font-medium"
            style={{ color: 'var(--brand-text-muted)' }}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
            Back to Dashboard
          </Link>
        </div>
      </div>
    );
  }

  const marketDirection = getMarketDirection(lead.marketClassification);
  const topCarriers = getTopCarriers();
  const humanReasons = getHumanReadableReasons(lead.marketReasonCodes || []);

  return (
    <div className="min-h-screen" style={{ backgroundColor: 'var(--brand-background)' }}>
      <header className="bg-white border-b border-slate-200/80">
        <div className="max-w-4xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <Link href="/" className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ backgroundColor: 'var(--brand-primary)' }}>
                <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                </svg>
              </div>
              <div>
                <h1 className="text-xl font-bold" style={{ color: 'var(--brand-primary)' }}>Insurigence</h1>
                <p className="text-xs" style={{ color: 'var(--brand-text-muted)' }}>Insurance Placement Intelligence</p>
              </div>
            </Link>
            <div className="flex items-center gap-3">
              {proposal?.publicToken && proposal.status !== 'DRAFT' && (
                <button
                  onClick={copyShareLink}
                  className="btn-brand-secondary px-4 py-2.5"
                  data-testid="button-copy-link"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                  {showCopied ? 'Copied!' : 'Copy Link'}
                </button>
              )}
              {proposal && proposal.status === 'DRAFT' && (
                <button
                  onClick={shareProposal}
                  className="btn-brand-accent px-4 py-2.5"
                  data-testid="button-share-proposal"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
                  </svg>
                  Share with Client
                </button>
              )}
              {!proposal && (
                <button
                  onClick={generateProposal}
                  disabled={isGenerating}
                  className="btn-brand-primary px-5 py-2.5"
                  data-testid="button-generate"
                >
                  {isGenerating ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                      Generating...
                    </>
                  ) : (
                    <>
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                      Generate Proposal
                    </>
                  )}
                </button>
              )}
            </div>
          </div>
        </div>
      </header>

      <div className="max-w-4xl mx-auto px-6 py-10">
        <div className="mb-8">
          <Link 
            href="/dashboard" 
            className="inline-flex items-center gap-2 text-sm font-medium mb-6 transition-colors hover:opacity-80"
            style={{ color: 'var(--brand-text-muted)' }}
            data-testid="link-back"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
            Dashboard
          </Link>
          
          <div className="flex items-start justify-between">
            <div>
              <h2 className="text-3xl font-bold mb-1" style={{ color: 'var(--brand-primary)' }}>Market Summary</h2>
              <p style={{ color: 'var(--brand-text-muted)' }} className="text-lg">{lead.insuredName}</p>
            </div>
          </div>
          
          {proposal && (
            <p className="text-sm mt-2" style={{ color: 'var(--brand-text-subtle)' }}>
              Generated {new Date(proposal.createdAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
              {proposal.status === 'SHARED' && <span className="ml-2" style={{ color: 'var(--brand-accent)' }}>Shared</span>}
              {proposal.status === 'VIEWED' && <span className="ml-2" style={{ color: 'var(--market-standard)' }}>Viewed by client</span>}
            </p>
          )}
        </div>

        <div 
          className="rounded-2xl p-10 mb-8 border text-center"
          style={{ 
            backgroundColor: marketDirection.bgColor, 
            borderColor: marketDirection.borderColor 
          }} 
          data-testid="section-hero"
        >
          <p className="text-sm font-medium uppercase tracking-wider mb-4" style={{ color: 'var(--brand-text-muted)' }}>Market Direction</p>
          <div className="inline-flex items-center gap-3 mb-4">
            <span className="w-4 h-4 rounded-full" style={{ backgroundColor: marketDirection.dotColor }}></span>
            <h3 className="text-4xl font-bold" style={{ color: marketDirection.textColor }}>{marketDirection.label}</h3>
          </div>
          {lead.marketConfidence && (
            <div className="mt-4">
              <div className="inline-flex items-center gap-2 px-4 py-2 bg-white/60 rounded-full">
                <span className="text-sm" style={{ color: 'var(--brand-text-muted)' }}>Confidence</span>
                <span className="text-sm font-semibold" style={{ color: 'var(--brand-text)' }}>{Math.round(lead.marketConfidence * 100)}%</span>
              </div>
            </div>
          )}
        </div>

        <div className="grid gap-6 mb-8">
          <div className="brand-card p-8" data-testid="section-answer">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ backgroundColor: 'rgba(11, 60, 93, 0.05)' }}>
                <svg className="w-5 h-5" style={{ color: 'var(--brand-primary)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <h3 className="text-xl font-semibold" style={{ color: 'var(--brand-primary)' }}>The Answer</h3>
            </div>
            
            <p className="text-lg leading-relaxed" style={{ color: 'var(--brand-text-muted)' }}>
              {lead.marketClassification === 'STANDARD' && (
                <>This risk qualifies for <strong style={{ color: 'var(--market-standard)' }}>standard market placement</strong>. Standard carriers typically offer the most competitive rates and broadest coverage options for risks with this profile.</>
              )}
              {lead.marketClassification === 'EXCESS_SURPLUS' && (
                <>This risk is best suited for the <strong style={{ color: 'var(--market-es)' }}>Excess & Surplus (E&S) market</strong>. E&S carriers specialize in risks that fall outside standard carrier appetites, offering tailored solutions.</>
              )}
              {lead.marketClassification === 'BORDERLINE' && (
                <>This risk falls in a <strong style={{ color: 'var(--market-borderline)' }}>borderline category</strong>. We recommend exploring both standard and E&S options to find the optimal balance of coverage and pricing.</>
              )}
              {!lead.marketClassification && (
                <>This lead has not been evaluated yet. Please run a market evaluation from the dashboard to generate placement recommendations.</>
              )}
            </p>
          </div>

          <div className="brand-card p-8" data-testid="section-why">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ backgroundColor: 'rgba(11, 60, 93, 0.05)' }}>
                <svg className="w-5 h-5" style={{ color: 'var(--brand-primary)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <h3 className="text-xl font-semibold" style={{ color: 'var(--brand-primary)' }}>The Why</h3>
            </div>
            
            {humanReasons.length > 0 ? (
              <ul className="space-y-3">
                {humanReasons.slice(0, 4).map((reason, idx) => (
                  <li key={idx} className="flex items-start gap-3">
                    <span className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5" style={{ backgroundColor: 'var(--brand-background)' }}>
                      <span className="w-2 h-2 rounded-full" style={{ backgroundColor: 'var(--brand-accent)' }}></span>
                    </span>
                    <span style={{ color: 'var(--brand-text-muted)' }}>{reason}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p style={{ color: 'var(--brand-text-muted)' }}>Market evaluation factors will appear here after running an evaluation.</p>
            )}
          </div>

          <div className="brand-card p-8" data-testid="section-options">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ backgroundColor: 'rgba(11, 60, 93, 0.05)' }}>
                  <svg className="w-5 h-5" style={{ color: 'var(--brand-primary)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                  </svg>
                </div>
                <h3 className="text-xl font-semibold" style={{ color: 'var(--brand-primary)' }}>The Options</h3>
              </div>
              {carrierFits.length > 3 && (
                <button
                  onClick={() => setShowDetails(!showDetails)}
                  className="text-sm font-medium hover:opacity-80"
                  style={{ color: 'var(--brand-accent)' }}
                >
                  {showDetails ? 'Hide details' : 'View all carriers'}
                </button>
              )}
            </div>
            
            {topCarriers.length > 0 ? (
              <div className="space-y-4">
                {(showDetails ? carrierFits.filter(f => f.tier !== 'NO_FIT') : topCarriers).map((fit, idx) => (
                  <div 
                    key={fit.carrierId} 
                    className="flex items-center gap-4 p-4 rounded-xl"
                    style={{ backgroundColor: 'var(--brand-background)' }}
                  >
                    <div className="w-12 h-12 bg-white rounded-xl border border-slate-200 flex items-center justify-center flex-shrink-0">
                      <span className="text-lg font-bold" style={{ color: 'var(--brand-text-subtle)' }}>{idx + 1}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold" style={{ color: 'var(--brand-text)' }}>{fit.carrierName}</p>
                      <p className="text-sm" style={{ color: 'var(--brand-text-muted)' }}>{getCarrierSummary(fit)}</p>
                    </div>
                    {fit.tier === 'GOOD_FIT' && (
                      <span className="badge-standard">
                        Recommended
                      </span>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p style={{ color: 'var(--brand-text-muted)' }}>No carrier matches found. Consider running a market evaluation or expanding search criteria.</p>
            )}
            
            {showDetails && carrierFits.length > 0 && (
              <div className="mt-6 pt-6 border-t border-slate-200">
                <p className="text-xs uppercase tracking-wider mb-3" style={{ color: 'var(--brand-text-subtle)' }}>Detailed Scores</p>
                <div className="space-y-2">
                  {carrierFits.filter(f => f.tier !== 'NO_FIT').map((fit) => (
                    <div key={fit.carrierId} className="flex items-center justify-between text-sm">
                      <span style={{ color: 'var(--brand-text-muted)' }}>{fit.carrierName}</span>
                      <span style={{ color: 'var(--brand-text-subtle)' }}>Score: {Math.round(fit.score)}/100</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="brand-card p-8 mb-8" data-testid="section-recommendation">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ backgroundColor: 'rgba(22, 179, 174, 0.1)' }}>
              <svg className="w-5 h-5" style={{ color: 'var(--brand-accent)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" />
              </svg>
            </div>
            <h3 className="text-xl font-semibold" style={{ color: 'var(--brand-primary)' }}>Your Recommendation</h3>
          </div>
          
          <textarea
            value={agentRecommendation}
            onChange={(e) => setAgentRecommendation(e.target.value)}
            placeholder="Add your professional recommendation for the insured. This will appear on the client-facing proposal..."
            className="form-input h-36 resize-none"
            data-testid="input-recommendation"
          />
          
          <div className="mt-4 flex items-center justify-between">
            <p className="text-sm" style={{ color: 'var(--brand-text-subtle)' }}>
              {!proposal && 'Generate a proposal first to save your recommendation.'}
            </p>
            <button
              onClick={saveRecommendation}
              disabled={isSaving || !proposal}
              className="btn-brand-accent px-5 py-2.5"
              data-testid="button-save"
            >
              {isSaving ? 'Saving...' : 'Save Recommendation'}
            </button>
          </div>
        </div>

        <div className="rounded-2xl p-6" style={{ backgroundColor: 'rgba(11, 60, 93, 0.03)' }}>
          <div className="flex items-start gap-4">
            <div className="w-10 h-10 bg-white rounded-xl flex items-center justify-center flex-shrink-0 border border-slate-200">
              <svg className="w-5 h-5" style={{ color: 'var(--brand-text-muted)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
            </div>
            <div>
              <h4 className="font-medium mb-1" style={{ color: 'var(--brand-text)' }}>Client Overview</h4>
              <div className="text-sm space-y-1" style={{ color: 'var(--brand-text-muted)' }}>
                <p><span className="font-medium" style={{ color: 'var(--brand-text)' }}>{insuredSummary?.name || lead.insuredName}</span></p>
                <p>Industry: {insuredSummary?.industry || 'Not specified'}</p>
                <p>Revenue: {insuredSummary?.revenue || 'Not specified'}</p>
                <p>Years in Business: {insuredSummary?.yearsInBusiness || 'Not specified'}</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
