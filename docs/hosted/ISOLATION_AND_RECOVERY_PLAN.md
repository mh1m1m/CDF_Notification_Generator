# V13 on the shared CDF GC Review project — isolation and recovery plan

**Classification:** SYNTHETIC-DATA REFERENCE IMPLEMENTATION — not CDF production. DEV/staging only.
**Decision:** ADR-012 (`docs/adr/ADR-012-shared-supabase-project-isolation.md`).
**Owner instruction (28 Oct 2026, 00:29 UTC):** use the existing Supabase project _CDF GC Review_ with a dedicated schema
`cdf_notifications_v13`; do not create another project or upgrade the plan; preserve all GC Review functionality; "Before
executing migrations, inspect the existing database dependencies and create an appropriate recovery plan. If safe
isolation cannot be demonstrated, stop database modifications and report the specific blocker."

This plan is that safeguard. No V13 statement runs on the shared project until §6 steps 0–1 pass, and every later
V13 migration repeats §5.

## 1. Scope

| Item                | Value                                                                                         |
| ------------------- | --------------------------------------------------------------------------------------------- |
| Supabase project    | CDF_GC_Review, ref `jeseeznffxlxmcljpmiu`, region eu-central-1, PostgreSQL 17.11, status ACTIVE_HEALTHY |
| V13 schema          | `cdf_notifications_v13` (new)                                                                 |
| V13 roles           | `cdf_v13_owner` (NOLOGIN, owns V13 objects), `cdf_v13_app` (the only V13 login), `cdf_v13_user` (per-request role) |
| V13 data            | synthetic only (`CDF-DEMO-2026-000N`, `@example.test`, Employee Alpha / Investigator Beta …)  |
| Out of scope        | every other schema, role, function, policy, extension, publication and setting of the project |

## 2. What already exists (read-only inspection, 28 Oct 2026 ≈ 00:30–01:00 UTC)

Counts come from `database/hosted/foreign_objects_fingerprint.sql`; the per-object list (names and hashes, no rows) is
kept outside this public repository in the project's shared folder (§3).

| Area                  | Finding                                                                                                   | Consequence for V13 |
| --------------------- | --------------------------------------------------------------------------------------------------------- | ------------------- |
| Schemas               | 11: `auth`, `cdf`, `extensions`, `graphql`, `graphql_public`, `pgbouncer`, `public`, `realtime`, `storage`, `supabase_migrations`, `vault` | the new schema name collides with nothing |
| GC Review application | schema `cdf`: 32 tables, 8 functions; reachable only by `postgres` and its own login `cdf_app`; no PUBLIC, `anon` or `authenticated` privilege; its tables do not use RLS, so schema and table privileges are its only barrier | V13 roles must never gain any privilege on, or membership in anything that has, `cdf` (C04, C06, C08) |
| PUBLIC privileges     | PUBLIC can use only schema `public`; it can execute no function and read or write no relation there; CREATE on `public` is not granted to PUBLIC | V13 roles get nothing outside their schema through PUBLIC (C04, C06, C07) |
| Database privileges   | PUBLIC has CONNECT and TEMP on database `postgres`                                                        | V13 login can connect and create temporary tables (session-local, harmless) |
| Roles                 | 31 (Supabase standard roles plus `cdf_app`); `postgres` is not a superuser (CREATEROLE, BYPASSRLS); `createrole_self_grant` is empty | the bootstrap grants `postgres` SET-only membership in the V13 roles explicitly |
| Default ACLs          | 24, all schema-scoped to Supabase schemas; no global default ACL                                          | objects created in `cdf_notifications_v13` inherit no foreign default grant |
| Extensions            | `pg_stat_statements`, `pgcrypto`, `plpgsql`, `supabase_vault`, `uuid-ossp`                                 | V13 creates no extension and uses only core functions (`gen_random_uuid`, `sha256`) |
| Event triggers        | 6 Supabase standard (`pgrst_ddl_watch`, `pgrst_drop_watch`, `issue_*`)                                    | V13 DDL makes PostgREST reload its schema cache once per migration; no GC Review behaviour changes |
| Publication           | `supabase_realtime`, no tables                                                                            | V13 adds no table to any publication |
| Supabase migrations   | 2 rows in `supabase_migrations.schema_migrations`                                                         | V13 never writes it: no `apply_migration`; V13 keeps `cdf_notifications_v13.schema_migrations` |
| Auth                  | project-wide, 1 user                                                                                      | V13 uses no Supabase Auth user, JWT or `auth.uid()` (ADR-004) |
| Storage               | no buckets                                                                                                | V13 M1 stores no objects; any later bucket needs its own ADR |
| Vault                 | present; not usable by PUBLIC                                                                             | V13 roles have no access (C04, C06, C08) |
| Data API              | `cdf_notifications_v13` is not an exposed schema; `anon`/`authenticated`/`service_role` have no USAGE on it | even if someone exposed it, the API roles would see nothing (C12) |
| Connections           | `max_connections` 60, 13 in use at inspection                                                              | `cdf_v13_app` is capped at 8 connections and short timeouts |
| Advisors              | security: 1 WARN (leaked-password protection off, project-wide Auth setting); performance: 4 INFO (unindexed foreign keys in `cdf`) | recorded as the baseline; V13 must add none |
| GC Review deployment  | Vercel production deployment READY at inspection                                                          | checked again after each V13 change (§5.4) |

