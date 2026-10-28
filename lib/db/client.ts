// The single PostgreSQL client of the V13 web app (server-only). Database access anywhere in the app goes through
// lib/db; nothing else imports the postgres driver (eslint.config.mjs).
//
// The app logs in as cdf_v13_app, a NOINHERIT login with no object privileges of its own; every unit of work runs
// in a transaction that first assumes cdf_v13_user (security-context.ts).
//
// PRODUCTION_SUBSTITUTION_REQUIRED: the prototype connects to the shared Supabase project through Supavisor
// (transaction mode) with sslmode=require. Production connects to a dedicated database on Alibaba Cloud RDS
// PostgreSQL (Riyadh) with full certificate verification against the CDF CA, credentials issued from KMS.
import "server-only";
import postgres from "postgres";

export type Sql = postgres.Sql;

type Env = Readonly<Record<string, string | undefined>>;

export class DatabaseConfigError extends Error {
  override readonly name = "DatabaseConfigError";
  readonly code = "DB_NOT_CONFIGURED";
}

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const DEFAULT_POOL_MAX = 3;
const MAX_POOL_MAX = 20;

export function isDatabaseConfigured(env: Env = process.env): boolean {
  return Boolean(env.V13_DATABASE_URL?.trim());
}

function poolMax(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === "") return DEFAULT_POOL_MAX;
  // Plain decimal digits only ("1e1", "0x5" and "5.0" are refused rather than coerced).
  const value = /^\d{1,2}$/.test(raw.trim()) ? Number(raw.trim()) : Number.NaN;
  if (!Number.isInteger(value) || value < 1 || value > MAX_POOL_MAX) {
    throw new DatabaseConfigError(`V13_DB_POOL_MAX must be an integer between 1 and ${MAX_POOL_MAX}`);
  }
  return value;
}

/** Driver options for a connection URL. Exported for tests; never logs or returns the URL itself. */
export function databaseClientOptions(url: string, env: Env = process.env) {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new DatabaseConfigError("V13_DATABASE_URL is not a valid URL");
  }
  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    throw new DatabaseConfigError("V13_DATABASE_URL must be a postgres:// or postgresql:// URL");
  }
  return {
    max: poolMax(env.V13_DB_POOL_MAX),
    // Supavisor transaction mode cannot keep prepared statements across transactions.
    prepare: false,
    idle_timeout: 20,
    connect_timeout: 10,
    ssl: LOOPBACK_HOSTS.has(parsed.hostname) ? (false as const) : ("require" as const),
    connection: { application_name: "cdf-v13-enterprise" },
    // Server notices can carry data; never echo them.
    onnotice: () => undefined,
  } satisfies postgres.Options<Record<string, postgres.PostgresType>>;
}

let client: Sql | undefined;

/** The shared client, created on first use. Throws DatabaseConfigError when V13_DATABASE_URL is missing. */
export function getSql(env: Env = process.env): Sql {
  if (client) return client;
  const url = env.V13_DATABASE_URL?.trim();
  if (!url) throw new DatabaseConfigError("V13_DATABASE_URL is not set");
  client = postgres(url, databaseClientOptions(url, env));
  return client;
}

/** Closes the shared client (tests and graceful shutdown). */
export async function closeSql(): Promise<void> {
  const current = client;
  client = undefined;
  await current?.end({ timeout: 5 });
}
