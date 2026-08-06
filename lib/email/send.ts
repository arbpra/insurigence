import { getResendClient, isEmailConfigured, EMAIL_FROM } from './client';

/**
 * Central email sending. Every email in the app goes through here so the
 * from-address, error handling, and logging are consistent.
 *
 * Sending never throws: it returns a result so callers (e.g. inviting a user)
 * can succeed even if email delivery fails, and surface the problem instead.
 */
export interface SendResult {
  ok: boolean;
  id?: string;
  error?: string;
  /** True when RESEND_API_KEY isn't configured — email was skipped, not failed. */
  skipped?: boolean;
}

export async function sendEmail(params: {
  to: string;
  subject: string;
  html: string;
  text?: string;
}): Promise<SendResult> {
  if (!isEmailConfigured()) {
    console.warn('[email] RESEND_API_KEY not set — skipping send to', params.to);
    return { ok: false, skipped: true, error: 'Email is not configured.' };
  }

  try {
    const { data, error } = await getResendClient().emails.send({
      from: EMAIL_FROM,
      to: params.to,
      subject: params.subject,
      html: params.html,
      ...(params.text ? { text: params.text } : {}),
    });

    if (error) {
      console.error('[email] send failed:', error);
      return { ok: false, error: error.message ?? 'Email send failed.' };
    }
    return { ok: true, id: data?.id };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown email error';
    console.error('[email] send threw:', message);
    return { ok: false, error: message };
  }
}
