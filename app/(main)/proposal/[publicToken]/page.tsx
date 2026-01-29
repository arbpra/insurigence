'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';

interface Insured {
  name: string;
  industry: string;
  states: string | string[];
  revenue: string;
}

interface Market {
  classification: string | null;
  confidence: number | null;
  explanation: string | null;
}

interface CarrierFit {
  carrierName: string;
  tier: string;
  reason: string;
}

interface Agency {
  name: string;
  logoUrl: string | null;
  brandPrimaryColor: string | null;
  footerText: string | null;
}

interface ProposalData {
  proposal: {
    title: string;
    status: string;
    createdAt: string;
  };
  insured: Insured;
  market: Market;
  carrierFits: CarrierFit[];
  agentRecommendation: string | null;
  agency: Agency;
}

export default function PublicProposalPage() {
  const params = useParams();
  const publicToken = params.publicToken as string;

  const [data, setData] = useState<ProposalData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchProposal();
  }, [publicToken]);

  const fetchProposal = async () => {
    try {
      const res = await fetch(`/api/proposal/${publicToken}`);
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to load proposal');
      }
      const proposalData = await res.json();
      setData(proposalData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load proposal');
    } finally {
      setIsLoading(false);
    }
  };

  const getMarketDirection = (classification: string | null) => {
    switch (classification) {
      case 'STANDARD':
        return { 
          label: 'Standard Market', 
          bgColor: 'var(--market-standard-bg)', 
          textColor: 'var(--market-standard)', 
          borderColor: 'var(--market-standard-border)',
          dotColor: 'var(--market-standard)',
          description: 'Your business qualifies for placement with standard market carriers, which typically offer competitive rates and comprehensive coverage options.'
        };
      case 'EXCESS_SURPLUS':
        return { 
          label: 'Specialty Market', 
          bgColor: 'var(--market-es-bg)', 
          textColor: 'var(--market-es)', 
          borderColor: 'var(--market-es-border)',
          dotColor: 'var(--market-es)',
          description: 'Your business is best suited for specialty carriers who excel at providing tailored coverage solutions for unique risk profiles.'
        };
      case 'BORDERLINE':
        return { 
          label: 'Flexible Placement', 
          bgColor: 'var(--market-borderline-bg)', 
          textColor: 'var(--market-borderline)', 
          borderColor: 'var(--market-borderline-border)',
          dotColor: 'var(--market-borderline)',
          description: 'Your business has options across multiple market segments. We will explore both standard and specialty carriers to find the best fit.'
        };
      default:
        return { 
          label: 'Analysis Pending', 
          bgColor: '#F8FAFC', 
          textColor: '#64748B', 
          borderColor: '#E2E8F0',
          dotColor: '#94A3B8',
          description: 'Your market analysis is in progress.'
        };
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: 'var(--brand-background)' }}>
        <div className="flex flex-col items-center gap-4">
          <div className="w-10 h-10 border-4 border-slate-200 rounded-full animate-spin" style={{ borderTopColor: 'var(--brand-primary)' }}></div>
          <p style={{ color: 'var(--brand-text-muted)' }} className="text-sm">Loading your proposal...</p>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6" style={{ backgroundColor: 'var(--brand-background)' }}>
        <div className="brand-card p-10 max-w-md text-center">
          <div className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-6" style={{ backgroundColor: 'var(--market-es-bg)' }}>
            <svg className="w-8 h-8" style={{ color: 'var(--market-es)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <h1 className="text-2xl font-semibold mb-3" style={{ color: 'var(--brand-primary)' }}>Proposal Not Available</h1>
          <p style={{ color: 'var(--brand-text-muted)' }} className="leading-relaxed">
            {error === 'Proposal not yet shared' 
              ? 'This proposal is being prepared and will be available soon.'
              : 'This proposal could not be found or is no longer available.'}
          </p>
        </div>
      </div>
    );
  }

  const { proposal, insured, market, carrierFits, agentRecommendation, agency } = data;
  const marketDirection = getMarketDirection(market.classification);
  const topCarriers = carrierFits.slice(0, 3);

  return (
    <div className="min-h-screen" style={{ backgroundColor: 'var(--brand-background)' }}>
      <header className="bg-white border-b border-slate-200/80">
        <div className="max-w-3xl mx-auto px-6 py-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              {agency.logoUrl ? (
                <img src={agency.logoUrl} alt={agency.name} className="h-10 w-auto" />
              ) : (
                <div className="h-10 w-10 rounded-xl flex items-center justify-center" style={{ backgroundColor: 'var(--brand-primary)' }}>
                  <span className="text-white font-bold text-lg">{agency.name.charAt(0)}</span>
                </div>
              )}
              <div>
                <p className="font-semibold" style={{ color: 'var(--brand-primary)' }}>{agency.name}</p>
                <p className="text-sm" style={{ color: 'var(--brand-text-muted)' }}>Insurance Services</p>
              </div>
            </div>
            <div className="text-right">
              <p className="text-xs uppercase tracking-wider" style={{ color: 'var(--brand-text-subtle)' }}>Prepared for</p>
              <p className="font-medium" style={{ color: 'var(--brand-text)' }} data-testid="text-insured-name">{insured.name}</p>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-12">
        <div 
          className="rounded-2xl p-10 mb-10 border text-center"
          style={{ backgroundColor: marketDirection.bgColor, borderColor: marketDirection.borderColor }} 
          data-testid="section-hero"
        >
          <p className="text-sm font-medium uppercase tracking-wider mb-4" style={{ color: 'var(--brand-text-muted)' }}>Market Recommendation</p>
          <div className="inline-flex items-center gap-3 mb-5">
            <span className="w-4 h-4 rounded-full" style={{ backgroundColor: marketDirection.dotColor }}></span>
            <h1 className="text-4xl font-bold" style={{ color: marketDirection.textColor }} data-testid="badge-market">
              {marketDirection.label}
            </h1>
          </div>
          {market.confidence && (
            <div className="mb-6">
              <span className="inline-flex items-center gap-2 px-4 py-2 bg-white/70 rounded-full text-sm">
                <span style={{ color: 'var(--brand-text-muted)' }}>Confidence Level:</span>
                <span className="font-semibold" style={{ color: 'var(--brand-text)' }}>{market.confidence}%</span>
              </span>
            </div>
          )}
          <p className="text-lg leading-relaxed max-w-xl mx-auto" style={{ color: 'var(--brand-text-muted)' }}>
            {marketDirection.description}
          </p>
        </div>

        <div className="space-y-8">
          <div className="brand-card p-8" data-testid="section-summary">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ backgroundColor: 'rgba(11, 60, 93, 0.05)' }}>
                <svg className="w-5 h-5" style={{ color: 'var(--brand-primary)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <h2 className="text-xl font-semibold" style={{ color: 'var(--brand-primary)' }}>What This Means For You</h2>
            </div>
            
            <p className="text-lg leading-relaxed" style={{ color: 'var(--brand-text-muted)' }} data-testid="text-market-explanation">
              {market.explanation || marketDirection.description}
            </p>
          </div>

          {topCarriers.length > 0 && (
            <div className="brand-card p-8" data-testid="section-carriers">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ backgroundColor: 'rgba(11, 60, 93, 0.05)' }}>
                  <svg className="w-5 h-5" style={{ color: 'var(--brand-primary)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                  </svg>
                </div>
                <h2 className="text-xl font-semibold" style={{ color: 'var(--brand-primary)' }}>Recommended Carriers</h2>
              </div>
              
              <div className="space-y-4">
                {topCarriers.map((fit, idx) => (
                  <div 
                    key={idx} 
                    className="flex items-center gap-4 p-5 rounded-xl"
                    style={{ backgroundColor: 'var(--brand-background)' }}
                    data-testid={`card-carrier-${idx}`}
                  >
                    <div className="w-12 h-12 bg-white rounded-xl border border-slate-200 flex items-center justify-center flex-shrink-0 shadow-sm">
                      <span className="text-lg font-bold" style={{ color: 'var(--brand-text-subtle)' }}>{idx + 1}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold mb-1" style={{ color: 'var(--brand-text)' }}>{fit.carrierName}</p>
                      <p className="text-sm" style={{ color: 'var(--brand-text-muted)' }}>{fit.reason}</p>
                    </div>
                    {fit.tier === 'GOOD_FIT' && (
                      <span className="badge-standard flex-shrink-0">
                        Top Choice
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {agentRecommendation && (
            <div className="brand-card p-8" data-testid="section-recommendation">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ backgroundColor: 'rgba(22, 179, 174, 0.1)' }}>
                  <svg className="w-5 h-5" style={{ color: 'var(--brand-accent)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" />
                  </svg>
                </div>
                <h2 className="text-xl font-semibold" style={{ color: 'var(--brand-primary)' }}>Agent&apos;s Note</h2>
              </div>
              
              <div className="rounded-xl p-5" style={{ backgroundColor: 'var(--brand-background)' }}>
                <p className="leading-relaxed whitespace-pre-wrap" style={{ color: 'var(--brand-text)' }} data-testid="text-recommendation">
                  {agentRecommendation}
                </p>
              </div>
            </div>
          )}

          <div className="rounded-2xl p-8 text-white" style={{ backgroundColor: 'var(--brand-primary)' }}>
            <h2 className="text-xl font-semibold mb-6">Next Steps</h2>
            <div className="space-y-4">
              <div className="flex items-start gap-4">
                <div className="w-8 h-8 bg-white/10 rounded-full flex items-center justify-center flex-shrink-0">
                  <span className="text-sm font-bold">1</span>
                </div>
                <div>
                  <p className="font-medium mb-1">Review This Summary</p>
                  <p className="text-white/70 text-sm">Take time to understand your market placement and carrier options.</p>
                </div>
              </div>
              <div className="flex items-start gap-4">
                <div className="w-8 h-8 bg-white/10 rounded-full flex items-center justify-center flex-shrink-0">
                  <span className="text-sm font-bold">2</span>
                </div>
                <div>
                  <p className="font-medium mb-1">Connect With Your Agent</p>
                  <p className="text-white/70 text-sm">Discuss coverage details and any questions about your options.</p>
                </div>
              </div>
              <div className="flex items-start gap-4">
                <div className="w-8 h-8 bg-white/10 rounded-full flex items-center justify-center flex-shrink-0">
                  <span className="text-sm font-bold">3</span>
                </div>
                <div>
                  <p className="font-medium mb-1">Get Your Quote</p>
                  <p className="text-white/70 text-sm">We will work with carriers to secure the best coverage and pricing for you.</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>

      <footer className="bg-white border-t border-slate-200/80 mt-16">
        <div className="max-w-3xl mx-auto px-6 py-8">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              {agency.logoUrl ? (
                <img src={agency.logoUrl} alt={agency.name} className="h-8 w-auto opacity-60" />
              ) : (
                <div className="h-8 w-8 rounded flex items-center justify-center" style={{ backgroundColor: 'rgba(11, 60, 93, 0.1)' }}>
                  <span className="font-bold text-sm" style={{ color: 'var(--brand-primary)' }}>{agency.name.charAt(0)}</span>
                </div>
              )}
              <span className="text-sm" style={{ color: 'var(--brand-text-muted)' }}>{agency.footerText || `Prepared by ${agency.name}`}</span>
            </div>
            <p className="text-sm" style={{ color: 'var(--brand-text-subtle)' }}>
              {new Date(proposal.createdAt).toLocaleDateString('en-US', {
                year: 'numeric',
                month: 'long',
                day: 'numeric',
              })}
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
