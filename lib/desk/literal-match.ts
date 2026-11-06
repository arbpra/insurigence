/**
 * Prisma on MongoDB sends `contains`, and `equals` with `mode: 'insensitive'`,
 * to the database as a regular expression without escaping it. Text from a user
 * must go through this first. Otherwise "(" is a server error, ".*" matches
 * everything, and a crafted pattern can tie up the database.
 */
export function literal(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
