// proxy.ts: the first of the two session checks (which paths it gates, and what it does with valid, missing and
// invalid session cookies) and the per-request page CSP (threat TM-I13). Pages and layouts re-check the session on the
// server (app/(platform)/layout.tsx).
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { base64url } from "jose";
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSessionToken, SESSION_COOKIE_NAME } from "@/lib/auth/session";
import { config, isDecodablePath, proxy, PUBLIC_PAGES, UNDECODABLE_PATH_REWRITE } from "@/proxy";

const ORIGIN = "http://localhost:3100";
const secret = () => base64url.encode(crypto.getRandomValues(new Uint8Array(32)));
const SECRET = secret();
const signingEnv = { V13_SESSION_SECRET: SECRET, V13_PERSONA_SIGNIN: "enabled" };

const ALPHA = "0b000000-0000-4000-8000-000000000001";
const DELTA = "0b000000-0000-4000-8000-000000000004";

const token = (
  persona_id: string,
  active_workspace: string,
  options: { now?: Date; env?: typeof signingEnv } = {},
) =>
  createSessionToken({ persona_id, active_workspace }, { env: options.env ?? signingEnv, now: options.now });

const request = (path: string, cookie?: string, headers: Record<string, string> = {}) =>
  new NextRequest(new URL(path, ORIGIN), {
    headers: cookie === undefined ? headers : { ...headers, cookie: `${SESSION_COOKIE_NAME}=${cookie}` },
  });

const isPassThrough = (response: Response) => response.headers.get("x-middleware-next") === "1";

