/**
 * Creates The Desk's defaults if missing: the 4 pods, routing rules,
 * follow-up rules, the 3 plans, service-level targets, the business calendar,
 * holidays and the Desk positions (giving staff without one the position for
 * their role). Idempotent and create-only; never edits existing records.
 * Separate from prisma/seed.ts because that script also resets the demo users'
 * passwords, which must not happen on a shared database.
 * Run with:  npm run db:seed:desk
 */
import 'dotenv/config';
import { prisma } from '../lib/prisma';
import { ensureDeskDefaults } from '../lib/desk/defaults';
import { describeTarget } from '../lib/desk/service-levels';
import { backfillTaskLists } from '../lib/desk/integrity';
import { ensureDefaultPositions } from '../lib/desk/positions';

const list = (xs: string[]) => (xs.length ? xs.join(', ') : 'none (already present)');

(async () => {
  const { pods, routing, followUps, plans, serviceLevels, calendar, holidays } = await ensureDeskDefaults(prisma);
  console.log(`Pods created:            ${list(pods)}`);
  console.log(`Routing rules created:   ${list(routing)}`);
  console.log(`Follow-up rules created: ${list(followUps)}`);
  console.log(`Plans created:           ${list(plans)}`);
  console.log(`Service levels created:  ${list(serviceLevels)}`);
  console.log(`Calendar created:        ${calendar ? 'yes' : 'no (already present)'}`);
  console.log(`Holidays created:        ${holidays}`);
  const positions = await ensureDefaultPositions(prisma);
  console.log(`Positions created:       ${list(positions.created)}`);
  console.log(`Staff given a position:  ${positions.staffPlaced}`);
  console.log(`Permissions added:       ${list(positions.permissionsAdded)}`);
  console.log(`Tasks repaired:          ${await backfillTaskLists(prisma)}`);

  const rules = await prisma.taskRoutingRule.findMany({ include: { pod: { select: { code: true } } } });
  console.log('\nRouting:');
  const targets = await prisma.serviceLevelTarget.findMany({ where: { isActive: true } });
  for (const r of rules) {
    const ts = targets.filter((t) => t.taskType === r.taskType && t.agencyId === null)
      .map((t) => `${t.complexity ? t.complexity.toLowerCase() + ': ' : ''}${describeTarget(t)}`);
    console.log(`  ${r.taskType.padEnd(16)} → ${r.pod.code.padEnd(13)} ${ts.join(' · ') || 'no target'}`);
  }
  await prisma.$disconnect();
})().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
