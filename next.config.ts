// Next.js configuration — CDF Case & Notification Intelligence Platform, V13 Enterprise.
// Classification: SYNTHETIC-DATA REFERENCE IMPLEMENTATION (not CDF production).
import type { NextConfig } from "next";
import { RESOURCE_CONTENT_SECURITY_POLICY, RESOURCE_PATHS } from "./lib/http/csp";

/**
 * Security headers sent on every response. Content-Security-Policy is not among them: proxy.ts sets a per-request
 * nonce policy on every page, and headers() below gives the paths proxy.ts never sees the resource policy, so each
 * response carries exactly one policy (lib/http/csp.ts).
 * PRODUCTION_SUBSTITUTION_REQUIRED: in production the CDF gateway (Alibaba Cloud WAF / SLB) terminates TLS and owns
 * HSTS (including any preload decision); these headers stay as defence in depth.
 *
 * Referrer-Policy is `same-origin` (V13-ARCH-013): no request to another origin carries a referrer, and a same-origin
 * form POST carries its real `Origin`. Under `no-referrer` a browser sends `Origin: null` on every POST that is not a
 * CORS-mode fetch (Fetch standard, "append a request `Origin` header"), so with JavaScript off each Server Action form
 * submission was refused by Next's origin check. That check is never widened: there is no
 * `experimental.serverActions.allowedOrigins`, and `null` is never an accepted origin.
 */
export function securityHeaders(): { key: string; value: string }[] {
  return [
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Referrer-Policy", value: "same-origin" },
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
  // CLAUDE.md is the repository's only agent-instructions file: next dev must not generate AGENTS.md
  // (docs/DEPENDENCIES.md decision 16).
  agentRules: false,
  // The postgres driver stays a Node.js runtime dependency of the server bundle (lib/db only).
  serverExternalPackages: ["postgres"],
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders() },
      ...RESOURCE_PATHS.map((source) => ({
        source,
        headers: [{ key: "Content-Security-Policy", value: RESOURCE_CONTENT_SECURITY_POLICY }],
      })),
    ];
  },
};

export default config;
