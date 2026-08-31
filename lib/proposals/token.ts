/**
 * Secure client links for proposals (requirement 6, requirement 17).
 *
 * A proposal link is the only thing standing between the public internet and an
 * insured's quotes, so the token carries all of the access control:
 *
 *  - 256 bits of CSPRNG entropy, so guessing is not a practical attack.
 *  - Unrelated to any database id, so a link leaks nothing about the record and
 *    cannot be walked to find another agency's proposal.
 *  - Revocable, and revocation is checked on every resolution.
 *  - Optionally expiring, likewise checked on every resolution.
 *
 * Every public read must go through `resolveProposalToken` rather than querying
 * `publicToken` directly, so none of those checks can be skipped by accident.
 */

import { randomBytes } from 'crypto';
import prisma from '../prisma';
import type { Proposal } from '@prisma/client';

/** 32 bytes = 256 bits, base64url so it is URL-safe without encoding. */
export function generateProposalToken(): string {
  return randomBytes(32).toString('base64url');
}

/** Default life of a proposal link. Long enough to decide, short enough to lapse. */
export const DEFAULT_LINK_LIFETIME_DAYS = 60;

export function defaultExpiry(from: Date = new Date()): Date {
  const d = new Date(from);
  d.setDate(d.getDate() + DEFAULT_LINK_LIFETIME_DAYS);
  return d;
}

export type TokenFailure = 'not_found' | 'revoked' | 'expired' | 'not_sent';

export type TokenResolution =
  | { ok: true; proposal: Proposal }
  | { ok: false; reason: TokenFailure };

/**
 * Resolve a public token to a proposal, applying every access rule.
 *
 * Failure reasons are distinguished so the public page can say something
 * accurate ("this link was withdrawn" vs "this link has expired") — but the
 * caller must be careful not to turn 'not_found' into anything that confirms
 * whether a token ever existed.
 */
export async function resolveProposalToken(token: string): Promise<TokenResolution> {
  if (typeof token !== 'string' || token.trim() === '') {
    return { ok: false, reason: 'not_found' };
  }

  const proposal = await prisma.proposal.findUnique({ where: { publicToken: token } });
  if (!proposal) return { ok: false, reason: 'not_found' };

  // Order matters: an explicitly withdrawn link reports as revoked even if it
  // would also have expired, because that is the more specific truth.
  if (proposal.tokenRevokedAt || proposal.status === 'REVOKED') {
    return { ok: false, reason: 'revoked' };
  }
  if (proposal.expiresAt && proposal.expiresAt.getTime() < Date.now()) {
    return { ok: false, reason: 'expired' };
  }
  // A proposal that was never sent has no business being readable, even if
  // someone got hold of a token minted early.
  if (proposal.status === 'DRAFT' || proposal.status === 'READY_TO_SEND') {
    return { ok: false, reason: 'not_sent' };
  }

  return { ok: true, proposal };
}

/** Wording shown on the public page for each failure. */
export const TOKEN_FAILURE_MESSAGE: Record<TokenFailure, string> = {
  not_found: 'This proposal link is not valid. Please check the link or contact your agent.',
  revoked: 'This proposal link has been withdrawn. Please contact your agent for an up-to-date proposal.',
  expired: 'This proposal link has expired. Please contact your agent for an up-to-date proposal.',
  not_sent: 'This proposal is not ready yet. Please contact your agent.',
};

/** Full client URL for a token. */
export function proposalUrl(token: string, appUrl: string): string {
  return `${appUrl.replace(/\/+$/, '')}/proposal/${token}`;
}
