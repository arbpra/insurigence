/**
 * The Desk, Module 22: the account's own page.
 *
 * The premium, date and link logic the screens rely on, what each kind of user
 * is given (above all, what an agency user must not be), and the policy rules
 * the page responds to. Temporary agencies and users only.
 * Run with:  npx tsx script/verify-desk-account-detail.ts
 */
import 'dotenv/config';
import { readFileSync } from 'fs';
import { NextRequest } from 'next/server';
import type { Prisma, TaskStatus, UserRole } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { createSession } from '../lib/auth';
import { DeskAccessError, resolveDeskScope } from '../lib/desk/access';
import { dayLabel, fileSizeLabel, localDayLabel, mailtoHref, websiteHref } from '../lib/desk/account-form';
import { addPolicy, createInsured, getInsured, getInsuredOverview, listInsureds, removePolicy, updatePolicy } from '../lib/desk/book';
import { formFromPolicy, parsePremium, policyChanges, policyFormDirty, premiumLabel } from '../lib/desk/policy-form';
import { GET as overviewRoute } from '../app/api/desk/insureds/[id]/overview/route';
import { PATCH as policyPatchRoute } from '../app/api/desk/policies/[id]/route';

let pass = 0, fail = 0;
const ok = (n: string, c: boolean) => { c ? pass++ : fail++; console.log(`  ${c ? '✓' : '✗'} ${n}`); };

const TAG = `m22test-${Date.now()}`;
const cleanup = { agencyIds: [] as string[], userIds: [] as string[], podIds: [] as string[] };
let ref = 992_000_000 + Math.floor(Math.random() * 1_000_000);

