/**
 * Modules 26 and 27: checking and grouping an import's rows, the preview, the
 * commit, undo and the template. Temporary agencies and users only, removed
 * afterwards. Real accounts are counted before and after.
 *
 *   npx tsx script/verify-desk-import-commit.ts
 */
import 'dotenv/config';
import { readFileSync } from 'fs';
import { NextRequest } from 'next/server';
import { Prisma, type PrismaClient, type UserRole } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { DeskAccessError, resolveDeskScope } from '../lib/desk/access';
import { createSession } from '../lib/auth';
import { getInsuredOverview, listInsureds, updateInsured, updatePolicy, addPolicy } from '../lib/desk/book';
import { guessField, importStatusLabel } from '../lib/desk/import-fields';
import {
  buildImportPlan, importTemplateCsv, isOnExisting, parseImportDate, parseImportPremium, parseImportStatus, producerMatcher, type ExistingAccount, type ExistingPolicy, type PlanInput,
} from '../lib/desk/import-plan';
import { commitImport, getImportPreview, undoImport } from '../lib/desk/import-commit';
import { discardImport, getImport, getImportMapping, listImports, saveImportMapping, setImportHeaderRow, stageImport, undoAvailable } from '../lib/desk/imports';
import { GET as previewRoute } from '../app/api/desk/imports/[id]/preview/route';
import { POST as commitRoute } from '../app/api/desk/imports/[id]/commit/route';
import { POST as undoRoute } from '../app/api/desk/imports/[id]/undo/route';
import { GET as templateRoute } from '../app/api/desk/imports/template/route';

let pass = 0, fail = 0;
const ok = (n: string, c: boolean) => {
  c ? pass++ : fail++;
  console.log(`  ${c ? '✓' : '✗'} ${n}`);
  // For the deliberate-fault runs: one failed check is the answer, and cleanup still runs.
  if (!c && process.env.FAIL_FAST && inDatabaseChecks) throw new Error(`stopping at: ${n}`);
};
let inDatabaseChecks = false;

const TAG = `m26test${Date.now()}`;
const cleanup = { agencyIds: [] as string[], userIds: [] as string[] };
const read = (p: string) => readFileSync(p, 'utf8');
const TODAY = '2026-11-07';

type Mapping = PlanInput['mapping'];
const HEADERS = ['Client', 'DBA', 'Code', 'Email', 'Address', 'Producer', 'Policy', 'Line', 'Carrier', 'Eff', 'Exp', 'Premium', 'Status', 'PNotes', 'PRef'];
const MAPPING: Mapping = {
  name: 'Client', dba: 'DBA', externalRef: 'Code', contactEmail: 'Email', addressLine1: 'Address', producer: 'Producer', policyNumber: 'Policy', lineOfBusiness: 'Line', carrierName: 'Carrier',
  effectiveDate: 'Eff', expirationDate: 'Exp', premium: 'Premium', policyStatus: 'Status', policyNotes: 'PNotes', policyRef: 'PRef',
};
type RowInput = Partial<Record<'name' | 'dba' | 'code' | 'email' | 'address' | 'producer' | 'policy' | 'line' | 'carrier' | 'eff' | 'exp' | 'premium' | 'status' | 'notes' | 'ref', string>>;
const toCells = (r: RowInput) => [r.name, r.dba, r.code, r.email, r.address, r.producer, r.policy, r.line, r.carrier, r.eff, r.exp, r.premium, r.status, r.notes, r.ref].map((v) => v ?? '');
const JANE = { id: 'u-jane', firstName: 'Jane', lastName: 'Smith', email: 'jane@agency.test' };
const plan = (rows: RowInput[], over: Partial<PlanInput> = {}) => buildImportPlan({
  rows: rows.map((r, i) => ({ rowNumber: i + 2, cells: toCells(r) })), headers: HEADERS, mapping: MAPPING, existingAccounts: [], existingPolicies: [], users: [JANE], onExisting: 'ADD', today: TODAY, ...over,
});
const problem = (p: ReturnType<typeof plan>, rowNumber: number) => p.problems.find((x) => x.rowNumber === rowNumber);
const existingAccount = (over: Partial<ExistingAccount> = {}): ExistingAccount => ({ id: 'x1', name: 'Acme LLC', nameKey: 'acme', externalRef: null, status: 'ACTIVE', ...over });
const existingPolicy = (over: Partial<ExistingPolicy> = {}): ExistingPolicy => ({ insuredId: 'x1', policyNumber: null, lineOfBusiness: null, carrierName: null, effectiveDate: null, expirationDate: null, ...over });

