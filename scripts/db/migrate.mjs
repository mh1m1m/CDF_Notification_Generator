#!/usr/bin/env node
// @ts-check
// Applies database/migrations/NNNN_name.sql in version order (pnpm db:migrate).
//
//   node scripts/db/migrate.mjs [--dry-run] [--migrations-dir <dir>]
//
// Target: V13_ADMIN_DATABASE_URL, default the local primary cluster (scripts/db/local-pg.mjs) as postgres. Loopback
// hosts only: the hosted project is migrated by pasting the reviewed output of scripts/db/hosted-bundle.mjs.
//
// Each pending migration runs in its own transaction:
//   advisory lock → re-read the history → SET LOCAL search_path = '' → the file → SET LOCAL ROLE cdf_v13_owner →
//   history insert (version, name, checksum_sha256, runner) → RESET ROLE → COMMIT.
// The history is read and written as cdf_v13_owner because on the hosted project the administrator (postgres) is not
// a superuser and holds no privilege on cdf_notifications_v13.schema_migrations (RLS on, no grants).
// The runner refuses to continue when the database's history differs from the repository (unknown version, other
// name, other checksum, gaps) and when any migration fails db:lint.
// --dry-run applies every pending migration inside ONE transaction and rolls it back.
import { pathToFileURL } from "node:url";
import {
  adminUrl,
  connect,
  describeUrl,
  isLoopbackUrl,
  MIGRATION_LOCK_SQL,
  MIGRATION_LOCK_TIMEOUT,
  MIGRATIONS_DIR,
  readMigrations,
  V13_OWNER,
  V13_SCHEMA,
} from "./lib/migrations.mjs";
import { formatFinding, lintMigrationsDir } from "./lint-migrations.mjs";
import { lineOf } from "./lib/sql-lexer.mjs";

/** @typedef {import("./lib/migrations.mjs").MigrationFile} MigrationFile */
/** @typedef {{ version: string, name: string, checksum_sha256: string }} HistoryRow */
/** @typedef {import("postgres").Sql<{}>} Sql */
/** @typedef {import("postgres").TransactionSql<{}>} Tx */

/** Runner values this script records. "hosted" is written only by the hosted bundle. */
export const MIGRATE_RUNNERS = Object.freeze(["local", "ci"]);

export class MigrationError extends Error {
  /** @param {string} code @param {string} message */
  constructor(code, message) {
    super(message);
    this.name = "MigrationError";
    this.code = code;
  }
}

/** Thrown inside the dry-run transaction to force its rollback. */
class DryRunRollback extends Error {}

/** @param {Readonly<Record<string, string | undefined>>} [env] */
export function runnerFromEnv(env = process.env) {
  const explicit = env.V13_MIGRATION_RUNNER?.trim();
  if (explicit) {
    if (!MIGRATE_RUNNERS.includes(explicit)) {
      throw new MigrationError(
        "RUNNER_INVALID",
        `V13_MIGRATION_RUNNER must be one of ${MIGRATE_RUNNERS.join(", ")} (the hosted runner is the hosted bundle)`,
      );
    }
    return explicit;
  }
  return env.CI === "true" ? "ci" : "local";
}

/**
 * Compares the applied history with the migration files. Returns the files still to apply.
 * @param {MigrationFile[]} files
 * @param {HistoryRow[]} history rows ordered by version
 * @returns {MigrationFile[]}
 */
export function pendingMigrations(files, history) {
  history.forEach((row, index) => {
    const expected = String(index).padStart(4, "0");
    if (row.version !== expected) {
      throw new MigrationError(
        "HISTORY_GAP",
        `history is not contiguous: expected version ${expected}, found ${row.version}`,
      );
    }
    const file = files[index];
    if (!file) {
      throw new MigrationError(
        "HISTORY_UNKNOWN_VERSION",
        `the database records version ${row.version} (${row.name}), which is not in the repository`,
      );
    }
    if (file.name !== row.name) {
      throw new MigrationError(
        "HISTORY_NAME_DRIFT",
        `version ${row.version} was applied as "${row.name}" but the repository has ${file.file}`,
      );
    }
    if (file.checksum !== row.checksum_sha256) {
      throw new MigrationError(
        "HISTORY_CHECKSUM_DRIFT",
        `${file.file} changed after it was applied (recorded sha256 ${row.checksum_sha256}, file sha256 ${file.checksum}); write a new migration instead`,
      );
    }
  });
  return files.slice(history.length);
}

/**
 * The applied history, read as cdf_v13_owner (works for a non-superuser administrator). Must run inside a
 * transaction. Returns [] before the bootstrap created the table.
 * @param {Tx} tx
 * @returns {Promise<HistoryRow[]>}
 */
export async function readHistory(tx) {
  const [presence] = await tx`
    select exists (
      select 1
        from pg_catalog.pg_class c
        join pg_catalog.pg_namespace n on n.oid = c.relnamespace
       where n.nspname = ${V13_SCHEMA} and c.relname = 'schema_migrations' and c.relkind = 'r'
    ) as present`;
  if (!presence?.present) return [];
  await tx.unsafe(`set local role ${V13_OWNER}`);
  const rows = await tx`
    select version, name, checksum_sha256
      from cdf_notifications_v13.schema_migrations
     order by version`;
  await tx.unsafe("reset role");
  return rows.map((r) => ({
    version: String(r.version),
    name: String(r.name),
    checksum_sha256: String(r.checksum_sha256),
  }));
}

/**
 * Applies one migration file and records it, inside the caller's transaction.
 * @param {Tx} tx
 * @param {MigrationFile} migration
 * @param {string} runner
 */
