'use client';

import type { AssembledProposal } from '@/lib/proposals/assemble';
import type { ProposalSection } from '@/lib/proposals/sections';

/**
 * What the insured will see, rendered from the same assembled payload the
 * client-facing page will use in Phase 6.
 *
 * Agency branding is applied through CSS custom properties set on the wrapper,
 * so a proposal takes the agency's colours without any component needing to know
 * where they came from. Colours arrive pre-validated as hex by resolveBranding.
 */

interface Props {
  proposal: AssembledProposal;
}

const money = (n: number | null | undefined) =>
  n === null || n === undefined
    ? '—'
    : n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

const longDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : '—';

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-lg sm:text-xl font-medium mb-3" style={{ color: 'var(--p-primary)' }}>
      {children}
    </h2>
  );
}

export default function ProposalPreview({ proposal }: Props) {
  const { branding, preparedBy, preparedFor } = proposal;

  function renderSection(section: ProposalSection) {
    switch (section.key) {
      case 'agencyHeader':
        return (
          <div className="flex items-start justify-between gap-6 flex-wrap">
            <div>
              {preparedBy.logoUrl ? (
                // Agency logos are arbitrary external URLs, so next/image is not
                // used here — no remote patterns can be configured for them.
                // eslint-disable-next-line @next/next/no-img-element
                <img src={preparedBy.logoUrl} alt={preparedBy.agencyName} className="h-10 w-auto mb-2 object-contain" />
              ) : (
                <p className="text-lg font-semibold" style={{ color: 'var(--p-primary)' }}>
                  {preparedBy.agencyName}
                </p>
              )}
              <p className="text-xs uppercase tracking-wide text-slate-400 mt-2">{section.title}</p>
              {preparedBy.agentName && <p className="text-sm text-slate-700">{preparedBy.agentName}</p>}
              <div className="text-sm text-slate-500">
                {preparedBy.phone && <p>{preparedBy.phone}</p>}
                {(preparedBy.agentEmail || preparedBy.email) && <p>{preparedBy.agentEmail ?? preparedBy.email}</p>}
                {preparedBy.website && <p>{preparedBy.website}</p>}
              </div>
            </div>
          </div>
        );

      case 'clientInformation':
        return (
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-400 mb-1">{section.title}</p>
            <p className="text-lg font-medium" style={{ color: 'var(--p-primary)' }}>
              {preparedFor.insuredName}
            </p>
            <div className="mt-2 grid grid-cols-2 gap-4 max-w-sm text-sm">
              <div>
                <span className="block text-xs text-slate-400">Proposal date</span>
                <span className="text-slate-700">{longDate(preparedFor.proposalDate)}</span>
              </div>
              <div>
                <span className="block text-xs text-slate-400">Effective date</span>
                <span className="text-slate-700">{longDate(preparedFor.effectiveDate)}</span>
              </div>
            </div>
          </div>
        );

      case 'recommendation':
        if (!proposal.recommendation) return null;
        return (
          <div>
            <SectionHeading>{section.title}</SectionHeading>
            <div className="rounded-xl p-4" style={{ backgroundColor: 'var(--p-tint)' }}>
              <p className="text-sm font-semibold mb-1" style={{ color: 'var(--p-primary)' }}>
                {proposal.recommendation.optionLabel}
              </p>
              <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-line">
                {proposal.recommendation.rationale ?? 'No explanation has been written yet.'}
              </p>
            </div>
          </div>
        );

      case 'quoteOptions':
        return (
          <div>
            <SectionHeading>{section.title}</SectionHeading>
            <div className="overflow-x-auto rounded-xl border border-slate-200">
              <table className="w-full border-collapse min-w-[560px]">
                <thead>
                  <tr className="border-b border-slate-200">
                    <th className="px-4 py-2.5 text-left text-xs font-medium text-slate-400 uppercase w-40">Option</th>
                    <th className="px-4 py-2.5 text-left text-xs font-medium text-slate-400 uppercase">Carrier</th>
                    <th className="px-4 py-2.5 text-left text-xs font-medium text-slate-400 uppercase">Premium</th>
                    <th className="px-4 py-2.5 text-left text-xs font-medium text-slate-400 uppercase">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {proposal.options.map((o) => (
                    <tr key={o.id} className="border-b border-slate-100">
                      <td className="px-4 py-3 text-sm">
                        <span className="font-medium text-slate-800">{o.label}</span>
                        {o.isRecommended && (
                          <span className="ml-1.5 text-[10px] font-semibold px-1.5 py-0.5 rounded-full"
                                style={{ backgroundColor: 'var(--p-tint)', color: 'var(--p-primary)' }}>
                            Recommended
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-600">{o.carrierName ?? '—'}</td>
                      <td className="px-4 py-3 text-sm text-slate-600">{money(o.premiumAnnual)}</td>
                      <td className="px-4 py-3 text-sm font-semibold text-slate-900">{money(o.totalAnnual)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {proposal.keyDifferences.length > 0 && (
              <div className="mt-3 rounded-lg bg-slate-50 border border-slate-200 px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-1.5">
                  Key differences
                </p>
                <ul className="space-y-1">
                  {proposal.keyDifferences.map((d, i) => (
                    <li key={i} className="text-sm text-slate-600">{d}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        );

      case 'coverageBreakdown': {
        const withCoverages = proposal.options.filter((o) => o.coverages.length > 0);
        if (withCoverages.length === 0) return null;
        return (
          <div>
            <SectionHeading>{section.title}</SectionHeading>
            <div className="space-y-4">
              {withCoverages.map((o) => (
                <div key={o.id}>
                  <p className="text-sm font-medium text-slate-700 mb-2">{o.label}</p>
                  <div className="space-y-2">
                    {o.coverages.map((c, i) => (
                      <div key={i} className="rounded-lg border border-slate-200 p-3">
                        <div className="flex items-baseline justify-between gap-3 flex-wrap">
                          <span className="text-sm font-medium" style={{ color: 'var(--p-primary)' }}>{c.name}</span>
                          <span className="text-xs text-slate-500">
                            {c.included ? (
                              <>
                                {c.limit ?? 'Included'}
                                {c.deductible && ` · ${c.deductible} deductible`}
                              </>
                            ) : 'Not included'}
                          </span>
                        </div>
                        {c.plainLanguage && (
                          <p className="text-sm text-slate-600 leading-relaxed mt-1">{c.plainLanguage}</p>
                        )}
                        {c.whyItMatters && (
                          <p className="text-sm text-slate-500 leading-relaxed mt-1">{c.whyItMatters}</p>
                        )}
                        {c.differsFromOthers && (
                          <p className="text-sm leading-relaxed mt-1.5 pl-2 border-l-2"
                             style={{ borderColor: 'var(--p-accent)', color: '#475569' }}>
                            {c.differsFromOthers}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      }

      default: {
        // Content sections: executive summary, considerations, notes, next steps.
        const body = (section.body ?? '').trim();
        if (body === '') return null;
        return (
          <div>
            <SectionHeading>{section.title}</SectionHeading>
            <p className="text-sm text-slate-600 leading-relaxed whitespace-pre-line">{body}</p>
          </div>
        );
      }
    }
  }

  return (
    <div
      className="rounded-xl border border-slate-200 bg-white p-6 sm:p-8"
      style={{
        // Branding flows to every child through these, so no component below
        // needs to know where the colours came from.
        ['--p-primary' as string]: branding.primaryColor,
        ['--p-accent' as string]: branding.secondaryColor,
        ['--p-tint' as string]: `${branding.secondaryColor}1A`, // ~10% alpha
      } as React.CSSProperties}
      data-testid="proposal-preview"
    >
      <h1 className="text-xl sm:text-2xl font-medium mb-6" style={{ color: 'var(--p-primary)' }}>
        {proposal.title}
      </h1>

      {proposal.clientMessage && (
        <p className="text-sm text-slate-600 leading-relaxed whitespace-pre-line mb-6 pb-6 border-b border-slate-200">
          {proposal.clientMessage}
        </p>
      )}

      <div className="space-y-8">
        {proposal.sections
          .filter((s) => s.enabled)
          .map((section) => {
            const rendered = renderSection(section);
            return rendered ? <section key={section.key}>{rendered}</section> : null;
          })}
      </div>

      <div className="mt-8 pt-6 border-t border-slate-200 space-y-3">
        {branding.footerText && (
          <p className="text-xs text-slate-500 leading-relaxed">{branding.footerText}</p>
        )}
        <p className="text-[11px] text-slate-400 leading-relaxed" data-testid="proposal-disclaimer">
          {proposal.disclaimer}
        </p>
      </div>
    </div>
  );
}
