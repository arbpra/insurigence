/**
 * Insured account helpers. Pure — safe for server and browser.
 */

/** Legal-entity words that do not distinguish one business from another. */
const ENTITY_SUFFIXES = new Set([
  'llc', 'inc', 'incorporated', 'corp', 'corporation', 'co', 'company',
  'ltd', 'limited', 'lp', 'llp', 'pllc', 'pc', 'pa',
]);

/**
 * Normalised insured name used to spot duplicates, so that
 * "ABC Plumbing, L.L.C." and "abc plumbing llc" produce the same key.
 *
 * Lowercases, strips accents, turns "&" into "and", drops punctuation, a
 * leading "the", and trailing entity suffixes. If that leaves nothing (the
 * name was only "LLC"), falls back to the lowercased name so the key is
 * never empty.
 */
export function insuredNameKey(name: string): string {
  const lowered = name.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  const words = lowered
    .replace(/&/g, ' and ')
    .replace(/[.,']/g, '')          // L.L.C. → llc, O'Brien → obrien
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);

  if (words[0] === 'the' && words.length > 1) words.shift();
  while (words.length > 1 && (ENTITY_SUFFIXES.has(words[words.length - 1]) || words[words.length - 1] === 'and')) {
    words.pop();
  }

  const key = words.join(' ');
  return key || lowered.replace(/\s+/g, ' ');
}
