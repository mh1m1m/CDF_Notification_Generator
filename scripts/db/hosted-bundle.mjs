#!/usr/bin/env node
// @ts-check
// Prints the SQL to apply ONE migration on the hosted project (pnpm db:hosted-bundle <version> [--dry-run]).
//
// It connects nowhere and contains no credentials: a reviewer pastes the printed text into one SQL session on the
// hosted project as the administrator (postgres, not a superuser there). The text is:
//
//   the text guard (plan §5.7), first, so it runs before anything else: it aborts unless the text the server received
//           starts with the guard, continues with the text generated here byte for byte (md5 and length), then has
//           exactly the final statement below, followed only by whitespace and line comments;
//   begin; lock_timeout, search_path = '', the migration advisory lock;
//   guards: refuse if this version is already applied; refuse unless the previous version is the latest applied and
//           every recorded predecessor matches the repository (name + sha256);
//   the migration file, verbatim;
//   SET LOCAL ROLE cdf_v13_owner; the history insert with runner 'hosted'; RESET ROLE;
//   commit;  (--dry-run: rollback;)
//
// Run the --dry-run text first. The dry-run and apply texts differ only in the final ROLLBACK/COMMIT and the guard's
// expected final statement, so they carry the same guard hash. The output is deterministic for a given migration set,
// so it can be reviewed in a PR.
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import {
  MIGRATION_LOCK_SQL,
  MIGRATION_LOCK_TIMEOUT,
  MIGRATIONS_DIR,
  readMigrations,
  V13_OWNER,
  V13_SCHEMA,
} from "./lib/migrations.mjs";
import { formatFinding, lintMigrationsDir } from "./lint-migrations.mjs";

/** @typedef {import("./lib/migrations.mjs").MigrationFile} MigrationFile */

export class HostedBundleError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = "HostedBundleError";
  }
}

const VERSION_PATTERN = /^\d{4}$/;

/** A SQL string literal. Inputs are file names, versions and hex checksums validated before they get here. */
const literal = (/** @type {string} */ value) => `'${value.replaceAll("'", "''")}'`;

/** md5 (hex) of the UTF-8 bytes of a text: what PostgreSQL's md5(text) returns in a UTF8 database. */
export const md5Hex = (/** @type {string} */ text) => createHash("md5").update(text, "utf8").digest("hex");

/** The guard block's dollar-quote tag. The block cannot contain it, so the guard assembles it from two literals. */
export const GUARD_TAG = "$v13_text_guard$";

/** Length in characters, as PostgreSQL's length(text) counts them in a UTF8 database. */
const charLength = (/** @type {string} */ text) => [...text].length;

/**
 * Puts the plan §5.7 text guard in FRONT of a text and the final statement after it. The guard is the first statement,
 * so it runs before anything else in the text, and checks the text the server received (current_query(); the whole
 * text must be sent as one simple query):
 *   1. the received text starts with the guard itself (nothing was put in front of it);
 *   2. what follows the guard's closing tag starts with the body, byte for byte (its md5 and length);
 *   3. then exactly the final statement (rollback; for a dry run, commit; for an apply) and a newline;
 *   4. then only whitespace and "--" line comments, which cannot execute (the connector appends a comment trailer).
 * Any difference raises P0001 before a single statement of the body has run. The md5 covers only the body, so the
 * dry-run and apply texts carry the same hash and differ only in the expected and the actual final statement.
 * @param {string} body the statements to guard, without the final COMMIT/ROLLBACK; ends with a newline
 * @param {"commit;" | "rollback;"} finalStatement
 * @returns {string}
 */
