// @ts-check
// Migration files, checksums and connection helpers shared by the database scripts.
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
export const MIGRATIONS_DIR = join(ROOT, "database", "migrations");
export const SEED_DIR = join(ROOT, "database", "seed");

/** NNNN_name.sql — four-digit version, lower-snake name. */
export const MIGRATION_FILE_PATTERN = /^\d{4}_[a-z0-9_]+\.sql$/;
/** The name part must satisfy the check on cdf_notifications_v13.schema_migrations.name (0000_bootstrap.sql). */
export const MIGRATION_NAME_PATTERN = /^[a-z0-9_]{3,80}$/;

export const V13_SCHEMA = "cdf_notifications_v13";
export const V13_OWNER = "cdf_v13_owner";
export const V13_APP = "cdf_v13_app";
export const V13_USER = "cdf_v13_user";
export const V13_ROLES = [V13_OWNER, V13_APP, V13_USER];
export const LOCAL_DATABASE = "v13_local";

/** Lock wait limit inside each migration transaction: never queue behind other systems' locks for long. */
export const MIGRATION_LOCK_TIMEOUT = "5s";

/**
 * Every runner (migrate.mjs and the hosted bundle) serialises on this advisory lock: the V13 namespace
 * hashtext('cdf_notifications_v13'), which no other application uses, with key 0, reserved for schema migrations.
 * Keys 1 (audit chain) and 2 (claims key) are taken by the migrations themselves.
 */
export const MIGRATION_LOCK_KEY = 0;
export const MIGRATION_LOCK_SQL = `select pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('cdf_notifications_v13'), ${MIGRATION_LOCK_KEY})`;

/**
 * @typedef {{ file: string, path: string, version: string, name: string, sql: string, checksum: string }} MigrationFile
 */

/** @param {Buffer | string} content */
export function sha256(content) {
  return createHash("sha256").update(content).digest("hex");
}

/**
 * Names of the regular, non-hidden files in a directory (sorted). Missing directory → [].
 * @param {string} dir
 */
export function listFiles(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => !f.startsWith(".") && statSync(join(dir, f)).isFile())
    .sort();
}

export class MigrationSetError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = "MigrationSetError";
  }
}

/**
 * Reads the migration set and verifies its shape: valid names, versions 0000…N without gaps or duplicates.
 * Throws MigrationSetError otherwise (the linter reports the same problems in detail).
 * @param {string} [dir]
 * @returns {MigrationFile[]}
 */
export function readMigrations(dir = MIGRATIONS_DIR) {
  const files = listFiles(dir);
  const bad = files.filter((f) => !MIGRATION_FILE_PATTERN.test(f) || !MIGRATION_NAME_PATTERN.test(nameOf(f)));
  if (bad.length > 0) throw new MigrationSetError(`invalid migration file names: ${bad.join(", ")}`);
  const migrations = files.map((file) => {
    const path = join(dir, file);
    const bytes = readFileSync(path);
    return {
      file,
      path,
      version: file.slice(0, 4),
      name: nameOf(file),
      sql: bytes.toString("utf8"),
      checksum: sha256(bytes),
    };
  });
  migrations.forEach((m, index) => {
    const expected = String(index).padStart(4, "0");
    if (m.version !== expected) {
      throw new MigrationSetError(
        `migration versions must run 0000, 0001, … without gaps: expected ${expected}, found ${m.file}`,
      );
    }
  });
  return migrations;
}

/** @param {string} file */
export function nameOf(file) {
  return file.replace(/^\d{4}_/, "").replace(/\.sql$/, "");
}

// ---- Connections -------------------------------------------------------------------------------------------

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

/** @param {string} url */
export function isLoopbackUrl(url) {
  return LOOPBACK_HOSTS.has(new URL(url).hostname);
}

/** @param {Readonly<Record<string, string | undefined>>} [env] */
export function localPrimaryPort(env = process.env) {
  return Number(env.V13_LOCAL_PG_PORT) || 54329;
}

/**
 * Default administrator URL: the local primary cluster, superuser postgres (trust on 127.0.0.1), database v13_local.
 * @param {Readonly<Record<string, string | undefined>>} [env]
 */
export function defaultAdminUrl(env = process.env) {
  return `postgres://postgres@127.0.0.1:${localPrimaryPort(env)}/${LOCAL_DATABASE}`;
}

/** @param {Readonly<Record<string, string | undefined>>} [env] */
export function adminUrl(env = process.env) {
  return env.V13_ADMIN_DATABASE_URL?.trim() || defaultAdminUrl(env);
}

/**
 * The same server and credentials with another database.
 * @param {string} url
 * @param {string} database
 */
export function withDatabase(url, database) {
  const u = new URL(url);
  u.pathname = `/${encodeURIComponent(database)}`;
  return u.toString();
}

/**
 * The same server and database with another user and password.
 * @param {string} url
 * @param {string} user
 * @param {string} password
 */
export function withCredentials(url, user, password) {
  const u = new URL(url);
  u.username = encodeURIComponent(user);
  u.password = encodeURIComponent(password);
  return u.toString();
}

/** `user@host:port/database` — never the password. @param {string} url */
export function describeUrl(url) {
  const u = new URL(url);
  const db = decodeURIComponent(u.pathname.replace(/^\//, "")) || "(default)";
  return `${decodeURIComponent(u.username) || "(default user)"}@${u.hostname}:${u.port || "5432"}/${db}`;
}

/**
 * A small client for scripts: one connection, no prepared statements, notices suppressed, TLS off only on loopback.
 * @param {string} url
 * @param {string} applicationName
 */
export function connect(url, applicationName) {
  return postgres(url, {
    max: 1,
    prepare: false,
    idle_timeout: 5,
    connect_timeout: 10,
    ssl: isLoopbackUrl(url) ? false : "require",
    connection: { application_name: applicationName },
    onnotice: () => undefined,
  });
}
