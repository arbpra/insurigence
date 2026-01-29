import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest, AuthUser } from '@/lib/auth';

export async function validateSuperAdmin(request: NextRequest): Promise<{ valid: boolean; user?: AuthUser; response?: NextResponse }> {
  const user = await getSessionFromRequest(request);

  if (!user) {
    return {
      valid: false,
      response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    };
  }

  if (user.role !== 'SUPER_ADMIN') {
    return {
      valid: false,
      response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
    };
  }

  return { valid: true, user };
}

export async function getAuthContext(request: NextRequest): Promise<{ valid: boolean; user?: AuthUser; response?: NextResponse }> {
  const user = await getSessionFromRequest(request);

  if (!user) {
    return {
      valid: false,
      response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    };
  }

  return { valid: true, user };
}

export function validateSuperAdminKey(request: NextRequest): { valid: boolean; response?: NextResponse } {
  const key = request.nextUrl.searchParams.get('key') || request.headers.get('x-super-admin-key');
  const expectedKey = process.env.SUPER_ADMIN_KEY;

  if (!expectedKey) {
    return {
      valid: false,
      response: NextResponse.json({ error: 'Super admin not configured' }, { status: 500 }),
    };
  }

  if (key !== expectedKey) {
    return {
      valid: false,
      response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    };
  }

  return { valid: true };
}
