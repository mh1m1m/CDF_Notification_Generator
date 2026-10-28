// Key for authenticating request claims (ADR-014 §4). Server only and kept out of ./session.ts, which proxy.ts imports
// and must stay free of Node.js built-ins.
//
// HKDF-SHA256 over the decoded V13_SESSION_SECRET bytes (IKM), an empty salt and the info string below, 32 bytes. The
// session-signing key is those decoded bytes themselves, so the derivation is one-way only: the claims key (the one
// the database is given) does not reveal the session-signing key, but the secret yields both. V13_SESSION_SECRET is
// therefore the single root secret to protect and rotate. Not used yet: DB wires it into lib/db/security-context.ts
// in V13-DB-001.
//
// PRODUCTION_SUBSTITUTION_REQUIRED: production derives keys inside KMS/HSM; no key material lives in environment
// variables there.
import "server-only";
import { hkdfSync } from "node:crypto";
import { sessionKey } from "./session";

export const REQUEST_CLAIMS_KEY_INFO = "cdf-v13/request-claims/v1";
export const REQUEST_CLAIMS_KEY_BYTES = 32;

/** The 32-byte claims key. Throws SessionConfigError (never echoing the value) when V13_SESSION_SECRET is unusable. */
export function requestClaimsKey(
  env: Readonly<Record<string, string | undefined>> = process.env,
): Uint8Array {
  return new Uint8Array(
    hkdfSync("sha256", sessionKey(env), new Uint8Array(0), REQUEST_CLAIMS_KEY_INFO, REQUEST_CLAIMS_KEY_BYTES),
  );
}
