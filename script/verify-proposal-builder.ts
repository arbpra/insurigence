/**
 * Tests for the proposal builder: section framework, branding, disclaimer, and
 * the agent/client audience boundary (requirement 17).
 * Run with:  npx tsx script/verify-proposal-builder.ts
 */
import {
  defaultSections, normalizeSections, parseSectionInput, visibleSections,
  emptyContentSections, isContentSection, SECTION_DEFINITIONS, SectionValidationError,
} from '../lib/proposals/sections';
import {
  resolveBranding, resolveDisclaimer, safeHexColor,
  DEFAULT_PROPOSAL_DISCLAIMER, DEFAULT_BRAND_PRIMARY,
} from '../lib/proposals/branding';
import { assembleProposal, proposalReadiness } from '../lib/proposals/assemble';
import type { Agency, Lead, Proposal, QuoteOption } from '@prisma/client';

let pass = 0, fail = 0;
const ok = (n: string, c: boolean) => { c ? pass++ : fail++; console.log(`  ${c ? '✓' : '✗'} ${n}`); };
const rejects = (n: string, fn: () => unknown) => {
  try { fn(); ok(n, false); } catch (e) { ok(`${n} — ${(e as Error).message}`, e instanceof SectionValidationError); }
};

console.log('\n━━ Section framework ━━');
ok('nine sections defined', SECTION_DEFINITIONS.length === 9);
ok('defaults are all enabled', defaultSections().every(s => s.enabled));
ok('content sections get a body, data sections do not',
  defaultSections().every(s => isContentSection(s.key) ? s.body !== null : s.body === null));
ok('Next Steps ships with default wording',
  (defaultSections().find(s => s.key === 'nextSteps')!.body ?? '').length > 50);

console.log('\n━━ Stored JSON is handled defensively ━━');
{
  const messy = normalizeSections([
    { key: 'nextSteps', title: 'Custom Title', enabled: true, body: 'do this' },
    { key: 'notARealSection', title: 'Injected' },
    { key: 'nextSteps', title: 'Duplicate' },
    null, 'string', 42,
  ]);
  ok('unknown section keys dropped', !messy.some(s => (s.key as string) === 'notARealSection'));
  ok('duplicates collapse to first', messy.filter(s => s.key === 'nextSteps').length === 1);
  ok('custom title preserved', messy.find(s => s.key === 'nextSteps')!.title === 'Custom Title');
  ok('missing sections appended with defaults', messy.length === 9);
  ok('non-array input yields full defaults', normalizeSections('nope').length === 9);
}

console.log('\n━━ Required sections cannot be removed ━━');
{
  const disabled = normalizeSections([{ key: 'quoteOptions', enabled: false, title: 'Options' }]);
  ok('required section forced back on', disabled.find(s => s.key === 'quoteOptions')!.enabled === true);
  const optional = normalizeSections([{ key: 'importantNotes', enabled: false, title: 'Notes' }]);
  ok('optional section stays off', optional.find(s => s.key === 'importantNotes')!.enabled === false);
  rejects('disabling a required section via input', () =>
    parseSectionInput([{ key: 'quoteOptions', enabled: false, title: 'x', body: null }]));
}

console.log('\n━━ Section input validation ━━');
rejects('unknown key', () => parseSectionInput([{ key: 'evil', title: 'x' }]));
rejects('duplicate key', () => parseSectionInput([{ key: 'nextSteps' }, { key: 'nextSteps' }]));
rejects('non-array', () => parseSectionInput('nope'));
rejects('non-string body', () => parseSectionInput([{ key: 'importantNotes', body: 42 }]));
ok('valid input accepted', parseSectionInput(defaultSections()).length === 9);

console.log('\n━━ Empty-section detection ━━');
{
  const s = defaultSections().map(x => x.key === 'executiveSummary' ? { ...x, body: '' } : x);
  ok('empty enabled content section flagged',
    emptyContentSections(s).some(x => x.key === 'executiveSummary'));
  const hidden = s.map(x => x.key === 'executiveSummary' ? { ...x, enabled: false } : x);
  ok('hidden empty section not flagged', !emptyContentSections(hidden).some(x => x.key === 'executiveSummary'));
  ok('visibleSections filters disabled', visibleSections(hidden).length === 8);
}

console.log('\n━━ Branding ━━');
ok('#0D2137 accepted', safeHexColor('#0D2137') === '#0D2137');
ok('#abc accepted', safeHexColor('#abc') === '#abc');
ok('missing hash rejected', safeHexColor('0D2137') === null);
ok('css injection rejected', safeHexColor('red;}body{display:none') === null);
ok('url() rejected', safeHexColor('url(evil)') === null);
ok('named colour rejected', safeHexColor('red') === null);
ok('non-string rejected', safeHexColor(123) === null);
{
  const b = resolveBranding({ name: 'A', brandPrimaryColor: 'not-a-colour' });
  ok('invalid colour falls back to default', b.primaryColor === DEFAULT_BRAND_PRIMARY);
  const b2 = resolveBranding({ name: 'A', logoUrl: '   ' });
  ok('blank logo treated as none', b2.logoUrl === null);
}

