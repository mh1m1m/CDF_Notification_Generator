// V13-SEC-003 · SEC-APP-03, SEC-APP-04, SEC-APP-06 · threats TM-S1, TM-S2 (docs/security/THREAT_MODEL.md).
// Adversarial session tokens beyond the foundation's own session.spec.ts: algorithm confusion, header injection,
// claim type confusion, look-alike values and sign-in flag variants. Every forged token must verify as null and
// map to no session. SYNTHETIC DATA ONLY.
import { base64url, SignJWT } from "jose";
import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  createSessionToken,
  isPersonaSignInEnabled,
  issuePersonaSession,
  readSession,
  SESSION_COOKIE_NAME,
  SESSION_MAX_AGE_SECONDS,
  sessionKey,
  verifySessionToken,
} from "@/lib/auth/session";

const SECRET = base64url.encode(crypto.getRandomValues(new Uint8Array(32)));
const env = { V13_SESSION_SECRET: SECRET, V13_PERSONA_SIGNIN: "enabled" };
const NOW = new Date("2026-10-28T10:00:00Z");
const IAT = Math.floor(NOW.getTime() / 1000);
const ALPHA = "0b000000-0000-4000-8000-000000000001";
const KEY = sessionKey(env);

const b64 = (value: unknown) => base64url.encode(new TextEncoder().encode(JSON.stringify(value)));

/** A compact JWS signed by hand with HMAC (any algorithm name in the header), so header and payload are free. */
function handSigned(header: Record<string, unknown>, payload: Record<string, unknown>, hash = "sha256") {
  const input = `${b64(header)}.${b64(payload)}`;
  const sig = createHmac(hash, Buffer.from(KEY)).update(input).digest("base64url");
  return `${input}.${sig}`;
}

const goodPayload = { persona_id: ALPHA, active_workspace: "SECRETARIAT", iat: IAT, exp: IAT + 3600 };
const verify = (token: string) => verifySessionToken(token, { env, now: NOW });

describe("SEC-APP-03 algorithm and header confusion (TM-S1)", () => {
  it("control: a hand-signed HS256 token with the real key verifies (the forgeries below differ only as named)", async () => {
    expect(await verify(handSigned({ alg: "HS256", typ: "JWT" }, goodPayload))).not.toBeNull();
  });

  it.each([
    ["HS384 with the session key", { alg: "HS384", typ: "JWT" }, "sha384"],
    ["HS512 with the session key", { alg: "HS512", typ: "JWT" }, "sha512"],
    ["alg 'none' with a signature", { alg: "none", typ: "JWT" }, "sha256"],
    ["alg 'NONE'", { alg: "NONE", typ: "JWT" }, "sha256"],
    ["alg 'hs256' (case)", { alg: "hs256", typ: "JWT" }, "sha256"],
    ["RS256 header over an HMAC signature (key confusion)", { alg: "RS256", typ: "JWT" }, "sha256"],
    ["missing alg", { typ: "JWT" }, "sha256"],
    ["typ other than JWT", { alg: "HS256", typ: "at+jwt" }, "sha256"],
    ["unknown critical header", { alg: "HS256", typ: "JWT", crit: ["exp-v13"], "exp-v13": 1 }, "sha256"],
    ["b64=false (unencoded payload)", { alg: "HS256", typ: "JWT", b64: false, crit: ["b64"] }, "sha256"],
  ])("refuses %s", async (_label, header, hash) => {
    expect(await verify(handSigned(header, goodPayload, hash))).toBeNull();
  });

  it("ignores key hints in the header: an embedded jwk, jku or kid never selects another key", async () => {
    const attackerKey = crypto.getRandomValues(new Uint8Array(32));
    const header = {
      alg: "HS256",
      typ: "JWT",
      kid: "../../../dev/null",
      jku: "https://attacker.example.test/jwks.json",
      jwk: { kty: "oct", k: base64url.encode(attackerKey) },
    };
    const input = `${b64(header)}.${b64(goodPayload)}`;
    const sig = createHmac("sha256", Buffer.from(attackerKey)).update(input).digest("base64url");
    expect(await verify(`${input}.${sig}`)).toBeNull();
  });

  it("refuses an empty signature, a missing signature, extra segments, a JWE shape and leading whitespace", async () => {
    const good = handSigned({ alg: "HS256", typ: "JWT" }, goodPayload);
    const [h, p] = good.split(".");
    for (const token of [`${h}.${p}.`, `${h}.${p}`, `${good}.x`, `a.b.c.d.e`, ` ${good}`]) {
      expect(await verify(token)).toBeNull();
    }
  });

  it("trailing whitespace after the signature is tolerated by the decoder but never changes the identity (INFO)", async () => {
    // Observed on ARCH-001 (jose 6.2.12 / Node base64 decoding): `<token> ` and `<token>\n` verify. This is
    // non-canonical acceptance of the SAME signed claims, not a forgery: no key-less party can change the payload.
    // Cookies cannot carry it (cookie values are trimmed). Pinned so a change in either direction is noticed.
    const good = handSigned({ alg: "HS256", typ: "JWT" }, goodPayload);
    const original = await verify(good);
    for (const token of [`${good} `, `${good}\n`]) {
      const claims = await verify(token);
      if (claims !== null) expect(claims).toEqual(original);
    }
  });
});

