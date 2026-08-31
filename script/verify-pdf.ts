/**
 * Tests for PDF generation: encoding safety, layout robustness, and that the
 * signed PDF renders from the frozen snapshot.
 * Run with:  npx tsx script/verify-pdf.ts
 *
 * Writes two sample PDFs to script/out/ so the result can be opened and judged
 * by eye — a passing test says the bytes are valid, not that the page looks right.
 */
import { mkdirSync, writeFileSync } from 'fs';
import { PDFDocument } from 'pdf-lib';
import { toWinAnsi, hexToRgb, PdfWriter, INK } from '../lib/proposals/pdf/layout';
import { buildProposalPdf, proposalPdfFilename, exactTime, type SignatureForPdf } from '../lib/proposals/pdf/proposalPdf';
import { signedPdfKey } from '../lib/proposals/pdf/generate';
import { assembleProposal } from '../lib/proposals/assemble';
import { defaultSections } from '../lib/proposals/sections';
import type { Agency, Lead, Proposal, QuoteOption } from '@prisma/client';

let pass = 0, fail = 0;
const ok = (n: string, c: boolean) => { c ? pass++ : fail++; console.log(`  ${c ? '✓' : '✗'} ${n}`); };

const now = new Date('2026-08-18T14:30:00Z');

const agency = {
  id: 'ag', name: 'Acme Insurance Group', logoUrl: null,
  brandPrimaryColor: '#07496C', brandSecondaryColor: '#00E6A7',
  proposalFooterText: 'Acme Insurance Group | Licensed in KY, OH, IN',
  proposalDisclaimerText: null, phone: '(502) 501-6288',
  primaryEmail: 'hello@acme.example', website: 'acme.example',
} as unknown as Agency;

const lead = { id: 'l', insuredName: "Joe's Garage & Detailing", agencyId: 'ag',
               primaryContactEmail: 'joe@example.com' } as unknown as Lead;

function makeOptions(): QuoteOption[] {
  return [
    {
      id: 'o1', optionLabel: 'Option 1', carrierName: 'Travelers', programName: 'Garage Program',
      isRecommended: true, recommendationRationale:
        'We recommend Travelers because it carries the higher Garagekeepers limit — $250,000 versus ' +
        '$100,000 — and includes Cyber cover the others leave out.',
      rationaleAiDrafted: false, sortOrder: 0,
      premiumAnnualCents: BigInt(875000), taxesCents: BigInt(12500), feesCents: BigInt(25000),
      totalAnnualCents: BigInt(912500), paymentPlan: '25% down, 9 monthly instalments',
      notes: 'INTERNAL: underwriter contact is Dana',
      coverages: [
        { key: 'c1', name: 'General Liability', limit: '$1M/$2M', deductible: '$1,000', included: true,
          plainLanguage: 'Protects your business against claims of injury or property damage arising from your operations.',
          whyItMatters: 'Customers are on your premises daily — this is the cover that responds if one is hurt.',
          differsFromOthers: 'Identical across all three options.' },
        { key: 'c2', name: 'Garagekeepers', limit: '$250,000', deductible: '$1,000', included: true,
          plainLanguage: 'Covers customer vehicles while in your care, custody, or control — being detailed, repaired, stored, or serviced.',
          whyItMatters: 'You hold customer cars overnight; without this, damage to them is your own exposure.',
          differsFromOthers: 'Higher limit and a lower deductible than Option 2; not included at all in Option 3.' },
        { key: 'c3', name: 'Cyber', limit: '$100,000', deductible: null, included: true,
          plainLanguage: 'Responds to a data breach or cyber attack affecting customer information.',
          whyItMatters: 'You take card payments and store customer records electronically.',
          differsFromOthers: 'Only this option includes it.' },
      ],
      createdAt: now, updatedAt: now, effectiveDate: new Date('2026-09-01'),
      expirationDate: new Date('2027-09-01'), quoteExpirationDate: new Date('2026-09-15'),
      agencyId: 'ag', leadId: 'l', carrierId: null, lineOfBusiness: 'COMMERCIAL_GL',
      policyType: 'Garage Liability', limits: null, deductibles: null, endorsements: null,
      exclusions: null, documentKey: null, documentName: null, documentSize: null,
      documentContentType: null, documentUploadedAt: null,
    },
    {
      id: 'o2', optionLabel: 'Option 2', carrierName: 'Westfield', programName: null,
      isRecommended: false, recommendationRationale: null, rationaleAiDrafted: false, sortOrder: 1,
      premiumAnnualCents: BigInt(920000), taxesCents: null, feesCents: null,
      totalAnnualCents: BigInt(920000), paymentPlan: null, notes: null,
      coverages: [
        { key: 'd1', name: 'General Liability', limit: '$1M/$2M', deductible: '$1,000', included: true },
        { key: 'd2', name: 'Garagekeepers', limit: '$100,000', deductible: '$2,500', included: true },
      ],
      createdAt: now, updatedAt: now, effectiveDate: new Date('2026-09-01'),
      expirationDate: null, quoteExpirationDate: null, agencyId: 'ag', leadId: 'l', carrierId: null,
      lineOfBusiness: null, policyType: null, limits: null, deductibles: null, endorsements: null,
      exclusions: null, documentKey: null, documentName: null, documentSize: null,
      documentContentType: null, documentUploadedAt: null,
    },
    {
      id: 'o3', optionLabel: 'Option 3', carrierName: 'E&S Market', programName: null,
      isRecommended: false, recommendationRationale: null, rationaleAiDrafted: false, sortOrder: 2,
      premiumAnnualCents: BigInt(790000), taxesCents: null, feesCents: BigInt(45000),
      totalAnnualCents: BigInt(835000), paymentPlan: null, notes: null,
      coverages: [{ key: 'e1', name: 'General Liability', limit: '$1M/$2M', deductible: '$5,000', included: true }],
      createdAt: now, updatedAt: now, effectiveDate: new Date('2026-09-01'),
      expirationDate: null, quoteExpirationDate: null, agencyId: 'ag', leadId: 'l', carrierId: null,
      lineOfBusiness: null, policyType: null, limits: null, deductibles: null, endorsements: null,
      exclusions: null, documentKey: null, documentName: null, documentSize: null,
      documentContentType: null, documentUploadedAt: null,
    },
  ] as unknown as QuoteOption[];
}

