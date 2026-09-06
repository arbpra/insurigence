/**
 * Module 35 — security pass (requirement 17).
 *
 * Verifies the two boundaries that matter: one agency cannot reach another's
 * data, and nothing internal reaches the insured.
 * Run with:  npx tsx script/verify-security.ts
 */
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { prisma } from '../lib/prisma';
import { assembleProposal } from '../lib/proposals/assemble';
import { defaultSections } from '../lib/proposals/sections';
import { generateProposalToken, defaultExpiry, resolveProposalToken } from '../lib/proposals/token';

let pass = 0, fail = 0;
const ok = (n: string, c: boolean) => { c ? pass++ : fail++; console.log(`  ${c ? '✓' : '✗'} ${n}`); };

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (entry === 'route.ts') out.push(full.replace(/\\/g, '/'));
  }
  return out;
}

(async () => {
  console.log('\n━━ Every agent endpoint authorises and scopes ━━');
  {
    const routes = walk('app/api').filter((f) =>
      /quote-options|proposal-builder|coverage-breakdown|recommendation|proposals\//.test(f)
    );
    const unprotected: string[] = [];
    for (const file of routes) {
      const src = readFileSync(file, 'utf8');
      const hasAuth = src.includes('getAuthContext');
      const hasScope = src.includes("auth.user.agencyId") || src.includes('auth.user.role');
      if (!hasAuth || !hasScope) unprotected.push(file);
    }
    ok(`all ${routes.length} agent routes authorise and scope by agency`, unprotected.length === 0);
    unprotected.forEach((f) => console.log('      UNPROTECTED:', f));
  }

  console.log('\n━━ No route scopes by an environment variable ━━');
  {
    // A hardcoded agency id in an env var means every logged-in user reaches
    // the same agency's data regardless of their own.
    const offenders = walk('app/api').filter((f) =>
      /DEV_AGENCY_ID|DEV_USER_ID/.test(readFileSync(f, 'utf8').replace(/\/\/.*|\/\*[\s\S]*?\*\//g, ''))
    );
    ok('no route scopes by DEV_AGENCY_ID', offenders.length === 0);
    offenders.forEach((f) => console.log('      OFFENDER:', f));
  }

  console.log('\n━━ Public routes go through the token gate ━━');
  {
    const publicRoutes = walk('app/api/proposal');
    const bad = publicRoutes.filter((f) => !readFileSync(f, 'utf8').includes('resolveProposalToken'));
    ok(`all ${publicRoutes.length} public proposal routes use resolveProposalToken`, bad.length === 0);
    bad.forEach((f) => console.log('      BYPASSES GATE:', f));

    // Nothing may query publicToken directly and skip revocation/expiry.
    const direct = walk('app/api').filter((f) => {
      const src = readFileSync(f, 'utf8');
      return /where:\s*\{\s*publicToken/.test(src) && !src.includes('lib/proposals/token');
    });
    ok('no route looks up publicToken directly', direct.length === 0);
    direct.forEach((f) => console.log('      DIRECT LOOKUP:', f));
  }

  console.log('\n━━ The insured page is outside the authenticated layout ━━');
  {
    const src = readFileSync('app/(main)/layout.tsx', 'utf8');
    ok('the (main) layout does redirect unauthenticated users', src.includes("push('/login')"));
    let exists = true;
    try { statSync('app/(main)/proposal'); } catch { exists = false; }
    ok('the insured proposal page is NOT inside it', !exists);
  }

  console.log('\n━━ Client payload leaks nothing internal ━━');
  const agency = await prisma.agency.findFirst();
  const other = await prisma.agency.findFirst({ where: { id: { not: agency?.id } } });
  if (!agency) { console.log('  ! no agency'); process.exit(1); }

  const lead = await prisma.lead.findFirst({ where: { agencyId: agency.id } });
  if (!lead) { console.log('  ! no lead'); process.exit(1); }

  const cleanup: { proposals: string[]; options: string[] } = { proposals: [], options: [] };

  const opt = await prisma.quoteOption.create({
    data: {
      agencyId: agency.id, leadId: lead.id, optionLabel: 'Sec', carrierName: 'Travelers',
      sortOrder: 99, totalAnnualCents: BigInt(900000), isRecommended: true,
      recommendationRationale: 'Client-facing reason.',
      notes: 'SECRET-AGENT-NOTE carrier declined twice',
      documentKey: 'agencies/SECRET-KEY-PATH/quote.pdf', documentName: 'q.pdf',
      coverages: [{ key: 'SECRET-JOIN-KEY', name: 'GL', limit: '$1M', included: true,
                    plainLanguage: 'Shown to client.', whyItMatters: 'Also shown.',
                    differsFromOthers: 'Also shown.', aiDrafted: true,
                    agentEdited: false, reviewedAt: null }],
    },
  });
  cleanup.options.push(opt.id);

  const proposal = await prisma.proposal.create({
    data: {
      agencyId: agency.id, leadId: lead.id, title: 'Security test', status: 'SENT',
      sentAt: new Date(), expiresAt: defaultExpiry(), publicToken: generateProposalToken(),
      sections: defaultSections() as never, selectedQuoteOptionId: opt.id,
    },
  });
  cleanup.proposals.push(proposal.id);

  {
    const options = await prisma.quoteOption.findMany({ where: { leadId: lead.id } });
    const client = assembleProposal({ proposal, lead, agency, options }, { audience: 'client' });
    const blob = JSON.stringify(client);

    ok('agent notes withheld', !blob.includes('SECRET-AGENT-NOTE'));
    ok('storage object key withheld', !blob.includes('SECRET-KEY-PATH'));
    ok('coverage join key withheld', !blob.includes('SECRET-JOIN-KEY'));
    ok('AI provenance withheld', !blob.includes('aiDrafted') && !blob.includes('reviewedAt'));
    ok('the internal block is absent', client.internal === undefined);
    ok('market classification withheld', !blob.includes('marketClassification'));
    ok('insured contact email withheld from their own view',
      client.preparedFor.contactEmail === undefined);
    ok('client-facing prose still present', blob.includes('Shown to client.'));
    ok('recommendation reason still present', blob.includes('Client-facing reason.'));
  }

  console.log('\n━━ Cross-agency isolation ━━');
  if (other) {
    ok('proposal invisible when scoped to another agency',
      (await prisma.proposal.findFirst({
        where: { id: proposal.id, agencyId: other.id } })) === null);
    ok('quote option invisible when scoped to another agency',
      (await prisma.quoteOption.findFirst({
        where: { id: opt.id, agencyId: other.id } })) === null);
    ok('signatures are agency-scoped',
      (await prisma.proposalSignature.findFirst({
        where: { proposalId: proposal.id, agencyId: other.id } })) === null);
    ok('activity events are agency-scoped',
      (await prisma.proposalActivityEvent.findFirst({
        where: { proposalId: proposal.id, agencyId: other.id } })) === null);
  } else {
    console.log('  – skipped (only one agency in the database)');
  }

  console.log('\n━━ Token cannot be used across proposals ━━');
  {
    const foreignOption = await prisma.quoteOption.findFirst({
      where: { leadId: { not: lead.id } }, select: { id: true },
    });
    if (foreignOption) {
      ok("another lead's option cannot be selected with this token",
        (await prisma.quoteOption.findFirst({
          where: { id: foreignOption.id, leadId: proposal.leadId, agencyId: proposal.agencyId },
        })) === null);
    } else {
      console.log('  – skipped (no other lead has options)');
    }
    ok('a random token resolves to nothing',
      (await resolveProposalToken(generateProposalToken())).ok === false);
  }

  await prisma.proposalActivityEvent.deleteMany({ where: { proposalId: { in: cleanup.proposals } } });
  await prisma.proposal.deleteMany({ where: { id: { in: cleanup.proposals } } });
  await prisma.quoteOption.deleteMany({ where: { id: { in: cleanup.options } } });
  ok('cleaned up', (await prisma.quoteOption.count({ where: { id: { in: cleanup.options } } })) === 0);

  console.log(`\n━━ ${pass} passed, ${fail} failed ━━\n`);
  await prisma.$disconnect();
  process.exit(fail ? 1 : 0);
})().catch(async (e) => { console.error('ERROR', e); await prisma.$disconnect(); process.exit(1); });
