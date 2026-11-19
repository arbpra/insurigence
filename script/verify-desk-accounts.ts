/**
 * The Desk, Module 21: Agency Portal account list and form.
 *
 * The form and filter logic, what the list API does with what those screens
 * send, the refusal codes they respond to, and that browser code imports nothing
 * from the server. Uses temporary agencies and users only.
 * Run with:  npx tsx script/verify-desk-accounts.ts
 */
import 'dotenv/config';
import { readFileSync } from 'fs';
import { NextRequest } from 'next/server';
import type { UserRole } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { createSession } from '../lib/auth';
import { DeskAccessError, resolveDeskScope } from '../lib/desk/access';
import {
  ACCOUNT_FORM_KEYS, ACCOUNTS_PAGE_SIZE, INSURED_TEXT, accountApiQuery, accountPageQuery, accountRangeLabel, changedAccountFields,
  formFromAccount, hasAccountFilters, lastAccountPage, newAccountPayload, parseAccountFilters,
} from '../lib/desk/account-form';
import { listDeskAgencies } from '../lib/desk/agency-setup';
import { createInsured, getInsured, listInsureds, updateInsured } from '../lib/desk/book';
import { literal } from '../lib/desk/literal-match';
import { createPod } from '../lib/desk/pod-admin';
import { listStaff } from '../lib/desk/staff';
import { GET as listRoute, POST as createRoute } from '../app/api/desk/insureds/route';
import { PATCH as updateRoute } from '../app/api/desk/insureds/[id]/route';

let pass = 0, fail = 0;
const ok = (n: string, c: boolean) => { c ? pass++ : fail++; console.log(`  ${c ? '✓' : '✗'} ${n}`); };

const TAG = `m21test-${Date.now()}`;
const cleanup = { agencyIds: [] as string[], userIds: [] as string[], podIds: [] as string[] };
let ref = 991_000_000 + Math.floor(Math.random() * 1_000_000);

async function wipe() {
  const agencyId = { in: cleanup.agencyIds };
  await prisma.taskEvent.deleteMany({ where: { agencyId } });
  await prisma.task.updateMany({ where: { agencyId }, data: { parentTaskId: null } });
  await prisma.task.deleteMany({ where: { agencyId } });
  await prisma.policy.deleteMany({ where: { agencyId } });
  await prisma.insuredAssignment.deleteMany({ where: { agencyId } });
  await prisma.insuredAccount.deleteMany({ where: { agencyId } });
  await prisma.agencyPodAccess.deleteMany({ where: { agencyId } });
  await prisma.podMember.deleteMany({ where: { podId: { in: cleanup.podIds } } });
  await prisma.pod.deleteMany({ where: { id: { in: cleanup.podIds } } });
  await prisma.deskAuditLog.deleteMany({ where: { OR: [{ agencyId }, { actorId: { in: cleanup.userIds } }] } });
  await prisma.session.deleteMany({ where: { userId: { in: cleanup.userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: cleanup.userIds } } });
  await prisma.agency.deleteMany({ where: { id: agencyId } });
}

const params = (s: string) => new URLSearchParams(s);

