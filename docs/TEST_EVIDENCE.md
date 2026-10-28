# Test evidence — CDF V13 Enterprise

**SYNTHETIC-DATA REFERENCE IMPLEMENTATION — not CDF production.** Every entry records what was run, against what,
when, by whom, with which file versions, and the real result. Nothing here is inferred. A failing result stays listed.
Newest entries go at the end of each section.

## 1. Local rehearsal of the shared-database procedure (plan §6 step 0)

**Environment.** PostgreSQL 16.15 cluster in the build sandbox, laid out like Supabase: superuser `supabase_admin`
(used only to plant faults), non-superuser administrator `postgres` (CREATEROLE, BYPASSRLS — the role that runs every
V13 script, as on the hosted project), roles `anon`, `authenticated`, `service_role`, `cdf_app`, and a stand-in for the
other application (schema `cdf` with a table, schemas `extensions`, `vault`, `supabase_migrations`, a PUBLIC grant behind
an unusable schema). Runner: Chief Architect.

### 1.1 First rehearsal — 28 Oct 2026 ≈ 00:55–01:00 UTC

Before any hosted statement ran. The bootstrap applied; the fingerprint after equalled the fingerprint before; the
isolation checks passed; planted breaches (membership, schema usage, table grant) were detected and cleared; the
rollback refused to run with a planted foreign view and, once that view was gone, restored the baseline exactly. It
also caught one defect in the first draft of `0000_bootstrap.sql` (`comment on schema` ran before `set role`, so the
non-superuser administrator was refused), fixed before any hosted run. The command output of this first run was not
kept in the repository; §1.2 repeats the whole rehearsal with the committed files.

### 1.2 Full repeat with the committed files — 28 Oct 2026 01:27:04–01:27:05 UTC

Files (sha256): `0000_bootstrap.sql` `0f80be82…5c01` · `foreign_objects_fingerprint.sql` `67f6e245…a835c` ·
`isolation_checks.sql` `84f8fffd…d236` · `rollback_v13.sql` `63b88dc7…014f`.

| Step | Action | Result |
| ---- | ------ | ------ |
| 0 | `rollback_v13.sql` from a previous run, then fingerprint F0 | F0 = `TOTAL 35 9cd30c2071b998f505861d9ab42eb62d` |
| 1 | Dry run: bootstrap inside a transaction that rolls back | 3 V13 roles existed inside the transaction; after it: 0 roles, 0 schema; fingerprint = F0 |
| 2 | Apply bootstrap + history row in one transaction | history `0000 bootstrap 0f80be826fc8 local postgres` |
| 3 | Fingerprint F1 | `TOTAL 35 9cd30c2071b998f505861d9ab42eb62d` — **F1 = F0** |
| 4 | `isolation_checks.sql` | `VERDICT 27 checks, 0 breaches, 0 unexpected — PASS` |
| 5a | Plant `grant cdf_app to cdf_v13_user` | `C02_memberships cdf_v13_user breach: member of cdf_app` → FAIL; after revoke → PASS |
| 5b | Plant `grant usage on schema cdf to cdf_v13_user` | `C04 breach: cdf` → FAIL; after revoke → PASS |
| 5c | Plant `grant select on cdf.sample to cdf_v13_user` without schema usage | PASS, reported as a latent grant (`latent grants … 2`) |
| 5d | Add schema usage to 5c (real access) | `C04 breach: cdf`, `C06 EFFECTIVE privilege on 1 relation`, `C08 probe succeeded: cdf.sample` → FAIL (3 breaches); after revoke → PASS |
| 6 | Plant a view outside V13 on a V13 table, run `rollback_v13.sql` | `ROLLBACK REFUSED: 1 object(s) outside cdf_notifications_v13 depend on V13 objects`; V13 left intact (3 roles, 1 schema) |
| 7 | Remove the view, run `rollback_v13.sql`, fingerprint F2 | `TOTAL 35 9cd30c2071b998f505861d9ab42eb62d` — **F2 = F0**; 0 roles, 0 schema, 0 default-ACL rows left |

### 1.3 Owner login script — 28 Oct 2026 ≈ 02:00 UTC

`database/hosted/owner_set_app_login.sql` (sha256 `97626358…2c53`) was run on the same Supabase-like PostgreSQL 16
cluster as the non-superuser administrator `postgres`, the way the Supabase SQL editor runs it, after applying
`0000_bootstrap.sql`. The test script printed checks only, never a generated value.

