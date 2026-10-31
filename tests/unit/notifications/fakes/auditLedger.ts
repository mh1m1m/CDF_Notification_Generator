/**
 * PRODUCTION_SUBSTITUTION_REQUIRED: in-memory test double
 *
 * auditLedger — mock of the platform's append-only, hash-chained audit ledger (W-D1, charter §10).
 * Classification: SYNTHETIC-DATA REFERENCE IMPLEMENTATION — not CDF production.
 * Production = audit.audit_event in RDS PostgreSQL, written by database command functions in the same transaction as
 * the change, forwarded to Alibaba SLS / the CDF SIEM (packages/audit/src/index.ts:7).
 *
 * Platform objects mirrored (FACT, read-only, 20261007000300_authz_core_and_audit.sql):
 *   - audit.audit_event columns (:141-159): event id, occurred_at, actor, case_id, action `^[A-Z][A-Z_]{2,63}$` (:149),
 *     category BUSINESS|SECURITY|ADMIN (:150), object type/id, reason ≤ 2000 (:154), outcome SUCCESS|DENIED|FAILURE (:155),
 *     metadata object (:156), previous_hash / event_hash (:157-158).
 *   - audit.compute_hash (:189-195): sha256(coalesce(previous_hash,'GENESIS') || '|' || canonical payload).
 *   - audit.record_event (:199-250): the only write path; the ledger stamps the time itself (:224 clock_timestamp()).
 *   - audit.reject_mutation + triggers (:253-269): UPDATE / DELETE / TRUNCATE rejected for everyone.
 *   - audit.verify_chain (:272): first broken link, or none.
 *   - metadata minimisation: packages/audit/src/index.ts:31-40 (FORBIDDEN_METADATA_KEY; string values ≤ 120 chars) and
 *     the table comment (:163) "metadata must never contain reporter identity, credentials or evidence content (§83)".
 *
 * Ported to strict TypeScript from the V13 reference (src/lifecycle/adapters/auditLedger.js); behaviour unchanged.
 * `toEvent` moved to lib/notifications/lifecycle/vocabulary.ts and is re-exported here.
 */
import {
  canonicalJson,
  sha256Hex,
  deepFreeze,
  clone,
  defaultClock,
  defaultIds,
  FORBIDDEN_PAYLOAD_KEY,
  findKeys,
  type DeepReadonly,
} from "@/lib/notifications/lifecycle/util";
import { parseInstant } from "@/lib/notifications/lifecycle/idempotency";
import type {
  AuditCategory,
  AuditEnvelope,
  AuditLedgerPort,
  AuditOutcome,
  ChainVerification,
  LedgerEntry,
  LedgerEventInput,
  LedgerFilter,
} from "@/lib/notifications/lifecycle/ports";

export { toEvent } from "@/lib/notifications/lifecycle/vocabulary";

export const AUDIT_CATEGORIES = Object.freeze(["BUSINESS", "SECURITY", "ADMIN"] as const); // 0300:150
export const AUDIT_OUTCOMES = Object.freeze(["SUCCESS", "DENIED", "FAILURE"] as const); // 0300:155
const ACTION = /^[A-Z][A-Z_]{2,63}$/; // 0300:149

export class AuditImmutableError extends Error {
  readonly code = "APPEND_ONLY" as const;
  constructor(op: string) {
    super(`audit.audit_event is append-only (${op} rejected)`); // message mirrors 0300:259
    this.name = "AuditImmutableError";
  }
}

export type AuditValidationCode =
  | "INVALID_EVENT"
  | "INVALID_ACTION"
  | "INVALID_CATEGORY"
  | "INVALID_OUTCOME"
  | "INVALID_REASON"
  | "INVALID_PAYLOAD"
  | "UNSAFE_METADATA_KEY"
  | "METADATA_VALUE_TOO_LONG"
  | "DUPLICATE_EVENT_ID";

export class AuditValidationError extends Error {
  readonly code: AuditValidationCode;
  constructor(code: AuditValidationCode, message: string) {
    super(message);
    this.name = "AuditValidationError";
    this.code = code;
  }
}

/** Mirrors assertSafeMetadata (packages/audit/src/index.ts:34-40), applied to every nested key. */
export function assertSafeMetadata(payload: unknown): void {
  const bad = findKeys(payload, (k) => FORBIDDEN_PAYLOAD_KEY.test(k));
  if (bad.length)
    throw new AuditValidationError("UNSAFE_METADATA_KEY", `Unsafe audit metadata key: ${bad[0]}`);
  const long: string[] = [];
  (function walk(v: unknown, p: string): void {
    if (typeof v === "string" && v.length > 120) long.push(p);
    else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) walk(x, p ? `${p}.${k}` : k);
  })(payload, "");
  if (long.length)
    throw new AuditValidationError("METADATA_VALUE_TOO_LONG", `Audit metadata value too long: ${long[0]}`);
}

/** audit.compute_hash (0300:189-195). */
export function computeHash(previousHash: string | null | undefined, payloadText: string): string {
  return sha256Hex(`${previousHash ?? "GENESIS"}|${payloadText}`);
}

interface Chained {
  readonly seq?: unknown;
  readonly previous_hash?: unknown;
  readonly event_hash?: unknown;
}

