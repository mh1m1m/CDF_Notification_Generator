#!/usr/bin/env node
// @ts-check
// Local PostgreSQL clusters for development and tests (pnpm db:local [start|stop|status] [primary|hosted-sim|all]).
// LOCAL ONLY: data lives in .local/ (git-ignored), servers listen on 127.0.0.1 only, fsync is off.
//
//   primary     .local/pg            port V13_LOCAL_PG_PORT (54329)          bootstrap superuser postgres
//   hosted-sim  .local/pg-hosted-sim port V13_LOCAL_HOSTED_SIM_PORT (54330)  bootstrap superuser supabase_admin
//
// The hosted simulation reproduces the role layout of the hosted Supabase project, where the administrator postgres
// is NOT a superuser (tests create that role); it cannot be done in the primary cluster because the bootstrap
// superuser of a cluster can never lose SUPERUSER.
//
// Authentication: trust for the bootstrap superuser on 127.0.0.1 and on the cluster's own socket directory, SCRAM for
// every other role. PostgreSQL refuses to run as root, so under root the commands run as the OS user postgres
// (override with V13_LOCAL_PG_OS_USER).
import { spawnSync } from "node:child_process";
import {
  appendFileSync,
  chmodSync,
  chownSync,
  existsSync,
  mkdirSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { localPrimaryPort, ROOT } from "./lib/migrations.mjs";

/** @typedef {{ name: string, dir: string, port: number, superuser: string }} Cluster */

/** @param {Readonly<Record<string, string | undefined>>} [env] */
export function localHostedSimPort(env = process.env) {
  return Number(env.V13_LOCAL_HOSTED_SIM_PORT) || 54330;
}

/** @param {Readonly<Record<string, string | undefined>>} [env] @returns {Cluster[]} */
export function clusters(env = process.env) {
  return [
    { name: "primary", dir: join(ROOT, ".local", "pg"), port: localPrimaryPort(env), superuser: "postgres" },
    {
      name: "hosted-sim",
      dir: join(ROOT, ".local", "pg-hosted-sim"),
      port: localHostedSimPort(env),
      superuser: "supabase_admin",
    },
  ];
}

/** PostgreSQL server binaries: V13_PG_BIN, `pg_config --bindir`, the newest /usr/lib/postgresql/N/bin, else PATH. */
function binDir() {
  if (process.env.V13_PG_BIN) return process.env.V13_PG_BIN;
  const fromConfig = spawnSync("pg_config", ["--bindir"], { encoding: "utf8" });
  const configured = fromConfig.status === 0 ? fromConfig.stdout.trim() : "";
  if (configured && existsSync(join(configured, "pg_ctl"))) return configured;
  const debian = "/usr/lib/postgresql";
  if (existsSync(debian)) {
    const versions = readdirSync(debian)
      .filter((v) => /^\d+$/.test(v) && existsSync(join(debian, v, "bin", "pg_ctl")))
      .sort((a, b) => Number(b) - Number(a));
    if (versions[0]) return join(debian, versions[0], "bin");
  }
  return "";
}

const isRoot = typeof process.getuid === "function" && process.getuid() === 0;
const osUser = process.env.V13_LOCAL_PG_OS_USER || "postgres";

/**
 * Runs a PostgreSQL binary (as the OS user postgres when we are root).
 * @param {string} binary
 * @param {string[]} args
 * @param {{ quiet?: boolean }} [options]
 */
function run(binary, args, options = {}) {
  const bin = binDir();
  const path = bin ? join(bin, binary) : binary;
  const [command, commandArgs] = isRoot ? ["runuser", ["-u", osUser, "--", path, ...args]] : [path, args];
  const result = spawnSync(command, commandArgs, { encoding: "utf8" });
  if (result.error)
    throw new Error(
      `cannot run ${binary}: ${result.error.message} (set V13_PG_BIN to the PostgreSQL bin directory)`,
    );
  if (!options.quiet && result.status !== 0) {
    process.stderr.write(result.stdout ?? "");
    process.stderr.write(result.stderr ?? "");
  }
  return result.status ?? 1;
}

/** Creates a directory owned by the OS user that runs the server. @param {string} dir */
function ownedDir(dir) {
  mkdirSync(dir, { recursive: true });
  if (isRoot) {
    const id = spawnSync("id", ["-u", osUser], { encoding: "utf8" });
    const gid = spawnSync("id", ["-g", osUser], { encoding: "utf8" });
    if (id.status !== 0 || gid.status !== 0)
      throw new Error(`OS user ${osUser} not found (set V13_LOCAL_PG_OS_USER)`);
    chownSync(dir, Number(id.stdout.trim()), Number(gid.stdout.trim()));
  }
}

/** @param {Cluster} c */
const dataDir = (c) => join(c.dir, "data");
/** @param {Cluster} c */
const socketDir = (c) => join(c.dir, "run");
/** @param {Cluster} c */
const logFile = (c) => join(c.dir, "log", "postgres.log");

/** @param {Cluster} c */
function initialise(c) {
  for (const d of [c.dir, socketDir(c), join(c.dir, "log")]) ownedDir(d);
  // Only the server's OS user (and root) may reach the socket directory, where the superuser is trusted.
  chmodSync(socketDir(c), 0o700);
  const status = run("initdb", [
    "-D",
    dataDir(c),
    "-U",
    c.superuser,
    "-E",
    "UTF8",
    "--no-locale",
    "--auth-local=trust",
    "--auth-host=scram-sha-256",
    "--no-instructions",
    "-N",
  ]);
  if (status !== 0) throw new Error(`initdb failed for the ${c.name} cluster`);
  writeFileSync(
    join(dataDir(c), "pg_hba.conf"),
    [
      "# V13 local test cluster (scripts/db/local-pg.mjs). LOCAL ONLY.",
      "# TYPE  DATABASE  USER                ADDRESS         METHOD",
      `local   all       ${c.superuser.padEnd(18)}                  trust`,
      `host    all       ${c.superuser.padEnd(18)}  127.0.0.1/32    trust`,
      "local   all       all                                 scram-sha-256",
      "host    all       all                 127.0.0.1/32    scram-sha-256",
      "",
    ].join("\n"),
  );
  appendFileSync(
    join(dataDir(c), "postgresql.conf"),
    [
      "",
      "# V13 local test cluster (scripts/db/local-pg.mjs). LOCAL ONLY: durability is off.",
      "listen_addresses = '127.0.0.1'",
      `unix_socket_directories = '${socketDir(c).replaceAll("'", "''")}'`,
      "password_encryption = 'scram-sha-256'",
      "max_connections = 60",
      "fsync = off",
      "synchronous_commit = off",
      "full_page_writes = off",
      "",
    ].join("\n"),
  );
  if (isRoot) {
    for (const f of ["pg_hba.conf", "postgresql.conf"]) {
      spawnSync("chown", [`${osUser}:`, join(dataDir(c), f)]);
    }
  }
}

/** @param {Cluster} c */
function isRunning(c) {
  return (
    existsSync(join(dataDir(c), "PG_VERSION")) &&
    run("pg_ctl", ["-D", dataDir(c), "status"], { quiet: true }) === 0
  );
}

/** @param {Cluster} c */
function start(c) {
  if (!existsSync(join(dataDir(c), "PG_VERSION"))) initialise(c);
  if (isRunning(c)) return `${c.name}: already running on 127.0.0.1:${c.port}`;
  const status = run("pg_ctl", [
    "-D",
    dataDir(c),
    "-l",
    logFile(c),
    "-o",
    `-p ${c.port}`,
    "-w",
    "-t",
    "60",
    "start",
  ]);
  if (status !== 0) throw new Error(`the ${c.name} cluster did not start; see ${logFile(c)}`);
  return `${c.name}: started on 127.0.0.1:${c.port} (superuser ${c.superuser}, data ${dataDir(c)})`;
}

/** @param {Cluster} c */
function stop(c) {
  if (!isRunning(c)) return `${c.name}: not running`;
  const status = run("pg_ctl", ["-D", dataDir(c), "-m", "fast", "-w", "-t", "60", "stop"]);
  if (status !== 0) throw new Error(`the ${c.name} cluster did not stop`);
  return `${c.name}: stopped`;
}

/** @param {Cluster} c */
function status(c) {
  if (!existsSync(join(dataDir(c), "PG_VERSION"))) return `${c.name}: not initialised (${c.dir})`;
  return isRunning(c)
    ? `${c.name}: running on 127.0.0.1:${c.port} (superuser ${c.superuser})`
    : `${c.name}: stopped`;
}

const COMMANDS = { start, stop, status };

function main() {
  const [command = "start", target = "all", ...rest] = process.argv.slice(2);
  const all = clusters();
  const selected = target === "all" ? all : all.filter((c) => c.name === target);
  if (!(command in COMMANDS) || selected.length === 0 || rest.length > 0) {
    console.error("usage: node scripts/db/local-pg.mjs [start|stop|status] [primary|hosted-sim|all]");
    process.exit(2);
  }
  const action = COMMANDS[/** @type {keyof typeof COMMANDS} */ (command)];
  try {
    for (const c of selected) console.log(`db:local ${action(c)}`);
  } catch (error) {
    console.error(`✗ db:local: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
