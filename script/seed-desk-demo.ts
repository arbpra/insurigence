/**
 * The Desk demo (Module 45): two agencies, their people and books, the Desk
 * team, and requests at every stage, for showing the four views.
 *
 *   npm run db:seed:desk-demo             create it (refuses if it exists)
 *   npm run db:seed:desk-demo -- --remove remove it
 *   npm run db:seed:desk-demo -- --reset  remove, then create again
 *
 * Every demo person signs in with one password: DESK_DEMO_PASSWORD if set
 * (at least 12 characters), otherwise a random one printed at the end.
 * Demo emails use the reserved .invalid domain, so no email is ever sent.
 * Remove the demo before real agencies use The Desk on the same database
 * (lib/desk/demo.ts explains why).
 */
import 'dotenv/config';
import { prisma } from '../lib/prisma';
import { DEMO_DOMAIN, demoPassword, findDemo, removeDemo, seedDemo } from '../lib/desk/demo';

(async () => {
  const args = process.argv.slice(2);
  const remove = args.includes('--remove'), reset = args.includes('--reset');
  if (remove || reset) {
    const r = await removeDemo(prisma);
    console.log(`Demo removed: ${r.agencies} agencies, ${r.users} people, ${r.tasks} requests.`);
    if (remove) return;
  }
  const existing = await findDemo(prisma);
  if (existing.agencies.length || existing.users.length) {
    console.log('The demo is already there. Use --reset to start it again, or --remove to take it out.');
    process.exitCode = 1;
    return;
  }
  const password = process.env.DESK_DEMO_PASSWORD?.trim() || demoPassword();
  // Seeding sends no notifications (the addresses can't receive them anyway).
  process.env.DESK_EMAIL_NOTIFICATIONS = 'off';
  const { logins, agencies } = await seedDemo(prisma, { password });
  console.log(`Demo created: ${agencies.join(' and ')}.\n`);
  console.log('Sign in with any of these, all with the same password:\n');
  for (const l of logins) console.log(`  ${l.view.padEnd(18)} ${l.who.padEnd(18)} ${l.email}`);
  console.log(`\n  Password: ${process.env.DESK_DEMO_PASSWORD?.trim() ? '(DESK_DEMO_PASSWORD)' : password}`);
  console.log(`\nAll demo records use the ${DEMO_DOMAIN} domain. Remove with --remove.`);
})()
  .catch((e) => { console.error(e instanceof Error ? e.message : e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
