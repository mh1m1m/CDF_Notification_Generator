// Persona sessions: signing, verification (fail closed), persona/workspace mapping, sign-in rules and cookie helpers.
import { base64url, SignJWT, UnsecuredJWT } from "jose";
import { describe, expect, it } from "vitest";
import { PersonaIdSchema } from "@/lib/contracts";
import {
  createSessionToken,
  expireSessionCookie,
  isSessionConfigured,
  issuePersonaSession,
  MIN_SESSION_SECRET_BYTES,
  personaSignInStatus,
  PersonaSignInError,
  readSession,
  reissueSessionToken,
  SESSION_COOKIE_NAME,
  SESSION_COOKIE_OPTIONS,
  SESSION_MAX_AGE_SECONDS,
  SessionConfigError,
  sessionFromClaims,
  SessionReissueError,
  sessionKey,
  verifySessionToken,
  writeSessionCookie,
} from "@/lib/auth/session";

const secret = (bytes = 32) => base64url.encode(crypto.getRandomValues(new Uint8Array(bytes)));
const SECRET = secret();
const env = { V13_SESSION_SECRET: SECRET, V13_PERSONA_SIGNIN: "enabled" };
const NOW = new Date("2026-10-28T10:00:00Z");

const ALPHA = "0b000000-0000-4000-8000-000000000001";
const DELTA = "0b000000-0000-4000-8000-000000000004";
const EPSILON = "0b000000-0000-4000-8000-000000000005";

const alphaToken = () =>
  createSessionToken({ persona_id: ALPHA, active_workspace: "SECRETARIAT" }, { env, now: NOW });

describe("session secret", () => {
  it("needs base64url text of at least 32 bytes", () => {
    expect(sessionKey(env).byteLength).toBe(32);
    expect(isSessionConfigured(env)).toBe(true);
    for (const bad of [undefined, "", secret(MIN_SESSION_SECRET_BYTES - 1), "not base64url!", `${SECRET}=`]) {
      expect(() => sessionKey({ V13_SESSION_SECRET: bad })).toThrow(SessionConfigError);
      expect(isSessionConfigured({ V13_SESSION_SECRET: bad })).toBe(false);
    }
  });

  it("never echoes the secret in errors", () => {
    const short = secret(16);
    try {
      sessionKey({ V13_SESSION_SECRET: short });
      expect.unreachable();
    } catch (error) {
      expect(String((error as Error).message)).not.toContain(short);
    }
  });
});

