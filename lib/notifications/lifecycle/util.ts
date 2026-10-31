/**
 * CDF Notifications V13 — small pure helpers shared by the W-D1 modules (consistency engine, lifecycle,
 * evidence store, platform adapters).
 * Classification: SYNTHETIC-DATA REFERENCE IMPLEMENTATION — not CDF production. node:crypto only.
 * Ported from the V13 reference package (src/lifecycle/util.js) to strict TypeScript; behaviour unchanged.
 */
import "server-only";
import { createHash, randomUUID } from "node:crypto";

/** Deeply read-only view of a plain-data type (what deepFreeze hands out). Functions are left as they are. */
export type DeepReadonly<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends readonly (infer U)[]
    ? ReadonlyArray<DeepReadonly<U>>
    : T extends object
      ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
      : T;

/** Lower-case UUID (the platform keys every row by uuid; display numbers are never keys — CLAUDE.md §87). */
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Opaque identifier: no whitespace, no '@', no '|' (keys and ledgers never carry addresses or labels — W4-05, MF-038). */
export const OPAQUE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

/** Reason / action codes. Mirrors audit.audit_event.action check `^[A-Z][A-Z_]{2,63}$` (20261007000300_authz_core_and_audit.sql:149). */
export const CODE = /^[A-Z][A-Z0-9_]{2,63}$/;

/** Recursively freezes a plain-data value (functions are left as they are). Returns the same value. */
export function deepFreeze<T>(value: T, seen: WeakSet<object> = new WeakSet()): DeepReadonly<T> {
  if (value === null || typeof value !== "object" || seen.has(value)) return value as DeepReadonly<T>;
  seen.add(value);
  for (const key of Reflect.ownKeys(value)) deepFreeze((value as Record<PropertyKey, unknown>)[key], seen);
  return Object.freeze(value) as DeepReadonly<T>;
}

/** Deep copy of plain data (never functions). */
export function clone<T>(value: T): T {
  return value === undefined ? (undefined as T) : structuredClone(value);
}

/** Deterministic JSON: object keys sorted, `undefined` members dropped. Used for hashes, never for display. */
export function canonicalJson(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") {
    if (typeof value === "number" && !Number.isFinite(value))
      throw new TypeError("canonicalJson: non-finite number");
    if (typeof value === "function" || typeof value === "symbol" || typeof value === "bigint") {
      throw new TypeError(`canonicalJson: unsupported ${typeof value}`);
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value))
    return `[${value.map((v: unknown) => canonicalJson(v === undefined ? null : v)).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(",")}}`;
}

export const sha256Hex = (text: string): string => createHash("sha256").update(text, "utf8").digest("hex");

/** sha-256 of the canonical JSON of a value (e.g. the projected model: proves what was rendered without storing it). */
export const hashOf = (value: unknown): string => sha256Hex(canonicalJson(value));

export const defaultIds = (): string => randomUUID();
export const defaultClock = (): string => new Date().toISOString();

/**
 * Keys that must never appear in ledger payloads. Mirrors FORBIDDEN_METADATA_KEY in
 * packages/audit/src/index.ts:31-32 (substring match, case-insensitive) — §83: never log identities, credentials or content.
 */
export const FORBIDDEN_PAYLOAD_KEY =
  /(name|email|phone|password|secret|token|identity|description|body|content)/i;

/** Returns the paths of all object keys (recursively) whose name matches `test(key)`. */
export function findKeys(value: unknown, test: (key: string) => boolean, path = ""): string[] {
  const found: string[] = [];
  if (value === null || typeof value !== "object") return found;
  if (Array.isArray(value)) {
    value.forEach((v: unknown, i) => found.push(...findKeys(v, test, `${path}[${i}]`)));
    return found;
  }
  const obj = value as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    const p = path ? `${path}.${key}` : key;
    if (test(key)) found.push(p);
    found.push(...findKeys(obj[key], test, p));
  }
  return found;
}
