#!/usr/bin/env node
// @ts-check
// Rebuilds the LOCAL database from Git (pnpm db:reset): drop and recreate v13_local, drop the V13 roles, apply every
// migration (scripts/db/migrate.mjs), apply database/seed/*.sql (which must pass db:lint first), and give cdf_v13_app a
// local-only password.
//
// LOCAL AND CI ONLY. It refuses a non-loopback host and any database other than v13_local, because it drops both.
// The app password comes from V13_LOCAL_APP_PASSWORD (default "local-only-not-a-secret"); it is stored as a SCRAM
// verifier computed here, so the plain text never reaches the server.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  adminUrl,
  connect,
  describeUrl,
  isLoopbackUrl,
  listFiles,
  LOCAL_DATABASE,
  SEED_DIR,
  V13_APP,
  V13_ROLES,
  withDatabase,
} from "./lib/migrations.mjs";
import { scramVerifier } from "./lib/scram.mjs";
import { formatFinding, lintSeedsDir } from "./lint-migrations.mjs";
import { migrate, runnerFromEnv } from "./migrate.mjs";

/** Default password of the app login on local and CI clusters. Not a secret: these clusters hold synthetic data. */
export const DEFAULT_LOCAL_APP_PASSWORD = "local-only-not-a-secret";

const SEED_FILE_PATTERN = /^\d{4}_[a-z0-9_]+\.sql$/;

export class ResetError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = "ResetError";
  }
}

/** @param {string} url */
export function assertResettable(url) {
  if (!isLoopbackUrl(url))
    throw new ResetError(`refusing ${describeUrl(url)}: db:reset is for local and CI clusters only`);
  const database = decodeURIComponent(new URL(url).pathname.replace(/^\//, ""));
  if (database !== LOCAL_DATABASE) {
    throw new ResetError(
      `refusing database "${database || "(default)"}": db:reset only drops and recreates ${LOCAL_DATABASE}`,
    );
  }
}

/**
 * @param {{ url?: string, log?: (line: string) => void, appPassword?: string }} [options]
 */
export async function resetLocal(options = {}) {
  const url = options.url ?? adminUrl();
  const log = options.log ?? (() => undefined);
  assertResettable(url);
  const appPassword =
    options.appPassword ?? (process.env.V13_LOCAL_APP_PASSWORD || DEFAULT_LOCAL_APP_PASSWORD);
  const verifier = scramVerifier(appPassword);

  // Seeds pass db:lint before anything is dropped (OI-041: no transaction control, no role change in a seed).
  const seedLint = lintSeedsDir(SEED_DIR);
  if (seedLint.findings.length > 0)
    throw new ResetError(
      `db:lint reports ${seedLint.findings.length} seed finding(s):\n${seedLint.findings.map((f) => formatFinding(f, SEED_DIR)).join("\n")}`,
    );

  const maintenance = connect(withDatabase(url, "postgres"), "cdf-v13-reset");
  try {
    await maintenance.unsafe(`drop database if exists ${LOCAL_DATABASE} with (force)`);
    for (const role of [...V13_ROLES].reverse()) await maintenance.unsafe(`drop role if exists ${role}`);
    await maintenance.unsafe(`create database ${LOCAL_DATABASE} template template0 encoding 'UTF8'`);
  } finally {
    await maintenance.end({ timeout: 5 });
  }
  log(`  ${LOCAL_DATABASE} recreated, V13 roles dropped`);

  const result = await migrate({ url, runner: runnerFromEnv(), log });

  const seeds = listFiles(SEED_DIR);
  const badSeeds = seeds.filter((f) => !SEED_FILE_PATTERN.test(f));
  if (badSeeds.length > 0)
    throw new ResetError(`seed files must be named NNNN_name.sql: ${badSeeds.join(", ")}`);
  const sql = connect(url, "cdf-v13-reset");
  try {
    for (const file of seeds) {
      const text = readFileSync(join(SEED_DIR, file), "utf8");
      await sql.begin(async (tx) => {
        await tx.unsafe("set local search_path = ''");
        await tx.unsafe(text);
      });
      log(`  + seed ${file}`);
    }
    // The verifier holds only base64 characters, digits, "$" and ":" (scripts/db/lib/scram.mjs).
    await sql.unsafe(`alter role ${V13_APP} password '${verifier}'`);
  } finally {
    await sql.end({ timeout: 5 });
  }
  return {
    target: describeUrl(url),
    migrations: result.applied.length,
    seeds: seeds.length,
    runner: result.runner,
  };
}

async function main() {
  if (process.argv.length > 2) {
    console.error("usage: node scripts/db/reset-local.mjs");
    process.exit(2);
  }
  try {
    const r = await resetLocal({ log: (line) => console.log(line) });
    console.log(
      `✓ db:reset: ${r.target} rebuilt — ${r.migrations} migration(s), ${r.seeds} seed file(s), runner ${r.runner}, ${V13_APP} password set (local only)`,
    );
  } catch (error) {
    console.error(`✗ db:reset: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) await main();
