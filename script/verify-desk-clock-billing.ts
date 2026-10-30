/**
 * The Desk, Module 13: service-level clock pause / resume and billing capture.
 *
 * Part 1 checks the clock arithmetic (clockChange) on fixed dates. Part 2
 * drives real tasks through waiting and back, with wait start times moved
 * into the past so the pause covers real business hours. Part 3 completes
 * work against a temporary plan's allowances: included, overage,
 * unlimited, non-billable, not configured, no plan, overrides, reopening,
 * late classification once allowances exist, invoiced work, and
 * simultaneous completions. Uses temporary records only.
 * Run with:  npx tsx script/verify-desk-clock-billing.ts
 */
import 'dotenv/config';
import type { Task, UserRole } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { resolveDeskScope, DeskAccessError, type DeskScope } from '../lib/desk/access';
import { createTask, changeTaskStatus, assignTask, addTaskNote, clockChange } from '../lib/desk/tasks';
import { allowanceUsed, classifyPendingBilling } from '../lib/desk/billing-capture';
import { billingPeriodOf } from '../lib/desk/billing';
import { type BusinessCalendar, businessMinutesBetween, zonedInstant, loadBusinessCalendar } from '../lib/desk/business-time';
import { DEFAULT_CALENDAR, DEFAULT_HOLIDAYS } from '../lib/desk/defaults';

let pass = 0, fail = 0;
const ok = (n: string, c: boolean) => { c ? pass++ : fail++; console.log(`  ${c ? '✓' : '✗'} ${n}`); };
const status = async (fn: () => Promise<unknown>) => {
  try { await fn(); return 200; } catch (e) { if (e instanceof DeskAccessError) return e.status; console.error(e); return 500; }
};

const TAG = `m13test-${Date.now()}`;
const cleanup = { agencyIds: [] as string[], userIds: [] as string[], planIds: [] as string[] };

async function wipe() {
  const agencyId = { in: cleanup.agencyIds };
  await prisma.taskEvent.deleteMany({ where: { agencyId } });
  await prisma.task.deleteMany({ where: { agencyId } });
  await prisma.policy.deleteMany({ where: { agencyId } });
  await prisma.insuredAccount.deleteMany({ where: { agencyId } });
  await prisma.agencyDeskPlan.deleteMany({ where: { agencyId } });
  await prisma.deskPlan.deleteMany({ where: { id: { in: cleanup.planIds } } });
  await prisma.agencyDeskAssignment.deleteMany({ where: { agencyId } });
  for (const id of cleanup.agencyIds) {
    await prisma.$runCommandRaw({ delete: 'DeskCounter', deletes: [{ q: { _id: { $regex: `^allowance:${id}:` } }, limit: 0 }] });
  }
  await prisma.deskAuditLog.deleteMany({ where: { OR: [{ agencyId }, { actorId: { in: cleanup.userIds } }] } });
  await prisma.user.deleteMany({ where: { id: { in: cleanup.userIds } } });
  await prisma.agency.deleteMany({ where: { id: agencyId } });
}