## 3. Baseline fingerprint (BEFORE)

`foreign_objects_fingerprint.sql` hashes the catalog definition of every object that is **not** V13 (relations with
columns, ACLs and RLS flags; functions with an md5 of their source, owner, ACL, settings; policies; triggers; indexes;
constraints; roles with attributes and memberships; schemas with ACLs; default ACLs; event triggers; publications;
extensions; Supabase migration rows). It reads no application rows. V13 objects (the V13 schema, the three V13 roles,
their memberships and their own default-ACL rows) are excluded, so the hashes must not move when V13 changes.

Taken 28 Oct 2026 ≈ 00:37 UTC and re-taken ≈ 01:00 UTC with identical results:

| Category            | Objects | md5                                |
| ------------------- | ------: | ---------------------------------- |
| constraints         |     183 | `f4c28ed19698bbbf5c223f9d36ffae2c` |
| default_acls        |      24 | `3562244446907f4e213d94aef3954518` |
| event_triggers      |       6 | `3e1824a9f2b9cb6974cf76a6aa410ca1` |
| extensions          |       5 | `ed4972df3514643e85622b7e5fce9183` |
| functions           |     111 | `ab476c9c0c734b7edd3e3d9788310980` |
| indexes             |     179 | `b07402fbb474f34f7eccb0075d37208e` |
| publications        |       1 | `155d07d7fb4574928e4dee852cc5f93e` |
| relations           |      83 | `733941034e7b7a5e53ff84269f995dda` |
| roles               |      31 | `49e5fe1cfbc41f13d360b7052343d6e8` |
| schemas             |      11 | `2a88d08b8403225327fb3855dc909cb5` |
| supabase_migrations |       2 | `830c1ea91cdb3a99bc807cb37e132183` |
| triggers            |      12 | `6994eb33744549c905133c399b7678ea` |
| **TOTAL**           | **648** | **`40c9efe5697d19552d15f5ef85c2f85f`** |

Per-object detail (648 rows of name + md5, from `foreign_objects_detail.sql`):
`/mnt/project-files/notifications/v13_enterprise/hosted/gc_review_fingerprint_before_detail.json`
(sha256 `15f783e804fed882dfffe97969840cc8be7ad983cffa37c94f360c59afada425`). It is not committed here because it names
GC Review objects.

## 4. Isolation controls

1. **Separate roles, no inheritance.** `cdf_v13_owner` (NOLOGIN) owns every V13 object; `cdf_v13_app` is the only V13
   login and holds no object privilege; each request runs `SET LOCAL ROLE cdf_v13_user`. All three are NOSUPERUSER,
   NOBYPASSRLS, NOCREATEROLE, NOCREATEDB, NOREPLICATION, NOINHERIT. Memberships carry `SET TRUE, INHERIT FALSE` only.
2. **One schema, closed by default.** `cdf_notifications_v13` is owned by `cdf_v13_owner`; PUBLIC has nothing on it; only
   `cdf_v13_user` has USAGE. Functions and types created by the owner are not executable/usable by PUBLIC by default.
