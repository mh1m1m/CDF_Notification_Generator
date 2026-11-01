// Key for the notification-draft form binding (V13-FE-012, ADR-020). Server only, next to the request-claims key
// (./claims-key.ts) and kept apart from every other derivation.
//
// HKDF-SHA256 over the decoded V13_SESSION_SECRET bytes (IKM), an empty salt and its own info string, 32 bytes. Like
// the claims key it is one-way from the root secret and reveals neither the session-signing key (the decoded secret)
// nor the claims key. It signs only draft form bindings (lib/server/draft-binding.ts). No new environment variable.
//
// PRODUCTION_SUBSTITUTION_REQUIRED: production derives keys inside CDF KMS/HSM; no key material lives in environment
// variables there.
import "server-only";
import { hkdfSync } from "node:crypto";
import { sessionKey } from "./session";

export const DRAFT_BINDING_KEY_INFO = "cdf-v13/draft-route-binding/v1";
export const DRAFT_BINDING_KEY_BYTES = 32;

/** The 32-byte binding key. Throws SessionConfigError (never echoing the value) when V13_SESSION_SECRET is unusable. */
export function draftBindingKey(env: Readonly<Record<string, string | undefined>> = process.env): Uint8Array {
  return new Uint8Array(
    hkdfSync("sha256", sessionKey(env), new Uint8Array(0), DRAFT_BINDING_KEY_INFO, DRAFT_BINDING_KEY_BYTES),
  );
}
