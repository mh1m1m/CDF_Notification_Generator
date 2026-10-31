/**
 * CDF Notifications V13 — idempotency keys, duplicate detection, retry policy and event ordering (W-D1, charter §9).
 * Classification: SYNTHETIC-DATA REFERENCE IMPLEMENTATION — not CDF production. node:crypto only.
 *
 * What it mirrors (FACT, platform repository read-only, migration 20261007001920_notification_engine.sql):
 *   - duplicate prevention: `dedupe_key text not null unique` (:117) and `on conflict (dedupe_key) do nothing` (:264);
 *     the platform key is `p_dedupe || ':' || p_recipient || ':' || v_channel` with an object-specific p_dedupe (:261).
 *   - retries: `attempts int … check (attempts between 0 and 5)` (:119), claim only `attempts < 5` (:591),
 *     FAILED when `attempts >= 5`, otherwise left PENDING for a retry (:597, :609).
 * Charter §9: key = sha256(type_code | object id | recipient id | version | disclosure policy version).
 * PROPOSAL — two optional, tagged components appended after the five charter components (never instead of them):
 *   `ch:<channel>`        one lifecycle record per channel, as the platform dedupes per channel
 *                         (dedupe_key = p_dedupe||':'||recipient||':'||channel, :261) and as D8 §2 line 53 proposes
 *                         (`event_id : recipient_id : channel`); without it an EMAIL and an IN_APP record would collide;
 *   `occ:<occurrence_id>` the originating event id, for repeatable notification types (W4-05 / MF-038; D8 line 53), so
 *                         that two reminders of one type for one object do not collide.
 * With neither, the key is exactly the charter formula and behaves like the platform's per-object dedupe
 * ('minutes-reminder:' || id, :368; 'defence-due:' || id, :633). The tags keep the two optional parts unambiguous.
 * PROPOSAL: exponential backoff — the platform has none (claim_email_batch takes the oldest PENDING rows regardless of
 * the last attempt, :590-592); in the prototype the scheduler interval is the only spacing (PRODUCTION_SUBSTITUTION_REQUIRED, :17-18).
 */
import "server-only";
import { sha256Hex, OPAQUE_ID } from "./util";

/** The platform outbox's attempt ceiling (1920:119, :591, :609). The lifecycle refuses a retry policy that differs. */
export const PLATFORM_OUTBOX_MAX_ATTEMPTS = 5;

const TYPE_CODE = /^[A-Z][A-Z0-9_-]{1,63}$/;
const VERSION = /^[1-9][0-9]{0,5}$/;
const CHANNEL = /^[A-Z][A-Z_]{1,15}$/;

export type IdempotencyErrorCode =
  | "MISSING_COMPONENT"
  | "DELIMITER_IN_COMPONENT"
  | "PERSONAL_DATA_IN_KEY"
  | "INVALID_COMPONENT"
  | "INVALID_KEY";

export class IdempotencyError extends Error {
  readonly code: IdempotencyErrorCode;
  constructor(code: IdempotencyErrorCode, message: string) {
    super(message);
    this.name = "IdempotencyError";
    this.code = code;
  }
}

function component(name: string, value: unknown, pattern: RegExp): string {
  if (value === null || value === undefined || value === "") {
    throw new IdempotencyError("MISSING_COMPONENT", `idempotency key: ${name} is required`);
  }
  const text = String(value);
  if (text.includes("|"))
    throw new IdempotencyError("DELIMITER_IN_COMPONENT", `idempotency key: ${name} contains '|'`);
  if (/[@\s]/u.test(text)) {
    // Addresses, display labels and free text never enter a key (W4-05: the V12 key carried e-mail addresses).
    throw new IdempotencyError("PERSONAL_DATA_IN_KEY", `idempotency key: ${name} must be an opaque id`);
  }
  if (!pattern.test(text))
    throw new IdempotencyError("INVALID_COMPONENT", `idempotency key: ${name} is not an opaque id`);
  return text;
}

/** The components of an idempotency key. Values are validated at run time (opaque ids only). */
export interface KeyComponents {
  type_code?: unknown;
  object_id?: unknown;
  recipient_id?: unknown;
  version?: unknown;
  policy_version?: unknown;
  channel?: unknown;
  occurrence_id?: unknown;
}

/**
 * sha256 hex of `type_code|object_id|recipient_id|version|policy_version[|ch:channel][|occ:occurrence_id]`.
 * Every component is an opaque identifier; the result carries no personal data by construction.
 */
