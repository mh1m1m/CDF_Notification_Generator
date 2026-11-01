// V13-SEC-003 · SEC-APP-08, SEC-APP-10, SEC-APP-13, SEC-APP-14, SEC-APP-15 · threats TM-I8, TM-I10, TM-I11, TM-I13.
// The browser-facing surface of a production build:
//  - every route, public or gated, signed in or not, carries the security headers exactly once and one CSP;
//  - authenticated pages are never cacheable;
//  - errors and odd input give generic answers (no stack, path, SQL or code);
//  - no secret name, connection string, role or claims setting reaches the client bundle or the HTML;
//  - nothing about the session or the persona is kept in browser storage.
// SYNTHETIC DATA ONLY.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type APIResponse, type Page } from "@playwright/test";
import { DEFAULT_LOCAL_APP_PASSWORD } from "../../../scripts/db/reset-local.mjs";

const SESSION_COOKIE = "__Host-v13_session";
const LOCAL_BUILD = !process.env.V13_E2E_BASE_URL?.trim();

const REQUIRED_HEADERS: Record<string, string> = {
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "no-referrer",
  "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  "strict-transport-security": "max-age=63072000; includeSubDomains",
  "cross-origin-opener-policy": "same-origin",
  "cross-origin-resource-policy": "same-origin",
};

/** Text that must never reach a browser: secret and variable names, connection strings, roles, claims plumbing. */
const FORBIDDEN_IN_CLIENT = [
  "V13_SESSION_SECRET",
  "V13_DATABASE_URL",
  "V13_ADMIN_DATABASE_URL",
  "V13_LOCAL_APP_PASSWORD",
  "SUPABASE_SERVICE_ROLE",
  "postgres://",
  "postgresql://",
  "cdf_v13_app",
  "cdf_v13_owner",
  "cdf_v13_user",
  "cdf_notifications_v13",
  "request.v13.claims",
  "claims_mac",
  "cdf-v13/request-claims",
  "set_config",
  "SET LOCAL ROLE",
];

/**
 * This local run's own secret values (V13-ARCH-008: the started app holds a real database URL): the session secret
 * playwright.config.ts generated or was given, and the app login's password. Failure messages name the label only,
 * never the value. Empty against an external deployment, whose values this runner does not know.
 */
function localSecretValues(): ReadonlyArray<readonly [label: string, value: string]> {
  if (!LOCAL_BUILD) return [];
  const out: Array<readonly [string, string]> = [];
  const secret = process.env.V13_E2E_SESSION_SECRET?.trim();
  if (secret && secret.length >= 16) out.push(["the session secret value", secret]);
  let password = process.env.V13_LOCAL_APP_PASSWORD || DEFAULT_LOCAL_APP_PASSWORD;
  const url = process.env.V13_E2E_DATABASE_URL?.trim();
  if (url) {
    try {
      password = decodeURIComponent(new URL(url).password) || password;
    } catch {
      // playwright.config.ts refuses an unparsable URL before any test runs
    }
  }
  if (password.length >= 8) out.push(["the app database password", password]);
  return out;
}
const SECRET_VALUES = localSecretValues();