async function applyOne(tx, migration, runner) {
  await tx.unsafe("set local search_path = ''");
  try {
    await tx.unsafe(migration.sql);
  } catch (error) {
    throw describeSqlError(error, migration);
  }
  await tx.unsafe(`set local role ${V13_OWNER}`);
  await tx`
    insert into cdf_notifications_v13.schema_migrations (version, name, checksum_sha256, runner)
    values (${migration.version}, ${migration.name}, ${migration.checksum}, ${runner})`;
  await tx.unsafe("reset role");
}

/**
 * A migration error with file, line and SQLSTATE; never connection details.
 * @param {unknown} error
 * @param {MigrationFile} migration
 */
function describeSqlError(error, migration) {
  if (!(error instanceof Error)) return error;
  const e = /** @type {Error & { code?: string, position?: string }} */ (error);
  const position = Number(e.position);
  const where = Number.isFinite(position) && position > 0 ? `:${lineOf(migration.sql, position - 1)}` : "";
  return new MigrationError(
    "MIGRATION_FAILED",
    `${migration.file}${where}: ${e.message}${e.code ? ` (SQLSTATE ${e.code})` : ""}`,
  );
}

/**
 * Locks the history, checks it against the files and verifies the expected predecessor.
 * @param {Tx} tx
 * @param {MigrationFile[]} files
 */
async function lockAndCheck(tx, files) {
  await tx.unsafe(`set local lock_timeout = '${MIGRATION_LOCK_TIMEOUT}'`);
  await tx.unsafe(MIGRATION_LOCK_SQL);
  return pendingMigrations(files, await readHistory(tx));
}

/**
 * @typedef {{
 *   url?: string,
 *   dir?: string,
 *   dryRun?: boolean,
 *   runner?: string,
 *   log?: (line: string) => void,
 * }} MigrateOptions
 * @typedef {{ target: string, runner: string, dryRun: boolean, applied: string[], alreadyApplied: number }} MigrateResult
 */

/**
 * Applies the pending migrations (loopback targets only).
 * @param {MigrateOptions} [options]
 * @returns {Promise<MigrateResult>}
 */
export async function migrate(options = {}) {
  const url = options.url ?? adminUrl();
  const dir = options.dir ?? MIGRATIONS_DIR;
  const dryRun = options.dryRun ?? false;
  const runner = options.runner ?? runnerFromEnv();
  const log = options.log ?? (() => undefined);
  if (!MIGRATE_RUNNERS.includes(runner))
    throw new MigrationError("RUNNER_INVALID", `runner must be one of ${MIGRATE_RUNNERS.join(", ")}`);
  if (!isLoopbackUrl(url)) {
    throw new MigrationError(
      "NON_LOOPBACK_TARGET",
      `refusing ${describeUrl(url)}: db:migrate targets local and CI clusters only; produce the hosted SQL with pnpm db:hosted-bundle`,
    );
  }

  const lint = lintMigrationsDir(dir);
  if (lint.findings.length > 0) {
    for (const f of lint.findings) log(formatFinding(f, dir));
    throw new MigrationError(
      "LINT_FAILED",
      `${lint.findings.length} db:lint finding(s); fix them before migrating`,
    );
  }
  const files = readMigrations(dir);
  const target = describeUrl(url);
  const sql = connect(url, "cdf-v13-migrate");
  try {
    /** @type {string[]} */
    const applied = [];
    let alreadyApplied = 0;
    if (dryRun) {
      try {
        await sql.begin(async (tx) => {
          const pending = await lockAndCheck(tx, files);
          alreadyApplied = files.length - pending.length;
          for (const m of pending) {
            await applyOne(tx, m, runner);
            applied.push(m.file);
            log(`  ~ ${m.file} (dry run)`);
          }
          throw new DryRunRollback();
        });
      } catch (error) {
        if (!(error instanceof DryRunRollback)) throw error;
      }
      return { target, runner, dryRun, applied, alreadyApplied };
    }

    for (;;) {
      const done = await sql.begin(async (tx) => {
        const pending = await lockAndCheck(tx, files);
        if (applied.length === 0) alreadyApplied = files.length - pending.length;
        const next = pending[0];
        if (!next) return true;
        await applyOne(tx, next, runner);
        return next;
      });
      if (done === true) break;
      applied.push(done.file);
      log(`  + ${done.file}`);
    }
    return { target, runner, dryRun, applied, alreadyApplied };
  } finally {
    await sql.end({ timeout: 5 });
  }
}

async function main() {
  const args = process.argv.slice(2);
  const dirFlag = args.indexOf("--migrations-dir");
  const dir = dirFlag === -1 ? MIGRATIONS_DIR : args[dirFlag + 1];
  const unknown = args.filter(
    (a, k) => a !== "--dry-run" && a !== "--migrations-dir" && !(dirFlag !== -1 && k === dirFlag + 1),
  );
  if (unknown.length > 0 || !dir) {
    console.error("usage: node scripts/db/migrate.mjs [--dry-run] [--migrations-dir <dir>]");
    process.exit(2);
  }
  try {
    const result = await migrate({
      dir,
      dryRun: args.includes("--dry-run"),
      log: (line) => console.log(line),
    });
    const verb = result.dryRun ? "would apply" : "applied";
    console.log(
      `✓ db:migrate: ${verb} ${result.applied.length}, already applied ${result.alreadyApplied} (${result.target}, runner ${result.runner}${result.dryRun ? ", rolled back" : ""})`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`✗ db:migrate: ${message}`);
    process.exit(1);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) await main();