function pureLogic() {
  console.log('The form');
  const blank = formFromAccount();
  ok('a new form has every field, empty', ACCOUNT_FORM_KEYS.every((k) => blank[k] === ''));
  const saved = formFromAccount({ name: 'Acme', city: null, contactEmail: 'A@Example.test', notes: 'n' });
  ok('stored nulls become empty fields', saved.city === '' && saved.name === 'Acme');
  ok('a new account sends only what was filled in, trimmed', JSON.stringify(newAccountPayload({ ...blank, name: ' Acme ', city: '   ', state: 'MA' })) === '{"name":"Acme","state":"MA"}');
  ok('nothing changed: nothing sent', Object.keys(changedAccountFields(saved, saved)).length === 0);
  ok('spaces alone are not a change', Object.keys(changedAccountFields({ ...saved, name: ' Acme ' }, saved)).length === 0);
  ok('one change: only that field', JSON.stringify(changedAccountFields({ ...saved, city: 'Boston' }, saved)) === '{"city":"Boston"}');
  ok('a cleared field is sent as null', JSON.stringify(changedAccountFields({ ...saved, notes: '' }, saved)) === '{"notes":null}');
  ok('a cleared name is sent, for the server to refuse', JSON.stringify(changedAccountFields({ ...saved, name: '  ' }, saved)) === '{"name":""}');
  ok('email case alone is not a change (the server lowercases it)', Object.keys(changedAccountFields({ ...saved, contactEmail: 'a@example.test' }, saved)).length === 0);

  console.log('The filters');
  const d = parseAccountFilters(params(''));
  ok('plain address: active accounts, first page', d.q === '' && d.status === 'ACTIVE' && !d.mine && d.page === 1);
  ok('reads status, mine and page', (() => { const f = parseAccountFilters(params('status=ALL&mine=1&page=3&q=%20acme%20')); return f.status === 'ALL' && f.mine && f.page === 3 && f.q === 'acme'; })());
  ok('unknown status: active', parseAccountFilters(params('status=DELETED')).status === 'ACTIVE');
  for (const p of ['0', '-1', 'abc', '1.5', '1e99', 'Infinity']) ok(`?page=${p}: first page`, parseAccountFilters(params(`page=${p}`)).page === 1);
  ok('defaults stay out of the address', accountPageQuery(d) === '');
  const f = { q: 'A&B (x)', status: 'INACTIVE' as const, mine: true, page: 2 };
  const back = parseAccountFilters(params(accountPageQuery(f)));
  ok('the address survives a round trip, special characters included', JSON.stringify(back) === JSON.stringify(f));
  ok('the API is told "active" explicitly', params(accountApiQuery(d)).get('status') === 'ACTIVE');
  ok('"All" sends no status', !params(accountApiQuery({ ...d, status: 'ALL' })).has('status'));
  ok('the API gets the page and size', params(accountApiQuery({ ...d, page: 4 })).get('page') === '4' && params(accountApiQuery(d)).get('pageSize') === String(ACCOUNTS_PAGE_SIZE));
  ok('filters noticed', hasAccountFilters({ ...d, q: 'x' }) && hasAccountFilters({ ...d, mine: true }) && hasAccountFilters({ ...d, status: 'ALL' }) && !hasAccountFilters({ ...d, page: 9 }));
  ok('page count', lastAccountPage(0) === 1 && lastAccountPage(25) === 1 && lastAccountPage(26) === 2);
  ok('range wording', accountRangeLabel(0, 1) === 'No accounts' && accountRangeLabel(1, 1) === '1 account' && accountRangeLabel(27, 2) === '26–27 of 27 accounts' && accountRangeLabel(1200, 1) === '1–25 of 1,200 accounts');

  console.log('Browser code stays out of the server');
  const read = (p: string) => readFileSync(p, 'utf8');
  ok('the shared logic imports nothing', !/^import /m.test(read('lib/desk/account-form.ts')));
  for (const p of ['app/components/desk/accounts/AccountList.tsx', 'app/components/desk/accounts/AccountForm.tsx']) {
    const imports = read(p).match(/^import [^;]+;/gm) ?? [];
    ok(`${p.split('/').pop()}: only React, Next and the shared logic`, read(p).startsWith("'use client'") && imports.every((i) => /from '(react|next\/link|next\/navigation|@\/lib\/desk\/account-form|\.\/account-api)'/.test(i)));
  }
  ok('the server uses the same limits as the form', read('lib/desk/book.ts').includes("from './account-form'") && !/const INSURED_TEXT/.test(read('lib/desk/book.ts')));
  for (const p of ['app/(desk)/desk/accounts/page.tsx', 'app/(desk)/desk/accounts/new/page.tsx', 'app/(desk)/desk/accounts/[id]/edit/page.tsx']) {
    ok(`${p.replace('app/(desk)/desk/', '')} checks access on the server`, read(p).includes("deskPageAccess('AGENCY', '/desk/accounts')"));
  }
}

