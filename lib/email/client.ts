import { Resend } from 'resend';

/**
 * Resend client accessor (lazy singleton).
 *
 * Created on first use — not at import time — so the app never crashes when
 * RESEND_API_KEY is absent (email simply reports a clear error). Nothing outside
 * lib/email/send.ts should call this.
 */
const globalForResend = globalThis as unknown as { resend: Resend | undefined };

/** Where invite/system emails are sent from. Must be a verified Resend domain. */
export const EMAIL_FROM = process.env.EMAIL_FROM || 'Insurigence <onboarding@resend.dev>';

/** Public base URL used to build links inside emails. */
export const APP_URL = process.env.APP_URL || 'http://localhost:5000';

/** True when email sending is configured. */
export function isEmailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY?.trim());
}

export function getResendClient(): Resend {
  if (globalForResend.resend) return globalForResend.resend;

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey?.trim()) {
    throw new Error('RESEND_API_KEY is not set. Add it to your .env file.');
  }

  const client = new Resend(apiKey);
  if (process.env.NODE_ENV !== 'production') globalForResend.resend = client;
  return client;
}
