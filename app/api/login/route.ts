import { NextRequest, NextResponse } from "next/server";
import * as client from "openid-client";
import { getOidcConfig } from "@/lib/replit-auth";

export async function GET(request: NextRequest) {
  try {
    const config = await getOidcConfig();
    
    // Use Replit domain for callback (required for Replit Auth)
    const replitDomain = process.env.REPLIT_DOMAINS?.split(',')[0] || process.env.REPLIT_DEV_DOMAIN;
    if (!replitDomain) {
      console.error("No Replit domain configured");
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    
    const callbackUrl = `https://${replitDomain}/api/callback`;
    
    const authUrl = client.buildAuthorizationUrl(config, {
      redirect_uri: callbackUrl,
      scope: "openid email profile offline_access",
      prompt: "login consent",
    });
    
    return NextResponse.redirect(authUrl.href);
  } catch (error) {
    console.error("Login error:", error);
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
}