describe("tokens", () => {
  it("round-trips the claims {persona_id, active_workspace, iat, exp} with an 8-hour lifetime", async () => {
    const claims = await verifySessionToken(await alphaToken(), { env, now: NOW });
    expect(claims).toEqual({
      persona_id: ALPHA,
      active_workspace: "SECRETARIAT",
      iat: NOW.getTime() / 1000,
      exp: NOW.getTime() / 1000 + SESSION_MAX_AGE_SECONDS,
    });
  });

  it("rejects a tampered payload or signature", async () => {
    const [header, payload, signature] = (await alphaToken()).split(".") as [string, string, string];
    const forged = base64url.encode(
      JSON.stringify({
        ...JSON.parse(new TextDecoder().decode(base64url.decode(payload))),
        persona_id: DELTA,
      }),
    );
    expect(await verifySessionToken(`${header}.${forged}.${signature}`, { env, now: NOW })).toBeNull();
    const flipped = signature.slice(0, -2) + (signature.endsWith("AA") ? "BB" : "AA");
    expect(await verifySessionToken(`${header}.${payload}.${flipped}`, { env, now: NOW })).toBeNull();
  });

  it("rejects expired tokens, tokens from the future and over-long lifetimes", async () => {
    const token = await alphaToken();
    const later = new Date(NOW.getTime() + (SESSION_MAX_AGE_SECONDS + 1) * 1000);
    expect(await verifySessionToken(token, { env, now: later })).toBeNull();
    const earlier = new Date(NOW.getTime() - 120_000);
    expect(await verifySessionToken(token, { env, now: earlier })).toBeNull();
    const iat = NOW.getTime() / 1000;
    const longLived = await new SignJWT({ persona_id: ALPHA, active_workspace: "SECRETARIAT" })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setIssuedAt(iat)
      .setExpirationTime(iat + SESSION_MAX_AGE_SECONDS * 2)
      .sign(sessionKey(env));
    expect(await verifySessionToken(longLived, { env, now: NOW })).toBeNull();
  });

  it("rejects a token signed with another secret, an unsigned token and extra claims", async () => {
    const other = await createSessionToken(
      { persona_id: ALPHA, active_workspace: "SECRETARIAT" },
      { env: { ...env, V13_SESSION_SECRET: secret() }, now: NOW },
    );
    expect(await verifySessionToken(other, { env, now: NOW })).toBeNull();
    const iat = NOW.getTime() / 1000;
    const unsigned = new UnsecuredJWT({ persona_id: ALPHA, active_workspace: "SECRETARIAT" })
      .setIssuedAt(iat)
      .setExpirationTime(iat + 60)
      .encode();
    expect(await verifySessionToken(unsigned, { env, now: NOW })).toBeNull();
    const extra = await new SignJWT({
      persona_id: ALPHA,
      active_workspace: "SECRETARIAT",
      roles: ["GOVERNANCE_OFFICER"],
    })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setIssuedAt(iat)
      .setExpirationTime(iat + 60)
      .sign(sessionKey(env));
    expect(await verifySessionToken(extra, { env, now: NOW })).toBeNull();
  });

  it("fails closed when the secret is short or missing, or persona sign-in is off", async () => {
    const token = await alphaToken();
    expect(
      await verifySessionToken(token, { env: { ...env, V13_SESSION_SECRET: secret(16) }, now: NOW }),
    ).toBeNull();
    expect(await verifySessionToken(token, { env: { V13_PERSONA_SIGNIN: "enabled" }, now: NOW })).toBeNull();
    expect(
      await verifySessionToken(token, { env: { ...env, V13_PERSONA_SIGNIN: "disabled" }, now: NOW }),
    ).toBeNull();
    expect(
      await verifySessionToken(token, { env: { ...env, V13_PERSONA_SIGNIN: "ENABLED" }, now: NOW }),
    ).toBeNull();
    await expect(
      createSessionToken(
        { persona_id: ALPHA, active_workspace: "SECRETARIAT" },
        { env: { V13_SESSION_SECRET: secret(16) } },
      ),
    ).rejects.toBeInstanceOf(SessionConfigError);
  });

  it("rejects missing and oversized tokens before parsing", async () => {
    expect(await verifySessionToken(undefined, { env })).toBeNull();
    expect(await verifySessionToken("", { env })).toBeNull();
    expect(await verifySessionToken("x".repeat(4096), { env })).toBeNull();
    expect(await verifySessionToken("a.b.c", { env })).toBeNull();
  });
});

describe("sessions", () => {
  it("maps claims to the persona and its roles in the active workspace", async () => {
    const claims = await verifySessionToken(await alphaToken(), { env, now: NOW });
    const session = claims && sessionFromClaims(claims);
    expect(session?.identity).toEqual({
      persona_id: ALPHA,
      active_workspace: "SECRETARIAT",
      roles: ["COMMITTEE_SECRETARY"],
    });
  });

  it("accepts any workspace the persona is a member of (workspace switch) and nothing else", () => {
    const iat = NOW.getTime() / 1000;
    const exp = iat + 60;
    const claims = (persona: string, active_workspace: "SECRETARIAT" | "INVESTIGATIONS" | "GOVERNANCE") => ({
      persona_id: PersonaIdSchema.parse(persona),
      active_workspace,
      iat,
      exp,
    });
    expect(sessionFromClaims(claims(DELTA, "SECRETARIAT"))?.identity.roles).toEqual(["GOVERNANCE_OFFICER"]);
    expect(sessionFromClaims(claims(DELTA, "GOVERNANCE"))).not.toBeNull();
    expect(sessionFromClaims(claims(DELTA, "INVESTIGATIONS"))).toBeNull();
    expect(sessionFromClaims(claims(ALPHA, "GOVERNANCE"))).toBeNull();
    expect(sessionFromClaims(claims("0b000000-0000-4000-8000-000000000099", "SECRETARIAT"))).toBeNull();
  });

  it("accepts minted sessions of negative-test personas (the database is what refuses them)", async () => {
    const token = await createSessionToken(
      { persona_id: EPSILON, active_workspace: "SECRETARIAT" },
      { env, now: NOW },
    );
    const claims = await verifySessionToken(token, { env, now: NOW });
    expect(claims && sessionFromClaims(claims)?.persona.negative_test).toBe(true);
  });
});

