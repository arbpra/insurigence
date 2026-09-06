/**
 * Agent notifications when a client acts on a proposal (requirement 12).
 *
 * Email only for MVP, per the client's direction — in-app notifications are a
 * later update.
 *
 * Notifying never blocks the insured. Every function here swallows its own
 * failures: a client must not see an error, or worse have their signature
 * rejected, because an email could not be sent.
 */

import prisma from '../prisma';
import type { Proposal } from '@prisma/client';
import { sendEmail } from '../email/send';
import { proposalActivityEmail } from '../email/templates';
import { APP_URL } from '../email/client';

/**
 * Who hears about this proposal.
 *
 * The agent who created it, and the agent the lead is assigned to if that is
 * someone else — both have a reason to know. Deduplicated, inactive users
 * dropped.
 */
async function recipientsFor(proposal: Proposal): Promise<{ email: string; name: string | null }[]> {
  const [creator, lead] = await Promise.all([
    proposal.createdByUserId
      ? prisma.user.findUnique({
          where: { id: proposal.createdByUserId },
          select: { email: true, firstName: true, lastName: true, isActive: true },
        })
      : null,
    prisma.lead.findUnique({
      where: { id: proposal.leadId },
      select: {
        assignedTo: { select: { email: true, firstName: true, lastName: true, isActive: true } },
      },
    }),
  ]);

  const people = [creator, lead?.assignedTo].filter(
    (u): u is NonNullable<typeof creator> => Boolean(u) && u!.isActive
  );

  const seen = new Set<string>();
  const out: { email: string; name: string | null }[] = [];
  for (const person of people) {
    const email = person.email?.trim().toLowerCase();
    if (!email || seen.has(email)) continue;
    seen.add(email);
    out.push({
      email,
      name: [person.firstName, person.lastName].filter(Boolean).join(' ').trim() || null,
    });
  }
  return out;
}

const money = (cents: bigint | null | undefined) =>
  cents === null || cents === undefined
    ? null
    : (Number(cents) / 100).toLocaleString('en-US', {
        style: 'currency', currency: 'USD', maximumFractionDigits: 0,
      });

export type ProposalActivity = 'opened' | 'selected' | 'signed';

/**
 * Notify the agent(s). Fire-and-forget: callers should not await this on the
 * critical path of an insured's request.
 */
export async function notifyAgentOfActivity(
  proposal: Proposal,
  event: ProposalActivity,
  extra: { signerName?: string | null } = {}
): Promise<void> {
  try {
    const [recipients, lead] = await Promise.all([
      recipientsFor(proposal),
      prisma.lead.findUnique({ where: { id: proposal.leadId }, select: { insuredName: true } }),
    ]);
    if (recipients.length === 0 || !lead) return;

    const option = proposal.selectedQuoteOptionId
      ? await prisma.quoteOption.findUnique({
          where: { id: proposal.selectedQuoteOptionId },
          select: { optionLabel: true, carrierName: true, totalAnnualCents: true },
        })
      : null;

    // Agents land on the builder, which is where the proposal's state lives.
    const url = `${APP_URL.replace(/\/+$/, '')}/leads/${proposal.leadId}/proposal-builder`;

    await Promise.all(
      recipients.map((r) => {
        const mail = proposalActivityEmail({
          agentName: r.name,
          insuredName: lead.insuredName,
          event,
          optionLabel: option?.carrierName ?? option?.optionLabel ?? null,
          optionTotal: money(option?.totalAnnualCents),
          signerName: extra.signerName ?? null,
          proposalUrl: url,
        });
        return sendEmail({ to: r.email, subject: mail.subject, html: mail.html, text: mail.text });
      })
    );
  } catch (err) {
    console.error('[proposal-notify] could not notify agent:', proposal.id, event, err);
  }
}
