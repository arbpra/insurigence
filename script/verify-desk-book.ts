/**
 * The Desk, Module 3: book-of-business models (InsuredAccount, Policy,
 * ImportBatch, ImportRow).
 *
 * Verifies duplicate-detection keys, that optional identifiers do not hit
 * MongoDB's "one missing value per unique index" trap, premium precision,
 * the renewal query, import-batch undo lookup, and delete behaviour.
 * Uses temporary agencies and a temporary user; removes them afterwards.
 * Run with:  npx tsx script/verify-desk-book.ts
 */
import 'dotenv/config';
import { prisma } from '../lib/prisma';
import { insuredNameKey } from '../lib/desk/insureds';

let pass = 0, fail = 0;
const ok = (n: string, c: boolean) => { c ? pass++ : fail++; console.log(`  ${c ? '✓' : '✗'} ${n}`); };
const rejects = async (fn: () => Promise<unknown>) => { try { await fn(); return false; } catch { return true; } };

const TAG = `m3test-${Date.now()}`;
const cleanup = { agencies: [] as string[], users: [] as string[] };
const DAY = 24 * 60 * 60 * 1000;

async function wipe() {
  const insureds = await prisma.insuredAccount.findMany({ where: { agencyId: { in: cleanup.agencies } }, select: { id: true } });
  await prisma.policy.deleteMany({ where: { agencyId: { in: cleanup.agencies } } });
  await prisma.insuredAccount.deleteMany({ where: { id: { in: insureds.map((i) => i.id) } } });
  await prisma.importRow.deleteMany({ where: { agencyId: { in: cleanup.agencies } } });
  await prisma.importBatch.deleteMany({ where: { agencyId: { in: cleanup.agencies } } });
  await prisma.agency.deleteMany({ where: { id: { in: cleanup.agencies } } });
  await prisma.user.deleteMany({ where: { id: { in: cleanup.users } } });
}