export function idempotencyKey({
  type_code,
  object_id,
  recipient_id,
  version,
  policy_version,
  channel,
  occurrence_id,
}: KeyComponents = {}): string {
  const parts = [
    component("type_code", type_code, TYPE_CODE),
    component("object_id", object_id, OPAQUE_ID),
    component("recipient_id", recipient_id, OPAQUE_ID),
    component("version", version, VERSION),
    component("policy_version", policy_version, OPAQUE_ID),
  ];
  if (channel !== undefined && channel !== null) parts.push(`ch:${component("channel", channel, CHANNEL)}`);
  if (occurrence_id !== undefined && occurrence_id !== null)
    parts.push(`occ:${component("occurrence_id", occurrence_id, OPAQUE_ID)}`);
  return sha256Hex(parts.join("|"));
}

export interface IdempotencyRef {
  readonly notification_id: string;
  readonly version: number;
}

export interface ClaimResult {
  duplicate: boolean;
  existing: IdempotencyRef | null;
}

export interface IdempotencyRegistry {
  has(key: string): boolean;
  get(key: string): IdempotencyRef | null;
  /** Registers `key` → `ref`. Returns {duplicate:false} or {duplicate:true, existing} (like `on conflict do nothing`). */
  claim(key: unknown, ref: IdempotencyRef): ClaimResult;
  size(): number;
}

/** Append-only registry of issued keys (the unique index of the outbox, in memory). No delete. */
export function createIdempotencyRegistry(): Readonly<IdempotencyRegistry> {
  const seen = new Map<string, IdempotencyRef>();
  return Object.freeze({
    has: (key: string) => seen.has(key),
    get: (key: string) => seen.get(key) ?? null,
    claim(key: unknown, ref: IdempotencyRef): ClaimResult {
      if (typeof key !== "string" || !/^[0-9a-f]{64}$/.test(key))
        throw new IdempotencyError("INVALID_KEY", "not a sha256 key");
      if (seen.has(key)) return { duplicate: true, existing: seen.get(key) ?? null };
      seen.set(key, Object.freeze({ ...ref }));
      return { duplicate: false, existing: null };
    },
    size: () => seen.size,
  });
}

export type Verdict = "SENT" | "FAILED" | "PENDING";

export interface RetryPolicy {
  readonly maxAttempts: number;
  readonly baseMs: number;
  readonly capMs: number;
  backoffMs(attempt: number): number;
  nextAttemptAt(lastAttemptAtIso: unknown, attempt: number): string;
  exhausted(attempts: number): boolean;
  verdict(attempts: number, delivered: boolean): Verdict;
}

export interface RetryPolicyOptions {
  maxAttempts?: number;
  baseMs?: number;
  capMs?: number;
}

/**
 * Retry policy object `{maxAttempts, backoffMs(attempt)}` plus helpers. `verdict()` reproduces the platform's
 * settlement rule exactly (1920:609): delivered → SENT; not delivered and attempts >= max → FAILED; else PENDING.
 */
export function createRetryPolicy({
  maxAttempts = PLATFORM_OUTBOX_MAX_ATTEMPTS,
  baseMs = 60_000,
  capMs = 3_600_000,
}: RetryPolicyOptions = {}): RetryPolicy {
  for (const [k, v] of Object.entries({ maxAttempts, baseMs, capMs })) {
    if (!Number.isInteger(v) || v < 1) throw new RangeError(`retry policy: ${k} must be a positive integer`);
  }
  if (capMs < baseMs) throw new RangeError("retry policy: capMs must be >= baseMs");
  const backoffMs = (attempt: number): number => {
    if (!Number.isInteger(attempt) || attempt < 1)
      throw new RangeError("retry policy: attempt must be an integer >= 1");
    return Math.min(capMs, baseMs * 2 ** (attempt - 1));
  };
  const nextAttemptAt = (lastAttemptAtIso: unknown, attempt: number): string =>
    new Date(parseInstant(lastAttemptAtIso, "last_attempt_at") + backoffMs(attempt)).toISOString();
  const exhausted = (attempts: number): boolean => attempts >= maxAttempts;
  const verdict = (attempts: number, delivered: boolean): Verdict =>
    delivered ? "SENT" : attempts >= maxAttempts ? "FAILED" : "PENDING";
  return Object.freeze({ maxAttempts, baseMs, capMs, backoffMs, nextAttemptAt, exhausted, verdict });
}

export const RETRY_POLICY: RetryPolicy = createRetryPolicy();

