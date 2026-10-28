// Connection targets of the database integration suites and the reachability gate.
//
//   primary     the db:reset target (V13_ADMIN_DATABASE_URL, default postgres@127.0.0.1:54329/v13_local): migrations
//               and seed applied by `pnpm db:reset`; the app login cdf_v13_app has the local-only password.
//   hosted-sim  a second cluster whose bootstrap superuser is supabase_admin (V13_HOSTED_SIM_SUPERUSER_URL, default
//               supabase_admin@127.0.0.1:54330/postgres). The suites rebuild a Supabase-like layout there, with a
//               NON-superuser administrator `postgres`, before every scenario.
//
// When a cluster is unreachable its suites are skipped with a message, unless V13_DB_TESTS_REQUIRED=1 (CI), where
// that is a failure. LOCAL AND CI ONLY: every URL here must be a loopback address.
import {
  adminUrl,
  connect,
  describeUrl,
  isLoopbackUrl,
  withCredentials,
} from "@/scripts/db/lib/migrations.mjs";
import { localHostedSimPort } from "@/scripts/db/local-pg.mjs";
import { DEFAULT_LOCAL_APP_PASSWORD } from "@/scripts/db/reset-local.mjs";

export const DB_TESTS_REQUIRED = process.env.V13_DB_TESTS_REQUIRED === "1";

/** Administrator of the primary cluster, database v13_local. */
export const PRIMARY_ADMIN_URL = adminUrl();

/** cdf_v13_app on the primary cluster with the local-only password set by db:reset (not a secret). */
export const PRIMARY_APP_URL = withCredentials(
  PRIMARY_ADMIN_URL,
  "cdf_v13_app",
  process.env.V13_LOCAL_APP_PASSWORD || DEFAULT_LOCAL_APP_PASSWORD,
);

/** Bootstrap superuser of the hosted simulation, maintenance database. */
export const HOSTED_SIM_SUPERUSER_URL =
  process.env.V13_HOSTED_SIM_SUPERUSER_URL?.trim() ||
  `postgres://supabase_admin@127.0.0.1:${localHostedSimPort()}/postgres`;

for (const url of [PRIMARY_ADMIN_URL, HOSTED_SIM_SUPERUSER_URL]) {
  if (!isLoopbackUrl(url))
    throw new Error(`integration tests run against loopback clusters only: ${describeUrl(url)}`);
}

/** SQLSTATE or error name only; never the message (it can carry connection details). */
export function errorCodeOf(error: unknown): string {
  const e = error as { code?: unknown; name?: unknown } | null;
  return typeof e?.code === "string" ? e.code : typeof e?.name === "string" ? e.name : "UNKNOWN";
}

/**
 * True when the cluster answers. Otherwise: throws under V13_DB_TESTS_REQUIRED=1, else warns and returns false so the
 * suite can skip itself.
 */
export async function clusterAvailable(name: string, url: string): Promise<boolean> {
  const sql = connect(url, "cdf-v13-tests");
  try {
    await sql`select 1`;
    return true;
  } catch (error) {
    const reason = `${name} cluster not reachable at ${describeUrl(url)} (${errorCodeOf(error)})`;
    if (DB_TESTS_REQUIRED) throw new Error(`${reason}; V13_DB_TESTS_REQUIRED=1 makes this a failure`);
    console.warn(
      `[integration] skipping ${name} suites: ${reason}. Run pnpm db:local start && pnpm db:reset.`,
    );
    return false;
  } finally {
    await sql.end({ timeout: 1 });
  }
}
