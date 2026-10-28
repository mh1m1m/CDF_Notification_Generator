#!/usr/bin/env node
// Scripted rehearsal of the shared-database procedure (V13-DB-006; docs/hosted/ISOLATION_AND_RECOVERY_PLAN.md §6
// step 0; docs/TEST_EVIDENCE.md §1.2).
// Classification: SYNTHETIC-DATA REFERENCE IMPLEMENTATION — not CDF production.
//
// Builds a throw-away PostgreSQL cluster laid out like the Supabase project CDF GC Review — superuser
// `supabase_admin` (used only to plant faults), NON-superuser administrator `postgres` (CREATEROLE, BYPASSRLS,
// pg_read_all_data) that runs every V13 script, Supabase API roles, and a stand-in "other application" — then runs:
//   0  clean start + fingerprint F0
//   1  dry run of every migration in one transaction that rolls back → no V13 object left, fingerprint = F0
//   2  apply every migration (one transaction each, history row in the same transaction) + seed
//   3  fingerprint F1 = F0
//   4  isolation checks PASS
//   5  four planted faults are detected and cleared (membership, schema usage, latent grant, real grant)
//   6  a planted foreign view on a V13 table makes the rollback refuse, leaving V13 intact
//   7  clean rollback, fingerprint F2 = F0, nothing left
// Exit code 0 only when every expectation holds. It never connects anywhere but the local throw-away cluster.
//
// Usage: node scripts/db/rehearse-shared.mjs [--keep]
// Env:   PG_BIN (default /usr/lib/postgresql/16/bin), V13_SIM_DIR (default /var/tmp/v13-rehearsal),
//        V13_SIM_PORT (default 54339). As root the cluster runs as the OS user `postgres` (runuser).

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, chownSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PG_BIN = process.env.PG_BIN ?? '/usr/lib/postgresql/16/bin';
const DIR = process.env.V13_SIM_DIR ?? '/var/tmp/v13-rehearsal';
const PORT = process.env.V13_SIM_PORT ?? '54339';
const KEEP = process.argv.includes('--keep');
const AS_ROOT = process.getuid?.() === 0;

const MIGRATIONS = join(ROOT, 'database', 'migrations');
const SEED = join(ROOT, 'database', 'seed');
const HOSTED = join(ROOT, 'database', 'hosted');

let failures = 0;
const log = (s = '') => process.stdout.write(`${s}\n`);
const step = (s) => log(`\n=== ${new Date().toISOString().slice(11, 19)} ${s}`);
const expect = (ok, what) => {
  log(`${ok ? 'OK  ' : 'FAIL'} ${what}`);
  if (!ok) failures += 1;
};

