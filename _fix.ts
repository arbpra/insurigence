import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const p = new PrismaClient();

// Enum values the DEPLOYED build (origin/main) understands.
const DEPLOYED_LEAD_STATUS = [
  'NEW',
  'WAITING_ON_INFO',
  'READY_TO_MARKET',
  'QUOTED',
  'PRESENTED',
  'BOUND',
  'LOST',
];

(async () => {
  try {
    const all = await p.lead.findMany({ select: { id: true, status: true } });
    const bad = all.filter((l) => !DEPLOYED_LEAD_STATUS.includes(l.status as string));
    console.log(`Scanned ${all.length} leads; ${bad.length} unreadable by the live build.`);
    for (const l of bad) console.log('  ', l.id, '->', l.status);

    for (const l of bad) {
      await p.lead.update({ where: { id: l.id }, data: { status: 'PRESENTED' } });
      console.log(`UPDATED ${l.id}: ${l.status} -> PRESENTED`);
    }

    const after = await p.lead.findMany({ select: { id: true, status: true } });
    const stillBad = after.filter((l) => !DEPLOYED_LEAD_STATUS.includes(l.status as string));
    console.log(`\nRe-scan: ${stillBad.length} remaining outside the deployed enum.`);
  } catch (e: any) {
    console.log('ERR', e?.message);
  } finally {
    await p.$disconnect();
  }
})();
