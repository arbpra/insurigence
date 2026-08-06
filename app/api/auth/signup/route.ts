import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import prisma from '@/lib/prisma';
import { hashPassword, createSession } from '@/lib/auth';
import { DEFAULT_COMMERCIAL_GL_FORM } from '@/lib/defaultIntakeForm';

/**
 * Agency self-signup.
 * Creates a new Agency + its first user (ADMIN of that agency), provisions the
 * default Commercial GL intake form so the workspace is usable immediately, then
 * signs the user in.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD = 8;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const firstName = String(body.firstName ?? '').trim();
    const lastName = String(body.lastName ?? '').trim();
    const email = String(body.email ?? '').trim().toLowerCase();
    const agencyName = String(body.agencyName ?? '').trim();
    const password = String(body.password ?? '');
    const confirmPassword = String(body.confirmPassword ?? '');
    const acceptedTerms = Boolean(body.acceptedTerms);

    // --- Validation ---
    if (!firstName || !lastName || !email || !agencyName || !password) {
      return NextResponse.json({ error: 'All fields are required.' }, { status: 400 });
    }
    if (!EMAIL_RE.test(email)) {
      return NextResponse.json({ error: 'Please enter a valid email address.' }, { status: 400 });
    }
    if (password.length < MIN_PASSWORD) {
      return NextResponse.json(
        { error: `Password must be at least ${MIN_PASSWORD} characters.` },
        { status: 400 }
      );
    }
    if (password !== confirmPassword) {
      return NextResponse.json({ error: 'Passwords do not match.' }, { status: 400 });
    }
    if (!acceptedTerms) {
      return NextResponse.json(
        { error: 'You must agree to the Terms of Service and Privacy Policy.' },
        { status: 400 }
      );
    }

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return NextResponse.json(
        { error: 'An account with this email already exists. Please sign in instead.' },
        { status: 409 }
      );
    }

    // Signup creates a NEW agency. If one with this name already exists, block it —
    // otherwise we'd silently create a duplicate workspace and split the agency's
    // data. Joining an existing agency must go through an invite, never by typing
    // its name (which anyone could guess).
    const existingAgency = await prisma.agency.findFirst({
      where: { name: { equals: agencyName, mode: 'insensitive' } },
      select: { id: true },
    });
    if (existingAgency) {
      return NextResponse.json(
        {
          error:
            'An agency with this name already exists. If you belong to this agency, ask your administrator to invite you instead of creating a new workspace.',
        },
        { status: 409 }
      );
    }

    // --- Create the agency workspace ---
    const agency = await prisma.agency.create({
      data: {
        name: agencyName,
        primaryEmail: email,
        subscriptionTier: 'SOLO',
        allowedMarkets: ['standard'],
        riskTolerance: 'BALANCED',
        status: 'ACTIVE',
        esRecommendationsEnabled: true,
      },
    });

    let user;
    try {
      // The signup user owns the new agency → ADMIN. They chose their own
      // password, so no forced change on first login.
      user = await prisma.user.create({
        data: {
          agencyId: agency.id,
          email,
          passwordHash: await hashPassword(password),
          firstName,
          lastName,
          role: 'ADMIN',
          isActive: true,
          mustChangePassword: false,
        },
      });

      await prisma.intakeForm.create({
        data: {
          agencyId: agency.id,
          lob: DEFAULT_COMMERCIAL_GL_FORM.lob,
          name: DEFAULT_COMMERCIAL_GL_FORM.name,
          isActive: true,
          definition: DEFAULT_COMMERCIAL_GL_FORM.definition,
          // publicToken is `String? @unique`: MongoDB's unique index rejects a
          // second null, so always assign one. The form stays private — public
          // access requires isPublic (default false), not just a token.
          publicToken: randomBytes(32).toString('hex'),
        },
      });
    } catch (err) {
      // Roll back everything so a failed signup can be retried with the same
      // email (otherwise an orphaned user would block it).
      await prisma.intakeForm.deleteMany({ where: { agencyId: agency.id } }).catch(() => null);
      await prisma.user.deleteMany({ where: { email } }).catch(() => null);
      await prisma.agency.delete({ where: { id: agency.id } }).catch(() => null);
      throw err;
    }

    // Non-fatal: activity logging must not block signup.
    prisma.activityEvent
      .createMany({
        data: [
          { agencyId: agency.id, userId: user.id, eventType: 'AGENCY_CREATED', metadata: { agencyName } },
          { agencyId: agency.id, userId: user.id, eventType: 'USER_CREATED', metadata: { email } },
        ],
      })
      .catch((e) => console.error('Activity log error:', e));

    const sessionToken = await createSession(user.id);

    const response = NextResponse.json(
      {
        success: true,
        user: {
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          role: user.role,
          agencyId: user.agencyId,
        },
      },
      { status: 201 }
    );

    response.cookies.set('session_token', sessionToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 7 * 24 * 60 * 60,
    });

    return response;
  } catch (error) {
    console.error('Signup error:', error);
    return NextResponse.json({ error: 'An error occurred during signup.' }, { status: 500 });
  }
}
