// db:lint (scripts/db/lint-migrations.mjs): every rule has a failing fixture, a well-formed migration passes, and the
// repository's own migrations lint clean. Fixtures are synthetic SQL; nothing here runs against a database.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  formatFinding,
  lintMigrationsDir,
  lintMigrationSource,
  RULES,
} from "@/scripts/db/lint-migrations.mjs";

const OWNER = "set local role cdf_v13_owner;\n";

/** Rules reported for a migration after the bootstrap (0001) or for the bootstrap itself (0000). */
const rulesOf = (sql: string, file = "0001_fixture.sql") => [
  ...new Set(lintMigrationSource(file, sql).map((f) => f.rule)),
];
const bootstrapRules = (sql: string) => rulesOf(sql, "0000_bootstrap.sql");

const GOOD_MIGRATION = `${OWNER}create table cdf_notifications_v13.example_item (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  label text not null check (pg_catalog.length(label) between 1 and 80)
);
alter table cdf_notifications_v13.example_item enable row level security;
create policy example_item_select on cdf_notifications_v13.example_item
  as permissive for select to cdf_v13_user using (true);
create policy example_item_deny_all on cdf_notifications_v13.example_item
  as restrictive for all to public using (false) with check (false);
grant select on cdf_notifications_v13.example_item to cdf_v13_user;
create function cdf_notifications_v13.example_count() returns bigint
  language sql stable security definer set search_path = ''
  as $$ select pg_catalog.count(*) from cdf_notifications_v13.example_item $$;
revoke all on function cdf_notifications_v13.example_count() from public;
grant execute on function cdf_notifications_v13.example_count() to cdf_v13_user;
-- truncate cdf_notifications_v13.example_item;   (comments are ignored)
comment on table cdf_notifications_v13.example_item is 'Synthetic example table.';
reset role;
`;

describe("rule set", () => {
  it("has unique ids, each with a reason", () => {
    const ids = RULES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const rule of RULES) expect(rule.reason.length).toBeGreaterThan(20);
    expect(ids).toHaveLength(22);
  });

  it("accepts a well-formed migration (RLS, V13 roles, deny-all policy TO PUBLIC, definer with search_path '')", () => {
    expect(lintMigrationSource("0001_fixture.sql", GOOD_MIGRATION)).toEqual([]);
  });

  it("finds nothing in the repository's migrations", () => {
    const { files, findings } = lintMigrationsDir();
    expect(files).toContain("0000_bootstrap.sql");
    expect(findings).toEqual([]);
  });
});

