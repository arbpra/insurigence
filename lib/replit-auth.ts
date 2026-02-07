import * as client from "openid-client";
import { cookies } from "next/headers";
import prisma from "./prisma";

let oidcConfig: client.Configuration | null = null;

export async function getOidcConfig() {
  if (!oidcConfig) {
    oidcConfig = await client.discovery(
      new URL(process.env.ISSUER_URL ?? "https://replit.com/oidc"),
      process.env.REPL_ID!
    );
  }
  return oidcConfig;
}

export interface ReplitUserClaims {
  sub: string;
  email?: string;
  first_name?: string;
  last_name?: string;
  profile_image_url?: string;
}

export async function findUserByEmail(email: string | undefined) {
  if (!email) return null;
  
  return await prisma.user.findFirst({
    where: { 
      email: email,
      isActive: true
    }
  });
}

export async function updateUserFromReplit(userId: string, claims: ReplitUserClaims) {
  return await prisma.user.update({
    where: { id: userId },
    data: {
      firstName: claims.first_name || undefined,
      lastName: claims.last_name || undefined,
      updatedAt: new Date()
    }
  });
}

export async function createReplitSession(userId: string) {
  const token = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  
  await prisma.session.create({
    data: {
      token,
      userId,
      expiresAt
    }
  });
  
  return { token, expiresAt };
}

export async function setSessionCookie(token: string, expiresAt: Date) {
  const cookieStore = await cookies();
  cookieStore.set('session_token', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    expires: expiresAt,
    path: '/'
  });
}