3. **Nothing outside the schema.** V13 migrations may create, alter, grant or revoke only inside the V13 schema and on
   the three V13 roles (`scripts/db/lint-migrations.mjs` enforces it; CI fails otherwise). No extension, no publication,
   no event trigger, no `ALTER SYSTEM`, no change to any Supabase setting.
4. **RLS on every V13 table**, no table privilege beyond what a policy needs, writes only through `SECURITY DEFINER`
   command functions with `SET search_path = ''` that write their audit event in the same transaction (C10, C11).
5. **Own migration history.** `cdf_notifications_v13.schema_migrations`; the Supabase migration tool is never used, so
   GC Review's history stays untouched (fingerprint category `supabase_migrations`).
6. **No shared Supabase services.** No Supabase Auth users, Storage buckets, Realtime, Vault, Edge Functions or Data API
   for V13. Identity is the V13 persona session (ADR-004).
7. **Resource limits.** `cdf_v13_app`: connection limit 8, `statement_timeout` 10 s, `idle_in_transaction_session_timeout`
   15 s, `lock_timeout` 3 s, empty `search_path`. Synthetic volumes only.
8. **Credential handling.** The `cdf_v13_app` password is generated per environment, set on the database only as a
   SCRAM-SHA-256 verifier (the plaintext never reaches the database or its logs) and stored only as a sensitive Vercel
   environment variable. It is never committed, logged or shown. Rotation = set a new verifier and update the variable.
9. **Coexistence rules for V13 code.** No `NOTIFY`/`LISTEN`; advisory locks only with the V13 key namespace
   (`pg_advisory_xact_lock(hashtext('cdf_notifications_v13'), key)`); no long transactions; no reads of catalog tables
   for application logic.

## 5. Verification

### 5.1 Fingerprint, before and after every V13 change
Run `foreign_objects_fingerprint.sql` immediately before and after. Every category hash and the TOTAL must be identical.
Any difference is a stop condition (§6) and an incident (§8).

### 5.2 Isolation checks from the administrator session — `database/hosted/isolation_checks.sql`
One transaction ending in ROLLBACK; probes never read rows (`limit 0`) and never call a foreign function; a probe that
unexpectedly succeeds is undone at once. Checks: C00 preconditions · C01 role attributes · C02 memberships · C03 who can
act as a V13 role · C04 no USAGE/CREATE on any foreign schema or the database · C05 V13 schema ACL · C06 no privilege on
any foreign relation · C07 no callable foreign function · C08 live `select … limit 0` probe of every foreign relation as
each V13 role (expect 42501) · C09 no CREATE SCHEMA / CREATE TABLE outside V13 · C10 every V13 table has RLS, is owned by
the owner and grants nothing to PUBLIC or foreign roles · C11 every V13 function is owned by the owner, not executable by
PUBLIC, and definer functions pin `search_path` · C12 `anon`, `authenticated`, `service_role`, `authenticator`, `cdf_app`,
`dashboard_user`, `pgbouncer` cannot use the V13 schema. VERDICT must be PASS (0 breaches, 0 unexpected errors).

### 5.3 Checks from the V13 login itself
`SET ROLE` is authorised against the session user, so escalation can only be tested from a real `cdf_v13_app` session.
`app/api/health/isolation` (enabled only with `V13_ISOLATION_PROBE=enabled`, behind Vercel Authentication, counts only,
no names) runs from the deployed app: SET ROLE to every other role must fail except `cdf_v13_user`; the C08 probes as
`cdf_v13_app` and `cdf_v13_user`; reading `cdf_notifications_v13` succeeds only through granted paths. The same suite runs
locally and in CI against a Supabase-like role layout (`tests/integration`).

### 5.4 GC Review still works
- Fingerprint unchanged (§5.1): its tables, columns, functions, policies, grants, roles and settings are as before.
- `cdf_app` privileges unchanged (part of the relation ACLs and role memberships in the fingerprint).
- The GC Review Vercel production deployment stays READY and its home page answers HTTP 200 after each V13 change.
- Supabase advisors: no new security or performance finding attributable to GC Review objects.
- Row counters of `cdf` tables (`pg_stat_user_tables`) are recorded before and after; V13 statements contain no DML on them.

### 5.5 Advisors
`get_advisors` (security, performance) before and after; any new finding on V13 objects is fixed before the next step.

## 6. Procedure (go / no-go)