describe("statement rules", () => {
  const cases: [rule: string, sql: string][] = [
    [
      "statement-scope",
      `${OWNER}create table other_app.t (id integer);\nalter table other_app.t enable row level security;\n`,
    ],
    ["statement-scope", `${OWNER}create table t (id integer);\nalter table t enable row level security;\n`],
    [
      "statement-scope",
      `${OWNER}create policy p on cdf_notifications_v13.t as permissive for select to public using (true);\n`,
    ],
    [
      "statement-scope",
      `${OWNER}create policy p on cdf_notifications_v13.t as restrictive for select to public using (true);\n`,
    ],
    ["statement-scope", `${OWNER}create policy p on cdf_notifications_v13.t for select using (true);\n`],
    ["statement-scope", `${OWNER}grant select on all tables in schema other_app to cdf_v13_user;\n`],
    [
      "statement-scope",
      `${OWNER}create event trigger et on ddl_command_start execute function cdf_notifications_v13.f();\n`,
    ],
    ["statement-scope", `${OWNER}create publication pub for all tables;\n`],
    ["statement-scope", `${OWNER}alter database postgres set work_mem = '1MB';\n`],
    ["statement-scope", `${OWNER}load 'auto_explain';\n`],
    [
      "foreign-schema-reference",
      `${OWNER}create view cdf_notifications_v13.v as select id from auth.users;\n`,
    ],
    ["foreign-schema-reference", `${OWNER}select * from "auth"."users";\n`],
    ["foreign-schema-reference", `${OWNER}insert into public.t values (1);\n`],
    ["foreign-schema-reference", `${OWNER}update pg_catalog.pg_authid set rolsuper = true;\n`],
    [
      "foreign-schema-reference",
      `${OWNER}comment on table cdf_notifications_v13.t is $c$see vault.secrets$c$;\n`,
    ],
    [
      "foreign-schema-reference",
      `${OWNER}create function cdf_notifications_v13.f() returns bigint language plpgsql set search_path = '' as $$ begin return (select count(*) from storage.objects); end $$;\n`,
    ],
    ["create-extension", `${OWNER}create extension if not exists pgcrypto;\n`],
    ["alter-system", `${OWNER}alter system set work_mem = '1MB';\n`],
    [
      "security-definer-search-path",
      `${OWNER}create function cdf_notifications_v13.f() returns integer language sql security definer as $$ select 1 $$;\n`,
    ],
    ["forbidden-grantee", `${OWNER}grant select on cdf_notifications_v13.t to public;\n`],
    ["forbidden-grantee", `${OWNER}grant select on cdf_notifications_v13.t to anon, authenticated;\n`],
    ["forbidden-grantee", `${OWNER}grant execute on function cdf_notifications_v13.f() to service_role;\n`],
    ["forbidden-grantee", `${OWNER}grant usage on schema cdf_notifications_v13 to cdf_app;\n`],
    ["forbidden-grantee", `${OWNER}grant select on cdf_notifications_v13.t to postgres;\n`],
    ["truncate", `${OWNER}truncate cdf_notifications_v13.t;\n`],
    ["truncate", `${OWNER}do $$ begin truncate cdf_notifications_v13.t; end $$;\n`],
    ["server-side-file-or-program", `${OWNER}copy cdf_notifications_v13.t from '/etc/hostname';\n`],
    [
      "server-side-file-or-program",
      `${OWNER}do $$ begin perform pg_catalog.pg_read_file('/etc/hostname'); end $$;\n`,
    ],
    ["server-side-file-or-program", `${OWNER}select dblink_connect('host=db.example.test');\n`],
    ["rls-enabled", `${OWNER}create table cdf_notifications_v13.t (id integer);\n`],
    ["rls-enabled", `${OWNER}alter table cdf_notifications_v13.t disable row level security;\n`],
    ["transaction-control", `${OWNER}commit;\n`],
    ["transaction-control", `${OWNER}savepoint s1;\n`],
    ["statement-terminator", `${OWNER}comment on table cdf_notifications_v13.t is 'x'`],
    ["statement-terminator", "-- nothing but comments\n/* here either */\n"],
    ["search-path", `${OWNER}set local search_path = public;\n`],
    [
      "search-path",
      `${OWNER}create function cdf_notifications_v13.f() returns integer language sql set search_path = public, pg_temp as $$ select 1 $$;\n`,
    ],
    ["search-path", `${OWNER}select pg_catalog.set_config('search_path', 'public', false);\n`],
    ["session-role", "set role cdf_v13_owner;\n"],
    ["session-role", `${OWNER}set session authorization postgres;\n`],
    ["owner-role", "comment on table cdf_notifications_v13.t is 'x';\n"],
    ["owner-role", `${OWNER}set local role postgres;\n`],
    ["owner-role", `${OWNER}reset role;\ncomment on table cdf_notifications_v13.t is 'x';\n`],
    ["owner-to", `${OWNER}alter table cdf_notifications_v13.t owner to postgres;\n`],
    ["bootstrap-only-role-and-schema", `${OWNER}create role cdf_v13_extra nologin;\n`],
    ["bootstrap-only-role-and-schema", `${OWNER}create schema cdf_notifications_v13_extra;\n`],
    [
      "bootstrap-only-role-and-schema",
      `${OWNER}alter default privileges in schema cdf_notifications_v13 grant select on tables to cdf_v13_user;\n`,
    ],
    ["bootstrap-only-role-and-schema", `${OWNER}grant cdf_v13_owner to cdf_v13_app with inherit false;\n`],
    ["bootstrap-only-role-and-schema", `${OWNER}alter role cdf_v13_app connection limit 8;\n`],
    ["notify-listen", `${OWNER}notify cdf_channel, 'x';\n`],
    ["notify-listen", `${OWNER}listen cdf_channel;\n`],
    ["notify-listen", `${OWNER}do $$ begin perform pg_catalog.pg_notify('c', 'x'); end $$;\n`],
    [
      "unparsed-statement",
      `${OWNER}create function cdf_notifications_v13.f() returns integer language c as 'libc', 'abs';\n`,
    ],
    ["unparsed-statement", `${OWNER}comment on table cdf_notifications_v13.t is 'unterminated;\n`],
  ];

  it.each(cases)("%s: %s", (rule, sql) => {
    expect(rulesOf(sql)).toContain(rule);
  });

  it("covers every rule except the file-set rules with at least one fixture", () => {
    const covered = new Set([...cases.map(([rule]) => rule), "role-attributes", "membership-options"]);
    const fileSetRules = new Set(["file-name", "contiguous-versions"]);
    for (const rule of RULES) if (!fileSetRules.has(rule.id)) expect(covered, rule.id).toContain(rule.id);
  });

  it("reports the line of the offending statement", () => {
    const [finding] = lintMigrationSource(
      "0001_fixture.sql",
      `${OWNER}\n\ntruncate cdf_notifications_v13.t;\n`,
    );
    expect(finding).toMatchObject({ rule: "truncate", file: "0001_fixture.sql", line: 4 });
    expect(formatFinding(finding!)).toMatch(/^database\/migrations\/0001_fixture\.sql:4: \[truncate\] /);
  });

  it("ignores statements inside comments and words inside strings", () => {
    expect(
      rulesOf(
        `${OWNER}-- truncate cdf_notifications_v13.t;\n/* drop table public.t; */\ncomment on table cdf_notifications_v13.t is 'we never notify';\n`,
      ),
    ).toEqual([]);
  });
});

