// Database probe behind GET /api/health. One READ ONLY transaction: who the app logged in as, the server version,
// then — as the request role cdf_v13_user — whether it can use its own schema and none of the foreign schemas of the
// shared project. Returns booleans and a version number only: no names, no rows, no error text.
import "server-only";
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
}

type UsageState = "usage" | "none" | "absent";

export async function probeDatabase(sql: Sql = getSql()): Promise<DatabaseProbe> {
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
    };
  })) as DatabaseProbe;
}

/** The probe passed: right login, own schema usable, no foreign schema usable. */
export function isProbeHealthy(probe: DatabaseProbe): boolean {
  return (
    probe.login_is_app_role &&
    probe.v13_schema_usage &&
    Object.values(probe.isolated_from).every((isolated) => isolated !== false)
  );
}
