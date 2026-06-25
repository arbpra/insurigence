/** Read the first non-empty value among candidate keys from the answers map. */
export function pick(answers: Record<string, unknown>, keys: string[]): string {
  for (const k of keys) {
    const v = answers[k];
    if (v !== undefined && v !== null && String(v).trim() !== '') return String(v).trim();
  }
  return '';
}
