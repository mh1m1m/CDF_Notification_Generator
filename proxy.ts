// Request gate (Next.js 16 proxy, Node.js runtime): every route except the sign-in page, the health endpoints and
// static assets requires a valid persona session. Edge-safe: verifies the signed cookie with jose only (no database,
// no Node.js built-ins). Pages and layouts check the session again on the server; this is the first of two checks.
import { NextResponse, type NextRequest } from "next/server";
import {
  expireSessionCookie,
  SESSION_COOKIE_NAME,
  sessionFromClaims,
  verifySessionToken,
} from "@/lib/auth/session";

export async function proxy(request: NextRequest): Promise<NextResponse> {
  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const claims = await verifySessionToken(token);
  if (claims && sessionFromClaims(claims)) return NextResponse.next();

  const signIn = request.nextUrl.clone();
  signIn.pathname = "/sign-in";
  signIn.search = "";
  const response = NextResponse.redirect(signIn);
  // A present but invalid cookie (tampered, expired, other secret, unknown persona) is removed.
  if (token !== undefined) expireSessionCookie(response.cookies);
  response.headers.set("cache-control", "no-store");
  return response;
}

// Everything except exactly these public paths: /sign-in, /api/health, /api/health/isolation, /favicon.ico,
// /robots.txt, /_next/image, and anything under /_next/static/. The exclusions are anchored, so look-alike paths
// (/sign-in-x, /api/healthz, /api/health/other) still need a session. path-to-regexp syntax;
// tests/unit/proxy.spec.ts pins the behaviour.
export const config = {
  matcher: [
    "/((?!(?:sign-in|api/health|api/health/isolation|favicon\\.ico|robots\\.txt|_next/image)$|_next/static/).*)",
  ],
};
