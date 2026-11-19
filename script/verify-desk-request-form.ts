/**
 * The Desk, Module 29: the agency's "New request" form.
 *
 * The form's own rules (which types an agency may send, what is required, the
 * body it sends), then the same steps the form takes, through the real routes:
 * finding an account, reading its policies, and filing. Temporary agencies and
 * users only.
 * Run with:  npx tsx script/verify-desk-request-form.ts
 */
import 'dotenv/config';
import { readFileSync } from 'fs';
import { NextRequest } from 'next/server';
import type { UserRole } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { createSession } from '../lib/auth';
import { itemAllowed } from '../lib/desk/navigation';
import { TASK_TYPE_LABELS } from '../lib/desk/service-levels';
import {
  AGENCY_REQUEST_TYPES, REQUEST_DETAILS_MAX, REQUEST_TITLE_MAX, agencyMaySend, blankRequest, missingFields, requestDirty, requestPayload, suggestedTitle,
} from '../lib/desk/request-form';
import { POST as createRoute } from '../app/api/desk/tasks/route';
import { GET as insuredsRoute } from '../app/api/desk/insureds/route';
import { GET as insuredRoute } from '../app/api/desk/insureds/[id]/route';

let pass = 0, fail = 0;
const ok = (n: string, c: boolean) => {
  c ? pass++ : fail++;
  console.log(`  ${c ? '✓' : '✗'} ${n}`);
  if (!c && process.env.FAIL_FAST) throw new Error(`stopped at: ${n}`);
};

const TAG = `m29test${Date.now()}`;
const cleanup = { agencyIds: [] as string[], userIds: [] as string[] };
const read = (p: string) => readFileSync(p, 'utf8');

async function wipe() {
  const agencyId = { in: cleanup.agencyIds };
  await prisma.taskEvent.deleteMany({ where: { agencyId } });
  await prisma.task.updateMany({ where: { agencyId }, data: { parentTaskId: null } });
  await prisma.task.deleteMany({ where: { agencyId } });
  await prisma.policy.deleteMany({ where: { agencyId } });
  await prisma.insuredAssignment.deleteMany({ where: { agencyId } });
  await prisma.insuredAccount.deleteMany({ where: { agencyId } });
  await prisma.agencyDeskAssignment.deleteMany({ where: { agencyId } });
  await prisma.deskAuditLog.deleteMany({ where: { OR: [{ agencyId }, { actorId: { in: cleanup.userIds } }] } });
  await prisma.session.deleteMany({ where: { userId: { in: cleanup.userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: cleanup.userIds } } });
  await prisma.agency.deleteMany({ where: { id: agencyId } });
}

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const req = (url: string, token: string, method = 'GET', body?: unknown) => new NextRequest(`http://local.test${url}`, {
  method, headers: { cookie: `session_token=${token}` }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});
const answer = async (r: Response) => ({ status: r.status, json: await r.json().catch(() => null) as Json });