function run(cmd, args, input) {
  const full = AS_ROOT ? ['runuser', ['-u', 'postgres', '--', cmd, ...args]] : [cmd, args];
  const r = spawnSync(full[0], full[1], { input, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return { code: r.status ?? 1, out: (r.stdout ?? '').trim(), err: (r.stderr ?? '').trim() };
}
function psql(user, sql, { allowError = false } = {}) {
  const r = run(join(PG_BIN, 'psql'),
    ['-h', DIR, '-p', PORT, '-U', user, '-d', 'postgres', '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-At', '-F', '|'], sql);
  if (r.code !== 0 && !allowError) throw new Error(`psql as ${user} failed: ${r.err}`);
  return r;
}
const asAdmin = (sql, o) => psql('postgres', sql, o);
const asSuper = (sql, o) => psql('supabase_admin', sql, o);
const file = (p) => readFileSync(p, 'utf8');

// ---------------------------------------------------------------------------------------------------------------------
// Cluster
// ---------------------------------------------------------------------------------------------------------------------
function startCluster() {
  if (existsSync(DIR)) {
    run(join(PG_BIN, 'pg_ctl'), ['-D', join(DIR, 'data'), '-m', 'immediate', 'stop']);
    rmSync(DIR, { recursive: true, force: true });
  }
  mkdirSync(DIR, { recursive: true });
  if (AS_ROOT) {
    const uid = Number(spawnSync('id', ['-u', 'postgres'], { encoding: 'utf8' }).stdout.trim());
    const gid = Number(spawnSync('id', ['-g', 'postgres'], { encoding: 'utf8' }).stdout.trim());
    chownSync(DIR, uid, gid);
  }
  let r = run(join(PG_BIN, 'initdb'), ['-D', join(DIR, 'data'), '-U', 'supabase_admin', '-A', 'trust', '--no-sync']);
  if (r.code !== 0) throw new Error(`initdb failed: ${r.err}`);
  r = run(join(PG_BIN, 'pg_ctl'),
    ['-D', join(DIR, 'data'), '-o', `-p ${PORT} -k ${DIR} -c listen_addresses=''`, '-l', join(DIR, 'log'), '-w', 'start']);
  if (r.code !== 0) throw new Error(`pg_ctl start failed: ${r.err}`);
}
function stopCluster() {
  run(join(PG_BIN, 'pg_ctl'), ['-D', join(DIR, 'data'), '-m', 'fast', 'stop']);
  rmSync(DIR, { recursive: true, force: true });
}

// A Supabase-like layout with a stand-in for the other application (schema `cdf`, login `cdf_app`).
const SUPABASE_LIKE = `
create role postgres login createrole createdb bypassrls;
grant pg_read_all_data to postgres;
grant create on database postgres to postgres;
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create role authenticator login noinherit;
grant anon, authenticated, service_role to authenticator;
create role dashboard_user nologin;
create role pgbouncer login;
create role cdf_app login;
create schema extensions;
create schema vault;
revoke all on schema vault from public;
create table vault.secrets (id int primary key, name text);
grant select on vault.secrets to public;            -- PUBLIC grant behind a schema PUBLIC cannot use
create schema supabase_migrations authorization postgres;
create table supabase_migrations.schema_migrations (version text primary key, name text, statements text[]);
alter table supabase_migrations.schema_migrations owner to postgres;
create schema cdf authorization postgres;
set role postgres;
create table cdf.sample (id int primary key, note text);
alter table cdf.sample enable row level security;
create policy sample_app on cdf.sample for select to cdf_app using (true);
grant usage on schema cdf to cdf_app;
grant select on cdf.sample to cdf_app;
create function cdf.ping() returns int language sql as 'select 1';
reset role;
create table public.profile (id int primary key);
grant select on public.profile to anon, authenticated;
`;

// ---------------------------------------------------------------------------------------------------------------------
// Procedure helpers
// ---------------------------------------------------------------------------------------------------------------------
const fingerprint = () =>
  asAdmin(file(join(HOSTED, 'foreign_objects_fingerprint.sql'))).out.split('\n').find((l) => l.startsWith('TOTAL')) ?? '';
const isoRows = () => asAdmin(file(join(HOSTED, 'isolation_checks.sql'))).out.split('\n');
const isoVerdict = () => isoRows().find((l) => l.startsWith('VERDICT')) ?? '';
const isoBreaches = () => isoRows().filter((l) => {
  const f = l.split('|');
  return !l.startsWith('VERDICT') && (Number(f[3]) > 0 || Number(f[4]) > 0);
});
const v13Left = () => asAdmin(
  "select (select count(*) from pg_roles where rolname like 'cdf\\_v13\\_%') || '|' || " +
  "(select count(*) from pg_namespace where nspname = 'cdf_notifications_v13') || '|' || " +
  "(select count(*) from pg_default_acl where pg_get_userbyid(defaclrole) like 'cdf\\_v13\\_%')").out;

function migrationFiles() {
  return readdirSync(MIGRATIONS).filter((f) => /^\d{4}_[a-z0-9_]+\.sql$/.test(f)).sort();
}
function migrationSql(f) {
  const sql = file(join(MIGRATIONS, f));
  const sum = createHash('sha256').update(sql).digest('hex');
  const [version, ...rest] = f.replace(/\.sql$/, '').split('_');
  return `${sql}\nset local role cdf_v13_owner;\ninsert into cdf_notifications_v13.schema_migrations ` +
    `(version, name, checksum_sha256, runner) values ('${version}', '${rest.join('_')}', '${sum}', 'local');\nreset role;\n`;
}
function seedSql() {
  if (!existsSync(SEED)) return '';
  return readdirSync(SEED).filter((f) => f.endsWith('.sql')).sort().map((f) => file(join(SEED, f))).join('\n');
}

// ---------------------------------------------------------------------------------------------------------------------
// Rehearsal
// ---------------------------------------------------------------------------------------------------------------------
function main() {
  step('setup: throw-away Supabase-like cluster');
  startCluster();
  asSuper(SUPABASE_LIKE);
  log(`administrator postgres is superuser: ${asAdmin('select rolsuper from pg_roles where rolname = current_user').out}`);

  step('0. clean start and F0');
  const F0 = fingerprint();
  log(F0);
  expect(v13Left() === '0|0|0', 'no V13 role, schema or default ACL before the run');

  const files = migrationFiles();
  step(`1. dry run of ${files.length} migration(s) in one transaction that rolls back`);
  const dry = asAdmin(`begin;\n${files.map(migrationSql).join('\n')}\n${seedSql()}\n` +
    "select 'dry-run tables=' || count(*) from pg_tables where schemaname = 'cdf_notifications_v13';\nrollback;\n");
  log(dry.out.split('\n').filter((l) => l.startsWith('dry-run')).join('\n'));
  expect(v13Left() === '0|0|0', 'after the dry run nothing V13 is left');
  expect(fingerprint() === F0, 'fingerprint after the dry run = F0');

  step('2. apply each migration in its own transaction, then the seed');
  for (const f of files) {
    const r = asAdmin(`begin;\n${migrationSql(f)}\ncommit;\n`, { allowError: true });
    expect(r.code === 0, `applied ${f}${r.code === 0 ? '' : `: ${r.err}`}`);
  }
  const seed = seedSql();
  if (seed) {
    const r = asAdmin(`begin;\n${seed}\ncommit;\n`, { allowError: true });
    expect(r.code === 0, `seed applied${r.code === 0 ? '' : `: ${r.err}`}`);
    const again = asAdmin(`begin;\n${seed}\ncommit;\n`, { allowError: true });
    expect(again.code === 0, 'seed applied a second time (idempotent)');
  }
  const hist = asSuper("select string_agg(version || ' ' || name, ', ' order by version) from cdf_notifications_v13.schema_migrations").out;
  log(`history: ${hist}`);
  expect(hist.split(', ').length === files.length, 'history holds one row per migration');
  const reapply = asAdmin(`begin;\n${migrationSql(files[files.length - 1])}\ncommit;\n`, { allowError: true });
  expect(reapply.code !== 0, 're-applying the last migration is refused');

  step('3. F1');
  const F1 = fingerprint();
  log(F1);
  expect(F1 === F0, 'F1 = F0 (no non-V13 object changed)');

  step('4. isolation checks');
  const v = isoVerdict();
  log(v);
  for (const b of isoBreaches()) log(`  ${b}`);
  expect(v.endsWith('|PASS'), 'isolation checks PASS');

  step('5a. planted: grant cdf_app to cdf_v13_user');
  asSuper('grant cdf_app to cdf_v13_user;');
  expect(isoVerdict().endsWith('|FAIL'), 'detected');
  asSuper('revoke cdf_app from cdf_v13_user;');
  expect(isoVerdict().endsWith('|PASS'), 'cleared after revoke');

  step('5b. planted: grant usage on schema cdf to cdf_v13_user');
  asSuper('grant usage on schema cdf to cdf_v13_user;');
  expect(isoVerdict().endsWith('|FAIL'), 'detected');
  asSuper('revoke usage on schema cdf from cdf_v13_user;');
  expect(isoVerdict().endsWith('|PASS'), 'cleared after revoke');

  step('5c. planted: latent grant (select on cdf.sample without schema usage) — expected PASS, counted as latent');
  asSuper('grant select on cdf.sample to cdf_v13_user;');
  expect(isoVerdict().endsWith('|PASS'), 'PASS with latent grant');

  step('5d. planted: add schema usage to 5c (real access) — expected FAIL');
  asSuper('grant usage on schema cdf to cdf_v13_user;');
  const b5d = isoBreaches();
  for (const b of b5d) log(`  ${b}`);
  expect(isoVerdict().endsWith('|FAIL') && b5d.length >= 3, 'detected in C04, C06 and C08');
  asSuper('revoke usage on schema cdf from cdf_v13_user; revoke select on cdf.sample from cdf_v13_user;');
  expect(isoVerdict().endsWith('|PASS'), 'cleared after revoke');

  step('6. planted foreign view on a V13 table: rollback must refuse');
  asSuper('create view public.v13_rehearsal_dependent as select id from cdf_notifications_v13.case_record;');
  const refused = asAdmin(file(join(HOSTED, 'rollback_v13.sql')), { allowError: true });
  expect(refused.code !== 0 && /ROLLBACK REFUSED/.test(refused.err), 'rollback refused');
  expect(v13Left().startsWith('3|1|'), 'V13 left intact');
  asSuper('drop view public.v13_rehearsal_dependent;');

  step('7. clean rollback and F2');
  const rb = asAdmin(file(join(HOSTED, 'rollback_v13.sql')), { allowError: true });
  expect(rb.code === 0, `rollback ran${rb.code === 0 ? '' : `: ${rb.err}`}`);
  const F2 = fingerprint();
  log(F2);
  expect(F2 === F0, 'F2 = F0 (baseline restored exactly)');
  expect(v13Left() === '0|0|0', 'no V13 role, schema or default ACL left');
}

try {
  main();
} catch (e) {
  failures += 1;
  log(`FAIL rehearsal aborted: ${e instanceof Error ? e.message : String(e)}`);
} finally {
  if (!KEEP) stopCluster();
}
log(`\nREHEARSAL ${failures === 0 ? 'PASS' : `FAIL (${failures})`}`);
process.exit(failures === 0 ? 0 : 1);
