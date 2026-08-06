import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import prisma from '@/lib/prisma';
import { getAuthContext } from '@/lib/super-admin-auth';
import { sendEmail } from '@/lib/email/send';
import { inviteEmail } from '@/lib/email/templates';
import { APP_URL } from '@/lib/email/client';

/**
 * Agency team management (agency admins only).
 * GET  → users in the caller's own agency.
 * POST → invite a teammate: creates a user in the caller's agency with a
 *        temporary password they must change on first login.
 *
 * This is how an agent joins an existing agency. Membership is invite-only —
 * never by self-asserting an agency name at signup (which anyone could guess).
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const INVITABLE_ROLES = ['AGENT', 'ADMIN'] as const;
const INVITE_TTL_HOURS = 72;

/** Only an ADMIN of an agency may manage that agency's team. */
async function requireAgencyAdmin(request: NextRequest) {
  const auth = await getAuthContext(request);
  if (!auth.valid || !auth.user) return { error: auth.response! };

  const { user } = auth;
  if (user.role !== 'ADMIN' && user.role !== 'SUPER_ADMIN') {
    return { error: NextResponse.json({ error: 'Only agency admins can manage the team.' }, { status: 403 }) };
  }
  if (!user.agencyId) {
    return { error: NextResponse.json({ error: 'No agency assigned to your account.' }, { status: 403 }) };
  }
  return { user, agencyId: user.agencyId };
}

export async function GET(request: NextRequest) {
  const auth = await requireAgencyAdmin(request);
  if (auth.error) return auth.error;

  const users = await prisma.user.findMany({
    where: { agencyId: auth.agencyId },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      role: true,
      isActive: true,
      mustChangePassword: true,
      lastLoginAt: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'desc' },
  });

  return NextResponse.json({ users });
}

export async function POST(request: NextRequest) {
  const auth = await requireAgencyAdmin(request);
  if (auth.error) return auth.error;

  let body: { email?: string; firstName?: string; lastName?: string; role?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const email = String(body.email ?? '').trim().toLowerCase();
  const firstName = String(body.firstName ?? '').trim();
  const lastName = String(body.lastName ?? '').trim();
  const role = String(body.role ?? 'AGENT');

  if (!email || !EMAIL_RE.test(email)) {
    return NextResponse.json({ error: 'A valid email address is required.' }, { status: 400 });
  }
  if (!firstName || !lastName) {
    return NextResponse.json({ error: 'First and last name are required.' }, { status: 400 });
  }
  // Never allow escalating to SUPER_ADMIN or inviting into another agency.
  if (!(INVITABLE_ROLES as readonly string[]).includes(role)) {
    return NextResponse.json({ error: 'Role must be AGENT or ADMIN.' }, { status: 400 });
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return NextResponse.json({ error: 'A user with this email already exists.' }, { status: 409 });
  }

  // No password is set here — the invitee sets their own via the invite link, so
  // no password is ever emailed. Until then passwordHash is null, which the login
  // route already refuses ("Password not set"), so the account can't be used.
  const user = await prisma.user.create({
    data: {
      agencyId: auth.agencyId, // forced to the caller's agency
      email,
      firstName,
      lastName,
      role: role as 'AGENT' | 'ADMIN',
      isActive: true,
      mustChangePassword: false,
    },
    select: { id: true, email: true, firstName: true, lastName: true, role: true, isActive: true, createdAt: true },
  });

  const token = randomBytes(32).toString('hex');
  await prisma.inviteToken.create({
    data: {
      token,
      userId: user.id,
      expiresAt: new Date(Date.now() + INVITE_TTL_HOURS * 60 * 60 * 1000),
    },
  });

  const acceptUrl = `${APP_URL}/invite/${token}`;
  const agency = await prisma.agency.findUnique({
    where: { id: auth.agencyId },
    select: { name: true },
  });
  const invitedByName =
    [auth.user!.firstName, auth.user!.lastName].filter(Boolean).join(' ') || auth.user!.email;

  const mail = inviteEmail({
    inviteeName: firstName,
    agencyName: agency?.name ?? 'your agency',
    invitedByName,
    acceptUrl,
    expiresInHours: INVITE_TTL_HOURS,
  });
  const sent = await sendEmail({ to: email, subject: mail.subject, html: mail.html, text: mail.text });

  prisma.activityEvent
    .create({
      data: {
        agencyId: auth.agencyId,
        userId: auth.user!.id,
        eventType: 'USER_CREATED',
        metadata: { createdUserId: user.id, email: user.email, role: user.role, emailSent: sent.ok },
      },
    })
    .catch((e) => console.error('Activity log error:', e));

  // If email isn't configured or delivery failed, return the link so the admin
  // can still share it — the invite itself is already valid.
  return NextResponse.json(
    {
      user,
      emailSent: sent.ok,
      emailError: sent.ok ? undefined : sent.error,
      acceptUrl: sent.ok ? undefined : acceptUrl,
    },
    { status: 201 }
  );
}
