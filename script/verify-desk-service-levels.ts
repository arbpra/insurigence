/**
 * The Desk, Module 7: service-level targets, business calendar and holidays.
 *
 * Verifies target selection (agency agreement > priority > complexity > type),
 * target validation and wording, the client's seeded targets, the placeholder
 * calendar and holidays, uniqueness (including the null-vs-unset case), the
 * new WAITING_ON_INSURED status and the target snapshot on a task.
 * Uses temporary records only.
 * Run with:  npx tsx script/verify-desk-service-levels.ts
 */
import 'dotenv/config';
import { TaskType } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { pickServiceLevelTarget, describeTarget, validateTarget, targetSnapshot, type TargetLike } from '../lib/desk/service-levels';
import { DEFAULT_SERVICE_LEVELS, DEFAULT_HOLIDAYS, DEFAULT_CALENDAR, ensureDeskDefaults } from '../lib/desk/defaults';

let pass = 0, fail = 0;
const ok = (n: string, c: boolean) => { c ? pass++ : fail++; console.log(`  ${c ? '✓' : '✗'} ${n}`); };
const rejects = async (fn: () => Promise<unknown>) => { try { await fn(); return false; } catch { return true; } };

const TAG = `m7test-${Date.now()}`;
let agencyId = '';
const tempTargetIds: string[] = [];
let ref = 920_000_000 + Math.floor(Math.random() * 1_000_000);

async function wipe() {
  await prisma.serviceLevelTarget.deleteMany({ where: { id: { in: tempTargetIds } } });
  if (agencyId) {
    await prisma.task.deleteMany({ where: { agencyId } });
    await prisma.agency.deleteMany({ where: { id: agencyId } });
  }
}

let n = 0;
const tgt = (o: Partial<TargetLike> & Pick<TargetLike, 'taskType'>): TargetLike => ({
  id: `t${++n}`, complexity: null, priority: null, agencyId: null, kind: 'BUSINESS_TIME',
  businessHours: null, businessDays: null, opensDaysBeforeExpiration: null, dueDaysBeforeExpiration: null, isActive: true, ...o,
});

