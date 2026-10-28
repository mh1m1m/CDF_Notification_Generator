// Next.js configuration — CDF Case & Notification Intelligence Platform, V13 Enterprise.
// Classification: SYNTHETIC-DATA REFERENCE IMPLEMENTATION (not CDF production).
import type { NextConfig } from "next";

export interface SecurityHeaderOptions {
  /** `next dev`: React needs eval for its error overlay, and the dev server talks to the browser over ws:. */
  isDev: boolean;
  /** HTTPS-only deployment (Vercel build). Adds upgrade-insecure-requests, which would break plain-HTTP local runs. */
  httpsOnly: boolean;
}

/**
 * Content-Security-Policy for the App Router without nonces. The policy is static (set here, for every route,
 * including static assets), so the inline bootstrap scripts App Router streams into each page need
 * 'unsafe-inline' in script-src. 'unsafe-eval' is present only in development; production builds never get it.
 * A nonce-based policy set per request in proxy.ts would remove 'unsafe-inline' at the cost of forcing dynamic
 * rendering everywhere (see docs/DEPENDENCIES.md, "Decisions to review").
 */
export function contentSecurityPolicy({ isDev, httpsOnly }: SecurityHeaderOptions): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
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

/**
 * Security headers sent on every response.
 * PRODUCTION_SUBSTITUTION_REQUIRED: in production the CDF gateway (Alibaba Cloud WAF / SLB) terminates TLS and owns
 * HSTS (including any preload decision); these headers stay as defence in depth.
 */
export function securityHeaders(options: SecurityHeaderOptions): { key: string; value: string }[] {
  return [
    { key: "Content-Security-Policy", value: contentSecurityPolicy(options) },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Referrer-Policy", value: "no-referrer" },
    { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
    // Browsers ignore HSTS on plain-HTTP responses, so local runs over http://127.0.0.1 are unaffected.
    { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
    { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
    { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
  ];
}

const config: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  // The postgres driver stays a Node.js runtime dependency of the server bundle (lib/db only).
  serverExternalPackages: ["postgres"],
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders({
          isDev: process.env.NODE_ENV === "development",
          httpsOnly: process.env.VERCEL === "1",
        }),
      },
    ];
  },
};

export default config;
