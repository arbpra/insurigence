/**
 * The Desk, Module 8: need-to-know and audit models.
 *
 * Verifies document sensitivity rules, the named-staff task restriction (in
 * memory and as a database filter, including tasks stored without the list),
 * staff permissions, and the audit log: redaction, request context, and that
 * it fails closed. Uses temporary records only.
 * Run with:  npx tsx script/verify-desk-need-to-know.ts
 */
import 'dotenv/config';
import { randomBytes } from 'crypto';
import { prisma } from '../lib/prisma';
import { maySeeSensitivity, restrictionAllows, DEFAULT_STAFF_SENSITIVITIES } from '../lib/desk/need-to-know';
import { recordAudit, redactMetadata, auditRequestContext } from '../lib/desk/audit';
import { UNRESTRICTED, passesRestriction } from '../lib/desk/task-filters';
import { backfillTaskLists, countTasksMissingLists } from '../lib/desk/integrity';

let pass = 0, fail = 0;
const ok = (n: string, c: boolean) => { c ? pass++ : fail++; console.log(`  ${c ? '✓' : '✗'} ${n}`); };
const rejects = async (fn: () => Promise<unknown>) => { try { await fn(); return false; } catch { return true; } };

const TAG = `m8test-${Date.now()}`;
const cleanup = { agencyId: '', userIds: [] as string[] };
let ref = 940_000_000 + Math.floor(Math.random() * 1_000_000);

async function wipe() {
  if (cleanup.agencyId) {
    await prisma.taskDocument.deleteMany({ where: { agencyId: cleanup.agencyId } });
    await prisma.task.deleteMany({ where: { agencyId: cleanup.agencyId } });
    await prisma.deskAuditLog.deleteMany({ where: { agencyId: cleanup.agencyId } });
    await prisma.agency.deleteMany({ where: { id: cleanup.agencyId } });
  }
  await prisma.deskAuditLog.deleteMany({ where: { actorId: { in: cleanup.userIds } } });
  await prisma.deskStaffPermission.deleteMany({ where: { userId: { in: cleanup.userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: cleanup.userIds } } });
}