(async () => {
  try {
    // ━━ Part 1: the clock, on fixed dates ━━
    console.log('\n━━ Clock arithmetic ━━');
    {
      const cal: BusinessCalendar = { ...DEFAULT_CALENDAR, workDays: [...DEFAULT_CALENDAR.workDays], holidays: DEFAULT_HOLIDAYS.map((h) => h.date) };
      const ny = (d: string, hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); return zonedInstant(d, h * 60 + m, cal.timeZone); };
      const timed = { kind: 'BUSINESS_TIME', businessHours: 4 };
      const base = { slaPausedAt: null, slaPausedMinutes: 0, dueAt: ny('2026-11-02', '15:00'), slaTarget: timed as any };

      const start = clockChange({ ...base, status: 'IN_PROGRESS' }, 'WAITING_ON_CARRIER', ny('2026-11-02', '10:00'), cal);
      ok('entering a wait stops the clock at that moment', start.data.slaPausedAt instanceof Date && (start.data.slaPausedAt as Date).getTime() === ny('2026-11-02', '10:00').getTime());
      const paused = { ...base, status: 'WAITING_ON_CARRIER' as const, slaPausedAt: ny('2026-11-02', '10:00'), slaPausedMinutes: 30 };
      ok('switching between waits keeps the clock stopped (no change)', Object.keys(clockChange(paused, 'WAITING_ON_INSURED', ny('2026-11-02', '12:00'), cal).data).length === 0);
      const resume = clockChange(paused, 'IN_PROGRESS', ny('2026-11-02', '14:00'), cal);
      ok('resuming after 4 business hours: waited 240 min, added to the earlier 30',
        (resume.meta as any).waitedMinutes === 240 && resume.data.slaPausedMinutes === 270 && resume.data.slaPausedAt === null);
      ok('…and the due time moves out by the same 4 h (Mon 15:00 → Tue 11:00)', (resume.data.dueAt as Date).getTime() === ny('2026-11-03', '11:00').getTime());
      const weekend = clockChange({ ...paused, slaPausedAt: ny('2026-10-30', '16:00'), slaPausedMinutes: 0 }, 'IN_PROGRESS', ny('2026-11-02', '10:00'), cal);
      ok('a wait from Friday 16:00 to Monday 10:00 counts 2 business hours, not 66', (weekend.meta as any).waitedMinutes === 120);
      const anchored = clockChange({ ...paused, slaTarget: { kind: 'BEFORE_EXPIRATION' } as any }, 'IN_PROGRESS', ny('2026-11-02', '14:00'), cal);
      ok('renewal / remarketing (expiration-anchored): wait recorded, due date stays', anchored.data.slaPausedMinutes === 270 && !('dueAt' in anchored.data));
      const cancelled = clockChange(paused, 'CANCELLED', ny('2026-11-02', '14:00'), cal);
      ok('cancelled while waiting: wait recorded, due date not moved', cancelled.data.slaPausedMinutes === 270 && !('dueAt' in cancelled.data));
      const noDue = clockChange({ ...paused, dueAt: null }, 'IN_PROGRESS', ny('2026-11-02', '14:00'), cal);
      ok('no due date: wait recorded only', noDue.data.slaPausedMinutes === 270 && !('dueAt' in noDue.data));
      ok('a waiting task with no recorded start (old data): left alone', Object.keys(clockChange({ ...paused, slaPausedAt: null }, 'IN_PROGRESS', new Date(), cal).data).length === 0);
      ok('ordinary moves (Assigned → In progress) do not touch the clock', Object.keys(clockChange({ ...base, status: 'ASSIGNED' }, 'IN_PROGRESS', new Date(), cal).data).length === 0);
    }

    // ── Fixture ──
    const mkAgency = async (n: string) => { const a = await prisma.agency.create({ data: { name: `${TAG} ${n}`, deskEnabled: true } }); cleanup.agencyIds.push(a.id); return a; };
    const A = await mkAgency('A'), B = await mkAgency('B (no plan)'), C = await mkAgency('C (race)');
    const mkUser = async (n: string, role: UserRole, agencyId: string | null = null) => {
      const u = await prisma.user.create({ data: { email: `${TAG}-${n}@example.test`, role, agencyId } }); cleanup.userIds.push(u.id); return u;
    };
    const adminA = await mkUser('admin-a', 'ADMIN', A.id);
    const am = await mkUser('am', 'ACCOUNT_MANAGER');
    const am2 = await mkUser('am2', 'ACCOUNT_MANAGER');
    for (const ag of [A, B, C]) await prisma.agencyDeskAssignment.create({ data: { agencyId: ag.id, primaryAmId: am.id, backupAmId: am2.id } });
    const sAdminA = await resolveDeskScope(prisma, adminA.id), sAm = await resolveDeskScope(prisma, am.id), sAm2 = await resolveDeskScope(prisma, am2.id);
    const cal = await loadBusinessCalendar(prisma);

    const plan = await prisma.deskPlan.create({ data: {
      code: TAG, name: `${TAG} plan`, monthlyPriceCents: 150000n,
      allowances: { create: [{ category: 'COI', monthlyUnits: 2 }, { category: 'ENDORSEMENT', monthlyUnits: null }] }, // Renewals: not configured
    } });
    cleanup.planIds.push(plan.id);
    const agencyPlanA = await prisma.agencyDeskPlan.create({ data: { agencyId: A.id, planId: plan.id, startsOn: new Date() } });
    await prisma.agencyDeskPlan.create({ data: { agencyId: C.id, planId: plan.id, startsOn: new Date(),
      allowanceOverrides: { create: [{ category: 'COI', monthlyUnits: 1 }] } } });

    /** A task worked by the AM, brought to In progress. */
    const working = async (s: DeskScope, input: Parameters<typeof createTask>[2], worker = sAm) => {
      const t = await createTask(prisma, s, input);
      await assignTask(prisma, worker, t.id, worker.userId);
      return changeTaskStatus(prisma, worker, t.id, 'IN_PROGRESS');
    };
    const complete = (t: Task, worker = sAm) => changeTaskStatus(prisma, worker, t.id, 'COMPLETED');
    const reload = (id: string) => prisma.task.findUniqueOrThrow({ where: { id } });
    const lastChange = async (id: string) => (await prisma.taskEvent.findMany({ where: { taskId: id, kind: 'STATUS_CHANGED' }, orderBy: { createdAt: 'desc' }, take: 1 }))[0];
    const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);
    const period = billingPeriodOf(new Date(), cal.timeZone);
    const used = (agencyId: string, cat: 'COI' | 'RENEWAL' | 'ENDORSEMENT') => allowanceUsed(prisma, agencyId, period, cat);

    // ━━ Part 2: the clock on real tasks ━━
    console.log('\n━━ Waiting stops the clock ━━');
    {
      let t = await working(sAdminA, { type: 'COI', title: 'COI waits on carrier' });
      const due0 = t.dueAt!, sla0 = t.slaDueAt!;
      t = await changeTaskStatus(prisma, sAm, t.id, 'WAITING_ON_CARRIER', { reason: 'Need endorsement from carrier' });
      ok('waiting on the carrier: clock stopped', !!t.slaPausedAt);
      const firstPause = t.slaPausedAt!;
      t = await changeTaskStatus(prisma, sAm, t.id, 'WAITING_ON_INSURED', { reason: 'Need signed form' });
      ok('switching to waiting on the insured: still stopped, from the original moment', t.slaPausedAt?.getTime() === firstPause.getTime());
      // Pretend the wait began a week ago, so it spans real business hours.
      const pausedFrom = daysAgo(7);
      await prisma.task.update({ where: { id: t.id }, data: { slaPausedAt: pausedFrom } });
      const before = businessMinutesBetween(pausedFrom, new Date(), cal);
      t = await changeTaskStatus(prisma, sAm, t.id, 'IN_PROGRESS');
      const after = businessMinutesBetween(pausedFrom, new Date(), cal);
      const meta = (await lastChange(t.id)).metadata as any;
      ok(`resuming: clock restarted, ${t.slaPausedMinutes} business minutes of waiting recorded`,
        t.slaPausedAt === null && t.slaPausedMinutes >= before && t.slaPausedMinutes <= after && t.slaPausedMinutes > 0 && meta.clock.waitedMinutes === t.slaPausedMinutes);
      ok('the working due date moved out by exactly the business time waited',
        businessMinutesBetween(due0, t.dueAt!, cal) === t.slaPausedMinutes && meta.clock.dueAtFrom === due0.toISOString());
      ok('the original commitment (slaDueAt) never moves', t.slaDueAt?.getTime() === sla0.getTime());
      const audit = await prisma.deskAuditLog.findFirst({ where: { entityId: t.id, action: 'task.status_changed' }, orderBy: { createdAt: 'desc' } });
      ok('the audit entry records the wait and the new due date', (audit?.metadata as any)?.clock?.waitedMinutes === t.slaPausedMinutes);

      // A second wait adds to the first.
      t = await changeTaskStatus(prisma, sAm, t.id, 'WAITING_ON_CARRIER', { reason: 'again' });
      await prisma.task.update({ where: { id: t.id }, data: { slaPausedAt: daysAgo(3) } });
      const prior = t.slaPausedMinutes;
      t = await changeTaskStatus(prisma, sAm, t.id, 'IN_PROGRESS');
      ok('a second wait is added to the first', t.slaPausedMinutes >= prior);
    }
    {
      let t = await working(sAdminA, { type: 'COI', title: 'COI waits on agency' });
      t = await changeTaskStatus(prisma, sAm, t.id, 'WAITING_ON_AGENCY', { reason: 'Need holder address' });
      await prisma.task.update({ where: { id: t.id }, data: { slaPausedAt: daysAgo(7) } });
      const due0 = t.dueAt!;
      const r = await addTaskNote(prisma, sAdminA, t.id, { body: '1 Main St' });
      ok('the agency\'s reply restarts the clock and records the wait',
        r.resumed && r.task.slaPausedAt === null && r.task.slaPausedMinutes > 0 && businessMinutesBetween(due0, r.task.dueAt!, cal) === r.task.slaPausedMinutes);
    }
    {
      const insured = await prisma.insuredAccount.create({ data: { agencyId: A.id, name: 'Renew Co', nameKey: 'renew co' } });
      const policy = await prisma.policy.create({ data: { agencyId: A.id, insuredId: insured.id, policyNumber: 'R-1', expirationDate: new Date('2027-03-01T00:00:00Z') } });
      let t = await working(sAdminA, { type: 'RENEWAL', title: 'Renewal', policyId: policy.id });
      const due0 = t.dueAt!;
      t = await changeTaskStatus(prisma, sAm, t.id, 'WAITING_ON_INSURED', { reason: 'Need exposures' });
      await prisma.task.update({ where: { id: t.id }, data: { slaPausedAt: daysAgo(7) } });
      t = await changeTaskStatus(prisma, sAm, t.id, 'IN_PROGRESS');
      ok('renewal: the wait is recorded but the due date stays tied to the expiration', t.slaPausedMinutes > 0 && t.dueAt?.getTime() === due0.getTime());
      t = await complete(t);
      ok('renewal with no Renewals allowance configured: left unclassified, month recorded',
        t.billingClass === null && t.billingStatus === null && t.billingPeriod === period && (await lastChange(t.id)).metadata && ((await lastChange(t.id)).metadata as any).billing.reason === 'NOT_CONFIGURED');
    }

    // ━━ Part 3: billing at completion ━━
    console.log('\n━━ Billing against the allowance (COIs: 2 a month) ━━');
    const c1 = await complete(await working(sAdminA, { type: 'COI', title: 'COI 1' }));
    ok('first COI: included in the allowance, no separate charge', c1.billingClass === 'INCLUDED' && c1.billingStatus === 'NOT_APPLICABLE' && c1.billingPeriod === period);
    ok('…counts toward the month in the Desk time zone', (await used(A.id, 'COI')) === 1);
    const c2 = await complete(await working(sAdminA, { type: 'COI', title: 'COI 2' }));
    const c3 = await complete(await working(sAdminA, { type: 'COI', title: 'COI 3' }));
    ok('second included, third is an overage waiting to be billed',
      c2.billingClass === 'INCLUDED' && c3.billingClass === 'OVERAGE' && c3.billingStatus === 'UNBILLED' && (await used(A.id, 'COI')) === 2);
    {
      const ev = await lastChange(c3.id);
      ok('the timeline and audit say why', (ev.metadata as any).billing.reason === 'OVER_ALLOWANCE' &&
        ((await prisma.deskAuditLog.findFirst({ where: { entityId: c3.id, action: 'task.status_changed' }, orderBy: { createdAt: 'desc' } }))?.metadata as any).billing.class === 'OVERAGE');
    }
    {
      const reopened = await changeTaskStatus(prisma, sAm, c1.id, 'IN_PROGRESS', { reason: 'Wrong holder' });
      ok('reopening clears the billing and gives the unit back', reopened.billingClass === null && reopened.billingPeriod === null && (await used(A.id, 'COI')) === 1);
      const c4 = await complete(await working(sAdminA, { type: 'COI', title: 'COI 4' }));
      ok('the freed unit goes to the next completion', c4.billingClass === 'INCLUDED' && (await used(A.id, 'COI')) === 2);
      const again = await complete(reopened);
      ok('the reopened task, completed again, is now an overage', again.billingClass === 'OVERAGE');
    }
    {
      const big = await working(sAdminA, { type: 'COI', title: '3-unit COI' });
      await prisma.task.update({ where: { id: big.id }, data: { billableUnits: 3 } });
      await prisma.agencyDeskPlan.update({ where: { id: agencyPlanA.id }, data: { allowanceOverrides: { create: [{ category: 'COI', monthlyUnits: 4 }] } } });
      const done = await complete(await reload(big.id));
      ok('agency override (4) beats the plan (2); a 3-unit task with 2 left is an overage, never split',
        done.billingClass === 'OVERAGE' && (await used(A.id, 'COI')) === 2);
      const fits = await complete(await working(sAdminA, { type: 'COI', title: 'fits' }));
      ok('…while a 1-unit task still fits under the override', fits.billingClass === 'INCLUDED' && (await used(A.id, 'COI')) === 3);
    }
    {
      const e = await complete(await working(sAdminA, { type: 'ENDORSEMENT', title: 'Endorsement' }));
      ok('unlimited category: included, no counting needed', e.billingClass === 'INCLUDED' && ((await lastChange(e.id)).metadata as any).billing.reason === 'UNLIMITED');
      const qa = await complete(await working(sAm, { type: 'QA_REVIEW', title: 'QA', agencyId: A.id }));
      ok('QA review (non-billable): classified non-billable, allowance untouched',
        qa.billingClass === 'NON_BILLABLE' && qa.billingStatus === 'NOT_APPLICABLE' && (await used(A.id, 'COI')) === 3);
      const b = await complete(await working(sAm, { type: 'COI', title: 'B COI', agencyId: B.id }));
      ok('agency with no Desk plan: left unclassified (reason recorded)', b.billingClass === null && b.billingPeriod === period &&
        ((await lastChange(b.id)).metadata as any).billing.reason === 'NO_PLAN');
      const cancelled = await working(sAdminA, { type: 'COI', title: 'cancelled' });
      const x = await changeTaskStatus(prisma, sAm, cancelled.id, 'CANCELLED', { reason: 'duplicate' });
      ok('cancelled work is never billed', x.billingClass === null && x.billingPeriod === null);
    }

    console.log('\n━━ Classifying once allowances are set (D1) ━━');
    {
      ok('before: the renewal is waiting for an allowance', (await classifyPendingBilling(prisma, { agencyId: A.id })).classified === 0);
      await prisma.deskPlanAllowance.create({ data: { planId: plan.id, category: 'RENEWAL', monthlyUnits: 5 } });
      const r = await classifyPendingBilling(prisma, { agencyId: A.id });
      const renewal = await prisma.task.findFirstOrThrow({ where: { agencyId: A.id, type: 'RENEWAL' } });
      ok('after configuring Renewals: classified in the month it was completed', r.classified === 1 && renewal.billingClass === 'INCLUDED' && (await used(A.id, 'RENEWAL')) === 1);
      const log = await prisma.deskAuditLog.findFirst({ where: { entityId: renewal.id, action: 'task.billing_classified' } });
      ok('recorded in the audit log as a system action', !!log && log.actorId === null && (log.metadata as any).late === true);
      ok('running it again changes nothing', (await classifyPendingBilling(prisma, { agencyId: A.id })).classified === 0 && (await used(A.id, 'RENEWAL')) === 1);
      ok('work for an agency without a plan stays pending', (await classifyPendingBilling(prisma, { agencyId: B.id })).stillPending === 1);
    }

    console.log('\n━━ Invoiced work ━━');
    {
      await prisma.task.update({ where: { id: c3.id }, data: { billingStatus: 'BILLED' } });
      ok('invoiced work cannot be reopened (409)', (await status(() => changeTaskStatus(prisma, sAm, c3.id, 'IN_PROGRESS', { reason: 'x' }))) === 409);
    }

    console.log('\n━━ Simultaneous completions ━━');
    {
      // Agency C: 1 COI a month. Three COIs completed at the same moment.
      const ts = await Promise.all([1, 2, 3].map((i) => working(sAm, { type: 'COI', title: `race ${i}`, agencyId: C.id })));
      const done = await Promise.all(ts.map((t) => complete(t)));
      const classes = done.map((t) => t.billingClass).sort().join();
      ok(`three at once with one unit left: exactly one included (${classes})`, classes === 'INCLUDED,OVERAGE,OVERAGE' && (await used(C.id, 'COI')) === 1);

      // The same task completed twice at once: the loser's unit must be returned.
      await prisma.agencyDeskPlan.update({ where: { agencyId: C.id }, data: { allowanceOverrides: { updateMany: { where: { category: 'COI' }, data: { monthlyUnits: 10 } } } } });
      const t = await working(sAm, { type: 'COI', title: 'double complete', agencyId: C.id });
      const results = await Promise.all([status(() => complete(t, sAm)), status(() => complete(t, sAm2))]);
      const final = await reload(t.id);
      ok(`the same task completed by two people at once: one succeeds (${[...results].sort().join(', ')})`,
        [...results].sort().join() === '200,409' && final.billingClass === 'INCLUDED');
      ok('…and the loser\'s allowance unit is given back (counted once)', (await used(C.id, 'COI')) === 2);
    }
  } finally {
    await wipe();
    const left = (await prisma.user.count({ where: { id: { in: cleanup.userIds } } })) + (await prisma.agency.count({ where: { id: { in: cleanup.agencyIds } } })) +
      (await prisma.deskPlan.count({ where: { id: { in: cleanup.planIds } } }));
    ok('temporary records removed', left === 0);
    console.log(`\n━━ ${pass} passed, ${fail} failed ━━`);
    await prisma.$disconnect();
    process.exit(fail ? 1 : 0);
  }
})();