function expectSignInRedirect(response: Response, { cookieExpired }: { cookieExpired: boolean }) {
  expect(isPassThrough(response)).toBe(false);
  expect(response.status).toBe(307);
  expect(response.headers.get("location")).toBe(`${ORIGIN}/sign-in`);
  expect(response.headers.get("cache-control")).toBe("no-store");
  const setCookie = response.headers.get("set-cookie");
  if (!cookieExpired) {
    expect(setCookie).toBeNull();
    return;
  }
  expect(setCookie).toMatch(new RegExp(`^${SESSION_COOKIE_NAME.replace("-", "\\-")}=;`));
  expect(setCookie).toMatch(/Max-Age=0/i);
  expect(setCookie).toMatch(/Path=\//);
  expect(setCookie).toMatch(/Secure/);
  expect(setCookie).toMatch(/HttpOnly/);
}

/** One directive's value in a policy ("" when the directive is absent). */
const directive = (csp: string | null, name: string) =>
  (csp ?? "")
    .split("; ")
    .find((d) => d === name || d.startsWith(`${name} `))
    ?.slice(name.length + 1) ?? "";

/** The nonce in a page CSP; fails the test if the policy has none. */
function nonceOf(csp: string | null): string {
  const nonce = /'nonce-([A-Za-z0-9+/]{22}==)'/.exec(csp ?? "")?.[1];
  expect(nonce, `no nonce in ${csp}`).toBeDefined();
  return nonce!;
}

beforeEach(() => {
  vi.stubEnv("V13_SESSION_SECRET", SECRET);
  vi.stubEnv("V13_PERSONA_SIGNIN", "enabled");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("proxy: session gate", () => {
  it("passes a request with a valid session", async () => {
    expect(isPassThrough(await proxy(request("/my-work", await token(ALPHA, "SECRETARIAT"))))).toBe(true);
    // Delta's second membership workspace is valid too.
    expect(isPassThrough(await proxy(request("/my-work", await token(DELTA, "SECRETARIAT"))))).toBe(true);
  });

  it("redirects a request without a session to /sign-in and drops the query string", async () => {
    expectSignInRedirect(await proxy(request("/my-work?next=https://attacker.example.test/")), {
      cookieExpired: false,
    });
    expectSignInRedirect(await proxy(request("/")), { cookieExpired: false });
  });

  it("redirects and removes a tampered, foreign, expired or empty cookie", async () => {
    const valid = await token(ALPHA, "SECRETARIAT");
    const [header, payload, signature] = valid.split(".") as [string, string, string];
    const forged = base64url.encode(
      JSON.stringify({
        ...JSON.parse(new TextDecoder().decode(base64url.decode(payload))),
        persona_id: DELTA,
      }),
    );
    const invalid = [
      `${header}.${forged}.${signature}`,
      `${header}.${payload}.${signature.startsWith("A") ? "B" : "A"}${signature.slice(1)}`,
      await token(ALPHA, "SECRETARIAT", { env: { ...signingEnv, V13_SESSION_SECRET: secret() } }),
      await token(ALPHA, "SECRETARIAT", { now: new Date(Date.now() - 9 * 60 * 60 * 1000) }),
      "not-a-jwt",
      "",
    ];
    for (const cookie of invalid) {
      expectSignInRedirect(await proxy(request("/my-work", cookie)), { cookieExpired: true });
    }
  });

  it("refuses a valid signature for a persona or workspace the registry does not grant", async () => {
    const unknownPersona = "0b000000-0000-4000-8000-0000000000ff";
    for (const cookie of [
      await token(unknownPersona, "SECRETARIAT"),
      await token(ALPHA, "INVESTIGATIONS"),
      await token(DELTA, "INVESTIGATIONS"),
    ]) {
      expectSignInRedirect(await proxy(request("/my-work", cookie)), { cookieExpired: true });
    }
  });

  it("refuses every session while persona sign-in is not exactly 'enabled'", async () => {
    const cookie = await token(ALPHA, "SECRETARIAT");
    for (const flag of ["", "true", "ENABLED", "enabled "]) {
      vi.stubEnv("V13_PERSONA_SIGNIN", flag);
      expectSignInRedirect(await proxy(request("/my-work", cookie)), { cookieExpired: true });
    }
  });
});

describe("proxy: public pages", () => {
  it("has exactly one public page", () => {
    expect([...PUBLIC_PAGES]).toEqual(["/sign-in"]);
  });

  it("passes /sign-in without a session, with or without a query string, and sets no cookie", async () => {
    for (const path of ["/sign-in", "/sign-in?locale=en"]) {
      const response = await proxy(request(path));
      expect(isPassThrough(response), path).toBe(true);
      expect(response.headers.get("set-cookie"), path).toBeNull();
    }
  });

  it("gates look-alikes of /sign-in", async () => {
    for (const path of ["/sign-in/", "/sign-in/x", "/sign-in-x", "/sign-inx", "/SIGN-IN", "/x/sign-in"]) {
      expectSignInRedirect(await proxy(request(path)), { cookieExpired: false });
    }
  });
});

describe("proxy: page Content-Security-Policy (TM-I13)", () => {
  it("puts a nonce policy on every response it sends: pass-through, public page and both redirects", async () => {
    const responses = [
      await proxy(request("/my-work", await token(ALPHA, "SECRETARIAT"))),
      await proxy(request("/sign-in")),
      await proxy(request("/my-work")),
      await proxy(request("/my-work", "not-a-jwt")),
    ];
    for (const response of responses) {
      const csp = response.headers.get("content-security-policy");
      const nonce = nonceOf(csp);
      expect(directive(csp, "script-src")).toBe(`'self' 'nonce-${nonce}' 'strict-dynamic'`);
      expect(directive(csp, "frame-ancestors")).toBe("'none'");
      expect(directive(csp, "object-src")).toBe("'none'");
    }
  });

  it("forwards the same policy to Next.js on the request, overriding any policy the client sent", async () => {
    for (const response of [
      await proxy(
        request("/my-work", await token(ALPHA, "SECRETARIAT"), {
          "content-security-policy": "script-src 'nonce-AAAAAAAAAAAAAAAAAAAAAA=='",
        }),
      ),
      await proxy(request("/sign-in", undefined, { "content-security-policy": "script-src *" })),
    ]) {
      const csp = response.headers.get("content-security-policy");
      expect(response.headers.get("x-middleware-request-content-security-policy")).toBe(csp);
      expect(response.headers.get("x-middleware-override-headers")?.split(",")).toContain(
        "content-security-policy",
      );
      expect(nonceOf(csp)).not.toBe("AAAAAAAAAAAAAAAAAAAAAA==");
    }
  });

  it("uses a fresh nonce for every request", async () => {
    const cookie = await token(ALPHA, "SECRETARIAT");
    const nonces = new Set<string>();
    for (let i = 0; i < 20; i += 1) {
      nonces.add(nonceOf((await proxy(request("/my-work", cookie))).headers.get("content-security-policy")));
      nonces.add(nonceOf((await proxy(request("/my-work"))).headers.get("content-security-policy")));
    }
    expect(nonces.size).toBe(40);
  });

  it("allows eval only under next dev, and upgrades insecure requests only on Vercel", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const dev = (await proxy(request("/sign-in"))).headers.get("content-security-policy");
    expect(dev).toContain("'unsafe-eval'");
    expect(dev).not.toContain("upgrade-insecure-requests");

    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL", "1");
    const vercel = (await proxy(request("/sign-in"))).headers.get("content-security-policy");
    expect(vercel).not.toContain("unsafe-eval");
    expect(vercel).toContain("upgrade-insecure-requests");
  });
});

describe("proxy: undecodable paths (SEC-F-006-1)", () => {
  // Percent-escapes that are not valid UTF-8 (overlong, lone continuation, truncated), in a case id, on a tab, on other
  // pages and on the public page's path.
  const UNDECODABLE = [
    "/cases/%C0%AF",
    "/cases/%FF",
    "/cases/%E0%A4%A",
    "/cases/%C0%AF/events",
    "/cases/0c000000-0000-4000-8000-000000000001%FF/tasks",
    "/my-work/%FF",
    "/%FF",
    "/sign-in%FF",
  ];

  it("redirects an undecodable path without a valid session to /sign-in, like any gated path", async () => {
    for (const path of UNDECODABLE) {
      for (const [cookie, cookieExpired] of [
        [undefined, false],
        ["not-a-jwt", true],
      ] as const) {
        const response = await proxy(request(path, cookie));
        expect(response.headers.get("x-middleware-rewrite"), path).toBeNull();
        expectSignInRedirect(response, { cookieExpired });
      }
    }
  });

  it("sends a signed-in request for an undecodable path to the generic not-found page", async () => {
    const valid = await token(ALPHA, "SECRETARIAT");
    for (const path of UNDECODABLE) {
      const response = await proxy(request(`${path}?tab=1`, valid));
      expect(isPassThrough(response), path).toBe(false);
      expect(response.headers.get("x-middleware-rewrite"), path).toBe(`${ORIGIN}${UNDECODABLE_PATH_REWRITE}`);
      expect(response.headers.get("location"), path).toBeNull();
      expect(response.headers.get("set-cookie"), path).toBeNull();
      expect(response.headers.get("cache-control"), path).toBe("no-store");
      const csp = response.headers.get("content-security-policy");
      nonceOf(csp);
      expect(response.headers.get("x-middleware-request-content-security-policy"), path).toBe(csp);
    }
  });

  it("passes decodable paths through unchanged: encoded characters, an encoded slash and a bad query string", async () => {
    const valid = await token(ALPHA, "SECRETARIAT");
    for (const path of ["/cases/%41", "/cases/a%2Fb", "/cases/%F0%9F%92%A5", "/my-work?q=%FF"]) {
      const passed = await proxy(request(path, valid));
      expect(isPassThrough(passed), path).toBe(true);
      expect(passed.headers.get("x-middleware-rewrite"), path).toBeNull();
      expectSignInRedirect(await proxy(request(path)), { cookieExpired: false });
    }
  });

  it("decides decodability exactly as decodeURIComponent does", () => {
    for (const path of ["/", "/cases/%20", "/cases/%F0%9F%92%A5", "/a%2Fb", "/%25"]) {
      expect(isDecodablePath(path), path).toBe(true);
    }
    for (const path of ["/%C0%AF", "/%FF", "/%E0%A4%A", "/%", "/%G0", "/%ED%A0%80"]) {
      expect(isDecodablePath(path), path).toBe(false);
    }
  });

  it("rewrites to a path no route can serve: private (leading underscore), and no dynamic segment at the root", () => {
    expect(UNDECODABLE_PATH_REWRITE.startsWith("/_")).toBe(true);
    expect(isDecodablePath(UNDECODABLE_PATH_REWRITE)).toBe(true);
    // A dynamic folder directly under app/ or under a route group at the root would match /_v13; there must be none.
    const roots = readdirSync("app", { withFileTypes: true }).filter((e) => e.isDirectory());
    const groups = roots.filter((e) => /^\(.+\)$/.test(e.name));
    const rootSegments = [
      ...roots.map((e) => e.name),
      ...groups.flatMap((g) =>
        readdirSync(join("app", g.name), { withFileTypes: true })
          .filter((e) => e.isDirectory())
          .map((e) => e.name),
      ),
    ];
    expect(
      rootSegments.filter((name) => name.startsWith("[")),
      "dynamic segments at the app root",
    ).toEqual([]);
  });
});

describe("proxy: matcher", () => {
  const matches = (url: string) => unstable_doesMiddlewareMatch({ config, url });

  it("leaves exactly the resource paths alone (next.config.ts gives them the resource CSP)", () => {
    for (const url of [
      "/api/health",
      "/api/health/isolation",
      "/favicon.ico",
      "/robots.txt",
      "/_next/image?url=%2Fx.png&w=64&q=75",
      "/_next/static/chunks/app.js",
    ]) {
      expect(matches(url), url).toBe(false);
    }
  });

  it("runs on every other path, the sign-in page and look-alikes of the resource paths included", () => {
    for (const url of [
      "/",
      "/sign-in",
      "/sign-in/x",
      "/my-work",
      "/cases/0c000000-0000-4000-8000-000000000001",
      "/sign-in-other",
      "/sign-inx",
      "/api/healthz",
      "/api/health/other",
      "/api/health/isolation/x",
      "/favicon.icon",
      "/robots.txt.bak",
      "/_next/imagex",
      "/my-work?next=/sign-in",
    ]) {
      expect(matches(url), url).toBe(true);
    }
  });
});
