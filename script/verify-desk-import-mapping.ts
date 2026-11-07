/**
 * Module 25: choosing where an export's columns go, and remembering it per agency.
 * Temporary agencies and users only, removed afterwards.
 *
 *   npx tsx script/verify-desk-import-mapping.ts
 */
import 'dotenv/config';
import { readFileSync } from 'fs';
import { NextRequest } from 'next/server';
import { Prisma, type PrismaClient, type UserRole } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { DeskAccessError, resolveDeskScope } from '../lib/desk/access';
import { createSession } from '../lib/auth';
import {
  IMPORT_FIELDS, MAX_COLUMN_MEMORY, assignField, columnKey, columnsFromMapping, guessField, importStatusLabel, mappingFromColumns, mappingNotes,
  mergeColumnMemory, parseColumnMemory, sampleValues, suggestColumns, validateMapping,
} from '../lib/desk/import-fields';
import { discardImport, getImportMapping, saveImportMapping, setImportHeaderRow, stageImport } from '../lib/desk/imports';
import { GET as mappingRoute, PUT as saveRoute } from '../app/api/desk/imports/[id]/mapping/route';

let pass = 0, fail = 0;
const ok = (n: string, c: boolean) => { c ? pass++ : fail++; console.log(`  ${c ? '✓' : '✗'} ${n}`); };

const TAG = `m25test${Date.now()}`;
const cleanup = { agencyIds: [] as string[], userIds: [] as string[] };
const read = (p: string) => readFileSync(p, 'utf8');

