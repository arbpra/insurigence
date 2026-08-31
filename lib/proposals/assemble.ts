/**
 * Assembles everything needed to render a proposal.
 *
 * One assembler serves the agent's builder preview, the insured's web view
 * (Phase 6), and the PDF (Phase 8), so those three can never drift apart.
 *
 * The `audience` argument is the security boundary for requirement 17. In
 * 'client' mode the payload is built by *listing what may be included* rather
 * than by deleting what may not — so a field added later is private until
 * someone deliberately exposes it, instead of leaking the moment it appears.
 */

import type { Agency, Lead, Proposal, QuoteOption, User } from '@prisma/client';
import { serializeQuoteOption, type QuoteOptionDTO } from '../quotes/quoteOption';
import { normalizeCoverages, toClientFacing } from '../quotes/coverage';
import { buildComparison, differenceSummaries, type Comparison } from '../quotes/comparison';
import { normalizeSections, visibleSections, type ProposalSection } from './sections';
import { resolveBranding, resolveDisclaimer, type ResolvedBranding } from './branding';

export type Audience = 'agent' | 'client';

export interface PreparedBy {
  agencyName: string;
  agentName: string | null;
  agentEmail: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  logoUrl: string | null;
}

export interface PreparedFor {
  insuredName: string;
  proposalDate: string;
  effectiveDate: string | null;
  /** Agent audience only — the insured's own view has no use for this. */
  contactEmail?: string | null;
}

/** A quote option as the insured sees it — no internal notes, no review trail. */
export interface ClientQuoteOption {
  id: string;
  label: string;
  carrierName: string | null;
  programName: string | null;
  policyType: string | null;
  effectiveDate: string | null;
  expirationDate: string | null;
  premiumAnnual: number | null;
  taxes: number | null;
  fees: number | null;
  totalAnnual: number | null;
  paymentPlan: string | null;
  isRecommended: boolean;
  coverages: ReturnType<typeof toClientFacing>;
}

export interface AssembledProposal {
  id: string;
  title: string;
  status: string;
  version: number;
  sections: ProposalSection[];
  branding: ResolvedBranding;
  disclaimer: string;
  preparedBy: PreparedBy;
  preparedFor: PreparedFor;
  clientMessage: string | null;
  recommendation: {
    optionId: string;
    optionLabel: string;
    rationale: string | null;
  } | null;
  options: ClientQuoteOption[];
  comparison: Comparison;
  keyDifferences: string[];
  /** Agent-only. Absent entirely for the client audience. */
  internal?: {
    optionsFull: QuoteOptionDTO[];
    agentNotes: (string | null)[];
    unreviewedAiCoverages: number;
    rationaleNeedsReview: boolean;
  };
}

export interface AssembleInput {
  proposal: Proposal;
  lead: Lead;
  agency: Agency;
  options: QuoteOption[];
  createdBy?: Pick<User, 'firstName' | 'lastName' | 'email'> | null;
}

function fullName(user?: Pick<User, 'firstName' | 'lastName'> | null): string | null {
  if (!user) return null;
  const name = [user.firstName, user.lastName].filter(Boolean).join(' ').trim();
  return name === '' ? null : name;
}

/**
 * Earliest effective date across the options — what the insured thinks of as
 * "when this starts". Null when no option carries one.
 */
function earliestEffective(options: QuoteOption[]): string | null {
  const dates = options.map((o) => o.effectiveDate).filter((d): d is Date => Boolean(d));
  if (dates.length === 0) return null;
  return new Date(Math.min(...dates.map((d) => d.getTime()))).toISOString();
}