export function textGuard(body, finalStatement) {
  if (body.includes(GUARD_TAG))
    throw new HostedBundleError(`the text already contains the guard tag "${GUARD_TAG}"`);
  if (!body.endsWith("\n"))
    throw new HostedBundleError("the text before the final statement must end with a newline");
  if (finalStatement !== "commit;" && finalStatement !== "rollback;")
    throw new HostedBundleError("the final statement is commit; or rollback;");
  const guarded = `\n${body}`;
  const [tagHead, tagRest] = [GUARD_TAG.slice(0, 9), GUARD_TAG.slice(9)];
  return `do ${GUARD_TAG}
declare
  received text := pg_catalog.current_query();
  tag text := ${literal(tagHead)} || ${literal(tagRest)};
  after_guard text;
  final_part text;
begin
  -- V13 text guard (plan §5.7). It runs first: nothing in this text has run yet when it checks the text.
  -- 1. Nothing was put in front of this block, and its closing tag occurs exactly once.
  after_guard := pg_catalog.substr(received, pg_catalog.strpos(received, tag || ';') + pg_catalog.length(tag) + 1);
  if pg_catalog.left(received, pg_catalog.length('do ' || tag)) is distinct from 'do ' || tag
     or pg_catalog.strpos(received, tag || ';') = 0
     or pg_catalog.strpos(after_guard, tag) <> 0 then
    raise exception 'V13 text guard: the text received does not start with the guard' using errcode = 'P0001';
  end if;
  -- 2. After the closing tag: the repository text, byte for byte.
  if pg_catalog.md5(pg_catalog.left(after_guard, ${charLength(guarded)})) is distinct from ${literal(md5Hex(guarded))} then
    raise exception 'V13 text guard: the text received differs from the repository text' using errcode = 'P0001';
  end if;
  -- 3. and 4. Then exactly the final statement, and nothing that can execute.
  final_part := pg_catalog.substr(after_guard, ${charLength(guarded) + 1});
  if pg_catalog.left(final_part, ${charLength(finalStatement) + 1}) is distinct from ${literal(finalStatement)} || pg_catalog.chr(10)
     or pg_catalog.substr(final_part, ${charLength(finalStatement) + 2}) !~ '^(\\s|--[^\\n]*)*$' then
    raise exception 'V13 text guard: the text after the repository text is not the expected final statement'
      using errcode = 'P0001';
  end if;
end
${GUARD_TAG};${guarded}${finalStatement}
`;
}

const HISTORY_PRESENT = `exists (
    select 1
      from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
     where n.nspname = ${literal(V13_SCHEMA)} and c.relname = 'schema_migrations' and c.relkind = 'r'
  )`;

/** @param {MigrationFile} m */
function bootstrapGuard(m) {
  return `-- Guard: version ${m.version} is not applied yet (no history table). The bootstrap also refuses existing V13 roles.
do $v13_bundle_guard$
begin
  if ${HISTORY_PRESENT} then
    raise exception 'V13 bundle ${m.version} refused: the V13 migration history already exists' using errcode = 'P0001';
  end if;
end
$v13_bundle_guard$;`;
}

/**
 * @param {MigrationFile} m
 * @param {MigrationFile[]} predecessors
 */
function historyGuard(m, predecessors) {
  const previous = /** @type {MigrationFile} */ (predecessors[predecessors.length - 1]);
  const expected = predecessors
    .map((p) => `      (${literal(p.version)}, ${literal(p.name)}, ${literal(p.checksum)})`)
    .join(",\n");
  return `-- Guard 1: the V13 history exists (the bootstrap is applied).
do $v13_bundle_guard$
begin
  if not ${HISTORY_PRESENT} then
    raise exception 'V13 bundle ${m.version} refused: the V13 bootstrap (0000) is not applied' using errcode = 'P0001';
  end if;
end
$v13_bundle_guard$;

-- Guards 2–4 read the history as its owner (the administrator holds no privilege on it).
set local role ${V13_OWNER};
do $v13_bundle_history_guard$
declare
  latest text;
begin
  -- Guard 2: this version is not applied yet.
  if exists (select 1 from cdf_notifications_v13.schema_migrations where version = ${literal(m.version)}) then
    raise exception 'V13 bundle ${m.version} refused: version ${m.version} is already applied' using errcode = 'P0001';
  end if;
  -- Guard 3: the previous version is the latest applied.
  select max(version) into latest from cdf_notifications_v13.schema_migrations;
  if latest is distinct from ${literal(previous.version)} then
    raise exception 'V13 bundle ${m.version} refused: the latest applied version is %, expected ${previous.version}',
      coalesce(latest, 'none') using errcode = 'P0001';
  end if;
  -- Guard 4: every recorded predecessor matches the repository this bundle was generated from.
  if exists (
    select 1
      from (values
${expected}
      ) as expected (version, name, checksum_sha256)
      full join cdf_notifications_v13.schema_migrations as recorded on recorded.version = expected.version
     where recorded.version is null
        or expected.version is null
        or recorded.name is distinct from expected.name
        or recorded.checksum_sha256 is distinct from expected.checksum_sha256
  ) then
    raise exception 'V13 bundle ${m.version} refused: the recorded history differs from the repository (name or sha256)'
      using errcode = 'P0001';
  end if;
end
$v13_bundle_history_guard$;
reset role;`;
}

