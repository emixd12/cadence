import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";

export async function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  // Protocol clients must never depend on Cadence browser cookies.
  if (path.startsWith("/oauth/") && path !== "/oauth/consent") return NextResponse.next();
  const response = await updateSession(request);
  if (path === "/oauth/consent") {
    response.headers.set("Cache-Control", "no-store");
    response.headers.set("Referrer-Policy", "no-referrer");
    response.headers.set("X-Frame-Options", "DENY");
  }
  return response;
}

export const config = {
  matcher: [
    "/",
    "/login",
    "/timeline/:path*",
    "/behaviors/:path*",
    "/analytics/:path*",
    "/export/:path*",
    "/api/export/:path*",
    "/settings/:path*",
    "/oauth/:path*",
  ],
};
