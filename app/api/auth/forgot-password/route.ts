import { NextRequest, NextResponse } from 'next/server';
import { randomInt } from 'crypto';
import prisma from '@/lib/prisma';
import { hashPassword } from '@/lib/auth';
import { sendEmail } from '@/lib/email/send';
import { passwordResetEmail } from '@/lib/email/templates';

/**
 * Request a password reset code.
 * Emails a 6-digit code (stored hashed) to the account. Always returns the same
 * generic response whether or not the email exists, so it can't be used to probe
 * which emails have accounts (enumeration protection).
 */

const CODE_TTL_MINUTES = 15;
const GENERIC = {
  message: 'If an account exists for that email, a verification code has been sent.',
};

export async function POST(request: NextRequest) {
  let body: { email?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const email = String(body.email ?? '').trim().toLowerCase();
  if (!email) {
    return NextResponse.json({ error: 'Email is required.' }, { status: 400 });
  }

  const user = await prisma.user.findUnique({ where: { email }, select: { id: true, firstName: true, isActive: true } });

  // Only actually send for a real, active account — but never reveal that.
  if (user && user.isActive) {
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const codeHash = await hashPassword(code);

    // Invalidate any prior codes, then store the new one.
    await prisma.passwordResetToken.deleteMany({ where: { userId: user.id } });
    await prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        codeHash,
        expiresAt: new Date(Date.now() + CODE_TTL_MINUTES * 60 * 1000),
      },
    });

    const mail = passwordResetEmail({ firstName: user.firstName, code, expiresInMinutes: CODE_TTL_MINUTES });
    await sendEmail({ to: email, subject: mail.subject, html: mail.html, text: mail.text });
  }

  return NextResponse.json(GENERIC);
}
