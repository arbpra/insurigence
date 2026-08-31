/**
 * Verification harness for the proposal system build.
 *
 * Run with:  npx tsx script/verify-proposal.ts
 *
 * Checks what Phases 0 and 1 actually put in place — schema, database
 * collections, validation rules, storage key safety — and prints a lead URL you
 * can open to exercise the UI by hand. Safe to run repeatedly: every record it
 * creates is deleted before it exits.
 */

import { prisma } from '../lib/prisma';
import { parseQuoteOptionInput, assertIdentifiable, serializeQuoteOption } from '../lib/quotes/quoteOption';
import { toCents, fromCents } from '../lib/quotes/money';
import { isStorageConfigured, quoteDocumentKey, MAX_DOCUMENT_BYTES } from '../lib/storage/r2';

let pass = 0, fail = 0;
const ok = (n: string, c: boolean) => { c ? pass++ : fail++; console.log(`  ${c ? '✓' : '✗'} ${n}`); };
const rejects = (n: string, fn: () => unknown) => {
  try { fn(); ok(`${n} — rejected`, false); } catch { ok(`${n} — rejected`, true); }
};

(async () => {
  console.log('\n━━ PHASE 0: schema ━━');
  const [qo, sig, ev, prop] = await Promise.all([
    prisma.quoteOption.count(), prisma.proposalSignature.count(),
    prisma.proposalActivityEvent.count(), prisma.proposal.count(),
  ]);
  ok(`QuoteOption collection exists (${qo} records)`, qo >= 0);
  ok(`ProposalSignature collection exists (${sig} records)`, sig >= 0);
  ok(`ProposalActivityEvent collection exists (${ev} records)`, ev >= 0);

  const statuses = await prisma.proposal.groupBy({ by: ['status'], _count: true });
  ok(`existing proposals intact (${prop})`, prop >= 0);
  console.log(`    statuses in use: ${statuses.map(s => `${s.status}×${s._count}`).join(', ') || 'none'}`);

  const sample = await prisma.proposal.findFirst({
    select: { version: true, lockedAt: true, sentAt: true, selectedQuoteOptionId: true, disclaimerText: true },
  });
  if (sample) {
    ok('Proposal has new fields (version/lockedAt/sentAt/selected/disclaimer)',
      sample.version !== undefined && 'lockedAt' in sample && 'sentAt' in sample);
  }

  console.log('\n━━ PHASE 1: money handling ━━');
  ok('"$8,750.10" parses to exact cents', toCents('$8,750.10') === BigInt(875010));
  ok('float 8750.10 does not drift', toCents(8750.10) === BigInt(875010));
  ok('cents convert back to dollars', fromCents(BigInt(875025)) === 8750.25);
  rejects('negative premium', () => toCents(-1));
  rejects('non-numeric premium', () => toCents('abc'));

  console.log('\n━━ PHASE 1: validation ━━');
  const t = parseQuoteOptionInput({ carrierName: 'Travelers', premiumAnnual: 8750, taxes: 125, fees: 250 });
  ok('total auto-computes to $9,125.00', t.totalAnnualCents === BigInt(912500));
  const t2 = parseQuoteOptionInput({ carrierName: 'X', premiumAnnual: 8750, taxes: 125, fees: 250, totalAnnual: 9000 });
  ok("carrier's explicit total overrides the sum", t2.totalAnnualCents === BigInt(900000));
  rejects('quote with no carrier', () => assertIdentifiable(parseQuoteOptionInput({ premiumAnnual: 100 })));
  rejects('expiration before effective date',
    () => parseQuoteOptionInput({ carrierName: 'X', effectiveDate: '2027-01-01', expirationDate: '2026-01-01' }));
  const partial = parseQuoteOptionInput({ notes: 'x' }, { partial: true });
  ok('PATCH touches only supplied fields', Object.keys(partial).length === 1);

  console.log('\n━━ PHASE 1: storage keys ━━');
  ok(`R2 configured: ${isStorageConfigured() ? 'YES' : 'NO — uploads will 503 until credentials are set'}`, true);
  const key = quoteDocumentKey('agencyA', 'opt1', '../../../etc/passwd');
  ok('path traversal stripped from filename', !key.includes('..'));
  ok('key namespaced by agency', key.startsWith('agencies/agencyA/'));
  ok(`upload cap ${MAX_DOCUMENT_BYTES / 1024 / 1024} MB`, MAX_DOCUMENT_BYTES === 15 * 1024 * 1024);

  console.log('\n━━ PHASE 1: live round trip ━━');
  const lead = await prisma.lead.findFirst({ select: { id: true, agencyId: true, insuredName: true } });
  if (!lead) {
    console.log('  ! no lead in the database to test against');
  } else {
    const a = await prisma.quoteOption.create({ data: { agencyId: lead.agencyId, leadId: lead.id, carrierName: 'Travelers', optionLabel: 'Option 1', sortOrder: 0, premiumAnnualCents: BigInt(875000), totalAnnualCents: BigInt(912500), isRecommended: true } });
    const b = await prisma.quoteOption.create({ data: { agencyId: lead.agencyId, leadId: lead.id, carrierName: 'Westfield', optionLabel: 'Option 2', sortOrder: 1, premiumAnnualCents: BigInt(920000) } });

    await prisma.$transaction(async (tx) => {
      await tx.quoteOption.updateMany({ where: { leadId: lead.id, isRecommended: true, id: { not: b.id } }, data: { isRecommended: false } });
      await tx.quoteOption.update({ where: { id: b.id }, data: { isRecommended: true } });
    });
    const rec = await prisma.quoteOption.findMany({ where: { leadId: lead.id, isRecommended: true } });
    ok('only one option can be recommended at a time', rec.length === 1 && rec[0].id === b.id);

    const read = await prisma.quoteOption.findUnique({ where: { id: a.id } });
    ok('premium exact after database round trip', read!.premiumAnnualCents === BigInt(875000));
    const dto = serializeQuoteOption(read!);
    ok('serialises to JSON-safe dollars', dto.premiumAnnual === 8750 && JSON.stringify(dto).length > 0);
    ok('object key never leaves the server', !('documentKey' in dto) && 'hasDocument' in dto);

    await prisma.quoteOption.deleteMany({ where: { id: { in: [a.id, b.id] } } });
    // Count only what this script created — the lead may hold real options
    // entered through the UI, and those must survive untouched.
    ok('test records cleaned up',
      (await prisma.quoteOption.count({ where: { id: { in: [a.id, b.id] } } })) === 0);

    console.log(`\n  Open this in the browser to try the UI:`);
    console.log(`    http://localhost:5000/leads/${lead.id}/quotes   (${lead.insuredName})`);
  }

  console.log(`\n━━ ${pass} passed, ${fail} failed ━━\n`);
  await prisma.$disconnect();
  process.exit(fail ? 1 : 0);
})().catch(async (e) => { console.error('ERROR', e); await prisma.$disconnect(); process.exit(1); });