console.log('\n━━ Disclaimer precedence ━━');
ok('platform default when nothing set', resolveDisclaimer(null) === DEFAULT_PROPOSAL_DISCLAIMER);
ok('agency override wins over default', resolveDisclaimer('Agency text') === 'Agency text');
ok('frozen text wins over agency', resolveDisclaimer('Agency text', 'Sent text') === 'Sent text');
ok('blank agency text falls back', resolveDisclaimer('   ') === DEFAULT_PROPOSAL_DISCLAIMER);
ok('default mentions it is not a policy', DEFAULT_PROPOSAL_DISCLAIMER.includes('not an insurance policy'));

console.log('\n━━ Audience boundary (requirement 17) ━━');
{
  const now = new Date();
  const agency = { id: 'ag', name: 'Acme', logoUrl: null, brandPrimaryColor: '#111111',
    brandSecondaryColor: '#00E6A7', proposalFooterText: null, proposalDisclaimerText: null,
    phone: '555', primaryEmail: 'a@b.c', website: null } as unknown as Agency;
  const lead = { id: 'l', insuredName: 'Joes Garage', agencyId: 'ag',
    marketClassification: 'EXCESS_SURPLUS', marketReasonCodes: ['SECRET_REASON'],
    marketConfidence: 0.9 } as unknown as Lead;
  const proposal = { id: 'p', title: 'T', status: 'DRAFT', version: 1, sections: null,
    createdAt: now, sentAt: null, clientMessage: null, disclaimerText: null,
    leadId: 'l', agencyId: 'ag', createdByUserId: null } as unknown as Proposal;
  const options = [{
    id: 'o1', optionLabel: 'Option 1', carrierName: 'Travelers', isRecommended: true,
    recommendationRationale: 'Best fit.', rationaleAiDrafted: false,
    notes: 'INTERNAL: carrier declined once before',
    coverages: [{ key: 'k', name: 'GL', limit: '$1M', included: true, plainLanguage: 'p',
                  whyItMatters: 'w', differsFromOthers: 'd', aiDrafted: true,
                  agentEdited: false, reviewedAt: null }],
    documentKey: 'agencies/ag/secret.pdf', documentName: 'q.pdf',
    premiumAnnualCents: BigInt(100000), totalAnnualCents: BigInt(110000),
    createdAt: now, updatedAt: now, effectiveDate: null, expirationDate: null,
    quoteExpirationDate: null, sortOrder: 0, agencyId: 'ag', leadId: 'l', carrierId: null,
    programName: null, lineOfBusiness: null, policyType: null, taxesCents: null,
    feesCents: null, paymentPlan: null, limits: null, deductibles: null,
    endorsements: null, exclusions: null, documentSize: null,
    documentContentType: null, documentUploadedAt: null,
  }] as unknown as QuoteOption[];

  const client = assembleProposal({ proposal, lead, agency, options }, { audience: 'client' });
  const blob = JSON.stringify(client);

  ok('no internal block for client', client.internal === undefined);
  ok('agent notes not in client payload', !blob.includes('INTERNAL: carrier declined'));
  ok('storage object key not in client payload', !blob.includes('agencies/ag/secret.pdf'));
  ok('AI review trail not in client payload', !blob.includes('aiDrafted'));
  ok('coverage differences ARE shown to the client (req 2)', blob.includes('differsFromOthers'));
  ok('internal join key withheld', !JSON.stringify(client.options[0].coverages).includes('"key"'));
  ok('market reason codes not in client payload', !blob.includes('SECRET_REASON'));
  ok('client still gets coverage prose', blob.includes('plainLanguage'));
  ok('client still gets the disclaimer', client.disclaimer === DEFAULT_PROPOSAL_DISCLAIMER);

  const agent = assembleProposal({ proposal, lead, agency, options }, { audience: 'agent' });
  ok('agent gets internal block', agent.internal !== undefined);
  ok('agent sees unreviewed AI count', agent.internal!.unreviewedAiCoverages === 1);
  ok('agent sees notes', agent.internal!.agentNotes[0]?.includes('INTERNAL'));
  ok('client sees only enabled sections', client.sections.every(s => s.enabled));

  console.log('\n━━ Readiness ━━');
  const { blockers, hints } = proposalReadiness(agent);
  ok('single option is a blocker', blockers.some(p => p.includes('Only one option')));
  ok('unreviewed AI is a blocker', blockers.some(p => p.includes('not been reviewed')));
  // Regression: empty optional sections used to block sending entirely, even
  // though they render nothing. They are a hint now.
  ok('empty optional section is a hint, not a blocker',
    hints.some(p => p.includes('is empty')) && !blockers.some(p => p.includes('empty')));
}

console.log(`\n━━ ${pass} passed, ${fail} failed ━━\n`);
process.exit(fail ? 1 : 0);
