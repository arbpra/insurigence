'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { FileX2 } from 'lucide-react';
import ClientProposalView, { type SignatureRecord } from '@/app/components/proposals/ClientProposalView';
import LegacyProposalView from './LegacyProposalView';
import type { AssembledProposal } from '@/lib/proposals/assemble';

/**
 * The insured's proposal page.
 *
 * Deliberately lives outside the (main) route group: that layout requires a
 * session and redirects to /login, which would make a proposal link unusable for
 * the people it is meant for. This page has no auth of any kind — the token in
 * the URL is the only credential.
 *
 * Two presentations exist. A quote proposal renders the full comparison and
 * selection experience; older market-classification proposals keep their
 * original view.
 */

interface QuotePayload {
  kind: 'quote';
  proposal: AssembledProposal;
  selectedQuoteOptionId: string | null;
  signedAt: string | null;
  signature?: SignatureRecord | null;
}

export default function PublicProposalPage() {
  const params = useParams();
  const publicToken = String(params.publicToken);

  const [data, setData] = useState<QuotePayload | null>(null);
  const [isLegacy, setIsLegacy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/proposal/${publicToken}`);
      const json = await res.json();

      if (!res.ok) {
        // The API already words these for a non-technical reader.
        setError(json.error || 'This proposal could not be loaded.');
        return;
      }

      if (json.kind === 'legacy') { setIsLegacy(true); return; }
      setData(json as QuotePayload);
    } catch {
      setError('We could not load this proposal. Please check your connection and try again.');
    } finally {
      setLoading(false);
    }
  }, [publicToken]);

  useEffect(() => { load(); }, [load]);

  const selectOption = useCallback(async (quoteOptionId: string) => {
    const res = await fetch(`/api/proposal/${publicToken}/select`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ quoteOptionId }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || 'Could not record your choice.');

    setData((prev) => prev && ({
      ...prev,
      selectedQuoteOptionId: json.selectedQuoteOptionId,
      proposal: { ...prev.proposal, status: json.status },
    }));
  }, [publicToken]);

  const sign = useCallback(async (payload: Record<string, unknown>) => {
    const res = await fetch(`/api/proposal/${publicToken}/sign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || 'Could not record your signature.');
    // Refetch so the signed view renders from the frozen snapshot the server
    // stored, rather than from whatever this page happened to be holding.
    setLoading(true);
    await load();
  }, [publicToken, load]);

  // The legacy view fetches independently; hand off entirely.
  if (isLegacy) return <LegacyProposalView />;

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#f6f8fa' }}>
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#00E6A7]" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4" style={{ backgroundColor: '#f6f8fa' }}>
        <div className="bg-white rounded-2xl border border-slate-200 p-8 max-w-md text-center">
          <FileX2 className="w-10 h-10 mx-auto mb-3 text-slate-300" />
          <h1 className="text-lg font-medium mb-2" style={{ color: '#0D2137' }}>
            This proposal isn&apos;t available
          </h1>
          <p className="text-sm text-slate-500 leading-relaxed">
            {error ?? 'This proposal could not be loaded.'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <ClientProposalView
      publicToken={publicToken}
      proposal={data.proposal}
      selectedOptionId={data.selectedQuoteOptionId}
      signedAt={data.signedAt}
      signature={data.signature ?? null}
      onSelect={selectOption}
      onSign={sign}
    />
  );
}
