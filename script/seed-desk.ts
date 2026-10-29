/**
 * Creates The Desk's defaults if missing: the 4 pods, routing rules,
 * follow-up rules and the 3 plans. Idempotent and create-only; never edits existing records.
 * Separate from prisma/seed.ts because that script also resets the demo users'
 * passwords, which must not happen on a shared database.
 * Run with:  npm run db:seed:desk
 */
import 'dotenv/config';
import { prisma } from '../lib/prisma';
import { ensureDeskDefaults } from '../lib/desk/defaults';

const list = (xs: string[]) => (xs.length ? xs.join(', ') : 'none (already present)');

(async () => {
  const { pods, routing, followUps, plans } = await ensureDeskDefaults(prisma);
  console.log(`Pods created:            ${list(pods)}`);
  console.log(`Routing rules created:   ${list(routing)}`);
  console.log(`Follow-up rules created: ${list(followUps)}`);
  console.log(`Plans created:           ${list(plans)}`);

  const rules = await prisma.taskRoutingRule.findMany({ include: { pod: { select: { code: true } } } });
  console.log('\nRouting:');
  for (const r of rules) console.log(`  ${r.taskType.padEnd(16)} → ${r.pod.code.padEnd(13)} ${r.turnaroundHours ?? '-'}h`);
  await prisma.$disconnect();
})().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