(async () => {
  console.log('\n━━ Document sensitivity ━━');
  ok('VA default: General and Policy only', DEFAULT_STAFF_SENSITIVITIES.join() === 'GENERAL,POLICY');
  ok('VA sees General and Policy', maySeeSensitivity('DESK_VA', 'GENERAL') && maySeeSensitivity('DESK_VA', 'POLICY'));
  ok('VA does NOT see Financial or Personal by default', !maySeeSensitivity('DESK_VA', 'FINANCIAL') && !maySeeSensitivity('DESK_VA', 'PERSONAL'));
  ok('…until individually granted, one category at a time',
    maySeeSensitivity('DESK_VA', 'FINANCIAL', ['FINANCIAL']) && !maySeeSensitivity('DESK_VA', 'PERSONAL', ['FINANCIAL']));
  ok('Account Manager, Operations Manager, Super Admin see every category',
    ['ACCOUNT_MANAGER', 'DESK_ADMIN', 'SUPER_ADMIN'].every((r) => maySeeSensitivity(r, 'PERSONAL')));
  ok('agency users see their own agency\'s documents of every category',
    ['ADMIN', 'AGENT', 'CSR'].every((r) => maySeeSensitivity(r, 'FINANCIAL')));
  ok('an unknown role sees nothing', !maySeeSensitivity('SOMETHING', 'GENERAL'));

  console.log('\n━━ Task restriction (rules) ━━');
  const va = { id: 'va1', role: 'DESK_VA' };
  ok('unrestricted task: everyone passes', restrictionAllows([], va) && restrictionAllows(undefined, va));
  ok('restricted: a named VA passes, another VA does not',
    restrictionAllows(['va1'], va) && !restrictionAllows(['va2'], va));
  ok('restricted: the agency\'s own AM passes; an unrelated AM does not',
    restrictionAllows(['va2'], { id: 'am1', role: 'ACCOUNT_MANAGER' }, true) &&
    !restrictionAllows(['va2'], { id: 'am9', role: 'ACCOUNT_MANAGER' }, false));
  ok('restricted: Operations Manager and Super Admin always pass',
    restrictionAllows(['va2'], { id: 'x', role: 'DESK_ADMIN' }) && restrictionAllows(['va2'], { id: 'y', role: 'SUPER_ADMIN' }));
  ok('restricted: agency users are unaffected', restrictionAllows(['va2'], { id: 'p', role: 'AGENT' }));

  console.log('\n━━ Task restriction (database) ━━');
  const agency = await prisma.agency.create({ data: { name: `${TAG} agency` } });
  cleanup.agencyId = agency.id;
  const mkUser = async (n: string) => {
    const u = await prisma.user.create({ data: { email: `${TAG}-${n}@example.test`, role: 'DESK_VA' } });
    cleanup.userIds.push(u.id); return u;
  };
  const vaA = await mkUser('va-a');
  const vaB = await mkUser('va-b');
  const open = await prisma.task.create({ data: { reference: ++ref, agencyId: agency.id, type: 'COI', title: 'open' } });
  ok('new tasks start unrestricted', open.restrictedToUserIds.length === 0);
  await prisma.task.create({ data: { reference: ++ref, agencyId: agency.id, type: 'COI', title: 'restricted to A', restrictedToUserIds: [vaA.id], restrictionReason: 'VIP client' } });
  // A task stored without the list at all (raw write), which `isEmpty: true` would miss.
  const legacyId = randomBytes(12).toString('hex');
  const now = { $date: new Date().toISOString() };
  await prisma.$runCommandRaw({ insert: 'Task', documents: [{
    _id: { $oid: legacyId }, reference: ++ref, agencyId: { $oid: agency.id }, type: 'COI', title: 'stored without list',
    priority: 'NORMAL', status: 'NEW', source: 'AGENCY', escalated: false, complexity: 'STANDARD', billableUnits: 1,
    nonBillable: false, lastActivityAt: now, createdAt: now, updatedAt: now,
  }] });
  const titles = async (where: object) =>
    (await prisma.task.findMany({ where: { agencyId: agency.id, ...where }, select: { title: true }, orderBy: { reference: 'asc' } })).map((t) => t.title).join(' | ');
  ok('`isEmpty: true` misses the task stored without the list (the trap)',
    (await prisma.task.count({ where: { agencyId: agency.id, restrictedToUserIds: { isEmpty: true } } })) === 1);
  ok('…and so does every other Prisma filter, including NOT (why the data is repaired instead)',
    (await prisma.task.count({ where: { agencyId: agency.id, NOT: { restrictedToUserIds: { isEmpty: false } } } })) === 1);
  ok('the invariant check spots the broken task', (await countTasksMissingLists(prisma)) >= 1);
  ok('the repair fixes it', (await backfillTaskLists(prisma)) >= 1 && (await countTasksMissingLists(prisma)) === 0);
  ok('…and a second run has nothing to do', (await backfillTaskLists(prisma)) === 0);
  ok('UNRESTRICTED now finds both unrestricted tasks', (await titles(UNRESTRICTED)) === 'open | stored without list');
  ok('VA A sees all three (named on the restricted one)', (await titles(passesRestriction(vaA.id))) === 'open | restricted to A | stored without list');
  ok('VA B sees only the two unrestricted ones', (await titles(passesRestriction(vaB.id))) === 'open | stored without list');

  console.log('\n━━ Document classification is required ━━');
  ok('a document without a sensitivity is refused',
    await rejects(() => prisma.taskDocument.create({ data: { taskId: open.id, agencyId: agency.id, storageKey: 'k', fileName: 'f.pdf', fileSize: 1, contentType: 'application/pdf' } as never })));
  const doc = await prisma.taskDocument.create({ data: { taskId: open.id, agencyId: agency.id, storageKey: 'k', fileName: 'loss-runs.pdf', fileSize: 1, contentType: 'application/pdf', sensitivity: 'FINANCIAL' } });
  ok('a classified document is stored with its category', doc.sensitivity === 'FINANCIAL');

  console.log('\n━━ Staff permissions ━━');
  await prisma.deskStaffPermission.create({ data: { userId: vaA.id, allowedSensitivities: ['FINANCIAL'] } });
  ok('one permission record per person',
    await rejects(() => prisma.deskStaffPermission.create({ data: { userId: vaA.id } })));
  {
    const permA = await prisma.deskStaffPermission.findUnique({ where: { userId: vaA.id } });
    const permB = await prisma.deskStaffPermission.findUnique({ where: { userId: vaB.id } });
    ok('VA A (granted Financial) may open the financial document',
      maySeeSensitivity('DESK_VA', doc.sensitivity, permA?.allowedSensitivities ?? []));
    ok('VA B (no record) may not', permB === null && !maySeeSensitivity('DESK_VA', doc.sensitivity, permB?.allowedSensitivities ?? []));
  }

  console.log('\n━━ Audit log ━━');
  {
    const input = { fileName: 'a.pdf', status: 'NEW', password: 'hunter2', nested: { apiKey: 'sk-1', note: 'ok', items: [{ token: 't' }] }, pin: '1234' };
    const out = redactMetadata(input) as any;
    ok('secret-looking keys redacted at any depth',
      out.password === '[redacted]' && out.nested.apiKey === '[redacted]' && out.nested.items[0].token === '[redacted]' && out.pin === '[redacted]');
    ok('ordinary keys kept', out.fileName === 'a.pdf' && out.status === 'NEW' && out.nested.note === 'ok');
    ok('the original object is not modified', input.password === 'hunter2');
  }
  {
    const ctx = auditRequestContext(new Request('http://x', { headers: { 'x-forwarded-for': '203.0.113.7, 10.0.0.1', 'user-agent': 'TestAgent/1' } }));
    ok('request context: first forwarded IP and user agent', ctx.ip === '203.0.113.7' && ctx.userAgent === 'TestAgent/1');
    ok('request context without headers is empty, not an error',
      JSON.stringify(auditRequestContext(new Request('http://x'))) === JSON.stringify({ ip: null, userAgent: null }));
  }
  await recordAudit(prisma, {
    actor: { id: vaA.id, role: 'DESK_VA' }, action: 'document.downloaded', entityType: 'TaskDocument', entityId: doc.id,
    agencyId: agency.id, metadata: { fileName: doc.fileName, sensitivity: doc.sensitivity, accessToken: 'abc' }, ip: '203.0.113.7',
  });
  {
    const entry = await prisma.deskAuditLog.findFirstOrThrow({ where: { agencyId: agency.id, action: 'document.downloaded' } });
    const meta = entry.metadata as Record<string, unknown>;
    ok('download recorded with actor, role, entity, agency and IP',
      entry.actorId === vaA.id && entry.actorRole === 'DESK_VA' && entry.entityId === doc.id && entry.ipAddress === '203.0.113.7');
    ok('…with the secret in its metadata redacted', meta.accessToken === '[redacted]' && meta.fileName === 'loss-runs.pdf');
  }
  await recordAudit(prisma, { actor: { id: vaB.id, role: 'DESK_VA' }, action: 'access.denied', entityType: 'TaskDocument', entityId: doc.id, agencyId: agency.id, metadata: { reason: 'sensitivity' } });
  ok('refused attempts are recorded too',
    (await prisma.deskAuditLog.count({ where: { agencyId: agency.id, action: 'access.denied', actorId: vaB.id } })) === 1);
  ok('agency trail lookup returns entries newest first',
    (await prisma.deskAuditLog.findMany({ where: { agencyId: agency.id }, orderBy: { createdAt: 'desc' } }))[0].action === 'access.denied');
  {
    // Fail closed: a write that cannot be stored must throw, not be swallowed.
    const broken = { deskAuditLog: { create: async () => { throw new Error('database unavailable'); } } } as never;
    ok('recordAudit throws when the entry cannot be written (fails closed)',
      await rejects(() => recordAudit(broken, { actor: null, action: 'task.viewed', entityType: 'Task' })));
  }

  await wipe();
  ok('cleaned up',
    (await prisma.agency.count({ where: { name: { startsWith: TAG } } })) === 0 &&
    (await prisma.user.count({ where: { email: { startsWith: TAG } } })) === 0 &&
    (await prisma.deskAuditLog.count({ where: { actorId: { in: cleanup.userIds } } })) === 0 &&
    (await prisma.task.count({ where: { id: legacyId } })) === 0);

  console.log(`\n━━ ${pass} passed, ${fail} failed ━━\n`);
  await prisma.$disconnect();
  process.exit(fail ? 1 : 0);
})().catch(async (e) => {
  console.error('ERROR', e);
  await wipe().catch(() => {});
  await prisma.$disconnect();
  process.exit(1);
});
