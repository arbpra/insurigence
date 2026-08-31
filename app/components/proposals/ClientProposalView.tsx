'use client';

import { useState } from 'react';
import { Check, ChevronDown, ChevronUp, ShieldCheck, ArrowLeft, Download } from 'lucide-react';
import type { AssembledProposal, ClientQuoteOption } from '@/lib/proposals/assemble';
import type { ProposalSection } from '@/lib/proposals/sections';
import SignaturePanel from './SignaturePanel';

export interface SignatureRecord {
  signerName: string;
  signerTitle: string | null;
  signedAt: string;
  signatureType: 'TYPED' | 'DRAWN';
  signatureData: string;
}

/**
 * The insured's proposal — a web presentation, not a PDF download
 * (requirement 7).
 *
 * Built mobile-first throughout: this is frequently opened on a phone from an
 * email, so options stack into cards on small screens and only become a table
 * where there is room for one. Nothing is hidden behind horizontal scroll on a
 * narrow screen except the comparison grid, which scrolls inside its own
 * container rather than the page.
 */

interface Props {
  /** Token, so the PDF can be fetched through the same gate as the page. */
  publicToken: string;
  proposal: AssembledProposal;
  selectedOptionId: string | null;
  signedAt: string | null;
  signature?: SignatureRecord | null;
  onSelect: (optionId: string) => Promise<void>;
  onSign: (payload: {
    signerName: string; signerTitle: string | null; signerEmail: string | null;
    signatureType: 'TYPED' | 'DRAWN'; signatureData: string; consentAccepted: boolean;
  }) => Promise<void>;
}

const money = (n: number | null | undefined) =>
  n === null || n === undefined
    ? '—'
    : n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

const longDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : null;

