/**
 * Money handling for quote options.
 *
 * Premiums are stored as whole cents in a BigInt column so they are never
 * subject to floating-point drift, and BigInt does not survive JSON.stringify.
 * Everything crossing the API boundary therefore goes through these helpers:
 * cents in the database, plain dollar numbers on the wire.
 */

/** Largest premium we accept: $1,000,000,000. Guards against overflow and typos. */
const MAX_CENTS = BigInt('100000000000');

/**
 * Parse a user-supplied amount into whole cents.
 *
 * Accepts numbers (8750.25) and strings ("$8,750.25", "8750"). Returns null for
 * empty input, and throws RangeError for anything malformed or out of range so
 * the caller can turn it into a 400 rather than silently storing a wrong number.
 */
export function toCents(input: unknown): bigint | null {
  if (input === null || input === undefined || input === '') return null;

  let value: number;
  if (typeof input === 'number') {
    value = input;
  } else if (typeof input === 'string') {
    const cleaned = input.replace(/[$,\s]/g, '');
    if (cleaned === '') return null;
    if (!/^-?\d*\.?\d*$/.test(cleaned)) {
      throw new RangeError(`"${input}" is not a valid amount`);
    }
    value = Number(cleaned);
  } else {
    throw new RangeError('Amount must be a number or string');
  }

  if (!Number.isFinite(value)) throw new RangeError('Amount must be a finite number');
  if (value < 0) throw new RangeError('Amount cannot be negative');

  // Math.round absorbs the float representation error (8750.10 * 100 =
  // 875010.0000000001) for every magnitude we accept.
  const cents = BigInt(Math.round(value * 100));
  if (cents > MAX_CENTS) throw new RangeError('Amount is too large');
  return cents;
}

/** Convert stored cents back to a dollar number for JSON responses. */
export function fromCents(cents: bigint | null | undefined): number | null {
  if (cents === null || cents === undefined) return null;
  return Number(cents) / 100;
}

/**
 * Total annual cost = premium + taxes + fees.
 *
 * Used when the agent does not type a total explicitly. An explicit total always
 * wins: carriers sometimes quote a total that does not equal the parts, and the
 * carrier's number is the one that belongs in front of the insured.
 */
export function computeTotalCents(
  premium: bigint | null,
  taxes: bigint | null,
  fees: bigint | null
): bigint | null {
  if (premium === null && taxes === null && fees === null) return null;
  const zero = BigInt(0);
  return (premium ?? zero) + (taxes ?? zero) + (fees ?? zero);
}
