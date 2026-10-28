-- 0000_bootstrap — V13 Enterprise roles, schema and migration history (ADR-012).
-- Classification: SYNTHETIC-DATA REFERENCE IMPLEMENTATION — not CDF production.
--
-- Runs as the database administrator: `postgres` on the shared Supabase project CDF GC Review, the cluster superuser
-- `postgres` locally and in CI. The runner wraps the whole file in ONE transaction and records it in
-- cdf_notifications_v13.schema_migrations in that same transaction.
--
-- It creates only NEW objects: three roles, one schema, one table. It alters, grants on or revokes from no object that
-- existed before it ran. Expected catalog delta on the shared project (all excluded from the GC Review fingerprint,
-- database/hosted/foreign_objects_fingerprint.sql):
--   * roles cdf_v13_owner, cdf_v13_app, cdf_v13_user (and their pg_db_role_setting rows);
--   * memberships: cdf_v13_user → cdf_v13_app (SET only); cdf_v13_owner, cdf_v13_app, cdf_v13_user → postgres (SET only);
--   * schema cdf_notifications_v13 and the table cdf_notifications_v13.schema_migrations;
--   * one global default-ACL row for role cdf_v13_owner (functions and types it creates are not usable by PUBLIC).
-- Rollback: database/hosted/rollback_v13.sql — executed only on the owner's explicit word.
--
-- PRODUCTION_SUBSTITUTION_REQUIRED: a shared prototype database. Production = a dedicated database in the CDF
-- Alibaba Cloud Riyadh RDS PostgreSQL instance, with roles issued by the CDF DBA and secrets in KMS.

do $guard$
begin
  if exists (select 1 from pg_catalog.pg_roles where rolname in ('cdf_v13_owner', 'cdf_v13_app', 'cdf_v13_user'))
     or exists (select 1 from pg_catalog.pg_namespace where nspname = 'cdf_notifications_v13') then
    raise exception 'V13 bootstrap refused: a V13 role or the V13 schema already exists; inspect before re-running'
      using errcode = 'P0001';
  end if;
end
$guard$;

-- 1. Roles. None can log in except cdf_v13_app; none bypasses RLS; none inherits privileges.
create role cdf_v13_owner nologin noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
create role cdf_v13_user  nologin noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
create role cdf_v13_app   login   noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls
  connection limit 8 password null;

comment on role cdf_v13_owner is 'V13 Enterprise (synthetic data): owns every object in schema cdf_notifications_v13. NOLOGIN; never granted to an application login. SECURITY DEFINER commands run as this role.';
comment on role cdf_v13_user  is 'V13 Enterprise (synthetic data): per-request role. The web app sets it with SET LOCAL ROLE inside each transaction; RLS policies and EXECUTE grants target it.';
comment on role cdf_v13_app   is 'V13 Enterprise (synthetic data): the only login of the V13 web app. Holds no object privileges itself; can only SET ROLE cdf_v13_user. Password set out of band as a SCRAM verifier, never in Git.';

-- Session limits for the app login: a runaway V13 query must not hold resources of the shared database.
alter role cdf_v13_app set statement_timeout = '10s';
alter role cdf_v13_app set idle_in_transaction_session_timeout = '15s';
alter role cdf_v13_app set lock_timeout = '3s';
alter role cdf_v13_app set search_path = '';

-- 2. Memberships. SET only (INHERIT FALSE): holding a membership never adds privileges by itself.
grant cdf_v13_user  to cdf_v13_app with inherit false, set true;
-- The administrator may act as each V13 role: as the owner to create V13 objects (migrations), as the app and request
-- roles to run the isolation tests (database/hosted/isolation_checks.sql) inside transactions that are rolled back.
grant cdf_v13_owner to postgres with inherit false, set true;
grant cdf_v13_app   to postgres with inherit false, set true;
grant cdf_v13_user  to postgres with inherit false, set true;

-- 3. Schema, owned by cdf_v13_owner. Not usable by PUBLIC, anon, authenticated, service_role or any GC Review role.
create schema cdf_notifications_v13 authorization cdf_v13_owner;

set local role cdf_v13_owner;

comment on schema cdf_notifications_v13 is 'V13 Enterprise — CDF Case & Notification Intelligence Platform. SYNTHETIC DATA ONLY. Isolated from every other schema in this database (ADR-012). Not exposed through the Data API.';

revoke all on schema cdf_notifications_v13 from public;
grant usage on schema cdf_notifications_v13 to cdf_v13_user;

-- Functions and types created by cdf_v13_owner are not usable by PUBLIC unless a migration grants them explicitly.
-- (A per-schema default cannot revoke the built-in PUBLIC EXECUTE default, so this row is global for the role.)
alter default privileges for role cdf_v13_owner revoke execute on functions from public;
alter default privileges for role cdf_v13_owner revoke usage on types from public;

-- 4. Migration history. V13 keeps its own history; supabase_migrations.schema_migrations is never written.
create table cdf_notifications_v13.schema_migrations (
  version          text        primary key check (version ~ '^[0-9]{4}$'),
  name             text        not null check (name ~ '^[a-z0-9_]{3,80}$'),
  checksum_sha256  text        not null check (checksum_sha256 ~ '^[0-9a-f]{64}$'),
  runner           text        not null check (runner in ('local', 'ci', 'hosted')),
  applied_at       timestamptz not null default clock_timestamp(),
  applied_by       text        not null default session_user
);
alter table cdf_notifications_v13.schema_migrations enable row level security;
-- No policies and no grants: only cdf_v13_owner (and the administrator through SET ROLE) reads or writes it.
comment on table cdf_notifications_v13.schema_migrations is 'V13 migration history (version, file checksum, runner). Written only by the V13 migration runner in the same transaction as each migration.';

reset role;
