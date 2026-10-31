// FE-002 workspace switch: the pure plan, and the Server Action called directly (SEC-APP-18 style) without a session,
// with a forged target and with a valid one. Asserts both the answer and that the cookie changed only on success.
// OI-023: the audited command api_switch_workspace runs (stubbed request context here; against the database in
// tests/integration/fe/workspace-switch.spec.ts) before the cookie is written, and any refusal leaves it unchanged.
import { base64url } from "jose";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { planWorkspaceSwitch } from "@/lib/server/workspace";
import { createSessionToken, SESSION_COOKIE_NAME, verifySessionToken } from "@/lib/auth/session";
import { ctxFor, DELTA, GOVERNANCE, SECRETARY } from "./support/identities";

const jar = new Map<string, string>();
const written = new Map<string, unknown>();
const events: string[] = [];
const store = {
  get: (name: string) => (jar.has(name) ? { name, value: jar.get(name) as string } : undefined),
  set: (name: string, value: string, options?: unknown) => {
    events.push("cookie");
    jar.set(name, value);
    written.set(name, options);
  },
};
vi.mock("next/headers", () => ({ cookies: async () => store }));

/** What the stubbed api_switch_workspace answers: rows, or a database error code. */
const db = vi.hoisted(() => ({
  answer: null as null | { rows: unknown[] } | { code: string },
  calls: [] as { identity: unknown; text: string; values: unknown[] }[],
}));
vi.mock("@/lib/db/security-context", () => ({
  withRequestContext: async (identity: unknown, fn: (tx: unknown) => Promise<unknown>) => {
    const tx = (strings: TemplateStringsArray, ...values: unknown[]) => {
      db.calls.push({ identity, text: strings.join("$"), values });
      events.push("command");
      const a = db.answer;
      if (a && "code" in a) return Promise.reject(Object.assign(new Error("db"), { code: a.code }));
      return Promise.resolve(a?.rows ?? []);
    };
    return fn(tx);
  },
}));
const SECRETARIAT_ID = "0a000000-0000-4000-8000-000000000001";
const GOVERNANCE_ID = "0a000000-0000-4000-8000-000000000003";
class Redirect extends Error {
  constructor(readonly to: string) {
    super(`redirect ${to}`);
  }
}
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Redirect(to);
  },
}));

const env = {
  V13_SESSION_SECRET: base64url.encode(new Uint8Array(32).fill(7)),
  V13_PERSONA_SIGNIN: "enabled",
};

async function callSwitch(workspace: unknown): Promise<string> {
  const { switchWorkspace } = await import("@/app/(platform)/workspace-actions");
  const form = new FormData();
  if (workspace !== undefined) form.set("workspace", String(workspace));
  try {
    await switchWorkspace(form);
  } catch (e) {
    if (e instanceof Redirect) return e.to;
    throw e;
  }
  throw new Error("expected a redirect");
}

beforeEach(() => {
  jar.clear();
  written.clear();
  events.length = 0;
  db.calls.length = 0;
  db.answer = { rows: [{ workspace_id: SECRETARIAT_ID, workspace_code: "SECRETARIAT" }] };
  vi.resetModules();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
});

describe("planWorkspaceSwitch", () => {
  it("refuses without a session", () => {
    expect(planWorkspaceSwitch(null, "SECRETARIAT")).toEqual({ ok: false, reason: "UNAUTHENTICATED" });
  });

  it("allows a membership and refuses everything else", () => {
    const delta = ctxFor(GOVERNANCE).session;
    expect(planWorkspaceSwitch(delta, "SECRETARIAT")).toEqual({
      ok: true,
      subject: { persona_id: DELTA, active_workspace: "SECRETARIAT" },
    });
    for (const target of [
      "INVESTIGATIONS",
      "secretariat",
      "",
      null,
      "0a000000-0000-4000-8000-000000000001",
    ]) {
      expect(planWorkspaceSwitch(delta, target)).toEqual({ ok: false, reason: "REFUSED" });
    }
    expect(planWorkspaceSwitch(ctxFor(SECRETARY).session, "GOVERNANCE")).toEqual({
      ok: false,
      reason: "REFUSED",
    });
  });
});

