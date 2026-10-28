// Security headers from next.config.ts: a strict static CSP (no 'unsafe-eval' outside `next dev`), framing denied,
// no referrer, HSTS, isolation headers, and no X-Powered-By.
import { describe, expect, it } from "vitest";
import config, { contentSecurityPolicy, securityHeaders } from "@/next.config";

const directives = (csp: string) =>
  new Map(
    csp.split("; ").map((d) => {
      const [name, ...values] = d.split(" ");
      return [name as string, values.join(" ")];
    }),
  );

describe("Content-Security-Policy", () => {
  it("production: self only, no eval, no plugins, no framing, forms and base URI pinned", () => {
    const csp = directives(contentSecurityPolicy({ isDev: false, httpsOnly: false }));
    expect(csp.get("default-src")).toBe("'self'");
    expect(csp.get("script-src")).toBe("'self' 'unsafe-inline'");
    expect(csp.get("connect-src")).toBe("'self'");
    expect(csp.get("object-src")).toBe("'none'");
    expect(csp.get("frame-src")).toBe("'none'");
    expect(csp.get("frame-ancestors")).toBe("'none'");
    expect(csp.get("base-uri")).toBe("'self'");
    expect(csp.get("form-action")).toBe("'self'");
    expect(csp.has("upgrade-insecure-requests")).toBe(false);
    expect(contentSecurityPolicy({ isDev: false, httpsOnly: true })).not.toContain("unsafe-eval");
  });

  it("adds upgrade-insecure-requests only for HTTPS-only deployments", () => {
    expect(
      directives(contentSecurityPolicy({ isDev: false, httpsOnly: true })).has("upgrade-insecure-requests"),
    ).toBe(true);
  });

  it("development only: 'unsafe-eval' for the React overlay and ws: for the dev server", () => {
    const csp = directives(contentSecurityPolicy({ isDev: true, httpsOnly: false }));
    expect(csp.get("script-src")).toBe("'self' 'unsafe-inline' 'unsafe-eval'");
    expect(csp.get("connect-src")).toBe("'self' ws:");
  });
});

describe("security headers", () => {
  it("sends the full set on every route and never X-Powered-By", async () => {
    const headers = new Map(securityHeaders({ isDev: false, httpsOnly: true }).map((h) => [h.key, h.value]));
    expect(headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(headers.get("X-Frame-Options")).toBe("DENY");
    expect(headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(headers.get("Strict-Transport-Security")).toBe("max-age=63072000; includeSubDomains");
    expect(headers.get("Cross-Origin-Opener-Policy")).toBe("same-origin");
    expect(headers.get("Cross-Origin-Resource-Policy")).toBe("same-origin");
    expect(headers.get("Permissions-Policy")).toContain("camera=()");
    expect(headers.get("Content-Security-Policy")).toContain("frame-ancestors 'none'");

    expect(config.poweredByHeader).toBe(false);
    const routes = await config.headers?.();
    expect(routes).toHaveLength(1);
    expect(routes?.[0]?.source).toBe("/:path*");
    // Vitest runs with NODE_ENV=test: the production policy, never 'unsafe-eval'.
    const csp = routes?.[0]?.headers.find((h) => h.key === "Content-Security-Policy")?.value;
    expect(csp).toBeDefined();
    expect(csp).not.toContain("unsafe-eval");
  });
});
