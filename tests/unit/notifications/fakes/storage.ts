/**
 * PRODUCTION_SUBSTITUTION_REQUIRED: in-memory test double
 *
 * storage — storage adapter with a classification gate (W-D1, charter §10; SEC "storage controls").
 * Classification: SYNTHETIC-DATA REFERENCE IMPLEMENTATION — not CDF production.
 *
 * Why: V12 persisted the full case context (names, e-mail addresses, references, event ledger) and the issuance log in
 * browser localStorage without expiry (W4-04 / MF-042; generator/source/ui_v9.js:8, :14-15), silently (W4-19 / MF-075).
 *
 * Modes
 *   DEMO_BROWSER_STORAGE — the Web Storage API shape (getItem/setItem/removeItem/key/length; window.localStorage or
 *     sessionStorage in a browser, an in-memory shim in Node). Accepts PUBLIC values only; INTERNAL and RESTRICTED are
 *     refused, a missing classification is refused (fail closed), identity-like keys and e-mail-like values are refused
 *     even when labelled PUBLIC (defence in depth; key list mirrors packages/audit/src/index.ts:31-32), every entry
 *     expires (default 8 h), and backend failures are raised, never swallowed.
 *   CONTROLLED_STORE — a labelled in-memory MOCK of a controlled server-side store. PRODUCTION_SUBSTITUTION_REQUIRED:
 *     production uses the platform's private storage behind the EvidenceStorage port
 *     (packages/application/src/ports.ts:93-102: exclusive create, never overwrite) or database tables under RLS
 *     (CLAUDE.md §24-§27; OSS + KMS in the Alibaba target). It accepts PUBLIC, INTERNAL and RESTRICTED with the label kept.
 * Ported to strict TypeScript from the V13 reference (src/lifecycle/adapters/storage.js); behaviour unchanged.
 */
import { defaultClock, findKeys, FORBIDDEN_PAYLOAD_KEY } from "@/lib/notifications/lifecycle/util";
import { parseInstant } from "@/lib/notifications/lifecycle/idempotency";

export const STORAGE_MODES = Object.freeze(["DEMO_BROWSER_STORAGE", "CONTROLLED_STORE"] as const);
export const CLASSIFICATIONS = Object.freeze(["PUBLIC", "INTERNAL", "RESTRICTED"] as const);
export type StorageMode = (typeof STORAGE_MODES)[number];
export type StorageClassification = (typeof CLASSIFICATIONS)[number];
const EMAIL_LIKE = /[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+/;
const KEY = /^[a-z0-9][a-z0-9:._-]{0,127}$/;
const PREFIX = "cdf-v13:";

export class StorageRefusedError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "StorageRefusedError";
    this.code = code;
  }
}

/** The Web Storage API subset the adapter uses. */
export interface WebStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  key(index: number): string | null;
  readonly length: number;
}

/** Minimal in-memory Web Storage shim (getItem / setItem / removeItem / key / length). */
export function createMemoryWebStorage(): WebStorageLike {
  const m = new Map<string, string>();
  return {
    getItem: (k) => (m.has(k) ? (m.get(k) ?? null) : null),
    setItem: (k, v) => void m.set(k, String(v)),
    removeItem: (k) => void m.delete(k),
    key: (i) => [...m.keys()][i] ?? null,
    get length() {
      return m.size;
    },
  };
}

function containsEmailLike(value: unknown): boolean {
  if (typeof value === "string") return EMAIL_LIKE.test(value);
  if (value && typeof value === "object") return Object.values(value).some(containsEmailLike);
  return false;
}

export interface StorageOptions {
  mode?: unknown;
  backend?: WebStorageLike;
  clock?: () => string;
  ttlMs?: number;
}

export interface PutResult {
  key: string;
  classification: StorageClassification;
  expires_at: string | null;
  label: string;
}

export interface GetResult {
  value: unknown;
  classification: StorageClassification;
  label: string;
  expires_at: string | null;
}

interface StoredRecord {
  v: unknown;
  classification: StorageClassification;
  stored_at: string;
  expires_at: string | null;
  label: string;
}