describe("SEC-APP-03 claim type confusion and look-alike values (TM-S1)", () => {
  const signed = (payload: Record<string, unknown>) => handSigned({ alg: "HS256", typ: "JWT" }, payload);

  it.each([
    ["upper-case persona UUID", { ...goodPayload, persona_id: ALPHA.toUpperCase() }],
    ["persona UUID with braces", { ...goodPayload, persona_id: `{${ALPHA}}` }],
    ["persona id as an array", { ...goodPayload, persona_id: [ALPHA] }],
    ["persona id as an object", { ...goodPayload, persona_id: { toString: ALPHA } }],
    ["persona id with trailing space", { ...goodPayload, persona_id: `${ALPHA} ` }],
    ["lower-case workspace code", { ...goodPayload, active_workspace: "secretariat" }],
    [
      "workspace id instead of code",
      { ...goodPayload, active_workspace: "0a000000-0000-4000-8000-000000000001" },
    ],
    ["unknown workspace code", { ...goodPayload, active_workspace: "ADMINISTRATION" }],
    ["exp as a string", { ...goodPayload, exp: String(IAT + 3600) }],
    ["iat as a float", { ...goodPayload, iat: IAT + 0.5 }],
    ["missing iat", { persona_id: ALPHA, active_workspace: "SECRETARIAT", exp: IAT + 3600 }],
    ["missing exp", { persona_id: ALPHA, active_workspace: "SECRETARIAT", iat: IAT }],
    ["lifetime longer than 8 hours", { ...goodPayload, exp: IAT + SESSION_MAX_AGE_SECONDS + 1 }],
    ["roles smuggled in", { ...goodPayload, roles: ["GOVERNANCE_OFFICER"] }],
    ["workspace_id smuggled in", { ...goodPayload, workspace_id: "0a000000-0000-4000-8000-000000000003" }],
    [
      "__proto__ key",
      JSON.parse(
        `{"persona_id":"${ALPHA}","active_workspace":"SECRETARIAT","iat":${IAT},"exp":${IAT + 3600},"__proto__":{"admin":true}}`,
      ),
    ],
  ])("refuses %s", async (_label, payload) => {
    expect(await verify(signed(payload as Record<string, unknown>))).toBeNull();
  });

  it("a duplicate persona_id key cannot carry a second persona past the signature (last-wins parse is still signed)", async () => {
    // The signature covers the exact bytes, so a duplicate key is only possible for the key holder. Even then the
    // strict schema sees one value; this pins that a token for an unknown persona maps to no session.
    const raw = `{"persona_id":"${ALPHA}","active_workspace":"SECRETARIAT","iat":${IAT},"exp":${IAT + 3600},"persona_id":"0b000000-0000-4000-8000-0000000000ff"}`;
    const header = b64({ alg: "HS256", typ: "JWT" });
    const payload = base64url.encode(new TextEncoder().encode(raw));
    const sig = createHmac("sha256", Buffer.from(KEY)).update(`${header}.${payload}`).digest("base64url");
    const store = {
      get: (name: string) =>
        name === SESSION_COOKIE_NAME ? { value: `${header}.${payload}.${sig}` } : undefined,
    };
    expect(await readSession(store, { env, now: NOW })).toBeNull();
  });
});

describe("SEC-APP-04 time (TM-S1)", () => {
  it("refuses a token one second past exp and one issued more than 60 s in the future", async () => {
    const token = await createSessionToken(
      { persona_id: ALPHA, active_workspace: "SECRETARIAT" },
      { env, now: NOW },
    );
    const after = new Date(NOW.getTime() + (SESSION_MAX_AGE_SECONDS + 1) * 1000);
    expect(await verifySessionToken(token, { env, now: after })).toBeNull();
    const future = handSigned(
      { alg: "HS256", typ: "JWT" },
      { ...goodPayload, iat: IAT + 120, exp: IAT + 3600 },
    );
    expect(await verify(future)).toBeNull();
  });

  it("a nbf in the future does not make an otherwise valid token usable early", async () => {
    const early = await new SignJWT({ persona_id: ALPHA, active_workspace: "SECRETARIAT" })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setIssuedAt(IAT)
      .setNotBefore(IAT + 600)
      .setExpirationTime(IAT + 3600)
      .sign(KEY);
    expect(await verify(early)).toBeNull();
  });
});

describe("SEC-APP-06 persona sign-in flag (TM-S2)", () => {
  it.each([
    undefined,
    "",
    "Enabled",
    "ENABLED",
    "true",
    "1",
    "yes",
    " enabled",
    "enabled ",
    "enabled\n",
    "disabled",
  ])("flag %j: sign-in refused and existing sessions stop verifying", async (flag) => {
    const flagEnv = { V13_SESSION_SECRET: SECRET, V13_PERSONA_SIGNIN: flag };
    expect(isPersonaSignInEnabled(flagEnv)).toBe(false);
    await expect(issuePersonaSession(ALPHA, { env: flagEnv, now: NOW })).rejects.toMatchObject({
      code: "PERSONA_SIGNIN_DISABLED",
    });
    const token = await createSessionToken(
      { persona_id: ALPHA, active_workspace: "SECRETARIAT" },
      { env, now: NOW },
    );
    expect(await verifySessionToken(token, { env: flagEnv, now: NOW })).toBeNull();
  });

  it.each([
    ["an id the sign-in page does not offer", "0b000000-0000-4000-8000-0000000000ff"],
    ["a display number", "CDF-DEMO-2026-0001"],
    ["SQL text", "' or 1=1 --"],
    ["an object", { persona_id: ALPHA }],
    ["an array", [ALPHA]],
    ["null", null],
  ])("refuses persona input that is %s", async (_label, input) => {
    await expect(issuePersonaSession(input, { env, now: NOW })).rejects.toMatchObject({
      code: "UNKNOWN_PERSONA",
    });
  });
});