function pureLogic() {
  console.log('The fields');
  const aliases = IMPORT_FIELDS.flatMap((f) => [...f.aliases]);
  ok('no column name suggests two fields', new Set(aliases).size === aliases.length);
  ok('every alias is in the compared form', aliases.every((a) => columnKey(a) === a));
  ok('Q2\'s fields are all there', ['name', 'dba', 'addressLine1', 'contactName', 'producer', 'policyNumber', 'carrierName', 'lineOfBusiness', 'effectiveDate', 'expirationDate', 'premium', 'policyStatus'].every((k) => IMPORT_FIELDS.some((f) => f.key === k)));
  ok('only the named insured is required', IMPORT_FIELDS.filter((f) => 'required' in f && f.required).map((f) => f.key).join() === 'name');

  console.log('Suggesting from names');
  const cases: [string, string | null][] = [
    ['Client Name', 'name'], ['INSURED', 'name'], ['Named Insured', 'name'], ['Policy #', 'policyNumber'], ['Pol No.', 'policyNumber'], ['Exp. Date', 'expirationDate'], ['X-Date', 'expirationDate'],
    ['Eff Date', 'effectiveDate'], ['LOB', 'lineOfBusiness'], ['Writing Company', 'carrierName'], ['E-mail', 'contactEmail'], ['Zip Code', 'postalCode'], ['Annual Premium', 'premium'], ['Producer', 'producer'],
    ['Lookup Code', 'externalRef'], ['Favourite colour', null], ['', null], ['__proto__', null], ['constructor', null],
  ];
  for (const [column, field] of cases) ok(`"${column}" → ${field}`, guessField(column) === field);

  console.log('Suggesting for a file');
  const plain = suggestColumns(['Client', 'Insured', 'Exp Date', 'Colour'], []);
  ok('a field goes to the first column that fits', plain[0].field === 'name' && plain[1].field === null);
  ok('marked as a suggestion', plain[0].source === 'guessed' && plain[2].source === 'guessed');
  ok('an unknown column is left out', plain[3].field === null && plain[3].source === null);
  const remembered = suggestColumns(['Insured', 'Shop', 'Notes'], [{ column: 'shop', field: 'name' }, { column: 'notes', field: null }]);
  ok('this agency\'s choice beats a name match', remembered[1].field === 'name' && remembered[1].source === 'remembered' && remembered[0].field === null);
  ok('a column it chose to leave out stays out', remembered[2].field === null && remembered[2].source === 'remembered');
  ok('spelling and case don\'t matter', suggestColumns(['SHOP!'], [{ column: 'shop', field: 'name' }])[0].field === 'name');
  ok('two remembered columns can\'t share a field', suggestColumns(['A', 'B'], [{ column: 'a', field: 'name' }, { column: 'b', field: 'name' }]).filter((c) => c.field).length === 1);
  ok('names on the object itself aren\'t memory', suggestColumns(['__proto__', 'constructor'], []).every((c) => c.field === null));

  console.log('Remembering');
  const merged = mergeColumnMemory([{ column: 'old', field: 'dba' }, { column: 'shop', field: 'city' }], ['Shop', 'Client', 'Favourite'], { name: 'Shop' });
  ok('the latest choice replaces the earlier one', merged[0].column === 'shop' && merged[0].field === 'name' && merged.filter((e) => e.column === 'shop').length === 1);
  ok('a suggestion turned down is remembered', merged.some((e) => e.column === 'client' && e.field === null));
  ok('other columns\' choices stay', merged.some((e) => e.column === 'old' && e.field === 'dba'));
  ok('a column with no suggestion, left out, isn\'t kept', !merged.some((e) => e.column === 'favourite'));
  ok('leaving out a column forgets its earlier choice', !mergeColumnMemory([{ column: 'shop', field: 'city' }], ['Shop'], {}).some((e) => e.column === 'shop'));
  ok('"Column B" isn\'t remembered', mergeColumnMemory([], ['Column B', 'Column C (2)'], { name: 'Column B', dba: 'Column C (2)' }).length === 0);
  ok('the list has a limit, keeping the latest', mergeColumnMemory(Array.from({ length: MAX_COLUMN_MEMORY }, (_, i) => ({ column: `c${i}`, field: null })), ['Shop'], { name: 'Shop' }).length === MAX_COLUMN_MEMORY
    && mergeColumnMemory(Array.from({ length: MAX_COLUMN_MEMORY }, (_, i) => ({ column: `c${i}`, field: null })), ['Shop'], { name: 'Shop' })[0].column === 'shop');
  ok('anything odd in storage is dropped', parseColumnMemory([{ column: 'a', field: 'name' }, { column: 'b', field: null }, { column: 'c', field: 'nope' }, { column: 1, field: 'name' }, null, 'x']).length === 2);
  ok('storage that isn\'t a list is empty', parseColumnMemory({ a: 1 }).length === 0 && parseColumnMemory(null).length === 0);

  console.log('Checking a mapping');
  const headers = ['Client', 'Exp', '__proto__'];
  ok('a good one', validateMapping({ name: 'Client', expirationDate: 'Exp' }, headers).errors.length === 0);
  ok('the named insured is required', validateMapping({ expirationDate: 'Exp' }, headers).errors.join().includes('named insured'));
  ok('a column not in the file', validateMapping({ name: 'Nope' }, headers).errors.join().includes('not in this file'));
  ok('and doesn\'t also ask for the field', validateMapping({ name: 'Nope' }, headers).errors.length === 1);
  ok('a field that doesn\'t exist', validateMapping({ name: 'Client', hacked: 'Exp' }, headers).errors.length === 1);
  ok('one column for two fields', validateMapping({ name: 'Client', dba: 'Client' }, headers).errors.join().includes('can\'t be both'));
  ok('a column value that isn\'t text', validateMapping({ name: 'Client', dba: 5 }, headers).errors.length === 1 && validateMapping({ name: 'Client', dba: { $ne: 1 } }, headers).errors.length === 1);
  ok('not a mapping at all', [null, undefined, 'x', 5, []].every((v) => validateMapping(v, headers).errors.length === 1));
  const proto = validateMapping(JSON.parse('{"__proto__":"Client","name":"Client"}'), headers);
  ok('"__proto__" as a field is refused, and pollutes nothing', proto.errors.length === 1 && !('polluted' in {}) && Object.getPrototypeOf(proto.mapping) === Object.prototype);
  ok('"__proto__" as a column is only text', validateMapping({ name: '__proto__' }, headers).mapping.name === '__proto__');
  ok('a built-in name isn\'t a column', validateMapping({ name: 'constructor' }, headers).errors.length === 1);

  console.log('Choosing');
  const cols = suggestColumns(['Client', 'Insured'], []);
  const moved = assignField(cols, 'Insured', 'name');
  ok('a field moves to the new column', moved[1].field === 'name' && moved[0].field === null);
  ok('and is no longer marked as suggested', moved[1].source === null && moved[0].source === null);
  ok('"don\'t import" touches only that column', assignField(moved, 'Client', null)[1].field === 'name');
  ok('what the screen sends', JSON.stringify(mappingFromColumns(moved)) === '{"name":"Insured"}');
  ok('a saved choice shows', columnsFromMapping(['A', 'B'], { name: 'B' })[1].source === 'saved' && columnsFromMapping(['A', 'B'], { name: 'B' })[0].source === null);
  ok('accounts only is noted', mappingNotes({ name: 'A' }).join().includes('accounts only'));
  ok('a missing expiration date is noted', mappingNotes({ name: 'A', carrierName: 'B' }).join().includes('expiration'));
  ok('nothing to note', mappingNotes({ name: 'A', expirationDate: 'B' }).length === 0);
  ok('examples skip blanks and repeats', sampleValues([{ cells: ['', 'x'] }, { cells: ['a'] }, { cells: ['a'] }, { cells: ['b'] }, { cells: ['c'] }, { cells: ['d'] }], 0).join() === 'a,b,c');
  ok('a row too short for the column', sampleValues([{ cells: [] }], 3).length === 0);
  ok('status words', importStatusLabel('STAGED', false) === 'Choose columns' && importStatusLabel('STAGED', true) === 'Columns chosen' && importStatusLabel('FAILED', false) === 'Didn\'t finish');

  console.log('The code');
  ok('the shared logic imports nothing', !/^import /m.test(read('lib/desk/import-fields.ts')));
  const center = read('app/components/desk/imports/ImportCenter.tsx');
  const mapper = read('app/components/desk/imports/ImportMapper.tsx');
  ok('the screens bring in no server code', ![center, mapper].some((s) => /from '@\/lib\/(prisma|desk\/imports|desk\/import-parse|desk\/access)'/.test(s)));
  ok('both pages keep to agency admins', ['app/(desk)/desk/import/page.tsx', 'app/(desk)/desk/import/[id]/page.tsx'].every((p) => read(p).includes(`deskPageAccess('AGENCY', '/desk/import')`)));
  ok('file text never goes in as HTML', ![center, mapper].some((s) => s.includes('dangerouslySetInnerHTML')));
}