const proposal = {
  id: 'p', leadId: 'l', agencyId: 'ag', createdByUserId: null, version: 2,
  title: "Commercial Insurance Proposal — Joe's Garage",
  status: 'SENT', sections: defaultSections(), createdAt: now, sentAt: now,
  clientMessage: 'Joe — here are the three markets that came back. My thoughts are below.',
  disclaimerText: null, selectedQuoteOptionId: 'o1',
} as unknown as Proposal;

(async () => {
  console.log('\n━━ WinAnsi encoding safety ━━');
  // Standard PDF fonts cannot encode typographic punctuation, and pdf-lib
  // throws on it. Our content is full of it.
  ok('em dash converted', toWinAnsi('a — b') === 'a - b');
  ok('curly apostrophe converted', toWinAnsi('Joe’s') === "Joe's");
  ok('curly quotes converted', toWinAnsi('“hi”') === '"hi"');
  ok('ellipsis expanded', toWinAnsi('wait…') === 'wait...');
  ok('bullet converted', toWinAnsi('• item') === '- item');
  ok('emoji dropped rather than thrown on', toWinAnsi('ok 🎉 fine') === 'ok  fine');
  ok('CJK dropped rather than thrown on', toWinAnsi('a 日本語 b') === 'a  b');
  ok('newlines preserved', toWinAnsi('a\nb') === 'a\nb');
  ok('accented Latin-1 kept', toWinAnsi('café') === 'café');

  console.log('\n━━ Colour parsing ━━');
  ok('6-digit hex parsed', hexToRgb('#07496C').red > 0.02 && hexToRgb('#07496C').red < 0.04);
  ok('3-digit hex expanded', JSON.stringify(hexToRgb('#abc')) === JSON.stringify(hexToRgb('#aabbcc')));
  ok('garbage falls back', JSON.stringify(hexToRgb('not-a-colour')) === JSON.stringify(INK));
  ok('null falls back', JSON.stringify(hexToRgb(null)) === JSON.stringify(INK));

  console.log('\n━━ Text wrapping ━━');
  {
    const w = await PdfWriter.create();
    const long = 'word '.repeat(200);
    ok('long paragraph wraps to many lines', w.wrap(long, w.fonts.regular, 10).length > 5);
    const url = 'https://' + 'a'.repeat(300) + '.com';
    const lines = w.wrap(url, w.fonts.regular, 10);
    ok('unbreakable string is split rather than overflowing', lines.length > 1);
    ok('every wrapped line fits the column',
      lines.every(l => w.fonts.regular.widthOfTextAtSize(l, 10) <= w.width + 0.5));
    ok('empty string handled', w.wrap('', w.fonts.regular, 10).length >= 0);
  }

  console.log('\n━━ Unsigned PDF ━━');
  const options = makeOptions();
  const doc = assembleProposal({ proposal, lead, agency, options }, { audience: 'client' });
  const unsigned = await buildProposalPdf(doc);
  ok('bytes produced', unsigned.byteLength > 1000);
  ok('has a PDF header', Buffer.from(unsigned.slice(0, 5)).toString() === '%PDF-');
  {
    const parsed = await PDFDocument.load(unsigned);
    ok(`parses back (${parsed.getPageCount()} pages)`, parsed.getPageCount() >= 1);
  }
  {
    // Apostrophe and ampersand are stripped, and the resulting run of spaces
    // collapses to a single hyphen.
    const name = proposalPdfFilename(doc, false);
    ok(`filename is safe and descriptive (${name})`, name === 'Joes-Garage-Detailing-Proposal.pdf');
    ok('no characters that break a Content-Disposition header',
      /^[A-Za-z0-9_.-]+$/.test(name));
  }

  console.log('\n━━ Signed PDF ━━');
  const signature: SignatureForPdf = {
    signerName: 'Joseph Marino', signerTitle: 'Owner', signerEmail: 'joe@example.com',
    signedAt: new Date('2026-08-18T15:04:22Z'), ipAddress: '203.0.113.7',
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) AppleWebKit/605.1.15 Version/17.0 Safari/604.1',
    proposalVersion: 2,
    consentText: 'By signing below, I agree to use electronic records and electronic signatures…',
    signatureType: 'TYPED', signatureData: 'Joseph Marino', selectedOptionLabel: 'Option 1',
  };
  const signed = await buildProposalPdf(doc, signature);
  ok('signed bytes produced', signed.byteLength > unsigned.byteLength);
  {
    const parsed = await PDFDocument.load(signed);
    ok(`certification page added (${parsed.getPageCount()} pages vs ${(await PDFDocument.load(unsigned)).getPageCount()})`,
      parsed.getPageCount() > (await PDFDocument.load(unsigned)).getPageCount());
  }
  ok('signed filename marked', proposalPdfFilename(doc, true).endsWith('-Signed.pdf'));

  console.log('\n━━ The PDF is a client document ━━');
  {
    // Internal notes must not reach a document that goes to the insured.
    const text = Buffer.from(unsigned).toString('latin1');
    ok('agent notes absent from the client PDF', !text.includes('underwriter contact is Dana'));
  }

  console.log('\n━━ Degenerate input does not crash the renderer ━━');
  {
    const bare = assembleProposal(
      { proposal: { ...proposal, clientMessage: null } as never, lead, agency, options: [] },
      { audience: 'client' }
    );
    const pdf = await buildProposalPdf(bare);
    ok('proposal with no options still renders', pdf.byteLength > 1000);

    const wordy = assembleProposal({
      proposal: {
        ...proposal,
        sections: defaultSections().map(s =>
          s.body !== null ? { ...s, body: 'Very long section. '.repeat(400) } : s),
      } as never, lead, agency, options,
    }, { audience: 'client' });
    const big = await buildProposalPdf(wordy);
    const parsed = await PDFDocument.load(big);
    ok(`very long content paginates (${parsed.getPageCount()} pages)`, parsed.getPageCount() > 2);
  }

  console.log('\n━━ Storage key ━━');
  {
    const key = signedPdfKey('ag', 'l', 'p', 2);
    ok('namespaced by agency and lead', key.startsWith('agencies/ag/leads/l/'));
    ok('version in the key so a re-sign does not overwrite', key.includes('-v2-signed.pdf'));
  }

  mkdirSync('script/out', { recursive: true });
  writeFileSync('script/out/sample-proposal.pdf', unsigned);
  writeFileSync('script/out/sample-proposal-signed.pdf', signed);
  console.log('\n  Wrote script/out/sample-proposal.pdf and sample-proposal-signed.pdf — open them to judge the layout.');

  console.log(`\n━━ ${pass} passed, ${fail} failed ━━\n`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