(async () => {
  console.log('\n━━ insuredNameKey ━━');
  const same = (a: string, b: string) => insuredNameKey(a) === insuredNameKey(b);
  ok('punctuation and entity suffix ignored: "ABC Plumbing, L.L.C." = "abc plumbing llc" = "ABC Plumbing"',
    same('ABC Plumbing, L.L.C.', 'abc plumbing llc') && same('ABC Plumbing, L.L.C.', 'ABC Plumbing'));
  ok('"&" equals "and"', same('Smith & Jones Inc', 'Smith and Jones'));
  ok('leading "The" ignored', same('The Corner Bakery', 'Corner Bakery, Inc.'));
  ok('stacked suffixes: "Smith & Co., Ltd." = "Smith"', same('Smith & Co., Ltd.', 'Smith'));
  ok('accents and spacing ignored', same('  Café   Rouge  ', 'cafe rouge'));
  ok('apostrophes joined: "O\'Brien Roofing" = "OBrien Roofing"', same("O'Brien Roofing", 'OBrien Roofing'));
  ok('different businesses stay different', !same('ABC Plumbing', 'ABC Plumbing Supply'));
  ok('suffix words inside a name are kept: "Co-Op Grocers" ≠ "Grocers"', !same('Co-Op Grocers', 'Grocers'));
  ok('never empty: "LLC" → "llc"', insuredNameKey('LLC') === 'llc' && insuredNameKey('The') === 'the');

  const agA = await prisma.agency.create({ data: { name: `${TAG} A` } }); cleanup.agencies.push(agA.id);
  const agB = await prisma.agency.create({ data: { name: `${TAG} B` } }); cleanup.agencies.push(agB.id);
  const uploader = await prisma.user.create({ data: { email: `${TAG}@example.test`, role: 'ADMIN', agencyId: agA.id } });
  cleanup.users.push(uploader.id);

  const mk = (agencyId: string, name: string, extra: Record<string, unknown> = {}) =>
    prisma.insuredAccount.create({ data: { agencyId, name, nameKey: insuredNameKey(name), ...extra } });

  console.log('\n━━ InsuredAccount ━━');
  const abc = await mk(agA.id, 'ABC Plumbing, LLC', { externalRef: 'CL-001', city: 'Austin', state: 'TX' });
  ok('defaults: ACTIVE, source MANUAL', abc.status === 'ACTIVE' && abc.source === 'MANUAL');
  ok('duplicate found by agency + nameKey for a differently-written name',
    (await prisma.insuredAccount.count({ where: { agencyId: agA.id, nameKey: insuredNameKey('abc plumbing') } })) === 1);
  ok('…but not across agencies',
    (await prisma.insuredAccount.count({ where: { agencyId: agB.id, nameKey: insuredNameKey('abc plumbing') } })) === 0);
  await mk(agA.id, 'No Ref One');
  await mk(agA.id, 'No Ref Two');
  ok('many insureds without externalRef / lead link are allowed (no unique-null trap)',
    (await prisma.insuredAccount.count({ where: { agencyId: agA.id } })) === 3);
  ok('same externalRef twice is allowed at DB level (dedupe is the importer\'s job)',
    !(await rejects(() => mk(agA.id, 'Other', { externalRef: 'CL-001' }))));
  ok('lookup by AMS client code', (await prisma.insuredAccount.count({ where: { agencyId: agA.id, externalRef: 'CL-001' } })) === 2);

  console.log('\n━━ Policy ━━');
  const now = Date.now();
  const big = BigInt('123456789012345'); // $1.23 trillion in cents — beyond float precision
  const p1 = await prisma.policy.create({ data: {
    agencyId: agA.id, insuredId: abc.id, policyNumber: 'GL-100', lineOfBusiness: 'General Liability',
    carrierName: 'Acme Mutual', effectiveDate: new Date(now - 300 * DAY), expirationDate: new Date(now + 65 * DAY),
    premiumCents: big,
  } });
  await prisma.policy.create({ data: { agencyId: agA.id, insuredId: abc.id, policyNumber: 'WC-7', lineOfBusiness: 'Workers Comp', expirationDate: new Date(now + 20 * DAY) } });
  await prisma.policy.create({ data: { agencyId: agA.id, insuredId: abc.id, policyNumber: 'AU-3', expirationDate: new Date(now + 200 * DAY) } });
  await prisma.policy.create({ data: { agencyId: agA.id, insuredId: abc.id, policyNumber: 'NO-DATE' } });
  const otherIns = await mk(agB.id, 'Other Agency Client');
  await prisma.policy.create({ data: { agencyId: agB.id, insuredId: otherIns.id, policyNumber: 'B-1', expirationDate: new Date(now + 10 * DAY) } });

  ok('premium in cents round-trips exactly as BigInt',
    (await prisma.policy.findUniqueOrThrow({ where: { id: p1.id } })).premiumCents === big);
  ok('default status ACTIVE', p1.status === 'ACTIVE');
  {
    const upcoming = await prisma.policy.findMany({
      where: { agencyId: agA.id, expirationDate: { gte: new Date(now), lte: new Date(now + 90 * DAY) } },
      orderBy: { expirationDate: 'asc' }, select: { policyNumber: true },
    });
    ok('renewal query: next 90 days, soonest first, own agency only, undated excluded',
      upcoming.map((p) => p.policyNumber).join(',') === 'WC-7,GL-100');
  }
  ok('insured → policies relation', (await prisma.insuredAccount.findUniqueOrThrow({ where: { id: abc.id }, include: { policies: true } })).policies.length === 4);

  console.log('\n━━ ImportBatch / ImportRow ━━');
  const batch = await prisma.importBatch.create({ data: {
    agencyId: agA.id, uploadedById: uploader.id, fileName: 'book.xlsx', fileSize: 20480,
    columnMapping: { 'Client Name': 'name', 'Exp Date': 'policy.expirationDate' },
  } });
  ok('batch defaults: STAGED, zero counts', batch.status === 'STAGED' && batch.rowCount === 0 && batch.insuredsCreated === 0);
  const rowData = { 'Client Name': 'Zed Café, Inc.', 'Exp Date': '2027-01-31', Premium: '$1,250.00', Empty: null };
  await prisma.importRow.createMany({ data: [
    { batchId: batch.id, agencyId: agA.id, rowNumber: 2, data: rowData },
    { batchId: batch.id, agencyId: agA.id, rowNumber: 3, data: {}, status: 'ERROR', errors: ['Name is required'] },
  ] });
  ok('row number unique within a batch',
    await rejects(() => prisma.importRow.create({ data: { batchId: batch.id, agencyId: agA.id, rowNumber: 2, data: {} } })));
  ok('raw row data round-trips exactly (accents, nulls)',
    JSON.stringify((await prisma.importRow.findFirstOrThrow({ where: { batchId: batch.id, rowNumber: 2 } })).data) === JSON.stringify(rowData));
  ok('error rows queryable with their messages',
    (await prisma.importRow.findFirstOrThrow({ where: { batchId: batch.id, status: 'ERROR' } })).errors[0] === 'Name is required');

  const imported = await mk(agA.id, 'Zed Café, Inc.', { source: 'IMPORT', importBatchId: batch.id });
  await prisma.policy.create({ data: { agencyId: agA.id, insuredId: imported.id, importBatchId: batch.id, policyNumber: 'IMP-1' } });
  ok('undo lookup: everything a batch created is findable by importBatchId',
    (await prisma.insuredAccount.count({ where: { importBatchId: batch.id } })) === 1 &&
    (await prisma.policy.count({ where: { importBatchId: batch.id } })) === 1);

  console.log('\n━━ Delete behaviour ━━');
  await prisma.insuredAccount.delete({ where: { id: abc.id } });
  ok('deleting an insured removes its policies', (await prisma.policy.count({ where: { insuredId: abc.id } })) === 0);
  await prisma.importBatch.delete({ where: { id: batch.id } });
  ok('deleting a batch removes its rows', (await prisma.importRow.count({ where: { batchId: batch.id } })) === 0);
  ok('…but keeps the insureds it created (undo is an explicit action, Module 17)',
    (await prisma.insuredAccount.count({ where: { id: imported.id } })) === 1);

  await wipe();
  ok('cleaned up',
    (await prisma.agency.count({ where: { name: { startsWith: TAG } } })) === 0 &&
    (await prisma.insuredAccount.count({ where: { agencyId: { in: cleanup.agencies } } })) === 0 &&
    (await prisma.policy.count({ where: { agencyId: { in: cleanup.agencies } } })) === 0 &&
    (await prisma.user.count({ where: { email: { startsWith: TAG } } })) === 0);

  console.log(`\n━━ ${pass} passed, ${fail} failed ━━\n`);
  await prisma.$disconnect();
  process.exit(fail ? 1 : 0);
})().catch(async (e) => {
  console.error('ERROR', e);
  await wipe().catch(() => {});
  await prisma.$disconnect();
  process.exit(1);
});
