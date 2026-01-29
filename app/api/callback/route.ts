import { NextRequest, NextResponse } from "next/server";
import * as client from "openid-client";
import { getOidcConfig, findUserByEmail, updateUserFromReplit, createReplitSession, setSessionCookie } from "@/lib/replit-auth";

export async function GET(request: NextRequest) {
  try {
    const config = await getOidcConfig();
    
    const tokens = await client.authorizationCodeGrant(config, request.nextUrl, {
      expectedState: client.skipStateCheck,
      idTokenExpected: true,
    });
    
    const claims = tokens.claims();
    if (!claims) {
      throw new Error("No claims in token");
    }
    
    const email = claims.email as string | undefined;
    const existingUser = await findUserByEmail(email);
    
    if (!existingUser) {
      return NextResponse.redirect(new URL("/login?error=not_invited", request.url));
    }
    
    await updateUserFromReplit(existingUser.id, {
      sub: claims.sub,
      email: email,
      first_name: claims.first_name as string | undefined,
      last_name: claims.last_name as string | undefined,
      profile_image_url: claims.profile_image_url as string | undefined,
    });
    
    const { token, expiresAt } = await createReplitSession(existingUser.id);
    await setSessionCookie(token, expiresAt);
    
    if (existingUser.role === 'SUPER_ADMIN') {
      return NextResponse.redirect(new URL("/super-admin", request.url));
    }
    
    return NextResponse.redirect(new URL("/dashboard", request.url));
  } catch (error) {
    console.error("Callback error:", error);
    return NextResponse.redirect(new URL("/login?error=auth_failed", request.url));
  }
}
