// Supabase-like layout on the hosted-simulation cluster (tests only; synthetic objects, no real data).
//
// Reproduces what matters on the shared hosted project CDF GC Review:
//   - `postgres` is the administrator but NOT a superuser: LOGIN CREATEROLE CREATEDB BYPASSRLS, with CONNECT, CREATE
//     and TEMPORARY on the database (here: a random password, stored as a SCRAM verifier, never printed);
//   - Supabase API roles anon, authenticated, service_role, authenticator;
//   - foreign schemas auth, storage, vault, extensions and public, each with a table, granted to the API roles the
//     way Supabase grants them;
//   - the GC Review application's own schema `cdf`, owned by its role `cdf_app`, readable by `authenticated`.
// Nothing here is granted to PUBLIC or to any V13 role: V13 must see none of it (the isolation probe checks that).
//
// Roles are cluster-wide, so every scenario starts with resetHostedSim(), which drops the scratch databases
// (v13_*) and these roles first. Integration files run one at a time (vitest.config.ts).
import type postgres from "postgres";
import { connect, withCredentials, withDatabase } from "@/scripts/db/lib/migrations.mjs";
import { randomTestPassword, scramVerifier } from "@/scripts/db/lib/scram.mjs";
import { HOSTED_SIM_SUPERUSER_URL } from "./clusters";

export const SIM_DATABASE = "v13_hosted_sim";

/** Roles this layout creates or V13 creates in it; dropped before each scenario. Order: V13 roles first. */
const SIM_ROLES = [
  "cdf_v13_app",
  "cdf_v13_user",
  "cdf_v13_owner",
  "cdf_app",
  "authenticator",
  "anon",
  "authenticated",
  "service_role",
  "postgres",
];

const LAYOUT_SQL = `
create schema auth;
create table auth.users (id uuid primary key, email text not null);
insert into auth.users values ('00000000-0000-4000-8000-00000000a001', 'synthetic.user@example.test');
grant usage on schema auth to service_role;
grant select on auth.users to service_role;

create schema storage;
create table storage.objects (id uuid primary key, name text not null);
grant usage on schema storage to anon, authenticated, service_role;
grant select on storage.objects to authenticated, service_role;

create schema vault;
create table vault.secrets (id uuid primary key, secret text not null);
insert into vault.secrets values ('00000000-0000-4000-8000-00000000a002', 'synthetic-not-a-secret');

create schema extensions;
grant usage on schema extensions to anon, authenticated, service_role, postgres;

grant usage on schema public to anon, authenticated, service_role;
grant create on schema public to postgres;
create table public.gc_review_item (id uuid primary key, title text not null);
insert into public.gc_review_item values ('00000000-0000-4000-8000-00000000a003', 'Synthetic GC Review item');
grant select on public.gc_review_item to anon, authenticated, service_role;

create schema cdf authorization cdf_app;
create table cdf.gc_case (id uuid primary key, title text not null);
alter table cdf.gc_case owner to cdf_app;
insert into cdf.gc_case values ('00000000-0000-4000-8000-00000000a004', 'Synthetic GC Review case');
grant usage on schema cdf to authenticated, service_role;
grant select on cdf.gc_case to authenticated, service_role;
`;

export interface HostedSim {
  database: string;
  /** The non-superuser administrator `postgres` (random password). */
  adminUrl: string;
  /** supabase_admin on the scratch database. */
  superuserUrl: string;
  /** cdf_v13_app on the scratch database, once setAppPassword() ran. */
  appUrl: string;
  /** Sets a random password for cdf_v13_app (as `postgres`, which administers the role it created). */
  setAppPassword(): Promise<void>;
}

/** Drops the scratch databases and simulation roles, then builds the layout in a fresh database. */
export async function resetHostedSim(database = SIM_DATABASE): Promise<HostedSim> {
  const adminPassword = randomTestPassword();
  const appPassword = randomTestPassword();
  const su = connect(HOSTED_SIM_SUPERUSER_URL, "cdf-v13-tests");
  try {
    const scratch = await su<{ datname: string }[]>`
      select datname from pg_catalog.pg_database where datname ~ '^v13_[a-z0-9_]+$'`;
    for (const { datname } of scratch) await su.unsafe(`drop database if exists ${datname} with (force)`);
    const existing = await su<{ rolname: string }[]>`
      select rolname from pg_catalog.pg_roles where rolname = any(${SIM_ROLES}::text[])`;
    const present = new Set(existing.map((r) => r.rolname));
    for (const role of SIM_ROLES) {
      if (!present.has(role)) continue;
      await su.unsafe(`drop owned by ${role}`);
      await su.unsafe(`drop role ${role}`);
    }
    await su.unsafe(
      `create role postgres login createrole createdb bypassrls nosuperuser password '${scramVerifier(adminPassword)}'`,
    );
    await su.unsafe("create role anon nologin noinherit");
    await su.unsafe("create role authenticated nologin noinherit");
    await su.unsafe("create role service_role nologin noinherit bypassrls");
    await su.unsafe("create role authenticator login noinherit password null");
    await su.unsafe("grant anon, authenticated, service_role to authenticator");
    await su.unsafe("create role cdf_app nologin");
    await su.unsafe(`create database ${database} template template0 encoding 'UTF8'`);
    await su.unsafe(`grant connect, create, temporary on database ${database} to postgres`);
  } finally {
    await su.end({ timeout: 5 });
  }

  const superuserUrl = withDatabase(HOSTED_SIM_SUPERUSER_URL, database);
  const layout = connect(superuserUrl, "cdf-v13-tests");
  try {
    await layout.begin(async (tx) => {
      await tx.unsafe(LAYOUT_SQL);
    });
  } finally {
    await layout.end({ timeout: 5 });
  }

  const adminUrl = withCredentials(superuserUrl, "postgres", adminPassword);
  return {
    database,
    adminUrl,
    superuserUrl,
    appUrl: withCredentials(superuserUrl, "cdf_v13_app", appPassword),
    async setAppPassword() {
      await run(adminUrl, `alter role cdf_v13_app password '${scramVerifier(appPassword)}'`);
    },
  };
}

/** Runs SQL text on a short-lived connection (simple protocol, so several statements are allowed). */
export async function run(url: string, text: string): Promise<postgres.RowList<postgres.Row[]>> {
  const sql = connect(url, "cdf-v13-tests");
  try {
    return await sql.unsafe(text);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

/** Opens a client for a scenario; the caller ends it. */
export function client(url: string): postgres.Sql {
  return connect(url, "cdf-v13-tests");
}
