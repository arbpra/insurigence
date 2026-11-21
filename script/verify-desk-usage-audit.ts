/**
 * Module 43: service usage against plan allowances, and the audit log viewer.
 *
 *   npx tsx script/verify-desk-usage-audit.ts
 *
 * Usage: included, overage (invoiced or not), non-billable and not yet
 * classified units per category, for the month the work was completed in;
 * the plan's allowance, an agency's override, unlimited and not set up; what
 * is left; managed accounts against the plan; the plan's price; agencies with
 * no plan, with The Desk off; the order; one agency's tasks, logged. The
 * audit log: filters (action or group, agency, who, record, dates in the Desk
 * time zone), pages, newest first, names, redaction, the CSV export and its
 * guard against spreadsheet formulas, reading and exporting logged, strict
 * filters. Operations Managers only. Against the shared database with
 * temporary agencies, people, plans, tasks and audit entries, all removed at
 * the end; the usage month is one no real work can be in.
 */
import 'dotenv/config';
import { readFileSync } from 'fs';
import type { BillingClass, BillingStatus, Prisma, ServiceCategory, UserRole } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { DeskAccessError, resolveDeskScope } from '../lib/desk/access';
import { recordAudit } from '../lib/desk/audit';
import { billingPeriodOf } from '../lib/desk/billing';
import { addCalendarDays, loadBusinessCalendar, zonedInstant } from '../lib/desk/business-time';
import { getAgencyUsage, getUsage, recentPeriods, usagePeriod } from '../lib/desk/usage';
import { AUDIT_PAGE_SIZE, auditFilters, csvField, exportAudit, listAudit } from '../lib/desk/audit-log';
import { allowanceCell, auditQuery, describeAction, monthLabel } from '../lib/desk/usage-view';
import { itemAllowed } from '../lib/desk/navigation';

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, detail: unknown = '') => {
  c ? pass++ : fail++;
  console.log(`  ${c ? '✓' : '✗'} ${n}${!c && detail !== '' ? `  [${typeof detail === 'string' ? detail : JSON.stringify(detail)}]` : ''}`);
  if (!c && process.env.FAIL_FAST) throw new Error(`stopped at: ${n}`);
};

const TAG = `m43test${Date.now()}`;
const REC = `${TAG}Rec`;
const P = '2031-03';
const cleanup = { agencyIds: [] as string[], userIds: [] as string[], planIds: [] as string[] };
type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const read = (p: string) => readFileSync(p, 'utf8');
const params = (o: Record<string, string>) => new URLSearchParams(o);

async function wipe() {
  const agencyId = { in: cleanup.agencyIds };
  await prisma.task.deleteMany({ where: { agencyId } });
  await prisma.insuredAccount.deleteMany({ where: { agencyId } });
  await prisma.agencyAllowanceOverride.deleteMany({ where: { agencyDeskPlan: { is: { agencyId } } } });
  await prisma.agencyDeskPlan.deleteMany({ where: { agencyId } });
  await prisma.deskPlanAllowance.deleteMany({ where: { planId: { in: cleanup.planIds } } });
  await prisma.deskPlan.deleteMany({ where: { id: { in: cleanup.planIds } } });
  await prisma.deskAuditLog.deleteMany({ where: { OR: [{ agencyId }, { actorId: { in: cleanup.userIds } }, { entityType: { startsWith: TAG } }] } });
  await prisma.session.deleteMany({ where: { userId: { in: cleanup.userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: cleanup.userIds } } });
  await prisma.agency.deleteMany({ where: { id: agencyId } });
}

const refused = async (fn: () => Promise<unknown>, status: number) => {
  try { await fn(); return false; } catch (err) { return err instanceof DeskAccessError && err.status === status; }
};
const badFilters = (o: Record<string, string>) => { try { auditFilters(params(o)); return false; } catch (err) { return err instanceof DeskAccessError && err.status === 400; } };

