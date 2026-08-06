import { NextRequest, NextResponse } from 'next/server';
import { sendEmail } from '@/lib/email/send';
import { contactAdminEmail, contactConfirmationEmail } from '@/lib/email/templates';
import { EMAIL_FROM } from '@/lib/email/client';

/**
 * Public contact form. On submit, emails BOTH:
 *  - the team/admin (a notification of the submission, reply-to the sender), and
 *  - the sender (a confirmation that we received their message).
 *
 * The admin recipient is CONTACT_EMAIL (falls back to the EMAIL_FROM address).
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Extract just the address from a "Name <addr>" EMAIL_FROM string. */
function fromAddress(): string {
  const m = EMAIL_FROM.match(/<([^>]+)>/);
  return (m ? m[1] : EMAIL_FROM).trim();
}

export async function POST(request: NextRequest) {
  let body: { name?: string; email?: string; company?: string; message?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const name = String(body.name ?? '').trim();
  const email = String(body.email ?? '').trim().toLowerCase();
  const company = String(body.company ?? '').trim();
  const message = String(body.message ?? '').trim();

  if (!name || !email || !message) {
    return NextResponse.json({ error: 'Name, email, and message are required.' }, { status: 400 });
  }
  if (!EMAIL_RE.test(email)) {
    return NextResponse.json({ error: 'Please enter a valid email address.' }, { status: 400 });
  }
  if (message.length > 5000) {
    return NextResponse.json({ error: 'Message is too long.' }, { status: 400 });
  }

  const adminTo = process.env.CONTACT_EMAIL?.trim() || fromAddress();
  const data = { name, email, company, message };

  // Admin notification (send first — this is the one that must not be lost).
  const admin = contactAdminEmail(data);
  const adminResult = await sendEmail({ to: adminTo, subject: admin.subject, html: admin.html, text: admin.text });

  // Confirmation to the submitter.
  const confirm = contactConfirmationEmail(data);
  const userResult = await sendEmail({ to: email, subject: confirm.subject, html: confirm.html, text: confirm.text });

  if (!adminResult.ok && !userResult.ok) {
    return NextResponse.json(
      { error: adminResult.error || 'Could not send your message. Please try again later.' },
      { status: 502 }
    );
  }

  return NextResponse.json({
    success: true,
    adminEmailed: adminResult.ok,
    userEmailed: userResult.ok,
  });
}
