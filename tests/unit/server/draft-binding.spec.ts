// V13-FE-012 (OI-049, ADR-020 design B): the notification-draft form binding. Sign and verify: the same input gives the
// same binding, and every change is refused: each field in turn, a tampered, truncated or empty MAC, another key
// (including one derived under another info string), another session, an expired binding, a missing or extra payload
// field, another purpose or version. The key is kept apart from the session-signing and request-claims keys.
// Synthetic personas only.
import { createHmac, hkdfSync } from "node:crypto";
import { base64url } from "jose";
import { describe, expect, it } from "vitest";
import { DRAFT_BINDING_KEY_INFO, draftBindingKey } from "@/lib/auth/draft-binding-key";
import { requestClaimsKey } from "@/lib/auth/claims-key";
import { sessionKey } from "@/lib/auth/session";
import { WORKSPACE_IDS, type RequestIdentity } from "@/lib/contracts";
import {
  DRAFT_BINDING_PURPOSE,
  signDraftBinding,
  verifyDraftBinding,
  type DraftBindingSubject,
} from "@/lib/server/draft-binding";
import { caseIdOf } from "./support/fake-case-source";
import { GOVERNANCE_AT_SECRETARIAT, INVESTIGATOR_BETA, SECRETARY } from "./support/identities";

const ENV = { V13_SESSION_SECRET: base64url.encode(new Uint8Array(32).fill(7)) };
const KEY = draftBindingKey(ENV);
const IAT = 1_790_000_000;
const EXP = IAT + 8 * 60 * 60;
const NOW = IAT + 60;
const IDEM = "0123456789abcdef".repeat(4);
const CASE = caseIdOf(4);
const subject = (identity: RequestIdentity = SECRETARY, iat = IAT, exp = EXP): DraftBindingSubject => ({
  identity,
  iat,
  exp,
});
const sign = (s = subject(), caseId = CASE, idem = IDEM, key = KEY) => signDraftBinding(key, s, caseId, idem);
const verify = (binding: unknown, s = subject(), caseId: string = CASE, idem = IDEM, now = NOW, key = KEY) =>
  verifyDraftBinding(key, s, { caseId, idempotencyKey: idem, binding }, now);

/** A binding over any payload, correctly MAC'd with `key`: proves the field checks, not only the MAC, refuse it. */
function craft(payload: unknown, key = KEY, version = "v1"): string {
  const p = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const mac = createHmac("sha256", key).update(`${version}.${p}`, "utf8").digest("base64url");
  return `${version}.${p}.${mac}`;
}
const fields = (over: Partial<Record<number, unknown>> = {}) => {
  const base: unknown[] = [
    DRAFT_BINDING_PURPOSE,
    SECRETARY.persona_id,
    WORKSPACE_IDS[SECRETARY.active_workspace],
    CASE,
    IDEM,
    IAT,
    EXP,
  ];
  for (const [i, v] of Object.entries(over)) base[Number(i)] = v;
  return base;
};

describe("draft binding key (lib/auth)", () => {
  it("is 32 bytes, deterministic, and differs from the session-signing and request-claims keys", () => {
    expect(KEY).toHaveLength(32);
    expect(Buffer.from(draftBindingKey(ENV)).equals(Buffer.from(KEY))).toBe(true);
    expect(Buffer.from(KEY).equals(Buffer.from(sessionKey(ENV)))).toBe(false);
    expect(Buffer.from(KEY).equals(Buffer.from(requestClaimsKey(ENV)))).toBe(false);
    expect(DRAFT_BINDING_KEY_INFO).toBe("cdf-v13/draft-route-binding/v1");
  });

  it("needs a usable V13_SESSION_SECRET and never echoes it", () => {
    expect(() => draftBindingKey({})).toThrow(/V13_SESSION_SECRET/);
    expect(() => draftBindingKey({ V13_SESSION_SECRET: "short" })).toThrow(/V13_SESSION_SECRET/);
  });
});

describe("sign and verify", () => {
  it("the same input gives the same binding, and it verifies to the bound case", () => {
    expect(sign()).toBe(sign());
    expect(sign()).toMatch(/^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/);
    expect(verify(sign())).toBe(CASE);
  });

  it.each([
    ["another posted case", () => verify(sign(), subject(), caseIdOf(1))],
    ["another posted idempotency key", () => verify(sign(), subject(), CASE, "f".repeat(64))],
    ["another persona (Beta)", () => verify(sign(), subject(INVESTIGATOR_BETA))],
    ["the same persona in another workspace", () => verify(sign(), subject(GOVERNANCE_AT_SECRETARIAT))],
    ["another session (a later issued-at)", () => verify(sign(), subject(SECRETARY, IAT + 1))],
    ["a session that ends earlier than the binding", () => verify(sign(), subject(SECRETARY, IAT, EXP - 1))],
    ["an expired binding (now = exp)", () => verify(sign(), subject(), CASE, IDEM, EXP)],
    ["an expired binding (now > exp)", () => verify(sign(), subject(), CASE, IDEM, EXP + 3600)],
    ["another key", () => verify(sign(), subject(), CASE, IDEM, NOW, new Uint8Array(32).fill(1))],
    [
      "a key derived under another info string",
      () =>
        verify(
          sign(
            subject(),
            CASE,
            IDEM,
            new Uint8Array(
              hkdfSync("sha256", sessionKey(ENV), new Uint8Array(0), "cdf-v13/request-claims/v1", 32),
            ),
          ),
        ),
    ],
  ] as const)("refuses %s", (_n, check) => {
    expect(check()).toBeNull();
  });

  it("refuses a tampered byte anywhere, a truncated, empty or padded MAC, and malformed shapes", () => {
    const good = sign();
    for (let i = 0; i < good.length; i++) {
      const c = good[i] === "A" ? "B" : "A";
      const bad = good.slice(0, i) + c + good.slice(i + 1);
      if (bad !== good) expect(verify(bad), `byte ${i}`).toBeNull();
    }
    const [v, p, m] = good.split(".") as [string, string, string];
    for (const bad of [
      `${v}.${p}.${m.slice(0, -1)}`,
      `${v}.${p}.`,
      `${v}.${p}.${m}A`,
      `${v}.${p}.${m}=`,
      `${v}.${p}`,
      `${v}.${p}.${m}.x`,
      `v2.${p}.${m}`,
      "",
      null,
      undefined,
      42,
    ]) {
      expect(verify(bad), String(bad)).toBeNull();
    }
  });

  it.each([
    ["another purpose", fields({ 0: "notification-dispatch" })],
    ["a persona id in upper case", fields({ 1: SECRETARY.persona_id.toUpperCase() })],
    ["a workspace code instead of its id", fields({ 2: SECRETARY.active_workspace })],
    ["a case id in upper case", fields({ 3: CASE.toUpperCase() })],
    ["a non-integer issued-at", fields({ 5: IAT + 0.5 })],
    ["an issued-at as a string", fields({ 5: String(IAT) })],
    ["a missing field", fields().slice(0, 6)],
    ["an extra field", [...fields(), "extra"]],
    ["an object instead of the array", { purpose: DRAFT_BINDING_PURPOSE }],
  ] as const)("refuses a correctly MAC'd payload with %s", (_n, payload) => {
    expect(verify(craft(payload))).toBeNull();
  });

  it("a correctly MAC'd payload with the right fields verifies (the crafted control)", () => {
    expect(verify(craft(fields()))).toBe(CASE);
    expect(verify(craft(fields(), KEY, "v2"))).toBeNull();
  });
});
