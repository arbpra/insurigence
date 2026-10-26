/**
 * The Desk, Module 2: organisation models (pods, members, AM assignment, pod access).
 *
 * Verifies the default pods, seeding idempotency, every uniqueness rule (including
 * the null-userId "whole pod" row, which relies on MongoDB indexing a missing field
 * as null), and delete behaviour. Uses temporary agencies and users only and
 * removes them afterwards.
 * Run with:  npx tsx script/verify-desk-org.ts
 */
import 'dotenv/config';
import { prisma } from '../lib/prisma';
import { DEFAULT_PODS, ensureDefaultPods, WHOLE_POD_ACCESS } from '../lib/desk/pods';
import { canBeAccountManager, canBePodMember } from '../lib/roles';

let pass = 0, fail = 0;
const ok = (n: string, c: boolean) => { c ? pass++ : fail++; console.log(`  ${c ? '✓' : '✗'} ${n}`); };
const rejects = async (fn: () => Promise<unknown>) => { try { await fn(); return false; } catch { return true; } };

const TAG = `m2test-${Date.now()}`;
const cleanup = { agencies: [] as string[], users: [] as string[] };

async function tempUser(role: 'DESK_VA' | 'ACCOUNT_MANAGER', n: string) {
  const u = await prisma.user.create({ data: { email: `${TAG}-${n}@example.test`, role, isActive: true } });
  cleanup.users.push(u.id);
  return u;
}
async function tempAgency(n: string) {
  const a = await prisma.agency.create({ data: { name: `${TAG} ${n}` } });
  cleanup.agencies.push(a.id);
  return a;
}

