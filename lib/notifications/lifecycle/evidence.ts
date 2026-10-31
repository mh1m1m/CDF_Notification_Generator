/**
 * evidence — append-only notification evidence store keyed by notification id + version (W-D1, charter §2 Domain G, §9).
 * Classification: SYNTHETIC-DATA REFERENCE IMPLEMENTATION — not CDF production.
 * PRODUCTION_SUBSTITUTION_REQUIRED: in-memory. Production = an immutable evidence table with an immutability trigger and
 * RLS (D8 §11 item 2, PROPOSAL) plus the private evidence vault (CLAUDE.md §24-§27: private storage, random immutable
 * keys, never overwrite, no user hard delete; EvidenceStorage port, packages/application/src/ports.ts:93-102).
 *
 * Holds, per version: originating event id, source refs, template version, disclosure policy version, idempotency key,
 * authorizer, recipients (opaque ids + class + capacity — never addresses or names), issued_at, delivery attempts with
 * outcomes, corrections, exports, acknowledgements, suppressions, refused transitions and open exceptions. It never
 * holds message content:
 * the rendered model is represented by `model_hash` (sha-256 of its canonical JSON) only, so the store proves what was
 * rendered without becoming a second authoritative copy of the content (charter §2 G: "no duplicate authoritative store").
 * API: append(entry), list(id, version?), summary(id, version), verify(id, version). update/delete/set/clear throw;
 * every stored entry is deeply frozen (assignment to it throws in ESM strict mode).
 */
import "server-only";
import {
  deepFreeze,
  clone,
  canonicalJson,
  sha256Hex,
  defaultClock,
  defaultIds,
  findKeys,
  type DeepReadonly,
} from "./util";
import type {
  EvidenceData,
  EvidenceItem,
  EvidenceEntry,
  EvidenceKind,
  EvidenceStorePort,
  EvidenceSummary,
  EvidenceVerification,
} from "./ports";

export const EVIDENCE_KINDS = Object.freeze([
  "ISSUANCE_CONTEXT",
  "TRANSITION",
  "DELIVERY_ATTEMPT",
  "SUPPRESSION",
  "CORRECTION",
  "EXPORT",
  "ACKNOWLEDGEMENT",
  "EXCEPTION",
  "REFUSAL", // a refused transition (codes and rule ids only): why a version did not move
] as const);

/** Key segments that would mean content or personal data is being stored (stricter than the ledger's list). */
const CONTENT_SEGMENTS = new Set([
  "name",
  "email",
  "phone",
  "password",
  "secret",
  "token",
  "identity",
  "description",
  "body",
  "content",
  "html",
  "text",
  "subject",
  "address",
  "narrative",
]);

export class EvidenceImmutableError extends Error {
  readonly code = "APPEND_ONLY" as const;
  constructor(op: string) {
    super(`notification evidence is append-only (${op} rejected)`);
    this.name = "EvidenceImmutableError";
  }
}

export type EvidenceValidationCode =
  | "INVALID_ENTRY"
  | "INVALID_ID"
  | "INVALID_VERSION"
  | "INVALID_KIND"
  | "INVALID_DATA"
  | "CONTENT_NOT_ALLOWED";

export class EvidenceValidationError extends Error {
  readonly code: EvidenceValidationCode;
  constructor(code: EvidenceValidationCode, message: string) {
    super(message);
    this.name = "EvidenceValidationError";
    this.code = code;
  }
}

function isContentKey(key: string): boolean {
  return key
    .toLowerCase()
    .split(/[_\-.]/)
    .some((segment) => CONTENT_SEGMENTS.has(segment));
}

const isEvidenceKind = (kind: unknown): kind is EvidenceKind =>
  (EVIDENCE_KINDS as readonly unknown[]).includes(kind);

export interface EvidenceStoreOptions {
  clock?: () => string;
  ids?: () => string;
}

/** What `append` accepts; every field is checked at run time. */
export interface EvidenceAppendInput {
  notification_id?: unknown;
  version?: unknown;
  kind?: unknown;
  data?: unknown;
}

export interface EvidenceStore extends EvidenceStorePort {
  readonly kind: "mock-evidence-store";
  size(): number;
  update(...args: unknown[]): never;
  delete(...args: unknown[]): never;
  set(...args: unknown[]): never;
  clear(...args: unknown[]): never;
}

type MutableEntry = Omit<EvidenceEntry, "entry_hash"> & { entry_hash?: string };