function pureLogic() {
  console.log('Months');
  ok('the months offered: this one and the eleven before, across a year end', recentPeriods('2026-02', 3).join() === '2026-02,2026-01,2025-12' && recentPeriods('2026-03', 2).join() === '2026-03,2026-02' && recentPeriods('2026-12').at(-1) === '2026-01' && recentPeriods('2026-11').length === 12);
  const now = new Date('2026-12-01T03:00:00Z'); // 30 November, 10pm in New York
  ok('this month by default, in the Desk time zone', usagePeriod(null, now, 'America/New_York') === '2026-11' && usagePeriod('', now, 'UTC') === '2026-12');
  const bad = (v: string) => { try { usagePeriod(v, now, 'UTC'); return false; } catch (err) { return err instanceof DeskAccessError && err.status === 400; } };
  ok('a month is YYYY-MM; anything else is refused', usagePeriod('2031-03', now, 'UTC') === '2031-03' && ['2031-13', '2031-00', '2031-3', 'March', '2031-03-01'].every(bad));
  ok('month names', monthLabel('2031-03') === 'March 2031' && monthLabel('2026-12') === 'December 2026');

  console.log('Showing a category');
  ok('used of the allowance, and what is left', JSON.stringify(allowanceCell({ allowance: 10, included: 4, overage: 0, pending: 0, remaining: 6 })) === JSON.stringify({ used: '4 of 10', note: '6 left' }));
  ok('over: the overage first, nothing "left"', allowanceCell({ allowance: 10, included: 10, overage: 3, pending: 0, remaining: 0 }).note === '+3 over');
  ok('unlimited, and not set up', allowanceCell({ allowance: 'unlimited', included: 2, overage: 0, pending: 0, remaining: null }).used === '2 (unlimited)'
    && allowanceCell({ allowance: null, included: 1, overage: 0, pending: 1, remaining: null }).note === 'no allowance set up · 1 not yet classified');
  ok('action names read as words', describeAction('task.viewed') === 'Task viewed' && describeAction('follow_up_rule.changed') === 'Follow up rule changed');
  ok('the audit query leaves out empty filters and page 1', auditQuery({ action: 'task', agencyId: '', actor: ' ann ', entityType: '', entityId: '', from: '2026-01-01', to: '', page: 1 }) === 'action=task&actor=ann&from=2026-01-01'
    && auditQuery({ action: '', agencyId: '', actor: '', entityType: '', entityId: '', from: '', to: '', page: 3 }) === 'page=3');

  console.log('The CSV');
  ok('every field quoted, quotes doubled, nothing for empty', csvField('a "b"') === '"a ""b"""' && csvField(null) === '""' && csvField(undefined) === '""' && csvField({ a: 1 }) === '"{""a"":1}"');
  ok('a value a spreadsheet would run as a formula is made plain text', ['=1+1', '+1', '-1', '@SUM(A1)', '\t=1'].every((v) => csvField(v).startsWith(`"'`)) && csvField('plain') === '"plain"');

  console.log('Audit filters');
  const f = auditFilters(params({ action: 'task', agencyId: '6affb786458046fc5be689d4', actor: ' Ann ', from: '2026-01-01', to: '2026-01-31', page: '2' }));
  ok('read as given, trimmed', f.action === 'task' && f.actor === 'Ann' && f.page === 2 && f.from === '2026-01-01' && auditFilters(params({})).page === 1);
  ok('an action or a group of them; anything else refused', !badFilters({ action: 'task.viewed' }) && !badFilters({ action: 'document' }) && badFilters({ action: 'nope' }) && badFilters({ action: 'task.' }));
  ok('dates must be real days, the start not after the end', badFilters({ from: '2026-02-30' }) && badFilters({ to: '2026/01/01' }) && badFilters({ from: '2026-02-02', to: '2026-02-01' }));
  ok('a malformed agency, a bad page or an overlong filter is refused', badFilters({ agencyId: 'x' }) && badFilters({ page: '0' }) && badFilters({ page: '1.5' }) && badFilters({ actor: 'x'.repeat(101) }));
}

