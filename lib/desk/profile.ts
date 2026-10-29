/**
 * Agency Desk profile helpers. Pure — safe for server and browser.
 */
import type { AmsSystem } from '@prisma/client';

export const AMS_SYSTEM_LABELS: Record<AmsSystem, string> = {
  APPLIED_EPIC: 'Applied Epic',
  AMS360: 'AMS360',
  HAWKSOFT: 'HawkSoft',
  EZLYNX: 'EZLynx',
  QQCATALYST: 'QQCatalyst',
  OTHER: 'Other',
};

/** Display name, using the free-text name when the AMS is "Other". */
export function amsDisplayName(system: AmsSystem | null | undefined, other?: string | null): string | null {
  if (!system) return null;
  if (system === 'OTHER') return other?.trim() || 'Other';
  return AMS_SYSTEM_LABELS[system];
}

/*
 * Credentials must never be stored in The Desk; they stay in the password
 * manager. Instructions are free text, so a value that reads like a secret
 * ("password: hunter2", "pwd=…", "api key: …") is refused rather than saved.
 * Mentions without a value ("logins are in 1Password", "reset the password
 * via the portal") are fine.
 */
const CREDENTIAL_PATTERNS: RegExp[] = [
  /\b(pass(word|wd|code|phrase)?|pwd|pw|pin)\b\s*[:=]\s*\S/i,
  /\b(api[\s_-]?key|secret|access[\s_-]?token|auth[\s_-]?token)\b\s*[:=]\s*\S/i,
  /\b(security|secret)\s+(answer|question)\b\s*[:=]\s*\S/i,
];

/** Returns a reason when the text looks like it contains a credential, else null. */
export function looksLikeCredential(text: string | null | undefined): string | null {
  if (!text) return null;
  for (const re of CREDENTIAL_PATTERNS) {
    if (re.test(text)) {
      return 'This looks like it contains a password or other credential. Credentials are never stored in The Desk — record where they live in the password manager instead.';
    }
  }
  return null;
}