| # | Check | Result |
| - | ----- | ------ |
| 1 | Two result rows, named `V13_DATABASE_URL` and `V13_SESSION_SECRET` | PASS |
| 2 | URL shape: `cdf_v13_app.<project ref>`, 64-hex password, pooler host, port 6543, `sslmode=require` | PASS |
| 3 | Session secret is base64url, 64 characters | PASS |
| 4 | Session secret decodes to 48 bytes (at least 32 required) | PASS |
| 5 | Stored as a `SCRAM-SHA-256$4096:` verifier | PASS |
| 6 | Plaintext not stored | PASS |
| 7 | Temporary functions removed (checked in the same session) | PASS |
| 8 | A second run gives a new password | PASS |
| 9 | Login with the new password works (SCRAM over TCP, scram-only access rule for the test) | PASS |
| 10 | The app login can switch to `cdf_v13_user` | PASS |
| 11 | Old password refused after rotation | PASS |
| 12 | Wrong password refused | PASS |
| 13 | No generated password in the server log | PASS |
| 14 | Guard refuses an unexpected role (nothing changed) | PASS |
| 15 | Rollback restored the baseline: F2 = F0 = `TOTAL 35 9cd30c2071b998f505861d9ab42eb62d` | PASS |
| 16 | No V13 roles left | PASS |

**Result: 16 / 16 PASS.** The script ran in 0.04 s. The temporary access rule was removed and the configuration
reloaded.

## 2. Hosted project CDF GC Review (`jeseeznffxlxmcljpmiu`, PostgreSQL 17.11)

Runner: Chief Architect, through the Supabase connector as the project administrator `postgres`. Only the scripts named
here ran; no GC Review row was read or written.

| When (UTC, 28 Oct 2026) | Action | Files | Result |
| ----------------------- | ------ | ----- | ------ |
| ≈ 00:37, re-taken ≈ 01:00 | BEFORE fingerprint of every non-V13 object | `foreign_objects_fingerprint.sql` | 648 objects in 12 categories, TOTAL `40c9efe5697d19552d15f5ef85c2f85f` (plan §3) |
| 01:02:39 | GC Review activity counters | — | 32 tables, 109 live rows, ins 116 / upd 50 / del 3; 13 connections |
| ≈ 01:02 | Dry run of `0000_bootstrap` ending in ROLLBACK | `0000_bootstrap.sql` `0f80be82…` | no error; roles, schema ACL, memberships, default-ACL rows and history-table RLS as designed; afterwards fingerprint = BEFORE, no V13 object left |
| 01:03:21 | **Apply** `0000_bootstrap` | `0f80be82…` | committed; history row `0000 bootstrap`, runner `hosted`, applied by `postgres` |
| ≈ 01:04 | AFTER fingerprint | — | identical in all 12 categories, TOTAL `40c9efe5697d19552d15f5ef85c2f85f` |
| ≈ 01:05 | Isolation checks, first run | `isolation_checks.sql` (first version) | **FAIL — checker defect, not access** (OI-002): C06 counted PUBLIC grants on two `pg_stat_statements` views in `extensions`, which V13 roles cannot use; C08's live probes of the same views were refused (42501) |
| ≈ 01:06 | Isolation checks, corrected C06 | `isolation_checks.sql` `f7ad5057…` | **PASS**: 27 checks, 0 breaches, 0 unexpected |
| 01:07 | Advisors, counters, GC Review app | — | security: the pre-existing WARN plus one new INFO on V13 (`rls_enabled_no_policy` on the history table, deny-all by design, OI-009); performance: the same 4 pre-existing INFO; counters unchanged; GC Review production deployment READY, `/` and `/api/health` HTTP 200 |
| 01:18 | Re-verification: fingerprint | `foreign_objects_fingerprint.sql` `67f6e245…` | identical, TOTAL 648 `40c9efe5697d19552d15f5ef85c2f85f` |
| 01:18 | Re-verification: isolation checks | `f7ad5057…` | PASS, 27 / 0 / 0 |
| ≈ 01:28 | Isolation checks after a wording fix in C06's detail text (logic unchanged) | `84f8fffd…` | **PASS**, 27 / 0 / 0 (detail below) |
| 01:24–01:25 | Facts | — | server 17.11; V13 history holds 1 migration; `postgres` is not superuser, has BYPASSRLS and is a member of `pg_read_all_data` (OI-014) |

