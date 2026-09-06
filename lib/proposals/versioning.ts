/**
 * Proposal versioning (requirement 14).
 *
 * "If the agent changes a proposal after it has been sent: do not overwrite the
 *  original silently. Create a new proposal version. Previous version should
 *  remain in the audit history. Previously signed versions must never be
 *  editable."
 *
 * The rule that falls out of this: a DRAFT proposal is edited in place, and a
 * proposal the insured has already seen is forked. Editing a sent proposal in
 * place would change a document under someone who is reading it — and if they
 * had signed, would alter what they agreed to.
 */

import prisma from '../prisma';
import { Prisma, type Proposal } from '@prisma/client';
import { generateProposalToken } from './token';
import { recordProposalEvent } from './events';

/** Statuses where the insured has already been given the link. */
const ALREADY_OUT: string[] = ['SENT', 'VIEWED', 'OPTION_SELECTED', 'SIGNED', 'EXPIRED', 'REVOKED'];

export function needsNewVersion(proposal: Proposal): boolean {
  return ALREADY_OUT.includes(proposal.status);
}

/**
 * Fork a proposal into the next version.
 *
 * The new version starts as a DRAFT with its own token — deliberately not the
 * old one, so a link the insured already holds keeps showing the version they
 * were sent until the agent sends the new one.
 *
 * The old version is marked superseded but left otherwise untouched: its
 * signature, snapshot, and events remain exactly as they were.
 */
export async function createNextVersion(
  proposal: Proposal,
  createdByUserId: string | null
): Promise<Proposal> {
  const now = new Date();

  const [, next] = await prisma.$transaction([
    prisma.proposal.update({
      where: { id: proposal.id },
      data: { supersededAt: now },
    }),
    prisma.proposal.create({
      data: {
        agencyId: proposal.agencyId,
        leadId: proposal.leadId,
        createdByUserId: createdByUserId ?? proposal.createdByUserId,
        title: proposal.title,
        status: 'DRAFT',
        version: proposal.version + 1,
        supersedesProposalId: proposal.id,

        // Carry the agent's work forward.
        sections: (proposal.sections ?? Prisma.JsonNull) as Prisma.InputJsonValue,
        clientMessage: proposal.clientMessage,

        // A fresh link. The previous one keeps serving the previous version.
        publicToken: generateProposalToken(),

        // Deliberately NOT carried over: the disclaimer is re-frozen at the next
        // send, and every lifecycle timestamp starts empty because none of it has
        // happened to this version yet.
      },
    }),
  ]);

  await recordProposalEvent(next.id, next.agencyId, 'VERSION_CREATED', {
    metadata: {
      version: next.version,
      supersedes: proposal.id,
      supersededVersion: proposal.version,
    },
  });

  return next;
}

/** Every version for a lead, newest first. */
export async function versionHistory(leadId: string, agencyId: string) {
  const versions = await prisma.proposal.findMany({
    where: { leadId, agencyId, NOT: { sections: { equals: null } } },
    orderBy: [{ version: 'desc' }, { createdAt: 'desc' }],
    select: {
      id: true, version: true, status: true, createdAt: true, sentAt: true,
      signedAt: true, supersededAt: true, lockedAt: true,
    },
  });
  return versions.map((v) => ({
    id: v.id,
    version: v.version,
    status: v.status,
    createdAt: v.createdAt.toISOString(),
    sentAt: v.sentAt?.toISOString() ?? null,
    signedAt: v.signedAt?.toISOString() ?? null,
    superseded: v.supersededAt !== null,
    locked: v.lockedAt !== null,
  }));
}
