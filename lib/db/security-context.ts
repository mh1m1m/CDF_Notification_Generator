// Per-transaction database security context (ADR-003, ADR-014).
//
// Each unit of work runs in ONE transaction that, in a single statement, sets three transaction-local settings:
//   request.v13.claims      {"v":1,"persona_id":"<uuid>","workspace_id":"<uuid>","correlation_id":"<uuid>"}
//   request.v13.claims_mac  base64url(HMAC-SHA256(K, claims || "|" || pg_current_xact_id())), no padding
//   role                    cdf_v13_user   (set_config('role', …, true) is SET LOCAL ROLE)
// K is the claims key (lib/auth/claims-key.ts, HKDF of V13_SESSION_SECRET); it is never sent in a request, only once
// to cdf_notifications_v13.api_install_claims_key. The database verifies the MAC in every claims helper and treats a
// missing, forged, rewritten or replayed claim as "nobody" (migration 0001). The transaction id is read inside the
// same transaction, so a MAC is valid for that transaction only. No roles are sent: the database derives them from its
// membership rows. All settings end with the transaction, so nothing leaks to the next request on a pooled connection.
// Values are bound parameters, never concatenated SQL.
//
// PRODUCTION_SUBSTITUTION_REQUIRED: production (ASP.NET Core on Alibaba Cloud) sets the same settings from a token
// issued by the CDF corporate identity provider, with the key held in KMS.
import "server-only";
import { createHash, createHmac } from "node:crypto";
import type postgres from "postgres";
import { requestClaimsKey } from "@/lib/auth/claims-key";
import {
  CorrelationIdSchema,
  RequestIdentitySchema,
  WORKSPACE_IDS,
  type RequestIdentity,
} from "@/lib/contracts";
import { getSql, type Sql } from "./client";

export type Tx = postgres.TransactionSql;

export const REQUEST_ROLE = "cdf_v13_user";
export const CLAIMS_SETTING = "request.v13.claims";
export const CLAIMS_MAC_SETTING = "request.v13.claims_mac";
export const CLAIMS_VERSION = 1;

export interface RequestContextOptions {
  /** Correlation id of the request (default: a new random UUID). */
  correlationId?: string;
  /** Client to use (default: the shared client from client.ts). */
  sql?: Sql;
  /** Claims key (default: requestClaimsKey() from V13_SESSION_SECRET). Tests pass a synthetic key. */
  claimsKey?: Uint8Array;
}

/** Refused key install: the database holds a different key (rotation needs database/hosted/reset_claims_key.sql). */
export class ClaimsKeyError extends Error {
  override readonly name = "ClaimsKeyError";
  readonly code = "CLAIMS_KEY_MISMATCH";
}

/** The claims JSON for an identity, keys in this order: v, persona_id, workspace_id, correlation_id. */
export function requestClaims(identity: RequestIdentity, correlationId: string): string {
  const verified = RequestIdentitySchema.parse(identity);
  return JSON.stringify({
    v: CLAIMS_VERSION,
    persona_id: verified.persona_id,
    workspace_id: WORKSPACE_IDS[verified.active_workspace],
    correlation_id: CorrelationIdSchema.parse(correlationId),
  });
}

/** base64url (no padding) HMAC-SHA256 over `claims|xid`, exactly as the database recomputes it. */
export function claimsMac(key: Uint8Array, claims: string, transactionId: string): string {
  if (!/^[0-9]{1,20}$/.test(transactionId)) throw new Error("invalid transaction id");
  return createHmac("sha256", key).update(`${claims}|${transactionId}`, "utf8").digest("base64url");
}

// One install per client and key per process. A failed install is forgotten so the next request retries.
const installed = new WeakMap<Sql, Map<string, Promise<void>>>();

/**
 * Installs the claims key once (api_install_claims_key: INSTALLED, or ALREADY_INSTALLED for the same key). Call it at
 * server start, before any traffic (ADR-014 residual); withRequestContext also awaits it. Never logs the key.
 */
export function ensureClaimsKey(sql: Sql, key: Uint8Array): Promise<void> {
  const fingerprint = createHash("sha256").update(key).digest("hex");
  let perClient = installed.get(sql);
  if (!perClient) {
    perClient = new Map();
    installed.set(sql, perClient);
  }
  const existing = perClient.get(fingerprint);
  if (existing) return existing;
  const attempt = (async () => {
    try {
      await sql.begin(async (tx) => {
        await tx`select pg_catalog.set_config('role', ${REQUEST_ROLE}, true)`;
        const [row] = await tx<{ result: string }[]>`
          select cdf_notifications_v13.api_install_claims_key(${Buffer.from(key)}) as result`;
        if (row?.result !== "INSTALLED" && row?.result !== "ALREADY_INSTALLED") {
          throw new ClaimsKeyError("claims key install returned no result");
        }
      });
    } catch (error) {
      perClient.delete(fingerprint);
      if ((error as { code?: unknown } | null)?.code === "V1409") {
        throw new ClaimsKeyError("the database holds a different claims key");
      }
      throw error;
    }
  })();
  perClient.set(fingerprint, attempt);
  return attempt;
}

/** Runs `fn(tx)` as cdf_v13_user with the identity's authenticated claims. Invalid identities fail before any SQL. */
export async function withRequestContext<T>(
  identity: RequestIdentity,
  fn: (tx: Tx) => Promise<T>,
  options: RequestContextOptions = {},
): Promise<T> {
  const claims = requestClaims(identity, options.correlationId ?? crypto.randomUUID());
  const key = options.claimsKey ?? requestClaimsKey();
  const sql = options.sql ?? getSql();
  await ensureClaimsKey(sql, key);
  return sql.begin(async (tx) => {
    const [row] = await tx<{ xid: string }[]>`select pg_catalog.pg_current_xact_id()::text as xid`;
    if (!row?.xid) throw new Error("no transaction id");
    const mac = claimsMac(key, claims, row.xid);
    await tx`
      select pg_catalog.set_config('request.v13.claims', ${claims}, true),
             pg_catalog.set_config('request.v13.claims_mac', ${mac}, true),
             pg_catalog.set_config('role', ${REQUEST_ROLE}, true)`;
    return fn(tx);
  }) as Promise<T>;
}