// ---------------------------------------------------------------------------------------------------------------
// Ordering: occurred_at, then recorded_at, then event_id (deterministic tie-break — PROPOSAL).
// Timestamps must carry an explicit offset (W4-09 / MF-063: V12 rendered `…Z` and zone-less times identically).
// ---------------------------------------------------------------------------------------------------------------
const ISO_WITH_OFFSET =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(?:Z|[+-](\d{2}):(\d{2}))$/;
const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;
const isLeap = (y: number): boolean => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

/** Calendar range checks: Date.parse silently rolls 2026-02-30 over to March, so the fields are checked first. */
function calendarValid(m: RegExpExecArray): boolean {
  const [year = 0, month = 0, day = 0, hour = 0, minute = 0, second = 0, offH = 0, offM = 0] = m
    .slice(1)
    .map((x) => (x === undefined ? 0 : Number(x)));
  if (month < 1 || month > 12) return false;
  const dim = month === 2 && isLeap(year) ? 29 : (DAYS_IN_MONTH[month - 1] ?? 0);
  if (day < 1 || day > dim) return false;
  if (hour > 23 || minute > 59 || second > 59) return false;
  if (offH > 23 || offM > 59) return false;
  return true;
}

export type OrderingErrorCode = "TIMESTAMP_WITHOUT_OFFSET" | "INVALID_TIMESTAMP";

export class OrderingError extends Error {
  readonly code: OrderingErrorCode;
  constructor(code: OrderingErrorCode, message: string) {
    super(message);
    this.name = "OrderingError";
    this.code = code;
  }
}

/** Milliseconds since epoch of an ISO-8601 instant with an explicit offset; throws otherwise (fail closed). */
export function parseInstant(value: unknown, field = "timestamp"): number {
  const m = typeof value === "string" ? ISO_WITH_OFFSET.exec(value) : null;
  if (!m) {
    throw new OrderingError(
      "TIMESTAMP_WITHOUT_OFFSET",
      `${field} must be ISO-8601 with an explicit offset (Z or ±hh:mm)`,
    );
  }
  const ms = calendarValid(m) ? Date.parse(value as string) : Number.NaN;
  if (Number.isNaN(ms)) throw new OrderingError("INVALID_TIMESTAMP", `${field} is not a valid instant`);
  return ms;
}

export function isInstant(value: unknown): boolean {
  try {
    parseInstant(value);
    return true;
  } catch {
    return false;
  }
}

/** The fields the ordering reads. Any event-like object qualifies; values are checked at run time. */
export interface Orderable {
  readonly occurred_at?: unknown;
  readonly recorded_at?: unknown;
  readonly event_id?: unknown;
}

/** Comparator: occurred_at, then recorded_at (when both present), then event_id. */
export function compareEvents(a: Orderable, b: Orderable): number {
  const d1 = parseInstant(a.occurred_at, "occurred_at") - parseInstant(b.occurred_at, "occurred_at");
  if (d1 !== 0) return d1;
  const ra = a.recorded_at ?? null;
  const rb = b.recorded_at ?? null;
  if (ra !== null && rb !== null) {
    const d2 = parseInstant(ra, "recorded_at") - parseInstant(rb, "recorded_at");
    if (d2 !== 0) return d2;
  } else if (ra !== rb) {
    return ra === null ? 1 : -1; // an unrecorded event sorts after a recorded one at the same instant
  }
  const ia = String(a.event_id ?? "");
  const ib = String(b.event_id ?? "");
  return ia < ib ? -1 : ia > ib ? 1 : 0;
}

/** New array, ordered by compareEvents (input untouched). */
export function orderEvents<T extends Orderable>(events: readonly T[] | null | undefined): T[] {
  return [...(events ?? [])].sort(compareEvents);
}

/** The last event (by order) matching `predicate`, or null. */
export function latestEvent<T extends Orderable>(
  events: readonly T[] | null | undefined,
  predicate: (e: T) => unknown = () => true,
): T | null {
  const ordered = orderEvents((events ?? []).filter(predicate));
  return ordered.length ? (ordered[ordered.length - 1] ?? null) : null;
}

/**
 * recorded_at must not precede occurred_at (mirrors `check (decided_at <= recorded_at)` on decision.authority_decision,
 * 20261007001900_recommendations_legal_review_authority.sql:277).
 */
export function recordedNotBeforeOccurred(event: Orderable): boolean {
  if (event.recorded_at === undefined || event.recorded_at === null) return true;
  return parseInstant(event.recorded_at, "recorded_at") >= parseInstant(event.occurred_at, "occurred_at");
}
