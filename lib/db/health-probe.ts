// Database probe behind GET /api/health. One READ ONLY transaction: who the app logged in as, the server version,
// then — as the request role cdf_v13_user — whether it can use its own schema and none of the foreign schemas of the
// shared project; and, as that role, whether the installed request-claims key is the one this deployment derives
// (V13-DB-009, OI-022). Returns booleans, codes and a version number only: no names, no rows, no error text, no key
// material.
import "server-only";
import { createHmac } from "node:crypto";
import { requestClaimsKey } from "@/lib/auth/claims-key";
import { isSessionConfigured } from "@/lib/auth/session";
import { getSql, type Sql } from "./client";

/** true = no USAGE (isolated), false = USAGE granted (not isolated), "absent" = the schema does not exist. */
export type ForeignSchemaIsolation = boolean | "absent";

export const FOREIGN_SCHEMAS = ["auth", "storage", "vault", "cdf"] as const;
export type ForeignSchema = (typeof FOREIGN_SCHEMAS)[number];

export interface DatabaseProbe {
  server_version_num: number;
  /** The connection's session and current user are both cdf_v13_app. */
  login_is_app_role: boolean;
  /** cdf_v13_user has USAGE on cdf_notifications_v13. */
  v13_schema_usage: boolean;
  /** For each foreign schema: true when cdf_v13_user has no USAGE on it. */
  isolated_from: Record<ForeignSchema, ForeignSchemaIsolation>;
  /** Whether the installed claims key is this deployment's (a code only). */
  claims_key: ClaimsKeyState;
}

/**
 * cdf_notifications_v13.claims_key_state (migration 0007), or NOT_CHECKED when this deployment has no usable
 * V13_SESSION_SECRET and so no key to probe with.
 */
export const CLAIMS_KEY_STATES = ["INSTALLED_MATCH", "INSTALLED_MISMATCH", "NOT_INSTALLED"] as const;
export type ClaimsKeyState = (typeof CLAIMS_KEY_STATES)[number] | "NOT_CHECKED";

/** Domain-separated probe label; must equal the literal in migration 0007. Never a valid claims text. */
export const CLAIMS_KEY_PROBE_LABEL = "cdf-v13/claims-key-probe/v1";

/** base64url HMAC-SHA256(key, label|xid), unpadded: the probe claims_key_state checks for this transaction. */
export function claimsKeyProbe(key: Uint8Array, transactionId: string): string {
  if (!/^[0-9]{1,20}$/.test(transactionId)) throw new Error("invalid transaction id");
  return createHmac("sha256", key)
    .update(`${CLAIMS_KEY_PROBE_LABEL}|${transactionId}`, "utf8")
    .digest("base64url");
}

export interface ProbeOptions {
  /** Key to probe with. Default: requestClaimsKey() when V13_SESSION_SECRET is usable, else none (NOT_CHECKED). */
  claimsKey?: Uint8Array | null;
}

function defaultClaimsKey(): Uint8Array | null {
  return isSessionConfigured() ? requestClaimsKey() : null;
}

type UsageState = "usage" | "none" | "absent";

export async function probeDatabase(sql: Sql = getSql(), options: ProbeOptions = {}): Promise<DatabaseProbe> {
  const key = options.claimsKey === undefined ? defaultClaimsKey() : options.claimsKey;
  return (await sql.begin("read only", async (tx) => {
    await tx`set local statement_timeout = 3000`;
    const [who] = await tx<{ current_user: string; session_user: string; server_version_num: string }[]>`
      select current_user as current_user,
             session_user as session_user,
             pg_catalog.current_setting('server_version_num') as server_version_num`;
    await tx`set local role cdf_v13_user`;
    const rows = await tx<{ schema: string; state: UsageState }[]>`
      select s.name as schema,
             case
               when pg_catalog.to_regnamespace(s.name) is null then 'absent'
               when pg_catalog.has_schema_privilege(pg_catalog.to_regnamespace(s.name)::oid, 'USAGE') then 'usage'
               else 'none'
             end as state
        from pg_catalog.unnest(${["cdf_notifications_v13", ...FOREIGN_SCHEMAS]}::text[]) as s(name)`;
    const state = new Map(rows.map((r) => [r.schema, r.state]));
    const isolation = (schema: ForeignSchema): ForeignSchemaIsolation => {
      const s = state.get(schema);
      return s === "absent" ? "absent" : s === "none";
    };
    let claimsKey: ClaimsKeyState = "NOT_CHECKED";
    if (key) {
      const [x] = await tx<{ xid: string }[]>`select pg_catalog.pg_current_xact_id()::text as xid`;
      const [k] = await tx<{ state: string }[]>`
        select cdf_notifications_v13.claims_key_state(${claimsKeyProbe(key, x!.xid)}) as state`;
      const state = k?.state;
      if (!CLAIMS_KEY_STATES.some((known) => known === state)) throw new Error("unexpected claims key state");
      claimsKey = state as ClaimsKeyState;
    }
    return {
      server_version_num: Number(who?.server_version_num),
      login_is_app_role: who?.current_user === "cdf_v13_app" && who?.session_user === "cdf_v13_app",
      v13_schema_usage: state.get("cdf_notifications_v13") === "usage",
      isolated_from: {
        auth: isolation("auth"),
        storage: isolation("storage"),
        vault: isolation("vault"),
        cdf: isolation("cdf"),
      },
      claims_key: claimsKey,
    };
  })) as DatabaseProbe;
}

export type ProbeStatus = "ok" | "ISOLATION_FAILED" | "CLAIMS_KEY_MISMATCH" | "CLAIMS_KEY_NOT_INSTALLED";

/**
 * Isolation first (right login, own schema usable, no foreign schema usable), then the claims key: another key or none
 * means every request context fails closed, so health is degraded. NOT_CHECKED (no session secret) does not degrade:
 * such a deployment serves no signed-in request anyway.
 */
export function probeStatus(probe: DatabaseProbe): ProbeStatus {
  const isolated =
    probe.login_is_app_role &&
    probe.v13_schema_usage &&
    Object.values(probe.isolated_from).every((isolated) => isolated !== false);
  if (!isolated) return "ISOLATION_FAILED";
  if (probe.claims_key === "INSTALLED_MISMATCH") return "CLAIMS_KEY_MISMATCH";
  if (probe.claims_key === "NOT_INSTALLED") return "CLAIMS_KEY_NOT_INSTALLED";
  return "ok";
}

/** The probe passed: isolation holds and the claims key is not wrong or missing. */
export function isProbeHealthy(probe: DatabaseProbe): boolean {
  return probeStatus(probe) === "ok";
}