describe("persona sign-in", () => {
  it("issues a session in the persona's first membership workspace", async () => {
    const { token, persona } = await issuePersonaSession(DELTA, { env, now: NOW });
    expect(persona.code).toBe("GOVERNANCE_DELTA");
    expect((await verifySessionToken(token, { env, now: NOW }))?.active_workspace).toBe("GOVERNANCE");
  });

  it("refuses unknown ids and negative-test personas alike", async () => {
    for (const input of [EPSILON, "0b000000-0000-4000-8000-000000000006", "secretary-alpha", undefined, 42]) {
      await expect(issuePersonaSession(input, { env })).rejects.toMatchObject({ code: "UNKNOWN_PERSONA" });
    }
  });

  it("refuses when V13_PERSONA_SIGNIN is not exactly 'enabled'", async () => {
    for (const flag of [undefined, "", "true", "ENABLED", "disabled"]) {
      await expect(
        issuePersonaSession(ALPHA, { env: { ...env, V13_PERSONA_SIGNIN: flag } }),
      ).rejects.toBeInstanceOf(PersonaSignInError);
    }
  });

  it("reports the sign-in page state", () => {
    expect(personaSignInStatus(env)).toBe("enabled");
    expect(personaSignInStatus({ ...env, V13_PERSONA_SIGNIN: undefined })).toBe("disabled");
    expect(personaSignInStatus({ V13_PERSONA_SIGNIN: "enabled", V13_SESSION_SECRET: secret(8) })).toBe(
      "misconfigured",
    );
  });
});

describe("cookie", () => {
  it("is __Host-, HttpOnly, Secure, SameSite=Lax, Path=/ and lives 8 hours", () => {
    expect(SESSION_COOKIE_NAME).toBe("__Host-v13_session");
    expect(SESSION_COOKIE_OPTIONS).toEqual({
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: 28_800,
    });
  });

  it("is written, read and expired through the store helpers", async () => {
    const jar = new Map<string, { value: string; options: unknown }>();
    const store = {
      get: (name: string) => (jar.has(name) ? { value: jar.get(name)?.value ?? "" } : undefined),
      set: (name: string, value: string, options: unknown) => void jar.set(name, { value, options }),
    };
    writeSessionCookie(
      store,
      await createSessionToken({ persona_id: ALPHA, active_workspace: "SECRETARIAT" }, { env }),
    );
    expect((await readSession(store, { env }))?.persona.code).toBe("SECRETARY_ALPHA");
    expireSessionCookie(store);
    expect(jar.get(SESSION_COOKIE_NAME)).toEqual({
      value: "",
      options: { ...SESSION_COOKIE_OPTIONS, maxAge: 0 },
    });
    expect(await readSession(store, { env })).toBeNull();
  });
});

