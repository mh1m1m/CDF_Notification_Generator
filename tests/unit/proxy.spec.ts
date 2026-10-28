// proxy.ts, the first of the two session checks: which paths it gates, and what it does with valid, missing and
// invalid session cookies. Pages and layouts re-check the session on the server (app/(platform)/layout.tsx).
import { base64url } from "jose";
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSessionToken, SESSION_COOKIE_NAME } from "@/lib/auth/session";
import { config, proxy } from "@/proxy";

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

const request = (path: string, cookie?: string) =>
  new NextRequest(new URL(path, ORIGIN), {
    headers: cookie === undefined ? {} : { cookie: `${SESSION_COOKIE_NAME}=${cookie}` },
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

describe("proxy: matcher", () => {
  const matches = (url: string) => unstable_doesMiddlewareMatch({ config, url });

  it("leaves exactly the public paths alone", () => {
    for (const url of [
      "/sign-in",
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

  it("gates every other path, including look-alikes of the public ones", () => {
    for (const url of [
      "/",
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
