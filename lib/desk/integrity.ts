import type { PrismaClient } from '@prisma/client';

/*
 * Data invariants Prisma queries depend on but MongoDB does not enforce.
 * Prisma writes them on every create; these repairs only matter after raw
 * writes or manual edits. Each is idempotent.
 */

/**
 * Every Task stores restrictedToUserIds. A task without the list cannot be
 * matched by any Prisma list filter, so it would vanish from "unrestricted"
 * queues — this sets it to [] wherever it is missing. Returns how many were fixed.
 */
export async function backfillTaskLists(prisma: PrismaClient): Promise<number> {
  const result = (await prisma.$runCommandRaw({
    update: 'Task',
    updates: [{ q: { restrictedToUserIds: { $exists: false } }, u: { $set: { restrictedToUserIds: [] } }, multi: true }],
  })) as { nModified?: number };
  return Number(result.nModified ?? 0);
}

/** How many tasks break the invariant (expected 0). */
export async function countTasksMissingLists(prisma: PrismaClient): Promise<number> {
  const result = (await prisma.$runCommandRaw({
    count: 'Task',
    query: { restrictedToUserIds: { $exists: false } },
  })) as { n?: number };
  return Number(result.n ?? 0);
}
