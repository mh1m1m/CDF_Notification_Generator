// FE-002 workspace switch: the pure plan, and the Server Action called directly (SEC-APP-18 style) without a session,
// with a forged target and with a valid one. Asserts both the answer and that the cookie changed only on success.
import { base64url } from "jose";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { planWorkspaceSwitch } from "@/lib/server/workspace";
import { createSessionToken, SESSION_COOKIE_NAME, verifySessionToken } from "@/lib/auth/session";
import { ctxFor, DELTA, GOVERNANCE, SECRETARY } from "./support/identities";

const jar = new Map<string, string>();
const store = {
  get: (name: string) => (jar.has(name) ? { name, value: jar.get(name) as string } : undefined),
  set: (name: string, value: string) => {
    jar.set(name, value);
  },
};
vi.mock("next/headers", () => ({ cookies: async () => store }));
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
});