describe("bootstrap rules (roles and memberships)", () => {
  it.each([
    ["create role cdf_v13_user nologin superuser;\n", "SUPERUSER"],
    ["create role cdf_v13_user nologin bypassrls noinherit;\n", "BYPASSRLS"],
    ["create role cdf_v13_app login inherit;\n", "INHERIT"],
    ["create role cdf_v13_app login noinherit password 'local-only-not-a-secret';\n", "password"],
    ["create role cdf_v13_user login noinherit;\n", "LOGIN"],
    ["create role cdf_v13_user nologin noinherit in role cdf_v13_owner;\n", "IN"],
  ])("role-attributes: %s", (sql, word) => {
    const findings = lintMigrationSource("0000_bootstrap.sql", sql);
    expect(findings.map((f) => f.rule)).toContain("role-attributes");
    expect(findings.some((f) => f.message.includes(word))).toBe(true);
  });

  it.each([
    "grant cdf_v13_user to cdf_v13_app;\n",
    "grant cdf_v13_user to cdf_v13_app with inherit true;\n",
    "grant cdf_v13_user to cdf_v13_app with inherit false, admin true;\n",
  ])("membership-options: %s", (sql) => {
    expect(bootstrapRules(sql)).toContain("membership-options");
  });

  it("accepts a SET-only membership", () => {
    expect(bootstrapRules("grant cdf_v13_user to cdf_v13_app with inherit false, set true;\n")).toEqual([]);
  });
});

describe("file-set rules", () => {
  let dir: string | undefined;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  function migrationsDir(files: Record<string, string>): string {
    dir = mkdtempSync(join(tmpdir(), "v13-lint-"));
    for (const [name, sql] of Object.entries(files)) writeFileSync(join(dir, name), sql);
    return dir;
  }

  const bootstrap = "create schema cdf_notifications_v13;\n";

  it("file-name: NNNN_name.sql with a lower-snake name of 3–80 characters, nothing else", () => {
    const d = migrationsDir({
      "0000_bootstrap.sql": bootstrap,
      "1_short.sql": OWNER,
      "0001_Upper.sql": OWNER,
      "0001_ab.sql": OWNER,
      "notes.txt": "x",
    });
    const findings = lintMigrationsDir(d).findings.filter((f) => f.rule === "file-name");
    expect(findings.map((f) => f.file).sort()).toEqual([
      "0001_Upper.sql",
      "0001_ab.sql",
      "1_short.sql",
      "notes.txt",
    ]);
  });

  it("contiguous-versions: no gaps and no duplicates", () => {
    const gap = lintMigrationsDir(
      migrationsDir({ "0000_bootstrap.sql": bootstrap, "0002_skipped.sql": OWNER }),
    );
    expect(gap.findings.map((f) => f.rule)).toContain("contiguous-versions");
    rmSync(dir!, { recursive: true, force: true });

    const duplicate = lintMigrationsDir(
      migrationsDir({ "0000_bootstrap.sql": bootstrap, "0001_first.sql": OWNER, "0001_second.sql": OWNER }),
    );
    expect(duplicate.findings).toContainEqual(
      expect.objectContaining({ rule: "contiguous-versions", file: "0001_second.sql" }),
    );
  });
});
