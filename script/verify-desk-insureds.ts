/**
 * The Desk, Module 20: insured accounts API.
 *
 * What each role can list, read and change across two agencies; field rules;
 * duplicates; policies; staff assignments; need-to-know for VAs; deactivation;
 * simultaneous saves; and the real route handlers with signed-in requests.
 * Uses temporary agencies and users only, so nothing here can reach real data.
 * Run with:  npx tsx script/verify-desk-insureds.ts
 */
import 'dotenv/config';
import { NextRequest } from 'next/server';
import type { UserRole } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { createSession } from '../lib/auth';
import { DeskAccessError, resolveDeskScope } from '../lib/desk/access';
import {
  addPolicy, assignInsuredStaff, createInsured, getInsured, listInsureds, removePolicy, unassignInsuredStaff, updateInsured, updatePolicy,
} from '../lib/desk/book';
import { createTask } from '../lib/desk/tasks';
import { GET as listRoute, POST as createRoute } from '../app/api/desk/insureds/route';
import { GET as readRoute, PATCH as updateRoute } from '../app/api/desk/insureds/[id]/route';
import { POST as policyRoute } from '../app/api/desk/insureds/[id]/policies/route';
import { PUT as assignRoute, DELETE as unassignRoute } from '../app/api/desk/insureds/[id]/assignments/route';
import { PATCH as policyPatchRoute, DELETE as policyDeleteRoute } from '../app/api/desk/policies/[id]/route';

let pass = 0, fail = 0;
const ok = (n: string, c: boolean) => { c ? pass++ : fail++; console.log(`  ${c ? '✓' : '✗'} ${n}`); };

const TAG = `m20test-${Date.now()}`;
const cleanup = { agencyIds: [] as string[], userIds: [] as string[], podIds: [] as string[] };
let ref = 990_000_000 + Math.floor(Math.random() * 1_000_000);

async function wipe() {
  const agencyId = { in: cleanup.agencyIds };
  await prisma.taskEvent.deleteMany({ where: { agencyId } });
  await prisma.task.deleteMany({ where: { agencyId } });
  await prisma.policy.deleteMany({ where: { agencyId } });
  await prisma.insuredAssignment.deleteMany({ where: { agencyId } });
  await prisma.insuredAccount.deleteMany({ where: { agencyId } });
  await prisma.agencyPodAccess.deleteMany({ where: { agencyId } });
  await prisma.podMember.deleteMany({ where: { podId: { in: cleanup.podIds } } });
  await prisma.pod.deleteMany({ where: { id: { in: cleanup.podIds } } });
  await prisma.agencyDeskAssignment.deleteMany({ where: { agencyId } });
  await prisma.deskAuditLog.deleteMany({ where: { OR: [{ agencyId }, { actorId: { in: cleanup.userIds } }] } });
  await prisma.session.deleteMany({ where: { userId: { in: cleanup.userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: cleanup.userIds } } });
  await prisma.agency.deleteMany({ where: { id: agencyId } });
}

