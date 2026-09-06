/**
 * Tests for Phase 9 (activity log, notifications, status sync) and
 * Phase 10 (versioning).
 * Run with:  npx tsx script/verify-tracking.ts
 */
import { prisma } from '../lib/prisma';
import {
  isForwardTransition, leadStatusFor, syncLeadStatus,
  markExpiredIfLapsed, PROPOSAL_STATUS_LABEL,
} from '../lib/proposals/status';
import { needsNewVersion, createNextVersion, versionHistory } from '../lib/proposals/versioning';
import { generateProposalToken, defaultExpiry, resolveProposalToken } from '../lib/proposals/token';
import { defaultSections } from '../lib/proposals/sections';
import { proposalActivityEmail } from '../lib/email/templates';
import type { ProposalStatus } from '@prisma/client';

let pass = 0, fail = 0;
const ok = (n: string, c: boolean) => { c ? pass++ : fail++; console.log(`  ${c ? '✓' : '✗'} ${n}`); };

(async () => {
  console.log('\n━━ A proposal never moves backwards ━━');
  ok('DRAFT → SENT allowed', isForwardTransition('DRAFT', 'SENT'));
  ok('SENT → VIEWED allowed', isForwardTransition('SENT', 'VIEWED'));
  ok('OPTION_SELECTED → VIEWED refused', !isForwardTransition('OPTION_SELECTED', 'VIEWED'));
  ok('SIGNED → VIEWED refused', !isForwardTransition('SIGNED', 'VIEWED'));
  ok('SIGNED → SENT refused', !isForwardTransition('SIGNED', 'SENT'));
  ok('anything → REVOKED allowed', isForwardTransition('VIEWED', 'REVOKED'));
  ok('REVOKED → VIEWED refused', !isForwardTransition('REVOKED', 'VIEWED'));
  ok('EXPIRED does not resume', !isForwardTransition('EXPIRED', 'VIEWED'));
  ok('every status has a label',
    (Object.keys(PROPOSAL_STATUS_LABEL) as ProposalStatus[]).length === 9);

  console.log('\n━━ Lead status mapping (requirement 13) ━━');
  ok('SENT implies PRESENTED', leadStatusFor('SENT') === 'PRESENTED');
  ok('OPTION_SELECTED implies PRESENTED', leadStatusFor('OPTION_SELECTED') === 'PRESENTED');
  ok('SIGNED implies READY_TO_BIND', leadStatusFor('SIGNED') === 'READY_TO_BIND');
  ok('signing never implies BOUND', leadStatusFor('SIGNED') !== 'BOUND');
  ok('DRAFT moves nothing', leadStatusFor('DRAFT') === null);
  ok('REVOKED moves nothing', leadStatusFor('REVOKED') === null);

  const agency = await prisma.agency.findFirst();
  if (!agency) { console.log('  ! no agency'); process.exit(1); }

  const leadIds: string[] = [];
  const proposalIds: string[] = [];

  /**
   * One lead, reset between cases.
   *
   * Lead.intakeSubmissionId is `@unique` and MongoDB's unique index rejects a
   * second null, so only one lead without an intake submission can exist at a
   * time. The app never hits this — it only creates leads from intake — but a
   * test that made several would.
   */
  const sharedLead = await prisma.lead.create({
    data: { agencyId: agency.id, insuredName: 'Status test lead', status: 'NEW' },
  });
  leadIds.push(sharedLead.id);

  const mkLead = async (status: 'NEW' | 'QUOTED' | 'PRESENTED' | 'BOUND' | 'LOST' | 'READY_TO_BIND') => {
    return prisma.lead.update({ where: { id: sharedLead.id }, data: { status } });
  };

  console.log('\n━━ Lead sync against the live database ━━');
  {
    const l = await mkLead('QUOTED');
    await syncLeadStatus(l.id, 'SENT');
    ok('QUOTED advances to PRESENTED on send',
      (await prisma.lead.findUniqueOrThrow({ where: { id: l.id } })).status === 'PRESENTED');

    await syncLeadStatus(l.id, 'SIGNED');
    ok('PRESENTED advances to READY_TO_BIND on signature',
      (await prisma.lead.findUniqueOrThrow({ where: { id: l.id } })).status === 'READY_TO_BIND');

    // A later view must not drag the lead back.
    await syncLeadStatus(l.id, 'VIEWED');
    ok('a later view does not rewind the lead',
      (await prisma.lead.findUniqueOrThrow({ where: { id: l.id } })).status === 'READY_TO_BIND');
  }
  {
    const lost = await mkLead('LOST');
    await syncLeadStatus(lost.id, 'SIGNED');
    ok('a LOST lead is never moved by a proposal',
      (await prisma.lead.findUniqueOrThrow({ where: { id: lost.id } })).status === 'LOST');

    const bound = await mkLead('BOUND');
    await syncLeadStatus(bound.id, 'SENT');
    ok('a BOUND lead is never moved backwards',
      (await prisma.lead.findUniqueOrThrow({ where: { id: bound.id } })).status === 'BOUND');
  }

  console.log('\n━━ Lazy expiry ━━');
  {
    const lead = await mkLead('NEW');
    const stale = await prisma.proposal.create({
      data: {
        agencyId: agency.id, leadId: lead.id, title: 'Expiry test', status: 'SENT',
        sentAt: new Date('2026-01-01'), expiresAt: new Date('2026-02-01'),
        publicToken: generateProposalToken(), sections: defaultSections() as never,
      },
    });
    proposalIds.push(stale.id);

    ok('a lapsed proposal reads as SENT before the check', stale.status === 'SENT');
    const after = await markExpiredIfLapsed(stale);
    ok('marked EXPIRED once checked', after === 'EXPIRED');
    ok('persisted to the database',
      (await prisma.proposal.findUniqueOrThrow({ where: { id: stale.id } })).status === 'EXPIRED');
    ok('an EXPIRED event was recorded',
      (await prisma.proposalActivityEvent.count({
        where: { proposalId: stale.id, eventType: 'EXPIRED' } })) === 1);
    ok('the link no longer resolves', (await resolveProposalToken(stale.publicToken!)).ok === false);

    // A signed proposal is finished; its link lapsing must not undo that.
    const signed = await prisma.proposal.create({
      data: {
        agencyId: agency.id, leadId: lead.id, title: 'Signed + lapsed', status: 'SIGNED',
        sentAt: new Date('2026-01-01'), expiresAt: new Date('2026-02-01'),
        signedAt: new Date('2026-01-15'), lockedAt: new Date('2026-01-15'),
        publicToken: generateProposalToken(), sections: defaultSections() as never,
      },
    });
    proposalIds.push(signed.id);
    ok('a signed proposal is never marked expired',
      (await markExpiredIfLapsed(signed)) === 'SIGNED');
  }

  console.log('\n━━ Versioning (requirement 14) ━━');
  {
    const lead = await mkLead('NEW');
    const draft = await prisma.proposal.create({
      data: {
        agencyId: agency.id, leadId: lead.id, title: 'Version test', status: 'DRAFT',
        publicToken: generateProposalToken(), sections: defaultSections() as never,
        clientMessage: 'Original note.',
      },
    });
    proposalIds.push(draft.id);
    ok('a DRAFT is edited in place, not forked', !needsNewVersion(draft));

    const sent = await prisma.proposal.update({
      where: { id: draft.id },
      data: { status: 'SENT', sentAt: new Date(), expiresAt: defaultExpiry() },
    });
    ok('a SENT proposal must be forked', needsNewVersion(sent));

    const v2 = await createNextVersion(sent, null);
    proposalIds.push(v2.id);

    ok('new version numbered 2', v2.version === 2);
    ok('new version starts as a DRAFT', v2.status === 'DRAFT');
    ok('new version links back to the old one', v2.supersedesProposalId === sent.id);
    ok('agent content carried forward', v2.clientMessage === 'Original note.');
    ok('sections carried forward', Array.isArray(v2.sections));
    ok('a fresh token was minted', v2.publicToken !== sent.publicToken);
    ok('lifecycle timestamps start empty', v2.sentAt === null && v2.signedAt === null);

    const oldNow = await prisma.proposal.findUniqueOrThrow({ where: { id: sent.id } });
    ok('previous version marked superseded', oldNow.supersededAt !== null);
    ok('previous version otherwise untouched', oldNow.status === 'SENT' && oldNow.version === 1);
    // The whole point: the link the insured holds still serves what they were sent.
    ok('the old link still resolves to the old version',
      (await resolveProposalToken(oldNow.publicToken!)).ok === true);
    ok('a VERSION_CREATED event was recorded',
      (await prisma.proposalActivityEvent.count({
        where: { proposalId: v2.id, eventType: 'VERSION_CREATED' } })) === 1);

    // The shared lead also carries the expiry-test proposals, so assert on the
    // two in this version chain rather than on the whole list.
    const history = await versionHistory(lead.id, agency.id);
    const chain = history.filter(h => h.id === sent.id || h.id === v2.id);
    ok('history lists the chain newest first',
      chain.length === 2 && chain[0].version === 2 && chain[1].version === 1);
    ok('history marks the superseded one', chain[1].superseded === true);
    ok('the new version is not marked superseded', chain[0].superseded === false);
  }

  console.log('\n━━ Agent notification emails ━━');
  {
    const opened = proposalActivityEmail({
      agentName: 'Pat', insuredName: 'Joes Garage', event: 'opened',
      proposalUrl: 'https://app.example/leads/1/proposal-builder',
    });
    ok('open subject names the insured', opened.subject.includes('Joes Garage'));
    ok('open email says no action needed', /no action/i.test(opened.text));

    const signed = proposalActivityEmail({
      agentName: 'Pat', insuredName: 'Joes Garage', event: 'signed',
      optionLabel: 'Travelers', optionTotal: '$9,125', signerName: 'Joseph Marino',
      proposalUrl: 'https://app.example/x',
    });
    ok('signed subject is unambiguous', /signed/i.test(signed.subject));
    ok('signed email names the signer', signed.html.includes('Joseph Marino'));
    // The most important line in the whole system.
    ok('signed email states coverage is NOT bound', /not<\/strong> bound|NOT bound/i.test(signed.html));
    ok('plain-text version also states it', /NOT bound/i.test(signed.text));

    const selected = proposalActivityEmail({
      insuredName: 'X', event: 'selected', optionLabel: 'Westfield',
      optionTotal: '$9,200', proposalUrl: 'u',
    });
    ok('selected email says they can still change', /change their mind/i.test(selected.html));
    ok('html is escaped', !proposalActivityEmail({
      insuredName: '<script>x</script>', event: 'opened', proposalUrl: 'u',
    }).html.includes('<script>x</script>'));
  }

  // Cleanup
  await prisma.proposalActivityEvent.deleteMany({ where: { proposalId: { in: proposalIds } } });
  await prisma.proposal.deleteMany({ where: { id: { in: proposalIds } } });
  await prisma.lead.deleteMany({ where: { id: { in: leadIds } } });
  ok('cleaned up', (await prisma.lead.count({ where: { id: { in: leadIds } } })) === 0);

  console.log(`\n━━ ${pass} passed, ${fail} failed ━━\n`);
  await prisma.$disconnect();
  process.exit(fail ? 1 : 0);
})().catch(async (e) => { console.error('ERROR', e); await prisma.$disconnect(); process.exit(1); });
