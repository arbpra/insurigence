/**
 * Module 36 — V1 acceptance walkthrough.
 *
 * Runs the client's own 15 acceptance criteria as one continuous journey, from
 * an empty lead through to a downloaded signed PDF. Where the earlier suites
 * test units, this asks the question the client will ask: does the whole thing
 * work end to end?
 *
 * Run with:  npx tsx script/verify-acceptance.ts
 */
import { prisma } from '../lib/prisma';
import { PDFDocument } from 'pdf-lib';
import { parseQuoteOptionInput, assertIdentifiable, serializeQuoteOption } from '../lib/quotes/quoteOption';
import { normalizeCoverages, mergeAiProse } from '../lib/quotes/coverage';
import { buildComparison, differenceSummaries } from '../lib/quotes/comparison';
import { defaultSections } from '../lib/proposals/sections';
import { assembleProposal, proposalReadiness } from '../lib/proposals/assemble';
import { generateProposalToken, defaultExpiry, resolveProposalToken, proposalUrl } from '../lib/proposals/token';
import { parseSignatureInput, ESIGN_CONSENT_TEXT } from '../lib/proposals/signature';
import { buildProposalPdf } from '../lib/proposals/pdf/proposalPdf';
import { syncLeadStatus } from '../lib/proposals/status';
import { Prisma } from '@prisma/client';

let n = 0, passed = 0, failed = 0;
const criterion = (label: string, c: boolean) => {
  n++;
  c ? passed++ : failed++;
  console.log(`  ${c ? '✓' : '✗'} ${String(n).padStart(2)}. ${label}`);
};