describe("workspace switch re-issue (a switch never extends the session)", () => {
  const at = (ms: number) => new Date(NOW.getTime() + ms);
  const HOUR = 3_600_000;
  const deltaClaims = async () => {
    const token = await createSessionToken(
      { persona_id: DELTA, active_workspace: "GOVERNANCE" },
      { env, now: NOW },
    );
    const claims = await verifySessionToken(token, { env, now: NOW });
    if (!claims) throw new Error("expected claims");
    return claims;
  };

  it("keeps exp after one switch; the token verifies and maps to the target workspace", async () => {
    const claims = await deltaClaims();
    const later = at(2 * HOUR);
    const { token, maxAge } = await reissueSessionToken(claims, "SECRETARIAT", { env, now: later });
    const next = await verifySessionToken(token, { env, now: later });
    expect(next?.exp).toBe(claims.exp);
    expect(next?.iat).toBe(Math.floor(later.getTime() / 1000));
    expect(maxAge).toBe(claims.exp - Math.floor(later.getTime() / 1000));
    expect(maxAge).toBe(6 * 3600);
    const session = next ? sessionFromClaims(next) : null;
    expect(session?.identity.active_workspace).toBe("SECRETARIAT");
    expect(session?.persona.persona_id).toBe(DELTA);
  });

  it("keeps exp across repeated switches, including one at 7 h 59 m", async () => {
    let claims = await deltaClaims();
    const exp = claims.exp;
    for (const [ms, ws] of [
      [1 * HOUR, "SECRETARIAT"],
      [3 * HOUR, "GOVERNANCE"],
      [7 * HOUR + 59 * 60_000, "SECRETARIAT"],
    ] as const) {
      const { token, maxAge } = await reissueSessionToken(claims, ws, { env, now: at(ms) });
      const next = await verifySessionToken(token, { env, now: at(ms) });
      if (!next) throw new Error("expected claims");
      expect(next.exp).toBe(exp);
      expect(maxAge).toBe(exp - Math.floor(at(ms).getTime() / 1000));
      claims = next;
    }
    expect(exp - Math.floor(at(7 * HOUR + 59 * 60_000).getTime() / 1000)).toBe(60);
  });

  it("refuses an expired session (code only) and leaves the cookie as it was", async () => {
    const claims = await deltaClaims();
    const jar = new Map<string, { value: string; options: unknown }>();
    const store = {
      get: (name: string) => (jar.has(name) ? { value: jar.get(name)?.value ?? "" } : undefined),
      set: (name: string, value: string, options: unknown) => void jar.set(name, { value, options }),
    };
    writeSessionCookie(store, "original-token");
    const before = jar.get(SESSION_COOKIE_NAME);
    let error: unknown;
    try {
      const { token, maxAge } = await reissueSessionToken(claims, "SECRETARIAT", { env, now: at(8 * HOUR) });
      writeSessionCookie(store, token, maxAge);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(SessionReissueError);
    expect((error as SessionReissueError).message).toBe("SESSION_EXPIRED");
    expect(jar.get(SESSION_COOKIE_NAME)).toEqual(before);
  });

  it("refuses a lifetime longer than a session, and a workspace code that is not one", async () => {
    const claims = await deltaClaims();
    await expect(
      reissueSessionToken({ ...claims, exp: claims.exp + 60 }, "SECRETARIAT", { env, now: NOW }),
    ).rejects.toMatchObject({ code: "SESSION_LIFETIME_INVALID" });
    await expect(reissueSessionToken(claims, "FINANCE", { env, now: NOW })).rejects.toThrow();
  });

  it("writes the cookie with Max-Age equal to the remaining lifetime, and refuses an out-of-range Max-Age", async () => {
    const claims = await deltaClaims();
    const set: unknown[] = [];
    const store = { set: (_n: string, _v: string, options: unknown) => void set.push(options) };
    const { token, maxAge } = await reissueSessionToken(claims, "SECRETARIAT", { env, now: at(5 * HOUR) });
    writeSessionCookie(store, token, maxAge);
    expect(set[0]).toEqual({ ...SESSION_COOKIE_OPTIONS, maxAge: 3 * 3600 });
    for (const bad of [0, -1, 1.5, SESSION_MAX_AGE_SECONDS + 1]) {
      expect(() => writeSessionCookie(store, token, bad)).toThrow(SessionReissueError);
    }
    expect(set).toHaveLength(1);
  });
});
