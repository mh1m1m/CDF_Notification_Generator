# DB status — CDF V13 Enterprise (synthetic data only)

Updated: 2026-10-28 02:00 UTC · Branch: feature/V13-DB-001-m1-database-core · Head: see the branch

## Completed
- V13-DB-001 — migration 0001 (identity/access core, claims helpers, audit ledger, deny-all on schema_migrations) — DRAFT, no PR yet (waits for V13-ARCH-001 tooling)
- V13-DB-002 — migration 0002 (case registry, `can_access_case`, portfolio reads) — DRAFT
- V13-DB-003 — migration 0003 (procedural events, tasks, `api_update_task_status`, `my_work_tasks`) — DRAFT
- V13-DB-004 — migration 0004 (templates, notifications, events, `api_create_notification_draft`, content-free outbox) — DRAFT
- V13-DB-005 — seed in two idempotent parts, each with its own audit row: `database/seed/0001_m1_synthetic.sql` identity (3 workspaces, 3 roles, 6 personas incl. 2 negative, 7 memberships) and `0002_m1_cases.sql` (10 cases, 15 assignments, 20 tasks, 17 events, 2 templates × 2 languages, 5 notifications, all DRAFT) — DRAFT
- V13-DB-006 — `scripts/db/rehearse-shared.mjs` (Supabase-like cluster; dry run, apply, fingerprint, isolation, four planted faults, refused and clean rollback) — DRAFT, CI job needs ARCH
- E03 — `docs/architecture/DATA_MODEL.md` — DRAFT

- Chief Architect rulings of 01:53 applied to the drafts: claims v1 contract, claims MAC with owner-only key and `api_install_claims_key` (ADR-014, SEC-REC-01), `current_user = 'cdf_v13_user'` in every policy (SEC-REC-02), persona e-mail hidden from the request role, correlation id from claims into audit; `database/hosted/reset_claims_key.sql` proposed for ARCH.
- Reviewed SEC PR #2: `REVIEW: ACCEPT 7c78b82` with 9 notes (https://github.com/mh1m1m/CDF_Notification_Generator/pull/2#issuecomment-6458548001).

- Chief Architect rulings of 02:35 applied: seed notifications all DRAFT with DRAFT_CREATED only (no APPROVED/DISPATCHED rows or events); `notification_event.provenance` added (COMMAND / SEED_SYNTHETIC); definer discipline documented (DATA_MODEL §6a). Rehearsal re-run PASS; seed idempotent.

## Changed files
- database/migrations/0001_identity_access_audit.sql, 0002_case_registry.sql, 0003_procedural_core.sql, 0004_notification_core.sql
- database/seed/0001_m1_synthetic.sql, database/seed/0002_m1_cases.sql
- scripts/db/rehearse-shared.mjs
- docs/architecture/DATA_MODEL.md, docs/teams/db/STATUS.md

## Test evidence
No Vitest suite exists yet (needs V13-ARCH-001: package.json, Vitest, `pnpm db:local`, `pnpm db:lint`). What was run:

| Command | Result | Counts | Commit |
| ------- | ------ | ------ | ------ |
| `node scripts/db/rehearse-shared.mjs` (PostgreSQL 16.15, Supabase-like cluster, administrator `postgres` not superuser) | REHEARSAL PASS | 31 expectations OK, 0 FAIL; F0 = F1 = F2 `TOTAL 43 fee9e473…`; isolation `27 / 0 / 0 PASS` with migrations 0000–0004 + seed | this branch |
| Claims MAC checks (scratch cluster, 01:56 UTC) | as expected | HMAC equals Node `crypto.createHmac` on 3 vectors; install → INSTALLED, again → ALREADY_INSTALLED, other key → V1409; forged claims without MAC, claims rewritten after MAC, MAC replayed from another transaction → 0 cases; as `cdf_v13_app` → 42501; persona `email` column → 42501, own e-mail via `current_persona()`; correlation id in 3 audit rows; reset script clears the key and the chain still verifies | this branch |
| Rehearsal re-run after the MAC changes | REHEARSAL PASS | isolation 27 / 0 / 0, F0 = F1 = F2 | this branch |
| Manual psql checks on a scratch PostgreSQL 16 cluster (superuser, `set local role cdf_v13_user`) | as expected | visibility table in DATA_MODEL §5 (9 contexts); commands: 14 refusals with the expected SQLSTATE (V1404 unknown/other case/restricted/other role, V1409 stale and duplicate key, V1422 terminal, V1423 closed, 42501 outbox/audit/verify/_append_audit, V1403 audit UPDATE/TRUNCATE and event DELETE) and 4 allowed calls; chain valid under two time zones, tamper detected | this branch |

These manual checks become Vitest suites in `tests/integration/` once ARCH-001 lands; they are not a substitute.

## Unresolved defects
- None known. Open design points for the reviewer: (1) closed cases readable, not writable; (2) duplicate idempotency key refused even for an identical replay; (3) Governance Officer can change a task only when assigned to the case.

## Dependencies and requests
- V13-ARCH-001 (package.json, Vitest, `pnpm db:local`/`db:reset`/`db:lint`, migration runner, CI) — needed before PRs.
- ARCH: a CI job that runs `node scripts/db/rehearse-shared.mjs` when `database/**` changes (V13-DB-006 acceptance).
- PR split ruled: (a) 0001 + `lib/db/security-context.ts`; (b) 0002–0004, seed, rehearsal, stacked on (a).
- ARCH-001 head to branch (a) from; `lib/db` handed to DB when it lands; registry-vs-seed integration test then.
