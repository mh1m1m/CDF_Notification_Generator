// V13-SEC-003 · SEC-APP-07, SEC-APP-10 (actions), SEC-APP-18 · threats TM-E5, TM-S3, TM-I10.
// Server Actions are addressed by action id, not by page. These probes take every action id from the build's
// server-reference manifest and post it, encoded the way React encodes a form, to public and gated pages:
//  - with no session, with a session signed by another secret, and with a cross-origin or null Origin;
//  - only allow-listed public actions may run without a session (tests/security/public-actions.ts), and no action
//    runs cross-origin, even with a valid session cookie (CSRF);
//  - refusals carry a digest only: no message, stack, path or code.
// Needs the locally built app (the manifest is read from .next); against V13_E2E_BASE_URL the suite is skipped.
// SYNTHETIC DATA ONLY: the personas are the synthetic registry's.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type APIRequestContext, type APIResponse } from "@playwright/test";
import { base64url } from "jose";
import { createSessionToken } from "@/lib/auth/session";
import { PUBLIC_ACTIONS } from "../public-actions";

const MANIFEST = join(process.cwd(), ".next", "server", "server-reference-manifest.json");
const SESSION_COOKIE = "__Host-v13_session";
const ALPHA = "0b000000-0000-4000-8000-000000000001";
const ATTACKER_ORIGIN = "https://attacker.example.test";

test.skip(!!process.env.V13_E2E_BASE_URL?.trim(), "reads the local build's action manifest");
test.skip(!existsSync(MANIFEST), "no local build");

interface Action {
  id: string;
  name: string; // "<file>#<export>", as in PUBLIC_ACTIONS
}

function buildActions(): Action[] {
  const manifest = JSON.parse(readFileSync(MANIFEST, "utf8")) as {
    node?: Record<string, { filename: string; exportedName: string }>;
  };
  return Object.entries(manifest.node ?? {}).map(([id, entry]) => ({
    id,
    name: `${entry.filename}#${entry.exportedName}`,
  }));
}

const actions = existsSync(MANIFEST) ? buildActions() : [];
const byName = (name: string) => actions.find((a) => a.name === name)!;
const sessionBound = actions.filter((a) => !(a.name in PUBLIC_ACTIONS));

/**
 * The body a React form action posts: the form's fields with the prefix "_1_", then the reply "0" that points at them.
 * Order matters (React decodes the reply as it streams), so this is a FormData, not an object: an object would put
 * the integer-like key "0" first.
 */
function formFields(fields: Record<string, string>): FormData {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.append(`_1_${key}`, value);
  form.append("0", '["$K1"]');
  return form;
}

const FIELDS: Record<string, Record<string, string>> = {
  "app/(auth)/sign-in/actions.ts#signInAsPersona": { persona_id: ALPHA },
  "app/locale-action.ts#switchLocale": { locale: "en" },
};

async function callAction(
  request: APIRequestContext,
  baseURL: string,
  action: Action,
  path: string,
  opts: { origin?: string | null; cookie?: string; fields?: Record<string, string> } = {},
): Promise<APIResponse> {
  const headers: Record<string, string> = { "next-action": action.id, accept: "text/x-component" };
  const origin = opts.origin === undefined ? baseURL : opts.origin;
  if (origin !== null) headers.origin = origin;
  if (opts.cookie) headers.cookie = opts.cookie;
  return request.post(path, {
    headers,
    multipart: formFields(opts.fields ?? FIELDS[action.name] ?? {}),
    maxRedirects: 0,
    failOnStatusCode: false,
  });
}

const setCookies = (response: APIResponse) =>
  response
    .headersArray()
    .filter((h) => h.name.toLowerCase() === "set-cookie")
    .map((h) => h.value);

/** A Set-Cookie that gives the session cookie a value (expiring it with an empty value is allowed). */
const setsSession = (response: APIResponse) =>
  setCookies(response).some(
    (c) => c.startsWith(`${SESSION_COOKIE}=`) && !c.startsWith(`${SESSION_COOKIE}=;`),
  );

