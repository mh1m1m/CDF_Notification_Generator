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

### 2.1 Migrations 0001–0005 — 31 Oct 2026 18:52–19:47 UTC

Runner: the Chief Architect's session, through the Supabase connector (`execute_sql`) as `postgres`. Each text was the
bundle that `scripts/db/hosted-bundle.mjs` generates from the merged migration. Before each send, a local copy was
compared byte for byte with the bundle. Each bundle carries the text guard of plan §5.7: unless the md5 of the text the
server received equals the repository text's, the transaction aborts. Per migration the plan's order (§6): dry run
ending in ROLLBACK, apply, history, fingerprint, isolation, GC Review counters, advisors, GC Review deployment.

Before the first migration: fingerprint 13 rows identical to the baseline, TOTAL 648 `40c9efe5697d19552d15f5ef85c2f85f`;
history `0000 bootstrap` only; GC Review counters 32 tables, 109 live rows, ins 116 / upd 50 / del 3, 7 connections;
security advisor the INFO of OI-009 plus GC Review's pre-existing WARN `auth_leaked_password_protection`; performance
advisor GC Review's 4 pre-existing INFO; GC Review production deployment READY, `/` and `/api/health` 200.

| Migration | Dry run (ROLLBACK) | Apply (COMMIT) | History row sha256 | Fingerprint | Isolation (V13 tables / functions) | Security advisor | Performance advisor | GC Review |
| --------- | ------------------ | -------------- | ------------------ | ----------- | ---------------------------------- | ---------------- | ------------------- | --------- |
| 0001 identity_access_audit | 18:59:44, no error | 19:01:48 | `6b3bd988…f297` = header | identical, TOTAL 648 `40c9efe5…` | 27 / 0 / 0 PASS (7 / 15) | no new finding; OI-009's INFO gone | 6 new INFO (V13) | counters unchanged; READY, 200 / 200 |
| 0002 case_registry | 19:10:28, no error | 19:11:17 | `5628854c…f904` = header | identical | 27 / 0 / 0 PASS (10 / 19) | no new finding | 3 new INFO (V13) | unchanged; READY, 200 / 200 |
| 0003 procedural_core | 19:16:50, no error | ≈ 19:17:55 | `bcb552e7…a04f` = header | identical | 27 / 0 / 0 PASS (12 / 24) | no new finding | 5 new INFO (V13) | unchanged; READY, 200 / 200 |
| 0004 notification_core | 19:28:55, no error | 19:30:17 | `ae23246e…0a2a` = header | identical | 27 / 0 / 0 PASS (18 / 27) | no new finding | 9 new INFO (V13) | unchanged; READY, 200 / 200 |
| 0005 workspace_switch | 19:35:40, no error | 19:36:17 | `143894be…4435` = header | identical | 27 / 0 / 0 PASS (18 / 28) | no new finding | none new | unchanged; READY, 200 / 200 |

- "Counters unchanged" means GC Review's table statistics (tables, live rows, inserts, updates, deletes); its connection
  count moved between 7 and 10.
- An extra history read after the first dry run showed that a dry run leaves nothing behind.
- The 23 new performance findings are 14 `unindexed_foreign_keys` and 9 `unused_index`, all on V13 tables (OI-032).
- **Stopped at 0006 (OI-034).** At 19:41:19 the 0006 dry run (bundle 11, byte-identical) was sent. The connector asked
  the user a question and, with no answer within 60 s, returned without a SQL result. At ≈ 19:45 a read-only history
  query answered without a question: rows 0000–0005, unchanged. Not resent; 0006, 0007, 0008, the seeds and the
  post-apply checks wait for the owner.

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