describe("switchWorkspace Server Action", () => {
  it("without a session: redirects to sign-in and sets no cookie", async () => {
    expect(await callSwitch("SECRETARIAT")).toBe("/sign-in");
    expect(jar.size).toBe(0);
    expect(db.calls).toEqual([]);
  });

  it("with a tampered cookie: same as no session", async () => {
    jar.set(SESSION_COOKIE_NAME, "a.b.c");
    expect(await callSwitch("SECRETARIAT")).toBe("/sign-in");
    expect(jar.get(SESSION_COOKIE_NAME)).toBe("a.b.c");
  });

  it("to a workspace without membership: nothing changes, generic reference", async () => {
    const before = await createSessionToken({ persona_id: DELTA, active_workspace: "GOVERNANCE" }, { env });
    jar.set(SESSION_COOKIE_NAME, before);
    const to = await callSwitch("INVESTIGATIONS");
    expect(to).toMatch(/^\/my-work\?ref=[0-9a-f-]{36}$/);
    expect(jar.get(SESSION_COOKIE_NAME)).toBe(before);
    expect(db.calls).toEqual([]); // refused before the database
  });

  it("another persona's session cannot reach a workspace of Delta's", async () => {
    const alpha = await createSessionToken(
      { persona_id: "0b000000-0000-4000-8000-000000000001", active_workspace: "SECRETARIAT" },
      { env },
    );
    jar.set(SESSION_COOKIE_NAME, alpha);
    expect(await callSwitch("GOVERNANCE")).toMatch(/^\/my-work\?ref=/);
    expect(jar.get(SESSION_COOKIE_NAME)).toBe(alpha);
  });

  it("to an own membership: re-issues the cookie for that workspace, same persona", async () => {
    jar.set(
      SESSION_COOKIE_NAME,
      await createSessionToken({ persona_id: DELTA, active_workspace: "GOVERNANCE" }, { env }),
    );
    expect(await callSwitch("SECRETARIAT")).toBe("/my-work?switched=1");
    const claims = await verifySessionToken(jar.get(SESSION_COOKIE_NAME), { env });
    expect(claims).toMatchObject({ persona_id: DELTA, active_workspace: "SECRETARIAT" });
  });

  it("runs api_switch_workspace in the current workspace's context, target bound, before the cookie is written", async () => {
    jar.set(
      SESSION_COOKIE_NAME,
      await createSessionToken({ persona_id: DELTA, active_workspace: "GOVERNANCE" }, { env }),
    );
    events.length = 0;
    expect(await callSwitch("SECRETARIAT")).toBe("/my-work?switched=1");
    expect(events).toEqual(["command", "cookie"]);
    expect(db.calls).toHaveLength(1);
    const call = db.calls[0]!;
    expect(call.text).toMatch(/from cdf_notifications_v13\.api_switch_workspace\(\$::uuid\)/);
    expect(call.values).toEqual([SECRETARIAT_ID]);
    expect(call.identity).toMatchObject({ persona_id: DELTA, active_workspace: "GOVERNANCE" });
  });

  it.each([
    ["the database refuses the target (V1404)", { code: "V1404" }],
    ["the database finds no verified persona (V1401)", { code: "V1401" }],
    ["the database answers no row", { rows: [] }],
    [
      "the database names another workspace",
      { rows: [{ workspace_id: GOVERNANCE_ID, workspace_code: "GOVERNANCE" }] },
    ],
    [
      "the database answers a mismatched code",
      { rows: [{ workspace_id: SECRETARIAT_ID, workspace_code: "GOVERNANCE" }] },
    ],
    [
      "the database answers two rows",
      {
        rows: [
          { workspace_id: SECRETARIAT_ID, workspace_code: "SECRETARIAT" },
          { workspace_id: SECRETARIAT_ID, workspace_code: "SECRETARIAT" },
        ],
      },
    ],
  ])("%s: cookie unchanged, generic reference", async (_n, answer) => {
    const before = await createSessionToken({ persona_id: DELTA, active_workspace: "GOVERNANCE" }, { env });
    jar.set(SESSION_COOKIE_NAME, before);
    db.answer = answer;
    expect(await callSwitch("SECRETARIAT")).toMatch(/^\/my-work\?ref=[0-9a-f-]{36}$/);
    expect(jar.get(SESSION_COOKIE_NAME)).toBe(before);
    expect(written.size).toBe(0);
  });

  it("an expired session fails before the command runs", async () => {
    const before = await createSessionToken(
      { persona_id: DELTA, active_workspace: "GOVERNANCE" },
      { env, now: new Date(Date.now() - 9 * 3_600_000) },
    );
    jar.set(SESSION_COOKIE_NAME, before);
    expect(await callSwitch("SECRETARIAT")).toMatch(/^\/(sign-in|my-work\?ref=)/);
    expect(db.calls).toEqual([]);
    expect(jar.get(SESSION_COOKIE_NAME)).toBe(before);
  });

  it("keeps the session's expiry: a switch 3 hours after sign-in leaves 5 hours, cookie included", async () => {
    const signedInAt = new Date(Date.now() - 3 * 3_600_000);
    const original = await createSessionToken(
      { persona_id: DELTA, active_workspace: "GOVERNANCE" },
      { env, now: signedInAt },
    );
    const before = await verifySessionToken(original, { env });
    jar.set(SESSION_COOKIE_NAME, original);
    expect(await callSwitch("SECRETARIAT")).toBe("/my-work?switched=1");
    const after = await verifySessionToken(jar.get(SESSION_COOKIE_NAME), { env });
    expect(after?.exp).toBe(before?.exp);
    const maxAge = (written.get(SESSION_COOKIE_NAME) as { maxAge: number }).maxAge;
    expect(Math.abs(maxAge - 5 * 3600)).toBeLessThanOrEqual(2);
  });
});