const FILE = 'Client Name,Policy #,Exp Date,Shop Colour\nAcme,P1,2027-01-01,Red\nBeta,P2,2027-02-01,Blue\n';
const VAGUE = 'Foo,Bar\nAcme,1\nBeta,2\n';

(async () => {
  const memoryElsewhere = await prisma.importColumnMemory.count();
  try {
    pureLogic();

    const mkAgency = async (n: string) => { const a = await prisma.agency.create({ data: { name: `${TAG} ${n}`, deskEnabled: true } }); cleanup.agencyIds.push(a.id); return a; };
    const mkUser = async (n: string, role: UserRole, agencyId: string | null = null) => {
      const u = await prisma.user.create({ data: { email: `${TAG}-${n}@example.test`, role, agencyId, firstName: n, passwordHash: `secret-${TAG}`, mustChangePassword: false } });
      cleanup.userIds.push(u.id); return u;
    };
    const A = await mkAgency('A');
    const B = await mkAgency('B');
    const admin = await mkUser('admin', 'ADMIN', A.id);
    const producer = await mkUser('producer', 'AGENT', A.id);
    const adminB = await mkUser('admin-b', 'ADMIN', B.id);
    const am = await mkUser('am', 'ACCOUNT_MANAGER');
    const ops = await mkUser('ops', 'DESK_ADMIN');
    const va = await mkUser('va', 'DESK_VA');
    await prisma.agencyDeskAssignment.create({ data: { agencyId: A.id, primaryAmId: am.id } });
    const [sAdmin, sProducer, sB, sAm, sOps, sVa] = await Promise.all([admin, producer, adminB, am, ops, va].map((u) => resolveDeskScope(prisma, u.id)));
    const CTX = { ip: '203.0.113.25', userAgent: 'verify' };
    const refusal = async (fn: () => Promise<unknown>) => {
      try { await fn(); return null; } catch (e) { if (e instanceof DeskAccessError) return e; throw e; }
    };
    const status = async (fn: () => Promise<unknown>) => (await refusal(fn))?.status ?? 200;
    const stage = (content: string, scope = sAdmin) => stageImport(prisma, scope, { fileName: 'book.csv', bytes: new TextEncoder().encode(content) }, CTX);
    const fieldsOf = (columns: { column: string; field: string | null }[]) => Object.fromEntries(columns.map((c) => [c.column, c.field]));

    console.log('A first upload');
    const b1 = await stage(FILE);
    ok('not mapped yet', b1.mapped === false);
    const first = await getImportMapping(prisma, sAdmin, b1.id, CTX);
    ok('suggested from the column names', !first.saved && fieldsOf(first.columns)['Client Name'] === 'name' && fieldsOf(first.columns)['Policy #'] === 'policyNumber' && fieldsOf(first.columns)['Exp Date'] === 'expirationDate');
    ok('an unknown column is left out', fieldsOf(first.columns)['Shop Colour'] === null);
    ok('nothing saved by looking', (await prisma.importBatch.findUniqueOrThrow({ where: { id: b1.id } })).columnMapping === null && !(await prisma.importColumnMemory.findUnique({ where: { agencyId: A.id } })));

    console.log('Saving');
    const chosen = { name: 'Client Name', policyNumber: 'Policy #', industry: 'Shop Colour' };
    const savedBatch = await saveImportMapping(prisma, sAdmin, b1.id, { mapping: chosen, version: first.version }, CTX);
    ok('saved on the import', savedBatch.mapped && JSON.stringify((await prisma.importBatch.findUniqueOrThrow({ where: { id: b1.id } })).columnMapping) === JSON.stringify(chosen));
    const again = await getImportMapping(prisma, sAdmin, b1.id, CTX);
    ok('and comes back as saved', again.saved && again.columns.find((c) => c.column === 'Shop Colour')?.field === 'industry' && again.columns.find((c) => c.column === 'Shop Colour')?.source === 'saved');
    ok('the turned-down suggestion stays out', again.columns.find((c) => c.column === 'Exp Date')?.field === null);
    const log = await prisma.deskAuditLog.findFirst({ where: { action: 'import.mapped', entityId: b1.id } });
    ok('logged with field names, not the file\'s text', !!log && log.ipAddress === CTX.ip && log.agencyId === A.id && JSON.stringify(log.metadata).includes('policyNumber') && !JSON.stringify(log.metadata).includes('Shop Colour') && !JSON.stringify(log.metadata).includes('Client Name'));
    ok('rows are untouched', await prisma.importRow.count({ where: { batchId: b1.id, status: 'PENDING' } }) === 3);
    ok('nothing reaches the book', await prisma.insuredAccount.count({ where: { agencyId: A.id } }) === 0);

    console.log('The next upload');
    const b2 = await stage(FILE);
    const next = await getImportMapping(prisma, sAdmin, b2.id, CTX);
    ok('starts from what was chosen', !next.saved && fieldsOf(next.columns)['Shop Colour'] === 'industry' && next.columns.find((c) => c.column === 'Shop Colour')?.source === 'remembered');
    ok('including what was turned down', fieldsOf(next.columns)['Exp Date'] === null);
    const reordered = await stage('Shop Colour,client name,Policy #,Exp Date\nRed,Acme,P1,2027-01-01\n');
    const reorderedMap = await getImportMapping(prisma, sAdmin, reordered.id, CTX);
    ok('columns can move, and case can change', fieldsOf(reorderedMap.columns)['client name'] === 'name' && fieldsOf(reorderedMap.columns)['Shop Colour'] === 'industry');
    await discardImport(prisma, sAdmin, b2.id, CTX);
    ok('discarding keeps what was learned', !!(await prisma.importColumnMemory.findUnique({ where: { agencyId: A.id } })));
    await discardImport(prisma, sAdmin, reordered.id, CTX);
    const bB = await stage(FILE, sB);
    ok('another agency doesn\'t get it', fieldsOf((await getImportMapping(prisma, sB, bB.id, CTX)).columns)['Shop Colour'] === null);
    await discardImport(prisma, sB, bB.id, CTX);
    const corrected = await stage(FILE);
    const correctedMap = await getImportMapping(prisma, sAdmin, corrected.id, CTX);
    await saveImportMapping(prisma, sAdmin, corrected.id, { mapping: { name: 'Client Name', policyNumber: 'Policy #', description: 'Shop Colour' }, version: correctedMap.version }, CTX);
    await discardImport(prisma, sAdmin, corrected.id, CTX);
    const afterCorrection = await stage(FILE);
    const afterCorrectionMap = await getImportMapping(prisma, sAdmin, afterCorrection.id, CTX);
    ok('a corrected choice replaces the old one next time', fieldsOf(afterCorrectionMap.columns)['Shop Colour'] === 'description' && fieldsOf(afterCorrectionMap.columns)['Client Name'] === 'name');
    await discardImport(prisma, sAdmin, afterCorrection.id, CTX);

    console.log('Credentials and file text');
    const creds = await stage('Name,Carrier Password\nAcme,hunter2\n');
    const credMap = await getImportMapping(prisma, sAdmin, creds.id, CTX);
    await saveImportMapping(prisma, sAdmin, creds.id, { mapping: { name: 'Name', notes: 'Column B' }, version: credMap.version }, CTX);
    const stored = JSON.stringify((await prisma.importColumnMemory.findUniqueOrThrow({ where: { agencyId: A.id } })).columns);
    ok('a password column\'s name and values aren\'t remembered', !/password|hunter2|column b/i.test(stored));
    await discardImport(prisma, sAdmin, creds.id, CTX);
    const oddNames = await stage('__proto__,$where,constructor\nAcme,x,y\n');
    const oddMap = await getImportMapping(prisma, sAdmin, oddNames.id, CTX);
    ok('odd column names are offered', oddMap.columns.length === 3 && oddMap.columns.every((c) => c.field === null));
    await saveImportMapping(prisma, sAdmin, oddNames.id, { mapping: { name: '__proto__', dba: '$where' }, version: oddMap.version }, CTX);
    ok('and map like any other', JSON.stringify((await prisma.importBatch.findUniqueOrThrow({ where: { id: oddNames.id } })).columnMapping) === '{"name":"__proto__","dba":"$where"}');
    await discardImport(prisma, sAdmin, oddNames.id, CTX);

    console.log('Refusals');
    const bad = await refusal(() => saveImportMapping(prisma, sAdmin, b1.id, { mapping: { policyNumber: 'Policy #' } }, CTX));
    ok('no named insured: says so', bad?.status === 400 && bad.code === 'INVALID_MAPPING' && bad.message.includes('named insured'));
    ok('a column from elsewhere', (await refusal(() => saveImportMapping(prisma, sAdmin, b1.id, { mapping: { name: 'Nope' } }, CTX)))?.code === 'INVALID_MAPPING');
    ok('no mapping', (await refusal(() => saveImportMapping(prisma, sAdmin, b1.id, {}, CTX)))?.code === 'INVALID_MAPPING');
    ok('and the saved one stands', JSON.stringify((await prisma.importBatch.findUniqueOrThrow({ where: { id: b1.id } })).columnMapping) === JSON.stringify(chosen));
    const out = await refusal(() => saveImportMapping(prisma, sAdmin, b1.id, { mapping: chosen, version: first.version }, CTX));
    ok('an out-of-date screen is refused', out?.status === 409 && out.code === 'CHANGED_ELSEWHERE');
    const committed = await stage(FILE);
    await prisma.importBatch.update({ where: { id: committed.id }, data: { status: 'COMMITTED' } });
    ok('a committed import can\'t be remapped', (await refusal(() => saveImportMapping(prisma, sAdmin, committed.id, { mapping: chosen }, CTX)))?.code === 'NOT_STAGED');
    ok('nor have its mapping asked for', (await refusal(() => getImportMapping(prisma, sAdmin, committed.id, CTX)))?.code === 'NOT_STAGED');
    await prisma.importBatch.update({ where: { id: committed.id }, data: { status: 'STAGED' } });
    await discardImport(prisma, sAdmin, committed.id, CTX);

    console.log('Who may map');
    const asked = () => saveImportMapping(prisma, sAdmin, b1.id, { mapping: chosen }, CTX);
    await asked();
    const before = JSON.stringify((await prisma.importBatch.findUniqueOrThrow({ where: { id: b1.id } })).columnMapping);
    for (const [name, scope] of [['a Producer', sProducer], ['another agency\'s admin', sB], ['its Account Manager', sAm], ['a VA', sVa]] as const) {
      ok(`${name}: can't read it`, await status(() => getImportMapping(prisma, scope, b1.id, CTX)) === 404);
      ok(`${name}: can't save`, await status(() => saveImportMapping(prisma, scope, b1.id, { mapping: { name: 'Exp Date' } }, CTX)) === 404);
    }
    ok('none of them changed it', JSON.stringify((await prisma.importBatch.findUniqueOrThrow({ where: { id: b1.id } })).columnMapping) === before);
    const denied = await prisma.deskAuditLog.count({ where: { action: 'access.denied', actorId: { in: [producer.id, adminB.id, am.id, va.id] }, entityId: b1.id } });
    ok('each is logged', denied === 8);
    ok('an Insurigence admin can', (await saveImportMapping(prisma, sOps, b1.id, { mapping: chosen }, CTX)).mapped);
    ok('a malformed id: 404', await status(() => getImportMapping(prisma, sAdmin, 'nope', CTX)) === 404);

    console.log('Changing the header row');
    const v = await setImportHeaderRow(prisma, sAdmin, b1.id, { headerRow: 2 }, CTX);
    ok('clears the choice', v.mapped === false);
    const afterHeader = await getImportMapping(prisma, sAdmin, b1.id, CTX);
    ok('the new names are offered', !afterHeader.saved && afterHeader.columns.map((c) => c.column).join() === 'Acme,P1,2027-01-01,Red');
    await setImportHeaderRow(prisma, sAdmin, b1.id, { headerRow: 0 }, CTX);
    const letters = await getImportMapping(prisma, sAdmin, b1.id, CTX);
    ok('no names: by letter, nothing suggested', letters.columns.map((c) => c.column).join() === 'Column A,Column B,Column C,Column D' && letters.columns.every((c) => c.field === null));
    const vague = await stage(VAGUE);
    ok('a file it couldn\'t be sure about says so', vague.headerConfident === false);
    await discardImport(prisma, sAdmin, vague.id, CTX);

    console.log('Changes crossing');
    const raced = await stage(FILE);
    const racedMap = await getImportMapping(prisma, sAdmin, raced.id, CTX);
    const racing = new Proxy(prisma, { get(target, key) {
      if (key === 'importColumnMemory') return target.importColumnMemory;
      if (key === '$transaction') return async (work: never, options: never) => {
        await prisma.importBatch.update({ where: { id: raced.id }, data: { columnMapping: { name: 'Exp Date' } } });
        return target.$transaction(work, options);
      };
      const value = Reflect.get(target, key);
      return typeof value === 'function' ? value.bind(target) : value;
    } }) as PrismaClient;
    const overtaken = await refusal(() => saveImportMapping(racing, sAdmin, raced.id, { mapping: chosen, version: racedMap.version }, CTX));
    ok('a change landing after the check is refused', overtaken?.status === 409 && overtaken.code === 'CHANGED_ELSEWHERE');
    ok('and theirs stands', JSON.stringify((await prisma.importBatch.findUniqueOrThrow({ where: { id: raced.id } })).columnMapping) === '{"name":"Exp Date"}');
    const conflicted = (code: string) => new Proxy(prisma, { get(target, key) {
      if (key === '$transaction') return async () => { throw new Prisma.PrismaClientKnownRequestError('write conflict', { code, clientVersion: 'test' }); };
      const value = Reflect.get(target, key);
      return typeof value === 'function' ? value.bind(target) : value;
    } }) as PrismaClient;
    const fresh = await getImportMapping(prisma, sAdmin, raced.id, CTX);
    for (const code of ['P2034', 'P2002']) {
      ok(`${code} saving: 409, not a server error`, (await refusal(() => saveImportMapping(conflicted(code), sAdmin, raced.id, { mapping: chosen, version: fresh.version }, CTX)))?.code === 'CHANGED_ELSEWHERE');
    }
    ok('P2034 changing the header row: 409', (await refusal(() => setImportHeaderRow(conflicted('P2034'), sAdmin, raced.id, { headerRow: 2 }, CTX)))?.code === 'CHANGED_ELSEWHERE');
    ok('P2034 discarding: 409', (await refusal(() => discardImport(conflicted('P2034'), sAdmin, raced.id, CTX)))?.code === 'CHANGED_ELSEWHERE');
    let other = '';
    const broken = new Proxy(prisma, { get(target, key) {
      if (key === '$transaction') return async () => { throw new Error('database down'); };
      const value = Reflect.get(target, key);
      return typeof value === 'function' ? value.bind(target) : value;
    } }) as PrismaClient;
    try { await saveImportMapping(broken, sAdmin, raced.id, { mapping: chosen }, CTX); } catch (e) { other = (e as Error).message; }
    ok('other failures aren\'t dressed up as a conflict', other === 'database down');
    const logFails = new Proxy(prisma, { get(target, key) {
      if (key === '$transaction') return (work: (tx: unknown) => Promise<unknown>, options: never) => target.$transaction((tx) => work(new Proxy(tx, { get(t, k) {
        if (k === 'deskAuditLog') return { create: async () => { throw new Error('log unavailable'); } };
        return Reflect.get(t, k);
      } })), options);
      const value = Reflect.get(target, key);
      return typeof value === 'function' ? value.bind(target) : value;
    } }) as PrismaClient;
    const beforeLogFail = JSON.stringify((await prisma.importBatch.findUniqueOrThrow({ where: { id: raced.id } })).columnMapping);
    other = '';
    try { await saveImportMapping(logFails, sAdmin, raced.id, { mapping: chosen }, CTX); } catch (e) { other = (e as Error).message; }
    ok('a choice that can\'t be logged isn\'t saved', other === 'log unavailable' && JSON.stringify((await prisma.importBatch.findUniqueOrThrow({ where: { id: raced.id } })).columnMapping) === beforeLogFail);
    await discardImport(prisma, sAdmin, raced.id, CTX);

    console.log('Over HTTP');
    const b3 = await stage(FILE);
    const [tAdmin, tProducer, tB] = await Promise.all([admin, producer, adminB].map((u) => createSession(u.id)));
    const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
    const req = (token: string | null, method = 'GET', body?: unknown) => new NextRequest(`http://local.test/api/desk/imports/${b3.id}/mapping`, {
      method, headers: { ...(token ? { cookie: `session_token=${token}` } : {}), 'content-type': 'application/json' }, ...(body !== undefined ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}),
    });
    const got = await mappingRoute(req(tAdmin), ctx(b3.id));
    const gotBody = await got.json();
    ok('reading it', got.status === 200 && gotBody.columns.length === 4 && typeof gotBody.version === 'string');
    const put = await saveRoute(req(tAdmin, 'PUT', { mapping: { name: 'Client Name' }, version: gotBody.version }), ctx(b3.id));
    ok('saving it', put.status === 200 && (await put.json()).mapped === true);
    const invalid = await saveRoute(req(tAdmin, 'PUT', { mapping: { dba: 'Client Name' } }), ctx(b3.id));
    ok('a bad one: 400 with its code', invalid.status === 400 && (await invalid.json()).code === 'INVALID_MAPPING');
    ok('not JSON: 400', (await saveRoute(req(tAdmin, 'PUT', 'nonsense'), ctx(b3.id))).status === 400);
    ok('a list: 400', (await saveRoute(req(tAdmin, 'PUT', []), ctx(b3.id))).status === 400);
    ok('a Producer: 404', (await mappingRoute(req(tProducer), ctx(b3.id))).status === 404);
    ok('another agency: 404', (await saveRoute(req(tB, 'PUT', { mapping: { name: 'Client Name' } }), ctx(b3.id))).status === 404);
    ok('not signed in: 401', (await mappingRoute(req(null), ctx(b3.id))).status === 401);
  } catch (err) {
    console.error(err);
    fail++;
  } finally {
    const agencyId = { in: cleanup.agencyIds };
    await (async () => {
      await prisma.importRow.deleteMany({ where: { agencyId } });
      await prisma.importBatch.deleteMany({ where: { agencyId } });
      await prisma.importColumnMemory.deleteMany({ where: { agencyId } });
      await prisma.agencyDeskAssignment.deleteMany({ where: { agencyId } });
      await prisma.deskAuditLog.deleteMany({ where: { OR: [{ agencyId }, { actorId: { in: cleanup.userIds } }] } });
      await prisma.session.deleteMany({ where: { userId: { in: cleanup.userIds } } });
      await prisma.user.deleteMany({ where: { id: { in: cleanup.userIds } } });
      await prisma.agency.deleteMany({ where: { id: agencyId } });
    })().catch((err) => { console.error('cleanup failed', err); fail++; });
    ok('no memory touched outside the test agencies', await prisma.importColumnMemory.count() === memoryElsewhere);
    console.log(`\n${pass} passed, ${fail} failed`);
    await prisma.$disconnect();
    process.exit(fail ? 1 : 0);
  }
})();