(async () => {
  try {
    pureLogic();

    const mkAgency = async (n: string) => { const a = await prisma.agency.create({ data: { name: `${TAG} ${n}`, deskEnabled: true } }); cleanup.agencyIds.push(a.id); return a; };
    const mkUser = async (n: string, role: UserRole, agencyId: string | null = null) => {
      const u = await prisma.user.create({ data: { email: `${TAG}-${n}@example.test`, role, agencyId, firstName: n, passwordHash: 'x', mustChangePassword: false } });
      cleanup.userIds.push(u.id); return u;
    };
    const A = await mkAgency('A');
    const B = await mkAgency('B');
    const admin = await mkUser('admin', 'ADMIN', A.id);
    const producer = await mkUser('producer', 'AGENT', A.id);
    const adminB = await mkUser('admin-b', 'ADMIN', B.id);
    const ops = await mkUser('ops', 'DESK_ADMIN');
    const va = await mkUser('va', 'DESK_VA');
    const pod = await prisma.pod.create({ data: { code: `${TAG}-POD`, name: `${TAG} Pod` } }); cleanup.podIds.push(pod.id);
    await prisma.podMember.create({ data: { podId: pod.id, userId: va.id } });
    await prisma.agencyPodAccess.create({ data: { agencyId: A.id, podId: pod.id } });
    const sAdmin = await resolveDeskScope(prisma, admin.id);
    const sVa = await resolveDeskScope(prisma, va.id);

    const tokenOf = (id: string) => createSession(id);
    const tAdmin = await tokenOf(admin.id);
    const tProducer = await tokenOf(producer.id);
    const tB = await tokenOf(adminB.id);
    const req = (path: string, method: string, token: string, body?: unknown) => new NextRequest(`http://localhost${path}`, {
      method, headers: { cookie: `session_token=${token}`, 'content-type': 'application/json' }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
    const listed = async (query: string, token = tAdmin) => {
      const r = await listRoute(req(`/api/desk/insureds?${query}`, 'GET', token));
      return { status: r.status, body: await r.json() };
    };
    const names = (b: { insureds: { name: string }[] }) => b.insureds.map((i) => i.name);

    console.log('Every form field reaches the server and comes back');
    const allFields = Object.fromEntries(ACCOUNT_FORM_KEYS.map((k) => [k, k === 'contactEmail' ? 'all@example.test' : k === 'name' ? `${TAG} Everything` : `v-${k}`]));
    const everything = await createRoute(req('/api/desk/insureds', 'POST', tAdmin, allFields));
    const { id: everythingId } = await everything.json();
    const stored = await getInsured(prisma, sAdmin, everythingId) as unknown as Record<string, unknown>;
    ok('saved', everything.status === 201);
    ok('all form fields stored', ACCOUNT_FORM_KEYS.every((k) => stored[k] === allFields[k]));
    ok('and rebuilt into the form unchanged', Object.keys(changedAccountFields(formFromAccount(stored as never), formFromAccount(allFields))).length === 0);
    const tooLong = await createRoute(req('/api/desk/insureds', 'POST', tAdmin, { name: `${TAG} long`, dba: 'x'.repeat(INSURED_TEXT.dba.max + 1) }));
    ok('the shared limit is enforced by the server', tooLong.status === 400);
    await updateInsured(prisma, sAdmin, everythingId, { status: 'INACTIVE' });

    console.log('The list, as the screen asks for it');
    const data = Array.from({ length: 27 }, (_, i) => ({ agencyId: A.id, name: `${TAG} Page ${String(i).padStart(2, '0')}`, nameKey: `${TAG} page ${String(i).padStart(2, '0')}`.toLowerCase(), source: 'MANUAL' as const, createdById: admin.id }));
    await prisma.insuredAccount.createMany({ data });
    const p1 = await listed(accountApiQuery(parseAccountFilters(params(`q=${TAG}%20Page`))));
    const p2 = await listed(accountApiQuery(parseAccountFilters(params(`q=${TAG}%20Page&page=2`))));
    ok('first page is full', p1.status === 200 && p1.body.insureds.length === 25 && p1.body.total === 27);
    ok('second page has the rest', p2.body.insureds.length === 2);
    ok('no account on both pages', new Set([...names(p1.body), ...names(p2.body)]).size === 27);
    ok('in name order', names(p1.body)[0].endsWith('Page 00') && names(p2.body)[1].endsWith('Page 26'));
    const qEverything = encodeURIComponent(`${TAG} Everything`);
    ok('default hides inactive accounts', (await listed(accountApiQuery(parseAccountFilters(params(`q=${qEverything}`))))).body.total === 0);
    ok('inactive filter finds them', (await listed(accountApiQuery(parseAccountFilters(params(`q=${qEverything}&status=INACTIVE`))))).body.total === 1);
    ok('all statuses finds them', (await listed(accountApiQuery(parseAccountFilters(params(`q=${qEverything}&status=ALL`))))).body.total === 1);

    const { id: mineId } = await createInsured(prisma, await resolveDeskScope(prisma, producer.id), { name: `${TAG} Producer Own` });
    ok('"my accounts": the producer\'s own', names((await listed(`mine=1&q=${TAG}`, tProducer)).body).join() === `${TAG} Producer Own`);
    ok('"my accounts" for an admin assigned to none: empty', (await listed(`mine=1&q=${TAG}`)).body.total === 0);
    ok('the admin sees it without the filter', names((await listed(`q=${encodeURIComponent(`${TAG} Producer Own`)}`)).body).length === 1);
    ok('another agency sees none of it', (await listed(`q=${TAG}`, tB)).body.total === 0);
    ok('a row carries what the table shows', (await listed(`q=${encodeURIComponent(`${TAG} Producer Own`)}`)).body.insureds[0].assignments[0].userId === producer.id);

    console.log('Odd input from a search box or an old link');
    for (const q of ['(', '*', '[a', '\\', 'a.*', '$where', '%', '"']) {
      ok(`search for ${q}: an ordinary answer`, (await listed(`q=${encodeURIComponent(q)}`, tB)).status === 200);
    }
    ok('a dot does not match everything', (await listed(`q=${encodeURIComponent('.*')}`)).body.total === 0);
    ok('a very long search is fine', (await listed(`q=${'x'.repeat(5000)}`)).status === 200);
    for (const page of ['Infinity', '1e300', '99999999999999', '-5']) {
      const r = await listed(`page=${page}`, tB);
      ok(`?page=${page}: an ordinary answer`, r.status === 200 && Array.isArray(r.body.insureds));
    }
    console.log('Search text is matched literally');
    ok('literal escapes every special character', literal('a.b*c(d)[e]{f}^g$h|i+j?k\\l') === 'a\\.b\\*c\\(d\\)\\[e\\]\\{f\\}\\^g\\$h\\|i\\+j\\?k\\\\l');
    await createInsured(prisma, sAdmin, { name: `${TAG} Acme (Boston) [East]`, contactEmail: 'first.last+tag@example.test', externalRef: 'REF.1*2' });
    const finds = async (q: string) => (await listed(`q=${encodeURIComponent(q)}`)).body.total;
    ok('brackets in a name can be searched', await finds('(Boston) [East') === 1);
    ok('case still ignored', await finds('(BOSTON)') === 1);
    ok('a plus and a dot in an email', await finds('first.last+tag') === 1);
    ok('a star in a reference', await finds('REF.1*2') === 1);
    ok('a dot is only a dot', await finds('first-last') === 0 && await finds('first?last') === 0);
    ok('a nested pattern is taken as plain words', (await listed(`q=${encodeURIComponent('(a+)+$')}`)).status === 200);
    ok('".*" as a name key matches nothing', await finds('.*') === 0);
    ok('word matching still works: "Acme Boston East LLC"', await finds('Acme Boston East LLC') === 1);

    console.log('The same fix in the other Desk searches (read-only on real records)');
    const sOps = await resolveDeskScope(prisma, ops.id);
    ok('agency search: "(" is an ordinary answer', (await listDeskAgencies(prisma, sOps, { q: '(' })).every((a) => a.name.includes('(')));
    ok('agency search: ".*" does not match everything', (await listDeskAgencies(prisma, sOps, { q: '.*' })).every((a) => a.name.includes('.*')));
    ok('agency search still finds by name', (await listDeskAgencies(prisma, sOps, { q: `${TAG} a` })).length === 1);
    ok('staff search: "(" is an ordinary answer', (await listStaff(prisma, sOps, { q: '(' })).length === 0);
    ok('staff search: ".*" does not match everything', (await listStaff(prisma, sOps, { q: '.*' })).length === 0);
    ok('staff search still finds by email', (await listStaff(prisma, sOps, { q: `${TAG}-va` })).length === 1);
    const eastPod = await createPod(prisma, sOps, { name: `${TAG} East (1)` }); cleanup.podIds.push(eastPod.id);
    ok('a pod name with brackets can be created', !!eastPod.id);
    const dupPod = await createPod(prisma, sOps, { name: `${TAG} EAST (1)` }).then((p) => { cleanup.podIds.push(p.id); return 200; }, (e: DeskAccessError) => e.status);
    ok('and its duplicate is still refused, ignoring case', dupPod === 409);
    const dotPod = await createPod(prisma, sOps, { name: `${TAG} .*` }).then((p) => { cleanup.podIds.push(p.id); return 200; }, (e: DeskAccessError) => e.status);
    ok('a name that reads as a pattern does not collide with others', dotPod === 200);

    ok('a page past the end reports the total, so the screen can step back', await (async () => { const r = await listed(`q=${TAG}%20Page&page=50`); return r.body.insureds.length === 0 && r.body.total === 27; })());

    console.log('A search cannot confirm a policy someone may not see');
    const { id: both } = await createInsured(prisma, sAdmin, { name: `${TAG} Two Policies` });
    const seenPolicy = await prisma.policy.create({ data: { agencyId: A.id, insuredId: both, policyNumber: `${TAG}-SEEN`, createdById: admin.id } });
    await prisma.policy.create({ data: { agencyId: A.id, insuredId: both, policyNumber: `${TAG}-HIDDEN`, createdById: admin.id } });
    await prisma.task.create({ data: { reference: ref++, agencyId: A.id, insuredId: both, policyId: seenPolicy.id, podId: pod.id, type: 'RENEWAL', title: 't', status: 'NEW', source: 'INTERNAL', createdById: ops.id, restrictedToUserIds: [] } });
    ok('VA finds the policy on their request', (await listInsureds(prisma, sVa, { q: `${TAG}-SEEN` })).total === 1);
    ok('VA searching the other policy\'s number: nothing', (await listInsureds(prisma, sVa, { q: `${TAG}-HIDDEN` })).total === 0);
    ok('the agency admin finds either', (await listInsureds(prisma, sAdmin, { q: `${TAG}-HIDDEN` })).total === 1);

    console.log('Refusals the form responds to');
    const dup = await createRoute(req('/api/desk/insureds', 'POST', tAdmin, { name: `${TAG} Two Policies` }));
    ok('duplicate name: 409 with its code', dup.status === 409 && (await dup.json()).code === 'DUPLICATE_NAME');
    const anyway = await createRoute(req('/api/desk/insureds', 'POST', tAdmin, { name: `${TAG} Two Policies`, allowDuplicate: true }));
    ok('"continue anyway" saves it', anyway.status === 201);
    const fresh = await getInsured(prisma, sAdmin, mineId);
    await updateInsured(prisma, sAdmin, mineId, { city: 'Lowell' });
    const staleSave = await updateRoute(req(`/api/desk/insureds/${mineId}`, 'PATCH', tAdmin, { version: fresh.version, city: 'Stale' }), ctx(mineId));
    ok('out-of-date save: 409 with its code', staleSave.status === 409 && (await staleSave.json()).code === 'CHANGED_ELSEWHERE');
    const hidden = await updateRoute(req(`/api/desk/insureds/${mineId}`, 'PATCH', tB, { city: 'x' }), ctx(mineId));
    const hiddenBody = await hidden.json();
    ok('another agency: "Not found", nothing more', hidden.status === 404 && hiddenBody.error === 'Not found' && !('code' in hiddenBody));
    const plain = await createRoute(req('/api/desk/insureds', 'POST', tAdmin, { name: '' }));
    ok('an ordinary refusal has no code', plain.status === 400 && !('code' in await plain.json()));
    ok('DeskAccessError keeps its code', new DeskAccessError(409, 'x', 'C').code === 'C');

    console.log('Reactivating an account');
    const { id: old } = await createInsured(prisma, sAdmin, { name: `${TAG} Reused Name` });
    await updateInsured(prisma, sAdmin, old, { status: 'INACTIVE' });
    const { id: newer } = await createInsured(prisma, sAdmin, { name: `${TAG} Reused Name` });
    ok('a new account can take an inactive account\'s name', !!newer);
    const back = await updateRoute(req(`/api/desk/insureds/${old}`, 'PATCH', tAdmin, { status: 'ACTIVE' }), ctx(old));
    ok('reactivating into a name now in use: refused with the duplicate code', back.status === 409 && (await back.json()).code === 'DUPLICATE_NAME');
    ok('and it stays inactive', (await prisma.insuredAccount.findUniqueOrThrow({ where: { id: old } })).status === 'INACTIVE');
    ok('confirmed: reactivated', (await updateRoute(req(`/api/desk/insureds/${old}`, 'PATCH', tAdmin, { status: 'ACTIVE', allowDuplicate: true }), ctx(old))).status === 200);
    const { id: solo } = await createInsured(prisma, sAdmin, { name: `${TAG} Solo` });
    await updateInsured(prisma, sAdmin, solo, { status: 'INACTIVE' });
    ok('no clash: reactivates without asking', (await updateRoute(req(`/api/desk/insureds/${solo}`, 'PATCH', tAdmin, { status: 'ACTIVE' }), ctx(solo))).status === 200);
    await updateInsured(prisma, sAdmin, newer, { status: 'INACTIVE' });
    await updateInsured(prisma, sAdmin, old, { status: 'INACTIVE' });
    ok('an inactive account with the same name does not block', (await updateRoute(req(`/api/desk/insureds/${newer}`, 'PATCH', tAdmin, { status: 'ACTIVE' }), ctx(newer))).status === 200);
    ok('reactivating under a new, unused name goes through', await (async () => {
      const r = await updateRoute(req(`/api/desk/insureds/${old}`, 'PATCH', tAdmin, { status: 'ACTIVE', name: `${TAG} Renamed Back` }), ctx(old));
      return r.status === 200;
    })());
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
