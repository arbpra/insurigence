/**
 * Tests for proposal delivery: token security, revocation, expiry, and the
 * email template's disclosure boundary.
 * Run with:  npx tsx script/verify-delivery.ts
 */
import { prisma } from '../lib/prisma';
import {
  generateProposalToken, resolveProposalToken, defaultExpiry,
  proposalUrl, TOKEN_FAILURE_MESSAGE, DEFAULT_LINK_LIFETIME_DAYS,
} from '../lib/proposals/token';
import { proposalSentEmail } from '../lib/email/templates';

let pass = 0, fail = 0;
const ok = (n: string, c: boolean) => { c ? pass++ : fail++; console.log(`  ${c ? '✓' : '✗'} ${n}`); };

(async () => {
  console.log('\n━━ Token strength ━━');
  {
    const tokens = Array.from({ length: 500 }, () => generateProposalToken());
    ok('no collisions across 500 tokens', new Set(tokens).size === 500);
    ok('url-safe characters only', tokens.every(t => /^[A-Za-z0-9_-]+$/.test(t)));
    ok('at least 256 bits of entropy encoded', tokens[0].length >= 43);
    ok('does not look like an ObjectId', tokens.every(t => !/^[0-9a-f]{24}$/.test(t)));
  }

  console.log('\n━━ Expiry defaults ━━');
  {
    const from = new Date('2026-01-01T00:00:00Z');
    const exp = defaultExpiry(from);
    const days = Math.round((exp.getTime() - from.getTime()) / 86_400_000);
    ok(`default lifetime is ${DEFAULT_LINK_LIFETIME_DAYS} days`, days === DEFAULT_LINK_LIFETIME_DAYS);
  }

  console.log('\n━━ URL building ━━');
  ok('no double slash when base has one', proposalUrl('abc', 'https://x.com/') === 'https://x.com/proposal/abc');
  ok('token is the whole path segment', proposalUrl('abc', 'https://x.com') === 'https://x.com/proposal/abc');

  console.log('\n━━ Token resolution against the live database ━━');
  const lead = await prisma.lead.findFirst({ select: { id: true, agencyId: true } });
  if (!lead) { console.log('  ! no lead available'); process.exit(1); }

  const base = { agencyId: lead.agencyId, leadId: lead.id, title: 'Token test', sections: [] as never };
  const made: string[] = [];
  const make = async (data: Record<string, unknown>) => {
    const p = await prisma.proposal.create({ data: { ...base, ...data } as never });
    made.push(p.id);
    return p;
  };

  // Garbage input
  ok('empty token rejected', (await resolveProposalToken('')).ok === false);
  ok('unknown token rejected', (await resolveProposalToken(generateProposalToken())).ok === false);

  // Draft — token exists but the proposal was never sent
  const draft = await make({ status: 'DRAFT', publicToken: generateProposalToken() });
  {
    const r = await resolveProposalToken(draft.publicToken!);
    ok('draft is not readable even with a valid token', !r.ok && r.reason === 'not_sent');
  }

  // Sent — the happy path
  const sent = await make({ status: 'SENT', publicToken: generateProposalToken(), sentAt: new Date(), expiresAt: defaultExpiry() });
  {
    const r = await resolveProposalToken(sent.publicToken!);
    ok('sent proposal resolves', r.ok === true);
  }

  // Revoked
  const revoked = await make({ status: 'REVOKED', publicToken: generateProposalToken(), sentAt: new Date(), tokenRevokedAt: new Date() });
  {
    const r = await resolveProposalToken(revoked.publicToken!);
    ok('revoked link refuses', !r.ok && r.reason === 'revoked');
  }

  // Expired
  const expired = await make({
    status: 'SENT', publicToken: generateProposalToken(), sentAt: new Date('2026-01-01'),
    expiresAt: new Date('2026-02-01'),
  });
  {
    const r = await resolveProposalToken(expired.publicToken!);
    ok('expired link refuses', !r.ok && r.reason === 'expired');
  }

  // Revoked AND expired reports the more specific reason
  const both = await make({
    status: 'SENT', publicToken: generateProposalToken(), sentAt: new Date('2026-01-01'),
    expiresAt: new Date('2026-02-01'), tokenRevokedAt: new Date(),
  });
  {
    const r = await resolveProposalToken(both.publicToken!);
    ok('revocation reported ahead of expiry', !r.ok && r.reason === 'revoked');
  }

  // A signed proposal stays readable — the insured keeps their copy
  const signed = await make({
    status: 'SIGNED', publicToken: generateProposalToken(), sentAt: new Date(),
    signedAt: new Date(), lockedAt: new Date(), expiresAt: defaultExpiry(),
  });
  {
    const r = await resolveProposalToken(signed.publicToken!);
    ok('signed proposal remains readable to the insured', r.ok === true);
  }

  console.log('\n━━ Failure messages give nothing away ━━');
  {
    const all = Object.values(TOKEN_FAILURE_MESSAGE).join(' ').toLowerCase();
    ok('no database wording leaked', !/objectid|proposal id|database|record/.test(all));
    ok('every failure has a message', Object.keys(TOKEN_FAILURE_MESSAGE).length === 4);
  }

  console.log('\n━━ Email discloses nothing private ━━');
  {
    const mail = proposalSentEmail({
      insuredName: 'Joes Garage', agencyName: 'Acme Insurance', agentName: 'Pat Lee',
      proposalUrl: 'https://app.example.com/proposal/tok', clientMessage: 'Have a look.',
      expiresAt: new Date('2026-12-31'), isResend: false,
    });
    const blob = (mail.html + mail.text).toLowerCase();
    ok('no premium in the email', !/\$\s?\d/.test(blob));
    ok('no carrier names in the email', !blob.includes('travelers') && !blob.includes('westfield'));
    ok('link is present', blob.includes('/proposal/tok'));
    ok('agent and agency named', blob.includes('pat lee') && blob.includes('acme insurance'));
    ok('warns against forwarding', blob.includes("don't forward") || blob.includes('do not forward'));
    ok('covering note included', blob.includes('have a look'));

    const resend = proposalSentEmail({
      insuredName: 'X', agencyName: 'Y', proposalUrl: 'u', isResend: true,
    });
    ok('resend subject differs', resend.subject.toLowerCase().includes('reminder'));
  }

  console.log('\n━━ HTML escaping ━━');
  {
    const mail = proposalSentEmail({
      insuredName: '<script>alert(1)</script>', agencyName: 'A & B "Co"',
      proposalUrl: 'https://x/y', clientMessage: '<img onerror=x>',
    });
    ok('script tag escaped', !mail.html.includes('<script>alert(1)</script>'));
    ok('ampersand escaped', mail.html.includes('A &amp; B'));
    ok('injected img tag escaped', !mail.html.includes('<img onerror=x>'));
  }

  await prisma.proposal.deleteMany({ where: { id: { in: made } } });
  ok('test proposals cleaned up',
    (await prisma.proposal.count({ where: { id: { in: made } } })) === 0);

  console.log(`\n━━ ${pass} passed, ${fail} failed ━━\n`);
  await prisma.$disconnect();
  process.exit(fail ? 1 : 0);
})().catch(async (e) => { console.error('ERROR', e); await prisma.$disconnect(); process.exit(1); });