function rules() {
  console.log('Request types an agency may send');
  const types = AGENCY_REQUEST_TYPES.map((t) => t.type);
  ok('QA review is not one of them', !types.includes('QA_REVIEW') && !agencyMaySend('QA_REVIEW'));
  ok('every other type is', Object.keys(TASK_TYPE_LABELS).filter((t) => t !== 'QA_REVIEW').every((t) => types.includes(t as never)) && types.length === 13);
  ok('each has its label and a hint', AGENCY_REQUEST_TYPES.every((t) => t.label === TASK_TYPE_LABELS[t.type] && t.hint.length > 10));
  ok('nothing unknown accepted', !agencyMaySend('PASSWORD') && !agencyMaySend(null) && !agencyMaySend(['COI']));

  console.log('Title suggestion');
  ok('type and account', suggestedTitle('COI', 'Acme LLC') === 'COI – Acme LLC');
  ok('type alone', suggestedTitle('ENDORSEMENT', null) === 'Endorsement');
  ok('nothing before a type', suggestedTitle('', 'Acme LLC') === '');
  ok('a long account name is cut to fit', suggestedTitle('COI', 'x'.repeat(500)).length === REQUEST_TITLE_MAX);

  console.log('What must be filled in');
  const filled = { ...blankRequest('a'.repeat(24)), type: 'COI' as const, title: 'COI for Bob' };
  ok('a complete form is ready', missingFields(filled).length === 0);
  ok('no account chosen yet', missingFields({ ...filled, insuredId: '' }).length === 1);
  ok('"not about one account" is a choice', missingFields({ ...filled, insuredId: null }).length === 0);
  ok('no type', missingFields({ ...filled, type: '' }).some((m) => m.includes('type')));
  ok('a blank title', missingFields({ ...filled, title: '   ' }).some((m) => m.includes('title')));
  ok('a title too long', missingFields({ ...filled, title: 'x'.repeat(REQUEST_TITLE_MAX + 1) }).length === 1);
  ok('details too long', missingFields({ ...filled, description: 'x'.repeat(REQUEST_DETAILS_MAX + 1) }).length === 1);
  ok('details at the limit are fine', missingFields({ ...filled, description: 'x'.repeat(REQUEST_DETAILS_MAX) }).length === 0);

  console.log('The body sent');
  const id = 'b'.repeat(24), pid = 'c'.repeat(24);
  const body = requestPayload({ ...filled, insuredId: id, policyId: pid, title: '  COI  ', description: '  holder: Bob  ', complexity: 'COMPLEX' });
  ok('trimmed, with the account and policy', JSON.stringify(body) === JSON.stringify({ type: 'COI', title: 'COI', complexity: 'COMPLEX', description: 'holder: Bob', insuredId: id, policyId: pid }));
  const bare = requestPayload({ ...filled, insuredId: null, policyId: pid, description: '   ' });
  ok('no account: no policy and no blank details', !('insuredId' in bare) && !('policyId' in bare) && !('description' in bare));

  console.log('Unsaved changes');
  const start = blankRequest(id);
  ok('an untouched form', !requestDirty(start, start));
  ok('a type chosen', requestDirty({ ...start, type: 'COI' }, start));
  ok('details typed', requestDirty({ ...start, description: 'x' }, start));
  ok('whitespace only is not a change', !requestDirty({ ...start, description: '  ' }, start));
  ok('another account', requestDirty({ ...start, insuredId: null }, start));
}