async function wipe() {
  const agencyId = { in: cleanup.agencyIds };
  await prisma.taskDocument.deleteMany({ where: { agencyId } });
  await prisma.taskEvent.deleteMany({ where: { agencyId } });
  // Subtasks first: a task with subtasks can't be deleted before them.
  await prisma.task.deleteMany({ where: { agencyId, parentTaskId: { not: null } } });
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

const read = (p: string) => readFileSync(p, 'utf8');

function pureLogic() {
  console.log('Premiums');
  const cents = (t: string) => { const r = parsePremium(t); return 'cents' in r ? r.cents : 'refused'; };
  ok('empty is no premium', cents('') === null && cents('   ') === null);
  ok('whole dollars', cents('1250') === 125_000);
  ok('commas and a dollar sign', cents('$1,250.50') === 125_050);
  ok('one decimal place', cents('12.5') === 1_250);
  ok('zero is a premium', cents('0') === 0);
  ok('amounts that go wrong as fractions stay exact', cents('19.99') === 1_999 && cents('1.15') === 115 && cents('4.35') === 435 && cents('1000000.07') === 100_000_007);
  for (const t of ['-5', 'abc', '1.234', '1,23', '12,34,567', '1e5', '$', '.5', '1.', '٣']) ok(`"${t}" refused`, cents(t) === 'refused');
  ok('the $1 billion limit is allowed', cents('1000000000') === 100_000_000_000);
  ok('above it refused', cents('1000000000.01') === 'refused' && cents('99999999999999999999') === 'refused');
  ok('shown with commas and cents', premiumLabel(125_050) === '$1,250.50' && premiumLabel(5) === '$0.05' && premiumLabel(0) === '$0.00');
  ok('no premium shown as a dash', premiumLabel(null) === '—' && premiumLabel(undefined) === '—');
  for (const c of [0, 5, 50, 99, 100, 1_999, 125_050, 100_000_000_000]) ok(`${c} cents survives the form`, cents(formFromPolicy({ premiumCents: c }).premium) === c);

  console.log('The policy form');
  const stored = { policyNumber: 'GL-1', lineOfBusiness: 'GL', carrierName: null, effectiveDate: '2026-01-31', expirationDate: '2027-01-31', premiumCents: 125_050, status: 'ACTIVE' as const, externalRef: null, notes: 'n' };
  const form = formFromPolicy(stored);
  const changes = (f: typeof form, s?: typeof stored) => { const r = policyChanges(f, s); return 'changes' in r ? r.changes : r.error; };
  ok('a blank form starts active', formFromPolicy().status === 'ACTIVE' && formFromPolicy().premium === '');
  ok('nothing changed: nothing sent', JSON.stringify(changes(form, stored)) === '{}');
  ok('one change: only that field', JSON.stringify(changes({ ...form, carrierName: 'Acme' }, stored)) === '{"carrierName":"Acme"}');
  ok('a cleared field is sent as null', JSON.stringify(changes({ ...form, notes: '' }, stored)) === '{"notes":null}');
  ok('a cleared date is sent as null', JSON.stringify(changes({ ...form, expirationDate: '' }, stored)) === '{"expirationDate":null}');
  ok('a cleared premium is sent as null', JSON.stringify(changes({ ...form, premium: '' }, stored)) === '{"premiumCents":null}');
  ok('the same premium written differently is no change', JSON.stringify(changes({ ...form, premium: '$1,250.5' }, stored)) === '{}');
  ok('a changed premium goes in cents', JSON.stringify(changes({ ...form, premium: '10' }, stored)) === '{"premiumCents":1000}');
  ok('a changed status is sent', JSON.stringify(changes({ ...form, status: 'CANCELLED' }, stored)) === '{"status":"CANCELLED"}');
  ok('adding sends only what was filled in', JSON.stringify(changes({ ...formFromPolicy(), policyNumber: ' P ' })) === '{"policyNumber":"P"}');
  ok('a form naming no policy is refused', typeof changes(formFromPolicy()) === 'string' && typeof changes({ ...formFromPolicy(), premium: '5', notes: 'x' }) === 'string');
  ok('clearing every name is refused', typeof changes({ ...form, policyNumber: '', lineOfBusiness: '' }, stored) === 'string');
  ok('a bad premium is refused', typeof changes({ ...form, premium: 'abc' }, stored) === 'string');
  ok('not dirty as opened', !policyFormDirty(form, stored) && !policyFormDirty(formFromPolicy()));
  ok('dirty once changed', policyFormDirty({ ...form, notes: 'x' }, stored) && policyFormDirty({ ...form, status: 'PENDING' }, stored));

  console.log('Links and labels');
  ok('a plain address becomes https', websiteHref('example.com') === 'https://example.com/');
  ok('http and https kept', websiteHref('http://a.test/x') === 'http://a.test/x' && websiteHref('HTTPS://a.test') === 'https://a.test/');
  for (const v of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', ' javascript:alert(1)', 'data:text/html,x', 'vbscript:x', 'file:///c:/x', 'not a link', '', null, undefined]) {
    ok(`no link for ${JSON.stringify(v)}`, websiteHref(v) === null);
  }
  ok('a tab or line break cannot disguise a script link', websiteHref('java\tscript:alert(1)') === null && websiteHref('java\nscript:alert(1)') === null);
  ok('an email link keeps the address', mailtoHref('a.b+c@x.test') === 'mailto:a.b%2Bc@x.test');
  ok('an email link cannot add to the message', !mailtoHref('a@x.test?bcc=z@y.test').includes('?'));
  const zone = process.env.TZ;
  for (const tz of ['Pacific/Honolulu', 'Pacific/Auckland']) {
    process.env.TZ = tz;
    ok(`a policy date is the same day in ${tz}`, dayLabel('2026-01-31') === 'Jan 31, 2026' && dayLabel('2026-12-01') === 'Dec 1, 2026');
  }
  process.env.TZ = 'Pacific/Honolulu';
  ok('a moment shows the viewer\'s own day', localDayLabel('2026-02-01T03:00:00.000Z') === 'Jan 31, 2026');
  process.env.TZ = zone;
  ok('no date shown as a dash', dayLabel(null) === '—' && dayLabel('') === '—');
  ok('file sizes', fileSizeLabel(512) === '512 B' && fileSizeLabel(2048) === '2 KB' && fileSizeLabel(1_572_864) === '1.5 MB');

  console.log('The screens');
  ok('the shared logic brings in no server code', !/^import (?!type )/m.test(read('lib/desk/policy-form.ts')));
  for (const [p, allowed] of [
    ['app/components/desk/accounts/AccountDetail.tsx', /from '(react|next\/link|@\/lib\/desk\/account-form|\.\/account-api|\.\/PolicyPanel)'/],
    ['app/components/desk/accounts/PolicyPanel.tsx', /from '(react|@\/lib\/desk\/account-form|@\/lib\/desk\/policy-form|\.\/account-api)'/],
  ] as const) {
    const imports = read(p).match(/^import [^;]+;/gm) ?? [];
    ok(`${p.split('/').pop()}: browser code, importing only React, Next and shared logic`, read(p).startsWith("'use client'") && imports.every((i) => allowed.test(i)));
  }
  ok('the page checks access on the server', read('app/(desk)/desk/accounts/[id]/page.tsx').includes("deskPageAccess('AGENCY', '/desk/accounts')"));
  ok('list rows open the account\'s page', read('app/components/desk/accounts/AccountList.tsx').includes('href={`/desk/accounts/${a.id}`}'));
  ok('a new account opens its page', read('app/components/desk/accounts/AccountForm.tsx').includes('router.push(`/desk/accounts/${created.id}?created=1`)'));
  ok('the server uses the form\'s limits', read('lib/desk/book.ts').includes("from './policy-form'") && !/const POLICY_TEXT/.test(read('lib/desk/book.ts')));
  ok('the website is never linked unchecked', !/href=\{data\.website\}/.test(read('app/components/desk/accounts/AccountDetail.tsx')));
}

(async () => {
  try {
    pureLogic();

    const mkAgency = async (n: string) => { const a = await prisma.agency.create({ data: { name: `${TAG} ${n}`, deskEnabled: true } }); cleanup.agencyIds.push(a.id); return a; };
    const mkUser = async (n: string, role: UserRole, agencyId: string | null = null, extra: object = {}) => {
      const u = await prisma.user.create({ data: { email: `${TAG}-${n}@example.test`, role, agencyId, firstName: n, passwordHash: 'x', mustChangePassword: false, ...extra } });
      cleanup.userIds.push(u.id); return u;
    };
    const A = await mkAgency('A');
    const B = await mkAgency('B');
    const admin = await mkUser('admin', 'ADMIN', A.id);
    const producer = await mkUser('producer', 'AGENT', A.id);
    const unassigned = await mkUser('unassigned', 'AGENT', A.id);
    const gone = await mkUser('gone', 'CSR', A.id, { isActive: false });
    const adminB = await mkUser('admin-b', 'ADMIN', B.id);
    const am = await mkUser('am', 'ACCOUNT_MANAGER');
    const va = await mkUser('va', 'DESK_VA');
    const otherVa = await mkUser('other-va', 'DESK_VA');
    await prisma.agencyDeskAssignment.create({ data: { agencyId: A.id, primaryAmId: am.id } });
    const pod = await prisma.pod.create({ data: { code: `${TAG}-POD`, name: `${TAG} Pod Secret` } }); cleanup.podIds.push(pod.id);
    await prisma.podMember.create({ data: { podId: pod.id, userId: va.id } });
    await prisma.agencyPodAccess.create({ data: { agencyId: A.id, podId: pod.id } });

    const sAdmin = await resolveDeskScope(prisma, admin.id);
    const sProducer = await resolveDeskScope(prisma, producer.id);
    const sUnassigned = await resolveDeskScope(prisma, unassigned.id);
    const sB = await resolveDeskScope(prisma, adminB.id);
    const sAm = await resolveDeskScope(prisma, am.id);
    const sVa = await resolveDeskScope(prisma, va.id);
    const CTX = { ip: '203.0.113.9', userAgent: 'verify' };
    const status = async (fn: () => Promise<unknown>) => {
      try { await fn(); return 200; } catch (e) { if (e instanceof DeskAccessError) return e.status; throw e; }
    };
    const refusal = async (fn: () => Promise<unknown>) => {
      try { await fn(); return null; } catch (e) { if (e instanceof DeskAccessError) return e; throw e; }
    };

    const { id: acme } = await createInsured(prisma, sAdmin, { name: `${TAG} Acme`, website: 'javascript:alert(1)', notes: 'Prefers phone.', contactEmail: 'owner@acme.test' }, CTX);
    const { id: other } = await createInsured(prisma, sAdmin, { name: `${TAG} Other` }, CTX);
    const { id: foreign } = await createInsured(prisma, sB, { name: `${TAG} Foreign` }, CTX);
    await prisma.insuredAssignment.createMany({ data: [
      { agencyId: A.id, insuredId: acme, userId: producer.id, role: 'PRODUCER' },
      { agencyId: A.id, insuredId: acme, userId: gone.id, role: 'SERVICE' },
    ] });

    const mkTask = async (title: string, taskStatus: TaskStatus, extra: Partial<Prisma.TaskUncheckedCreateInput> = {}) =>
      prisma.task.create({ data: { reference: ref++, agencyId: A.id, insuredId: acme, type: 'COI', title: `${TAG} ${title}`, status: taskStatus, podId: pod.id, ...extra } });
    const mkDoc = (fileName: string, taskId: string, extra: Partial<Prisma.TaskDocumentUncheckedCreateInput> = {}) =>
      prisma.taskDocument.create({ data: { taskId, agencyId: A.id, storageKey: `secret-key/${TAG}/${fileName}`, fileName, fileSize: 2048, contentType: 'application/pdf', sensitivity: 'GENERAL', visibility: 'AGENCY', ...extra } });

    const tCarrier = await mkTask('waits on carrier', 'WAITING_ON_CARRIER');
    const tAgency = await mkTask('waits on agency', 'WAITING_ON_AGENCY');
    const tNew = await mkTask('brand new', 'NEW');
    const tQa = await mkTask('in QA', 'QA_REVIEW');
    const tRestricted = await mkTask('restricted to another VA', 'IN_PROGRESS', { restrictedToUserIds: [otherVa.id], restrictionReason: 'Internal reason' });
    const tDone = await mkTask('finished', 'COMPLETED', { completedAt: new Date() });
    const tCancelled = await mkTask('called off', 'CANCELLED', { cancelledAt: new Date() });
    const tSub = await mkTask('a subtask', 'IN_PROGRESS', { parentTaskId: tNew.id });
    const tOther = await mkTask('on another account', 'NEW', { insuredId: other });

    const dShared = await mkDoc('shared.pdf', tNew.id);
    const dInternal = await mkDoc('internal.pdf', tNew.id, { visibility: 'INTERNAL' });
    const dRemoved = await mkDoc('removed.pdf', tNew.id, { deletedAt: new Date() });
    const dFinancial = await mkDoc('financial.pdf', tNew.id, { sensitivity: 'FINANCIAL' });
    const dClosed = await mkDoc('on-closed-request.pdf', tDone.id);
    const dOther = await mkDoc('other-account.pdf', tOther.id);
    const dRestricted = await mkDoc('on-restricted.pdf', tRestricted.id);

    console.log('An agency admin');
    const view = await getInsuredOverview(prisma, sAdmin, acme, CTX);
    const json = JSON.stringify(view);
    const viewsLogged = await prisma.deskAuditLog.count({ where: { action: 'insured.viewed', entityId: acme, actorId: admin.id } });
    const titles = view.requests.rows.map((r) => r.title.replace(`${TAG} `, ''));
    const files = view.documents.rows.map((d) => d.fileName);
    ok('sees the account and its notes', view.name === `${TAG} Acme` && view.notes === 'Prefers phone.');
    ok('sees who is assigned, including that someone has left', view.assignments!.length === 2 && view.assignments!.some((s) => s.userId === gone.id && s.isActive === false) && view.assignments!.some((s) => s.userId === producer.id && s.role === 'PRODUCER'));
    ok('open requests are listed', ['waits on carrier', 'waits on agency', 'brand new', 'in QA', 'restricted to another VA'].every((t) => titles.includes(t)));
    ok('finished and cancelled ones are not', !titles.includes('finished') && !titles.includes('called off'));
    ok('a subtask is not a separate request', !titles.includes('a subtask'));
    ok('another account\'s are not', !titles.includes('on another account'));
    ok('newest first', view.requests.rows.every((r, i, all) => i === 0 || all[i - 1].createdAt >= r.createdAt));
    ok('the total agrees with the list', view.requests.total === 5 && view.requests.rows.length === 5);
    const label = (t: string) => view.requests.rows.find((r) => r.title.endsWith(t))!.statusLabel;
    ok('waiting on a carrier reads "In progress"', label('waits on carrier') === 'In progress');
    ok('QA review reads "In progress"', label('in QA') === 'In progress');
    ok('new reads "Received"', label('brand new') === 'Received');
    ok('waiting on the agency reads "Needs your attention"', label('waits on agency') === 'Needs your attention');
    ok('and is marked', view.requests.rows.find((r) => r.title.endsWith('waits on agency'))!.needsAttention && !view.requests.rows.find((r) => r.title.endsWith('brand new'))!.needsAttention);
    for (const hidden of ['WAITING_ON_CARRIER', 'QA_REVIEW', 'podId', 'assigneeId', 'restrictedToUserIds', 'Internal reason', 'slaDueAt', 'dueAt', 'billing', 'escalat', 'Pod Secret', 'nameKey']) {
      ok(`nothing internal reaches the agency: ${hidden}`, !json.includes(hidden));
    }
    ok('a storage location is never sent', !json.includes('storageKey') && !json.includes('secret-key'));
    ok('shared documents listed', files.includes('shared.pdf') && files.includes('financial.pdf'));
    ok('including those on finished requests', files.includes('on-closed-request.pdf'));
    ok('internal documents hidden', !files.includes('internal.pdf'));
    ok('removed documents hidden', !files.includes('removed.pdf'));
    ok('another account\'s documents hidden', !files.includes('other-account.pdf'));
    ok('the document total agrees', view.documents.total === view.documents.rows.length);
    ok('category, size and request shown', (() => { const d = view.documents.rows.find((x) => x.id === dFinancial.id)!; return d.categoryLabel === 'Financial' && d.fileSize === 2048 && d.requestReference === tNew.reference; })());

    console.log('The counts agree across screens');
    const rowOf = async () => (await listInsureds(prisma, sAdmin, { q: `${TAG} Acme` })).insureds[0];
    ok('the list counts what the page lists', (await rowOf()).openTasks === view.requests.total);
    ok('the form counts what the page lists', (await getInsured(prisma, sAdmin, acme)).openTasks === view.requests.total);

    console.log('Logging');
    const entry = await prisma.deskAuditLog.findFirstOrThrow({ where: { action: 'insured.viewed', entityId: acme, actorId: admin.id, ipAddress: CTX.ip }, orderBy: { createdAt: 'desc' } });
    const meta = entry.metadata as { view?: string; requestsListed?: number; documentIds?: string[] };
    ok('the view is logged, once', meta.view === 'overview' && viewsLogged === 1);
    ok('with what was listed', meta.requestsListed === 5 && meta.documentIds?.includes(dShared.id) === true && meta.documentIds?.includes(dInternal.id) === false);
    ok('and no file names or client details', !JSON.stringify(entry.metadata).includes('.pdf') && !JSON.stringify(entry.metadata).includes('Acme'));

    console.log('Other agency users');
    ok('another agency: 404', await status(() => getInsuredOverview(prisma, sB, acme)) === 404);
    ok('and it is logged', await prisma.deskAuditLog.count({ where: { action: 'access.denied', entityId: acme, actorId: adminB.id } }) === 1);
    ok('and nothing of theirs here', await status(() => getInsuredOverview(prisma, sAdmin, foreign)) === 404);
    ok('producer not assigned: 404', await status(() => getInsuredOverview(prisma, sUnassigned, acme)) === 404);
    const seen = await getInsuredOverview(prisma, sProducer, acme);
    ok('assigned producer sees the same requests', seen.requests.total === 5);
    ok('and only shared documents', !seen.documents.rows.some((d) => d.id === dInternal.id) && seen.documents.rows.some((d) => d.id === dShared.id));
    ok('but does not manage the account', seen.can.manage === false && seen.can.edit === true);
    ok('bad id: 404', await status(() => getInsuredOverview(prisma, sAdmin, 'not-an-id')) === 404);

    console.log('Account Manager');
    const amView = await getInsuredOverview(prisma, sAm, acme);
    ok('sees internal documents, not removed ones', amView.documents.rows.some((d) => d.id === dInternal.id) && !amView.documents.rows.some((d) => d.id === dRemoved.id));
    ok('sees the real status', amView.requests.rows.find((r) => r.title.endsWith('waits on carrier'))!.statusLabel === 'Waiting on carrier');
    ok('a storage location is never sent', !JSON.stringify(amView).includes('secret-key'));

    console.log('A VA, need-to-know');
    const vaView = await getInsuredOverview(prisma, sVa, acme);
    const vaFiles = vaView.documents.rows.map((d) => d.id);
    const vaTitles = vaView.requests.rows.map((r) => r.title);
    ok('no notes', !('notes' in vaView));
    ok('no staff list', !('assignments' in vaView));
    ok('open work listed', vaTitles.some((t) => t.endsWith('brand new')));
    ok('a request restricted to someone else is hidden', !vaTitles.some((t) => t.endsWith('restricted to another VA')));
    ok('and its documents', !vaFiles.includes(dRestricted.id));
    ok('finished work that isn\'t theirs is hidden, with its documents', !vaTitles.some((t) => t.endsWith('finished')) && !vaFiles.includes(dClosed.id));
    ok('financial documents hidden without a grant', !vaFiles.includes(dFinancial.id));
    ok('general internal documents visible', vaFiles.includes(dInternal.id));
    ok('the document total hides the rest too', vaView.documents.total === vaFiles.length);
    ok('and a VA cannot edit', vaView.can.edit === false);
    await prisma.deskStaffPermission.create({ data: { userId: va.id, allowedSensitivities: ['FINANCIAL'] } });
    ok('with a grant, financial documents appear', (await getInsuredOverview(prisma, await resolveDeskScope(prisma, va.id), acme)).documents.rows.some((d) => d.id === dFinancial.id));
    await prisma.deskStaffPermission.deleteMany({ where: { userId: va.id } });

    console.log('Long lists');
    await prisma.task.createMany({ data: Array.from({ length: 50 }, (_, i) => ({ reference: ref++, agencyId: A.id, insuredId: other, type: 'COI' as const, title: `${TAG} bulk ${i}`, status: 'NEW' as const, restrictedToUserIds: [] })) });
    const long = await getInsuredOverview(prisma, sAdmin, other);
    ok('capped at 50, with the true total', long.requests.rows.length === 50 && long.requests.total === 51);

    console.log('Policies');
    const blank = formFromPolicy();
    const made = policyChanges({ ...blank, policyNumber: 'GL-7', carrierName: 'Northwind', effectiveDate: '2026-01-31', expirationDate: '2027-01-31', premium: '$1,250.50', notes: 'n1' });
    if (!('changes' in made)) throw new Error('form refused');
    const { id: p1 } = await addPolicy(prisma, sAdmin, acme, made.changes, CTX);
    const stored = (await getInsuredOverview(prisma, sAdmin, acme)).policies.find((p) => p.id === p1)!;
    ok('what the form sends is what comes back', stored.policyNumber === 'GL-7' && stored.premiumCents === 125_050 && stored.effectiveDate === '2026-01-31' && stored.expirationDate === '2027-01-31');
    ok('it carries a version', !!stored.version);
    const round = policyChanges(formFromPolicy(stored as Parameters<typeof formFromPolicy>[0]), stored as Parameters<typeof policyChanges>[1]);
    ok('reopening it and saving changes nothing', 'changes' in round && Object.keys(round.changes).length === 0);
    const vaPolicies = (await getInsuredOverview(prisma, sVa, acme)).policies.find((p) => p.id === p1)!;
    ok('a VA gets no premium or policy notes', vaPolicies && !('premiumCents' in vaPolicies) && !('notes' in vaPolicies));

    ok('a policy naming nothing is refused', await status(() => addPolicy(prisma, sAdmin, acme, {})) === 400);
    ok('even with other details', await status(() => addPolicy(prisma, sAdmin, acme, { premiumCents: 100, notes: 'x', effectiveDate: '2026-01-01' })) === 400);
    ok('blank text doesn\'t count', await status(() => addPolicy(prisma, sAdmin, acme, { policyNumber: '  ' })) === 400);
    ok('a line of business alone is enough', await status(async () => { const { id } = await addPolicy(prisma, sAdmin, acme, { lineOfBusiness: 'WC' }); await removePolicy(prisma, sAdmin, id); }) === 200);
    ok('clearing its only name is refused', await status(() => updatePolicy(prisma, sAdmin, p1, { policyNumber: null, carrierName: null })) === 400);
    ok('clearing one of two is fine', await status(() => updatePolicy(prisma, sAdmin, p1, { carrierName: null })) === 200);
    ok('which leaves the other', (await prisma.policy.findUniqueOrThrow({ where: { id: p1 } })).policyNumber === 'GL-7');

    const old = stored.version;
    const staleRefusal = await refusal(() => updatePolicy(prisma, sAdmin, p1, { version: old, notes: 'stale' }));
    ok('an out-of-date save is refused with its code', staleRefusal?.status === 409 && staleRefusal.code === 'CHANGED_ELSEWHERE');
    ok('and saves nothing', (await prisma.policy.findUniqueOrThrow({ where: { id: p1 } })).notes === 'n1');

    const { id: p2 } = await addPolicy(prisma, sAdmin, acme, { policyNumber: 'IN-USE' }, CTX);
    const tUses = await mkTask('uses the policy', 'NEW', { policyId: p2 });
    const inUse = await refusal(() => removePolicy(prisma, sAdmin, p2));
    ok('a policy with requests cannot be removed, and says why', inUse?.status === 409 && inUse.message.includes("can't be removed"));
    await prisma.task.delete({ where: { id: tUses.id } });
    await removePolicy(prisma, sAdmin, p2, CTX);
    ok('without them it can', await prisma.policy.count({ where: { id: p2 } }) === 0);

    console.log('Over HTTP');
    const tokenAdmin = await createSession(admin.id);
    const tokenB = await createSession(adminB.id);
    const get = (id: string, token?: string) => overviewRoute(
      new NextRequest(`http://local.test/api/desk/insureds/${id}/overview`, { headers: token ? { cookie: `session_token=${token}` } : {} }),
      { params: Promise.resolve({ id }) },
    );
    const res = await get(acme, tokenAdmin);
    const body = await res.json();
    ok('200, with requests and documents', res.status === 200 && body.requests.total >= 5 && body.documents.total >= 1);
    ok('a stored script link reaches the screen as text to check', body.website === 'javascript:alert(1)' && websiteHref(body.website) === null);
    const res404 = await get(acme, tokenB);
    ok('another agency: a bare 404', res404.status === 404 && JSON.stringify(await res404.json()) === '{"error":"Not found"}');
    ok('not signed in: refused', [401, 403, 404].includes((await get(acme)).status));
    const fresh = (await getInsuredOverview(prisma, sAdmin, acme)).policies.find((p) => p.id === p1)!;
    const patch = (version: string) => policyPatchRoute(
      new NextRequest(`http://local.test/api/desk/policies/${p1}`, { method: 'PATCH', headers: { cookie: `session_token=${tokenAdmin}` }, body: JSON.stringify({ version, notes: 'over http' }) }),
      { params: Promise.resolve({ id: p1 }) },
    );
    ok('a save with the current version works', (await patch(fresh.version)).status === 200);
    const staleHttp = await patch(fresh.version);
    ok('the same version again: 409 with its code', staleHttp.status === 409 && (await staleHttp.json()).code === 'CHANGED_ELSEWHERE');
  } catch (err) {
    console.error(err);
    fail++;
  } finally {
    await wipe().catch((err) => { console.error('cleanup failed', err); fail++; });
    const left = await prisma.agency.count({ where: { name: { contains: TAG } } }) + await prisma.user.count({ where: { email: { contains: TAG } } }) + await prisma.pod.count({ where: { code: { contains: TAG } } });
    ok('nothing left behind', left === 0);
    await prisma.$disconnect();
    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
  }
})();
