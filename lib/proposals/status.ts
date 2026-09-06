/**
 * Proposal status transitions and the lead status they drive (requirement 13).
 *
 * Two rules govern everything here:
 *
 *   A proposal never moves backwards. Re-opening a proposal after selecting or
 *   signing must not undo that decision, so transitions are ranked and only
 *   forward moves are applied.
 *
 *   Insurigence never binds coverage. A signature takes a lead as far as
 *   READY_TO_BIND and no further — BOUND is a carrier action that a person
 *   confirms.
 */

import prisma from '../prisma';
import type { LeadStatus, Proposal, ProposalStatus } from '@prisma/client';
import { recordProposalEvent } from './events';

/**
 * How far through the journey each status sits. Terminal states (DECLINED,
 * EXPIRED, REVOKED) sit outside the ranking — they are endings, not progress,
 * and are only ever set deliberately.
 */
const PROGRESS: Record<string, number> = {
  DRAFT: 0,
  READY_TO_SEND: 1,
  SENT: 2,
  VIEWED: 3,
  OPTION_SELECTED: 4,
  SIGNED: 5,
};

const TERMINAL: ProposalStatus[] = ['DECLINED', 'EXPIRED', 'REVOKED'];

/** True when moving to `next` would be forward progress. */
export function isForwardTransition(current: ProposalStatus, next: ProposalStatus): boolean {
  if (TERMINAL.includes(next)) return true; // endings are always allowed
  if (TERMINAL.includes(current)) return false; // ...but nothing resumes from one
  const from = PROGRESS[current];
  const to = PROGRESS[next];
  if (from === undefined || to === undefined) return false;
  return to > from;
}

/**
 * The lead status a proposal status implies.
 *
 * Only the two milestones that mean something to the pipeline are mapped;
 * everything else leaves the lead alone.
 */
export function leadStatusFor(proposalStatus: ProposalStatus): LeadStatus | null {
  switch (proposalStatus) {
    case 'SENT':
    case 'VIEWED':
    case 'OPTION_SELECTED':
      return 'PRESENTED';
    case 'SIGNED':
      return 'READY_TO_BIND';
    default:
      return null;
  }
}

/** Lead statuses a person has moved past — never rewound automatically. */
const LEAD_PROGRESS: Record<string, number> = {
  NEW: 0,
  WAITING_ON_INFO: 1,
  READY_TO_MARKET: 2,
  QUOTED: 3,
  PRESENTED: 4,
  READY_TO_BIND: 5,
  BOUND: 6,
};

/**
 * Move the lead forward to match a proposal milestone.
 *
 * Never moves a lead backwards, never touches a LOST lead, and never sets
 * BOUND — that remains a human decision after the carrier confirms.
 */
export async function syncLeadStatus(
  leadId: string,
  proposalStatus: ProposalStatus
): Promise<void> {
  const target = leadStatusFor(proposalStatus);
  if (!target) return;

  try {
    const lead = await prisma.lead.findUnique({
      where: { id: leadId },
      select: { id: true, status: true },
    });
    if (!lead) return;

    // A lead someone has marked LOST or already BOUND is not moved by a proposal.
    if (lead.status === 'LOST' || lead.status === 'BOUND') return;

    const from = LEAD_PROGRESS[lead.status] ?? 0;
    const to = LEAD_PROGRESS[target] ?? 0;
    if (to <= from) return;

    await prisma.lead.update({ where: { id: lead.id }, data: { status: target } });
  } catch (err) {
    // A lead that fails to advance is a reporting inconvenience; it must never
    // fail the insured's action that triggered it.
    console.error('[proposal-status] lead sync failed for', leadId, err);
  }
}

/**
 * Mark a proposal expired once its link has lapsed.
 *
 * Done lazily on read rather than by a scheduled job: without it a lapsed
 * proposal still reads as SENT in the agent's list, which is misleading. The
 * write is idempotent, so concurrent reads settle on the same result.
 */
export async function markExpiredIfLapsed(proposal: Proposal): Promise<ProposalStatus> {
  const lapsed =
    proposal.expiresAt !== null &&
    proposal.expiresAt.getTime() < Date.now() &&
    !TERMINAL.includes(proposal.status) &&
    // A signed proposal is finished; expiry of its link does not undo that.
    proposal.status !== 'SIGNED' &&
    proposal.lockedAt === null;

  if (!lapsed) return proposal.status;

  try {
    await prisma.proposal.update({
      where: { id: proposal.id },
      data: { status: 'EXPIRED' },
    });
    await recordProposalEvent(proposal.id, proposal.agencyId, 'EXPIRED', {
      metadata: { expiresAt: proposal.expiresAt?.toISOString() ?? null },
    });
    return 'EXPIRED';
  } catch (err) {
    console.error('[proposal-status] could not mark expired:', proposal.id, err);
    return proposal.status;
  }
}

/** Human labels for the agent-facing UI. */
export const PROPOSAL_STATUS_LABEL: Record<ProposalStatus, string> = {
  DRAFT: 'Draft',
  READY_TO_SEND: 'Ready to send',
  SENT: 'Sent',
  VIEWED: 'Viewed',
  OPTION_SELECTED: 'Option selected',
  SIGNED: 'Signed',
  DECLINED: 'Declined',
  EXPIRED: 'Expired',
  REVOKED: 'Withdrawn',
};
