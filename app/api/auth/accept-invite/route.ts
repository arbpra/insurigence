import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { hashPassword, createSession } from '@/lib/auth';

/**
 * Accept a team invite.
 * GET  ?token=… → validate the link and return who it's for (to render the form).
 * POST { token, password } → set the user's own password, consume the token, sign in.
 *
 * Tokens are single-use and expiring, so no password ever travels by email.
 */

const MIN_PASSWORD = 8;

async function loadValidToken(token: string) {
  if (!token) return { error: 'Missing invite token.' as const };

  const invite = await prisma.inviteToken.findUnique({
    where: { token },
    include: {
      user: {
        select: { id: true, email: true, firstName: true, lastName: true, isActive: true, agency: { select: { name: true } } },
      },
    },
  });

  if (!invite) return { error: 'This invite link is invalid.' as const };
  if (invite.usedAt) return { error: 'This invite link has already been used. Please sign in instead.' as const };
  if (invite.expiresAt < new Date()) return { error: 'This invite link has expired. Ask your administrator to resend it.' as const };
  if (!invite.user?.isActive) return { error: 'This account is no longer active.' as const };

  return { invite };
}

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('token') ?? '';
  const { invite, error } = await loadValidToken(token);
  if (error) return NextResponse.json({ error }, { status: 400 });

  return NextResponse.json({
    valid: true,
    email: invite!.user.email,
    firstName: invite!.user.firstName,
    agencyName: invite!.user.agency?.name ?? null,
  });
}

export async function POST(request: NextRequest) {
  let body: { token?: string; password?: string; confirmPassword?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const password = String(body.password ?? '');
  if (password.length < MIN_PASSWORD) {
    return NextResponse.json({ error: `Password must be at least ${MIN_PASSWORD} characters.` }, { status: 400 });
  }
  if (body.confirmPassword !== undefined && password !== body.confirmPassword) {
    return NextResponse.json({ error: 'Passwords do not match.' }, { status: 400 });
  }

  const { invite, error } = await loadValidToken(String(body.token ?? ''));
  if (error) return NextResponse.json({ error }, { status: 400 });

  const user = await prisma.user.update({
    where: { id: invite!.userId },
    data: {
      passwordHash: await hashPassword(password),
      mustChangePassword: false,
      lastLoginAt: new Date(),
    },
  });

  // Consume the token so the link can't be reused.
  await prisma.inviteToken.update({ where: { id: invite!.id }, data: { usedAt: new Date() } });

  const sessionToken = await createSession(user.id);

  const response = NextResponse.json({
    success: true,
    user: { id: user.id, email: user.email, role: user.role, agencyId: user.agencyId },
  });

  response.cookies.set('session_token', sessionToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 7 * 24 * 60 * 60,
  });

  return response;
}