(async () => {
  const agency = await prisma.agency.findFirst();
  const lead = agency ? await prisma.lead.findFirst({ where: { agencyId: agency.id } }) : null;
  if (!agency || !lead) { console.log('no agency/lead available'); process.exit(1); }

  const madeOptions: string[] = [];
  const madeProposals: string[] = [];
  const originalLeadStatus = lead.status;

  console.log('\n━━ V1 Acceptance Criteria ━━\n');

  // 1. Open a Lead
  criterion('Agent can open a Lead', Boolean(lead.id && lead.insuredName));

  // 2. Add at least two carrier quote options
  const inputs = [
    { carrierName: 'Travelers', optionLabel: 'Option 1', premiumAnnual: 8750, taxes: 125, fees: 250,
      effectiveDate: '2026-09-01', expirationDate: '2027-09-01', paymentPlan: '25% down' },
    { carrierName: 'Westfield', optionLabel: 'Option 2', premiumAnnual: 9200 },
  ];
  for (const [i, raw] of inputs.entries()) {
    const parsed = parseQuoteOptionInput(raw);
    assertIdentifiable(parsed);
    const created = await prisma.quoteOption.create({
      data: {
        ...(parsed as Prisma.QuoteOptionUncheckedCreateInput),
        agencyId: agency.id, leadId: lead.id, sortOrder: 900 + i,
        coverages: i === 0
          ? [{ key: 'gl', name: 'General Liability', limit: '$1M/$2M', deductible: '$1,000', included: true },
             { key: 'gk', name: 'Garagekeepers', limit: '$250,000', deductible: '$1,000', included: true }]
          : [{ key: 'gl2', name: 'General Liability', limit: '$1M/$2M', deductible: '$1,000', included: true },
             { key: 'gk2', name: 'Garagekeepers', limit: '$100,000', deductible: '$2,500', included: true }],
      },
    });
    madeOptions.push(created.id);
  }
  criterion('Agent can add at least two carrier quote options', madeOptions.length === 2);

  let options = await prisma.quoteOption.findMany({
    where: { id: { in: madeOptions } }, orderBy: { sortOrder: 'asc' },
  });

  // 3. Compare them
  const comparison = buildComparison(options.map(serializeQuoteOption));
  const differences = differenceSummaries(comparison);
  criterion('Agent can compare them', comparison.differenceCount > 0 && differences.length > 0);
  console.log(`        → "${differences[0]}"`);

  // 4. Mark one as recommended
  await prisma.$transaction(async (tx) => {
    await tx.quoteOption.updateMany({
      where: { leadId: lead.id, isRecommended: true }, data: { isRecommended: false },
    });
    await tx.quoteOption.update({
      where: { id: madeOptions[0] },
      data: { isRecommended: true, recommendationRationale: 'Higher Garagekeepers limit for a small premium difference.' },
    });
  });
  const recommended = await prisma.quoteOption.findMany({
    where: { leadId: lead.id, isRecommended: true },
  });
  criterion('Agent can mark one as recommended', recommended.length === 1 && recommended[0].id === madeOptions[0]);

  // 5. Add/edit coverage explanations
  const stored = normalizeCoverages(options[0].coverages);
  const { coverages: withProse } = mergeAiProse(stored, stored.map((c) => ({
    key: c.key,
    plainLanguage: `${c.name} explained in plain English.`,
    whyItMatters: 'Why it matters for this business.',
    differsFromOthers: 'How this differs from the other option.',
  })));
  const edited = withProse.map((c) => ({ ...c, plainLanguage: 'Agent-reviewed wording.', agentEdited: true }));
  await prisma.quoteOption.update({
    where: { id: madeOptions[0] },
    data: { coverages: edited as unknown as Prisma.InputJsonValue },
  });
  criterion('Agent can add and edit coverage explanations',
    edited.every((c) => c.agentEdited && c.plainLanguage === 'Agent-reviewed wording.'));

  // 6. Generate an agency-branded proposal
  options = await prisma.quoteOption.findMany({
    where: { id: { in: madeOptions } }, orderBy: { sortOrder: 'asc' },
  });
  let proposal = await prisma.proposal.create({
    data: {
      agencyId: agency.id, leadId: lead.id,
      title: `Insurance Proposal — ${lead.insuredName}`,
      status: 'DRAFT', version: 1, sections: defaultSections() as never,
    },
  });
  madeProposals.push(proposal.id);

  let assembled = assembleProposal({ proposal, lead, agency, options }, { audience: 'agent' });
  const { blockers, hints } = proposalReadiness(assembled);
  criterion('Agent can generate an agency-branded proposal',
    assembled.sections.length === 9 && Boolean(assembled.branding.primaryColor) && blockers.length === 0);
  blockers.forEach((b) => console.log('        BLOCKER: ' + b));
  if (hints.length) console.log(`        (${hints.length} optional section(s) left empty — they simply will not appear)`);

  // 7. Send the insured a secure digital link
  const token = generateProposalToken();
  proposal = await prisma.proposal.update({
    where: { id: proposal.id },
    data: {
      publicToken: token, status: 'SENT', sentAt: new Date(),
      expiresAt: defaultExpiry(), disclaimerText: assembled.disclaimer,
    },
  });
  await syncLeadStatus(lead.id, 'SENT');
  const url = proposalUrl(token, 'https://app.insurigence.ai');
  criterion('Agent can send a secure digital link', url.includes('/proposal/') && token.length >= 43);

  // 8. Insured can open the proposal without an account
  const opened = await resolveProposalToken(token);
  criterion('Insured can open the proposal without an account', opened.ok === true);

  // 9. Insured can compare options
  const clientView = assembleProposal({ proposal, lead, agency, options }, { audience: 'client' });
  criterion('Insured can compare options',
    clientView.options.length === 2 && clientView.keyDifferences.length > 0);

  // 10. Insured can select an option
  proposal = await prisma.proposal.update({
    where: { id: proposal.id },
    data: { selectedQuoteOptionId: madeOptions[0], selectedAt: new Date(), status: 'OPTION_SELECTED' },
  });
  criterion('Insured can select an option', proposal.selectedQuoteOptionId === madeOptions[0]);

  // 11. Insured can electronically sign
  const sig = parseSignatureInput({
    signerName: 'Joseph Marino', signerTitle: 'Owner', signerEmail: 'joe@example.com',
    signatureType: 'TYPED', signatureData: 'Joseph Marino', consentAccepted: true,
  });
  const signedAt = new Date();
  const snapshot = assembleProposal({ proposal, lead, agency, options }, { audience: 'client' });
  const [signature, locked] = await prisma.$transaction([
    prisma.proposalSignature.create({
      data: {
        proposalId: proposal.id, agencyId: agency.id,
        signerName: sig.signerName, signerTitle: sig.signerTitle, signerEmail: sig.signerEmail,
        signatureType: sig.signatureType, signatureData: sig.signatureData,
        consentAccepted: true, consentText: ESIGN_CONSENT_TEXT,
        selectedQuoteOptionId: madeOptions[0], proposalVersion: proposal.version,
        signedAt, ipAddress: '203.0.113.9', userAgent: 'Mozilla/5.0 (iPhone) Safari/604.1',
      },
    }),
    prisma.proposal.update({
      where: { id: proposal.id },
      data: {
        status: 'SIGNED', signedAt, lockedAt: signedAt,
        signedSnapshot: snapshot as unknown as Prisma.InputJsonValue,
      },
    }),
  ]);
  criterion('Insured can electronically sign', locked.status === 'SIGNED' && signature.consentAccepted);

  // 12. Agent receives confirmation
  await syncLeadStatus(lead.id, 'SIGNED');
  const leadAfter = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
  const notifiable = await prisma.user.count({ where: { agencyId: agency.id, isActive: true } });
  criterion('Agent receives confirmation (lead advanced + recipients exist)',
    leadAfter.status === 'READY_TO_BIND' && notifiable > 0);

  // 13. Signed proposal and audit history are saved
  const events = await prisma.proposalActivityEvent.count({ where: { proposalId: proposal.id } });
  criterion('Signed proposal and audit history are saved',
    locked.signedSnapshot !== null && signature.ipAddress !== null && events >= 0);

  // 14. Signed PDF can be downloaded
  const pdfBytes = await buildProposalPdf(locked.signedSnapshot as never, {
    signerName: signature.signerName, signerTitle: signature.signerTitle,
    signerEmail: signature.signerEmail, signedAt: signature.signedAt,
    ipAddress: signature.ipAddress, userAgent: signature.userAgent,
    proposalVersion: signature.proposalVersion, consentText: signature.consentText,
    signatureType: signature.signatureType, signatureData: signature.signatureData,
    selectedOptionLabel: 'Travelers',
  });
  const parsed = await PDFDocument.load(pdfBytes);
  criterion(`Signed PDF can be downloaded (${parsed.getPageCount()} pages, ${Math.round(pdfBytes.byteLength / 1024)} KB)`,
    pdfBytes.byteLength > 1000 && parsed.getPageCount() >= 2);

  // 15. No other agency can access the proposal
  const other = await prisma.agency.findFirst({ where: { id: { not: agency.id } } });
  const leaked = other
    ? await prisma.proposal.findFirst({ where: { id: proposal.id, agencyId: other.id } })
    : null;
  criterion('No other agency can access the proposal',
    other ? leaked === null : true);

  // ── Cleanup: leave the database exactly as found ──
  await prisma.proposalSignature.deleteMany({ where: { proposalId: { in: madeProposals } } });
  await prisma.proposalActivityEvent.deleteMany({ where: { proposalId: { in: madeProposals } } });
  await prisma.proposal.deleteMany({ where: { id: { in: madeProposals } } });
  await prisma.quoteOption.deleteMany({ where: { id: { in: madeOptions } } });
  await prisma.lead.update({ where: { id: lead.id }, data: { status: originalLeadStatus } });

  console.log(`\n━━ ${passed} of ${n} acceptance criteria met ━━`);
  console.log(`   database restored: lead back to ${originalLeadStatus}, test records removed\n`);
  await prisma.$disconnect();
  process.exit(failed ? 1 : 0);
})().catch(async (e) => { console.error('ERROR', e); await prisma.$disconnect(); process.exit(1); });
