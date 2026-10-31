// Security headers (threat TM-I13): the per-request page CSP from lib/http/csp.ts (nonce + 'strict-dynamic', never
// 'unsafe-inline' or 'unsafe-eval' in production script-src), the resource CSP for paths proxy.ts never sees, and the
// headers next.config.ts sends on every response. proxy.spec.ts checks that proxy.ts puts the page policy on pages.
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { describe, expect, it } from "vitest";
import config, { securityHeaders } from "@/next.config";
import {
  createNonce,
  pageContentSecurityPolicy,
  RESOURCE_CONTENT_SECURITY_POLICY,
  RESOURCE_PATHS,
} from "@/lib/http/csp";
import { config as proxyConfig } from "@/proxy";

const directives = (csp: string) =>
  new Map(
    csp.split("; ").map((d) => {
      const [name, ...values] = d.split(" ");
      return [name as string, values.join(" ")];
    }),
  );

describe("page Content-Security-Policy", () => {
  it("production: scripts only with this request's nonce, no inline or eval, no plugins, no framing", () => {
    const nonce = createNonce();
    const csp = directives(pageContentSecurityPolicy(nonce, { isDev: false, httpsOnly: false }));
    expect(csp.get("default-src")).toBe("'self'");
    expect(csp.get("script-src")).toBe(`'self' 'nonce-${nonce}' 'strict-dynamic'`);
    expect(csp.get("script-src")).not.toContain("unsafe-inline");
    expect(csp.get("connect-src")).toBe("'self'");
    expect(csp.get("object-src")).toBe("'none'");
    expect(csp.get("frame-src")).toBe("'none'");
    expect(csp.get("frame-ancestors")).toBe("'none'");
    expect(csp.get("base-uri")).toBe("'self'");
    expect(csp.get("form-action")).toBe("'self'");
    expect(csp.has("upgrade-insecure-requests")).toBe(false);
    expect(pageContentSecurityPolicy(nonce, { isDev: false, httpsOnly: true })).not.toContain("unsafe-eval");
  });

  it("adds upgrade-insecure-requests only for HTTPS-only deployments", () => {
    const csp = pageContentSecurityPolicy(createNonce(), { isDev: false, httpsOnly: true });
    expect(directives(csp).has("upgrade-insecure-requests")).toBe(true);
  });

  it("development only: 'unsafe-eval' for the React overlay and ws: for the dev server", () => {
    const nonce = createNonce();
    const csp = directives(pageContentSecurityPolicy(nonce, { isDev: true, httpsOnly: false }));
    expect(csp.get("script-src")).toBe(`'self' 'nonce-${nonce}' 'strict-dynamic' 'unsafe-eval'`);
    expect(csp.get("connect-src")).toBe("'self' ws:");
  });

  it("uses a fresh 16-byte nonce each time and refuses anything that could break out of the directive", () => {
    const nonces = new Set(Array.from({ length: 200 }, () => createNonce()));
    expect(nonces.size).toBe(200);
    for (const nonce of nonces) expect(nonce).toMatch(/^[A-Za-z0-9+/]{22}==$/);
    for (const bad of ["", "abc", "x'; script-src *", `${createNonce()} 'unsafe-inline'`]) {
      expect(() => pageContentSecurityPolicy(bad, { isDev: false, httpsOnly: false })).toThrow();
    }
  });
});

describe("resource Content-Security-Policy", () => {
  it("lets nothing load, run, frame or submit", () => {
    const csp = directives(RESOURCE_CONTENT_SECURITY_POLICY);
    expect(csp.get("default-src")).toBe("'none'");
    expect(csp.get("frame-ancestors")).toBe("'none'");
    expect(csp.get("base-uri")).toBe("'none'");
    expect(csp.get("form-action")).toBe("'none'");
  });

  it("covers exactly the paths proxy.ts never sees, so every response has one policy", () => {
    const samples: Record<(typeof RESOURCE_PATHS)[number], string> = {
      "/api/health": "/api/health",
      "/api/health/isolation": "/api/health/isolation",
      "/favicon.ico": "/favicon.ico",
      "/robots.txt": "/robots.txt",
      "/_next/image": "/_next/image?url=%2Fx.png&w=64&q=75",
      "/_next/static/:path*": "/_next/static/chunks/app.js",
    };
    for (const path of RESOURCE_PATHS) {
      expect(unstable_doesMiddlewareMatch({ config: proxyConfig, url: samples[path] }), path).toBe(false);
    }
  });
});

describe("next.config.ts headers", () => {
  it("sends the full set on every route, never X-Powered-By, and no page CSP of its own", async () => {
    const headers = new Map(securityHeaders().map((h) => [h.key, h.value]));
    expect(headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(headers.get("X-Frame-Options")).toBe("DENY");
    expect(headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(headers.get("Strict-Transport-Security")).toBe("max-age=63072000; includeSubDomains");
    expect(headers.get("Cross-Origin-Opener-Policy")).toBe("same-origin");
    expect(headers.get("Cross-Origin-Resource-Policy")).toBe("same-origin");
    expect(headers.get("Permissions-Policy")).toContain("camera=()");
    expect(headers.has("Content-Security-Policy")).toBe(false);
    expect(config.poweredByHeader).toBe(false);

    const routes = (await config.headers?.()) ?? [];
    expect(routes[0]?.source).toBe("/:path*");
    expect(routes[0]?.headers).toEqual(securityHeaders());
    const cspRoutes = routes.slice(1);
    expect(cspRoutes.map((r) => r.source)).toEqual([...RESOURCE_PATHS]);
    for (const route of cspRoutes) {
      expect(route.headers).toEqual([
        { key: "Content-Security-Policy", value: RESOURCE_CONTENT_SECURITY_POLICY },
      ]);
    }
  });
});

describe("next.config.ts agent rules", () => {
  it("keeps next dev from generating AGENTS.md (docs/DEPENDENCIES.md decision 16)", () => {
    expect(config.agentRules).toBe(false);
  });
});