/**
 * Builds the bundle text for one version.
 * @param {{ version: string, dir?: string, dryRun?: boolean }} options
 * @returns {string}
 */
export function buildHostedBundle(options) {
  const dir = options.dir ?? MIGRATIONS_DIR;
  const dryRun = options.dryRun ?? false;
  if (!VERSION_PATTERN.test(options.version))
    throw new HostedBundleError("the version is four digits, for example 0001");

  const lint = lintMigrationsDir(dir);
  if (lint.findings.length > 0) {
    const details = lint.findings.map((f) => formatFinding(f, dir)).join("\n");
    throw new HostedBundleError(
      `db:lint reports ${lint.findings.length} finding(s); no bundle is produced:\n${details}`,
    );
  }
  const files = readMigrations(dir);
  const index = files.findIndex((f) => f.version === options.version);
  const m = files[index];
  if (!m) throw new HostedBundleError(`no migration with version ${options.version} in ${dir}`);
  const predecessors = files.slice(0, index);
  const fileText = m.sql.endsWith("\n") ? m.sql : `${m.sql}\n`;

  if (m.sql.includes(GUARD_TAG))
    throw new HostedBundleError(`${m.file} contains the text-guard tag "${GUARD_TAG}"`);

  const body = `-- V13 hosted migration bundle (run the dry run first: identical text that ends in ROLLBACK)
-- Migration: database/migrations/${m.file}
-- sha256:    ${m.checksum}
-- Classification: SYNTHETIC-DATA REFERENCE IMPLEMENTATION — not CDF production.
-- Generated by scripts/db/hosted-bundle.mjs. Contains no credentials and connects nowhere.
-- Paste the whole text into ONE SQL session on the hosted project as the administrator. Any failing statement aborts
-- the transaction and nothing is applied (send ROLLBACK if the client keeps the session open).

begin;
set local lock_timeout = ${literal(MIGRATION_LOCK_TIMEOUT)};
set local search_path = '';
${MIGRATION_LOCK_SQL};

${predecessors.length === 0 ? bootstrapGuard(m) : historyGuard(m, predecessors)}

-- ---- ${m.file} (verbatim) ----
${fileText}-- ---- end of ${m.file} ----

-- History row, written as the owner in the same transaction.
set local role ${V13_OWNER};
insert into cdf_notifications_v13.schema_migrations (version, name, checksum_sha256, runner)
values (${literal(m.version)}, ${literal(m.name)}, ${literal(m.checksum)}, 'hosted');
reset role;

`;
  return textGuard(body, dryRun ? "rollback;" : "commit;");
}

function main() {
  const args = process.argv.slice(2);
  const dirFlag = args.indexOf("--migrations-dir");
  const dir = dirFlag === -1 ? MIGRATIONS_DIR : args[dirFlag + 1];
  const positional = args.filter((a, k) => !a.startsWith("--") && !(dirFlag !== -1 && k === dirFlag + 1));
  const unknownFlags = args.filter(
    (a) => a.startsWith("--") && a !== "--dry-run" && a !== "--migrations-dir",
  );
  if (positional.length !== 1 || unknownFlags.length > 0 || !dir) {
    console.error("usage: node scripts/db/hosted-bundle.mjs <version> [--dry-run] [--migrations-dir <dir>]");
    process.exit(2);
  }
  try {
    process.stdout.write(
      buildHostedBundle({
        version: /** @type {string} */ (positional[0]),
        dir,
        dryRun: args.includes("--dry-run"),
      }),
    );
  } catch (error) {
    console.error(`✗ db:hosted-bundle: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