(async () => {
  try {
    pureLogic();
    const cal = await loadBusinessCalendar(prisma);

    const mkAgency = async (n: string, deskEnabled = true) => { const a = await prisma.agency.create({ data: { name: `${TAG} ${n}`, deskEnabled } }); cleanup.agencyIds.push(a.id); return a; };
    const mkUser = async (n: string, role: UserRole, agencyId: string | null = null) => {
      const u = await prisma.user.create({ data: { email: `${TAG}-${n}@example.test`, role, agencyId, firstName: `${TAG}${n}`, lastName: 'Tester', passwordHash: 'x', mustChangePassword: false } });
      cleanup.userIds.push(u.id); return u;
    };
    const A = await mkAgency('Harbor');
    const B = await mkAgency('Basin');
    const C = await mkAgency('Cove', false);
    const D = await mkAgency('Dune', false);
    const ops = await mkUser('ops', 'DESK_ADMIN');
    const am = await mkUser('am', 'ACCOUNT_MANAGER');
    const va = await mkUser('va', 'DESK_VA');
    const owner = await mkUser('owner', 'ADMIN', A.id);
    await prisma.agencyDeskAssignment.create({ data: { agencyId: A.id, primaryAmId: am.id } });

    // Plan X: COI 10, endorsements 2 (Harbor's override: 5), renewals unlimited; nothing set for the rest. Three accounts.
    const X = await prisma.deskPlan.create({ data: { code: `${TAG}-X`, name: `${TAG} Growth`, monthlyPriceCents: BigInt(250_000), managedAccounts: 3 } });
    const Y = await prisma.deskPlan.create({ data: { code: `${TAG}-Y`, name: `${TAG} Complete`, monthlyPriceCents: BigInt(400_000), priceIsStartingAt: true } });
    cleanup.planIds.push(X.id, Y.id);
    await prisma.deskPlanAllowance.createMany({ data: [
      { planId: X.id, category: 'COI', monthlyUnits: 10 }, { planId: X.id, category: 'ENDORSEMENT', monthlyUnits: 2 }, { planId: X.id, category: 'RENEWAL', monthlyUnits: null },
    ] });
    const aPlan = await prisma.agencyDeskPlan.create({ data: { agencyId: A.id, planId: X.id, startsOn: new Date('2026-01-01') } });
    await prisma.agencyAllowanceOverride.create({ data: { agencyDeskPlanId: aPlan.id, category: 'ENDORSEMENT', monthlyUnits: 5 } });
    await prisma.agencyDeskPlan.create({ data: { agencyId: C.id, planId: Y.id, startsOn: new Date('2026-01-01'), managedAccountsOverride: 7 } });
    for (let i = 0; i < 5; i++) {
      await prisma.insuredAccount.create({ data: { agencyId: A.id, name: `${TAG} insured ${i}`, nameKey: `${TAG} insured ${i}`, status: i === 4 ? 'INACTIVE' : 'ACTIVE' } });
    }

    const base = Date.now() % 40_000_000;
    let n = 0;
    const done = (agencyId: string, category: ServiceCategory | null, cls: BillingClass | null, units = 1, extra: Partial<Prisma.TaskUncheckedCreateInput> = {}) => {
      n += 1;
      const status: BillingStatus | null = cls === 'OVERAGE' ? 'UNBILLED' : cls ? 'NOT_APPLICABLE' : null;
      return prisma.task.create({ data: {
        reference: 957_000_000 + base + n, agencyId, type: 'COI', title: `${TAG} task ${n}`, status: 'COMPLETED', completedAt: new Date('2031-03-10T15:00:00Z'),
        serviceCategory: category, billableUnits: units, billingClass: cls, billingStatus: status, billingPeriod: P, restrictedToUserIds: [], ...extra,
      } });
    };
    await done(A.id, 'COI', 'INCLUDED'); await done(A.id, 'COI', 'INCLUDED'); await done(A.id, 'COI', 'INCLUDED', 2);
    await done(A.id, 'COI', 'OVERAGE'); await done(A.id, 'COI', 'OVERAGE', 2, { billingStatus: 'BILLED' });
    await done(A.id, 'ENDORSEMENT', 'INCLUDED', 5, { type: 'ENDORSEMENT' });
    await done(A.id, 'RENEWAL', 'INCLUDED', 1, { type: 'RENEWAL' }); await done(A.id, 'RENEWAL', 'INCLUDED', 1, { type: 'RENEWAL' });
    await done(A.id, 'SERVICE', null, 1, { type: 'OTHER' }); // not yet classified
    await done(A.id, 'SERVICE', 'NON_BILLABLE', 1, { type: 'QA_REVIEW', nonBillable: true });
    await done(A.id, null, 'INCLUDED', 1, { type: 'ACORD' }); // no category recorded: general service
    await done(A.id, 'SERVICE', null, 1, { type: 'AMS_ENTRY', nonBillable: true }); // non-billable, never pending
    // Not this month's: cancelled, another month.
    await done(A.id, 'COI', 'INCLUDED', 1, { status: 'CANCELLED' });
    await done(A.id, 'COI', 'INCLUDED', 1, { billingPeriod: '2031-02' });
    await done(B.id, 'COI', null);
    // Older work has no billing fields at all (unset, not null): still not yet classified.
    const bUnset = await done(B.id, 'ENDORSEMENT', null, 1, { type: 'ENDORSEMENT' });
    await prisma.$runCommandRaw({ update: 'Task', updates: [{ q: { _id: { $oid: bUnset.id } }, u: { $unset: { billingClass: '', billingStatus: '' } } }] });
    await done(C.id, 'COI', 'OVERAGE');

    const scope = (u: { id: string }) => resolveDeskScope(prisma, u.id);
    const [sOps, sAm, sVa, sOwner] = await Promise.all([ops, am, va, owner].map(scope));

    console.log('Usage for the month');
    const u = await getUsage(prisma, sOps, { period: P });
    const rowOf = (id: string) => u.agencies.find((a) => a.id === id)!;
    const a = rowOf(A.id);
    const cat = (r: typeof a, c: ServiceCategory) => r.categories.find((x) => x.category === c)!;
    ok('the month asked for, and the months offered', u.period === P && u.periods.length === 12 && u.periods[0] === billingPeriodOf(new Date(), cal.timeZone));
    ok('COIs: included 4 of 10, 6 left; 3 over, 1 of them not yet invoiced', JSON.stringify(cat(a, 'COI')) === JSON.stringify({ category: 'COI', label: 'COIs', allowance: 10, included: 4, overage: 3, overageUnbilled: 1, nonBillable: 0, pending: 0, remaining: 6 }), cat(a, 'COI'));
    ok('endorsements: the agency\'s own allowance (5) over the plan\'s (2), used up', cat(a, 'ENDORSEMENT').allowance === 5 && cat(a, 'ENDORSEMENT').included === 5 && cat(a, 'ENDORSEMENT').remaining === 0);
    ok('renewals: unlimited, nothing "left"', cat(a, 'RENEWAL').allowance === 'unlimited' && cat(a, 'RENEWAL').included === 2 && cat(a, 'RENEWAL').remaining === null);
    ok('a category the plan has no allowance for: shown as not set up', cat(a, 'REMARKETING').allowance === null && cat(a, 'REMARKETING').included === 0);
    ok('general service: work with no category recorded counts here, and one not yet classified', cat(a, 'SERVICE').included === 1 && cat(a, 'SERVICE').pending === 1 && cat(a, 'SERVICE').nonBillable === 1, cat(a, 'SERVICE'));
    ok('non-billable work never counts as waiting to be classified', a.totals.pending === 1 && a.totals.nonBillable === 1);
    ok('the agency\'s totals; cancelled work and other months left out', JSON.stringify(a.totals) === JSON.stringify({ included: 12, overage: 3, overageUnbilled: 1, nonBillable: 1, pending: 1 }), a.totals);
    ok('the plan and its price', a.plan?.name === `${TAG} Growth` && a.plan.monthlyPriceCents === 250_000);
    ok('managed accounts: active ones against the plan\'s (4 of 3)', a.managedAccounts.active === 4 && a.managedAccounts.included === 3);
    const b = rowOf(B.id), c = rowOf(C.id);
    ok('an agency with no plan: everything not yet classified, no allowances', !b.plan && b.totals.pending === 2 && b.categories.every((x) => x.allowance === null) && b.managedAccounts.included === null);
    ok("…an agency's own number of accounts over the plan's", c.managedAccounts.included === 7, c.managedAccounts);
    ok('"starting at" pricing with no agency price: set per agency', c.plan?.name === `${TAG} Complete` && c.plan.monthlyPriceCents === null);
    ok('The Desk switched off: listed only while it has work in the month', !c.deskEnabled && c.totals.overage === 1 && !u.agencies.some((x) => x.id === D.id));
    const order = (id: string) => u.agencies.findIndex((x) => x.id === id);
    ok('those over an allowance first (Harbor, also waiting to be classified, before Cove), then those waiting to be classified, then the rest', order(A.id) === 0 && order(C.id) === 1 && order(B.id) === 2, [order(C.id), order(A.id), order(B.id)]);
    ok('the month\'s totals', u.totals.overAllowance === 2 && u.totals.overageUnbilled === 2 && u.totals.pending === 3 && u.totals.agencies === u.agencies.length, u.totals);
    const feb = await getUsage(prisma, sOps, { period: '2031-02' });
    ok('another month: only its work', feb.agencies.find((x) => x.id === A.id)?.totals.included === 1 && !feb.agencies.some((x) => x.id === C.id));

    console.log('One agency\'s month');
    const d = await getAgencyUsage(prisma, sOps, A.id, { period: P }, { ip: '203.0.113.9' });
    ok('each completed task of the month, with how it counted', d.tasks.length === 12 && d.agency.name === `${TAG} Harbor` && !d.truncated, d.tasks.length);
    ok('…included, overage (with whether invoiced), not yet classified, non-billable', d.tasks.filter((t) => t.billing === 'OVERAGE').map((t) => t.invoice).sort().join() === 'BILLED,UNBILLED'
      && d.tasks.filter((t) => t.billing === 'PENDING').length === 1 && d.tasks.filter((t) => t.billing === 'NON_BILLABLE').length === 2
      && d.tasks.find((t) => t.billing === 'PENDING')?.billingLabel === 'Not yet classified');
    ok('…a task with no category shown under general service', d.tasks.some((t) => t.typeLabel && t.category === 'General service' && t.billing === 'INCLUDED'));
    const viewed = await prisma.deskAuditLog.findFirst({ where: { actorId: ops.id, action: 'usage.viewed', entityId: A.id } });
    ok('opening it is logged, with the month', (viewed?.metadata as Json)?.period === P && viewed?.agencyId === A.id && viewed?.ipAddress === '203.0.113.9');
    ok('an unknown or malformed agency: not found', await refused(() => getAgencyUsage(prisma, sOps, '6affb786458046fc5be689d4', { period: P }), 404) && await refused(() => getAgencyUsage(prisma, sOps, 'nope', { period: P }), 404));

    console.log('Who may see it');
    ok('Account Managers, VAs and agency users are refused usage', (await Promise.all([sAm, sVa, sOwner].map((s) => refused(() => getUsage(prisma, s, { period: P }), 403)))).every(Boolean)
      && await refused(() => getAgencyUsage(prisma, sAm, A.id, { period: P }), 403));
    ok('…and the audit log', (await Promise.all([sAm, sVa, sOwner].map((s) => refused(() => listAudit(prisma, s, auditFilters(params({}))), 403)))).every(Boolean)
      && await refused(() => exportAudit(prisma, sAm, auditFilters(params({}))), 403));

    console.log('The audit log');
    // 60 entries over three days in the Desk time zone, under a record type of the test's own.
    const day1 = '2031-03-03', day2 = addCalendarDays(day1, 1), day3 = addCalendarDays(day1, 2);
    const actions = ['task.viewed', 'document.downloaded', 'access.denied'] as const;
    const entries: Prisma.DeskAuditLogCreateManyInput[] = [];
    for (let i = 0; i < 60; i++) {
      const day = [day1, day2, day3][i % 3];
      entries.push({
        action: actions[i % 3], entityType: REC, entityId: `rec-${i}`, agencyId: i % 2 ? A.id : B.id,
        actorId: i % 4 === 0 ? null : i % 4 === 1 ? am.id : ops.id, actorRole: i % 4 === 0 ? null : i % 4 === 1 ? 'ACCOUNT_MANAGER' : 'DESK_ADMIN',
        metadata: { n: i }, ipAddress: '198.51.100.7', createdAt: zonedInstant(day, 9 * 60 + i, cal.timeZone),
      });
    }
    // The edges of day 2: its last minute, and the first of day 3.
    entries.push({ action: 'task.viewed', entityType: REC, entityId: 'late', actorId: ops.id, createdAt: zonedInstant(day2, 24 * 60 - 1, cal.timeZone) });
    entries.push({ action: 'task.viewed', entityType: REC, entityId: 'midnight', actorId: ops.id, createdAt: zonedInstant(day3, 0, cal.timeZone) });
    entries.push({ action: 'task.viewed', entityType: REC, entityId: 'gone', actorId: '6affb786458046fc5be689d4', actorRole: 'DESK_VA', createdAt: zonedInstant(day1, 8 * 60, cal.timeZone) });
    entries.push({ action: 'task.viewed', entityType: REC, entityId: '=HYPERLINK("http://x.test","click")', actorId: ops.id, createdAt: zonedInstant(day1, 7 * 60, cal.timeZone) });
    await prisma.deskAuditLog.createMany({ data: entries });
    await recordAudit(prisma, { actor: { id: ops.id, role: 'DESK_ADMIN' }, action: 'task.updated', entityType: REC, entityId: 'secret', metadata: { password: 'hunter2', apiKey: 'k', note: 'fine' } });
    const ALL = 65;
    // An action outside every group that starts with a group's name: a group means its own actions only.
    const OTHER = `${TAG}Other`;
    await prisma.deskAuditLog.create({ data: { action: 'tasks.legacy', entityType: OTHER, entityId: 'x' } });
    const list = (o: Record<string, string>) => listAudit(prisma, sOps, auditFilters(params({ entityType: REC, ...o })), { ip: '192.0.2.1' });

    const p1 = await list({});
    ok('pages of 50, newest first, with the total', p1.total === ALL && p1.rows.length === AUDIT_PAGE_SIZE && p1.rows.every((r, i) => i === 0 || r.at <= p1.rows[i - 1].at), p1.total);
    const p2 = await list({ page: '2' });
    ok('…the next page has the rest, none repeated', p2.rows.length === ALL - AUDIT_PAGE_SIZE && !p2.rows.some((r) => p1.rows.some((x) => x.id === r.id)));
    ok('one action', (await list({ action: 'access.denied' })).total === 20);
    ok('a group of actions ("document")', (await list({ action: 'document' })).total === 20 && (await list({ action: 'task' })).total === 25);
    const other = (o: Record<string, string>) => listAudit(prisma, sOps, auditFilters(params({ entityType: OTHER, ...o })));
    const others = [(await other({})).total, (await other({ action: 'task' })).total];
    ok('…and only its own: not another action that starts with the same word', others.join() === '1,0', others);
    ok('one agency', (await list({ agencyId: A.id })).total === 30);
    const sys = await list({ actor: 'system' });
    ok('automatic actions ("system"): those with nobody as the actor', sys.total === 15 && sys.rows.every((r) => r.actor === null));
    const byAm = await list({ actor: `${TAG}am tester` });
    ok('who: by name, every word matched, any case', byAm.total === 15 && byAm.rows.every((r) => r.actor?.id === am.id), byAm.total);
    ok('…or by email, dots and all', (await list({ actor: `${TAG}-am@example.test` })).total === 15);
    ok('…punctuation is searched for, not obeyed', (await list({ actor: '(' })).total === 0 && (await list({ actor: '.*' })).total === 0);
    ok('one record', (await list({ entityId: 'rec-7' })).total === 1);
    const d2 = await list({ from: day2, to: day2 });
    ok('dates, in the Desk time zone: its last minute in, the next day\'s first out', d2.total === 21 && d2.rows.some((r) => r.entityId === 'late') && !d2.rows.some((r) => r.entityId === 'midnight'), d2.total);
    ok('from a day on, and up to a day', (await list({ from: day3 })).total === 21 && (await list({ to: day1 })).total === 23);
    const r7 = (await list({ entityId: 'rec-7' })).rows[0];
    ok('each entry with who (name, email, role), the agency\'s name, the details and where from', r7.actor?.name === `${TAG}ops Tester` && r7.actor.email === `${TAG}-ops@example.test` && r7.actor.role === 'DESK_ADMIN'
      && r7.agency?.name === `${TAG} Harbor` && (r7.metadata as Json).n === 7 && r7.ip === '198.51.100.7', r7);
    ok('someone since removed: still shown, as removed', (await list({ entityId: 'gone' })).rows[0].actor?.name === 'Removed user');
    const sec = (await list({ entityId: 'secret' })).rows[0];
    ok('passwords and keys were never kept: redacted', (sec.metadata as Json).password === '[redacted]' && (sec.metadata as Json).apiKey === '[redacted]' && (sec.metadata as Json).note === 'fine');
    ok('the choices for the filters', p1.choices.actions.includes('audit.exported') && p1.choices.groups.includes('task') && p1.choices.agencies.some((x) => x.id === A.id) && !p1.choices.agencies.some((x) => x.id === C.id));
    const looked = await prisma.deskAuditLog.findMany({ where: { actorId: ops.id, action: 'audit.viewed' }, orderBy: { createdAt: 'asc' } });
    ok('reading the log is logged, each time, with the filters and where from', looked.length >= 15 && looked.filter((l) => (l.metadata as Json).filters.entityType !== OTHER).every((l) => (l.metadata as Json).filters.entityType === REC && l.ipAddress === '192.0.2.1')
      && looked.some((l) => (l.metadata as Json).filters.actor === 'system') && looked.some((l) => (l.metadata as Json).page === 2), looked.length);

    console.log('The CSV export');
    const ex = await exportAudit(prisma, sOps, auditFilters(params({ entityType: REC })), { ip: '192.0.2.1' });
    const lines = ex.csv.trimEnd().split('\r\n');
    ok('a header and every entry the filters choose', lines.length === ALL + 1 && ex.rows === ALL && !ex.truncated && lines[0].startsWith('"When (UTC)","Action","Who"'), lines.length);
    ok('automatic actions read "System"', lines.some((l) => l.includes('"System"')));
    ok('a record named like a formula is exported as plain text', lines.some((l) => l.includes(`"'=HYPERLINK(""http://x.test"",""click"")"`)) && !lines.some((l) => l.includes(',"=HYPERLINK')));
    ok('redacted values stay redacted', lines.some((l) => l.includes('[redacted]')) && !ex.csv.includes('hunter2'));
    const exported = await prisma.deskAuditLog.findFirst({ where: { actorId: ops.id, action: 'audit.exported' } });
    ok('exporting is logged, with the filters and how many', (exported?.metadata as Json)?.rows === ALL && (exported?.metadata as Json)?.filters.entityType === REC);

    console.log('The code');
    for (const [f, label] of [['app/api/desk/usage/route.ts', 'usage'], ['app/api/desk/usage/[agencyId]/route.ts', 'one agency\'s usage'], ['app/api/desk/audit/route.ts', 'the audit log']] as const) {
      ok(`the ${label} route: Operations Managers only, refusals logged`, read(f).includes('deskAdminRequest(prisma, request'));
    }
    const auditRoute = read('app/api/desk/audit/route.ts');
    ok('the CSV download: an attachment, never cached', auditRoute.includes("format') === 'csv'") && auditRoute.includes('attachment; filename=') && auditRoute.includes("'cache-control': 'no-store'"));
    ok('the log can only be read here: nothing changes or removes an entry', !/deskAuditLog\.(update|delete|upsert)/.test(read('lib/desk/audit-log.ts')));
    ok('the page: Operations Managers and the Super Admin only', itemAllowed('/desk-ops/usage', 'DESK_ADMIN') && itemAllowed('/desk-ops/usage', 'SUPER_ADMIN')
      && !['ACCOUNT_MANAGER', 'DESK_VA', 'ADMIN'].some((r) => itemAllowed('/desk-ops/usage', r)));
    const page = read('app/(desk)/desk-ops/usage/page.tsx');
    const view = read('app/components/desk/usage/UsageAuditView.tsx');
    ok('the page is built and checks access first', page.includes('<UsageAuditView />') && page.includes("deskPageAccess('OPS', '/desk-ops/usage')") && !page.includes('DeskPage '));
    ok('the screen: the month, the agency table and its tasks; the log\'s filters, pages and download', ['desk-usage-month', 'desk-usage-agencies', 'desk-usage-detail', 'desk-audit-filters', 'desk-audit-pages', 'desk-audit-export', 'desk-audit-details'].every((id) => view.includes(id)));
    ok('…and says usage is tracked, not invoiced', view.includes('invoicing is not part of The Desk yet'));
  } catch (err) {
    fail++;
    console.error(err);
  } finally {
    await wipe();
    const leftUsers = await prisma.user.count({ where: { email: { startsWith: TAG } } });
    const leftTasks = await prisma.task.count({ where: { title: { startsWith: TAG } } });
    const leftAgencies = await prisma.agency.count({ where: { name: { startsWith: TAG } } });
    const leftPlans = await prisma.deskPlan.count({ where: { code: { startsWith: TAG } } });
    const leftAudit = await prisma.deskAuditLog.count({ where: { entityType: { startsWith: TAG } } });
    ok('nothing left behind', leftUsers + leftTasks + leftAgencies + leftPlans + leftAudit === 0, [leftUsers, leftTasks, leftAgencies, leftPlans, leftAudit]);
    await prisma.$disconnect();
    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
  }
})();