export function assembleProposal(
  { proposal, lead, agency, options, createdBy }: AssembleInput,
  { audience }: { audience: Audience }
): AssembledProposal {
  const sections = normalizeSections(proposal.sections);
  const branding = resolveBranding(agency);
  const dtos = options.map(serializeQuoteOption);
  const comparison = buildComparison(dtos);

  const recommendedOption = options.find((o) => o.isRecommended) ?? null;

  // Client-facing options are constructed field by field. Nothing is spread in
  // from the full record, so notes, documents, and sort metadata cannot leak.
  const clientOptions: ClientQuoteOption[] = dtos.map((o) => ({
    id: o.id,
    label: o.optionLabel || o.carrierName || 'Option',
    carrierName: o.carrierName,
    programName: o.programName,
    policyType: o.policyType,
    effectiveDate: o.effectiveDate,
    expirationDate: o.expirationDate,
    premiumAnnual: o.premiumAnnual,
    taxes: o.taxes,
    fees: o.fees,
    totalAnnual: o.totalAnnual,
    paymentPlan: o.paymentPlan,
    isRecommended: o.isRecommended,
    coverages: toClientFacing(normalizeCoverages(o.coverages)),
  }));

  const assembled: AssembledProposal = {
    id: proposal.id,
    title: proposal.title,
    status: proposal.status,
    version: proposal.version,
    sections: audience === 'client' ? visibleSections(sections) : sections,
    branding,
    disclaimer: resolveDisclaimer(agency.proposalDisclaimerText, proposal.disclaimerText),
    preparedBy: {
      agencyName: branding.agencyName,
      agentName: fullName(createdBy),
      agentEmail: createdBy?.email ?? null,
      phone: branding.phone,
      email: branding.email,
      website: branding.website,
      logoUrl: branding.logoUrl,
    },
    preparedFor: {
      insuredName: lead.insuredName,
      proposalDate: (proposal.sentAt ?? proposal.createdAt).toISOString(),
      effectiveDate: earliestEffective(options),
      ...(audience === 'agent' ? { contactEmail: lead.primaryContactEmail } : {}),
    },
    clientMessage: proposal.clientMessage,
    recommendation: recommendedOption
      ? {
          optionId: recommendedOption.id,
          optionLabel: recommendedOption.optionLabel ?? recommendedOption.carrierName ?? 'Option',
          rationale: recommendedOption.recommendationRationale,
        }
      : null,
    options: clientOptions,
    comparison,
    keyDifferences: differenceSummaries(comparison),
  };

  if (audience === 'agent') {
    const unreviewed = options.reduce((n, o) => {
      const cov = normalizeCoverages(o.coverages);
      return n + cov.filter((c) => c.aiDrafted && !c.agentEdited && !c.reviewedAt).length;
    }, 0);

    assembled.internal = {
      optionsFull: dtos,
      agentNotes: options.map((o) => o.notes),
      unreviewedAiCoverages: unreviewed,
      rationaleNeedsReview: Boolean(recommendedOption?.rationaleAiDrafted),
    };
  }

  return assembled;
}

/**
 * Reasons a proposal is not ready to send. Empty means ready.
 * Surfaced in the builder so problems are caught before the insured sees them.
 */
export function readinessProblems(assembled: AssembledProposal): string[] {
  const problems: string[] = [];

  if (assembled.options.length === 0) {
    problems.push('No quote options have been added.');
  }
  if (assembled.options.length === 1) {
    problems.push('Only one option — the insured has nothing to compare.');
  }
  if (!assembled.recommendation) {
    problems.push('No option is marked as recommended.');
  } else if (!assembled.recommendation.rationale?.trim()) {
    problems.push('The recommended option has no explanation of why.');
  }
  if (assembled.internal?.unreviewedAiCoverages) {
    problems.push(
      `${assembled.internal.unreviewedAiCoverages} AI-drafted coverage explanation(s) have not been reviewed.`
    );
  }
  if (assembled.internal?.rationaleNeedsReview) {
    problems.push('The recommendation wording is still an unedited AI draft.');
  }
  const emptyEnabled = assembled.sections.filter(
    (s) => s.enabled && s.body !== null && s.body.trim() === ''
  );
  for (const s of emptyEnabled) {
    problems.push(`"${s.title}" is switched on but empty.`);
  }

  return problems;
}