function pureLogic() {
  console.log('Reading dates');
  const dates: [string, string | null][] = [
    ['2027-03-05', '2027-03-05'], ['2027/3/5', '2027-03-05'], ['3/5/2027', '2027-03-05'], ['03-05-2027', '2027-03-05'], ['3.5.2027', '2027-03-05'], ['3/5/27', '2027-03-05'], ['12/31/99', '1999-12-31'],
    ['Mar 5, 2027', '2027-03-05'], ['March 5 2027', '2027-03-05'], ['Sept 5, 2027', '2027-09-05'], ['5-Mar-2027', '2027-03-05'], ['05 Mar 27', '2027-03-05'],
    ['3/5/2027 12:00:00 AM', '2027-03-05'], ['2027-03-05T00:00:00', '2027-03-05'], ['2027-03-05 00:00', '2027-03-05'], ['2028-02-29', '2028-02-29'],
    ['', null], ['  ', null], ['-', null], ['N/A', null], ['none', null],
  ];
  for (const [text, date] of dates) { const r = parseImportDate(text); ok(`"${text}" → ${date}`, 'date' in r && r.date === date); }
  for (const text of ['25/01/2027', '2/30/2027', '2027-02-29', '13/1/2027', 'soon', '46388', '1/1/9999', '0001-01-01', 'Foo 5, 2027', '2027-3']) ok(`"${text}" is refused`, 'error' in parseImportDate(text));
  ok('the error quotes the cell', (parseImportDate('soon') as { error: string }).error.includes('"soon"'));

  console.log('Reading premiums');
  const amounts: [string, number | null][] = [['1250', 125000], ['1,250.50', 125050], ['$1,250.5', 125050], ['$ 99.99', 9999], ['USD 100', 10000], ['100 USD', 10000], ['0', 0], ['1234.567', 123457], ['1234.564', 123456], ['1234.995', 123500], ['', null], ['n/a', null], ['-', null]];
  for (const [text, cents] of amounts) { const r = parseImportPremium(text); ok(`"${text}" → ${cents}`, 'cents' in r && r.cents === cents); }
  for (const text of ['abc', '-100', '(100.00)', '1,25', '12345678901', '$1,000,000,001', '9'.repeat(400)]) ok(`"${text}" is refused`, 'error' in parseImportPremium(text));

  console.log('Reading statuses');
  const statuses: [string, string | null][] = [['Active', 'ACTIVE'], ['IN FORCE', 'ACTIVE'], ['In-Force', 'ACTIVE'], ['Bound', 'ACTIVE'], ['Pending', 'PENDING'], ['Quoted', 'PENDING'], ['Lapsed', 'EXPIRED'], ['Non-Renewed', 'EXPIRED'], ['Canceled', 'CANCELLED'], ['Cancelled', 'CANCELLED'], ['Flat Cancel', 'CANCELLED'], ['', null], ['-', null]];
  for (const [text, status] of statuses) { const r = parseImportStatus(text); ok(`"${text}" → ${status}`, 'status' in r && r.status === status); }
  for (const text of ['Maybe', 'constructor', '__proto__', 'toString']) ok(`"${text}" is refused`, 'error' in parseImportStatus(text));

  console.log('Matching producers');
  const people = [JANE, { id: 'u-a', firstName: 'Al', lastName: 'Twin', email: 'a@agency.test' }, { id: 'u-b', firstName: 'Al', lastName: 'Twin', email: 'b@agency.test' }, { id: 'u-n', firstName: null, lastName: null, email: 'noname@agency.test' }];
  const matcher = producerMatcher(people);
  ok('by name', JSON.stringify(matcher('Jane Smith')) === '{"userId":"u-jane"}');
  ok('case and spacing don\'t matter', JSON.stringify(matcher('  JANE   smith ')) === '{"userId":"u-jane"}');
  ok('last name first', JSON.stringify(matcher('Smith, Jane')) === '{"userId":"u-jane"}');
  ok('by email', JSON.stringify(matcher('JANE@agency.test')) === '{"userId":"u-jane"}');
  ok('email of someone with no name', JSON.stringify(matcher('noname@agency.test')) === '{"userId":"u-n"}');
  ok('nobody by that name', JSON.stringify(matcher('Bob Jones')) === '{"unmatched":"NOBODY"}');
  ok('first name alone isn\'t enough', JSON.stringify(matcher('Jane')) === '{"unmatched":"NOBODY"}');
  ok('two people, one name: neither', JSON.stringify(matcher('Al Twin')) === '{"unmatched":"SEVERAL"}');
  ok('a blank name matches no-name people? no', JSON.stringify(matcher('   ')) === '{"unmatched":"NOBODY"}');
  ok('an email can\'t pick one of the two wrongly', JSON.stringify(matcher('b@agency.test')) === '{"userId":"u-b"}');

  console.log('Grouping');
  const two = plan([
    { name: 'Acme LLC', address: '1 Main', policy: 'P1', line: 'GL', exp: '2027-06-01' },
    { name: 'ACME, L.L.C.', policy: 'P2', line: 'Auto', exp: '2027-07-01' },
    { name: 'Beta Inc' },
  ]);
  ok('several policies on one account', two.accounts.length === 2 && two.accounts[0].policies.length === 2);
  ok('names are matched loosely', two.counts.accountsNew === 2 && two.counts.policiesNew === 2);
  ok('the first spelling is used', two.accounts[0].name === 'Acme LLC');
  ok('an insured-only row is an account with no policies', two.accounts[1].name === 'Beta Inc' && two.accounts[1].policies.length === 0);
  ok('every row is ready', two.counts.ready === 3 && two.counts.errors === 0 && two.problems.length === 0);
  const coded = plan([{ name: 'Acme', code: 'C1', policy: 'P1' }, { name: 'Acme Renamed', code: 'c1', policy: 'P2' }, { name: 'Acme', code: 'C2', policy: 'P3' }]);
  ok('a client code decides what\'s one account', coded.accounts.length === 2 && coded.accounts[0].policies.length === 2);
  ok('a different name under one code says so', problem(coded, 3)?.kind === 'WARNING' && problem(coded, 3)!.messages.join().includes('same client code'));
  const joining = plan([{ name: 'Acme', code: 'C1', policy: 'P1' }, { name: 'Acme', policy: 'P2' }]);
  ok('a row with no code joins its name\'s only code', joining.accounts.length === 1 && joining.accounts[0].policies.length === 2);
  const unsure = plan([{ name: 'Acme', code: 'C1', policy: 'P1' }, { name: 'Acme', code: 'C2', policy: 'P2' }, { name: 'Acme', policy: 'P3' }]);
  ok('with two codes it isn\'t guessed', unsure.accounts.length === 3 && problem(unsure, 4)!.messages.join().includes('more than one client code'));
  const blanks = plan([{ name: 'Acme' }, {}, { name: 'Beta' }]);
  ok('a blank row isn\'t a problem', blanks.counts.blank === 1 && blanks.counts.errors === 0 && blanks.counts.ready === 2);
  const unmappedOnly = buildImportPlan({ rows: [{ rowNumber: 2, cells: ['', 'unmapped text'] }], headers: ['Client', 'Other'], mapping: { name: 'Client' }, existingAccounts: [], existingPolicies: [], users: [], onExisting: 'ADD', today: TODAY });
  ok('nor one with only unmapped columns', unmappedOnly.counts.blank === 1);
  const fieldsMerge = plan([{ name: 'Acme', policy: 'P1' }, { name: 'Acme', dba: 'Ace', address: '1 Main', policy: 'P2' }, { name: 'Acme', address: '2 Other', policy: 'P3' }]);
  ok('a value from a later row fills a gap', fieldsMerge.accounts[0].fields.dba === 'Ace');
  ok('the first value wins', fieldsMerge.accounts[0].fields.addressLine1 === '1 Main');
  ok('a row that disagrees says so', problem(fieldsMerge, 4)!.messages.join().includes('Address'));
  ok('agreeing rows say nothing', !problem(plan([{ name: 'A', address: 'X', policy: '1' }, { name: 'A', address: 'x', policy: '2' }]), 3));
  const short = buildImportPlan({ rows: [{ rowNumber: 2, cells: ['Acme'] }], headers: HEADERS, mapping: MAPPING, existingAccounts: [], existingPolicies: [], users: [], onExisting: 'ADD', today: TODAY });
  ok('a row shorter than the header is fine', short.counts.ready === 1 && short.accounts[0].policies.length === 0);

  console.log('Row errors');
  const noName = plan([{ policy: 'P1' }, { name: 'Acme' }]);
  ok('no named insured', problem(noName, 2)?.kind === 'ERROR' && problem(noName, 2)!.messages.join().includes('no named insured'));
  ok('and the rest still go', noName.accounts.length === 1 && noName.counts.errors === 1 && noName.counts.ready === 1);
  const badRows = plan([
    { name: 'A', policy: 'P', exp: 'soon' }, { name: 'B', policy: 'P', eff: 'soon' }, { name: 'C', policy: 'P', premium: 'lots' }, { name: 'D', policy: 'P', status: 'Maybe' },
    { name: 'E', policy: 'P', eff: '2027-01-01', exp: '2027-01-01' }, { name: 'F', exp: '2027-01-01' }, { name: 'G', premium: '100' }, { name: 'H', notes: 'x' }, { name: 'I', ref: 'x' },
  ]);
  ok('a bad expiration date leaves the row out', problem(badRows, 2)?.kind === 'ERROR' && problem(badRows, 2)!.messages[0].startsWith('Expiration date'));
  ok('a bad effective date', problem(badRows, 3)?.kind === 'ERROR' && problem(badRows, 3)!.messages[0].startsWith('Effective date'));
  ok('a bad premium', problem(badRows, 4)?.kind === 'ERROR' && problem(badRows, 4)!.messages[0].startsWith('Premium'));
  ok('an unknown status', problem(badRows, 5)?.kind === 'ERROR' && problem(badRows, 5)!.messages[0].startsWith('Policy status'));
  ok('expiring on or before it starts', problem(badRows, 6)!.messages[0].includes('after the effective date'));
  ok('policy details with no number, line or carrier', [7, 8, 9, 10].every((n) => problem(badRows, n)?.kind === 'ERROR' && problem(badRows, n)!.messages[0].includes('no policy number')));
  ok('nothing from those rows goes in', badRows.accounts.length === 0 && badRows.counts.errors === 9);
  const several = plan([{ name: 'A', policy: 'P', exp: 'x', eff: 'y', premium: 'z' }]);
  ok('every reason is given', problem(several, 2)!.messages.length === 3);
  const lengths = plan([{ name: 'n'.repeat(201) }, { name: 'A', address: 'a'.repeat(201) }, { name: 'B', policy: 'p'.repeat(101) }, { name: 'C', line: 'l'.repeat(101) }, { name: 'D', policy: 'P', carrier: 'c'.repeat(201) }, { name: 'E', policy: 'P', notes: 'n'.repeat(2001) }, { name: 'F', policy: 'P', ref: 'r'.repeat(101) }]);
  ok('anything too long says so', lengths.counts.errors === 7 && lengths.accounts.length === 0);
  ok('exactly the limit is fine', plan([{ name: 'n'.repeat(200), address: 'a'.repeat(200), policy: 'p'.repeat(100) }]).counts.errors === 0);
  for (const total of ['Total', 'TOTALS', 'Grand Total', 'Subtotal', 'Sub Total:', 'Report Total']) ok(`"${total}" isn't a client`, problem(plan([{ name: total, premium: '' }]), 2)?.kind === 'ERROR');
  ok('"Total Plumbing LLC" is', plan([{ name: 'Total Plumbing LLC' }]).counts.errors === 0);
  ok('a client called Total with a policy is too', plan([{ name: 'Total', policy: 'P1' }]).counts.errors === 0);

  console.log('Row warnings');
  const email = plan([{ name: 'A', email: 'not an email' }, { name: 'B', email: 'SAM@Example.COM' }]);
  ok('a bad email is left blank, and the row goes in', problem(email, 2)?.kind === 'WARNING' && email.accounts[0].fields.contactEmail === undefined && email.accounts.length === 2);
  ok('a good one is stored in lower case', email.accounts[1].fields.contactEmail === 'sam@example.com');
  ok('a very long bad email is shortened in the message', problem(plan([{ name: 'A', email: 'x'.repeat(500) }]), 2)!.messages[0].length < 200);
  const lapsed = plan([{ name: 'A', policy: '1', exp: '2026-01-01' }, { name: 'B', policy: '2', exp: '2026-01-01', status: 'Active' }, { name: 'C', policy: '3', exp: '2026-01-01', status: 'Cancelled' }, { name: 'D', policy: '4', exp: '2027-01-01' }, { name: 'E', policy: '5', exp: TODAY }]);
  ok('no status and past its date: expired', lapsed.accounts[0].policies[0].status === 'EXPIRED' && problem(lapsed, 2)!.messages[0].includes('Expired'));
  ok('stated active and past its date: says so, stays active', lapsed.accounts[1].policies[0].status === 'ACTIVE' && problem(lapsed, 3)!.messages[0].includes('marked active'));
  ok('a stated status is kept without a word', lapsed.accounts[2].policies[0].status === 'CANCELLED' && !problem(lapsed, 4));
  ok('no status and still running: active', lapsed.accounts[3].policies[0].status === 'ACTIVE' && !problem(lapsed, 5));
  ok('expiring today isn\'t past', lapsed.accounts[4].policies[0].status === 'ACTIVE' && !problem(lapsed, 6));
  ok('a status alone doesn\'t make a policy', plan([{ name: 'A', status: 'Maybe' }]).counts.errors === 0 && plan([{ name: 'A', status: 'Active' }]).accounts[0].policies.length === 0);
  ok('counted', lapsed.counts.warnings === 2);
  ok('policies with no expiration are counted', plan([{ name: 'A', policy: '1' }, { name: 'B', policy: '2', exp: '2027-01-01' }]).counts.policiesNoExpiration === 1);

  console.log('Producers on accounts');
  const assigned = plan([{ name: 'A', producer: 'Jane Smith' }, { name: 'B', producer: 'Bob Jones' }, { name: 'C', producer: 'Bob Jones' }, { name: 'D' }]);
  ok('matched', assigned.accounts[0].userIds.join() === 'u-jane' && assigned.counts.assignments === 1);
  ok('not matched: the row goes in unassigned', assigned.accounts[1].userIds.length === 0 && problem(assigned, 3)?.kind === 'WARNING');
  ok('not matched names are listed with their rows', JSON.stringify(assigned.unmatchedProducers) === '[{"name":"Bob Jones","rows":2}]');
  ok('unassigned accounts are counted', assigned.counts.accountsUnassigned === 3);
  ok('not counted when no producer column was chosen', buildImportPlan({ rows: [{ rowNumber: 2, cells: ['A'] }], headers: ['Client'], mapping: { name: 'Client' }, existingAccounts: [], existingPolicies: [], users: [], onExisting: 'ADD', today: TODAY }).counts.accountsUnassigned === 0);
  const sameProducer = plan([{ name: 'A', policy: '1', producer: 'Jane Smith' }, { name: 'A', policy: '2', producer: 'jane@agency.test' }]);
  ok('one person once per account', sameProducer.accounts[0].userIds.length === 1);
  const twoProducers = plan([{ name: 'A', policy: '1', producer: 'Jane Smith' }, { name: 'A', policy: '2', producer: 'Sam Lee' }], { users: [JANE, { id: 'u-sam', firstName: 'Sam', lastName: 'Lee', email: 's@a.test' }] });
  ok('an account can have several', twoProducers.accounts[0].userIds.length === 2 && twoProducers.counts.assignments === 2);

  console.log('Duplicates within the file');
  const terms = plan([{ name: 'A', policy: 'P1', exp: '2026-12-01', premium: '100' }, { name: 'A', policy: 'p1', exp: '2027-12-01', premium: '200' }, { name: 'A', policy: 'P1', exp: '2025-12-01' }]);
  ok('the latest term of a policy is kept', terms.accounts[0].policies.length === 1 && terms.accounts[0].policies[0].premiumCents === 20000);
  ok('the others say why', problem(terms, 2)?.kind === 'DUPLICATE' && problem(terms, 4)?.kind === 'DUPLICATE' && problem(terms, 2)!.messages[0].includes('row 3'));
  ok('a tie keeps the first', plan([{ name: 'A', policy: 'P', premium: '1' }, { name: 'A', policy: 'P', premium: '2' }]).accounts[0].policies[0].premiumCents === 100);
  ok('a dated term beats an undated one', plan([{ name: 'A', policy: 'P' }, { name: 'A', policy: 'P', exp: '2027-01-01' }]).accounts[0].policies[0].expirationDate === '2027-01-01');
  const unnumbered = plan([{ name: 'A', line: 'GL', carrier: 'X', exp: '2027-01-01' }, { name: 'A', line: 'gl', carrier: 'x', exp: '2027-01-01' }, { name: 'A', line: 'GL', carrier: 'X', exp: '2028-01-01' }]);
  ok('with no number, the same line, carrier and dates are one', unnumbered.accounts[0].policies.length === 2 && problem(unnumbered, 3)?.kind === 'DUPLICATE');
  ok('one number on two accounts is allowed, and said', problem(plan([{ name: 'A', policy: 'P' }, { name: 'B', policy: 'P' }]), 3)?.messages.join().includes('also under'));
  ok('counts add up', terms.counts.rows === terms.counts.ready + terms.counts.duplicates + terms.counts.errors + terms.counts.blank);

  console.log('Duplicates in the book');
  const inBook = plan([{ name: 'ACME, LLC', address: 'New address', producer: 'Jane Smith', policy: 'P1' }], { existingAccounts: [existingAccount()] });
  ok('matched by name', inBook.accounts[0].existingId === 'x1' && inBook.counts.accountsNew === 0 && inBook.counts.accountsExisting === 1);
  ok('its details aren\'t changed', Object.keys(inBook.accounts[0].fields).length === 0 && inBook.accounts[0].name === 'Acme LLC');
  ok('nor its people', inBook.accounts[0].userIds.length === 0 && inBook.counts.assignments === 0);
  ok('the policy goes on it', inBook.counts.policiesNew === 1);
  ok('a different spelling says what it matched', problem(inBook, 2)!.messages.join().includes('"Acme LLC"'));
  const skip = plan([{ name: 'Acme', policy: 'P1' }, { name: 'New Co', policy: 'P2' }], { existingAccounts: [existingAccount()], onExisting: 'SKIP' });
  ok('leaving them out', skip.accounts.length === 1 && skip.accounts[0].name === 'New Co' && problem(skip, 2)?.kind === 'DUPLICATE' && skip.counts.accountsExisting === 1);
  const hasIt = plan([{ name: 'Acme', policy: 'p1' }, { name: 'Acme', policy: 'P2' }], { existingAccounts: [existingAccount()], existingPolicies: [existingPolicy({ policyNumber: 'P1' })] });
  ok('a policy it already has isn\'t added', hasIt.counts.policiesNew === 1 && problem(hasIt, 2)?.kind === 'DUPLICATE' && hasIt.accounts[0].policies[0].policyNumber === 'P2');
  const hasUnnumbered = plan([{ name: 'Acme', line: 'GL', exp: '2027-01-01' }], { existingAccounts: [existingAccount()], existingPolicies: [existingPolicy({ lineOfBusiness: 'gl', expirationDate: '2027-01-01' })] });
  ok('nor one with no number that matches', hasUnnumbered.counts.policiesNew === 0 && hasUnnumbered.accounts.length === 0);
  const again = plan([{ name: 'Acme' }], { existingAccounts: [existingAccount()] });
  ok('an account row with nothing to add', again.accounts.length === 0 && problem(again, 2)?.kind === 'DUPLICATE' && again.counts.ready === 0);
  const byCode = plan([{ name: 'Renamed', code: 'C1', policy: 'P' }], { existingAccounts: [existingAccount({ externalRef: 'c1' })] });
  ok('a client code matches whatever the name', byCode.accounts[0].existingId === 'x1');
  const otherCode = plan([{ name: 'Acme', code: 'C2' }], { existingAccounts: [existingAccount({ externalRef: 'C1' })] });
  ok('the same name with another code is a new account, and said', otherCode.accounts[0].existingId === null && problem(otherCode, 2)!.messages.join().includes('different client code'));
  ok('a code matches a same-named account with none', plan([{ name: 'Acme', code: 'C1', policy: 'P' }], { existingAccounts: [existingAccount()] }).accounts[0].existingId === 'x1');
  ok('a row with no code matches by name whatever the book\'s code', plan([{ name: 'Acme', policy: 'P' }], { existingAccounts: [existingAccount({ externalRef: 'C1' })] }).accounts[0].existingId === 'x1');
  const twoBook = plan([{ name: 'Acme', policy: 'P' }], { existingAccounts: [existingAccount(), existingAccount({ id: 'x2' })] });
  ok('two possible accounts: left out, not guessed', twoBook.accounts.length === 0 && problem(twoBook, 2)?.kind === 'DUPLICATE' && problem(twoBook, 2)!.messages[0].includes('More than one'));
  const twoCodes = plan([{ name: 'Z', code: 'C1', policy: 'P' }], { existingAccounts: [existingAccount({ externalRef: 'C1' }), existingAccount({ id: 'x2', externalRef: 'C1' })] });
  ok('two with one code too', twoCodes.accounts.length === 0 && problem(twoCodes, 2)?.kind === 'DUPLICATE');
  const inactivePair = plan([{ name: 'Acme', policy: 'P' }], { existingAccounts: [existingAccount({ status: 'INACTIVE' }), existingAccount({ id: 'x2' })] });
  ok('an active one is preferred to an inactive one', inactivePair.accounts[0].existingId === 'x2');
  const inactive = plan([{ name: 'Acme', policy: 'P' }], { existingAccounts: [existingAccount({ status: 'INACTIVE' })] });
  ok('an inactive one is matched, and said', inactive.accounts[0].existingId === 'x1' && problem(inactive, 2)!.messages.join().includes('inactive'));
  const elsewhere = plan([{ name: 'New', policy: 'P9' }], { existingAccounts: [existingAccount()], existingPolicies: [existingPolicy({ policyNumber: 'P9' })] });
  ok('a number on another account in the book is said', problem(elsewhere, 2)!.messages.join().includes('"Acme LLC"') && elsewhere.counts.policiesNew === 1);

  console.log('Odd text');
  const odd = plan([{ name: '__proto__' }, { name: 'constructor', code: '__proto__' }, { name: '$where', policy: '$ne', line: '{"$gt":""}' }]);
  ok('it\'s only text', odd.accounts.length === 3 && odd.counts.errors === 0 && odd.accounts[2].policies[0].policyNumber === '$ne' && !('polluted' in {}));
  ok('choosing what to do', isOnExisting('ADD') && isOnExisting('SKIP') && !isOnExisting('add') && !isOnExisting(null));

  console.log('The template');
  const template = importTemplateCsv(new Date(Date.UTC(2026, 10, 7)));
  const header = template.split('\r\n')[0].split(',');
  ok('every column maps itself', header.every((h) => guessField(h) !== null));
  ok('and to different fields', new Set(header.map(guessField)).size === header.length);
  ok('Q2\'s fields are all there', ['name', 'dba', 'contactName', 'addressLine1', 'producer', 'policyNumber', 'carrierName', 'lineOfBusiness', 'effectiveDate', 'expirationDate', 'premium', 'policyStatus'].every((f) => header.map(guessField).includes(f as never)));
  ok('dates in the template are in the future', template.includes('2027-11-07') && !template.includes('2026-'));
  ok('a month-end date doesn\'t roll over', importTemplateCsv(new Date(Date.UTC(2028, 1, 29))).includes('2029-02-28'));
  ok('status words', importStatusLabel('COMMITTING', true) === 'Importing…' && importStatusLabel('COMMITTED', true) === 'Imported' && importStatusLabel('UNDONE', true) === 'Undone');
  const now = Date.now();
  ok('a finished import can be undone', undoAvailable({ status: 'COMMITTED', updatedAt: new Date(now) }, now));
  ok('one still writing can\'t', !undoAvailable({ status: 'COMMITTING', updatedAt: new Date(now - 60_000) }, now));
  ok('one long stopped can', undoAvailable({ status: 'COMMITTING', updatedAt: new Date(now - 16 * 60_000) }, now));
  ok('nor anything else', !undoAvailable({ status: 'STAGED', updatedAt: new Date(0) }, now) && !undoAvailable({ status: 'UNDONE', updatedAt: new Date(0) }, now));

  console.log('The code');
  ok('the plan brings in no server code', !/from '(@\/lib\/prisma|.*\/access|.*\/imports|@prisma)/.test(read('lib/desk/import-plan.ts')));
  const screen = read('app/components/desk/imports/ImportPreview.tsx');
  ok('the screen brings in no server code', !/from '@\/lib\/(prisma|desk\/imports|desk\/import-commit|desk\/access)'/.test(screen) && /import type \{ OnExisting/.test(screen));
  ok('the preview page keeps to agency admins', read('app/(desk)/desk/import/[id]/preview/page.tsx').includes(`deskPageAccess('AGENCY', '/desk/import')`));
  ok('file text never goes in as HTML', !screen.includes('dangerouslySetInnerHTML'));
}

const cleanupAll = async () => {
  const agencyId = { in: cleanup.agencyIds };
  await prisma.task.deleteMany({ where: { agencyId, parentTaskId: { not: null } } });
  await prisma.task.deleteMany({ where: { agencyId } });
  await prisma.insuredAssignment.deleteMany({ where: { agencyId } });
  await prisma.policy.deleteMany({ where: { agencyId } });
  await prisma.insuredAccount.deleteMany({ where: { agencyId } });
  await prisma.importRow.deleteMany({ where: { agencyId } });
  await prisma.importBatch.deleteMany({ where: { agencyId } });
  await prisma.importColumnMemory.deleteMany({ where: { agencyId } });
  await prisma.agencyDeskAssignment.deleteMany({ where: { agencyId } });
  await prisma.deskAuditLog.deleteMany({ where: { OR: [{ agencyId }, { actorId: { in: cleanup.userIds } }] } });
  await prisma.session.deleteMany({ where: { userId: { in: cleanup.userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: cleanup.userIds } } });
  await prisma.agency.deleteMany({ where: { id: agencyId } });
};

const FILE = [
  'Client Name,Client Code,Address,Producer,Policy #,Line of Business,Carrier,Effective Date,Exp Date,Premium,Policy Status',
  'Acme LLC,A1,1 Main St,Jane Smith,GL-1,General Liability,Hartford,1/1/2027,1/1/2028,"$1,250.50",Active',
  'Acme LLC,A1,1 Main St,Jane Smith,AU-1,Commercial Auto,Travelers,2/1/2027,2/1/2028,3400,In Force',
  'Beta Inc,B1,2 Oak Ave,Bob Nobody,,,,,,,',
  'Gamma Co,G1,3 Elm Rd,,GA-1,Property,Chubb,3/1/2027,not a date,100,Active',
  ',,,,,,,,,,',
  'Delta Corp,D1,4 Pine Ln,,DE-1,Umbrella,AIG,4/1/2027,4/1/2028,50.5,Pending',
].join('\n');
const MAP = { name: 'Client Name', externalRef: 'Client Code', addressLine1: 'Address', producer: 'Producer', policyNumber: 'Policy #', lineOfBusiness: 'Line of Business', carrierName: 'Carrier', effectiveDate: 'Effective Date', expirationDate: 'Exp Date', premium: 'Premium', policyStatus: 'Policy Status' };

(async () => {
  const realAccounts = await prisma.insuredAccount.count();
  const realPolicies = await prisma.policy.count();
  try {
    pureLogic();
    if (process.env.PURE_ONLY) { console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0); }

    const mkAgency = async (n: string) => { const a = await prisma.agency.create({ data: { name: `${TAG} ${n}`, deskEnabled: true } }); cleanup.agencyIds.push(a.id); return a; };
    const mkUser = async (n: string, role: UserRole, agencyId: string | null = null, firstName = n, lastName = 'Test', isActive = true) => {
      const u = await prisma.user.create({ data: { email: `${TAG}-${n}@example.test`, role, agencyId, firstName, lastName, isActive, passwordHash: `secret-${TAG}`, mustChangePassword: false } });
      cleanup.userIds.push(u.id); return u;
    };
    const A = await mkAgency('A');
    const B = await mkAgency('B');
    const admin = await mkUser('admin', 'ADMIN', A.id);
    const jane = await mkUser('jane', 'AGENT', A.id, 'Jane', 'Smith');
    await mkUser('gone', 'AGENT', A.id, 'Bob', 'Nobody', false);
    await mkUser('otheragency', 'AGENT', B.id, 'Bob', 'Nobody');
    const adminB = await mkUser('adminb', 'ADMIN', B.id);
    const am = await mkUser('am', 'ACCOUNT_MANAGER');
    const ops = await mkUser('ops', 'DESK_ADMIN');
    const va = await mkUser('va', 'DESK_VA');
    await prisma.agencyDeskAssignment.create({ data: { agencyId: A.id, primaryAmId: am.id } });
    const [sAdmin, sJane, sB, sAm, sOps, sVa] = await Promise.all([admin, jane, adminB, am, ops, va].map((u) => resolveDeskScope(prisma, u.id)));
    const CTX = { ip: '203.0.113.26', userAgent: 'verify' };
    const refusal = async (fn: () => Promise<unknown>) => {
      try { await fn(); return null; } catch (e) { if (e instanceof DeskAccessError) return e; throw e; }
    };
    const stage = (content: string, scope = sAdmin) => stageImport(prisma, scope, { fileName: 'book.csv', bytes: new TextEncoder().encode(content) }, CTX);
    const mapped = async (content = FILE, mapping: Record<string, string> = MAP, scope = sAdmin) => {
      const b = await stage(content, scope);
      const saved = await saveImportMapping(prisma, scope, b.id, { mapping, version: b.version }, CTX);
      return saved;
    };
    const go = async (id: string, onExisting?: 'ADD' | 'SKIP', scope = sAdmin, db: PrismaClient = prisma) => {
      const preview = await getImportPreview(prisma, scope, id, { onExisting }, CTX);
      return commitImport(db, scope, id, { version: preview.version, onExisting, expected: { accountsNew: preview.counts.accountsNew, policiesNew: preview.counts.policiesNew } }, CTX);
    };
    const inA = { agencyId: A.id };
    const countsA = async () => [await prisma.insuredAccount.count({ where: inA }), await prisma.policy.count({ where: inA }), await prisma.insuredAssignment.count({ where: inA })].join();
    const wipeBook = async (agencyId = A.id) => {
      await prisma.task.updateMany({ where: { agencyId }, data: { parentTaskId: null } });
      await prisma.task.deleteMany({ where: { agencyId } });
      await prisma.insuredAssignment.deleteMany({ where: { agencyId } });
      await prisma.policy.deleteMany({ where: { agencyId } });
      await prisma.insuredAccount.deleteMany({ where: { agencyId } });
    };
    let reference = Math.floor(Date.now() / 1000);

    inDatabaseChecks = true;
    const started = Date.now();
    const lap = (name: string) => console.log(`${name} [${Math.round((Date.now() - started) / 1000)}s]`);
    lap('The preview');
    const b1 = await mapped();
    const pv = await getImportPreview(prisma, sAdmin, b1.id, {}, CTX);
    ok('counts', pv.counts.rows === 5 && pv.counts.accountsNew === 3 && pv.counts.policiesNew === 3 && pv.counts.errors === 1 && pv.counts.blank === 0 && pv.counts.ready === 4);
    ok('the bad date is named by row', pv.problems.find((p) => p.rowNumber === 5)?.kind === 'ERROR' && pv.problems.find((p) => p.rowNumber === 5)!.messages[0].includes('not a date'));
    ok('a real person is assigned', pv.accounts[0].name === 'Acme LLC' && pv.accounts[0].assigned === 1);
    ok('someone inactive or at another agency isn\'t', pv.unmatchedProducers[0]?.name === 'Bob Nobody' && pv.accounts[1].assigned === 0);
    ok('several policies shown on one account', pv.accounts[0].policies.length === 2 && pv.accounts[0].policies[0].premiumCents === 125050);
    ok('nothing written by looking', await countsA() === '0,0,0');
    ok('and the import is unchanged', (await getImport(prisma, sAdmin, b1.id, CTX)).version === pv.version);
    const previewLog = await prisma.deskAuditLog.findFirst({ where: { action: 'import.previewed', entityId: b1.id } });
    ok('looking is logged, as counts', !!previewLog && previewLog.ipAddress === CTX.ip && !JSON.stringify(previewLog.metadata).includes('Acme') && !JSON.stringify(previewLog.metadata).includes('Hartford'));
    const notMapped = await stage(FILE);
    ok('columns come first', (await refusal(() => getImportPreview(prisma, sAdmin, notMapped.id, {}, CTX)))?.code === 'NOT_MAPPED');
    ok('and for a commit', (await refusal(() => commitImport(prisma, sAdmin, notMapped.id, { version: notMapped.version, expected: { accountsNew: 0, policiesNew: 0 } }, CTX)))?.code === 'NOT_MAPPED');
    await discardImport(prisma, sAdmin, notMapped.id, CTX);
    ok('an unknown choice is refused', (await refusal(() => getImportPreview(prisma, sAdmin, b1.id, { onExisting: 'NUKE' }, CTX)))?.status === 400);
    const noHeader = await stage('Acme,P1\nBeta,P2\n');
    const noHeaderSet = await setImportHeaderRow(prisma, sAdmin, noHeader.id, { headerRow: 0, version: noHeader.version }, CTX);
    const noHeaderMapped = await saveImportMapping(prisma, sAdmin, noHeader.id, { mapping: { name: 'Column A', policyNumber: 'Column B' }, version: noHeaderSet.version }, CTX);
    ok('a file with no column names counts its first row', (await getImportPreview(prisma, sAdmin, noHeaderMapped.id, {}, CTX)).counts.accountsNew === 2);
    await discardImport(prisma, sAdmin, noHeader.id, CTX);
    const biggerList = await mapped(['Client Name', ...Array.from({ length: 60 }, (_, i) => `Co ${i}`)].join('\n'), { name: 'Client Name' });
    const bigPreview = await getImportPreview(prisma, sAdmin, biggerList.id, {}, CTX);
    ok('a long list is capped, with the true total', bigPreview.accounts.length === 50 && bigPreview.accountsTotal === 60);
    await discardImport(prisma, sAdmin, biggerList.id, CTX);
    const manyBad = await mapped(['Client Name,Policy #,Exp Date', ...Array.from({ length: 250 }, (_, i) => `Co ${i},P${i},bad`)].join('\n'), { name: 'Client Name', policyNumber: 'Policy #', expirationDate: 'Exp Date' });
    const manyPreview = await getImportPreview(prisma, sAdmin, manyBad.id, {}, CTX);
    ok('so are the problems', manyPreview.problems.length === 200 && manyPreview.problemsTotal === 250);
    await discardImport(prisma, sAdmin, manyBad.id, CTX);

    lap('Who can');
    ok('a Producer can\'t preview', (await refusal(() => getImportPreview(prisma, sJane, b1.id, {}, CTX)))?.status === 404);
    ok('another agency can\'t', (await refusal(() => getImportPreview(prisma, sB, b1.id, {}, CTX)))?.status === 404);
    ok('an Account Manager can\'t', (await refusal(() => getImportPreview(prisma, sAm, b1.id, {}, CTX)))?.status === 404);
    ok('a VA can\'t', (await refusal(() => getImportPreview(prisma, sVa, b1.id, {}, CTX)))?.status === 404);
    const commitBody = { version: pv.version, expected: { accountsNew: 3, policiesNew: 3 } };
    for (const [who, scope] of [['Producer', sJane], ['another agency', sB], ['Account Manager', sAm], ['VA', sVa]] as const) {
      ok(`a ${who} can't commit`, (await refusal(() => commitImport(prisma, scope, b1.id, commitBody, CTX)))?.status === 404);
      ok(`a ${who} can't undo`, (await refusal(() => undoImport(prisma, scope, b1.id, CTX)))?.status === 404);
    }
    ok('a refusal is logged', await prisma.deskAuditLog.count({ where: { action: 'access.denied', entityId: b1.id, actorId: jane.id } }) >= 3);
    ok('and none of it wrote anything', await countsA() === '0,0,0');
    ok('a nonsense id is a 404', (await refusal(() => getImportPreview(prisma, sAdmin, 'nope', {}, CTX)))?.status === 404 && (await refusal(() => undoImport(prisma, sAdmin, '$ne', CTX)))?.status === 404);
    ok('an Insurigence admin can preview', (await getImportPreview(prisma, sOps, b1.id, {}, CTX)).counts.accountsNew === 3);

    lap('Refusing a commit');
    ok('with no preview behind it', (await refusal(() => commitImport(prisma, sAdmin, b1.id, { version: pv.version }, CTX)))?.code === 'NO_PREVIEW');
    ok('with odd numbers', (await refusal(() => commitImport(prisma, sAdmin, b1.id, { version: pv.version, expected: { accountsNew: '3', policiesNew: 3 } }, CTX)))?.code === 'NO_PREVIEW');
    ok('with no version', (await refusal(() => commitImport(prisma, sAdmin, b1.id, { expected: { accountsNew: 3, policiesNew: 3 } }, CTX)))?.code === 'CHANGED_ELSEWHERE');
    ok('with an old version', (await refusal(() => commitImport(prisma, sAdmin, b1.id, { version: '2020-01-01T00:00:00.000Z', expected: { accountsNew: 3, policiesNew: 3 } }, CTX)))?.code === 'CHANGED_ELSEWHERE');
    ok('with an unknown choice', (await refusal(() => commitImport(prisma, sAdmin, b1.id, { version: pv.version, onExisting: 'NUKE', expected: { accountsNew: 3, policiesNew: 3 } }, CTX)))?.status === 400);
    const wrong = await refusal(() => commitImport(prisma, sAdmin, b1.id, { version: pv.version, expected: { accountsNew: 99, policiesNew: 3 } }, CTX));
    ok('when the numbers no longer match', wrong?.status === 409 && wrong.code === 'PREVIEW_OUT_OF_DATE');
    const released = await getImport(prisma, sAdmin, b1.id, CTX);
    ok('which leaves it ready to try again', released.status === 'STAGED' && await countsA() === '0,0,0');
    const wrongPolicies = await refusal(() => commitImport(prisma, sAdmin, b1.id, { version: released.version, expected: { accountsNew: 3, policiesNew: 99 } }, CTX));
    ok('policies count too', wrongPolicies?.code === 'PREVIEW_OUT_OF_DATE');
    const changedColumns = await mapped();
    const oldLook = await getImportPreview(prisma, sAdmin, changedColumns.id, {}, CTX);
    const remapped = await saveImportMapping(prisma, sAdmin, changedColumns.id, { mapping: { name: 'Client Name' }, version: oldLook.version }, CTX);
    ok('after the columns changed', remapped.mapped && (await refusal(() => commitImport(prisma, sAdmin, changedColumns.id, { version: oldLook.version, expected: { accountsNew: 3, policiesNew: 3 } }, CTX)))?.code === 'CHANGED_ELSEWHERE');
    await discardImport(prisma, sAdmin, changedColumns.id, CTX);
    const undoEarly = await refusal(() => undoImport(prisma, sAdmin, b1.id, CTX));
    ok('undo before anything is imported', undoEarly?.code === 'NOT_COMMITTED');
    await saveImportMapping(prisma, sAdmin, b1.id, { mapping: MAP }, CTX);

    lap('The commit');
    const looked = await getImportPreview(prisma, sAdmin, b1.id, {}, CTX);
    const done = await commitImport(prisma, sAdmin, b1.id, { version: looked.version, expected: { accountsNew: looked.counts.accountsNew, policiesNew: looked.counts.policiesNew } }, CTX);
    ok('it finishes', done.status === 'COMMITTED' && done.canUndo && !!done.committedAt);
    ok('with its counts', done.insuredsCreated === 3 && done.policiesCreated === 3 && done.rowsSkipped === 1);
    ok('what the preview said went in', await countsA() === '3,3,1');
    const acme = await prisma.insuredAccount.findFirstOrThrow({ where: { ...inA, name: 'Acme LLC' }, include: { policies: { orderBy: { policyNumber: 'asc' } }, assignments: true } });
    ok('the account\'s details', acme.nameKey === 'acme' && acme.externalRef === 'A1' && acme.addressLine1 === '1 Main St' && acme.status === 'ACTIVE' && acme.source === 'IMPORT' && acme.createdById === admin.id && acme.importBatchId === b1.id);
    const au = acme.policies[0];
    ok('a policy\'s details', au.policyNumber === 'AU-1' && au.lineOfBusiness === 'Commercial Auto' && au.carrierName === 'Travelers' && au.status === 'ACTIVE' && au.importBatchId === b1.id && au.createdById === admin.id && au.agencyId === A.id);
    ok('dates land on the day, in UTC', au.effectiveDate?.toISOString() === '2027-02-01T00:00:00.000Z' && au.expirationDate?.toISOString() === '2028-02-01T00:00:00.000Z');
    ok('premium in cents', acme.policies[1].premiumCents === BigInt(125050) && au.premiumCents === BigInt(340000));
    ok('the producer is assigned', acme.assignments.length === 1 && acme.assignments[0].userId === jane.id && acme.assignments[0].role === 'PRODUCER' && acme.assignments[0].createdById === admin.id);
    const delta = await prisma.insuredAccount.findFirstOrThrow({ where: { ...inA, name: 'Delta Corp' }, include: { policies: true } });
    ok('a status in the file is used', delta.policies[0].status === 'PENDING' && delta.policies[0].premiumCents === BigInt(5050));
    const beta = await prisma.insuredAccount.findFirstOrThrow({ where: { ...inA, name: 'Beta Inc' }, include: { policies: true, assignments: true } });
    ok('an insured-only row', beta.policies.length === 0 && beta.assignments.length === 0);
    ok('the row with the error isn\'t there', await prisma.insuredAccount.count({ where: { ...inA, name: 'Gamma Co' } }) === 0);
    ok('rows are gone once imported: they\'re a copy of client data', await prisma.importRow.count({ where: { batchId: b1.id } }) === 0);
    const commitLog = await prisma.deskAuditLog.findFirst({ where: { action: 'import.committed', entityId: b1.id } });
    ok('logged, as counts', !!commitLog && commitLog.ipAddress === CTX.ip && commitLog.agencyId === A.id && !/Acme|Hartford|Main St/.test(JSON.stringify(commitLog.metadata)) && (commitLog.metadata as { accountsNew?: number }).accountsNew === 3);

    lap('The rest of the app sees it');
    const list = await listInsureds(prisma, sAdmin, {});
    ok('in the account list', list.total === 3 || (list as unknown as { rows: unknown[] }).rows?.length === 3);
    const overview = await getInsuredOverview(prisma, sAdmin, acme.id);
    ok('on the account page', overview.policies.length === 2);
    ok('a Producer sees the account assigned to them', (await listInsureds(prisma, sJane, {})).total === 1);
    ok('an edit works on an imported record', await updateInsured(prisma, sAdmin, beta.id, { city: 'Austin', version: beta.updatedAt.toISOString() }, CTX).then(() => true));
    await prisma.insuredAccount.update({ where: { id: beta.id }, data: { city: null, updatedAt: beta.createdAt } });

    lap('A committed import');
    ok('can\'t be committed again', (await refusal(() => commitImport(prisma, sAdmin, b1.id, { version: done.version, expected: { accountsNew: 3, policiesNew: 3 } }, CTX)))?.code === 'NOT_STAGED');
    ok('nor previewed', (await refusal(() => getImportPreview(prisma, sAdmin, b1.id, {}, CTX)))?.code === 'NOT_STAGED');
    ok('nor discarded', (await refusal(() => discardImport(prisma, sAdmin, b1.id, CTX)))?.code === 'NOT_STAGED');
    ok('and shows in the list', (await listImports(prisma, sAdmin, {}, CTX)).imports.find((i) => i.id === b1.id)?.status === 'COMMITTED');

    lap('The same file again');
    const b2 = await mapped();
    const secondLook = await getImportPreview(prisma, sAdmin, b2.id, {}, CTX);
    ok('nothing is added twice', secondLook.counts.accountsNew === 0 && secondLook.counts.policiesNew === 0 && secondLook.counts.accountsExisting === 3);
    const nothing = await refusal(() => commitImport(prisma, sAdmin, b2.id, { version: secondLook.version, expected: { accountsNew: 0, policiesNew: 0 } }, CTX));
    ok('and there\'s nothing to commit', nothing?.code === 'NOTHING_TO_IMPORT');
    ok('which leaves it open', (await getImport(prisma, sAdmin, b2.id, CTX)).status === 'STAGED');
    await discardImport(prisma, sAdmin, b2.id, CTX);

    lap('A corrected file');
    const fixed = await mapped(FILE.replace('not a date', '3/1/2028'));
    const fixedDone = await go(fixed.id);
    ok('adds only the row that was fixed', fixedDone.counts.accountsNew === 1 && fixedDone.counts.policiesNew === 1 && await countsA() === '4,4,1');

    lap('Adding policies to an account in the book');
    const manual = await prisma.insuredAccount.create({ data: { agencyId: A.id, name: 'Manual Co', nameKey: 'manual', city: 'Dallas', source: 'MANUAL' } });
    const before = manual.updatedAt.getTime();
    const addFile = 'Client Name,Address,Producer,Policy #,Exp Date\nManual Company,9 New St,Jane Smith,MA-1,2028-01-01\n';
    const addMap = { name: 'Client Name', addressLine1: 'Address', producer: 'Producer', policyNumber: 'Policy #', expirationDate: 'Exp Date' };
    const addBatch = await mapped(addFile, addMap);
    const skipLook = await getImportPreview(prisma, sAdmin, addBatch.id, { onExisting: 'SKIP' }, CTX);
    ok('leaving it out adds nothing', skipLook.counts.policiesNew === 0 && skipLook.problems[0]?.kind === 'DUPLICATE');
    const addDone = await go(addBatch.id, 'ADD');
    ok('adding puts the policy on it', addDone.policiesCreated === 1 && addDone.insuredsCreated === 0 && await prisma.policy.count({ where: { insuredId: manual.id, policyNumber: 'MA-1' } }) === 1);
    const manualAfter = await prisma.insuredAccount.findUniqueOrThrow({ where: { id: manual.id }, include: { assignments: true } });
    ok('its details aren\'t touched', manualAfter.updatedAt.getTime() === before && manualAfter.addressLine1 === null && manualAfter.city === 'Dallas' && manualAfter.source === 'MANUAL' && manualAfter.importBatchId === null);
    ok('nor its people', manualAfter.assignments.length === 0);
    const undoAdd = await undoImport(prisma, sAdmin, addBatch.id, CTX);
    ok('undo takes the policy back and leaves the account', (undoAdd.undoSummary as { policiesRemoved: number }).policiesRemoved === 1 && await prisma.policy.count({ where: { insuredId: manual.id } }) === 0 && await prisma.insuredAccount.count({ where: { id: manual.id } }) === 1);
    await prisma.insuredAccount.delete({ where: { id: manual.id } });

    lap('Undo');
    await wipeBook();
    const u1 = await mapped();
    const u1Done = await go(u1.id);
    ok('ready', u1Done.status === 'COMMITTED' && await countsA() === '3,3,1');
    const undone = await undoImport(prisma, sAdmin, u1.id, CTX);
    ok('marks it undone', undone.status === 'UNDONE' && !undone.canUndo && !!undone.undoneAt);
    ok('removes everything it added', await countsA() === '0,0,0');
    const uSummary = undone.undoSummary as { accountsRemoved: number; policiesRemoved: number; accountsKept: number; policiesKept: number; keptNames: string[] };
    ok('and says so', uSummary.accountsRemoved === 3 && uSummary.policiesRemoved === 3 && uSummary.accountsKept === 0 && uSummary.policiesKept === 0);
    const undoLog = await prisma.deskAuditLog.findFirst({ where: { action: 'import.undone', entityId: u1.id } });
    ok('logged, as counts', !!undoLog && undoLog.ipAddress === CTX.ip && (undoLog.metadata as { accountsRemoved?: number }).accountsRemoved === 3 && !JSON.stringify(undoLog.metadata).includes('keptNames'));
    ok('records who undid it', (await prisma.importBatch.findUniqueOrThrow({ where: { id: u1.id } })).undoneById === admin.id);
    ok('can\'t be done twice', (await refusal(() => undoImport(prisma, sAdmin, u1.id, CTX)))?.code === 'ALREADY_UNDONE');
    const u1Again = await mapped();
    ok('the same file can go in again', (await go(u1Again.id)).insuredsCreated === 3);
    await undoImport(prisma, sAdmin, u1Again.id, CTX);

    lap('Undo keeps what has been worked on');
    const u2 = await mapped();
    await go(u2.id);
    const accountsU2 = await prisma.insuredAccount.findMany({ where: { importBatchId: u2.id }, include: { policies: true } });
    const uAcme = accountsU2.find((a) => a.name === 'Acme LLC')!;
    const uBeta = accountsU2.find((a) => a.name === 'Beta Inc')!;
    const uDelta = accountsU2.find((a) => a.name === 'Delta Corp')!;
    await prisma.task.create({ data: { reference: reference++, agencyId: A.id, insuredId: uAcme.id, type: 'COI', title: `${TAG} work`, status: 'NEW' } });
    await updateInsured(prisma, sAdmin, uBeta.id, { city: 'Austin', version: uBeta.updatedAt.toISOString() }, CTX);
    const u2Result = await undoImport(prisma, sAdmin, u2.id, CTX);
    const u2Summary = u2Result.undoSummary as typeof uSummary;
    ok('an account with a request stays', await prisma.insuredAccount.count({ where: { id: uAcme.id } }) === 1);
    ok('with its policies', await prisma.policy.count({ where: { insuredId: uAcme.id } }) === 2);
    ok('its people too', await prisma.insuredAssignment.count({ where: { insuredId: uAcme.id } }) === 1);
    ok('an account edited since stays', (await prisma.insuredAccount.findUnique({ where: { id: uBeta.id } }))?.city === 'Austin');
    ok('an untouched one goes', await prisma.insuredAccount.count({ where: { id: uDelta.id } }) === 0 && await prisma.policy.count({ where: { insuredId: uDelta.id } }) === 0);
    ok('what stayed is reported', u2Summary.accountsKept === 2 && u2Summary.policiesKept === 2 && u2Summary.accountsRemoved === 1 && u2Summary.policiesRemoved === 1 && u2Summary.keptNames.includes('Acme LLC') && u2Summary.keptNames.includes('Beta Inc'));
    await wipeBook();

    const u3 = await mapped();
    await go(u3.id);
    const accountsU3 = await prisma.insuredAccount.findMany({ where: { importBatchId: u3.id }, include: { policies: true } });
    const u3Acme = accountsU3.find((a) => a.name === 'Acme LLC')!;
    const u3Delta = accountsU3.find((a) => a.name === 'Delta Corp')!;
    const u3Beta = accountsU3.find((a) => a.name === 'Beta Inc')!;
    await prisma.task.create({ data: { reference: reference++, agencyId: A.id, insuredId: null, policyId: u3Acme.policies[0].id, type: 'COI', title: `${TAG} policy work`, status: 'NEW' } });
    await updatePolicy(prisma, sAdmin, u3Delta.policies[0].id, { notes: 'edited', version: u3Delta.policies[0].updatedAt.toISOString() }, CTX);
    await addPolicy(prisma, sAdmin, u3Beta.id, { policyNumber: 'BY-HAND' }, CTX);
    const u3Result = await undoImport(prisma, sAdmin, u3.id, CTX);
    const u3Summary = u3Result.undoSummary as typeof uSummary;
    ok('a policy with a request keeps its account and siblings', await prisma.policy.count({ where: { insuredId: u3Acme.id } }) === 2);
    ok('an edited policy stays with its account', (await prisma.policy.findUnique({ where: { id: u3Delta.policies[0].id } }))?.notes === 'edited' && await prisma.insuredAccount.count({ where: { id: u3Delta.id } }) === 1);
    ok('a policy added by hand keeps its account', await prisma.policy.count({ where: { insuredId: u3Beta.id, policyNumber: 'BY-HAND' } }) === 1 && await prisma.insuredAccount.count({ where: { id: u3Beta.id } }) === 1);
    ok('all reported', u3Summary.accountsKept === 3 && u3Summary.accountsRemoved === 0 && u3Summary.policiesRemoved === 0 && u3Summary.policiesKept === 3);
    await wipeBook();

    const u4 = await mapped('Client Name,Policy #\nShared Co,S1\n', { name: 'Client Name', policyNumber: 'Policy #' });
    await go(u4.id);
    const u5 = await mapped('Client Name,Policy #\nShared Co,S2\n', { name: 'Client Name', policyNumber: 'Policy #' });
    await go(u5.id);
    const u4Result = await undoImport(prisma, sAdmin, u4.id, CTX);
    ok('an account another import added to stays, and keeps both', await prisma.policy.count({ where: inA }) === 2 && await prisma.insuredAccount.count({ where: inA }) === 1 && (u4Result.undoSummary as typeof uSummary).accountsKept === 1);
    await undoImport(prisma, sAdmin, u5.id, CTX);
    ok('the later import can still be undone', await prisma.policy.count({ where: { ...inA, policyNumber: 'S2' } }) === 0 && await prisma.policy.count({ where: { ...inA, policyNumber: 'S1' } }) === 1);
    await wipeBook();

    lap('Other agencies are untouched');
    const bAccount = await prisma.insuredAccount.create({ data: { agencyId: B.id, name: 'Acme LLC', nameKey: 'acme', source: 'MANUAL' } });
    const bPolicy = await prisma.policy.create({ data: { agencyId: B.id, insuredId: bAccount.id, policyNumber: 'GL-1' } });
    const isolated = await mapped();
    const isolatedLook = await getImportPreview(prisma, sAdmin, isolated.id, {}, CTX);
    ok('another agency\'s account isn\'t a duplicate', isolatedLook.counts.accountsExisting === 0 && isolatedLook.counts.accountsNew === 3);
    ok('nor is its policy number mentioned', !JSON.stringify(isolatedLook.problems).includes('GL-1'));
    await go(isolated.id);
    await undoImport(prisma, sAdmin, isolated.id, CTX);
    ok('and undo leaves it alone', await prisma.insuredAccount.count({ where: { id: bAccount.id } }) === 1 && await prisma.policy.count({ where: { id: bPolicy.id } }) === 1);
    await wipeBook(B.id);
    const platform = await stageImport(prisma, sOps, { fileName: 'book.csv', bytes: new TextEncoder().encode(FILE), agencyId: B.id }, CTX);
    await saveImportMapping(prisma, sOps, platform.id, { mapping: MAP, version: platform.version }, CTX);
    const platformDone = await go(platform.id, undefined, sOps);
    ok('an Insurigence admin can import for an agency', platformDone.insuredsCreated === 3 && await prisma.insuredAccount.count({ where: { agencyId: B.id } }) === 3 && await prisma.insuredAccount.count({ where: inA }) === 0);
    await undoImport(prisma, sOps, platform.id, CTX);

    lap('When something fails');
    const failing = (failAt: number, error = new Error('database down')) => {
      let calls = 0;
      return new Proxy(prisma, { get(target, key) {
        if (key === '$runCommandRaw') return async (command: Record<string, unknown>) => {
          if ('insert' in command && ++calls === failAt) throw error;
          return target.$runCommandRaw(command as never);
        };
        const value = Reflect.get(target, key);
        return typeof value === 'function' ? value.bind(target) : value;
      } }) as PrismaClient;
    };
    for (const [name, at] of [['accounts', 1], ['policies', 2], ['assignments', 3]] as const) {
      const f = await mapped();
      const look = await getImportPreview(prisma, sAdmin, f.id, {}, CTX);
      let message = '';
      try { await commitImport(failing(at), sAdmin, f.id, { version: look.version, expected: { accountsNew: 3, policiesNew: 3 } }, CTX); } catch (e) { message = (e as Error).message; }
      ok(`writing ${name} fails: the error comes through`, message === 'database down');
      ok('nothing is left behind', await countsA() === '0,0,0');
      const back = await getImport(prisma, sAdmin, f.id, CTX);
      ok('and it can be tried again', back.status === 'STAGED' && await prisma.importRow.count({ where: { batchId: f.id } }) > 0);
      await discardImport(prisma, sAdmin, f.id, CTX);
    }
    const shortWrite = new Proxy(prisma, { get(target, key) {
      if (key === '$runCommandRaw') return async (command: Record<string, unknown>) => {
        const result = await target.$runCommandRaw(command as never);
        return 'insert' in command && command.insert === 'Policy' ? { ...result, n: 0 } : result;
      };
      const value = Reflect.get(target, key);
      return typeof value === 'function' ? value.bind(target) : value;
    } }) as PrismaClient;
    const sw = await mapped();
    const swLook = await getImportPreview(prisma, sAdmin, sw.id, {}, CTX);
    let swMessage = '';
    try { await commitImport(shortWrite, sAdmin, sw.id, { version: swLook.version, expected: { accountsNew: 3, policiesNew: 3 } }, CTX); } catch (e) { swMessage = (e as Error).message; }
    ok('a write reported short counts as failed', swMessage.includes('Not every') && await countsA() === '0,0,0');
    await discardImport(prisma, sAdmin, sw.id, CTX);

    const logFails = new Proxy(prisma, { get(target, key) {
      if (key === '$transaction') return async (work: (tx: unknown) => Promise<unknown>, options: never) => target.$transaction(async (tx) => {
        const logged = new Proxy(tx, { get(t, k) {
          if (k === 'deskAuditLog') return { create: async () => { throw new Error('log unavailable'); } };
          return Reflect.get(t, k);
        } });
        return work(logged);
      }, options);
      const value = Reflect.get(target, key);
      return typeof value === 'function' ? value.bind(target) : value;
    } }) as PrismaClient;
    const lf = await mapped();
    const lfLook = await getImportPreview(prisma, sAdmin, lf.id, {}, CTX);
    let lfMessage = '';
    try { await commitImport(logFails, sAdmin, lf.id, { version: lfLook.version, expected: { accountsNew: 3, policiesNew: 3 } }, CTX); } catch (e) { lfMessage = (e as Error).message; }
    ok('an import that can\'t be logged doesn\'t happen', lfMessage === 'log unavailable' && await countsA() === '0,0,0' && (await getImport(prisma, sAdmin, lf.id, CTX)).status === 'STAGED');
    await discardImport(prisma, sAdmin, lf.id, CTX);

    const noCleanup = new Proxy(prisma, { get(target, key) {
      if (key === '$runCommandRaw') return async (command: Record<string, unknown>) => {
        if ('insert' in command && command.insert === 'Policy') throw new Error('database down');
        if ('delete' in command && command.delete === 'InsuredAccount') throw new Error('still down');
        return target.$runCommandRaw(command as never);
      };
      const value = Reflect.get(target, key);
      return typeof value === 'function' ? value.bind(target) : value;
    } }) as PrismaClient;
    const stuck = await mapped();
    const stuckLook = await getImportPreview(prisma, sAdmin, stuck.id, {}, CTX);
    const quiet = console.error;
    console.error = () => {};
    await commitImport(noCleanup, sAdmin, stuck.id, { version: stuckLook.version, expected: { accountsNew: 3, policiesNew: 3 } }, CTX).catch(() => null);
    console.error = quiet;
    const stuckRow = await getImport(prisma, sAdmin, stuck.id, CTX);
    ok('if the cleanup fails too, it isn\'t offered for another try', stuckRow.status === 'COMMITTING');
    ok('and isn\'t undoable while it might still be running', !stuckRow.canUndo && (await refusal(() => undoImport(prisma, sAdmin, stuck.id, CTX)))?.code === 'NOT_COMMITTED');
    const another = await mapped('Client Name\nZed Co\n', { name: 'Client Name' });
    const anotherLook = await getImportPreview(prisma, sAdmin, another.id, {}, CTX);
    const runningRefusal = await refusal(() => commitImport(prisma, sAdmin, another.id, { version: anotherLook.version, expected: { accountsNew: 1, policiesNew: 0 } }, CTX));
    ok('another import waits for it', runningRefusal?.status === 409 && runningRefusal.code === 'IMPORT_RUNNING');
    const longAgo = new Date(Date.now() - 16 * 60_000);
    await prisma.$runCommandRaw({ update: 'ImportBatch', updates: [{ q: { _id: { $oid: stuck.id } }, u: { $set: { updatedAt: { $date: longAgo.toISOString() } } } }] });
    const stoppedRow = await getImport(prisma, sAdmin, stuck.id, CTX);
    ok('later it can be undone', stoppedRow.canUndo && stoppedRow.status === 'COMMITTING');
    const anotherLook2 = await getImport(prisma, sAdmin, another.id, CTX);
    const anotherGoes = await commitImport(prisma, sAdmin, another.id, { version: anotherLook2.version, expected: { accountsNew: 1, policiesNew: 0 } }, CTX);
    ok('and no longer holds others up', anotherGoes.status === 'COMMITTED');
    await undoImport(prisma, sAdmin, another.id, CTX);
    const leftovers = await prisma.insuredAccount.count({ where: { importBatchId: stuck.id } });
    const stuckUndo = await undoImport(prisma, sAdmin, stuck.id, CTX);
    ok('undo clears what it left, and its rows', leftovers === 3 && stuckUndo.status === 'UNDONE' && await prisma.insuredAccount.count({ where: { importBatchId: stuck.id } }) === 0 && await prisma.importRow.count({ where: { batchId: stuck.id } }) === 0);

    lap('Undo cut short');
    const cut = await mapped();
    await go(cut.id);
    // Checking what can go is one call to task.findMany; these answer the checks made just before each delete.
    const appearing = (model: 'task' | 'policy', match: string) => new Proxy(prisma, { get(target, key) {
      if (key === model) return new Proxy(target[model], { get(t, k) {
        if (k === 'count') return async (args: { where: Record<string, unknown> }) => (match in args.where ? 1 : (t as unknown as { count: (a: unknown) => Promise<number> }).count(args));
        const v = Reflect.get(t, k);
        return typeof v === 'function' ? v.bind(t) : v;
      } });
      const value = Reflect.get(target, key);
      return typeof value === 'function' ? value.bind(target) : value;
    } }) as PrismaClient;
    const cutRefusal = await refusal(() => undoImport(appearing('task', 'insuredId'), sAdmin, cut.id, CTX));
    ok('a request landing on an account mid-undo: 409, and it isn\'t removed', cutRefusal?.status === 409 && cutRefusal.code === 'CHANGED_ELSEWHERE' && await prisma.insuredAccount.count({ where: inA }) === 3);
    ok('it stays undoable', (await getImport(prisma, sAdmin, cut.id, CTX)).status === 'COMMITTED');
    const cut2 = await mapped('Client Name,Policy #\nCut Two,C2\n', { name: 'Client Name', policyNumber: 'Policy #' });
    await go(cut2.id);
    const policyRefusal = await refusal(() => undoImport(appearing('task', 'policyId'), sAdmin, cut2.id, CTX));
    ok('on a policy too', policyRefusal?.status === 409 && await prisma.policy.count({ where: { importBatchId: cut2.id } }) === 1);
    const handRefusal = await refusal(() => undoImport(appearing('policy', 'insuredId'), sAdmin, cut2.id, CTX));
    ok('a policy added by hand mid-undo: the account stays', handRefusal?.status === 409 && await prisma.insuredAccount.count({ where: { importBatchId: cut2.id } }) === 1);
    await undoImport(prisma, sAdmin, cut2.id, CTX);
    let otherError = '';
    const reportsFailure = new Proxy(prisma, { get(target, key) {
      if (key === '$runCommandRaw') return async (command: Record<string, unknown>) => ('delete' in command && command.delete === 'InsuredAccount' ? { ok: 1, n: 0, writeErrors: [{ code: 1 }] } : target.$runCommandRaw(command as never));
      const value = Reflect.get(target, key);
      return typeof value === 'function' ? value.bind(target) : value;
    } }) as PrismaClient;
    let reported = '';
    try { await undoImport(reportsFailure, sAdmin, cut.id, CTX); } catch (e) { reported = (e as Error).message; }
    ok('a delete that reports a failure counts as failed', reported.includes('Could not remove') && (await getImport(prisma, sAdmin, cut.id, CTX)).status === 'COMMITTED');
    const deleteBroken = new Proxy(prisma, { get(target, key) {
      if (key === '$runCommandRaw') return async (command: Record<string, unknown>) => {
        if ('delete' in command && command.delete === 'InsuredAccount') throw new Error('database down');
        return target.$runCommandRaw(command as never);
      };
      const value = Reflect.get(target, key);
      return typeof value === 'function' ? value.bind(target) : value;
    } }) as PrismaClient;
    try { await undoImport(deleteBroken, sAdmin, cut.id, CTX); } catch (e) { otherError = (e as Error).message; }
    ok('a failed delete comes through as it is', otherError === 'database down' && (await getImport(prisma, sAdmin, cut.id, CTX)).status === 'COMMITTED');
    const repeated = await undoImport(prisma, sAdmin, cut.id, CTX);
    ok('and repeating it finishes the job', repeated.status === 'UNDONE' && await countsA() === '0,0,0');
    const noLog = new Proxy(prisma, { get(target, key) {
      if (key === 'deskAuditLog') return { create: async () => { throw new Error('log unavailable'); } };
      const value = Reflect.get(target, key);
      return typeof value === 'function' ? value.bind(target) : value;
    } }) as PrismaClient;
    const unloggedUndo = await mapped();
    await go(unloggedUndo.id);
    otherError = '';
    try { await undoImport(noLog, sAdmin, unloggedUndo.id, CTX); } catch (e) { otherError = (e as Error).message; }
    ok('an undo that can\'t be logged doesn\'t happen', otherError === 'log unavailable' && await countsA() === '3,3,1');
    await undoImport(prisma, sAdmin, unloggedUndo.id, CTX);

    lap('Two at once');
    const c1 = await mapped();
    const c2 = await mapped();
    const [l1, l2] = await Promise.all([getImportPreview(prisma, sAdmin, c1.id, {}, CTX), getImportPreview(prisma, sAdmin, c2.id, {}, CTX)]);
    const raced = await Promise.allSettled([
      commitImport(prisma, sAdmin, c1.id, { version: l1.version, expected: { accountsNew: 3, policiesNew: 3 } }, CTX),
      commitImport(prisma, sAdmin, c2.id, { version: l2.version, expected: { accountsNew: 3, policiesNew: 3 } }, CTX),
    ]);
    const wins = raced.filter((r) => r.status === 'fulfilled').length;
    const losers = raced.filter((r) => r.status === 'rejected').map((r) => (r as PromiseRejectedResult).reason);
    ok('two imports of one new client: only one goes in', await countsA() === '3,3,1' && wins === 1);
    ok('the other gets a 409, not a server error', losers.every((e) => e instanceof DeskAccessError && e.status === 409));
    for (const id of [c1.id, c2.id]) {
      const row = await getImport(prisma, sAdmin, id, CTX);
      if (row.status === 'COMMITTED') await undoImport(prisma, sAdmin, id, CTX); else await discardImport(prisma, sAdmin, id, CTX);
    }
    const same = await mapped();
    const sameLook = await getImportPreview(prisma, sAdmin, same.id, {}, CTX);
    const sameBody = { version: sameLook.version, expected: { accountsNew: 3, policiesNew: 3 } };
    const sameRace = await Promise.allSettled([commitImport(prisma, sAdmin, same.id, sameBody, CTX), commitImport(prisma, sAdmin, same.id, sameBody, CTX)]);
    ok('one import double-clicked goes in once', sameRace.filter((r) => r.status === 'fulfilled').length === 1 && await countsA() === '3,3,1');
    await undoImport(prisma, sAdmin, same.id, CTX);
    // The timing a real double click may or may not hit: the first click finishes claiming just after the second has looked.
    const late = await mapped();
    const lateLook = await getImportPreview(prisma, sAdmin, late.id, {}, CTX);
    const beforeLate = await countsA();
    let lateClaimed = false;
    const claimedJustBefore = new Proxy(prisma, { get(target, key) {
      if (key === '$transaction') return async (...args: unknown[]) => {
        if (!lateClaimed) { lateClaimed = true; await prisma.importBatch.update({ where: { id: late.id }, data: { status: 'COMMITTING' } }); }
        return (target.$transaction as (...a: unknown[]) => unknown)(...args);
      };
      const value = Reflect.get(target, key);
      return typeof value === 'function' ? value.bind(target) : value;
    } }) as PrismaClient;
    const lateCode = await commitImport(claimedJustBefore, sAdmin, late.id, { version: lateLook.version, expected: { accountsNew: 3, policiesNew: 3 } }, CTX).then(() => 'went through', (e) => (e instanceof DeskAccessError ? e.status : 'other'));
    ok('a second click, just after the first claimed it: 409', lateCode === 409);
    ok('and adds nothing', await countsA() === beforeLate);
    await prisma.importBatch.update({ where: { id: late.id }, data: { status: 'STAGED' } });
    await discardImport(prisma, sAdmin, late.id, CTX);
    const conflicted = (code: string) => new Proxy(prisma, { get(target, key) {
      if (key === '$transaction') return async () => { throw new Prisma.PrismaClientKnownRequestError('write conflict', { code, clientVersion: 'test' }); };
      const value = Reflect.get(target, key);
      return typeof value === 'function' ? value.bind(target) : value;
    } }) as PrismaClient;
    const cf = await mapped();
    const cfLook = await getImportPreview(prisma, sAdmin, cf.id, {}, CTX);
    ok('a write conflict starting: 409', (await refusal(() => commitImport(conflicted('P2034'), sAdmin, cf.id, { version: cfLook.version, expected: { accountsNew: 3, policiesNew: 3 } }, CTX)))?.code === 'CHANGED_ELSEWHERE');
    const changedBook = await prisma.insuredAccount.create({ data: { agencyId: A.id, name: 'Acme LLC', nameKey: 'acme', source: 'MANUAL' } });
    const outdated = await refusal(() => commitImport(prisma, sAdmin, cf.id, { version: cfLook.version, expected: { accountsNew: 3, policiesNew: 3 } }, CTX));
    ok('the book changing after the preview stops the commit', outdated?.code === 'PREVIEW_OUT_OF_DATE' && await prisma.policy.count({ where: inA }) === 0);
    await prisma.insuredAccount.delete({ where: { id: changedBook.id } });
    await discardImport(prisma, sAdmin, cf.id, CTX);

    lap('Odd text in a real write');
    const oddBatch = await mapped('Client Name,Policy #,Carrier\n"$where",$ne,"{""$gt"":""""}"\n__proto__,P2,constructor\n"<img src=x onerror=alert(1)>",P3,X\n', { name: 'Client Name', policyNumber: 'Policy #', carrierName: 'Carrier' });
    await go(oddBatch.id);
    const oddRows = await prisma.insuredAccount.findMany({ where: { importBatchId: oddBatch.id }, include: { policies: true }, orderBy: { name: 'asc' } });
    ok('stored as plain text', oddRows.length === 3 && oddRows.some((a) => a.name === '$where' && a.policies[0].policyNumber === '$ne' && a.policies[0].carrierName === '{"$gt":""}') && oddRows.some((a) => a.name === '__proto__'));
    await undoImport(prisma, sAdmin, oddBatch.id, CTX);
    ok('and removed the same way', await countsA() === '0,0,0');

    lap('The template, end to end');
    const fromTemplate = await stage(importTemplateCsv());
    const templateMap = await getImportMapping(prisma, sAdmin, fromTemplate.id, CTX);
    ok('its columns are all suggested', templateMap.columns.every((c) => c.field !== null));
    const templateMapping = Object.fromEntries(templateMap.columns.map((c) => [c.field, c.column]));
    await saveImportMapping(prisma, sAdmin, fromTemplate.id, { mapping: templateMapping, version: templateMap.version }, CTX);
    const templateLook = await getImportPreview(prisma, sAdmin, fromTemplate.id, {}, CTX);
    ok('it reads with no problems', templateLook.counts.errors === 0 && templateLook.counts.warnings === 0 && templateLook.counts.duplicates === 0);
    ok('one account with two policies, and one with none', templateLook.counts.accountsNew === 2 && templateLook.counts.policiesNew === 2 && templateLook.accounts[0].policies.length === 2 && templateLook.accounts[1].policies.length === 0);
    await discardImport(prisma, sAdmin, fromTemplate.id, CTX);

    lap('Over HTTP');
    const http = await mapped();
    const [tAdmin, tJane, tB] = await Promise.all([admin, jane, adminB].map((u) => createSession(u.id)));
    const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
    const req = (path: string, token: string | null, method = 'GET', body?: unknown) => new NextRequest(`http://local.test/api/desk/imports/${path}`, {
      method, headers: { ...(token ? { cookie: `session_token=${token}` } : {}), 'content-type': 'application/json' }, ...(body !== undefined ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}),
    });
    const previewed = await previewRoute(req(`${http.id}/preview`, tAdmin), ctx(http.id));
    const previewBody = await previewed.json();
    ok('previewing', previewed.status === 200 && previewBody.counts.accountsNew === 3 && previewBody.onExisting === 'ADD');
    ok('the choice in the address', (await (await previewRoute(req(`${http.id}/preview?onExisting=SKIP`, tAdmin), ctx(http.id))).json()).onExisting === 'SKIP');
    ok('a bad choice: 400', (await previewRoute(req(`${http.id}/preview?onExisting=x`, tAdmin), ctx(http.id))).status === 400);
    ok('a Producer: 404', (await previewRoute(req(`${http.id}/preview`, tJane), ctx(http.id))).status === 404);
    ok('another agency: 404', (await commitRoute(req(`${http.id}/commit`, tB, 'POST', { version: previewBody.version, expected: previewBody.counts }), ctx(http.id))).status === 404);
    ok('not signed in: 401', (await commitRoute(req(`${http.id}/commit`, null, 'POST', {}), ctx(http.id))).status === 401 && (await undoRoute(req(`${http.id}/undo`, null, 'POST'), ctx(http.id))).status === 401 && (await previewRoute(req(`${http.id}/preview`, null), ctx(http.id))).status === 401);
    ok('not JSON: 400', (await commitRoute(req(`${http.id}/commit`, tAdmin, 'POST', 'nonsense'), ctx(http.id))).status === 400);
    ok('a list: 400', (await commitRoute(req(`${http.id}/commit`, tAdmin, 'POST', []), ctx(http.id))).status === 400);
    const committed = await commitRoute(req(`${http.id}/commit`, tAdmin, 'POST', { version: previewBody.version, expected: { accountsNew: 3, policiesNew: 3 } }), ctx(http.id));
    const committedBody = await committed.json();
    ok('committing', committed.status === 200 && committedBody.status === 'COMMITTED' && committedBody.counts.accountsNew === 3);
    ok('no big numbers in the answer break it', typeof committedBody.insuredsCreated === 'number');
    ok('a Producer can\'t undo: 404', (await undoRoute(req(`${http.id}/undo`, tJane, 'POST'), ctx(http.id))).status === 404);
    const undoneRes = await undoRoute(req(`${http.id}/undo`, tAdmin, 'POST'), ctx(http.id));
    ok('undoing', undoneRes.status === 200 && (await undoneRes.json()).status === 'UNDONE');
    ok('twice: 409', (await undoRoute(req(`${http.id}/undo`, tAdmin, 'POST'), ctx(http.id))).status === 409);
    const templateRes = await templateRoute(req('template', tAdmin));
    ok('the template downloads', templateRes.status === 200 && templateRes.headers.get('content-type')!.includes('text/csv') && templateRes.headers.get('content-disposition')!.includes('.csv') && (await templateRes.text()).startsWith('Named Insured,'));
    ok('not for a Producer', (await templateRoute(req('template', tJane))).status === 403);
    ok('nor signed out', (await templateRoute(req('template', null))).status === 401);

    ok('nothing left in the test agency', await countsA() === '0,0,0');
  } catch (err) {
    console.error(err);
    fail++;
  } finally {
    await cleanupAll().catch((err) => { console.error('cleanup failed', err); fail++; });
    ok('real accounts and policies unchanged', await prisma.insuredAccount.count() === realAccounts && await prisma.policy.count() === realPolicies);
    console.log(`\n${pass} passed, ${fail} failed`);
    await prisma.$disconnect();
    process.exit(fail ? 1 : 0);
  }
})();