(async () => {
  try {
    rules();

    const mkAgency = async (n: string) => { const a = await prisma.agency.create({ data: { name: `${TAG} ${n}`, deskEnabled: true } }); cleanup.agencyIds.push(a.id); return a; };
    const mkUser = async (n: string, role: UserRole, agencyId: string | null = null, extra: object = {}) => {
      const u = await prisma.user.create({ data: { email: `${TAG}-${n}@example.test`, role, agencyId, firstName: `${TAG}${n}`, lastName: 'Person', mustChangePassword: false, ...extra } });
      cleanup.userIds.push(u.id); return u;
    };
    const A = await mkAgency('A'), B = await mkAgency('B');
    const admin = await mkUser('admin', 'ADMIN', A.id);
    const producer = await mkUser('producer', 'AGENT', A.id, { bookAccess: 'ASSIGNED' });
    const csr = await mkUser('csr', 'CSR', A.id, { bookAccess: 'ASSIGNED' });
    const am = await mkUser('am', 'ACCOUNT_MANAGER');
    await prisma.agencyDeskAssignment.create({ data: { agencyId: A.id, primaryAmId: am.id } });
    const account = (agencyId: string, name: string, extra: object = {}) => prisma.insuredAccount.create({ data: { agencyId, name, nameKey: name.toLowerCase(), ...extra } });
    const acme = await account(A.id, `${TAG} Acme Roofing`, { dba: `${TAG} Acme DBA`, city: 'Austin', state: 'TX' });
    const zen = await account(A.id, `${TAG} Zen Bakery`);
    const closed = await account(A.id, `${TAG} Closed Diner`, { status: 'INACTIVE' });
    const other = await account(B.id, `${TAG} B Client`);
    await prisma.insuredAssignment.create({ data: { agencyId: A.id, insuredId: acme.id, userId: producer.id, role: 'PRODUCER' } });
    const p1 = await prisma.policy.create({ data: { agencyId: A.id, insuredId: acme.id, policyNumber: `${TAG}-GL`, lineOfBusiness: 'GL', carrierName: 'Carrier X', expirationDate: new Date('2027-06-01') } });
    const zenPolicy = await prisma.policy.create({ data: { agencyId: A.id, insuredId: zen.id, policyNumber: `${TAG}-ZEN` } });
    const bPolicy = await prisma.policy.create({ data: { agencyId: B.id, insuredId: other.id, policyNumber: `${TAG}-B` } });

    const [tAdmin, tProducer, tCsr, tAm] = await Promise.all([admin, producer, csr, am].map((u) => createSession(u.id)));
    const search = async (token: string, q: string) => answer(await insuredsRoute(req(`/api/desk/insureds?status=ACTIVE&pageSize=8&q=${encodeURIComponent(q)}`, token)));
    const open = async (token: string, id: string) => answer(await insuredRoute(req(`/api/desk/insureds/${id}`, token), { params: Promise.resolve({ id }) }));
    const file = async (token: string, body: unknown) => answer(await createRoute(req('/api/desk/tasks', token, 'POST', body)));
    const names = (r: { json: Json }) => (r.json.insureds as { name: string }[]).map((a) => a.name.replace(`${TAG} `, '')).sort().join();

    console.log('Who reaches the form');
    for (const role of ['ADMIN', 'AGENT', 'CSR']) ok(`${role}: the page is open to them`, itemAllowed('/desk/requests/new', role));

    console.log('Finding an account');
    ok('Owner / Admin: by name, active accounts only', names(await search(tAdmin, TAG)) === 'Acme Roofing,Zen Bakery');
    ok('by DBA', names(await search(tAdmin, `${TAG} Acme DBA`)) === 'Acme Roofing');
    ok('by policy number', names(await search(tAdmin, `${TAG}-ZEN`)) === 'Zen Bakery');
    ok('the details the list shows', (await search(tAdmin, `${TAG} Acme`)).json.insureds[0].city === 'Austin');
    ok('Producer: only their assigned accounts', names(await search(tProducer, TAG)) === 'Acme Roofing');
    ok('CSR with none assigned: nothing', (await search(tCsr, TAG)).json.insureds.length === 0);
    ok('another agency\'s account never appears', !names(await search(tAdmin, TAG)).includes('B Client'));

    console.log('Opening an account to read its policies');
    const acmeView = await open(tAdmin, acme.id);
    ok('its policies come with it', acmeView.status === 200 && acmeView.json.policies.length === 1 && acmeView.json.policies[0].policyNumber === `${TAG}-GL`);
    ok('with the fields the picker shows', acmeView.json.policies[0].expirationDate === '2027-06-01' && acmeView.json.policies[0].carrierName === 'Carrier X');
    ok('Producer: an account not assigned to them is a 404 (a link from elsewhere)', (await open(tProducer, zen.id)).status === 404);
    ok('another agency\'s account: 404', (await open(tAdmin, other.id)).status === 404);
    ok('an inactive account opens, so the form can say why it can\'t be used', (await open(tAdmin, closed.id)).json.status === 'INACTIVE');

    console.log('Sending');
    const sent = await file(tAdmin, requestPayload({ ...blankRequest(acme.id), policyId: p1.id, type: 'COI', title: suggestedTitle('COI', `${TAG} Acme Roofing`), description: 'Holder: City of Austin' }));
    ok('the form\'s body is accepted', sent.status === 201);
    ok('the answer has what the confirmation shows', sent.json.reference > 0 && sent.json.typeLabel === 'COI' && sent.json.statusLabel === 'Received' && sent.json.insured?.name === `${TAG} Acme Roofing`);
    ok('and nothing internal', !('dueAt' in sent.json) && !('podId' in sent.json) && !('assignee' in sent.json) && !('slaDueAt' in sent.json));
    const saved = await prisma.task.findUniqueOrThrow({ where: { id: sent.json.id } });
    ok('saved as the agency\'s, on that account and policy', saved.agencyId === A.id && saved.insuredId === acme.id && saved.policyId === p1.id && saved.source === 'AGENCY' && saved.createdById === admin.id);
    ok('complexity defaults to standard', saved.complexity === 'STANDARD');
    const complex = await file(tAdmin, requestPayload({ ...blankRequest(acme.id), type: 'ENDORSEMENT', title: 'Add 3 vehicles', complexity: 'COMPLEX' }));
    ok('complex is kept', complex.status === 201 && complex.json.complexity === 'COMPLEX');
    const general = await file(tAdmin, requestPayload({ ...blankRequest(null), type: 'OTHER', title: `${TAG} general question` }));
    ok('a request not about one account', general.status === 201 && general.json.insured === null);
    ok('Producer: for their assigned account', (await file(tProducer, requestPayload({ ...blankRequest(acme.id), type: 'COI', title: 'COI' }))).status === 201);
    ok('Producer: not for another account', (await file(tProducer, requestPayload({ ...blankRequest(zen.id), type: 'COI', title: 'COI' }))).status === 404);
    ok('CSR: a request not about one account', (await file(tCsr, requestPayload({ ...blankRequest(null), type: 'OTHER', title: 'Question' }))).status === 201);

    console.log('Refused');
    const qa = await file(tAdmin, { type: 'QA_REVIEW', title: 'QA' });
    ok('an agency can\'t send a QA review: 400', qa.status === 400 && /request type/.test(qa.json.error));
    ok('nor an unknown type', (await file(tAdmin, { type: 'PASSWORD', title: 'x' })).status === 400);
    ok('an Account Manager still can, for the agency', (await file(tAm, { type: 'QA_REVIEW', title: `${TAG} QA`, agencyId: A.id })).status === 201);
    const inactive = await file(tAdmin, requestPayload({ ...blankRequest(closed.id), type: 'COI', title: 'COI' }));
    ok('an inactive account: 409 with the reason', inactive.status === 409 && /inactive/i.test(inactive.json.error));
    ok('a policy from another of the agency\'s accounts: 404', (await file(tAdmin, { type: 'COI', title: 'x', insuredId: acme.id, policyId: zenPolicy.id })).status === 404);
    ok('another agency\'s policy: 404', (await file(tAdmin, { type: 'COI', title: 'x', policyId: bPolicy.id })).status === 404);
    ok('no title: 400', (await file(tAdmin, { type: 'COI', title: '  ' })).status === 400);
    ok('a title over the limit: 400', (await file(tAdmin, { type: 'COI', title: 'x'.repeat(REQUEST_TITLE_MAX + 1) })).status === 400);
    ok('details over the limit: 400', (await file(tAdmin, { type: 'COI', title: 'x', description: 'x'.repeat(REQUEST_DETAILS_MAX + 1) })).status === 400);
    const audit = await prisma.deskAuditLog.findFirst({ where: { action: 'task.created', entityId: sent.json.id } });
    ok('filing is logged, without the details text', !!audit && !JSON.stringify(audit.metadata).includes('City of Austin'));
    ok('refused requests created nothing', await prisma.task.count({ where: { agencyId: A.id } }) === 6);

    console.log('The screens');
    const form = read('app/components/desk/requests/RequestForm.tsx');
    ok('the form lists only the agency types', form.includes('AGENCY_REQUEST_TYPES.map') && !form.includes('TASK_TYPE_LABELS'));
    ok('searches active accounts only', form.includes('/api/desk/insureds?status=ACTIVE'));
    ok('warns against passwords', form.includes('Never enter passwords or carrier logins'));
    ok('shows no due date or target', !/dueAt|slaDue|slaTarget|overdue/i.test(form));
    ok('the account page links to the form', read('app/components/desk/accounts/AccountDetail.tsx').includes('/desk/requests/new?insuredId='));
    ok('the page takes only a well-formed account id', read('app/(desk)/desk/requests/new/page.tsx').includes('/^[a-f0-9]{24}$/i'));
  } catch (err) {
    console.error(err);
    fail++;
  } finally {
    try {
      await wipe();
      const left = await prisma.user.count({ where: { email: { startsWith: TAG } } }) + await prisma.agency.count({ where: { name: { startsWith: TAG } } });
      ok('nothing left behind', left === 0);
    } catch (err) {
      console.error('cleanup failed', err);
      fail++;
    }
    console.log(`\n${pass} passed, ${fail} failed`);
    await prisma.$disconnect();
    process.exit(fail ? 1 : 0);
  }
})();
