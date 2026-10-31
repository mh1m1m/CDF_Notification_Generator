// V13-DB-009: the health probe MAC the app sends to claims_key_state (migration 0007). Checked against an independent
// WebCrypto HMAC, pinned to the label the migration hard-codes, and bound to the transaction id.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CLAIMS_KEY_PROBE_LABEL, claimsKeyProbe } from "@/lib/db/health-probe";

const KEY = new Uint8Array(32).fill(0x5a); // synthetic, test-only

async function webCryptoProbe(key: Uint8Array<ArrayBuffer>, xid: string): Promise<string> {
  const k = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign(
    "HMAC",
    k,
    new TextEncoder().encode(`${CLAIMS_KEY_PROBE_LABEL}|${xid}`),
  );
  return Buffer.from(mac).toString("base64url");
}

describe("claimsKeyProbe", () => {
  it("is unpadded base64url HMAC-SHA256(key, label|xid)", async () => {
    const probe = claimsKeyProbe(KEY, "6385");
    expect(probe).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(probe).toBe(await webCryptoProbe(KEY, "6385"));
  });

  it("differs per transaction and per key", () => {
    expect(claimsKeyProbe(KEY, "6385")).not.toBe(claimsKeyProbe(KEY, "6386"));
    expect(claimsKeyProbe(KEY, "6385")).not.toBe(claimsKeyProbe(new Uint8Array(32).fill(0x3c), "6385"));
  });

  it("refuses a transaction id that is not plain digits", () => {
    for (const bad of ["", "-1", "1e3", "12 ", "1|2", "0x10", "1".repeat(21)])
      expect(() => claimsKeyProbe(KEY, bad), bad).toThrow("invalid transaction id");
  });

  it("uses exactly the label migration 0007 hard-codes, which is not a claims text", () => {
    expect(CLAIMS_KEY_PROBE_LABEL).toBe("cdf-v13/claims-key-probe/v1");
    const migration = readFileSync("database/migrations/0007_claims_key_state.sql", "utf8");
    expect(migration).toContain(`'${CLAIMS_KEY_PROBE_LABEL}|'`);
    expect(() => JSON.parse(CLAIMS_KEY_PROBE_LABEL) as unknown).toThrow();
  });
});