/** True when the response is Next.js reporting an action that ran (result, redirect or revalidation). */
const actionRan = (response: APIResponse) => {
  const h = response.headers();
  return h["x-action-redirect"] !== undefined || h["x-action-revalidated"] !== undefined;
};

/** A refusal carries only Next.js' action envelope and an error digest. */
async function expectDigestOnly(response: APIResponse) {
  const body = await response.text();
  expect(body).toMatch(/^0:\{[^\n]*\}\n1:E\{"digest":"\d+"\}\n?$/);
  expect(body).not.toMatch(/stack|Error:|\.next\/|node_modules|at\s+\w+\s*\(|SQLSTATE|cdf_v13/i);
}

async function signedInCookie(request: APIRequestContext, baseURL: string) {
  const response = await callAction(
    request,
    baseURL,
    byName("app/(auth)/sign-in/actions.ts#signInAsPersona"),
    "/sign-in",
  );
  const cookie = setCookies(response).find((c) => c.startsWith(`${SESSION_COOKIE}=`));
  expect(cookie, "control sign-in set the session cookie").toBeDefined();
  return cookie!.split(";")[0]!;
}

async function foreignSecretCookie() {
  const env = {
    V13_SESSION_SECRET: base64url.encode(crypto.getRandomValues(new Uint8Array(32))),
    V13_PERSONA_SIGNIN: "enabled",
  };
  const token = await createSessionToken({ persona_id: ALPHA, active_workspace: "SECRETARIAT" }, { env });
  return `${SESSION_COOKIE}=${token}`;
}

test.describe("SEC-APP-18 Server Actions reached by id (TM-E5)", () => {
  test("the build's actions are known: every allow-listed public action exists, the rest are session-bound", () => {
    expect(actions.length).toBeGreaterThan(0);
    for (const name of Object.keys(PUBLIC_ACTIONS)) expect(actions.map((a) => a.name)).toContain(name);
    // Recorded for the report; the static check proves each of these calls getCurrentSession().
    test.info().annotations.push({ type: "session-bound actions", description: String(sessionBound.length) });
  });

  test("control: a same-origin sign-in with a listed persona runs and sets the session (the encoding is right)", async ({
    request,
    baseURL,
  }) => {
    const response = await callAction(
      request,
      baseURL!,
      byName("app/(auth)/sign-in/actions.ts#signInAsPersona"),
      "/sign-in",
    );
    expect(response.headers()["x-action-redirect"]).toMatch(/^\/my-work;/);
    expect(setsSession(response)).toBe(true);
  });

  for (const path of ["/sign-in", "/my-work", "/"]) {
    test(`no session-bound action runs on ${path} without a valid session (none, or another secret's cookie)`, async ({
      request,
      baseURL,
    }) => {
      const foreign = await foreignSecretCookie();
      for (const action of sessionBound) {
        for (const cookie of [undefined, foreign]) {
          const response = await callAction(request, baseURL!, action, path, { cookie });
          expect(actionRan(response), `${action.name} on ${path}`).toBe(false);
          expect(setsSession(response)).toBe(false);
        }
      }
    });
  }

  test("signOut without a session or with another secret's cookie changes nothing and issues no session", async ({
    request,
    baseURL,
  }) => {
    const signOut = byName("app/(platform)/actions.ts#signOut");
    const foreign = await foreignSecretCookie();
    for (const path of ["/sign-in", "/my-work"]) {
      for (const cookie of [undefined, foreign]) {
        const response = await callAction(request, baseURL!, signOut, path, { cookie });
        expect(setsSession(response), `${path}`).toBe(false);
        if (path === "/my-work") {
          // The gate answers before any action runs.
          expect(response.status()).toBe(307);
          expect(response.headers().location).toBe("/sign-in");
        }
      }
    }
  });
});

test.describe("SEC-APP-07 cross-origin Server Action calls are refused (TM-S3, CSRF)", () => {
  for (const origin of [ATTACKER_ORIGIN, "null", "http://localhost.attacker.example.test"]) {
    test(`Origin ${origin}: every action is refused with a digest only, even with a valid session cookie`, async ({
      request,
      baseURL,
    }) => {
      const valid = await signedInCookie(request, baseURL!);
      for (const action of actions) {
        for (const cookie of [undefined, valid]) {
          const path = action.name.startsWith("app/(platform)/") ? "/my-work" : "/sign-in";
          const response = await callAction(request, baseURL!, action, path, { origin, cookie });
          const label = `${action.name} cookie=${cookie ? "valid" : "none"}`;
          if (response.status() === 307) {
            // Gated page without a session: the gate answered first.
            expect(cookie, label).toBeUndefined();
            continue;
          }
          expect(response.status(), label).toBe(500);
          expect(actionRan(response), label).toBe(false);
          expect(setCookies(response), label).toEqual([]);
          await expectDigestOnly(response);
        }
      }
    });
  }

  test("INFO: a request with no Origin header is accepted by Next.js (browsers always send Origin on POST)", async ({
    request,
    baseURL,
  }) => {
    // Next.js 16 checks Origin against Host only when Origin is present. Browsers send Origin on every cross-origin
    // and same-origin POST, and the session cookie is SameSite=Lax, so a browser-driven CSRF cannot use this.
    // Pinned so a change in either direction is noticed (THREAT_MODEL TM-S3).
    const response = await callAction(
      request,
      baseURL!,
      byName("app/(auth)/sign-in/actions.ts#signInAsPersona"),
      "/sign-in",
      { origin: null },
    );
    expect(actionRan(response)).toBe(true);
  });
});

test.describe("SEC-APP-10 action errors leak nothing (TM-I10)", () => {
  test("an unknown action id gets a fixed short answer", async ({ request, baseURL }) => {
    const response = await callAction(
      request,
      baseURL!,
      { id: `00${"f".repeat(40)}`, name: "unknown" },
      "/sign-in",
    );
    expect([404, 409]).toContain(response.status());
    const body = await response.text();
    expect(body.length).toBeLessThan(100);
    expect(body).not.toMatch(/stack|\.next\/|node_modules|at\s+\w+\s*\(/i);
  });

  test("a malformed action body is refused with a digest only", async ({ request, baseURL }) => {
    for (const action of actions) {
      const response = await request.post("/sign-in", {
        headers: { "next-action": action.id, origin: baseURL!, "content-type": "text/plain;charset=UTF-8" },
        data: '["$Q', // truncated reply
        maxRedirects: 0,
        failOnStatusCode: false,
      });
      expect(actionRan(response), action.name).toBe(false);
      expect(setsSession(response)).toBe(false);
      if (response.status() === 500) await expectDigestOnly(response);
    }
  });

  for (const [label, personaId] of [
    ["an unlisted persona", "0b000000-0000-4000-8000-0000000000ff"],
    ["SQL text", "' or 1=1 --"],
    ["a display number", "CDF-DEMO-2026-0001"],
    ["a very long value", "x".repeat(10_000)],
  ] as const) {
    test(`sign-in with ${label} returns to sign-in with a reference only, and no session`, async ({
      request,
      baseURL,
    }) => {
      const response = await callAction(
        request,
        baseURL!,
        byName("app/(auth)/sign-in/actions.ts#signInAsPersona"),
        "/sign-in",
        { fields: { persona_id: personaId } },
      );
      expect(response.headers()["x-action-redirect"]).toMatch(
        /^\/sign-in\?ref=[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12};/,
      );
      expect(setsSession(response)).toBe(false);
      const body = await response.text();
      expect(body).not.toMatch(/UNKNOWN_PERSONA|PERSONA_SIGNIN_DISABLED|ZodError|stack/);
    });
  }
});
