// Request gate (Next.js 16 proxy, Node.js runtime). It runs for every page request; the health API and static files
// are excluded by the matcher below. Three jobs:
//
// 1. Page CSP (threat TM-I13): a fresh script nonce per request. The policy goes on the response and on the forwarded
//    request headers, where Next.js reads the nonce for its own scripts (lib/http/csp.ts).
// 2. Session gate: every page except /sign-in requires a valid persona session. Edge-safe: verifies the signed cookie
//    with jose only (no database, no Node.js built-ins). Pages and layouts check the session again on the server;
//    this is the first of two checks.
// 3. Undecodable paths (SEC-F-006-1), after the gate: a path whose percent-escapes are not valid UTF-8 names nothing,
//    but Next.js answers a bare 500 for one in a dynamic segment (/cases/%C0%AF), even after a rewrite to another
//    dynamic path, because it decodes the parameters from the URL as sent. So the proxy rewrites a signed-in request
//    for any such path to a path no route serves, and Next.js renders the generic not-found page (404), exactly what an
//    unknown page gets. Without a session the gate has already redirected it to /sign-in, as for every page.
import { NextResponse, type NextRequest } from "next/server";
import {
  expireSessionCookie,
  SESSION_COOKIE_NAME,
  sessionFromClaims,
  verifySessionToken,
} from "@/lib/auth/session";
import { createNonce, pageContentSecurityPolicy } from "@/lib/http/csp";

/** Pages that need no session. Exact paths: look-alikes (/sign-in-x, /sign-in/x) are gated. */
export const PUBLIC_PAGES: ReadonlySet<string> = new Set(["/sign-in"]);

/**
 * Where a signed-in request for an undecodable path is rewritten. No route matches it: a leading underscore marks a
 * private folder in the App Router, and the app has no dynamic segment at its root. So Next.js renders
 * app/not-found.tsx with status 404, the page any unknown page gets.
 */
export const UNDECODABLE_PATH_REWRITE = "/_v13/not-found";

/** True when every percent-escape in the path decodes as UTF-8 (what Next.js needs to read a route parameter). */
export function isDecodablePath(pathname: string): boolean {
  try {
    decodeURIComponent(pathname);
    return true;
  } catch {
    return false;
  }
}

const CSP_HEADER = "content-security-policy";

export async function proxy(request: NextRequest): Promise<NextResponse> {
  const csp = pageContentSecurityPolicy(createNonce(), {
    isDev: process.env.NODE_ENV === "development",
    httpsOnly: process.env.VERCEL === "1",
  });

  if (!PUBLIC_PAGES.has(request.nextUrl.pathname)) {
    const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
    const claims = await verifySessionToken(token);
    if (!claims || !sessionFromClaims(claims)) {
      // A fresh URL, not a clone of nextUrl: no query string and no trailing slash carried over from the request.
      const response = NextResponse.redirect(new URL("/sign-in", request.url));
      // A present but invalid cookie (tampered, expired, other secret, unknown persona) is removed.
      if (token !== undefined) expireSessionCookie(response.cookies);
      response.headers.set("cache-control", "no-store");
      response.headers.set(CSP_HEADER, csp);
      return response;
    }
  }

  const forwarded = new Headers(request.headers);
  forwarded.set(CSP_HEADER, csp);
  if (!isDecodablePath(request.nextUrl.pathname)) {
    const response = NextResponse.rewrite(new URL(UNDECODABLE_PATH_REWRITE, request.url), {
      request: { headers: forwarded },
    });
    response.headers.set("cache-control", "no-store");
    response.headers.set(CSP_HEADER, csp);
    return response;
  }
  const response = NextResponse.next({ request: { headers: forwarded } });
  response.headers.set(CSP_HEADER, csp);
  return response;
}

// Everything except exactly these paths, which next.config.ts covers with the resource CSP (RESOURCE_PATHS in
// lib/http/csp.ts): /api/health, /api/health/isolation, /favicon.ico, /robots.txt, /_next/image, and anything under
// /_next/static/. The exclusions are anchored, so look-alike paths (/api/healthz, /api/health/other) still go through
// the gate. path-to-regexp syntax; tests/unit/proxy.spec.ts pins the behaviour.
export const config = {
  matcher: [
    "/((?!(?:api/health|api/health/isolation|favicon\\.ico|robots\\.txt|_next/image)$|_next/static/).*)",
  ],
};