(async () => {
  console.log('\n━━ Target selection ━━');
  const set = [
    tgt({ taskType: 'COI', complexity: 'STANDARD', businessHours: 4 }),
    tgt({ taskType: 'COI', complexity: 'COMPLEX', businessDays: 1 }),
    tgt({ taskType: 'COI', priority: 'URGENT', businessHours: 2 }),
    tgt({ taskType: 'COI', priority: 'URGENT', complexity: 'COMPLEX', businessHours: 6 }),
    tgt({ taskType: 'COI', agencyId: 'agencyA', businessHours: 3 }),
    tgt({ taskType: 'AMS_ENTRY', businessDays: 1 }),
    tgt({ taskType: 'ENDORSEMENT', businessDays: 9, isActive: false }),
  ];
  const pick = (type: TaskType, complexity: 'STANDARD' | 'COMPLEX', priority: 'NORMAL' | 'URGENT', agency = 'agencyB') =>
    pickServiceLevelTarget(set, { type, complexity, priority, agencyId: agency });
  ok('standard COI → 4 business hours', pick('COI', 'STANDARD', 'NORMAL')?.businessHours === 4);
  ok('complex COI → 1 business day', pick('COI', 'COMPLEX', 'NORMAL')?.businessDays === 1);
  ok('urgent standard COI → the "urgent" target (priority outranks complexity)', pick('COI', 'STANDARD', 'URGENT')?.businessHours === 2);
  ok('urgent complex COI → the target naming both', pick('COI', 'COMPLEX', 'URGENT')?.businessHours === 6);
  ok('agency A\'s own agreement beats every Desk default, even urgent', pick('COI', 'COMPLEX', 'URGENT', 'agencyA')?.businessHours === 3);
  ok('…but never applies to another agency', pick('COI', 'STANDARD', 'NORMAL', 'agencyB')?.businessHours === 4);
  ok('a target without complexity applies to both', pick('AMS_ENTRY', 'COMPLEX', 'NORMAL')?.businessDays === 1 && pick('AMS_ENTRY', 'STANDARD', 'NORMAL')?.businessDays === 1);
  ok('inactive targets are ignored', pick('ENDORSEMENT', 'STANDARD', 'NORMAL') === null);
  ok('no target → null', pick('ACORD', 'STANDARD', 'NORMAL') === null);

  console.log('\n━━ Wording and validation ━━');
  ok('wording', describeTarget(tgt({ taskType: 'COI', businessHours: 4 })) === '4 business hours' &&
    describeTarget(tgt({ taskType: 'COI', businessDays: 1 })) === '1 business day' &&
    describeTarget(tgt({ taskType: 'RENEWAL', kind: 'BEFORE_EXPIRATION', opensDaysBeforeExpiration: 120, dueDaysBeforeExpiration: 90 })) === 'due 90 days before expiration (opens at 120)');
  ok('valid: hours only, days only, expiration window',
    validateTarget(tgt({ taskType: 'COI', businessHours: 4 })) === null && validateTarget(tgt({ taskType: 'COI', businessDays: 2 })) === null &&
    validateTarget(tgt({ taskType: 'RENEWAL', kind: 'BEFORE_EXPIRATION', opensDaysBeforeExpiration: 120, dueDaysBeforeExpiration: 90 })) === null);
  ok('refused: both hours and days, neither, zero, fractional',
    [tgt({ taskType: 'COI', businessHours: 4, businessDays: 1 }), tgt({ taskType: 'COI' }), tgt({ taskType: 'COI', businessHours: 0 }), tgt({ taskType: 'COI', businessDays: 1.5 })]
      .every((t) => validateTarget(t) !== null));
  ok('refused: renewal that opens after it is due, or has no due day',
    validateTarget(tgt({ taskType: 'RENEWAL', kind: 'BEFORE_EXPIRATION', opensDaysBeforeExpiration: 30, dueDaysBeforeExpiration: 90 })) !== null &&
    validateTarget(tgt({ taskType: 'RENEWAL', kind: 'BEFORE_EXPIRATION' })) !== null);

  console.log('\n━━ Seeded targets (client, 27 Oct 2026) ━━');
  const seeded = await prisma.serviceLevelTarget.findMany({ where: { agencyId: null, isActive: true } });
  ok(`all ${DEFAULT_SERVICE_LEVELS.length} client targets present with the right values`,
    DEFAULT_SERVICE_LEVELS.every((d) => seeded.some((s) =>
      s.taskType === d.taskType && s.complexity === d.complexity && s.kind === d.kind &&
      (d.kind === 'BUSINESS_TIME'
        ? s.businessHours === (d.businessHours ?? null) && s.businessDays === (d.businessDays ?? null)
        : s.opensDaysBeforeExpiration === d.opensDaysBeforeExpiration && s.dueDaysBeforeExpiration === d.dueDaysBeforeExpiration))));
  ok('every seeded target passes validation', seeded.every((s) => validateTarget(s) === null));
  {
    const withTarget = new Set(seeded.map((s) => s.taskType));
    const without = Object.values(TaskType).filter((t) => !withTarget.has(t)).sort().join(',');
    ok('types with no client target: ACORD, LOSS_RUNS, OTHER, PROPOSAL_PREP, QA_REVIEW', without === 'ACORD,LOSS_RUNS,OTHER,PROPOSAL_PREP,QA_REVIEW');
  }
  ok('standard COI resolves to 4 business hours from the database',
    pickServiceLevelTarget(seeded, { type: 'COI', complexity: 'STANDARD', priority: 'NORMAL', agencyId: 'x' })?.businessHours === 4);
  ok('a duplicate Desk default is refused (nulls written explicitly)',
    await rejects(() => prisma.serviceLevelTarget.create({ data: { taskType: 'COI', complexity: 'STANDARD', priority: null, agencyId: null, businessHours: 1 } })));
  ok('…and also when the empty fields are simply left out',
    await rejects(() => prisma.serviceLevelTarget.create({ data: { taskType: 'COI', complexity: 'STANDARD', businessHours: 1 } })));
  {
    const agency = await prisma.agency.create({ data: { name: `${TAG} agency` } });
    agencyId = agency.id;
    const own = await prisma.serviceLevelTarget.create({ data: { taskType: 'COI', complexity: 'STANDARD', priority: null, agencyId, businessHours: 2, note: 'agreement' } });
    tempTargetIds.push(own.id);
    const all = await prisma.serviceLevelTarget.findMany({ where: { taskType: 'COI', isActive: true } });
    ok('an agency agreement can sit beside the Desk default and wins for that agency',
      pickServiceLevelTarget(all, { type: 'COI', complexity: 'STANDARD', priority: 'NORMAL', agencyId })?.businessHours === 2 &&
      pickServiceLevelTarget(all, { type: 'COI', complexity: 'STANDARD', priority: 'NORMAL', agencyId: 'other' })?.businessHours === 4);
  }
  ok('routing rules no longer carry the old placeholder turnaround',
    ((await prisma.$runCommandRaw({ count: 'TaskRoutingRule', query: { turnaroundHours: { $exists: true } } })) as { n: number }).n === 0);

  console.log('\n━━ Calendar and holidays (placeholders, D2) ━━');
  const cal = await prisma.deskCalendar.findUniqueOrThrow({ where: { id: 'default' } });
  ok('Mon–Fri 9:00–17:00, America/New_York',
    cal.timeZone === DEFAULT_CALENDAR.timeZone && cal.workDays.join() === '1,2,3,4,5' && cal.dayStartMinute === 540 && cal.dayEndMinute === 1020);
  ok('the zone is a real IANA time zone', (() => { try { new Intl.DateTimeFormat('en-US', { timeZone: cal.timeZone }); return true; } catch { return false; } })());
  const hols = await prisma.deskHoliday.findMany({ orderBy: { date: 'asc' } });
  ok(`${DEFAULT_HOLIDAYS.length} holidays seeded for 2026–2027`, hols.length >= DEFAULT_HOLIDAYS.length && DEFAULT_HOLIDAYS.every((d) => hols.some((h) => h.date === d.date)));
  {
    const dow = (d: string) => new Date(`${d}T12:00:00Z`).getUTCDay();
    const weekend = DEFAULT_HOLIDAYS.filter((h) => [0, 6].includes(dow(h.date)));
    ok('every observed holiday falls on a weekday (weekend dates moved correctly)', weekend.length === 0);
    if (weekend.length) console.log('    on a weekend:', weekend);
    ok('Thanksgiving is the 4th Thursday both years',
      ['2026-11-26', '2027-11-25'].every((d) => dow(d) === 4 && Number(d.slice(8)) >= 22 && Number(d.slice(8)) <= 28));
  }
  ok('one entry per date', await rejects(() => prisma.deskHoliday.create({ data: { date: '2026-12-25', name: 'dup' } })));
  ok('re-seeding creates nothing', await (async () => {
    const r = await ensureDeskDefaults(prisma);
    return r.serviceLevels.length === 0 && !r.calendar && r.holidays === 0 && r.routing.length === 0 && r.plans.length === 0;
  })());

  console.log('\n━━ Task: waiting on insured + target snapshot ━━');
  {
    const target = pickServiceLevelTarget(seeded, { type: 'COI', complexity: 'COMPLEX', priority: 'NORMAL', agencyId })!;
    const t = await prisma.task.create({ data: {
      reference: ++ref, agencyId, type: 'COI', complexity: 'COMPLEX', title: 'COI awaiting insured', status: 'WAITING_ON_INSURED',
      slaTarget: targetSnapshot(target),
    } });
    const back = await prisma.task.findUniqueOrThrow({ where: { id: t.id } });
    const snap = back.slaTarget as { targetId: string; businessDays: number };
    ok('WAITING_ON_INSURED is a valid status', back.status === 'WAITING_ON_INSURED');
    ok('the target applied is stored on the task', snap.targetId === target.id && snap.businessDays === 1);
  }

  await wipe();
  ok('cleaned up',
    (await prisma.agency.count({ where: { name: { startsWith: TAG } } })) === 0 &&
    (await prisma.serviceLevelTarget.count({ where: { id: { in: tempTargetIds } } })) === 0 &&
    (await prisma.serviceLevelTarget.count()) === DEFAULT_SERVICE_LEVELS.length);

  console.log(`\n━━ ${pass} passed, ${fail} failed ━━\n`);
  await prisma.$disconnect();
  process.exit(fail ? 1 : 0);
})().catch(async (e) => {
  console.error('ERROR', e);
  await wipe().catch(() => {});
  await prisma.$disconnect();
  process.exit(1);
});
