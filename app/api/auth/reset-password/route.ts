import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { hashPassword, verifyPassword } from '@/lib/auth';

/**
 * Reset a password with an emailed code.
 * Verifies email + 6-digit code (hashed, single-use, expiring, attempt-limited),
 * sets the new password, consumes the code, and invalidates existing sessions so
 * any attacker who had access is logged out.
 */

const MIN_PASSWORD = 8;
const MAX_ATTEMPTS = 5;
const INVALID = 'Invalid or expired verification code.';

export async function POST(request: NextRequest) {
  let body: { email?: string; code?: string; password?: string; confirmPassword?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const email = String(body.email ?? '').trim().toLowerCase();
  const code = String(body.code ?? '').trim();
  const password = String(body.password ?? '');

  if (!email || !code) {
    return NextResponse.json({ error: 'Email and verification code are required.' }, { status: 400 });
  }
  if (password.length < MIN_PASSWORD) {
    return NextResponse.json({ error: `Password must be at least ${MIN_PASSWORD} characters.` }, { status: 400 });
  }
  if (body.confirmPassword !== undefined && password !== body.confirmPassword) {
    return NextResponse.json({ error: 'Passwords do not match.' }, { status: 400 });
  }

  const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (!user) {
    return NextResponse.json({ error: INVALID }, { status: 400 });
  }

  // Note: don't filter on `usedAt: null` in the query — Prisma's MongoDB
  // connector treats unset as distinct from null, so a just-created token
  // (usedAt unset) wouldn't match. Fetch the latest and check usedAt in code.
  const token = await prisma.passwordResetToken.findFirst({
    where: { userId: user.id },
    orderBy: { createdAt: 'desc' },
  });

  if (!token || token.usedAt || token.expiresAt < new Date()) {
    return NextResponse.json({ error: INVALID }, { status: 400 });
  }
  if (token.attempts >= MAX_ATTEMPTS) {
    return NextResponse.json(
      { error: 'Too many incorrect attempts. Please request a new code.' },
      { status: 429 }
    );
  }

  const codeOk = await verifyPassword(code, token.codeHash);
  if (!codeOk) {
    await prisma.passwordResetToken.update({
      where: { id: token.id },
      data: { attempts: { increment: 1 } },
    });
    return NextResponse.json({ error: INVALID }, { status: 400 });
  }

  // Valid — set the new password and consume the code.
  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: await hashPassword(password), mustChangePassword: false },
  });
  await prisma.passwordResetToken.update({ where: { id: token.id }, data: { usedAt: new Date() } });

  // Security: log out everywhere; the user re-signs in with the new password.
  await prisma.session.deleteMany({ where: { userId: user.id } }).catch(() => null);

  return NextResponse.json({ success: true });
}
