# DB status — CDF V13 Enterprise (synthetic data only)

Updated: 2026-11-01 03:40 UTC · Team DB · Reviewer of DB PRs: SEC

## Delivery plan (ruled by the Chief Architect)

| PR | Branch | Content | State |
| -- | ------ | ------- | ----- |
| (a) `[V13-DB-001]` | `feature/V13-DB-001-identity-claims-audit` | migration 0001 (identity, claims MAC, audit ledger, deny-all on `schema_migrations`), seed part 1 (identity), app-side claims MAC in `lib/db/security-context.ts`, key install at server start (`instrumentation.ts` → `lib/db/claims-key-startup.ts`), `database/hosted/reset_claims_key.sql` (ARCH path, proposed by DB), suites | COMPLETE — #12 merged 2386ce9 (SEC ACCEPT) |
| (b) `[V13-DB-002]` | `feature/V13-DB-002-case-registry-notifications`, stacked on (a) | migrations 0002–0004, seed part 2 (cases), `scripts/db/rehearse-shared.mjs`, case-access suite, FE contract ruling on 0002, persona-registry tests un-skipped | COMPLETE — #15 merged 7a79857 (SEC ACCEPT) |
| (c) `[V13-DB-007]` | `feature/V13-DB-007-workspace-switch`, stacked on (b) | migration 0005 `api_switch_workspace` (ids-only WORKSPACE_SWITCHED audit), workspace-switch suite (14), definer allow-list entry | COMPLETE — #17 merged e6717de (SEC ACCEPT) |
| (d) `[V13-DB-008]` | `feature/V13-DB-008-case-workspace-reads`, stacked on (c) | migration 0006: `case_events`, `case_tasks`, `case_header.my_capacity` (FE-004, ARCH ruling 28 Oct), case-workspace suite (22) | COMPLETE — #21 merged c4b37c3 (SEC ACCEPT) |
| `[V13-DB-006]` | `feature/V13-DB-006-rehearsal-ci` | CI job "Shared-database rehearsal" (`.github/workflows/ci.yml`, ARCH-agreed edit) + this status refresh | COMPLETE — #26 merged f431b98 (SEC + ARCH ACCEPT 3f2108a) |
| `[V13-DB-009]` | `feature/V13-DB-009-claims-key-health` | migration 0007 `claims_key_state`; `/api/health` reports `db.claims_key` (OI-022 resolved) | COMPLETE — #28 merged 558d4ae (SEC + ARCH ACCEPT 125b1f0) |
| `[V13-DB-010]` | `feature/V13-DB-010-my-work-columns` | migration 0008: `my_work_tasks` + `case_title_ar`, `case_title_en`, `case_records_state`, `status_event_id` (FE-005, ARCH request 31 Oct) | COMPLETE — #31 merged b5ee5f46 (SEC ACCEPT 3bd1c93) |
| `[V13-DB-011]` | `feature/V13-DB-011-fk-indexes` | migration 0009: foreign-key index review (OI-032), FK coverage suite | COMPLETE — #42 merged f39af8b (SEC ACCEPT 3e78d52, ARCH accepted) |
| `[V13-DB-012]` | `feature/V13-DB-012-hosted-guard` | `scripts/db/hosted-bundle.mjs` generates the plan §5.7 text guard; unit + hosted-sim tests | COMPLETE — #44 merged 2766fd9 (CI 7/7, run 41237743471) |
| `[V13-DB-014]` | `feature/V13-DB-013-guard-tail` | text guard runs first: start, body, final statement and trailer checked before any statement runs | COMPLETE — #47 merged (267944a) |
| `[V13-DB-015]` | `feature/V13-DB-015-notification-ops` | migration 0010: `notifications_page` / `notifications_count` for the Notification Operations Center (S4, FE-006) | COMPLETE — #52 merged (77a9e18), SEC ACCEPT fcd2db3 |
| `[V13-DB-016]` | `feature/V13-DB-016-hosted-resume-rehearsal` | rehearsal of the hosted resume 0005 → 0010 + seeds 0001/0002; seed bundles (`--seed`) | COMPLETE — #56 merged (7a0eccb), SEC ACCEPT 54e1925 |
| `[V13-DB-017]` | `feature/V13-DB-017-seed-lint` | OI-041: db:lint covers database/seed; seed bundle and db:reset refuse a seed with findings; transaction control inside DO/function bodies | COMPLETE — #62 merged (a9745ba), SEC ACCEPT 2fe462d |
| `[V13-DB-018]` | `feature/V13-DB-018-rollback-register` | REQ-DATA-023: per-migration rollback register (DATA_MODEL.md §9) and its automated check | COMPLETE — #101 merged (85f7332), SEC ACCEPT 434c1c7 |
| `[V13-DB-019]` | `feature/V13-DB-019-keyset-paged-reads` | REQ-PERF-003, OI-026: migration 0011, keyset-paged per-case reads | IN_PROGRESS — PR open, SEC review pending |