export function createEvidenceStore({
  clock = defaultClock,
  ids = defaultIds,
}: EvidenceStoreOptions = {}): EvidenceStore {
  const entries: DeepReadonly<EvidenceEntry>[] = [];
  const lastHash = new Map<string, string>();

  function append(entry: EvidenceAppendInput | null | undefined): DeepReadonly<EvidenceEntry> {
    if (!entry || typeof entry !== "object")
      throw new EvidenceValidationError("INVALID_ENTRY", "entry object required");
    const { notification_id, version, kind, data = {} } = entry;
    if (typeof notification_id !== "string" || !notification_id)
      throw new EvidenceValidationError("INVALID_ID", "notification_id required");
    if (typeof version !== "number" || !Number.isInteger(version) || version < 1)
      throw new EvidenceValidationError("INVALID_VERSION", "version must be an integer >= 1");
    if (!isEvidenceKind(kind))
      throw new EvidenceValidationError("INVALID_KIND", `kind must be one of ${EVIDENCE_KINDS.join(", ")}`);
    if (typeof data !== "object" || Array.isArray(data))
      throw new EvidenceValidationError("INVALID_DATA", "data must be an object");
    const contentKeys = findKeys(data, isContentKey);
    if (contentKeys.length) {
      throw new EvidenceValidationError(
        "CONTENT_NOT_ALLOWED",
        `evidence holds references and hashes only; refused key: ${contentKeys[0]}`,
      );
    }
    const chainKey = `${notification_id}#${version}`;
    const previous_hash = lastHash.get(chainKey) ?? null;
    const stored: MutableEntry = {
      seq: entries.length + 1,
      entry_id: `evd-${ids()}`,
      notification_id,
      version,
      kind,
      recorded_at: clock(),
      data: clone(data as EvidenceData),
      previous_hash,
    };
    stored.entry_hash = sha256Hex(
      `${previous_hash ?? "GENESIS"}|${canonicalJson({ ...stored, previous_hash: undefined })}`,
    );
    const frozen = deepFreeze(stored as EvidenceEntry);
    entries.push(frozen);
    lastHash.set(chainKey, frozen.entry_hash);
    return frozen;
  }

  function list(notificationId: string, version?: number): DeepReadonly<EvidenceEntry>[] {
    return entries.filter(
      (e) => e.notification_id === notificationId && (version === undefined || e.version === version),
    );
  }

  function verify(notificationId: string, version?: number): EvidenceVerification {
    let previous: string | null = null;
    for (const e of list(notificationId, version)) {
      if (e.previous_hash !== previous) return { ok: false, broken_seq: e.seq };
      const expected = sha256Hex(
        `${previous ?? "GENESIS"}|${canonicalJson({ ...e, previous_hash: undefined, entry_hash: undefined })}`,
      );
      if (expected !== e.entry_hash) return { ok: false, broken_seq: e.seq };
      previous = e.entry_hash;
    }
    return { ok: true, broken_seq: null };
  }

  /** Folded, read-only view of one version's evidence (what was issued, by whom, to whom, when, and what happened). */
  function summary(notificationId: string, version: number): DeepReadonly<EvidenceSummary> {
    const own = list(notificationId, version);
    const ctx: EvidenceData = (own.find((e) => e.kind === "ISSUANCE_CONTEXT")?.data ?? {}) as EvidenceData;
    const transitions: EvidenceItem[] = own
      .filter((e) => e.kind === "TRANSITION")
      .map((e) => ({ ...(e.data as EvidenceData), recorded_at: e.recorded_at }));
    const authorized = transitions.find((t) => t.to === "AUTHORIZED");
    const sent = transitions.find((t) => t.to === "SENT");
    const pick = (kind: EvidenceKind): EvidenceData[] =>
      own
        .filter((e) => e.kind === kind)
        .map((e) => ({ ...(e.data as EvidenceData), recorded_at: e.recorded_at }));
    const lastModel =
      [...transitions].reverse().find((t) => t.model_hash)?.model_hash ?? ctx.model_hash ?? null;
    return deepFreeze({
      notification_id: notificationId,
      version,
      originating_event_id: ctx.originating_event_id ?? null,
      source_refs: clone(ctx.source_refs ?? []),
      template: clone(ctx.template ?? null),
      policy_version: ctx.policy_version ?? null,
      idempotency_key: ctx.idempotency_key ?? null,
      recipients: clone(ctx.recipients ?? []),
      corrects: clone(ctx.corrects ?? null),
      model_hash: lastModel,
      authorizer: clone(authorized?.authorizer ?? null),
      issued_at: sent?.at ?? null,
      delivery_attempts: pick("DELIVERY_ATTEMPT"),
      suppressions: pick("SUPPRESSION"),
      corrections: pick("CORRECTION"),
      exports: pick("EXPORT"),
      acknowledgements: pick("ACKNOWLEDGEMENT"),
      exceptions: pick("EXCEPTION"),
      refusals: pick("REFUSAL"),
      transitions,
      entries: own.length,
      chain_ok: verify(notificationId, version).ok,
    } as EvidenceSummary);
  }

  const refuse =
    (op: string) =>
    (..._args: unknown[]): never => {
      throw new EvidenceImmutableError(op);
    };

  return Object.freeze({
    kind: "mock-evidence-store" as const,
    append,
    list,
    summary,
    verify,
    size: () => entries.length,
    update: refuse("UPDATE"),
    delete: refuse("DELETE"),
    set: refuse("SET"),
    clear: refuse("CLEAR"),
  });
}