(async () => {
  console.log('\n━━ Role eligibility ━━');
  ok('only ACCOUNT_MANAGER can be an AM',
    canBeAccountManager('ACCOUNT_MANAGER') &&
    !['DESK_VA', 'DESK_ADMIN', 'ADMIN', 'AGENT', 'SUPER_ADMIN'].some(canBeAccountManager));
  ok('DESK_VA and ACCOUNT_MANAGER can join pods; nobody else',
    canBePodMember('DESK_VA') && canBePodMember('ACCOUNT_MANAGER') &&
    !['DESK_ADMIN', 'ADMIN', 'AGENT', 'SUPER_ADMIN'].some(canBePodMember));

  console.log('\n━━ Default pods ━━');
  const pods = await prisma.pod.findMany({ orderBy: { sortOrder: 'asc' } });
  ok('the 4 default pods exist, in order',
    DEFAULT_PODS.every((d, i) => pods[i]?.code === d.code));
  ok('all active', pods.every((p) => p.isActive));
  ok('pod code is unique',
    await rejects(() => prisma.pod.create({ data: { code: 'QA', name: 'dup' } })));
  {
    const qa = pods.find((p) => p.code === 'QA')!;
    await prisma.pod.update({ where: { id: qa.id }, data: { name: `${TAG} renamed` } });
    const { created } = await ensureDefaultPods(prisma);
    const after = await prisma.pod.findUniqueOrThrow({ where: { id: qa.id } });
    ok('re-seeding creates nothing and keeps an admin rename',
      created.length === 0 && after.name === `${TAG} renamed`);
    await prisma.pod.update({ where: { id: qa.id }, data: { name: qa.name } });
  }
  const [pod1, pod2] = pods;

  console.log('\n━━ Pod membership ━━');
  const va = await tempUser('DESK_VA', 'va');
  const va2 = await tempUser('DESK_VA', 'va2');
  const am = await tempUser('ACCOUNT_MANAGER', 'am');
  await prisma.podMember.create({ data: { podId: pod1.id, userId: va.id } });
  ok('same user cannot join the same pod twice',
    await rejects(() => prisma.podMember.create({ data: { podId: pod1.id, userId: va.id } })));
  await prisma.podMember.create({ data: { podId: pod2.id, userId: va.id, isLead: true } });
  ok('one user can be in several pods',
    (await prisma.podMember.count({ where: { userId: va.id } })) === 2);

  console.log('\n━━ Account Manager assignment ━━');
  const agA = await tempAgency('A');
  const agB = await tempAgency('B');
  await prisma.agencyDeskAssignment.create({ data: { agencyId: agA.id, primaryAmId: am.id } });
  await prisma.agencyDeskAssignment.create({ data: { agencyId: agB.id, primaryAmId: am.id, backupAmId: va2.id } });
  ok('one AM can be primary for several agencies',
    (await prisma.agencyDeskAssignment.count({ where: { primaryAmId: am.id } })) === 2);
  ok('only one assignment per agency',
    await rejects(() => prisma.agencyDeskAssignment.create({ data: { agencyId: agA.id } })));
  {
    const viaRelation = await prisma.user.findUniqueOrThrow({
      where: { id: am.id }, include: { primaryAmFor: { select: { agencyId: true } } },
    });
    ok('AM → agencies readable through the relation', viaRelation.primaryAmFor.length === 2);
  }

  console.log('\n━━ Agency pod access ━━');
  await prisma.agencyPodAccess.create({ data: { agencyId: agA.id, podId: pod1.id } });
  ok('second "whole pod" row (userId null) for same agency + pod is rejected',
    await rejects(() => prisma.agencyPodAccess.create({ data: { agencyId: agA.id, podId: pod1.id } })));
  await prisma.agencyPodAccess.create({ data: { agencyId: agA.id, podId: pod2.id, userId: va.id } });
  await prisma.agencyPodAccess.create({ data: { agencyId: agA.id, podId: pod2.id, userId: va2.id } });
  ok('several named VAs on the same agency + pod are allowed',
    (await prisma.agencyPodAccess.count({ where: { agencyId: agA.id, podId: pod2.id } })) === 2);
  ok('same named VA twice is rejected',
    await rejects(() => prisma.agencyPodAccess.create({ data: { agencyId: agA.id, podId: pod2.id, userId: va.id } })));
  ok('"whole pod" row created without userId is found by WHOLE_POD_ACCESS',
    (await prisma.agencyPodAccess.count({ where: { agencyId: agA.id, podId: pod1.id, ...WHOLE_POD_ACCESS } })) === 1);
  ok('…which a bare `userId: null` misses (why the helper exists)',
    (await prisma.agencyPodAccess.count({ where: { agencyId: agA.id, podId: pod1.id, userId: null } })) === 0);
  ok('explicit-null whole-pod row also collides with the unset one',
    await rejects(() => prisma.agencyPodAccess.create({ data: { agencyId: agA.id, podId: pod1.id, userId: null } })));
  await prisma.agencyPodAccess.create({ data: { agencyId: agB.id, podId: pod1.id, userId: null } });
  ok('explicit-null whole-pod row is found by WHOLE_POD_ACCESS too',
    (await prisma.agencyPodAccess.count({ where: { agencyId: agB.id, podId: pod1.id, ...WHOLE_POD_ACCESS } })) === 1);

  console.log('\n━━ Delete behaviour ━━');
  await prisma.user.delete({ where: { id: va2.id } });
  cleanup.users = cleanup.users.filter((id) => id !== va2.id);
  ok('deleting a VA removes their named access rows',
    (await prisma.agencyPodAccess.count({ where: { userId: va2.id } })) === 0);
  ok('deleting a backup AM clears backupAmId but keeps the assignment',
    (await prisma.agencyDeskAssignment.findUniqueOrThrow({ where: { agencyId: agB.id } })).backupAmId === null);
  await prisma.agency.delete({ where: { id: agA.id } });
  cleanup.agencies = cleanup.agencies.filter((id) => id !== agA.id);
  ok('deleting an agency removes its assignment and pod access',
    (await prisma.agencyDeskAssignment.count({ where: { agencyId: agA.id } })) === 0 &&
    (await prisma.agencyPodAccess.count({ where: { agencyId: agA.id } })) === 0);

  // Cleanup: agencies first (cascades their Desk rows), then users (cascades memberships).
  await prisma.agency.deleteMany({ where: { id: { in: cleanup.agencies } } });
  await prisma.agencyDeskAssignment.deleteMany({ where: { agencyId: { in: cleanup.agencies } } });
  await prisma.podMember.deleteMany({ where: { userId: { in: cleanup.users } } });
  await prisma.agencyPodAccess.deleteMany({ where: { userId: { in: cleanup.users } } });
  await prisma.user.deleteMany({ where: { id: { in: cleanup.users } } });
  ok('cleaned up',
    (await prisma.user.count({ where: { email: { startsWith: TAG } } })) === 0 &&
    (await prisma.agency.count({ where: { name: { startsWith: TAG } } })) === 0 &&
    (await prisma.pod.count()) === DEFAULT_PODS.length);

  console.log(`\n━━ ${pass} passed, ${fail} failed ━━\n`);
  await prisma.$disconnect();
  process.exit(fail ? 1 : 0);
})().catch(async (e) => {
  console.error('ERROR', e);
  await prisma.podMember.deleteMany({ where: { userId: { in: cleanup.users } } }).catch(() => {});
  await prisma.agencyPodAccess.deleteMany({ where: { OR: [{ userId: { in: cleanup.users } }, { agencyId: { in: cleanup.agencies } }] } }).catch(() => {});
  await prisma.agencyDeskAssignment.deleteMany({ where: { agencyId: { in: cleanup.agencies } } }).catch(() => {});
  await prisma.agency.deleteMany({ where: { id: { in: cleanup.agencies } } }).catch(() => {});
  await prisma.user.deleteMany({ where: { id: { in: cleanup.users } } }).catch(() => {});
  await prisma.$disconnect();
  process.exit(1);
});
