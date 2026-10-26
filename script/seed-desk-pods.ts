/**
 * Creates The Desk's default pods if missing. Idempotent; never edits existing pods.
 * Separate from prisma/seed.ts because that script also resets the demo users'
 * passwords, which must not happen on a shared database.
 * Run with:  npm run db:seed:desk
 */
import 'dotenv/config';
import { prisma } from '../lib/prisma';
import { ensureDefaultPods } from '../lib/desk/pods';

(async () => {
  const { created } = await ensureDefaultPods(prisma);
  console.log(created.length ? `Created pods: ${created.join(', ')}` : 'All default pods already exist.');
  const pods = await prisma.pod.findMany({ orderBy: { sortOrder: 'asc' }, select: { code: true, name: true, isActive: true } });
  for (const p of pods) console.log(`  ${p.code.padEnd(13)} ${p.name}${p.isActive ? '' : ' (inactive)'}`);
  await prisma.$disconnect();
})().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