| Step | Action | Pass condition | If it fails |
| ---- | ------ | -------------- | ----------- |
| 0 | Local rehearsal on PostgreSQL 16 with a Supabase-like non-superuser `postgres` (`scripts/db`, CI) | bootstrap applies; fingerprint F1 = F0; isolation PASS; planted breaches detected; rollback refused with a planted foreign dependency; rollback restores F0 exactly | fix the scripts; nothing hosted has run |
| 1 | Hosted **dry run**: `0000_bootstrap` inside a transaction ending in ROLLBACK | no error; fingerprint afterwards = BEFORE | stop; report the exact error; no change exists |
| 2 | Hosted apply of `0000_bootstrap` (one transaction, recorded in V13 history) | commit succeeds | the transaction rolls back by itself; report |
| 3 | Fingerprint AFTER | identical to BEFORE in every category | **stop all V13 DB work**, report the differing category and object (detail query), rollback only on the owner's word |
| 4 | `isolation_checks.sql` | VERDICT PASS | stop; no password is set yet, so nobody can log in as V13; report; fix forward or roll back on the owner's word |
| 5 | Advisors + GC Review deployment check + `cdf` counters | no new finding; READY + HTTP 200 | stop and report |
| 6 | Set the `cdf_v13_app` SCRAM verifier; store the URL in Vercel (sensitive) | login works through the pooler (health endpoint) | report; the app shows "database not configured" and nothing else changes |
| 7 | Deploy; run §5.3 from the deployed app | all probes refused; health 200 | stop; remove the Vercel variable (cuts the V13 login) and report |
| 8+ | Each later V13 migration: lint → local + CI green → independent review ACCEPT → dry run → apply → §5.1, §5.2, §5.4 | as above | as above |

## 7. Recovery

- **Cut access first.** Removing `V13_DATABASE_URL` from Vercel, or `alter role cdf_v13_app nologin`, stops all V13
  database activity at once without touching GC Review.
- **Forward fix** is the normal path for a defective V13 migration (a new numbered migration; applied migrations are
  never edited — the runner refuses checksum drift).
- **Full removal:** `database/hosted/rollback_v13.sql`, **only on the owner's explicit word**. It refuses if anything
  outside the V13 schema depends on a V13 object, if a V13 role owns or holds anything outside it, or if the schema holds
  an object not owned by `cdf_v13_owner`; it drops the schema **as `cdf_v13_owner`** (which owns no GC Review object, so a
  missed dependency makes the drop fail instead of cascading), restores the owner's default privileges and drops the
  three roles, then verifies nothing V13 remains. Afterwards the fingerprint must equal the BEFORE baseline exactly
  (rehearsed locally: F2 = F0).
- **What rollback cannot do:** it cannot restore GC Review objects; nothing in V13 changes them, and §5.1 proves that
  after every step. The free plan has no point-in-time recovery, so GC Review's own backup posture is unchanged by V13
  and not improved by this plan.

## 8. Incident handling

An incident is any fingerprint difference, any isolation breach, any GC Review error that appears after a V13 change,
or any sign of non-synthetic data in V13. Response: stop V13 database work; cut V13 access (§7); record EXPECTED /
ACTUAL / DRIFT / CAUSE / REMEDIATION in `docs/OPEN_ISSUES.md`; tell the owner in the project thread with the evidence;
take no further action on the shared project without the owner's word.

## 9. Residual risks (cannot be removed while sharing one database)

| Risk | Why it remains | Mitigation |
| ---- | -------------- | ---------- |
| Metadata visibility | every PostgreSQL role can read the system catalogs: GC Review schema, table, column and function names and function source text are visible to the V13 login (never row data) | accepted for synthetic DEV/staging; revoking catalog access would change the project globally |
| Shared resources | CPU, memory, I/O, disk and the 60-connection limit are shared | connection limit 8, timeouts, synthetic volumes; advisors and deployment checked after each change |
| Shared administrator | the `postgres` administrator (used by the connector) can act on both apps | V13 changes follow §6 with fingerprints; only the scripts in `database/` run |
| Project-wide settings | Auth settings, Data API exposure, network restrictions, backups and pausing apply to both apps | V13 depends on none of them; any change to them is the owner's |
| NOTIFY and advisory locks are global | any role may `NOTIFY` any channel or take any advisory lock | V13 code never notifies and uses its own lock namespace (§4.9) |
| Session visibility | `pg_stat_activity` shows other sessions' role and application names (not their queries) | accepted |
| Shared logs | Supabase logs show both apps' activity | V13 logs no personal data; data is synthetic |

