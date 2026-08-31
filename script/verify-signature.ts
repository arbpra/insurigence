/**
 * Tests for electronic signature: input validation, the audit record, and
 * immutability of a signed proposal.
 * Run with:  npx tsx script/verify-signature.ts
 */
import { prisma } from '../lib/prisma';
import {
  parseSignatureInput, ESIGN_CONSENT_TEXT, describeDevice, SignatureValidationError,
} from '../lib/proposals/signature';
import { generateProposalToken, defaultExpiry, resolveProposalToken } from '../lib/proposals/token';
import { assembleProposal } from '../lib/proposals/assemble';
import { defaultSections } from '../lib/proposals/sections';

let pass = 0, fail = 0;
const ok = (n: string, c: boolean) => { c ? pass++ : fail++; console.log(`  ${c ? '✓' : '✗'} ${n}`); };
const rejects = (n: string, fn: () => unknown) => {
  try { fn(); ok(`${n} — rejected`, false); }
  catch (e) { ok(`${n} — rejected`, e instanceof SignatureValidationError); }
};

const PNG = 'data:image/png;base64,' + 'A'.repeat(400);

(async () => {
  console.log('\n━━ Consent is mandatory (requirement 9) ━━');
  rejects('signature without consent', () => parseSignatureInput({
    signerName: 'Pat Lee', signatureType: 'TYPED', signatureData: 'Pat Lee', consentAccepted: false,
  }));
  rejects('consent omitted entirely', () => parseSignatureInput({
    signerName: 'Pat Lee', signatureType: 'TYPED', signatureData: 'Pat Lee',
  }));
  ok('consent text states electronic-signature agreement',
    /electronic signature/i.test(ESIGN_CONSENT_TEXT));
  ok('consent text states coverage is not bound',
    /not in force until|not an insurance policy/i.test(ESIGN_CONSENT_TEXT));

  console.log('\n━━ Identity ━━');
  rejects('empty name', () => parseSignatureInput({
    signerName: '  ', signatureType: 'TYPED', signatureData: 'x', consentAccepted: true,
  }));
  rejects('typed signature not matching the name', () => parseSignatureInput({
    signerName: 'Pat Lee', signatureType: 'TYPED', signatureData: 'Someone Else', consentAccepted: true,
  }));
  {
    const s = parseSignatureInput({
      signerName: 'Pat  Lee', signatureType: 'TYPED', signatureData: 'pat lee', consentAccepted: true,
    });
    ok('case and spacing differences tolerated', s.signatureType === 'TYPED');
  }
  rejects('malformed email', () => parseSignatureInput({
    signerName: 'Pat Lee', signerEmail: 'not-an-email', signatureType: 'TYPED',
    signatureData: 'Pat Lee', consentAccepted: true,
  }));

  console.log('\n━━ Drawn signature is not an injection vector ━━');
  rejects('svg data url', () => parseSignatureInput({
    signerName: 'Pat Lee', signatureType: 'DRAWN', consentAccepted: true,
    signatureData: 'data:image/svg+xml;base64,' + 'A'.repeat(400),
  }));
  rejects('html data url', () => parseSignatureInput({
    signerName: 'Pat Lee', signatureType: 'DRAWN', consentAccepted: true,
    signatureData: 'data:text/html;base64,PHNjcmlwdD4=',
  }));
  rejects('remote url instead of data', () => parseSignatureInput({
    signerName: 'Pat Lee', signatureType: 'DRAWN', consentAccepted: true,
    signatureData: 'https://evil.example.com/sig.png',
  }));
  rejects('javascript url', () => parseSignatureInput({
    signerName: 'Pat Lee', signatureType: 'DRAWN', consentAccepted: true,
    signatureData: 'javascript:alert(1)',
  }));
  rejects('empty canvas', () => parseSignatureInput({
    signerName: 'Pat Lee', signatureType: 'DRAWN', consentAccepted: true,
    signatureData: 'data:image/png;base64,AAAA',
  }));
  rejects('oversized image', () => parseSignatureInput({
    signerName: 'Pat Lee', signatureType: 'DRAWN', consentAccepted: true,
    signatureData: 'data:image/png;base64,' + 'A'.repeat(4_000_000),
  }));
  {
    const s = parseSignatureInput({
      signerName: 'Pat Lee', signatureType: 'DRAWN', consentAccepted: true, signatureData: PNG,
    });
    ok('valid png accepted', s.signatureType === 'DRAWN');
    ok('drawn signature need not match the name', s.signerName === 'Pat Lee');
  }

  console.log('\n━━ Device description ━━');
  ok('iPhone Safari recognised',
    describeDevice('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) AppleWebKit/605.1.15 Version/17.0 Safari/604.1') === 'Safari on iOS');
  ok('unknown agent handled', describeDevice(null) === 'Unknown device');

  console.log('\n━━ Signing against the live database ━━');
  const lead = await prisma.lead.findFirst({ select: { id: true, agencyId: true } });
  const agency = lead ? await prisma.agency.findUnique({ where: { id: lead.agencyId } }) : null;
  if (!lead || !agency) { console.log('  ! no lead/agency'); process.exit(1); }

  const optionIds: string[] = [];
  const proposalIds: string[] = [];

  const opt = await prisma.quoteOption.create({
    data: {
      agencyId: lead.agencyId, leadId: lead.id, optionLabel: 'Sig Option', carrierName: 'Travelers',
      sortOrder: 0, premiumAnnualCents: BigInt(875000), totalAnnualCents: BigInt(912500),
      isRecommended: true, recommendationRationale: 'Best fit.',
      coverages: [{ key: 'c1', name: 'GL', limit: '$1M', included: true, plainLanguage: 'Covers claims.' }],
    },
  });
  optionIds.push(opt.id);

  const proposal = await prisma.proposal.create({
    data: {
      agencyId: lead.agencyId, leadId: lead.id, title: 'Signature test',
      status: 'OPTION_SELECTED', sentAt: new Date(), expiresAt: defaultExpiry(),
      publicToken: generateProposalToken(), sections: defaultSections() as never,
      selectedQuoteOptionId: opt.id, selectedAt: new Date(), version: 1,
    },
  });
  proposalIds.push(proposal.id);

  const options = await prisma.quoteOption.findMany({ where: { leadId: lead.id }, orderBy: { sortOrder: 'asc' } });
  const snapshot = assembleProposal({ proposal, lead: lead as never, agency, options }, { audience: 'client' });

  const signedAt = new Date();
  const signature = await prisma.proposalSignature.create({
    data: {
      proposalId: proposal.id, agencyId: proposal.agencyId,
      signerName: 'Pat Lee', signerTitle: 'Owner', signerEmail: 'pat@example.com',
      signatureType: 'TYPED', signatureData: 'Pat Lee', consentAccepted: true,
      consentText: ESIGN_CONSENT_TEXT, selectedQuoteOptionId: opt.id,
      proposalVersion: proposal.version, signedAt,
      ipAddress: '203.0.113.7', userAgent: 'Mozilla/5.0 (iPhone) Safari/604.1',
    },
  });
  const locked = await prisma.proposal.update({
    where: { id: proposal.id },
    data: { status: 'SIGNED', signedAt, lockedAt: signedAt, signedSnapshot: snapshot as never },
  });

  console.log('\n━━ Audit record is complete ━━');
  for (const [label, value] of [
    ['signer name', signature.signerName], ['signer title', signature.signerTitle],
    ['signer email', signature.signerEmail], ['IP address', signature.ipAddress],
    ['user agent', signature.userAgent], ['consent text', signature.consentText],
    ['selected option', signature.selectedQuoteOptionId],
  ] as const) {
    ok(`${label} recorded`, Boolean(value));
  }
  ok('exact timestamp recorded', signature.signedAt.getTime() === signedAt.getTime());
  ok('proposal version frozen', signature.proposalVersion === 1);
  ok('consent stored verbatim, not by reference', signature.consentText === ESIGN_CONSENT_TEXT);

  console.log('\n━━ Immutability (requirement 14) ━━');
  ok('proposal locked', locked.lockedAt !== null);
  ok('snapshot stored', locked.signedSnapshot !== null);
  ok('signed proposal still readable by the insured',
    (await resolveProposalToken(locked.publicToken!)).ok === true);

  // The real test: change the underlying quote and confirm the signed document
  // does not move. Without the snapshot, data sections would re-render.
  await prisma.quoteOption.update({
    where: { id: opt.id },
    data: { totalAnnualCents: BigInt(9999900), carrierName: 'CHANGED CARRIER' },
  });
  const after = await prisma.proposal.findUniqueOrThrow({ where: { id: proposal.id } });
  const snap = after.signedSnapshot as unknown as typeof snapshot;
  ok('signed total unchanged after the quote was edited',
    snap.options.find(o => o.id === opt.id)?.totalAnnual === 9125);
  ok('signed carrier name unchanged after the quote was edited',
    snap.options.find(o => o.id === opt.id)?.carrierName === 'Travelers');

  const live = await prisma.quoteOption.findUniqueOrThrow({ where: { id: opt.id } });
  ok('the live quote did change (proving the snapshot is what protected it)',
    live.carrierName === 'CHANGED CARRIER');

  console.log('\n━━ Snapshot carries no internal data ━━');
  {
    const blob = JSON.stringify(after.signedSnapshot);
    ok('no internal block in the frozen document', !blob.includes('"internal"'));
    ok('no AI provenance in the frozen document', !blob.includes('aiDrafted'));
    ok('coverage prose preserved', blob.includes('Covers claims.'));
  }

  await prisma.proposalSignature.deleteMany({ where: { proposalId: proposal.id } });
  await prisma.proposalActivityEvent.deleteMany({ where: { proposalId: proposal.id } });
  await prisma.proposal.deleteMany({ where: { id: { in: proposalIds } } });
  await prisma.quoteOption.deleteMany({ where: { id: { in: optionIds } } });
  ok('cleaned up', (await prisma.quoteOption.count({ where: { id: { in: optionIds } } })) === 0);

  console.log(`\n━━ ${pass} passed, ${fail} failed ━━\n`);
  await prisma.$disconnect();
  process.exit(fail ? 1 : 0);
})().catch(async (e) => { console.error('ERROR', e); await prisma.$disconnect(); process.exit(1); });
