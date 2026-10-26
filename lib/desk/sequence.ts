import type { PrismaClient } from '@prisma/client';

/** Task references start here so the first one reads as a real number (#1001). */
const TASK_REFERENCE_BASE = 1000;

/**
 * Next value of a named counter, starting at 1. Uses MongoDB findAndModify
 * with $inc + upsert, which is atomic — Prisma's upsert is a read-then-write
 * and can hand two concurrent callers the same number.
 */
export async function nextSequence(prisma: PrismaClient, name: string): Promise<number> {
  const result = (await prisma.$runCommandRaw({
    findAndModify: 'DeskCounter',
    query: { _id: name },
    update: { $inc: { value: 1 } },
    upsert: true,
    new: true,
  })) as { value?: { value?: unknown } };

  const raw = result.value?.value;
  // Raw results may arrive as extended JSON ({ $numberInt: "5" }) or a plain number.
  const n = Number(typeof raw === 'object' && raw !== null ? Object.values(raw)[0] : raw);
  if (!Number.isInteger(n) || n < 1) throw new Error(`Counter "${name}" returned an invalid value`);
  return n;
}

export async function nextTaskReference(prisma: PrismaClient): Promise<number> {
  return TASK_REFERENCE_BASE + (await nextSequence(prisma, 'task'));
}
