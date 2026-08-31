/**
 * Adversarial tests for the AI coverage guardrails (requirement 15).
 * Each case simulates a model doing something it must not be able to do.
 */
import {
  normalizeCoverages, mergeAiProse, markAgentEdits, needsAgentReview,
  toClientFacing, newCoverage, parseCoverageInput, CoverageValidationError,
} from '../lib/quotes/coverage';
import { CoverageBreakdownSchema } from '../lib/ai/schemas';

let pass = 0, fail = 0;
const ok = (n: string, c: boolean) => { c ? pass++ : fail++; console.log(`  ${c ? '✓' : '✗'} ${n}`); };

const stored = normalizeCoverages([
  { key: 'k1', name: 'Garagekeepers', limit: '$250,000', deductible: '$1,000', included: true },
  { key: 'k2', name: 'Cyber', limit: '$100,000', deductible: '$2,500', included: false },
]);

console.log('\n━━ AI cannot alter contractual terms ━━');
{
  // A model returning limits/deductibles/premiums it was never given.
  const malicious = [
    { key: 'k1', plainLanguage: 'Covers cars.', whyItMatters: 'You store cars.',
      limit: '$9,999,999', deductible: '$0', premium: 1, name: 'Something Else', included: false },
  ] as never;
  const { coverages } = mergeAiProse(stored, malicious);
  const k1 = coverages.find((c) => c.key === 'k1')!;
  ok('limit unchanged despite AI supplying one', k1.limit === '$250,000');
  ok('deductible unchanged', k1.deductible === '$1,000');
  ok('coverage name unchanged', k1.name === 'Garagekeepers');
  ok('included flag unchanged', k1.included === true);
  ok('prose was accepted', k1.plainLanguage === 'Covers cars.');
  ok('no premium field leaks onto the coverage', !('premium' in k1));
}

console.log('\n━━ AI cannot invent coverages ━━');
{
  const invented = [
    { key: 'k1', plainLanguage: 'Real.' },
    { key: 'DOES-NOT-EXIST', plainLanguage: 'Invented coverage.' },
  ];
  const { coverages, report } = mergeAiProse(stored, invented);
  ok('invented coverage does not appear', coverages.length === 2);
  ok('invented key is reported', report.unknownKeys.includes('DOES-NOT-EXIST'));
  ok('no coverage carries the invented text',
    !coverages.some((c) => c.plainLanguage === 'Invented coverage.'));
}

console.log('\n━━ Output schema has no numeric channel ━━');
{
  const parsed = CoverageBreakdownSchema.safeParse({
    coverages: [{ key: 'k1', plainLanguage: 'a', whyItMatters: 'b', differsFromOthers: 'c',
                  limit: '$1M', premium: 500 }],
  });
  ok('schema parses valid prose', parsed.success);
  if (parsed.success) {
    const item = parsed.data.coverages[0] as Record<string, unknown>;
    ok('limit stripped by schema', !('limit' in item));
    ok('premium stripped by schema', !('premium' in item));
  }
}

console.log('\n━━ Agent edits win over regeneration ━━');
{
  const edited = stored.map((c) =>
    c.key === 'k1' ? { ...c, plainLanguage: 'Agent wording.', agentEdited: true } : c);
  const { coverages } = mergeAiProse(edited, [{ key: 'k1', plainLanguage: 'AI overwrote it.' }]);
  ok('agent-edited prose preserved', coverages[0].plainLanguage === 'Agent wording.');

  const forced = mergeAiProse(edited, [{ key: 'k1', plainLanguage: 'AI overwrote it.' }],
    { overwriteEdited: true });
  ok('explicit overwrite still possible', forced.coverages[0].plainLanguage === 'AI overwrote it.');
}

console.log('\n━━ Review flag cannot be spoofed by the client ━━');
{
  const drafted = stored.map((c) => ({ ...c, plainLanguage: 'AI text', aiDrafted: true }));
  ok('AI draft starts unreviewed', needsAgentReview(drafted).length === 2);

  // Client lies: claims agent-authored content it never changed.
  const spoof = drafted.map((c) => ({ ...c, aiDrafted: false, agentEdited: true }));
  const checked = markAgentEdits(drafted, spoof);
  ok('provenance preserved — still marked AI-drafted', checked.every((c) => c.aiDrafted));
  ok('unchanged prose is not counted as edited', checked.every((c) => !c.agentEdited));
  ok('still flagged for review', needsAgentReview(checked).length === 2);

  // A genuine edit is detected.
  const real = drafted.map((c) =>
    c.key === 'k1' ? { ...c, plainLanguage: 'Agent rewrote this.' } : c);
  const after = markAgentEdits(drafted, real);
  ok('genuine edit detected', after.find((c) => c.key === 'k1')!.agentEdited === true);
  ok('only edited item clears review', needsAgentReview(after).length === 1);
}

console.log('\n━━ Editing reviewed text resets approval ━━');
{
  const approved = stored.map((c) => ({ ...c, aiDrafted: true, plainLanguage: 'x',
                                        reviewedAt: '2026-08-01T00:00:00.000Z' }));
  const changed = approved.map((c) => c.key === 'k1' ? { ...c, plainLanguage: 'y' } : c);
  const after = markAgentEdits(approved, changed);
  ok('approval cleared on edit', after.find((c) => c.key === 'k1')!.reviewedAt === null);
  ok('untouched approval preserved', after.find((c) => c.key === 'k2')!.reviewedAt !== null);
}

console.log('\n━━ Malformed stored data does not break a quote ━━');
{
  const junk = normalizeCoverages([
    null, 'string', 42, {}, { name: '' },
    { name: 'Valid', limit: 123 },
    { key: 'dup', name: 'A' }, { key: 'dup', name: 'B' },
  ]);
  ok('unusable entries dropped, valid kept', junk.length === 3);
  ok('duplicate keys regenerated', new Set(junk.map((c) => c.key)).size === 3);
  ok('non-string limit coerced away', junk.find((c) => c.name === 'Valid')!.limit === null);
  ok('non-array input yields empty list', normalizeCoverages('nope').length === 0);
}

console.log('\n━━ Agent input validation ━━');
{
  try { parseCoverageInput([{ limit: '$1' }]); ok('unnamed coverage rejected', false); }
  catch (e) { ok('unnamed coverage rejected', e instanceof CoverageValidationError); }
  try { parseCoverageInput(new Array(41).fill({ name: 'x' })); ok('over-long list rejected', false); }
  catch (e) { ok('over-long list rejected', e instanceof CoverageValidationError); }
  ok('empty input allowed', parseCoverageInput(null).length === 0);
}

console.log('\n━━ Client-facing projection hides the review trail ━━');
{
  const client = toClientFacing(stored.map((c) => ({ ...c, aiDrafted: true, differsFromOthers: 'comparison prose' })));
  const keys = Object.keys(client[0]);
  ok('no aiDrafted leaked', !keys.includes('aiDrafted'));
  ok('no agentEdited leaked', !keys.includes('agentEdited'));
  ok('no reviewedAt leaked', !keys.includes('reviewedAt'));
  ok('no internal key leaked', !keys.includes('key'));
  ok('limit and prose still present', keys.includes('limit') && keys.includes('plainLanguage'));
  ok('coverage differences still present (req 2)', keys.includes('differsFromOthers'));
}

console.log('\n━━ Helpers ━━');
ok('newCoverage has a unique key', newCoverage('X').key !== newCoverage('X').key);

console.log(`\n━━ ${pass} passed, ${fail} failed ━━\n`);
process.exit(fail ? 1 : 0);
