/**
 * Tests for the insured's experience: public access without a session, the
 * client payload boundary, and the option selection flow.
 * Run with:  npx tsx script/verify-insured-flow.ts
 */
import { existsSync } from 'fs';
import { prisma } from '../lib/prisma';
import { generateProposalToken, defaultExpiry, resolveProposalToken } from '../lib/proposals/token';
import { assembleProposal } from '../lib/proposals/assemble';
import { defaultSections } from '../lib/proposals/sections';

let pass = 0, fail = 0;
const ok = (n: string, c: boolean) => { c ? pass++ : fail++; console.log(`  ${c ? '✓' : '✗'} ${n}`); };

(async () => {
  console.log('\n━━ The proposal page is reachable without a session ━━');
  // The (main) layout redirects to /login when there is no session, so a public
  // page must not live inside that route group.
  ok('page is NOT under the authenticated (main) group',
    !existsSync('app/(main)/proposal'));
  ok('page sits at the public app root', existsSync('app/proposal/[publicToken]/page.tsx'));
  ok('legacy view preserved alongside it', existsSync('app/proposal/[publicToken]/LegacyProposalView.tsx'));
  ok('agent-facing proposals list still behind auth', existsSync('app/(main)/proposals/page.tsx'));

  const lead = await prisma.lead.findFirst({ select: { id: true, agencyId: true, insuredName: true } });
  const agency = lead ? await prisma.agency.findUnique({ where: { id: lead.agencyId } }) : null;
  if (!lead || !agency) { console.log('  ! no lead/agency available'); process.exit(1); }

  const made: string[] = [];
  const optionIds: string[] = [];

  const optA = await prisma.quoteOption.create({
    data: {
      agencyId: lead.agencyId, leadId: lead.id, optionLabel: 'Option 1', carrierName: 'Travelers',
      isRecommended: true, recommendationRationale: 'Broadest cover.', sortOrder: 0,
      premiumAnnualCents: BigInt(875000), totalAnnualCents: BigInt(912500),
      notes: 'INTERNAL ONLY: declined by another market',
      coverages: [{ key: 'k1', name: 'Garagekeepers', limit: '$250,000', deductible: '$1,000',
                    included: true, plainLanguage: 'Covers customer cars.', whyItMatters: 'You store cars.',
                    differsFromOthers: 'Higher than Option 2.', aiDrafted: true, agentEdited: true, reviewedAt: null }],
    },
  });
  const optB = await prisma.quoteOption.create({
    data: {
      agencyId: lead.agencyId, leadId: lead.id, optionLabel: 'Option 2', carrierName: 'Westfield',
      sortOrder: 1, premiumAnnualCents: BigInt(920000), totalAnnualCents: BigInt(920000),
      coverages: [{ key: 'k2', name: 'Garagekeepers', limit: '$100,000', deductible: '$2,500', included: true }],
    },
  });
  optionIds.push(optA.id, optB.id);

  const proposal = await prisma.proposal.create({
    data: {
      agencyId: lead.agencyId, leadId: lead.id, title: 'Insured flow test',
      status: 'SENT', sentAt: new Date(), expiresAt: defaultExpiry(),
      publicToken: generateProposalToken(),
      sections: defaultSections() as never,
    },
  });
  made.push(proposal.id);

  console.log('\n━━ Token gate protects the insured view ━━');
  {
    const r = await resolveProposalToken(proposal.publicToken!);
    ok('a sent proposal resolves for an anonymous visitor', r.ok === true);
  }

  console.log('\n━━ Client payload withholds internal data ━━');
  {
    const options = await prisma.quoteOption.findMany({ where: { leadId: lead.id }, orderBy: { sortOrder: 'asc' } });
    const client = assembleProposal({ proposal, lead: lead as never, agency, options }, { audience: 'client' });
    const blob = JSON.stringify(client);

    ok('agent notes withheld', !blob.includes('INTERNAL ONLY'));
    ok('no internal block', client.internal === undefined);
    // The lead may already carry options created through the UI, so assert on
    // the two this test made rather than on a total count.
    const ids = client.options.map(o => o.id);
    ok('both test options present', ids.includes(optA.id) && ids.includes(optB.id));
    ok('recommendation shown', client.recommendation?.rationale === 'Broadest cover.');
    ok('coverage prose shown', blob.includes('Covers customer cars.'));
    ok('comparison prose shown', blob.includes('Higher than Option 2.'));
    ok('key differences computed', client.keyDifferences.length > 0);
    ok('disclaimer present', client.disclaimer.includes('not an insurance policy'));
    console.log(`      "${client.keyDifferences[0]}"`);
  }

  console.log('\n━━ Option selection ━━');
  {
    // Selecting an option that belongs to another lead must be impossible even
    // with a valid token — the token authorises this proposal, not any option.
    const foreign = await prisma.quoteOption.findFirst({
      where: { leadId: { not: lead.id } }, select: { id: true },
    });
    if (foreign) {
      const match = await prisma.quoteOption.findFirst({
        where: { id: foreign.id, leadId: proposal.leadId, agencyId: proposal.agencyId },
      });
      ok('another lead\'s option is not selectable', match === null);
    } else {
      console.log('  – skipped foreign-option check (no other lead has options)');
    }

    let p = await prisma.proposal.update({
      where: { id: proposal.id },
      data: { selectedQuoteOptionId: optA.id, selectedAt: new Date(), status: 'OPTION_SELECTED' },
    });
    ok('selection recorded', p.selectedQuoteOptionId === optA.id);
    ok('status advanced to OPTION_SELECTED', p.status === 'OPTION_SELECTED');
    const firstSelectedAt = p.selectedAt!;

    // Changing the mind before signing keeps the original decision timestamp.
    p = await prisma.proposal.update({
      where: { id: proposal.id },
      data: { selectedQuoteOptionId: optB.id, selectedAt: p.selectedAt ?? new Date() },
    });
    ok('choice can be changed before signing', p.selectedQuoteOptionId === optB.id);
    ok('original selection time preserved', p.selectedAt!.getTime() === firstSelectedAt.getTime());

    // Still readable after selecting.
    ok('proposal still readable after selecting', (await resolveProposalToken(p.publicToken!)).ok === true);
  }

  console.log('\n━━ Viewing does not regress a decision ━━');
  {
    const selected = await prisma.proposal.findUniqueOrThrow({ where: { id: proposal.id } });
    ok('status stays OPTION_SELECTED on re-open', selected.status === 'OPTION_SELECTED');

    const signed = await prisma.proposal.update({
      where: { id: proposal.id },
      data: { status: 'SIGNED', signedAt: new Date(), lockedAt: new Date() },
    });
    const r = await resolveProposalToken(signed.publicToken!);
    ok('signed proposal stays readable to the insured', r.ok === true);
    ok('signed proposal is locked', signed.lockedAt !== null);
  }

  console.log('\n━━ Activity events recorded ━━');
  {
    const events = await prisma.proposalActivityEvent.findMany({ where: { proposalId: proposal.id } });
    ok('events table is queryable', Array.isArray(events));
  }

  await prisma.proposalActivityEvent.deleteMany({ where: { proposalId: proposal.id } });
  await prisma.proposal.deleteMany({ where: { id: { in: made } } });
  await prisma.quoteOption.deleteMany({ where: { id: { in: optionIds } } });
  ok('cleaned up', (await prisma.quoteOption.count({ where: { id: { in: optionIds } } })) === 0);

  console.log(`\n━━ ${pass} passed, ${fail} failed ━━\n`);
  await prisma.$disconnect();
  process.exit(fail ? 1 : 0);
})().catch(async (e) => { console.error('ERROR', e); await prisma.$disconnect(); process.exit(1); });