Workflow `.github/workflows/ci.yml` (arrives with V13-ARCH-001, PR #6). Since #26 (V13-DB-006) it has six jobs: lint/typecheck/format/db:lint, unit tests, shared-database rehearsal, database integration tests, build, end-to-end (Playwright). On pull requests the Vercel preview is a seventh check.

| Run                                                                                              | Commit    | Result                                                                                                                                                                                         |
| ------------------------------------------------------------------------------------------------ | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [40626543282](https://github.com/mh1m1m/CDF_Notification_Generator/actions/runs/40626543282) #1 | `5c53ec4` | success, 5 of 5 jobs: lint/typecheck/format/db:lint clean; unit 17 files, 251 passed; integration 35 passed, 2 skipped (persona registry, as locally); build; Playwright 12 passed (13.4 s) |

Every pinned action SHA resolved. Warnings: the pinned versions target Node.js 20 and ran on Node.js 24 (OI-021); the
dependency cache could not be saved (GitHub service message), which does not affect results.

### 4.1 `develop`: one push run per merge (read from GitHub Actions, 31 Oct 2026 ≈ 21:30 UTC)

Each merge rests on the PR run named in its merge commit: green CI on the head the independent reviewer accepted. The workflow cancels a running push run when a newer push to the same branch arrives (`concurrency`, `cancel-in-progress: true`), so a merge pushed within a minute of the next one shows a cancelled push run. The next successful push run contains that merge and verifies the combination; it is named in the last column. When `develop` moved after a PR's run, ARCH merges on that run only if `develop` changed none of the PR's files (ARCH ruling, 31 Oct). Since #24, ARCH also runs typecheck, lint, format, unit, test:db and Playwright on the combined tree locally before the merge, because a test already on `develop` can exercise behaviour the PR changes; the counts are in the merge commit and in the last column. A PR run checks out the PR head merged into `develop` as `develop` was when the run started (`refs/pull/<n>/merge`; the checkout step's log names both commits), so a PR run that started after the last `develop` move already covers the merged tree.

| Merge | PR, task | PR run (merge basis) | `develop` push run | Push run result |
| ----- | -------- | -------------------- | ------------------ | --------------- |
| `f0a7220` | #6 ARCH-001 | [40627224227](https://github.com/mh1m1m/CDF_Notification_Generator/actions/runs/40627224227) | [40627572982](https://github.com/mh1m1m/CDF_Notification_Generator/actions/runs/40627572982) | success |
| `54a94f3` | #4 UX-004 | [40627775569](https://github.com/mh1m1m/CDF_Notification_Generator/actions/runs/40627775569) | [40628437067](https://github.com/mh1m1m/CDF_Notification_Generator/actions/runs/40628437067) | cancelled; verified by [40628544723](https://github.com/mh1m1m/CDF_Notification_Generator/actions/runs/40628544723) |
| `d5066f4` | #1 QA-001 | [40627780225](https://github.com/mh1m1m/CDF_Notification_Generator/actions/runs/40627780225) | [40628513722](https://github.com/mh1m1m/CDF_Notification_Generator/actions/runs/40628513722) | cancelled; verified by [40628544723](https://github.com/mh1m1m/CDF_Notification_Generator/actions/runs/40628544723) |
| `e04c164` | #7 QA-003 | [40627934314](https://github.com/mh1m1m/CDF_Notification_Generator/actions/runs/40627934314) | [40628544723](https://github.com/mh1m1m/CDF_Notification_Generator/actions/runs/40628544723) | success |
| `f384507` | #8 UX-001 | [40628472115](https://github.com/mh1m1m/CDF_Notification_Generator/actions/runs/40628472115) | [40629000919](https://github.com/mh1m1m/CDF_Notification_Generator/actions/runs/40629000919) | success |
| `f0d52d2` | #5 ARCH-006 | [40627774719](https://github.com/mh1m1m/CDF_Notification_Generator/actions/runs/40627774719) | [40629508846](https://github.com/mh1m1m/CDF_Notification_Generator/actions/runs/40629508846) | success |
| `2990c28` | #3 PROC-001 | [40628002314](https://github.com/mh1m1m/CDF_Notification_Generator/actions/runs/40628002314) | [40631471656](https://github.com/mh1m1m/CDF_Notification_Generator/actions/runs/40631471656) | cancelled; verified by [40631508845](https://github.com/mh1m1m/CDF_Notification_Generator/actions/runs/40631508845) |
| `0f22e04` | #11 SEC-003 | [40630470189](https://github.com/mh1m1m/CDF_Notification_Generator/actions/runs/40630470189) | [40631508845](https://github.com/mh1m1m/CDF_Notification_Generator/actions/runs/40631508845) | success (see OI-028) |
| `d41a3c8` | #9 FE-001 | [40631539499](https://github.com/mh1m1m/CDF_Notification_Generator/actions/runs/40631539499) | [40631947040](https://github.com/mh1m1m/CDF_Notification_Generator/actions/runs/40631947040) | success |
| `a5bbb10` | #13 QA-004 | [40632016065](https://github.com/mh1m1m/CDF_Notification_Generator/actions/runs/40632016065) | [41227655399](https://github.com/mh1m1m/CDF_Notification_Generator/actions/runs/41227655399) | success |
| `ae52b7f` | #10 FE-002 | [40632046062](https://github.com/mh1m1m/CDF_Notification_Generator/actions/runs/40632046062) | [41227936693](https://github.com/mh1m1m/CDF_Notification_Generator/actions/runs/41227936693) | success |
| `2ec6ce0` | #20 ARCH-001 | [41228022228](https://github.com/mh1m1m/CDF_Notification_Generator/actions/runs/41228022228) | [41228685749](https://github.com/mh1m1m/CDF_Notification_Generator/actions/runs/41228685749) | success |
| `64aa5c1` | #18 PROC-001 | [41228849177](https://github.com/mh1m1m/CDF_Notification_Generator/actions/runs/41228849177) | [41229085327](https://github.com/mh1m1m/CDF_Notification_Generator/actions/runs/41229085327) | success |
| `2386ce9` | #12 DB-001 | [41229010531](https://github.com/mh1m1m/CDF_Notification_Generator/actions/runs/41229010531) | [41229215802](https://github.com/mh1m1m/CDF_Notification_Generator/actions/runs/41229215802) | cancelled; verified by [41229344428](https://github.com/mh1m1m/CDF_Notification_Generator/actions/runs/41229344428) |
| `7a79857` | #15 DB-002 | [41229073486](https://github.com/mh1m1m/CDF_Notification_Generator/actions/runs/41229073486) | [41229292122](https://github.com/mh1m1m/CDF_Notification_Generator/actions/runs/41229292122) | cancelled; verified by [41229344428](https://github.com/mh1m1m/CDF_Notification_Generator/actions/runs/41229344428) |
| `e6717de` | #17 DB-007 | [41229075673](https://github.com/mh1m1m/CDF_Notification_Generator/actions/runs/41229075673) | [41229319820](https://github.com/mh1m1m/CDF_Notification_Generator/actions/runs/41229319820) | cancelled; verified by [41229344428](https://github.com/mh1m1m/CDF_Notification_Generator/actions/runs/41229344428) |
| `c4b37c3` | #21 DB-008 | [41229075061](https://github.com/mh1m1m/CDF_Notification_Generator/actions/runs/41229075061) | [41229344428](https://github.com/mh1m1m/CDF_Notification_Generator/actions/runs/41229344428) | success |
| `b193a1c` | #22 QA-004 | [41229383439](https://github.com/mh1m1m/CDF_Notification_Generator/actions/runs/41229383439) | [41229647806](https://github.com/mh1m1m/CDF_Notification_Generator/actions/runs/41229647806) | success |
| `f431b98` | #26 DB-006 | [41229690020](https://github.com/mh1m1m/CDF_Notification_Generator/actions/runs/41229690020) | [41230839811](https://github.com/mh1m1m/CDF_Notification_Generator/actions/runs/41230839811) | success (first rehearsal job on develop) |
| `558d4ae` | #28 DB-009 | [41230326573](https://github.com/mh1m1m/CDF_Notification_Generator/actions/runs/41230326573) | [41230926095](https://github.com/mh1m1m/CDF_Notification_Generator/actions/runs/41230926095) | success |
| `50850a4` | #29 SEC-002 | [41231449891](https://github.com/mh1m1m/CDF_Notification_Generator/actions/runs/41231449891) | [41231779492](https://github.com/mh1m1m/CDF_Notification_Generator/actions/runs/41231779492) | cancelled; verified by [41231785638](https://github.com/mh1m1m/CDF_Notification_Generator/actions/runs/41231785638) |
| `b5ee5f4` | #31 DB-010 | [41231559873](https://github.com/mh1m1m/CDF_Notification_Generator/actions/runs/41231559873) | [41231785638](https://github.com/mh1m1m/CDF_Notification_Generator/actions/runs/41231785638) | success, 6 of 6 jobs |
| `a6c224a` | #30 SEC-004 | [41232084126](https://github.com/mh1m1m/CDF_Notification_Generator/actions/runs/41232084126) | [41232604284](https://github.com/mh1m1m/CDF_Notification_Generator/actions/runs/41232604284) | success |
| `57d5f00` | #33 QA-002 | [41233154338](https://github.com/mh1m1m/CDF_Notification_Generator/actions/runs/41233154338) | [41233381902](https://github.com/mh1m1m/CDF_Notification_Generator/actions/runs/41233381902) | success |
| `434f905` | #24 PROC-002 | [41229568445](https://github.com/mh1m1m/CDF_Notification_Generator/actions/runs/41229568445) | [41233985516](https://github.com/mh1m1m/CDF_Notification_Generator/actions/runs/41233985516) | success (combined tree checked locally first: unit 805, e2e 92) |
| `e4ba953` | #19 FE-003 | [41229567055](https://github.com/mh1m1m/CDF_Notification_Generator/actions/runs/41229567055) | [41234932051](https://github.com/mh1m1m/CDF_Notification_Generator/actions/runs/41234932051) | success (combined tree checked locally first: unit 859, test:db 350, e2e 92) |
| `6db4cd0` | #35 PROC-006 | [41234318389](https://github.com/mh1m1m/CDF_Notification_Generator/actions/runs/41234318389) | [41235108601](https://github.com/mh1m1m/CDF_Notification_Generator/actions/runs/41235108601) | success (combined tree checked locally first: unit 867, test:db 352, e2e 92) |
| `e8bba66` | #39 PROC-004 | [41235523564](https://github.com/mh1m1m/CDF_Notification_Generator/actions/runs/41235523564) | [41235883655](https://github.com/mh1m1m/CDF_Notification_Generator/actions/runs/41235883655) | success (the PR's base was the develop head, so its run covered the merged tree) |
| `0f46d79` | #40 PROC-003 | [41236272420](https://github.com/mh1m1m/CDF_Notification_Generator/actions/runs/41236272420) | [41236424541](https://github.com/mh1m1m/CDF_Notification_Generator/actions/runs/41236424541) | success (the PR's base was the develop head, so its run covered the merged tree) |
| `b0f68a8` | #36 ARCH-008 | [41235217297](https://github.com/mh1m1m/CDF_Notification_Generator/actions/runs/41235217297) | [41236731003](https://github.com/mh1m1m/CDF_Notification_Generator/actions/runs/41236731003) | cancelled; verified by [41236771184](https://github.com/mh1m1m/CDF_Notification_Generator/actions/runs/41236771184) (combined tree checked locally first: unit 965, test:db 352, e2e 92 against the database) |
| `710a9e3` | #34 ARCH-002 | [41236573756](https://github.com/mh1m1m/CDF_Notification_Generator/actions/runs/41236573756) | [41236771184](https://github.com/mh1m1m/CDF_Notification_Generator/actions/runs/41236771184) | success (documentation and two read-only catalogue queries; `develop` changed none of its files) |
| `40901f3` | #14 UX-002 | [41233421542](https://github.com/mh1m1m/CDF_Notification_Generator/actions/runs/41233421542) | [41237144628](https://github.com/mh1m1m/CDF_Notification_Generator/actions/runs/41237144628) | success (combined tree checked locally first: unit 1010, test:db 352, e2e 92) |
| `f937052` | #37 QA-003 | [41237028371](https://github.com/mh1m1m/CDF_Notification_Generator/actions/runs/41237028371) | [41237495060](https://github.com/mh1m1m/CDF_Notification_Generator/actions/runs/41237495060) | success (combined tree checked locally first: unit 1010, test:db 352, e2e 94) |
| `b57a26e` | #38 QA-005 | [41237028478](https://github.com/mh1m1m/CDF_Notification_Generator/actions/runs/41237028478) | [41237666558](https://github.com/mh1m1m/CDF_Notification_Generator/actions/runs/41237666558) | success (combined tree checked locally first: unit 1010, test:db 352, e2e 94) |
| `f39af8b` | #42 DB-011 | [41237207593](https://github.com/mh1m1m/CDF_Notification_Generator/actions/runs/41237207593) | [41237833740](https://github.com/mh1m1m/CDF_Notification_Generator/actions/runs/41237833740) | success (the PR run checked out `3e78d52` merged into `40901f3`; combined tree checked locally first: unit 1010, test:db 357, e2e 94) |
| `2766fd9` | #44 DB-012 | [41237743471](https://github.com/mh1m1m/CDF_Notification_Generator/actions/runs/41237743471) | [41238077951](https://github.com/mh1m1m/CDF_Notification_Generator/actions/runs/41238077951) | success (combined tree checked locally first: unit 1021, test:db 358, e2e 94) |
| `3b43530` | #41 SEC-005 | [41237017779](https://github.com/mh1m1m/CDF_Notification_Generator/actions/runs/41237017779) | [41238283394](https://github.com/mh1m1m/CDF_Notification_Generator/actions/runs/41238283394) | success (combined tree checked locally first: unit 1021, test:db 358, e2e 95) |
| `3cfce15` | #27 FE-002 | [41237140896](https://github.com/mh1m1m/CDF_Notification_Generator/actions/runs/41237140896) | [41238483751](https://github.com/mh1m1m/CDF_Notification_Generator/actions/runs/41238483751) | success (combined tree checked locally first: unit 1029, test:db 362, e2e 95) |
| `8489874` | #43 QA-002 | [41237834810](https://github.com/mh1m1m/CDF_Notification_Generator/actions/runs/41237834810) | [41238672912](https://github.com/mh1m1m/CDF_Notification_Generator/actions/runs/41238672912) | cancelled; verified by [41238696857](https://github.com/mh1m1m/CDF_Notification_Generator/actions/runs/41238696857) (combined tree checked locally first: unit 1029, test:db 362, e2e 101) |
| `2115622` | #46 DB-013 | [41238240754](https://github.com/mh1m1m/CDF_Notification_Generator/actions/runs/41238240754) | [41238696857](https://github.com/mh1m1m/CDF_Notification_Generator/actions/runs/41238696857) | success (documentation only) |
| `69e03d6` | #23 FE-004 | [41236933119](https://github.com/mh1m1m/CDF_Notification_Generator/actions/runs/41236933119) | [41239279960](https://github.com/mh1m1m/CDF_Notification_Generator/actions/runs/41239279960) | success (combined tree checked locally first: unit 1,107, test:db 372, e2e 101) |
| `78b278f` | #16 UX-003 | [41237497867](https://github.com/mh1m1m/CDF_Notification_Generator/actions/runs/41237497867) | [41239519778](https://github.com/mh1m1m/CDF_Notification_Generator/actions/runs/41239519778) | success (combined tree: unit 1,160, test:db 372, e2e 101) |
| `ec8653a` | #45 PROC-005 | [41239195320](https://github.com/mh1m1m/CDF_Notification_Generator/actions/runs/41239195320) | [41239762598](https://github.com/mh1m1m/CDF_Notification_Generator/actions/runs/41239762598) | success (combined tree: unit 1,563, test:db 372, e2e 101) |
| `d694ff8` | #32 FE-005 | [41239662690](https://github.com/mh1m1m/CDF_Notification_Generator/actions/runs/41239662690) | [41240554717](https://github.com/mh1m1m/CDF_Notification_Generator/actions/runs/41240554717) | success (combined tree: unit 1,633, test:db 389, e2e 101) |
| `267944a` | #47 DB-014 | [41239147023](https://github.com/mh1m1m/CDF_Notification_Generator/actions/runs/41239147023) | [41240806004](https://github.com/mh1m1m/CDF_Notification_Generator/actions/runs/41240806004) | success (combined tree: unit 1,649, test:db 389, e2e 101) |
| `45b29cf` | #48 PROC-007 | [41240787208](https://github.com/mh1m1m/CDF_Notification_Generator/actions/runs/41240787208) | [41241330816](https://github.com/mh1m1m/CDF_Notification_Generator/actions/runs/41241330816) | cancelled; verified by [41241538332](https://github.com/mh1m1m/CDF_Notification_Generator/actions/runs/41241538332) (combined tree: unit 1,654, test:db 389, e2e 101) |
| `f429f6f` | #2 SEC-001 | [41240021497](https://github.com/mh1m1m/CDF_Notification_Generator/actions/runs/41240021497) | [41241407751](https://github.com/mh1m1m/CDF_Notification_Generator/actions/runs/41241407751) | cancelled; verified by [41241538332](https://github.com/mh1m1m/CDF_Notification_Generator/actions/runs/41241538332) (documentation only) |
| `bb5cf39` | #53 QA-002 | [41241111677](https://github.com/mh1m1m/CDF_Notification_Generator/actions/runs/41241111677) | [41241538332](https://github.com/mh1m1m/CDF_Notification_Generator/actions/runs/41241538332) | success (combined tree: unit 1,654, test:db 389, e2e 104) |
| `2f25577` | #49 SEC-006 | [41240905471](https://github.com/mh1m1m/CDF_Notification_Generator/actions/runs/41240905471) | [41241824794](https://github.com/mh1m1m/CDF_Notification_Generator/actions/runs/41241824794) | success (combined tree: unit 1,654, test:db 389, e2e 126) |
| `77a9e18` | #52 DB-015 | [41241514645](https://github.com/mh1m1m/CDF_Notification_Generator/actions/runs/41241514645) | [41242106697](https://github.com/mh1m1m/CDF_Notification_Generator/actions/runs/41242106697) | success (migration 0010; combined tree: unit 1,654, test:db 410, e2e 126) |
| `b24db04` | #55 PROC-008 | [41241834121](https://github.com/mh1m1m/CDF_Notification_Generator/actions/runs/41241834121) | [41242426038](https://github.com/mh1m1m/CDF_Notification_Generator/actions/runs/41242426038) | success (combined tree: unit 1,681, test:db 410, e2e 126) |

Run [41231785638](https://github.com/mh1m1m/CDF_Notification_Generator/actions/runs/41231785638) on `develop` `b5ee5f4`: lint/typecheck/format/db:lint, unit tests, shared-database rehearsal, database integration tests, build and Playwright all succeeded. Test counts are in each PR's evidence and in the job logs; this table records the job outcome only.

## 5. Deployment checks

See `docs/DEPLOYMENT_STATUS.md`. No deployment has served the application yet.
