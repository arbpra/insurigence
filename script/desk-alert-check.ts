/**
 * Runs the Desk alert check once (Module 41), for a host's own scheduler:
 *   npx tsx script/desk-alert-check.ts
 * Prints what it did (counts only). Exits 1 if anything failed.
 */
import { prisma } from '../lib/prisma';
import { runAlertCheck } from '../lib/desk/alerts';

runAlertCheck(prisma)
  .then(async (r) => {
    console.log(JSON.stringify(r));
    await prisma.$disconnect();
    process.exit(r.failed ? 1 : 0);
  })
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
