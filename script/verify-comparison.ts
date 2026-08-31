/**
 * Tests for the quote comparison diff engine.
 * Run with:  npx tsx script/verify-comparison.ts
 */
import { buildComparison, coverageMatchKey, parseLimitValue, differenceSummaries, costSummaries } from '../lib/quotes/comparison';
import type { QuoteOptionDTO } from '../lib/quotes/quoteOption';

let pass = 0, fail = 0;
const ok = (n: string, c: boolean) => { c ? pass++ : fail++; console.log(`  ${c ? '✓' : '✗'} ${n}`); };

function opt(id: string, label: string, coverages: unknown[], cost: Partial<QuoteOptionDTO> = {}): QuoteOptionDTO {
  return {
    id, leadId: 'l', agencyId: 'a', carrierId: null, optionLabel: label, carrierName: label,
    programName: null, lineOfBusiness: null, policyType: null, effectiveDate: null, expirationDate: null,
    quoteExpirationDate: null, premiumAnnual: null, taxes: null, fees: null, totalAnnual: null,
    paymentPlan: null, coverages, limits: null, deductibles: null, endorsements: null, exclusions: null,
    notes: null, documentName: null, documentSize: null, documentContentType: null, documentUploadedAt: null,
    hasDocument: false, isRecommended: false, recommendationRationale: null, rationaleAiDrafted: false,
    sortOrder: 0, createdAt: '', updatedAt: '', ...cost,
  } as QuoteOptionDTO;
}

console.log('\n━━ Coverage name matching ━━');
ok('parenthetical ignored', coverageMatchKey('General Liability (GL)') === coverageMatchKey('General Liability'));
ok('case/punctuation ignored', coverageMatchKey('Garagekeepers!') === coverageMatchKey('garagekeepers'));
ok('filler word ignored', coverageMatchKey('Cyber Coverage') === coverageMatchKey('Cyber'));
ok('different coverages stay separate', coverageMatchKey('General Liability') !== coverageMatchKey('Auto Liability'));

console.log('\n━━ Limit parsing ━━');
ok('$250,000', parseLimitValue('$250,000') === 250000);
ok('250K', parseLimitValue('250K') === 250000);
ok('$1.5M', parseLimitValue('$1.5M') === 1500000);
ok('split limit uses per-occurrence', parseLimitValue('$1M/$2M') === 1000000);
ok('unparseable → null', parseLimitValue('see policy') === null);

console.log('\n━━ Difference detection ━━');
{
  const c = buildComparison([
    opt('o1', 'Travelers', [{ key: 'a', name: 'Garagekeepers', limit: '$250,000', deductible: '$1,000', included: true }]),
    opt('o2', 'Westfield', [{ key: 'b', name: 'Garagekeepers', limit: '$100,000', deductible: '$2,500', included: true }]),
  ]);
  const row = c.coverageRows[0];
  ok('limit + deductible → mixed', row.differenceKind === 'mixed');
  ok('highest limit marked', row.cells.find(x => x.optionId === 'o1')!.isBestLimit);
  ok('lowest deductible marked', row.cells.find(x => x.optionId === 'o1')!.isBestDeductible);
  // Regression: mixed used to emit a vague sentence with no figures.
  ok('mixed sentence cites limits', row.summary!.includes('$250,000') && row.summary!.includes('$100,000'));
  ok('mixed sentence cites deductibles', row.summary!.includes('$2,500'));
}
{
  const c = buildComparison([
    opt('o1', 'A', [{ key: 'a', name: 'General Liability', limit: '$1M/$2M', deductible: '$1,000', included: true }]),
    opt('o2', 'B', [{ key: 'b', name: 'General Liability (GL)', limit: '$1M/$2M', deductible: '$1,000', included: true }]),
  ]);
  ok('identical → no difference', c.coverageRows[0].differs === false);
  ok('name variants merge to one row', c.coverageRows.length === 1);
}
{
  const c = buildComparison([
    opt('o1', 'A', [{ key: 'a', name: 'Cyber', limit: '$100,000', included: true }]),
    opt('o2', 'B', []),
  ]);
  ok('missing → availability', c.coverageRows[0].differenceKind === 'availability');
  ok('absence not treated as inclusion', c.coverageRows[0].cells.find(x => x.optionId === 'o2')!.included === false);
}
{
  const c = buildComparison([
    opt('o1', 'A', [{ key: 'a', name: 'X', limit: 'see policy', included: true }]),
    opt('o2', 'B', [{ key: 'b', name: 'X', limit: 'per schedule', included: true }]),
  ]);
  ok('unparseable but different → flagged', c.coverageRows[0].differs === true);
  const same = buildComparison([
    opt('o1', 'A', [{ key: 'a', name: 'X', limit: 'See Policy', included: true }]),
    opt('o2', 'B', [{ key: 'b', name: 'X', limit: 'see policy', included: true }]),
  ]);
  ok('unparseable identical → not flagged', same.coverageRows[0].differs === false);
}

console.log('\n━━ Cost facts (direction must be explicit) ━━');
{
  const c = buildComparison([
    opt('o1', 'Travelers', [], { totalAnnual: 9125 }),
    opt('o2', 'Westfield', [], { totalAnnual: 9200 }),
    opt('o3', 'E&S', [], { totalAnnual: 7900 }),
  ]);
  const costs = costSummaries(c);
  ok('cheapest identified', costs[0].includes('E&S') && costs[0].includes('$7,900'));
  ok('dearest identified', costs[0].includes('Westfield') && costs[0].includes('$9,200'));
  // Regression: the model once inferred Travelers was dearer than Westfield.
  ok('pairwise gaps stated', costs.some(l => l.includes('Travelers costs $1,225 more')));
  ok('no cost facts when totals equal', costSummaries(buildComparison([
    opt('o1', 'A', [], { totalAnnual: 9000 }), opt('o2', 'B', [], { totalAnnual: 9000 }),
  ])).length === 0);
  ok('empty cost rows dropped', c.costRows.every(r => r.key !== 'taxes'));
}

console.log('\n━━ Edge cases ━━');
ok('no options', buildComparison([]).coverageRows.length === 0);
ok('single option has no differences', buildComparison([opt('o1', 'A', [{ key: 'a', name: 'X', limit: '$1', included: true }])]).differenceCount === 0);
{
  const c = buildComparison([
    opt('o1', 'A', [{ name: 'Valid', included: true }, null, { name: '' }] as unknown[]),
    opt('o2', 'B', 'not-an-array' as unknown as unknown[]),
  ]);
  ok('malformed coverage data survives', c.coverageRows.length === 1);
}
ok('summaries omit identical rows', differenceSummaries(buildComparison([
  opt('o1', 'A', [{ key: 'a', name: 'X', limit: '$1', included: true }]),
  opt('o2', 'B', [{ key: 'b', name: 'X', limit: '$1', included: true }]),
])).length === 0);

console.log(`\n━━ ${pass} passed, ${fail} failed ━━\n`);
process.exit(fail ? 1 : 0);
