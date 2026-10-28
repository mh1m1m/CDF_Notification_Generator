// Content-Security-Policy (threat TM-I13). Edge-safe: no Node.js built-ins, so proxy.ts and next.config.ts can both
// import it.
//
// HTML pages get a policy with a fresh script nonce per request, set by proxy.ts. Next.js reads the nonce from the
// forwarded request's Content-Security-Policy header and puts it on its own inline and chunk scripts; 'strict-dynamic'
// lets those scripts load the rest of the app. No inline script without the nonce runs, so script-src never needs
// 'unsafe-inline'. Every page is rendered per request anyway (the root layout reads the locale cookie), so the nonce
// costs no static rendering.
//
// Everything proxy.ts does not see (the health API, static files, images) gets RESOURCE_CONTENT_SECURITY_POLICY from
// next.config.ts: nothing may load or run in such a response if a browser opens it as a document.

export interface CspOptions {
  /** `next dev`: React needs eval for its error overlay, and the dev server talks to the browser over ws:. */
  isDev: boolean;
  /** HTTPS-only deployment (Vercel build). Adds upgrade-insecure-requests, which would break plain-HTTP local runs. */
  httpsOnly: boolean;
}

const NONCE_PATTERN = /^[A-Za-z0-9+/]{22}==$/;

/** A fresh nonce: 16 random bytes in base64 (24 characters). */
export function createNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes));
}

/** The policy for an HTML page rendered with this nonce. Throws on anything but a nonce from createNonce(). */
export function pageContentSecurityPolicy(nonce: string, { isDev, httpsOnly }: CspOptions): string {
  if (!NONCE_PATTERN.test(nonce)) throw new Error("invalid CSP nonce");
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    // Inline style attributes stay allowed: they cannot run code, and components use them for logical CSS values.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    `connect-src 'self'${isDev ? " ws:" : ""}`,
    "object-src 'none'",
    "frame-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    httpsOnly ? "upgrade-insecure-requests" : "",
  ]
    .filter(Boolean)
    .join("; ");
}

/** The policy for every response that is not an HTML page: nothing may load, run, frame it or submit from it. */
export const RESOURCE_CONTENT_SECURITY_POLICY =
  "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

/**
 * Paths proxy.ts never sees (its matcher excludes exactly these). next.config.ts gives them the resource policy, so
 * every response carries exactly one Content-Security-Policy. path-to-regexp syntax.
 */
export const RESOURCE_PATHS = [
  "/api/health",
  "/api/health/isolation",
  "/favicon.ico",
  "/robots.txt",
  "/_next/image",
  "/_next/static/:path*",
] as const;