function hashable<T extends Chained>(entry: T): Omit<T, "seq" | "previous_hash" | "event_hash"> {
  const { seq: _seq, previous_hash: _previous, event_hash: _hash, ...rest } = entry; // the platform's canonical payload has no seq/hash fields (:171-186)
  return rest;
}

/** audit.verify_chain (0300:272) over any list of stored entries (pure: lets a test check a tampered copy). */
export function verifyEntries(entries: readonly Chained[]): ChainVerification {
  let previous: unknown = null;
  for (const e of entries) {
    if ((e.previous_hash ?? null) !== previous)
      return { ok: false, broken_seq: e.seq as number, reason: "PREVIOUS_HASH_MISMATCH" };
    const expected = computeHash(previous as string | null, canonicalJson(hashable(e)));
    if (expected !== e.event_hash)
      return { ok: false, broken_seq: e.seq as number, reason: "EVENT_HASH_MISMATCH" };
    previous = e.event_hash;
  }
  return { ok: true, broken_seq: null, reason: null };
}

export interface AuditLedgerOptions {
  clock?: () => string;
  ids?: () => string;
}

export interface AuditLedger extends AuditLedgerPort {
  readonly kind: "mock-audit-ledger";
  get(eventId: string): DeepReadonly<LedgerEntry> | null;
  size(): number;
  verifyChain(): ChainVerification;
  update(...args: unknown[]): never;
  delete(...args: unknown[]): never;
  truncate(...args: unknown[]): never;
}

export function createAuditLedger({
  clock = defaultClock,
  ids = defaultIds,
}: AuditLedgerOptions = {}): AuditLedger {
  const entries: DeepReadonly<LedgerEntry>[] = [];
  const byId = new Map<string, DeepReadonly<LedgerEntry>>();

  function append(event: LedgerEventInput, envelope: AuditEnvelope = {}): DeepReadonly<LedgerEntry> {
    if (!event || typeof event !== "object" || Array.isArray(event))
      throw new AuditValidationError("INVALID_EVENT", "event object required");
    if (!ACTION.test(event.type ?? ""))
      throw new AuditValidationError("INVALID_ACTION", "event.type must match ^[A-Z][A-Z_]{2,63}$");
    const category = envelope.category ?? "BUSINESS";
    const outcome = envelope.outcome ?? "SUCCESS";
    if (!(AUDIT_CATEGORIES as readonly unknown[]).includes(category))
      throw new AuditValidationError("INVALID_CATEGORY", "unknown audit category");
    if (!(AUDIT_OUTCOMES as readonly unknown[]).includes(outcome))
      throw new AuditValidationError("INVALID_OUTCOME", "unknown audit outcome");
    const reason = envelope.reason ?? null;
    if (reason !== null && (typeof reason !== "string" || reason.length > 2000)) {
      throw new AuditValidationError("INVALID_REASON", "reason must be text ≤ 2000 characters"); // 0300:154
    }
    const payload: unknown = event.payload ?? {};
    if (typeof payload !== "object" || Array.isArray(payload))
      throw new AuditValidationError("INVALID_PAYLOAD", "payload must be an object");
    assertSafeMetadata(payload);
    const recorded_at = clock();
    const occurred_at = event.occurred_at ?? recorded_at;
    parseInstant(occurred_at, "occurred_at");
    const event_id = event.event_id ?? `evt-${ids()}`;
    if (byId.has(event_id)) throw new AuditValidationError("DUPLICATE_EVENT_ID", "event_id already recorded");
    const previous_hash = entries.length ? (entries[entries.length - 1]?.event_hash ?? null) : null;
    const draft: Omit<LedgerEntry, "event_hash"> & { event_hash?: string } = {
      seq: entries.length + 1,
      event_id,
      type: event.type,
      occurred_at,
      recorded_at,
      case_id: event.case_id ?? null,
      object: clone(event.object ?? null),
      actor: clone(event.actor ?? null),
      provenance: clone(event.provenance ?? null),
      version: event.version ?? 1,
      causation_id: event.causation_id ?? null,
      correlation_id: event.correlation_id ?? null,
      payload: clone(payload as Record<string, unknown>),
      category: category as AuditCategory,
      outcome: outcome as AuditOutcome,
      reason,
      previous_hash,
    };
    draft.event_hash = computeHash(previous_hash, canonicalJson(hashable(draft)));
    const entry = deepFreeze(draft as LedgerEntry);
    entries.push(entry);
    byId.set(event_id, entry);
    return entry;
  }

  function list(filter: LedgerFilter = {}): DeepReadonly<LedgerEntry>[] {
    return entries.filter(
      (e) =>
        (filter.type === undefined || e.type === filter.type) &&
        (filter.object_id === undefined || e.object?.id === filter.object_id) &&
        (filter.correlation_id === undefined || e.correlation_id === filter.correlation_id) &&
        (filter.category === undefined || e.category === filter.category),
    );
  }

  const refuse = (op: string) => (): never => {
    throw new AuditImmutableError(op);
  };

  return Object.freeze({
    kind: "mock-audit-ledger" as const,
    append,
    list,
    get: (eventId: string) => byId.get(eventId) ?? null,
    size: () => entries.length,
    verifyChain: () => verifyEntries(entries),
    update: refuse("UPDATE"),
    delete: refuse("DELETE"),
    truncate: refuse("TRUNCATE"),
  });
}