const STACK_OR_INTERNALS =
  /\bat\s+[\w.<>]+\s+\(|\.next\/server|node_modules|SQLSTATE|syntax error at|relation "|ECONNREFUSED/i;

function headerValues(response: APIResponse, name: string) {
  return response
    .headersArray()
    .filter((h) => h.name.toLowerCase() === name)
    .map((h) => h.value);
}

function expectSecurityHeaders(response: APIResponse, label: string) {
  for (const [name, value] of Object.entries(REQUIRED_HEADERS)) {
    expect(headerValues(response, name), `${label}: ${name}`).toEqual([value]);
  }
  expect(headerValues(response, "content-security-policy"), `${label}: one CSP`).toHaveLength(1);
  expect(headerValues(response, "x-powered-by"), `${label}: x-powered-by`).toEqual([]);
  expect(headerValues(response, "server").join(""), `${label}: server`).not.toMatch(/next|node|vercel\s*\d/i);
}

async function signInAsAlpha(page: Page) {
  await page.goto("/sign-in");
  await page.getByTestId("persona-secretary-alpha").click();
  await expect(page).toHaveURL(/\/my-work$/);
}

async function sessionCookieHeader(page: Page) {
  const cookie = (await page.context().cookies()).find((c) => c.name === SESSION_COOKIE);
  expect(cookie).toBeDefined();
  return `${SESSION_COOKIE}=${cookie!.value}`;
}

const ROUTES = [
  "/",
  "/sign-in",
  "/my-work",
  "/sign-in/x",
  "/sign-in-x",
  "/does-not-exist",
  "/api/health",
  "/api/healthz",
  // SEC-007: the Notification Operations Center, a hidden case (0009 for Alpha) and an undecodable path, which the
  // proxy rewrites to the not-found page for a session (#59): the headers must still be set exactly once.
  "/notifications",
  "/cases/0c000000-0000-4000-8000-000000000009",
  "/cases/%C0%AF",
  "/cases/%C0%AF/events",
];

test.describe("SEC-APP-08 / SEC-APP-14 security headers and caching (TM-I13, TM-I11)", () => {
  test("every route without a session: all security headers once, one CSP, no framework banner", async ({
    request,
  }) => {
    for (const path of ROUTES) {
      const response = await request.get(path, { maxRedirects: 0, failOnStatusCode: false });
      expectSecurityHeaders(response, `anon ${path}`);
    }
  });

  test("every route with a session: the same headers, and authenticated pages are never cacheable", async ({
    page,
    request,
  }) => {
    await signInAsAlpha(page);
    const cookie = await sessionCookieHeader(page);
    for (const path of ROUTES) {
      const response = await request.get(path, {
        headers: { cookie },
        maxRedirects: 0,
        failOnStatusCode: false,
      });
      expectSecurityHeaders(response, `session ${path}`);
      if (!path.startsWith("/api/health") || path === "/api/healthz") {
        expect(response.headers()["cache-control"] ?? "", `session ${path}: cache-control`).toMatch(
          /no-store/,
        );
      }
    }
  });

  test("the session cookie is host-only, HttpOnly, Secure, SameSite=Lax and at most 8 hours", async ({
    page,
  }) => {
    const [response] = await Promise.all([
      page.waitForResponse((r) => r.request().method() === "POST" && r.url().endsWith("/sign-in")),
      (async () => {
        await page.goto("/sign-in");
        await page.getByTestId("persona-secretary-alpha").click();
      })(),
    ]);
    const header = (await response.headersArray()).find(
      (h) => h.name.toLowerCase() === "set-cookie" && h.value.startsWith(`${SESSION_COOKIE}=`),
    );
    expect(header).toBeDefined();
    const attrs = header!.value.split(";").map((a) => a.trim().toLowerCase());
    expect(attrs).toContain("httponly");
    expect(attrs).toContain("secure");
    expect(attrs).toContain("path=/");
    expect(attrs).toContain("samesite=lax");
    expect(attrs.some((a) => a.startsWith("domain="))).toBe(false);
    const maxAge = Number(attrs.find((a) => a.startsWith("max-age="))?.slice(8));
    expect(maxAge).toBeGreaterThan(0);
    expect(maxAge).toBeLessThanOrEqual(8 * 60 * 60);
  });
});

test.describe("SEC-APP-10 generic errors (TM-I10)", () => {
  test("an unknown page, signed in, is a plain not-found page", async ({ page }) => {
    await signInAsAlpha(page);
    const response = await page.goto("/does-not-exist");
    expect(response?.status()).toBe(404);
    expect(await response!.text()).not.toMatch(STACK_OR_INTERNALS);
  });

  test("odd cookies are refused at the gate with a redirect, never a server error", async ({ request }) => {
    for (const value of ["", "a".repeat(4000), "e30.e30.", "...", "%00%ff", "eyé.ey.sig", "null", "[]"]) {
      const response = await request.get("/my-work", {
        headers: { cookie: `${SESSION_COOKIE}=${encodeURIComponent(value)}` },
        maxRedirects: 0,
        failOnStatusCode: false,
      });
      expect(response.status(), JSON.stringify(value.slice(0, 20))).toBe(307);
      expect(response.headers().location).toBe("/sign-in");
    }
  });

  test("odd URLs never produce a server error or internals", async ({ request }) => {
    for (const path of [
      "/my-work/..%2f..%2fapi/health",
      "/%2e%2e/%2e%2e/etc/passwd",
      "/sign-in?ref=<script>alert(1)</script>",
      "/sign-in?ref=00000000-0000-4000-8000-000000000000%22%3E%3Cscript%3E",
      `/sign-in?${"a=1&".repeat(500)}`,
      "/_next/static/../../server/app/page.js",
      "/.env",
      "/.git/config",
    ]) {
      const response = await request.get(path, { maxRedirects: 0, failOnStatusCode: false });
      expect(response.status(), path).toBeLessThan(500);
      const body = await response.text();
      expect(body, path).not.toMatch(STACK_OR_INTERNALS);
      expect(body, path).not.toContain("<script>alert(1)</script>");
      expect(body, path).not.toMatch(/V13_[A-Z_]+=/);
    }
  });

  test("the sign-in error reference accepts only a UUID and shows nothing else", async ({ page }) => {
    await page.goto("/sign-in?ref=not-a-uuid");
    await expect(page.getByTestId("sign-in-error")).toHaveCount(0);
    const ref = "00000000-0000-4000-8000-0000000000aa";
    await page.goto(`/sign-in?ref=${ref}`);
    await expect(page.getByTestId("sign-in-error")).toContainText(ref);
    await expect(page.getByTestId("sign-in-error")).not.toContainText(/UNKNOWN|PERSONA_|Error/);
  });

  test("the health body holds only the documented fields, with no error text", async ({ request }) => {
    const response = await request.get("/api/health", { failOnStatusCode: false });
    const text = await response.text();
    for (const [label, value] of SECRET_VALUES) expect(text.includes(value), label).toBe(false);
    const body = JSON.parse(text) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(["app", "commit", "correlation_id", "db", "status"]);
    expect(JSON.stringify(body)).not.toMatch(STACK_OR_INTERNALS);
    expect(JSON.stringify(body)).not.toMatch(/password|postgres:|@[a-z0-9.-]+:\d+/i);
  });
});

test.describe("SEC-APP-13 nothing secret reaches the client (TM-I8)", () => {
  test("a local run knows its own session secret and app password, so the value checks below are not empty", () => {
    test.skip(!LOCAL_BUILD, "an external deployment's values are not known to this runner");
    expect(SECRET_VALUES.map(([label]) => label)).toEqual([
      "the session secret value",
      "the app database password",
    ]);
  });

  test("no secret name, connection string, role or claims setting in the client bundle", () => {
    test.skip(!LOCAL_BUILD, "scans the local build's .next/static");
    const root = join(process.cwd(), ".next", "static");
    test.skip(!existsSync(root), "no local build");
    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap((n) => {
        const p = join(dir, n);
        return statSync(p).isDirectory() ? walk(p) : [p];
      });
    const files = walk(root).filter((p) => /\.(js|css|json|txt|map)$/.test(p));
    expect(files.length).toBeGreaterThan(0);
    const offenders: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      for (const needle of FORBIDDEN_IN_CLIENT)
        if (text.includes(needle)) offenders.push(`${needle} in ${file}`);
      for (const [label, value] of SECRET_VALUES)
        if (text.includes(value)) offenders.push(`${label} in ${file}`);
    }
    expect(offenders).toEqual([]);
    // No source maps are shipped to the browser.
    expect(files.filter((p) => p.endsWith(".map"))).toEqual([]);
  });

  test("no secret name, connection string, role or claims setting in the HTML or flight data", async ({
    page,
  }) => {
    const bodies: string[] = [];
    page.on("response", async (r) => {
      if (
        r.url().startsWith(new URL(page.url() || "http://x").origin) ||
        r.request().resourceType() === "document"
      ) {
        bodies.push(await r.text().catch(() => ""));
      }
    });
    await signInAsAlpha(page);
    await page.goto("/my-work");
    await page.goto("/does-not-exist");
    bodies.push(await page.content());
    const all = bodies.join("\n");
    for (const needle of FORBIDDEN_IN_CLIENT) expect(all, needle).not.toContain(needle);
    // A value needle is checked with a boolean so a failure prints the label, never the secret.
    for (const [label, value] of SECRET_VALUES) expect(all.includes(value), label).toBe(false);
  });
});

test.describe("SEC-APP-15 browser storage holds nothing (TM-I11)", () => {
  test("after sign-in and navigation: no web storage, IndexedDB, Cache Storage or service worker; session is HttpOnly", async ({
    page,
  }) => {
    await signInAsAlpha(page);
    await page.goto("/my-work");
    await page.getByTestId("locale-toggle").click();
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    const state = await page.evaluate(async () => ({
      local: localStorage.length,
      session: sessionStorage.length,
      idb: (await indexedDB.databases()).length,
      caches: (await caches.keys()).length,
      workers: (await navigator.serviceWorker?.getRegistrations())?.length ?? 0,
      cookie: document.cookie,
    }));
    expect(state).toMatchObject({ local: 0, session: 0, idb: 0, caches: 0, workers: 0 });
    expect(state.cookie).not.toContain(SESSION_COOKIE);
    expect(state.cookie).not.toMatch(/persona|eyJ/);
  });
});
