// Per-transaction database security context.
//
// Each unit of work runs in ONE transaction that first records the verified request identity as the
// transaction-local setting `request.v13.claims` and then assumes the request role with SET LOCAL ROLE
// cdf_v13_user. The claims are exactly
//   {"v":1,"persona_id":"<uuid>","workspace_id":"<uuid>","correlation_id":"<uuid>"}
// with no roles: the database derives roles from its membership rows and re-checks persona and membership on every
// call (cdf_notifications_v13.current_persona_id(), current_workspace_id(), current_role_codes()). Both settings end
// with the transaction, so nothing leaks to the next request that reuses the pooled connection. Values are bound
// parameters, never concatenated SQL.
//
// ADR-014 (claims MAC, built by DB in V13-DB-001) will add a second transaction-local setting here that
// authenticates the claims.
//
// PRODUCTION_SUBSTITUTION_REQUIRED: production (ASP.NET Core on Alibaba Cloud) sets the same settings from a token
// issued by the CDF corporate identity provider.
import "server-only";
import type postgres from "postgres";
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
export const CLAIMS_VERSION = 1;

export interface RequestContextOptions {
  /** Correlation id of the request (default: a new random UUID). */
  correlationId?: string;
  /** Client to use (default: the shared client from client.ts). */
  sql?: Sql;
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

/** Runs `fn(tx)` as cdf_v13_user with the identity's claims. Invalid identities are refused before any SQL. */
export async function withRequestContext<T>(
  identity: RequestIdentity,
  fn: (tx: Tx) => Promise<T>,
  options: RequestContextOptions = {},
): Promise<T> {
  const claims = requestClaims(identity, options.correlationId ?? crypto.randomUUID());
  const sql = options.sql ?? getSql();
  return sql.begin(async (tx) => {
    await tx`select pg_catalog.set_config('request.v13.claims', ${claims}, true)`;
    await tx`set local role cdf_v13_user`;
    return fn(tx);
  }) as Promise<T>;
}
