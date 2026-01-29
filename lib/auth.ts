import { cookies } from 'next/headers';
import { randomBytes, scrypt, timingSafeEqual } from 'crypto';
import { promisify } from 'util';
import prisma from './prisma';
import { User, UserRole } from '@prisma/client';

const scryptAsync = promisify(scrypt);

const SESSION_COOKIE_NAME = 'session_token';
const SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export interface AuthUser {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  role: UserRole;
  agencyId: string | null;
  isActive: boolean;
  mustChangePassword: boolean;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const hash = (await scryptAsync(password, salt, 64)) as Buffer;
  return `${salt}:${hash.toString('hex')}`;
}

export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  const [salt, hash] = storedHash.split(':');
  if (!salt || !hash) return false;
  
  const hashBuffer = Buffer.from(hash, 'hex');
  const derivedKey = (await scryptAsync(password, salt, 64)) as Buffer;
  
  return timingSafeEqual(hashBuffer, derivedKey);
}

export function generateSessionToken(): string {
  return randomBytes(32).toString('hex');
}

export function generateTempPassword(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let password = '';
  const bytes = randomBytes(12);
  for (let i = 0; i < 12; i++) {
    password += chars[bytes[i] % chars.length];
  }
  return password;
}

export async function createSession(userId: string): Promise<string> {
  const token = generateSessionToken();
  const expiresAt = new Date(Date.now() + SESSION_DURATION_MS);
  
  await prisma.session.create({
    data: {
      userId,
      token,
      expiresAt,
    },
  });
  
  return token;
}

export async function deleteSession(token: string): Promise<void> {
  await prisma.session.deleteMany({
    where: { token },
  });
}

export async function deleteAllUserSessions(userId: string): Promise<void> {
  await prisma.session.deleteMany({
    where: { userId },
  });
}

export async function getSessionUser(token: string): Promise<AuthUser | null> {
  const session = await prisma.session.findUnique({
    where: { token },
    include: { user: true },
  });
  
  if (!session) return null;
  if (session.expiresAt < new Date()) {
    await deleteSession(token);
    return null;
  }
  
  const user = session.user;
  if (!user.isActive) return null;
  
  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    role: user.role,
    agencyId: user.agencyId,
    isActive: user.isActive,
    mustChangePassword: user.mustChangePassword,
  };
}

export async function getCurrentUser(): Promise<AuthUser | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;
  return getSessionUser(token);
}

export async function requireAuth(): Promise<AuthUser> {
  const user = await getCurrentUser();
  if (!user) {
    throw new Error('Unauthorized');
  }
  return user;
}

export async function requireRole(...allowedRoles: UserRole[]): Promise<AuthUser> {
  const user = await requireAuth();
  if (!allowedRoles.includes(user.role)) {
    throw new Error('Forbidden');
  }
  return user;
}

export async function requireSuperAdmin(): Promise<AuthUser> {
  return requireRole('SUPER_ADMIN');
}

export async function requireAgencyAccess(agencyId: string): Promise<AuthUser> {
  const user = await requireAuth();
  if (user.role === 'SUPER_ADMIN') return user;
  if (user.agencyId !== agencyId) {
    throw new Error('Forbidden');
  }
  return user;
}

export async function getSessionFromRequest(request: Request): Promise<AuthUser | null> {
  const cookieHeader = request.headers.get('cookie');
  if (!cookieHeader) return null;
  
  const cookies = parseCookies(cookieHeader);
  const token = cookies[SESSION_COOKIE_NAME];
  if (!token) return null;
  
  return getSessionUser(token);
}

export async function requireAuthFromRequest(request: Request): Promise<AuthUser> {
  const user = await getSessionFromRequest(request);
  if (!user) {
    throw new Error('Unauthorized');
  }
  return user;
}

export async function requireRoleFromRequest(request: Request, ...allowedRoles: UserRole[]): Promise<AuthUser> {
  const user = await requireAuthFromRequest(request);
  if (!allowedRoles.includes(user.role)) {
    throw new Error('Forbidden');
  }
  return user;
}

function parseCookies(cookieHeader: string): Record<string, string> {
  const cookies: Record<string, string> = {};
  const pairs = cookieHeader.split(';');
  for (const pair of pairs) {
    const [name, ...rest] = pair.trim().split('=');
    if (name) {
      cookies[name] = rest.join('=');
    }
  }
  return cookies;
}

export async function cleanExpiredSessions(): Promise<number> {
  const result = await prisma.session.deleteMany({
    where: {
      expiresAt: {
        lt: new Date(),
      },
    },
  });
  return result.count;
}