(async () => {
  try {
    const mkAgency = async (n: string, deskEnabled = true) => {
      const a = await prisma.agency.create({ data: { name: `${TAG} ${n}`, deskEnabled } });
      cleanup.agencyIds.push(a.id); return a;
    };
    const mkUser = async (n: string, role: UserRole, agencyId: string | null = null, extra: object = {}) => {
      const u = await prisma.user.create({ data: { email: `${TAG}-${n}@example.test`, role, agencyId, firstName: n, passwordHash: 'x', mustChangePassword: false, ...extra } });
      cleanup.userIds.push(u.id); return u;
    };
    const A = await mkAgency('A');
    const B = await mkAgency('B');
    const Off = await mkAgency('Off', false);
    const adminA = await mkUser('admin-a', 'ADMIN', A.id);
    const producer = await mkUser('producer', 'AGENT', A.id);
    const producerAll = await mkUser('producer-all', 'AGENT', A.id, { bookAccess: 'ALL' });
    const csr = await mkUser('csr', 'CSR', A.id);
    const goneUser = await mkUser('gone', 'AGENT', A.id, { isActive: false });
    const adminB = await mkUser('admin-b', 'ADMIN', B.id);
    const adminOff = await mkUser('admin-off', 'ADMIN', Off.id);
    const am = await mkUser('am', 'ACCOUNT_MANAGER');
    const ops = await mkUser('ops', 'DESK_ADMIN');
    const va = await mkUser('va', 'DESK_VA');
    await prisma.agencyDeskAssignment.create({ data: { agencyId: A.id, primaryAmId: am.id } });
    const pod = await prisma.pod.create({ data: { code: `${TAG}-POD`, name: `${TAG} Pod` } }); cleanup.podIds.push(pod.id);
    await prisma.podMember.create({ data: { podId: pod.id, userId: va.id } });
    await prisma.agencyPodAccess.create({ data: { agencyId: A.id, podId: pod.id } });

    const scopeOf = (id: string) => resolveDeskScope(prisma, id);
    const sAdmin = await scopeOf(adminA.id);
    const sProducer = await scopeOf(producer.id);
    const sAll = await scopeOf(producerAll.id);
    const sCsr = await scopeOf(csr.id);
    const sB = await scopeOf(adminB.id);
    const sAm = await scopeOf(am.id);
    const sOps = await scopeOf(ops.id);
    const sVa = await scopeOf(va.id);
    const CTX = { ip: '203.0.113.4', userAgent: 'verify' };

    const status = async (fn: () => Promise<unknown>) => {
      try { await fn(); return 200; } catch (e) { if (e instanceof DeskAccessError) return e.status; throw e; }
    };
    const message = async (fn: () => Promise<unknown>) => {
      try { await fn(); return ''; } catch (e) { if (e instanceof DeskAccessError) return e.message; throw e; }
    };
    const audited = (action: string, entityId: string) => prisma.deskAuditLog.count({ where: { action, entityId } });
    const names = async (scope: typeof sAdmin, opts: object = {}) => (await listInsureds(prisma, scope, { q: TAG, pageSize: 100, ...opts })).insureds.map((i) => i.name).sort();

    console.log('Adding accounts');
    ok('name required', await status(() => createInsured(prisma, sAdmin, { name: '  ' })) === 400);
    ok('overlong name refused', await status(() => createInsured(prisma, sAdmin, { name: 'x'.repeat(201) })) === 400);
    ok('bad email refused', await status(() => createInsured(prisma, sAdmin, { name: `${TAG} x`, contactEmail: 'nope' })) === 400);
    ok('non-text field refused', await status(() => createInsured(prisma, sAdmin, { name: `${TAG} x`, city: 5 })) === 400);
    ok('password in notes refused', (await message(() => createInsured(prisma, sAdmin, { name: `${TAG} x`, notes: 'Portal password: hunter2' }))).includes('Credentials are never stored'));
    ok('password in description refused', (await message(() => createInsured(prisma, sAdmin, { name: `${TAG} x`, description: 'pwd=abc' }))).includes('Credentials'));
    const { id: acme } = await createInsured(prisma, sAdmin, {
      name: ` ${TAG} Acme Plumbing, LLC `, contactEmail: ' Owner@Acme.TEST ', city: ' Boston ', notes: 'Prefers phone.',
      // None of these may be set through this API.
      agencyId: B.id, source: 'IMPORT', nameKey: 'hacked', importBatchId: '507f1f77bcf86cd799439011', createdById: va.id, status: 'INACTIVE', id: '507f1f77bcf86cd799439012',
    }, CTX);
    const acmeRow = await prisma.insuredAccount.findUniqueOrThrow({ where: { id: acme } });
    ok('goes in the user\'s own agency, whatever the request says', acmeRow.agencyId === A.id);
    ok('fields tidied', acmeRow.name === `${TAG} Acme Plumbing, LLC` && acmeRow.contactEmail === 'owner@acme.test' && acmeRow.city === 'Boston');
    ok('protected fields not settable', acmeRow.source === 'MANUAL' && acmeRow.nameKey !== 'hacked' && !acmeRow.importBatchId && acmeRow.createdById === adminA.id && acmeRow.status === 'ACTIVE' && acmeRow.id !== '507f1f77bcf86cd799439012');
    ok('audited', await prisma.deskAuditLog.count({ where: { action: 'insured.created', entityId: acme, actorId: adminA.id, agencyId: A.id, ipAddress: CTX.ip } }) === 1);
    ok('the audit entry holds no client details', !JSON.stringify((await prisma.deskAuditLog.findFirstOrThrow({ where: { action: 'insured.created', entityId: acme } })).metadata).includes('Acme'));

    console.log('Duplicates');
    const dup = await message(() => createInsured(prisma, sAdmin, { name: `${TAG} ACME PLUMBING L.L.C.` }));
    ok('same business, written differently: refused', dup.includes('already exists'));
    const { id: acme2 } = await createInsured(prisma, sAdmin, { name: `${TAG} Acme Plumbing Inc`, allowDuplicate: true }, CTX);
    ok('can be saved when confirmed', !!acme2);
    await updateInsured(prisma, sAdmin, acme2, { status: 'INACTIVE' }, CTX);
    const { id: acme3 } = await createInsured(prisma, sAdmin, { name: `${TAG} Acme Plumbing Co`, allowDuplicate: true }, CTX);
    await updateInsured(prisma, sAdmin, acme3, { status: 'INACTIVE' }, CTX);
    ok('another agency may use the same name', await status(() => createInsured(prisma, sB, { name: `${TAG} Acme Plumbing, LLC` })) === 200);

    console.log('Who sees what');
    const { id: prodOwn } = await createInsured(prisma, sProducer, { name: `${TAG} Producer Own` }, CTX);
    const { id: other } = await createInsured(prisma, sAdmin, { name: `${TAG} Unassigned Co` }, CTX);
    ok('someone seeing assigned accounts is assigned to what they add', await prisma.insuredAssignment.count({ where: { insuredId: prodOwn, userId: producer.id, role: 'PRODUCER' } }) === 1);
    ok('a CSR gets the service role', await (async () => { const r = await createInsured(prisma, sCsr, { name: `${TAG} Csr Own` }, CTX); return prisma.insuredAssignment.count({ where: { insuredId: r.id, userId: csr.id, role: 'SERVICE' } }); })() === 1);
    ok('agency admin sees the whole book', (await names(sAdmin)).includes(`${TAG} Unassigned Co`) && (await names(sAdmin)).includes(`${TAG} Producer Own`));
    ok('producer with whole-book access too', (await names(sAll)).includes(`${TAG} Unassigned Co`));
    ok('producer sees only assigned accounts', (await names(sProducer)).join() === `${TAG} Producer Own`);
    ok('another agency sees none of it', !(await names(sB)).includes(`${TAG} Unassigned Co`));
    ok('Account Manager sees their agency', (await names(sAm)).includes(`${TAG} Unassigned Co`) && !(await names(sAm)).some((n) => n === `${TAG} Off`));
    ok('Operations Manager sees all', (await listInsureds(prisma, sOps, { q: TAG, agencyId: A.id, pageSize: 100 })).insureds.every((i) => i.agencyId === A.id));
    ok('VA with no requests sees none', (await names(sVa)).length === 0);
    ok('producer cannot read another\'s account: 404', await status(() => getInsured(prisma, sProducer, other, CTX)) === 404);
    ok('another agency: 404', await status(() => getInsured(prisma, sB, acme, CTX)) === 404);
    ok('malformed id: 404', await status(() => getInsured(prisma, sAdmin, 'nope', CTX)) === 404);
    ok('refusal is logged with the real agency', await prisma.deskAuditLog.count({ where: { action: 'access.denied', actorId: adminB.id, agencyId: A.id, entityId: acme } }) >= 1);
    ok('reads are logged', await (async () => { await getInsured(prisma, sAdmin, acme, CTX); return audited('insured.viewed', acme); })() >= 1);
    ok('another agency cannot change it: 404', await status(() => updateInsured(prisma, sB, acme, { city: 'x' })) === 404);
    ok('producer cannot change another\'s: 404', await status(() => updateInsured(prisma, sProducer, other, { city: 'x' })) === 404);
    ok('another agency cannot add a policy: 404', await status(() => addPolicy(prisma, sB, acme, { policyNumber: 'x' })) === 404);

    console.log('Staff adding accounts');
    ok('Account Manager adds to a covered agency', await status(() => createInsured(prisma, sAm, { name: `${TAG} Am Added`, agencyId: A.id })) === 200);
    ok('Account Manager cannot add to another: 404', await status(() => createInsured(prisma, sAm, { name: `${TAG} Nope`, agencyId: B.id })) === 404);
    ok('staff must name an agency', await status(() => createInsured(prisma, sOps, { name: `${TAG} Nope` })) === 400);
    ok('no accounts for an agency without The Desk', await status(() => createInsured(prisma, sOps, { name: `${TAG} Nope`, agencyId: Off.id })) === 404);
    ok('VA cannot add: 403', await status(() => createInsured(prisma, sVa, { name: `${TAG} Nope`, agencyId: A.id })) === 403);
    ok('refused VA attempt is logged', await prisma.deskAuditLog.count({ where: { action: 'access.denied', actorId: va.id } }) >= 1);
    const sOff = await scopeOf(adminOff.id);
    ok('agency without The Desk has no scope', sOff.kind === 'NONE' && await status(() => createInsured(prisma, sOff, { name: `${TAG} Nope` })) === 403);

    console.log('Search and paging');
    ok('by name, ignoring case', (await names(sAdmin, { q: `${TAG} acme` })).length === 3);
    ok('by normalised name', (await listInsureds(prisma, sAdmin, { q: `${TAG} acme plumbing l.l.c.` })).total >= 1);
    ok('by contact email', (await listInsureds(prisma, sAdmin, { q: 'owner@acme.test' })).insureds.some((i) => i.id === acme));
    ok('active only', (await names(sAdmin, { q: `${TAG} acme`, status: 'ACTIVE' })).length === 1);
    ok('inactive only', (await names(sAdmin, { q: `${TAG} acme`, status: 'INACTIVE' })).length === 2);
    ok('"my accounts" for an admin', (await names(sAdmin, { mine: true })).length === 0);
    await prisma.insuredAssignment.create({ data: { agencyId: A.id, insuredId: other, userId: adminA.id, role: 'PRODUCER' } });
    ok('"my accounts" finds an assignment', (await names(sAdmin, { mine: true })).join() === `${TAG} Unassigned Co`);
    const page1 = await listInsureds(prisma, sAdmin, { q: TAG, pageSize: 2, page: 1 });
    const page2 = await listInsureds(prisma, sAdmin, { q: TAG, pageSize: 2, page: 2 });
    ok('pages do not overlap, and report the total', page1.insureds.length === 2 && page2.insureds.length === 2 && !page1.insureds.some((i) => page2.insureds.some((j) => j.id === i.id)) && page1.total > 4);
    ok('huge page sizes are capped', (await listInsureds(prisma, sAdmin, { pageSize: 100000 })).pageSize === 100);
    ok('bad page numbers are corrected', (await listInsureds(prisma, sAdmin, { page: -5 })).page === 1);

    console.log('Editing accounts');
    const loaded = await getInsured(prisma, sAdmin, acme, CTX);
    await updateInsured(prisma, sProducer, prodOwn, { city: 'Salem' }, CTX);
    ok('producer edits their own', (await prisma.insuredAccount.findUniqueOrThrow({ where: { id: prodOwn } })).city === 'Salem');
    await updateInsured(prisma, sAdmin, acme, { version: loaded.version, city: 'Cambridge', agencyId: B.id, source: 'IMPORT', createdById: va.id }, CTX);
    const edited = await prisma.insuredAccount.findUniqueOrThrow({ where: { id: acme } });
    ok('saved; protected fields ignored', edited.city === 'Cambridge' && edited.agencyId === A.id && edited.source === 'MANUAL' && edited.createdById === adminA.id);
    const log = await prisma.deskAuditLog.findFirstOrThrow({ where: { action: 'insured.updated', entityId: acme }, orderBy: { createdAt: 'desc' } });
    ok('audit lists the field, not the value', (log.metadata as { changed: string[] }).changed.join() === 'city' && !JSON.stringify(log.metadata).includes('Cambridge'));
    const count = await audited('insured.updated', acme);
    await updateInsured(prisma, sAdmin, acme, { city: 'Cambridge' }, CTX);
    ok('no change, no entry', await audited('insured.updated', acme) === count);
    ok('clearing a field works', await (async () => { await updateInsured(prisma, sAdmin, acme, { notes: '' }, CTX); return (await prisma.insuredAccount.findUniqueOrThrow({ where: { id: acme } })).notes; })() === null);
    ok('name cannot be cleared', await status(() => updateInsured(prisma, sAdmin, acme, { name: '' })) === 400);
    ok('renaming onto another account refused', (await message(() => updateInsured(prisma, sAdmin, other, { name: `${TAG} Acme Plumbing LLC` }))).includes('already exists'));
    await updateInsured(prisma, sAdmin, other, { name: `${TAG} Unassigned Company` }, CTX);
    ok('renaming updates the search key', (await prisma.insuredAccount.findUniqueOrThrow({ where: { id: other } })).nameKey.endsWith('unassigned'));
    ok('password refused on edit', (await message(() => updateInsured(prisma, sAdmin, acme, { notes: 'api key: abc123' }))).includes('Credentials'));
    ok('an out-of-date form is refused', await status(() => updateInsured(prisma, sAdmin, acme, { version: loaded.version, city: 'Stale' })) === 409);
    const fresh = (await getInsured(prisma, sAdmin, acme, CTX)).version;
    const race = await Promise.all(['One', 'Two'].map((city) => status(() => updateInsured(prisma, sAdmin, acme, { version: fresh, city }))));
    ok('two saves at the same moment: one wins', race.sort().join() === '200,409');
    let interrupted = false;
    const interrupting = new Proxy(prisma, {
      get(target, key) {
        const value = Reflect.get(target, key);
        if (key !== 'insuredAccount') return typeof value === 'function' ? value.bind(target) : value;
        return new Proxy(target.insuredAccount, {
          get(model, method) {
            const fn = Reflect.get(model, method) as (...a: unknown[]) => Promise<unknown>;
            if (method !== 'findFirst') return typeof fn === 'function' ? fn.bind(model) : fn;
            return async (args: unknown) => {
              const row = await fn.call(model, args);
              if (!interrupted) { interrupted = true; await prisma.insuredAccount.update({ where: { id: acme }, data: { city: 'In between' } }); }
              return row;
            };
          },
        });
      },
    });
    ok('a save landing between read and write is not overwritten', await status(() => updateInsured(interrupting, sAdmin, acme, { city: 'Overwrites' })) === 409 && (await prisma.insuredAccount.findUniqueOrThrow({ where: { id: acme } })).city === 'In between');

    console.log('Policies');
    const P = (extra: object) => addPolicy(prisma, sAdmin, acme, extra, CTX);
    ok('impossible date refused', await status(() => P({ expirationDate: '2027-02-30' })) === 400);
    ok('wrong date format refused', await status(() => P({ expirationDate: '02/01/2027' })) === 400);
    ok('expiration before effective refused', await status(() => P({ effectiveDate: '2027-02-01', expirationDate: '2027-01-01' })) === 400);
    ok('negative premium refused', await status(() => P({ premiumCents: -1 })) === 400);
    ok('fractional cents refused', await status(() => P({ premiumCents: 10.5 })) === 400);
    ok('unknown status refused', await status(() => P({ status: 'NOPE' })) === 400);
    ok('password in notes refused', (await message(() => P({ notes: 'password: abc' }))).includes('Credentials'));
    const { id: p1 } = await P({ policyNumber: ' GL-100 ', lineOfBusiness: 'General Liability', carrierName: 'Hartford', effectiveDate: '2026-12-01', expirationDate: '2027-12-01', premiumCents: 250000, notes: 'Note.', agencyId: B.id, insuredId: other, createdById: va.id, carrierId: '507f1f77bcf86cd799439011' });
    const pRow = await prisma.policy.findUniqueOrThrow({ where: { id: p1 } });
    ok('saved on the right account and agency, whatever the request says', pRow.agencyId === A.id && pRow.insuredId === acme && pRow.createdById === adminA.id && !pRow.carrierId);
    ok('dates stored as plain days', pRow.expirationDate?.toISOString() === '2027-12-01T00:00:00.000Z');
    ok('audited', await prisma.deskAuditLog.count({ where: { action: 'policy.created', entityId: p1, agencyId: A.id } }) === 1);
    ok('several policies per account', await status(() => P({ policyNumber: 'WC-200', expirationDate: '2027-06-01' })) === 200);
    ok('a policy with no number is fine', await status(() => P({ lineOfBusiness: 'Auto' })) === 200);
    ok('same number on the account refused', (await message(() => P({ policyNumber: 'GL-100' }))).includes('already has'));
    ok('same number on another account is fine', await status(() => addPolicy(prisma, sAdmin, other, { policyNumber: 'GL-100' }, CTX)) === 200);
    const view = await getInsured(prisma, sAdmin, acme, CTX);
    ok('listed, soonest expiration first among dated ones', view.policies.filter((x) => x.expirationDate).map((x) => x.policyNumber).join() === 'WC-200,GL-100');
    const shown = view.policies.find((x) => x.id === p1)! as { premiumCents?: number; expirationDate: string | null };
    ok('premium is a plain number, date a plain day', shown.premiumCents === 250000 && shown.expirationDate === '2027-12-01' && JSON.stringify(view).length > 0);
    ok('search finds an account by policy number', (await listInsureds(prisma, sAdmin, { q: 'WC-200' })).insureds.some((i) => i.id === acme));
    ok('list counts its policies', (await listInsureds(prisma, sAdmin, { q: 'WC-200' })).insureds.find((i) => i.id === acme)!.policyCount === 3);

    await updatePolicy(prisma, sAdmin, p1, { status: 'CANCELLED', premiumCents: null, agencyId: B.id, insuredId: other }, CTX);
    const pAfter = await prisma.policy.findUniqueOrThrow({ where: { id: p1 } });
    ok('edited; premium cleared; cannot move account or agency', pAfter.status === 'CANCELLED' && pAfter.premiumCents === null && pAfter.insuredId === acme && pAfter.agencyId === A.id);
    const pc = await audited('policy.updated', p1);
    await updatePolicy(prisma, sAdmin, p1, { status: 'CANCELLED', expirationDate: '2027-12-01' }, CTX);
    ok('no change, no entry (including an unchanged date)', await audited('policy.updated', p1) === pc);
    ok('dates checked against the stored value', await status(() => updatePolicy(prisma, sAdmin, p1, { expirationDate: '2026-11-01' })) === 400);
    ok('renumbering onto a sibling refused', await status(() => updatePolicy(prisma, sAdmin, p1, { policyNumber: 'WC-200' })) === 409);
    ok('another agency cannot edit: 404', await status(() => updatePolicy(prisma, sB, p1, { status: 'ACTIVE' })) === 404);
    ok('producer cannot edit another\'s: 404', await status(() => updatePolicy(prisma, sProducer, p1, { status: 'ACTIVE' })) === 404);

    const renewal = await prisma.task.create({ data: { reference: ref++, agencyId: A.id, insuredId: acme, policyId: p1, podId: pod.id, type: 'RENEWAL', title: 't', status: 'NEW', source: 'INTERNAL', createdById: ops.id, restrictedToUserIds: [], dueAt: new Date('2027-09-02T21:00:00Z') } });
    ok('a policy with requests cannot be removed', (await message(() => removePolicy(prisma, sAdmin, p1))).includes('request'));
    await updatePolicy(prisma, sAdmin, p1, { expirationDate: '2028-12-01' }, CTX);
    ok('changing expiration leaves an open request\'s due date alone', (await prisma.task.findUniqueOrThrow({ where: { id: renewal.id } })).dueAt?.toISOString() === '2027-09-02T21:00:00.000Z');
    const { id: mistake } = await P({ policyNumber: 'MISTAKE' });
    ok('another agency cannot remove: 404', await status(() => removePolicy(prisma, sB, mistake)) === 404);
    await removePolicy(prisma, sAdmin, mistake, CTX);
    ok('one entered by mistake can be removed, and is logged', await prisma.policy.count({ where: { id: mistake } }) === 0 && JSON.stringify((await prisma.deskAuditLog.findFirstOrThrow({ where: { action: 'policy.removed', entityId: mistake } })).metadata).includes('MISTAKE'));

    console.log('What a VA sees');
    const seen = await getInsured(prisma, sVa, acme, CTX) as Record<string, unknown>;
    await prisma.insuredAccount.update({ where: { id: acme }, data: { notes: 'Private agency note.' } });
    const seen2 = await getInsured(prisma, sVa, acme, CTX) as Record<string, unknown> & { policies: Record<string, unknown>[]; can: { edit: boolean } };
    ok('reaches the account through a request in their pod', seen.id === acme);
    ok('no agency notes', !('notes' in seen2) && !JSON.stringify(seen2).includes('Private agency note'));
    ok('no premiums', seen2.policies.every((x) => !('premiumCents' in x)));
    ok('no policy notes', seen2.policies.every((x) => !('notes' in x)));
    ok('no staff list', !('assignments' in seen2));
    ok('no total of the account\'s requests', !('openTasks' in seen2));
    ok('told they cannot edit', seen2.can.edit === false);
    ok('only the policy on their request', seen2.policies.length === 1 && seen2.policies[0].id === p1);
    const vaList = await listInsureds(prisma, sVa, { q: TAG });
    ok('list: only that account, without staff or totals', vaList.insureds.length === 1 && !('assignments' in vaList.insureds[0]) && !('openTasks' in vaList.insureds[0]));
    ok('cannot change the account: 403', await status(() => updateInsured(prisma, sVa, acme, { city: 'x' })) === 403);
    ok('cannot add a policy: 403', await status(() => addPolicy(prisma, sVa, acme, { policyNumber: 'x' })) === 403);
    ok('cannot change a policy: 403', await status(() => updatePolicy(prisma, sVa, p1, { status: 'ACTIVE' })) === 403);
    ok('cannot remove a policy: 403', await status(() => removePolicy(prisma, sVa, p1)) === 403);
    ok('cannot assign staff: 403', await status(() => assignInsuredStaff(prisma, sVa, acme, { userId: csr.id })) === 403);
    ok('account they have no request on: 404', await status(() => getInsured(prisma, sVa, other, CTX)) === 404);
    const staffView = await getInsured(prisma, sAm, acme, CTX) as Record<string, unknown> & { policies: Record<string, unknown>[] };
    ok('Account Manager does see notes and premiums', staffView.notes === 'Private agency note.' && staffView.policies.some((x) => 'premiumCents' in x));

    console.log('Assigning staff');
    const assign = (scope: typeof sAdmin, userId: unknown, role?: unknown) => assignInsuredStaff(prisma, scope, acme, { userId, role }, CTX);
    ok('producer cannot assign: 403', await status(() => assign(sAll, csr.id)) === 403);
    ok('CSR not on the account cannot even see it: 404', await status(() => assign(sCsr, csr.id)) === 404);
    const csrOwn = await prisma.insuredAccount.findFirstOrThrow({ where: { name: `${TAG} Csr Own` } });
    ok('CSR on their own account still cannot assign: 403', await status(() => assignInsuredStaff(prisma, sCsr, csrOwn.id, { userId: producer.id }, CTX)) === 403);
    ok('refusal is logged', await prisma.deskAuditLog.count({ where: { action: 'access.denied', actorId: producerAll.id, agencyId: A.id } }) >= 1);
    ok('another agency\'s user refused', await status(() => assign(sAdmin, adminB.id)) === 400);
    ok('Desk staff refused', await status(() => assign(sAdmin, am.id)) === 400);
    ok('inactive user refused', await status(() => assign(sAdmin, goneUser.id)) === 400);
    ok('unknown user refused', await status(() => assign(sAdmin, '507f1f77bcf86cd799439011')) === 400);
    ok('malformed user refused', await status(() => assign(sAdmin, 'nope')) === 400);
    ok('unknown role refused', await status(() => assign(sAdmin, csr.id, 'BOSS')) === 400);
    ok('same message for another agency\'s user as for nobody', await message(() => assign(sAdmin, adminB.id)) === await message(() => assign(sAdmin, '507f1f77bcf86cd799439011')));
    await assign(sAdmin, producer.id);
    ok('assigned, with the default role', await prisma.insuredAssignment.count({ where: { insuredId: acme, userId: producer.id, role: 'PRODUCER' } }) === 1);
    ok('they can now see it', await status(() => getInsured(prisma, sProducer, acme, CTX)) === 200);
    ok('it is on "my accounts"', (await listInsureds(prisma, sProducer, { mine: true, q: TAG })).insureds.some((i) => i.id === acme));
    await assign(sAdmin, producer.id, 'SERVICE');
    ok('role can be changed, one record kept', await prisma.insuredAssignment.count({ where: { insuredId: acme, userId: producer.id } }) === 1 && await prisma.insuredAssignment.count({ where: { insuredId: acme, userId: producer.id, role: 'SERVICE' } }) === 1);
    const ac = await audited('insured.assigned', acme);
    await assign(sAdmin, producer.id, 'SERVICE');
    ok('same again: no entry', await audited('insured.assigned', acme) === ac);
    ok('several people on one account', await status(() => assign(sAm, csr.id)) === 200 && (await getInsured(prisma, sAdmin, acme, CTX) as { assignments: unknown[] }).assignments.length === 2);
    ok('producer cannot remove: 403', await status(() => unassignInsuredStaff(prisma, sProducer, acme, csr.id)) === 403);
    await unassignInsuredStaff(prisma, sAdmin, acme, producer.id, CTX);
    ok('removed: they lose sight of it at once', await status(() => getInsured(prisma, sProducer, acme, CTX)) === 404);
    ok('removing again refused', await status(() => unassignInsuredStaff(prisma, sAdmin, acme, producer.id)) === 409);
    ok('malformed user refused', await status(() => unassignInsuredStaff(prisma, sAdmin, acme, 'nope')) === 400);

    console.log('Deactivating');
    ok('producer cannot deactivate: 403', await status(() => updateInsured(prisma, sProducer, prodOwn, { status: 'INACTIVE' })) === 403);
    ok('unknown status refused', await status(() => updateInsured(prisma, sAdmin, prodOwn, { status: 'GONE' })) === 400);
    ok('refused while requests are open, with the count', (await message(() => updateInsured(prisma, sAdmin, acme, { status: 'INACTIVE' }))).includes('1 open request'));
    await prisma.task.update({ where: { id: renewal.id }, data: { status: 'COMPLETED', completedAt: new Date(), billingClass: 'NON_BILLABLE' } });
    await updateInsured(prisma, sAm, acme, { status: 'INACTIVE' }, CTX);
    ok('Account Manager can deactivate once none are open', (await prisma.insuredAccount.findUniqueOrThrow({ where: { id: acme } })).status === 'INACTIVE');
    ok('its history stays readable', await status(() => getInsured(prisma, sAdmin, acme, CTX)) === 200);
    ok('no new request on an inactive account', (await message(() => createTask(prisma, sAdmin, { type: 'COI', title: 'x', insuredId: acme }, CTX))).includes('inactive'));
    ok('nor through one of its policies', (await message(() => createTask(prisma, sAdmin, { type: 'COI', title: 'x', policyId: p1 }, CTX))).includes('inactive'));
    await updateInsured(prisma, sAdmin, acme, { status: 'ACTIVE' }, CTX);
    ok('reactivated: requests work again', await status(() => createTask(prisma, sAdmin, { type: 'COI', title: 'x', insuredId: acme }, CTX)) === 200);

    console.log('The real routes, with signed-in requests');
    const session = async (id: string) => createSession(id);
    const [tAdmin, tProducer, tVa, tOff, tB] = await Promise.all([session(adminA.id), session(producer.id), session(va.id), session(adminOff.id), session(adminB.id)]);
    const req = (path: string, method = 'GET', token?: string, body?: unknown) => new NextRequest(`http://localhost${path}`, {
      method, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
      headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.99', ...(token ? { cookie: `session_token=${token}` } : {}) },
    });
    const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
    ok('not signed in: 401', (await listRoute(req('/api/desk/insureds'))).status === 401);
    ok('no session on a write: 401', (await createRoute(req('/api/desk/insureds', 'POST', undefined, { name: 'x' }))).status === 401);
    ok('agency without The Desk: 403', (await listRoute(req('/api/desk/insureds', 'GET', tOff))).status === 403);
    const listed = await listRoute(req(`/api/desk/insureds?q=${TAG}&status=ACTIVE&pageSize=2&page=1`, 'GET', tAdmin));
    const listedJson = await listed.json();
    ok('list: paged, with the total', listed.status === 200 && listedJson.insureds.length === 2 && listedJson.pageSize === 2 && listedJson.total > 2);
    const mine = await (await listRoute(req(`/api/desk/insureds?q=${TAG}&mine=1`, 'GET', tProducer))).json();
    ok('list: "my accounts" from the address', mine.insureds.every((i: { assignments: { userId: string }[] }) => i.assignments.some((a) => a.userId === producer.id)));
    const made = await createRoute(req('/api/desk/insureds', 'POST', tAdmin, { name: `${TAG} Via Route`, agencyId: B.id }));
    const madeJson = await made.json();
    ok('create: 201, in their own agency', made.status === 201 && (await prisma.insuredAccount.findUniqueOrThrow({ where: { id: madeJson.id } })).agencyId === A.id);
    ok('the request\'s IP reaches the log', await prisma.deskAuditLog.count({ where: { action: 'insured.created', entityId: madeJson.id, ipAddress: '203.0.113.99' } }) === 1);
    ok('bad JSON: 400', (await createRoute(req('/api/desk/insureds', 'POST', tAdmin, 'not json'))).status === 400);
    ok('a list as the body: 400', (await createRoute(req('/api/desk/insureds', 'POST', tAdmin, []))).status === 400);
    const rd = await readRoute(req(`/api/desk/insureds/${madeJson.id}`, 'GET', tAdmin), ctx(madeJson.id));
    const rdJson = await rd.json();
    ok('read: JSON with a version, internal fields left out', rd.status === 200 && !!rdJson.version && !('nameKey' in rdJson) && !('importBatchId' in rdJson));
    ok('read by another agency: 404, saying only "Not found"', await (async () => { const r = await readRoute(req(`/api/desk/insureds/${madeJson.id}`, 'GET', tB), ctx(madeJson.id)); return r.status === 404 && (await r.json()).error === 'Not found'; })());
    const up = await updateRoute(req(`/api/desk/insureds/${madeJson.id}`, 'PATCH', tAdmin, { version: rdJson.version, city: 'Lowell' }), ctx(madeJson.id));
    ok('update: returns the saved account', up.status === 200 && (await up.json()).city === 'Lowell');
    ok('update with an old version: 409', (await updateRoute(req(`/api/desk/insureds/${madeJson.id}`, 'PATCH', tAdmin, { version: rdJson.version, city: 'Stale' }), ctx(madeJson.id))).status === 409);
    ok('VA update: 403 or 404, never saved', [403, 404].includes((await updateRoute(req(`/api/desk/insureds/${madeJson.id}`, 'PATCH', tVa, { city: 'Va' }), ctx(madeJson.id))).status));
    const pol = await policyRoute(req(`/api/desk/insureds/${madeJson.id}/policies`, 'POST', tAdmin, { policyNumber: 'R-1', premiumCents: 500 }), ctx(madeJson.id));
    const polJson = await pol.json();
    ok('policy created', pol.status === 201 && !!polJson.id);
    ok('policy on another agency\'s account: 404', (await policyRoute(req(`/api/desk/insureds/${madeJson.id}/policies`, 'POST', tB, { policyNumber: 'R-2' }), ctx(madeJson.id))).status === 404);
    ok('policy edited', (await policyPatchRoute(req(`/api/desk/policies/${polJson.id}`, 'PATCH', tAdmin, { status: 'PENDING' }), ctx(polJson.id))).status === 200);
    ok('policy removed', (await policyDeleteRoute(req(`/api/desk/policies/${polJson.id}`, 'DELETE', tAdmin), ctx(polJson.id))).status === 200);
    ok('assign through the route', (await assignRoute(req(`/api/desk/insureds/${madeJson.id}/assignments`, 'PUT', tAdmin, { userId: csr.id }), ctx(madeJson.id))).status === 200);
    ok('producer assign: 404 (cannot see it)', (await assignRoute(req(`/api/desk/insureds/${madeJson.id}/assignments`, 'PUT', tProducer, { userId: csr.id }), ctx(madeJson.id))).status === 404);
    ok('unassign through the route', (await unassignRoute(req(`/api/desk/insureds/${madeJson.id}/assignments?userId=${csr.id}`, 'DELETE', tAdmin), ctx(madeJson.id))).status === 200);
  } catch (e) {
    fail++;
    console.error(e);
  } finally {
    await wipe();
    const left = await prisma.user.count({ where: { email: { startsWith: TAG } } }) + await prisma.agency.count({ where: { id: { in: cleanup.agencyIds } } }) + await prisma.pod.count({ where: { id: { in: cleanup.podIds } } }) + await prisma.insuredAccount.count({ where: { agencyId: { in: cleanup.agencyIds } } });
    ok('temporary records removed', left === 0);
    console.log(`\n${pass} passed, ${fail} failed`);
    await prisma.$disconnect();
    process.exit(fail ? 1 : 0);
  }
})();
