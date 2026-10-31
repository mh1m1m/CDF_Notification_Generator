// Request contexts for the database integration suites (synthetic personas of the M1 seed only).
//
//   asPersona   the real path: lib/db/security-context.ts as cdf_v13_app, with the synthetic test key.
//   asRaw       a hand-built context for negative tests: any claims text and any MAC (or none), then the request role.
//   asOwner     cdf_v13_owner inside a transaction on the administrator connection (catalog reads, tamper scenarios).
// Every helper runs one transaction; asRaw and asOwner can force a rollback so nothing they do survives.
import postgres from "postgres";
import { RequestIdentitySchema, type RoleCode, type WorkspaceCode } from "@/lib/contracts";
import { databaseClientOptions } from "@/lib/db/client";
import { claimsMac, withRequestContext, type Tx } from "@/lib/db/security-context";
import { connect } from "@/scripts/db/lib/migrations.mjs";
import { TEST_CLAIMS_KEY } from "./claims";
import { PRIMARY_ADMIN_URL, PRIMARY_APP_URL } from "./clusters";

export const PERSONA = {
  alpha: "0b000000-0000-4000-8000-000000000001",
  beta: "0b000000-0000-4000-8000-000000000002",
  gamma: "0b000000-0000-4000-8000-000000000003",
  delta: "0b000000-0000-4000-8000-000000000004",
  epsilon: "0b000000-0000-4000-8000-000000000005",
  zeta: "0b000000-0000-4000-8000-000000000006",
  /** Not in the seed. */
  unknown: "0b000000-0000-4000-8000-0000000000ff",
} as const;

export const WORKSPACE = {
  SECRETARIAT: "0a000000-0000-4000-8000-000000000001",
  INVESTIGATIONS: "0a000000-0000-4000-8000-000000000002",
  GOVERNANCE: "0a000000-0000-4000-8000-000000000003",
} as const;

export const CORRELATION = "6f1c2a9e-3b7d-4c1e-9a2f-0d8e7b6a5c41";

/** One connection, so every transaction reuses it (the pooled-connection case). */
export function appClient(): postgres.Sql {
  return postgres(PRIMARY_APP_URL, { ...databaseClientOptions(PRIMARY_APP_URL, {}), max: 1 });
}

export function adminClient(): postgres.Sql {
  return connect(PRIMARY_ADMIN_URL, "cdf-v13-tests");
}

/**
 * Runs `fn` through withRequestContext. `roles` only satisfies the app-side contract; the database ignores it and
 * derives roles from its membership rows, which is exactly what these suites check.
 */
export function asPersona<T>(
  sql: postgres.Sql,
  persona: string,
  workspace: WorkspaceCode,
  fn: (tx: Tx) => Promise<T>,
  roles: RoleCode[] = ["COMMITTEE_SECRETARY"],
): Promise<T> {
  const identity = RequestIdentitySchema.parse({ persona_id: persona, active_workspace: workspace, roles });
  return withRequestContext(identity, fn, { sql, correlationId: CORRELATION, claimsKey: TEST_CLAIMS_KEY });
}

/** The v1 claims text for a persona and a workspace id, in the app's key order. */
export function claimsText(persona: string, workspaceId: string, correlation = CORRELATION): string {
  return JSON.stringify({
    v: 1,
    persona_id: persona,
    workspace_id: workspaceId,
    correlation_id: correlation,
  });
}

export interface RawContext {
  /** request.v13.claims; omitted = not set. */
  claims?: string;
  /**
   * request.v13.claims_mac: a fixed string, "valid" (MAC of `macOver` or `claims` for this transaction), or omitted.
   */
  mac?: string | "valid";
  /** Text the MAC is computed over when mac = "valid" (default: claims). */
  macOver?: string;
  /** Transaction id the MAC is computed for when mac = "valid" (default: this transaction's). */
  macXid?: string;
}

/** A hand-built request context as cdf_v13_app → cdf_v13_user. Always rolls back. */
export async function asRaw<T>(sql: postgres.Sql, ctx: RawContext, fn: (tx: Tx) => Promise<T>): Promise<T> {
  let result: T | undefined;
  await sql
    .begin(async (tx) => {
      const [row] = await tx<{ xid: string }[]>`select pg_catalog.pg_current_xact_id()::text as xid`;
      const xid = ctx.macXid ?? row!.xid;
      const mac =
        ctx.mac === "valid" ? claimsMac(TEST_CLAIMS_KEY, ctx.macOver ?? ctx.claims ?? "", xid) : ctx.mac;
      if (ctx.claims !== undefined)
        await tx`select pg_catalog.set_config('request.v13.claims', ${ctx.claims}, true)`;
      if (mac !== undefined) await tx`select pg_catalog.set_config('request.v13.claims_mac', ${mac}, true)`;
      await tx`select pg_catalog.set_config('role', 'cdf_v13_user', true)`;
      result = await fn(tx);
      throw new Rollback();
    })
    .catch((error: unknown) => {
      if (!(error instanceof Rollback)) throw error;
    });
  return result as T;
}

/** cdf_v13_owner on the administrator connection. `rollback` (default true) discards everything it did. */
export async function asOwner<T>(
  sql: postgres.Sql,
  fn: (tx: Tx) => Promise<T>,
  { rollback = true }: { rollback?: boolean } = {},
): Promise<T> {
  let result: T | undefined;
  await sql
    .begin(async (tx) => {
      await tx.unsafe("set local role cdf_v13_owner");
      result = await fn(tx);
      if (rollback) throw new Rollback();
    })
    .catch((error: unknown) => {
      if (!(error instanceof Rollback)) throw error;
    });
  return result as T;
}

class Rollback extends Error {}

/** True when the identity tables and the identity seed are present (V13-DB-001, V13-DB-005 part 1). */
export async function identitySeedPresent(admin: postgres.Sql): Promise<boolean> {
  try {
    return await asOwner(admin, async (tx) => {
      const [t] = await tx<{ present: boolean }[]>`
        select pg_catalog.to_regclass('cdf_notifications_v13.persona_workspace_membership') is not null as present`;
      if (!t?.present) return false;
      const [p] = await tx<{ present: boolean }[]>`
        select exists (select 1 from cdf_notifications_v13.persona where code = 'SECRETARY_ALPHA') as present`;
      return Boolean(p?.present);
    });
  } catch {
    return false;
  }
}