export interface Storage {
  readonly kind: "demo-browser-storage" | "controlled-store-mock";
  readonly mode: StorageMode;
  readonly production_substitution_required: true;
  put(key: unknown, value: unknown, options?: { classification?: unknown }): PutResult;
  get(key: string): GetResult | null;
  remove(key: string): void;
  keys(): string[];
}

export function createStorage({
  mode,
  backend,
  clock = defaultClock,
  ttlMs = 8 * 3600 * 1000,
}: StorageOptions = {}): Storage {
  if (!(STORAGE_MODES as readonly unknown[]).includes(mode))
    throw new StorageRefusedError("MODE_REQUIRED", `mode must be one of ${STORAGE_MODES.join(", ")}`);
  if (!Number.isInteger(ttlMs) || ttlMs < 1) throw new RangeError("ttlMs must be a positive integer");
  const demo = mode === "DEMO_BROWSER_STORAGE";
  const store = backend ?? createMemoryWebStorage();

  function call<T>(fn: () => T): T {
    try {
      return fn();
    } catch (err) {
      // Never silent (W4-19): the caller learns the write failed; the error carries no value.
      throw new StorageRefusedError(
        "BACKEND_ERROR",
        `storage backend failed (${(err as { name?: string } | null)?.name ?? "Error"})`,
      );
    }
  }

  function put(
    key: unknown,
    value: unknown,
    { classification }: { classification?: unknown } = {},
  ): PutResult {
    if (typeof key !== "string" || !KEY.test(key))
      throw new StorageRefusedError("INVALID_KEY", "storage keys are lower-case ids");
    if (!(CLASSIFICATIONS as readonly unknown[]).includes(classification)) {
      throw new StorageRefusedError(
        "CLASSIFICATION_REQUIRED",
        "every stored value declares PUBLIC, INTERNAL or RESTRICTED",
      );
    }
    const cls = classification as StorageClassification;
    if (demo) {
      if (cls !== "PUBLIC") {
        throw new StorageRefusedError(
          "CLASSIFICATION_NOT_ALLOWED",
          `${cls} content is never persisted in DEMO_BROWSER_STORAGE (W4-04 / MF-042)`,
        );
      }
      const keys = findKeys(value, (k) => FORBIDDEN_PAYLOAD_KEY.test(k) || /address|recipient/i.test(k));
      if (keys.length || containsEmailLike(value)) {
        throw new StorageRefusedError(
          "PERSONAL_DATA_NOT_ALLOWED",
          "identities and addresses are never persisted in browser storage",
        );
      }
    }
    const now = clock();
    const record: StoredRecord = {
      v: value,
      classification: cls,
      stored_at: now,
      expires_at: demo ? new Date(parseInstant(now) + ttlMs).toISOString() : null,
      label: demo ? "DEMO_BROWSER_STORAGE" : "CONTROLLED_STORE (mock) — PRODUCTION_SUBSTITUTION_REQUIRED",
    };
    call(() => store.setItem(PREFIX + key, JSON.stringify(record)));
    return { key, classification: cls, expires_at: record.expires_at, label: record.label };
  }

  function get(key: string): GetResult | null {
    const raw = call(() => store.getItem(PREFIX + key));
    if (raw === null || raw === undefined) return null;
    const record = JSON.parse(raw) as StoredRecord;
    if (record.expires_at && parseInstant(clock()) >= parseInstant(record.expires_at)) {
      call(() => store.removeItem(PREFIX + key));
      return null;
    }
    return {
      value: record.v,
      classification: record.classification,
      label: record.label,
      expires_at: record.expires_at,
    };
  }

  function keys(): string[] {
    const out: string[] = [];
    for (let i = 0; i < store.length; i += 1) {
      const k = store.key(i);
      if (k && k.startsWith(PREFIX)) out.push(k.slice(PREFIX.length));
    }
    return out;
  }

  return Object.freeze({
    kind: demo ? ("demo-browser-storage" as const) : ("controlled-store-mock" as const),
    mode: mode as StorageMode,
    production_substitution_required: true as const,
    put,
    get,
    remove: (key: string) => call(() => store.removeItem(PREFIX + key)),
    keys,
  });
}
