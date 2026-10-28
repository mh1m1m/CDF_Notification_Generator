// ADR-014 §4: the request-claims key is HKDF-SHA256(IKM = decoded V13_SESSION_SECRET, salt = empty,
// info = "cdf-v13/request-claims/v1", 32 bytes). Checked against an independent WebCrypto derivation.
import { base64url } from "jose";
import { describe, expect, it } from "vitest";
import { REQUEST_CLAIMS_KEY_INFO, requestClaimsKey } from "@/lib/auth/claims-key";
import { SessionConfigError } from "@/lib/auth/session";

const secret = (bytes = 32) => base64url.encode(crypto.getRandomValues(new Uint8Array(bytes)));

async function webCryptoHkdf(secretText: string): Promise<Uint8Array> {
  const ikm = await crypto.subtle.importKey(
    "raw",
    new Uint8Array(base64url.decode(secretText)),
    "HKDF",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: new Uint8Array(0),
      info: new TextEncoder().encode(REQUEST_CLAIMS_KEY_INFO),
    },
    ikm,
    256,
  );
  return new Uint8Array(bits);
}

describe("requestClaimsKey", () => {
  it("equals an independent WebCrypto HKDF-SHA256 derivation", async () => {
    const s = secret();
    const key = requestClaimsKey({ V13_SESSION_SECRET: s });
    expect(key).toBeInstanceOf(Uint8Array);
    expect(key.byteLength).toBe(32);
    expect(Buffer.from(key).toString("hex")).toBe(Buffer.from(await webCryptoHkdf(s)).toString("hex"));
  });

  it("is not the session key itself and differs between secrets", () => {
    const a = secret();
    const b = secret();
    const keyA = Buffer.from(requestClaimsKey({ V13_SESSION_SECRET: a })).toString("hex");
    expect(keyA).not.toBe(Buffer.from(base64url.decode(a)).toString("hex"));
    expect(keyA).not.toBe(Buffer.from(requestClaimsKey({ V13_SESSION_SECRET: b })).toString("hex"));
    expect(keyA).toBe(Buffer.from(requestClaimsKey({ V13_SESSION_SECRET: a })).toString("hex"));
  });

  it("throws SessionConfigError for a short or missing secret, without echoing it", () => {
    const short = secret(31);
    expect(() => requestClaimsKey({ V13_SESSION_SECRET: short })).toThrow(SessionConfigError);
    expect(() => requestClaimsKey({})).toThrow(SessionConfigError);
    try {
      requestClaimsKey({ V13_SESSION_SECRET: short });
      expect.unreachable();
    } catch (error) {
      expect((error as Error).message).not.toContain(short);
    }
  });
});
