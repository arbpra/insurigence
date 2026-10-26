import type { PrismaClient } from '@prisma/client';

/**
 * The Desk's starting pods. `code` is the stable key (routing rules and seeds
 * refer to it); name and description are only the initial display text — an
 * admin can rename a pod later and re-seeding will not overwrite that.
 */
export const DEFAULT_PODS = [
  {
    code: 'SERVICE_AMS',
    name: 'Pod 1 – Service & AMS Processing',
    description: 'COIs, endorsements, ACORDs, AMS data entry, policy updates, document uploads.',
    sortOrder: 1,
  },
  {
    code: 'RENEWALS',
    name: 'Pod 2 – Renewals & Remarketing',
    description: 'Renewal outreach, exposure gathering, applications, loss runs, carrier follow-ups, remarketing.',
    sortOrder: 2,
  },
  {
    code: 'NEW_BUSINESS',
    name: 'Pod 3 – New Business & Marketing',
    description: 'New-business intake, submissions, applications, quote collection, proposal preparation.',
    sortOrder: 3,
  },
  {
    code: 'QA',
    name: 'Pod 4 – Quality Assurance',
    description: 'Policy checking, quote verification, binder review, quality control. Initially covered largely by AMs.',
    sortOrder: 4,
  },
] as const;

export type DefaultPodCode = (typeof DEFAULT_PODS)[number]['code'];

/**
 * Matches AgencyPodAccess "whole pod" rows (no specific user). Prisma leaves an
 * omitted optional field unset in MongoDB, and `userId: null` alone does not
 * match unset — so every query for whole-pod rows must use this, never a bare null.
 * (The unique index treats null and unset alike, so duplicates are still blocked.)
 */
export const WHOLE_POD_ACCESS = {
  OR: [{ userId: null }, { userId: { isSet: false } }],
} as const;

/** Creates any default pod that does not exist yet. Safe to run repeatedly. */
export async function ensureDefaultPods(prisma: PrismaClient): Promise<{ created: string[] }> {
  const created: string[] = [];
  for (const pod of DEFAULT_PODS) {
    const existing = await prisma.pod.findUnique({ where: { code: pod.code }, select: { id: true } });
    if (existing) continue;
    await prisma.pod.create({ data: { ...pod } });
    created.push(pod.code);
  }
  return { created };
}
