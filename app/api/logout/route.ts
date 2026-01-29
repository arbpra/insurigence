import { NextRequest, NextResponse } from "next/server";
import * as client from "openid-client";
import { cookies } from "next/headers";
import { getOidcConfig } from "@/lib/replit-auth";
import prisma from "@/lib/prisma";

export async function GET(request: NextRequest) {
  try {
    const cookieStore = await cookies();
    const sessionToken = cookieStore.get("session_token")?.value;
    
    if (sessionToken) {
      await prisma.session.deleteMany({
        where: { token: sessionToken }
      });
    }
    
    cookieStore.delete("session_token");
    
    const config = await getOidcConfig();
    const host = request.headers.get("host") || request.nextUrl.host;
    const protocol = request.headers.get("x-forwarded-proto") || "https";
    
    const endSessionUrl = client.buildEndSessionUrl(config, {
      client_id: process.env.REPL_ID!,
      post_logout_redirect_uri: `${protocol}://${host}`,
    });
    
    return NextResponse.redirect(endSessionUrl.href);
  } catch (error) {
    console.error("Logout error:", error);
    const cookieStore = await cookies();
    cookieStore.delete("session_token");
    return NextResponse.redirect(new URL("/", request.url));
  }
}
