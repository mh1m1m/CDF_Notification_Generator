// Draft form binding (V13-FE-012, resolves OI-049; ADR-020 design B). When the server renders the draft form for
// the route's case, it signs a binding: the purpose, the persona, the active workspace's id, the case, the form's
// one-time idempotency key, and the session's issued-at and expiry. On submit the command takes the case from the
// verified binding, never from the form. A posted case id that differs from the bound one is refused, as is any
// binding that is missing, malformed, tampered, issued to another persona, workspace or session, or expired. Every
// failure is the same generic refusal; the caller never learns which part failed, and the binding is never logged.
//
// Format: "v1.<payload>.<mac>", both parts base64url. The payload is a JSON array in a fixed order (canonical, no
// key ambiguity): [purpose, persona_id, workspace_id, case_id, idempotency_key, iat, exp]. Ids are canonical
// lower-case UUIDs. The MAC is HMAC-SHA256(key, "v1." + payload), with the key from lib/auth/draft-binding-key.ts.
// Verify order (SEC): split → decode → length check → timingSafeEqual → parse → field-by-field equality with the
// posted values, the session claims and the server clock. Authorisation and the command come only after that.
// A replay of the same form within its session carries the same idempotency key, which the command deduplicates.
import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { UuidSchema, WORKSPACE_IDS, type RequestIdentity } from "@/lib/contracts";

export const DRAFT_BINDING_PURPOSE = "notification-draft";
const VERSION = "v1";
const MAC_BYTES = 32;

/** What the binding is bound to: the session (persona, workspace, issued-at, expiry), the case and the form's key. */
export interface DraftBindingSubject {
  readonly identity: RequestIdentity;
  /** The current session's issued-at and expiry (seconds since the epoch). */
  readonly iat: number;
  readonly exp: number;
}

type Payload = readonly [string, string, string, string, string, number, number];

function mac(key: Uint8Array, payloadB64: string): Buffer {
  return createHmac("sha256", key).update(`${VERSION}.${payloadB64}`, "utf8").digest();
}

/** Signs the binding the server renders into the form for `caseId` and `idempotencyKey`. */
export function signDraftBinding(
  key: Uint8Array,
  subject: DraftBindingSubject,
  caseId: string,
  idempotencyKey: string,
): string {
  const payload: Payload = [
    DRAFT_BINDING_PURPOSE,
    subject.identity.persona_id,
    WORKSPACE_IDS[subject.identity.active_workspace],
    caseId,
    idempotencyKey,
    subject.iat,
    subject.exp,
  ];
  const payloadB64 = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${VERSION}.${payloadB64}.${mac(key, payloadB64).toString("base64url")}`;
}

const isUuid = (v: unknown): v is string => typeof v === "string" && UuidSchema.safeParse(v).success;
const isSeconds = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;

/**
 * The case the verified binding names, or null. Null for anything but a binding this server issued for this persona,
 * workspace and session, for exactly the posted case id and idempotency key, and not yet expired.
 */
export function verifyDraftBinding(
  key: Uint8Array,
  subject: DraftBindingSubject,
  posted: { readonly caseId: string; readonly idempotencyKey: string; readonly binding: unknown },
  nowSeconds: number,
): string | null {
  const { binding } = posted;
  if (typeof binding !== "string") return null;
  const parts = binding.split(".");
  if (parts.length !== 3 || parts[0] !== VERSION) return null;
  const [, payloadB64, macB64] = parts as [string, string, string];
  const given = Buffer.from(macB64, "base64url");
  // base64url decoding skips foreign characters, so the round trip must give back exactly what was posted.
  if (given.length !== MAC_BYTES || given.toString("base64url") !== macB64) return null;
  if (!timingSafeEqual(given, mac(key, payloadB64))) return null;
  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!Array.isArray(payload) || payload.length !== 7) return null;
  const [purpose, personaId, workspaceId, caseId, idempotencyKey, iat, exp] = payload as unknown[];
  if (purpose !== DRAFT_BINDING_PURPOSE) return null;
  if (!isUuid(personaId) || personaId !== subject.identity.persona_id) return null;
  if (!isUuid(workspaceId) || workspaceId !== WORKSPACE_IDS[subject.identity.active_workspace]) return null;
  if (!isUuid(caseId) || caseId !== posted.caseId) return null;
  if (typeof idempotencyKey !== "string" || idempotencyKey !== posted.idempotencyKey) return null;
  if (!isSeconds(iat) || iat !== subject.iat) return null;
  if (!isSeconds(exp) || exp > subject.exp || exp <= nowSeconds) return null;
  return caseId;
}