export default function ClientProposalView({
  publicToken, proposal, selectedOptionId, signedAt, signature, onSelect, onSign,
}: Props) {
  const [pending, setPending] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<ClientQuoteOption | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [error, setError] = useState('');

  const isSigned = Boolean(signedAt);
  const selected = proposal.options.find((o) => o.id === selectedOptionId) ?? null;

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  async function confirmSelection(option: ClientQuoteOption) {
    setPending(option.id);
    setError('');
    try {
      await onSelect(option.id);
      setConfirming(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not record your choice. Please try again.');
    } finally {
      setPending(null);
    }
  }

  function renderSection(section: ProposalSection) {
    switch (section.key) {
      case 'agencyHeader':
        return (
          <div className="flex items-center gap-4 flex-wrap">
            {proposal.preparedBy.logoUrl ? (
              // Agency logos are arbitrary external URLs; next/image cannot be
              // configured for hosts we do not know ahead of time.
              // eslint-disable-next-line @next/next/no-img-element
              <img src={proposal.preparedBy.logoUrl} alt={proposal.preparedBy.agencyName}
                   className="h-10 sm:h-12 w-auto object-contain" />
            ) : (
              <p className="text-lg font-semibold" style={{ color: 'var(--p-primary)' }}>
                {proposal.preparedBy.agencyName}
              </p>
            )}
            <div className="text-sm text-slate-500">
              {proposal.preparedBy.agentName && (
                <p className="text-slate-700 font-medium">{proposal.preparedBy.agentName}</p>
              )}
              {proposal.preparedBy.phone && <p>{proposal.preparedBy.phone}</p>}
              {(proposal.preparedBy.agentEmail || proposal.preparedBy.email) && (
                <p>{proposal.preparedBy.agentEmail ?? proposal.preparedBy.email}</p>
              )}
            </div>
          </div>
        );

      case 'clientInformation':
        return (
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-400 mb-1">{section.title}</p>
            <p className="text-xl sm:text-2xl font-medium" style={{ color: 'var(--p-primary)' }}>
              {proposal.preparedFor.insuredName}
            </p>
            <div className="mt-3 flex gap-6 flex-wrap text-sm">
              <div>
                <span className="block text-xs text-slate-400">Proposal date</span>
                <span className="text-slate-700">{longDate(proposal.preparedFor.proposalDate) ?? '—'}</span>
              </div>
              {proposal.preparedFor.effectiveDate && (
                <div>
                  <span className="block text-xs text-slate-400">Coverage starts</span>
                  <span className="text-slate-700">{longDate(proposal.preparedFor.effectiveDate)}</span>
                </div>
              )}
            </div>
          </div>
        );

      case 'recommendation':
        if (!proposal.recommendation) return null;
        return (
          <section>
            <h2 className="text-xl sm:text-2xl font-medium mb-3" style={{ color: 'var(--p-primary)' }}>
              {section.title}
            </h2>
            <div className="rounded-xl p-4 sm:p-5" style={{ backgroundColor: 'var(--p-tint)' }}>
              <p className="text-sm font-semibold mb-2" style={{ color: 'var(--p-primary)' }}>
                {proposal.recommendation.optionLabel}
              </p>
              <p className="text-sm sm:text-base text-slate-700 leading-relaxed whitespace-pre-line">
                {proposal.recommendation.rationale}
              </p>
            </div>
          </section>
        );

      case 'quoteOptions':
        return (
          <section>
            <h2 className="text-xl sm:text-2xl font-medium mb-1" style={{ color: 'var(--p-primary)' }}>
              {section.title}
            </h2>
            <p className="text-sm text-slate-500 mb-4">
              {isSigned
                ? 'You selected the option marked below.'
                : 'Review each option, then choose the one that fits your business.'}
            </p>

            {/* Cards on mobile, where a four-column table would be unreadable. */}
            <div className="space-y-3">
              {proposal.options.map((o) => {
                const isSelected = o.id === selectedOptionId;
                const isOpen = expanded.has(o.id);
                return (
                  <div
                    key={o.id}
                    className="rounded-xl border-2 bg-white overflow-hidden transition-colors"
                    style={{ borderColor: isSelected ? 'var(--p-accent)' : '#e2e8f0' }}
                    data-testid={`client-option-${o.id}`}
                  >
                    <div className="p-4 sm:p-5">
                      <div className="flex items-start justify-between gap-3 flex-wrap mb-2">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <h3 className="text-base sm:text-lg font-medium" style={{ color: 'var(--p-primary)' }}>
                              {o.carrierName || o.label}
                            </h3>
                            {o.isRecommended && (
                              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
                                    style={{ backgroundColor: 'var(--p-tint)', color: 'var(--p-primary)' }}>
                                Our recommendation
                              </span>
                            )}
                            {isSelected && (
                              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full inline-flex items-center gap-1"
                                    style={{ backgroundColor: '#E9FBF5', color: '#0F9E78' }}>
                                <Check className="w-3 h-3" /> Your choice
                              </span>
                            )}
                          </div>
                          {o.programName && <p className="text-sm text-slate-500">{o.programName}</p>}
                        </div>
                        <div className="text-right">
                          <p className="text-xl sm:text-2xl font-semibold" style={{ color: 'var(--p-primary)' }}>
                            {money(o.totalAnnual)}
                          </p>
                          <p className="text-xs text-slate-400">per year</p>
                        </div>
                      </div>

                      <dl className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-2 text-sm mt-3">
                        <div>
                          <dt className="text-xs text-slate-400">Premium</dt>
                          <dd className="text-slate-700">{money(o.premiumAnnual)}</dd>
                        </div>
                        {o.taxes !== null && (
                          <div><dt className="text-xs text-slate-400">Taxes</dt><dd className="text-slate-700">{money(o.taxes)}</dd></div>
                        )}
                        {o.fees !== null && (
                          <div><dt className="text-xs text-slate-400">Fees</dt><dd className="text-slate-700">{money(o.fees)}</dd></div>
                        )}
                        {o.paymentPlan && (
                          <div className="col-span-2">
                            <dt className="text-xs text-slate-400">Payment</dt>
                            <dd className="text-slate-700">{o.paymentPlan}</dd>
                          </div>
                        )}
                      </dl>

                      {o.coverages.length > 0 && (
                        <button
                          onClick={() => toggle(o.id)}
                          className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-slate-500 hover:text-slate-800"
                          aria-expanded={isOpen}
                        >
                          {isOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                          {isOpen ? 'Hide' : 'See'} what this covers
                        </button>
                      )}

                      {isOpen && (
                        <div className="mt-3 space-y-2 border-t border-slate-100 pt-3">
                          {o.coverages.map((c, i) => (
                            <div key={i}>
                              <div className="flex items-baseline justify-between gap-3 flex-wrap">
                                <span className="text-sm font-medium text-slate-800">{c.name}</span>
                                <span className="text-xs text-slate-500">
                                  {c.included ? (
                                    <>{c.limit ?? 'Included'}{c.deductible && ` · ${c.deductible} deductible`}</>
                                  ) : 'Not included'}
                                </span>
                              </div>
                              {c.plainLanguage && <p className="text-sm text-slate-600 leading-relaxed mt-0.5">{c.plainLanguage}</p>}
                              {c.whyItMatters && <p className="text-sm text-slate-500 leading-relaxed mt-0.5">{c.whyItMatters}</p>}
                              {c.differsFromOthers && (
                                <p className="text-sm mt-1 pl-2 border-l-2 leading-relaxed"
                                   style={{ borderColor: 'var(--p-accent)', color: '#475569' }}>
                                  {c.differsFromOthers}
                                </p>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {!isSigned && (
                      <div className="px-4 sm:px-5 pb-4 sm:pb-5">
                        <button
                          onClick={() => setConfirming(o)}
                          disabled={pending !== null}
                          className="w-full sm:w-auto px-5 py-2.5 rounded-md text-sm font-semibold disabled:opacity-60"
                          style={isSelected
                            ? { backgroundColor: '#fff', color: 'var(--p-primary)', border: '1px solid #cbd5e1' }
                            : { backgroundColor: 'var(--p-accent)', color: 'var(--p-primary)' }}
                          data-testid={`select-option-${o.id}`}
                        >
                          {isSelected ? 'Selected' : 'Select This Option'}
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {proposal.keyDifferences.length > 0 && (
              <div className="mt-4 rounded-lg bg-slate-50 border border-slate-200 px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-1.5">
                  How these differ
                </p>
                <ul className="space-y-1">
                  {proposal.keyDifferences.map((d, i) => (
                    <li key={i} className="text-sm text-slate-600 leading-relaxed">{d}</li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        );

      case 'coverageBreakdown':
        // Coverage detail lives inside each option card above, where it sits
        // next to the price it belongs to.
        return null;

      default: {
        const body = (section.body ?? '').trim();
        if (body === '') return null;
        return (
          <section>
            <h2 className="text-xl sm:text-2xl font-medium mb-3" style={{ color: 'var(--p-primary)' }}>
              {section.title}
            </h2>
            <p className="text-sm sm:text-base text-slate-600 leading-relaxed whitespace-pre-line">{body}</p>
          </section>
        );
      }
    }
  }

  return (
    <div
      className="min-h-screen"
      style={{
        backgroundColor: '#f6f8fa',
        ['--p-primary' as string]: proposal.branding.primaryColor,
        ['--p-accent' as string]: proposal.branding.secondaryColor,
        ['--p-tint' as string]: `${proposal.branding.secondaryColor}1A`,
      } as React.CSSProperties}
      data-testid="client-proposal"
    >
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
        <div className="bg-white rounded-2xl border border-slate-200 p-5 sm:p-8 md:p-10">
          <h1 className="text-2xl sm:text-3xl font-medium mb-6" style={{ color: 'var(--p-primary)' }}>
            {proposal.title}
          </h1>

          {proposal.clientMessage && (
            <p className="text-sm sm:text-base text-slate-600 leading-relaxed whitespace-pre-line mb-6 pb-6 border-b border-slate-200">
              {proposal.clientMessage}
            </p>
          )}

          {isSigned && (
            <div className="mb-6 rounded-lg px-4 py-3 flex items-start gap-2"
                 style={{ backgroundColor: '#E9FBF5', color: '#0F9E78' }}>
              <ShieldCheck className="w-5 h-5 flex-shrink-0 mt-0.5" />
              <div>
                <p className="font-medium text-sm">You signed this proposal on {longDate(signedAt)}.</p>
                <p className="text-sm">Your agent has been notified and will be in touch.</p>
              </div>
            </div>
          )}

          {error && (
            <div className="mb-4 rounded-md px-3 py-2 text-sm" style={{ backgroundColor: '#FEE2E2', color: '#991B1B' }}>
              {error}
            </div>
          )}

          <div className="space-y-8 sm:space-y-10">
            {proposal.sections.map((section) => {
              const rendered = renderSection(section);
              return rendered ? <div key={section.key}>{rendered}</div> : null;
            })}
          </div>

          {/* ── Signature (requirement 9) ── */}
          {!isSigned && selected && (
            <div className="mt-10">
              <SignaturePanel
                selectedOptionLabel={selected.carrierName || selected.label}
                onSign={onSign}
              />
            </div>
          )}

          {!isSigned && !selected && (
            <div className="mt-10 rounded-xl border border-dashed border-slate-300 p-6 text-center">
              <p className="text-sm text-slate-500">
                Choose an option above, then you&apos;ll be able to sign.
              </p>
            </div>
          )}

          {isSigned && signature && (
            <div className="mt-10 rounded-xl border border-slate-200 p-5" data-testid="signed-record">
              <h2 className="text-lg font-medium mb-3" style={{ color: 'var(--p-primary)' }}>
                Your signature
              </h2>
              {signature.signatureType === 'DRAWN' ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={signature.signatureData} alt={`Signature of ${signature.signerName}`}
                     className="h-20 w-auto object-contain mb-2" />
              ) : (
                <p className="text-2xl mb-2" style={{ fontFamily: 'Georgia, serif', fontStyle: 'italic', color: '#0D2137' }}>
                  {signature.signatureData}
                </p>
              )}
              <p className="text-sm text-slate-700">{signature.signerName}</p>
              {signature.signerTitle && <p className="text-sm text-slate-500">{signature.signerTitle}</p>}
              <p className="text-xs text-slate-400 mt-1">Signed {longDate(signature.signedAt)}</p>
            </div>
          )}

          <div className="mt-8 pt-6 border-t border-slate-200">
            <a
              href={`/api/proposal/${publicToken}/pdf`}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-md text-sm font-medium border border-slate-300 text-slate-600 hover:text-slate-900 hover:border-slate-400"
              data-testid="download-pdf"
            >
              <Download className="w-4 h-4" />
              Download {isSigned ? 'your signed proposal' : 'a copy'} (PDF)
            </a>
          </div>

          <div className="mt-6 pt-6 border-t border-slate-200 space-y-3">
            {proposal.branding.footerText && (
              <p className="text-xs text-slate-500 leading-relaxed">{proposal.branding.footerText}</p>
            )}
            <p className="text-[11px] text-slate-400 leading-relaxed">{proposal.disclaimer}</p>
          </div>
        </div>
      </div>

      {/* ── Confirmation step (requirement 8) ──
          The insured reviews what they picked before it is recorded, and can go
          back and change it. */}
      {confirming && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-heading"
        >
          <div className="bg-white w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl p-5 sm:p-6 max-h-[90vh] overflow-y-auto">
            <h2 id="confirm-heading" className="text-lg font-medium mb-2" style={{ color: 'var(--p-primary)' }}>
              Confirm your choice
            </h2>
            <p className="text-sm text-slate-600 mb-4">
              You have selected the following insurance option. Please review the information
              below before continuing.
            </p>

            <div className="rounded-lg border border-slate-200 p-4 mb-4">
              <p className="font-medium" style={{ color: 'var(--p-primary)' }}>
                {confirming.carrierName || confirming.label}
              </p>
              {confirming.programName && <p className="text-sm text-slate-500">{confirming.programName}</p>}
              <p className="text-2xl font-semibold mt-2" style={{ color: 'var(--p-primary)' }}>
                {money(confirming.totalAnnual)}<span className="text-sm font-normal text-slate-400"> per year</span>
              </p>
              {confirming.paymentPlan && (
                <p className="text-sm text-slate-500 mt-1">{confirming.paymentPlan}</p>
              )}
            </div>

            <p className="text-xs text-slate-400 mb-4">
              Selecting an option is not a signature and does not bind coverage. You can change
              your choice until you sign.
            </p>

            <div className="flex gap-3 flex-col-reverse sm:flex-row">
              <button
                onClick={() => setConfirming(null)}
                disabled={pending !== null}
                className="flex-1 px-4 py-2.5 rounded-md text-sm font-medium border border-slate-300 text-slate-600 inline-flex items-center justify-center gap-1.5"
              >
                <ArrowLeft className="w-4 h-4" /> Go back
              </button>
              <button
                onClick={() => confirmSelection(confirming)}
                disabled={pending !== null}
                className="flex-1 px-4 py-2.5 rounded-md text-sm font-semibold disabled:opacity-60"
                style={{ backgroundColor: 'var(--p-accent)', color: 'var(--p-primary)' }}
                data-testid="confirm-selection"
              >
                {pending ? 'Saving…' : 'Confirm this option'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Sticky summary once a choice exists — signing arrives in Phase 7. */}
      {selected && !isSigned && !confirming && (
        <div className="sticky bottom-0 border-t border-slate-200 bg-white/95 backdrop-blur px-4 py-3">
          <div className="max-w-3xl mx-auto flex items-center justify-between gap-3 flex-wrap">
            <p className="text-sm text-slate-600">
              You selected <span className="font-medium text-slate-900">{selected.carrierName || selected.label}</span>
              {' · '}{money(selected.totalAnnual)}/yr
            </p>
            <p className="text-xs text-slate-400">Scroll down to sign.</p>
          </div>
        </div>
      )}
    </div>
  );
}