## Completed in PR (a)
- V13-DB-001 — migration 0001: workspaces, roles, personas (e-mail hidden from the request role; own e-mail via
  `current_persona()`), memberships with validity windows, claims key table (owner only), HMAC-verified claims
  helpers (ADR-014), `api_install_claims_key` (install once, audited), hash-chained append-only `audit_event`
  (ADR-011), `verify_audit_chain()`.
- V13-DB-005 part 1 — seed `database/seed/0001_m1_synthetic.sql`: 3 workspaces, 6 personas (2 negative: expired
  membership, deactivated), 7 memberships; audit row `SEED_M1_LOADED`.
- `lib/db/security-context.ts`: installs the key once, reads `pg_current_xact_id()`, sets claims, MAC and role in one
  statement. `lib/db/claims-key-startup.ts` + `instrumentation.ts`: install at server start, no-op when unconfigured,
  never throws, one code-only log line.
- Defect found by the new suite and fixed before 0001 was applied anywhere: `_is_colleague` listed the deactivated
  Persona Zeta as a colleague; it now requires an active persona.

## Completed in PR (b)
- V13-DB-002 — migration 0002: `case_record` (`source_ref` NOT NULL, FE ruling), workspace visibility (owning workspace
  by trigger), assignments, `can_access_case` (single access rule), invoker `portfolio_page` / `portfolio_count` /
  `case_header` (rows carry `updated_at`, `source_system`, `source_ref`).
- V13-DB-003 — migration 0003: append-only `procedural_event` (same-case causation), `task`,
  `api_update_task_status`, `my_work_tasks`.
- V13-DB-004 — migration 0004: recipient classes, immutable hashed template versions, `notification` (same-case
  supersede), append-only `notification_event`, content-free deny-all `dispatch_outbox`,
  `api_create_notification_draft`, `case_notifications`.
- V13-DB-005 part 2 — seed `database/seed/0002_m1_cases.sql`: 10 cases (0009 restricted, 0010 closed), 15
  assignments, 20 tasks, 17 events, 2 templates × 2 languages, 5 DRAFT notifications; audit row
  `SEED_M1_CASES_LOADED`.
- V13-DB-006 — `scripts/db/rehearse-shared.mjs`: Supabase-like cluster, dry run, apply twice, fingerprints, isolation
  checks, four planted faults, refused and clean rollback.

## Completed in PR (c)
- V13-DB-007 — migration 0005: `api_switch_workspace(uuid)` for the FE workspace switcher (ARCH request, 28 Oct).

## Completed in PR (d)
- V13-DB-008 — migration 0006: SECURITY INVOKER Case Workspace reads; persons appear only as capacity codes or an
  is-mine flag.

## Completed: V13-DB-009 (OI-022)
- Migration 0007: `claims_key_state(p_probe_mac text)`, SECURITY DEFINER owned by `cdf_v13_owner`, `search_path = ''`,
  EXECUTE for `cdf_v13_user` only. Input: base64url HMAC-SHA256(K, `cdf-v13/claims-key-probe/v1|<xid>`), computed by
  the app in the same transaction. Output: `INSTALLED_MATCH`, `INSTALLED_MISMATCH` or `NOT_INSTALLED`; no key
  material, no audit row.