## 10. Production substitution

`PRODUCTION_SUBSTITUTION_REQUIRED`: sharing a database between two applications is acceptable only for synthetic
DEV/staging. Production requires a dedicated database (or instance) in the CDF Alibaba Cloud Riyadh RDS PostgreSQL
estate, roles issued by the CDF DBA, credentials in KMS, and the CDF corporate IdP instead of persona sign-in
(`architecture/PRODUCTION_MAPPING.md` in the case-management repository describes the same path).

## 11. Evidence log

| When (UTC, 28 Oct 2026) | Step | Result | Evidence |
| ----------------------- | ---- | ------ | -------- |
| ≈ 00:37 | BEFORE fingerprint | 648 objects, TOTAL `40c9efe5697d19552d15f5ef85c2f85f` | §3; detail JSON in the shared folder |
| ≈ 01:00 | BEFORE re-taken with the final query (V13-role default ACLs excluded) | identical in every category | §3 |
| ≈ 00:55–01:00 | Step 0 local rehearsal (PostgreSQL 16, Supabase-like non-superuser `postgres`) | bootstrap OK; F1 = F0; isolation PASS; planted breaches (membership, schema usage, table grant) detected and cleared; rollback refused a planted foreign view; rollback restored F0 exactly. The rehearsal also caught one defect in the first draft of the bootstrap (`comment on schema` ran before `set role`), fixed before any hosted run | `docs/TEST_EVIDENCE.md` §1 |
| 01:02:39 | GC Review counters before | `cdf`: 32 tables, 109 live rows, ins 116 / upd 50 / del 3; 13 connections | §5.4 |
| ≈ 01:02 | **Step 1 hosted dry run** (bootstrap, then ROLLBACK) | no error; roles, schema ACL `{cdf_v13_owner=UC/cdf_v13_owner,cdf_v13_user=U/cdf_v13_owner}`, SET-only memberships, 2 owner default-ACL rows and RLS on the history table as designed; afterwards fingerprint = BEFORE and no V13 object left | `docs/TEST_EVIDENCE.md` §2 |
| 01:03:21 | **Step 2 hosted apply** of `0000_bootstrap` (sha256 `0f80be82…5c01`) | committed; history row `0000 bootstrap` runner `hosted` applied_by `postgres` | `cdf_notifications_v13.schema_migrations` |
| ≈ 01:04 | **Step 3 fingerprint AFTER** | identical to BEFORE in all 12 categories, TOTAL `40c9efe5697d19552d15f5ef85c2f85f` | `docs/TEST_EVIDENCE.md` §2 |
| ≈ 01:05 | Step 4 isolation checks, first run | **FAIL from a checker defect, not an access path**: C06 counted Supabase's PUBLIC `SELECT` on two `pg_stat_statements` views in schema `extensions`, which V13 roles cannot use; C08's live probes of the same views were refused (42501). C06 corrected to require schema USAGE (as C07 already did) with latent grants reported; regression-tested locally (latent grant → PASS, real grant → FAIL) | §5.2; `docs/OPEN_ISSUES.md` OI-002 |
| ≈ 01:06 | **Step 4 isolation checks, corrected** | **PASS**: 27 checks, 0 breaches, 0 unexpected; 11 foreign schemas closed, 83 foreign relations with no effective privilege (2 latent PUBLIC grants), 111 foreign functions not callable, 75 live probes refused per role, CREATE refused, API roles cannot reach V13 | `docs/TEST_EVIDENCE.md` §2 |
| 01:07 | **Step 5** advisors, counters, GC Review | security: the pre-existing WARN plus one new INFO on V13 (`rls_enabled_no_policy` on the history table — deny-all by design; an explicit restrictive policy comes with the first DB-team migration); performance: the same 4 pre-existing INFO; `cdf` counters unchanged; GC Review production deployment READY, `/` and `/api/health` HTTP 200 | §5.4–5.5 |
| _pending_ | Steps 6–7 (app login verifier, deployment, app-login probes) | waits for the foundation build | |