Detail of the 01:28 run (passed / breaches / unexpected per role):

| Check | `cdf_v13_user` | `cdf_v13_app` | `cdf_v13_owner` | All |
| ----- | -------------- | ------------- | --------------- | --- |
| C00 preconditions | | | | 1/0/0 |
| C01 role attributes | 1/0/0 | 1/0/0 | 1/0/0 | |
| C02 memberships | member of nothing | member of `cdf_v13_user` (SET only) | member of nothing | 0 breaches |
| C03 who can act as a V13 role | | | | 7/0/0 (`cdf_v13_app`, `postgres`) |
| C04 foreign schema privileges | 11/0/0 | 11/0/0 | 11/0/0 | |
| C05 V13 schema ACL | | | | 5/0/0 `{cdf_v13_owner=UC/cdf_v13_owner,cdf_v13_user=U/cdf_v13_owner}` |
| C06 foreign relation privileges | 83/0/0 (2 latent) | 83/0/0 (2 latent) | 83/0/0 (2 latent) | |
| C07 callable foreign functions | 111/0/0 | 111/0/0 | 111/0/0 | |
| C08 live probes (42501 expected) | 75/0/0 | 75/0/0 | 75/0/0 | |
| C09 CREATE outside V13 | 2/0/0 | 2/0/0 | 2/0/0 | |
| C10 V13 tables | | | | 1/0/0 |
| C11 V13 functions | | | | 0/0/0 (none yet) |
| C12 API roles cannot reach V13 | | | | 7/0/0 |
| **VERDICT** | | | | **27 / 0 / 0 PASS** |


App login password on the hosted project:
- 28 Oct ≈ 01:34 UTC: a SCRAM verifier was set on `cdf_v13_app`. The plaintext was then discarded without being used,
  because Claude may not handle the staging credentials.
- 28 Oct ≈ 01:42 UTC: `alter role cdf_v13_app with password null` restored the documented state (no password, nobody
  can log in).

The password is now set only by the owner with `database/hosted/owner_set_app_login.sql`
(`docs/hosted/OWNER_STEP_APP_LOGIN.md`).

## 3. Application tests

### 3.1 V13-ARCH-001 foundation, local run — 28 Oct 2026 ≈ 03:12–03:22 UTC, commit `3756b4e`

Node.js 22.22.0, pnpm 10.28.0, local PostgreSQL 16.15 clusters from `pnpm db:local` (primary on 54329, hosted
simulation on 54330), the container's Chromium (`PW_CHROMIUM_PATH=/opt/pw-browsers/chromium`), Playwright 1.63.0. The
commit that records this evidence changes documentation only.

| Command                                                | Result                                                                                                                          |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm lint`                                            | clean: ESLint 0 problems, logical-css 15 files, env-example 18 names                                                            |
| `pnpm typecheck`                                       | clean                                                                                                                           |
| `pnpm format:check`                                    | clean                                                                                                                           |
| `pnpm db:lint`                                         | 1 migration file, 0 findings, 22 rules                                                                                          |
| `pnpm test`                                            | 17 files, 251 tests passed                                                                                                      |
| `pnpm db:reset`, then `V13_DB_TESTS_REQUIRED=1 pnpm test:db` | 4 files passed, 1 skipped; 35 tests passed, 2 skipped (persona registry: its tables and seed arrive with V13-DB-001/DB-005) |
| `pnpm build`                                           | Next.js 16.4.2 (Turbopack): every route dynamic (`ƒ`), proxy present                                                            |
| `pnpm test:e2e`                                        | 12 passed: 9 smoke, 3 axe accessibility                                                                                         |

Mutation checks (not committed, each reverted and rebuilt before the final run):

- Nonce removed from `script-src`: the e2e test "the app runs under the nonce policy" fails (scripts blocked, persona
  sign-in never reaches My work). The suite therefore detects a page that runs without its nonce.
- Policy no longer forwarded on the request (response header only): no e2e test fails, because `next start` also
  copies proxy response headers onto the request. The forward is kept (it is the documented Next.js pattern and does
  not depend on that copy) and pinned by `tests/unit/proxy.spec.ts`.

## 4. CI

The workflow `.github/workflows/ci.yml` arrives with V13-ARCH-001. Its first run on the pull request is recorded here
(workflow, run id, commit) once it completes.

## 5. Deployment checks

See `docs/DEPLOYMENT_STATUS.md`. No deployment has served the application yet.