- `lib/db/health-probe.ts` probes as the request role; `/api/health` reports `db.claims_key`. `INSTALLED_MISMATCH` →
  503 `CLAIMS_KEY_MISMATCH`; `NOT_INSTALLED` → 503 `CLAIMS_KEY_NOT_INSTALLED`; no usable `V13_SESSION_SECRET` →
  `NOT_CHECKED`, not degraded (such a deployment serves no signed-in request). Isolation failures are reported first.
- Tests: `tests/integration/claims-key-state.spec.ts` (12), `tests/unit/claims-key-probe.spec.ts` (4), health-route
  unit cases (+2), definer allow-list entry. ARCH accepted `NOT_CHECKED` as built.

## Completed: V13-DB-010 (FE-005)
- Migration 0008: `my_work_tasks(p_include_closed)` dropped and recreated (result type grows) with four columns
  appended after the nine existing ones: `case_title_ar`, `case_title_en`, `case_records_state` (UI hint only; V1423
  stays the authority) and `status_event_id` (same definition as `case_tasks`). Still SECURITY INVOKER, `search_path
  ''`, EXECUTE for `cdf_v13_user` only; same rows, same order.
- Tests: `tests/integration/my-work.spec.ts` (14): shape and grants, values against the raw rows, equality with
  `case_tasks`, newest event and a foreign-case event ignored, order; negatives for other workspace (rolled-back task in
  a case not visible there; non-member and unknown workspace), other persona, restricted (assignment ended; never
  assigned), closed (hint and V1423), unknown and forged contexts, app login 42501. Mutation-checked (dropping the
  same-case condition, or making the function a definer, fails the suite).

## Completed: V13-DB-011 (OI-032)
- Migration 0009: decides the advisor's 14 unindexed-FK findings. One index reshaped
  (`notification_event_notification_idx` → `(notification_id, case_id, occurred_at)`, covers
  `notification_event_notification_fk` and explains its "unused" finding); 13 accepted with reasons in the migration
  (parents never deleted or re-keyed, no read by that key). The 9 unused_index findings are expected without traffic.
- Tests: `tests/integration/fk-index-coverage.spec.ts` (5): every FK indexed or accepted (a new FK fails), the reshaped
  index, NO ACTION on every FK, no application role can delete or re-key an accepted FK's parent. Mutation-checked
  (the 0004 index shape fails 3 tests).

## Completed: V13-DB-012 (hosted text guard)
- `scripts/db/hosted-bundle.mjs` ends every bundle with the plan §5.7 guard: the marker `-- V13-TEXT-END`, then a block
  that raises P0001 unless `md5(split_part(current_query(), marker, 1))` equals the md5 of the generated text before
  the marker. The dry-run and apply texts differ only in the final `rollback;` / `commit;` and share one hash.
  `textGuard()` is exported for the seed texts; a migration containing the marker is refused.
- Tests: `tests/unit/hosted-bundle.spec.ts` (17: a changed byte, a changed literal, a trailing space, a dropped line, an
  added blank line and CRLF each fail; unchanged passes, also with a trailer) and `tests/integration/hosted-sim.spec.ts`
  (PostgreSQL raises the guard for five tampered texts and applies nothing). Mutation-checked (a wrong hash fails 8).

## Done: V13-DB-015 (FE-006, UX S4), #52
- Migration 0010: SECURITY INVOKER `notifications_page` (keyset on created_at desc, id desc; text cursor
  `created_at_cursor` with microseconds, because a timestamptz parameter loses them in the driver's Date; limit 1..100)
  and `notifications_count` with one filter set (lifecycle, template code, case display number after authorisation,
  created range). Same access as `case_notifications`; no person columns. Index `notification_created_idx`.
- Tests: `tests/integration/notification-ops.spec.ts` (21): shape and grants, values, per persona × workspace rows =
  union of the case tabs = expected and count = rows, restricted 0009, closed 0010, other workspace and other persona
  (uncommitted drafts seen through a context switch), Scenario E, filters, unknown filter values, paging (ties, cap,
  half cursor in both directions after SEC's CHANGES 0bb7f09, malformed cursor, foreign cursor), Epsilon/Zeta/unknown, forged contexts, app login 42501. Mutation-checked.

## Done: V13-DB-016 (hosted resume rehearsal), #56
- The hosted project stands at 0005 (docs/TEST_EVIDENCE.md §2.1). ARCH will send, through the connector: bundles 0006,
  0007, 0008, 0009, 0010 (each `--dry-run`, then apply), then seeds 0001 and 0002 (each `--dry-run`, then apply).
- `scripts/db/hosted-bundle.mjs --seed <version> [--dry-run]`: the seed file verbatim in the migration frame (begin,
  lock_timeout, search_path '', advisory lock), with the text guard in front and a guard that refuses unless the recorded
  history equals every repository migration (name + sha256), so a seed runs only on the complete schema. No history row
  (seeds are idempotent). Migration bundles unchanged (0005 dry-run text byte-identical to develop's generator).
- `tests/integration/hosted-resume.spec.ts` (8, ≈ 3 s, runs in `test:db` and CI): Supabase-like cluster, 0000–0005 by
  their bundles; every text sent as ONE simple query with the trailer `-- source: connector`; seeds refused before 0010
  (P0001, nothing left); each dry run leaves history, catalogue fingerprint and seed row counts unchanged; each apply
  records the repository's row (runner `hosted`, applied_by `postgres`); seed rows equal a fresh build's; final
  `database/hosted/v13_catalog_fingerprint.sql` equals a fresh build on the same layout AND the `db:reset` primary;
  `post_apply_checks.sql` VERDICT PASS; re-sent seeds change nothing.
- Mutation-checked: a trailer that can execute (`select 1;`) fails the guard on the first bundle; an extra function on the
  primary fails the fingerprint comparison.
- Evidence (local, dc52514 + working tree): lint, typecheck, prettier clean; unit 1658/1658 (hosted-bundle 37);
  test:db 418/418.

## Done: V13-DB-017 (OI-041, SEC LOW on #56), #62
- `db:lint` now also lints `database/seed/*.sql` (`--seed-dir`) with every per-file rule of a migration after the
  bootstrap: transaction-control, session-role and owner-role above all (SET LOCAL ROLE cdf_v13_owner first, RESET ROLE
  only last). Seed file names NNNN_name.sql, unique versions, never 0000.
- `hosted-bundle.mjs --seed` refuses to print a bundle while any seed has a finding; `db:reset` refuses before dropping
  anything. A COMMIT in a seed could otherwise end the bundle's transaction early and turn a dry run into an apply.
- Lint gap closed for migrations too: COMMIT, ROLLBACK, ABORT, SAVEPOINT and RELEASE inside DO and function bodies are
  transaction-control findings (BEGIN/END stay PL/pgSQL block keywords there).
- Tests: `tests/unit/hosted-bundle.spec.ts` 11 refusals (COMMIT, ROLLBACK, BEGIN, END, SAVEPOINT, SET ROLE, SET SESSION
  AUTHORIZATION, early RESET ROLE, another role, no SET LOCAL ROLE first, COMMIT in a DO block), each by `lintSeedsDir`,
  the generator (dry run and apply) and both CLIs; today's seeds pass; file-name rules. `tests/unit/lint-migrations.spec.ts`
  +2 (COMMIT in a DO body, ROLLBACK in a procedure). Mutation-checked: without the generator's lint step 12 tests fail.
- Evidence (local): db:lint 11 migrations + 2 seeds, 0 findings; lint, typecheck, prettier clean; unit 1700/1700;
  test:db 418/418 after a fresh db:reset; REHEARSAL PASS.

## Done: V13-DB-018 (REQ-DATA-023), #101
- `docs/architecture/DATA_MODEL.md` §9: one entry per migration 0000–0010 with the objects it creates, replaces, drops
  or alters, what a revert loses, and the strategy: locally `pnpm db:reset`; on the hosted schema a forward-fix
  migration (applied migrations are never edited), or the whole-schema `rollback_v13.sql` only on the owner's explicit
  word. No reverse or DROP scripts, no migration, nothing hosted.
- `scripts/db/rollback-register.mjs` (also a CLI) reads each migration with the db:lint lexer and compares its CREATE,
  DROP and ALTER TABLE … ADD statements with the entry. An unknown CREATE or DROP form is refused, not ignored.
- Tests: `tests/unit/rollback-register.spec.ts` (10): repository control, planted missing entry, unknown new migration,
  wrong / missing / misfiled object, missing Alters, an object added to a migration, missing field / empty strategy /
  hosted strategy without the forward fix, comments and bodies ignored. Mutation-checked: 8 of 8 mutants of the
  checker killed.
- Evidence (local, on develop 68a42b9 + this branch): lint, typecheck, prettier, db:lint clean; unit 2032/2032;
  db:reset then test:db 468/468.

## In progress: V13-DB-019 (REQ-PERF-003, OI-026)
- Migration 0011: `case_events_page`, `case_tasks_page`, `case_notifications_page` (SECURITY INVOKER, `search_path`
  '', EXECUTE for `cdf_v13_user` only), each = its unpaged read one page at a time plus `page_cursor`;
  `_page_limit(integer)` refuses a limit outside 1..100 (NULL included) with 22023; index `task_case_page_idx`. The
  cursor row is looked up by id in the same case under RLS and must carry exactly that `page_cursor`, so half,
  malformed, stale and foreign cursors all return no rows, like an unknown or unauthorised case. The unpaged reads, their
  grants and every `api_*` command are unchanged; FE switches in its own task. Register entry §9.
- Tests: `tests/integration/case-paged-reads.spec.ts` (17): shape; unpaged reads unchanged; for every persona ×
  workspace × case (and an unknown case) × limit 1/2/3/100 the pages concatenate to the unpaged read, disjoint and bounded,
  pinned to the visibility table; ties (same due date, null due dates, same event instants, same created_at); limit
  edges 1 and 100 accepted, 0/101/-1/NULL refused 22023 on every read; 101 drafts page as 100 + 1; ten cursor probes all
  empty; a restricted row as Gamma's cursor; other workspace / other persona; closed 0010 readable; Epsilon, Zeta,
  unknown, forged contexts; app login 42501; index plans. `hosted-resume.spec.ts` now resumes 0006–0011.
  Mutation-checked: 8 of 8 migration mutants fail the suite.
- Needs SEC: the SEC-DB-17 coverage guard (`tests/security/db/context-forgery.spec.ts`) lists every function the request
  role may execute; it needs entries for the three paged reads and `_page_limit` (tried locally: 18/18 with them).

## Next
- Next free migration: 0012.
- OI-026 per-case paging: proposal accepted by ARCH (`*_page` functions next to the current reads), after M1.

## Review given
- #29 `[V13-SEC-002]`: `REVIEW: ACCEPT ede6f46`, re-confirmed `ACCEPT bc89156` after the develop merge (294/294).
- #30 `[V13-SEC-004]` post_apply_checks.sql: `REVIEW: ACCEPT 9f1e8bd` (PASS through 0008, spec 27/27).
- #35 `[V13-PROC-006]`, DB-owned file `tests/integration/task-status-catalogue.spec.ts`: `REVIEW: ACCEPT 2264d61`.
- #2 `[V13-SEC-001]` threat model and matrix: `REVIEW: CHANGES b1786c0` (doc fixes against the built 0001–0008), then
  `REVIEW: ACCEPT 8fcb8b1` (all 11 points fixed).
- #49 `[V13-SEC-006]` case-page adversarial tests: `REVIEW: ACCEPT 4960460` (CI 6/6; three non-blocking suggestions).
- #41 `[V13-SEC-005]` secret-value scans + P08 order: `REVIEW: ACCEPT 7529200` (surface spec 12/12 locally, mutation-checked).
- #72 `[V13-SEC-007]`: `REVIEW: ACCEPT 0082185` (suggested migrations + hosted scripts in the personal-data scope).
- #70: `REVIEW: ACCEPT e55413e`, `06d7043`, `84c9fd8` (security e2e green on each head).
- #87 `[V13-SEC-009]` personal-data scan over migrations and hosted scripts: `REVIEW: ACCEPT 87d9ab6` (0 findings over
  11 migrations + 9 hosted scripts; planted @example.test allowed, other domain found).
- #91 `[V13-SEC-010]` DB suites fail in CI when not ready: `REVIEW: ACCEPT 8bf777c` (suggested the extra signals).
- #92 `[V13-SEC-011]` V13_DB_TESTS_REQUIRED / GITHUB_ACTIONS signals: `REVIEW: ACCEPT 38ecdef` (7/10 mutants killed,
  survivors stricter only).

## Changed files (PR (a))
- database/migrations/0001_identity_access_audit.sql, database/seed/0001_m1_synthetic.sql,
  database/hosted/reset_claims_key.sql
- lib/db/security-context.ts, lib/db/claims-key-startup.ts, instrumentation.ts
- tests/unit/security-context.spec.ts, tests/unit/claims-key-startup.spec.ts, tests/unit/instrumentation.spec.ts
- tests/integration/identity-claims.spec.ts, tests/integration/catalog-audit.spec.ts,
  tests/integration/security-context.spec.ts, tests/integration/hosted-sim.spec.ts, tests/integration/support/claims.ts,
  tests/integration/support/context.ts
- docs/architecture/DATA_MODEL.md, docs/teams/db/STATUS.md

## Test evidence
Per-PR counts are in each PR description, from runs on the PR head. Latest local run, on `develop` 68a42b9 plus the
V13-DB-018 branch (0000–0010; 1 Nov 2026, local PostgreSQL 16 via `pnpm db:local`):
- `pnpm lint`: exit 0 · `pnpm typecheck`: 0 errors · `pnpm db:lint`: 11 migration files, 2 seed files, 0 findings
- `pnpm test`: 2032/2032 (81 files) · `pnpm db:reset` then `pnpm test:db`: 468/468 (30 files, incl. SEC's suites)
- `node scripts/db/rollback-register.mjs`: 11 migrations, 0 findings
- `node scripts/db/rehearse-shared.mjs`: REHEARSAL PASS (V13-DB-012 branch)
- CI green on each merged head (e.g. #28 125b1f0 run 41230326573, #31 3bd1c93 run 41231559873, #44 02e8cb1 run
  41237743471).

## Unresolved defects
- None known.
- SEC review of PR (b) (CHANGES 70f667f), fixed: idempotency keys are unique per author (`unique (created_by_persona_id,
  idempotency_key)`), so another persona's key is no existence oracle and cannot block a draft; `api_update_task_status`
  locks the task only after the access check; `p_correlation_id` dropped from both commands.
- Open design points for the reviewer (PR (b)): (1) closed cases readable, not writable; (2) a duplicate idempotency
  key from the same author is refused even for an identical replay; (3) a Governance Officer can change a task only
  when assigned to the case.

## Dependencies and requests
- ARCH: a CI job that runs `node scripts/db/rehearse-shared.mjs` when `database/**` changes (V13-DB-006 acceptance;
  the script lands in PR (b)).
- ARCH follow-up after (a): report a key mismatch in `/api/health` — V13-DB-009 (above).
- Hosted: the Chief Architect applies the migrations and seeds with the plan procedure (the resume 0006–0010 + seeds is rehearsed by `hosted-resume.spec.ts`). DB never connects. Hosted notes:
  every deployment that shares the schema (previews included) must use the same `V13_SESSION_SECRET`, because the
  claims key is installed first-writer-wins at server start; seed part 2 needs 0001–0004; every request now takes a
  transaction id (`pg_current_xact_id()`), negligible at prototype load (SEC INFO); a health call with a session secret takes one too (V13-DB-009).
