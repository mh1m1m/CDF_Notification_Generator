# DB status — CDF V13 Enterprise (synthetic data only)

Updated: 2026-10-31 18:55 UTC · Team DB · Reviewer of DB PRs: SEC

## Delivery plan (ruled by the Chief Architect)

| PR | Branch | Content | State |
| -- | ------ | ------- | ----- |
| (a) `[V13-DB-001]` | `feature/V13-DB-001-identity-claims-audit` | migration 0001 (identity, claims MAC, audit ledger, deny-all on `schema_migrations`), seed part 1 (identity), app-side claims MAC in `lib/db/security-context.ts`, key install at server start (`instrumentation.ts` → `lib/db/claims-key-startup.ts`), `database/hosted/reset_claims_key.sql` (ARCH path, proposed by DB), suites | COMPLETE — #12 merged 2386ce9 (SEC ACCEPT) |
| (b) `[V13-DB-002]` | `feature/V13-DB-002-case-registry-notifications`, stacked on (a) | migrations 0002–0004, seed part 2 (cases), `scripts/db/rehearse-shared.mjs`, case-access suite, FE contract ruling on 0002, persona-registry tests un-skipped | COMPLETE — #15 merged 7a79857 (SEC ACCEPT) |
| (c) `[V13-DB-007]` | `feature/V13-DB-007-workspace-switch`, stacked on (b) | migration 0005 `api_switch_workspace` (ids-only WORKSPACE_SWITCHED audit), workspace-switch suite (14), definer allow-list entry | COMPLETE — #17 merged e6717de (SEC ACCEPT) |
| (d) `[V13-DB-008]` | `feature/V13-DB-008-case-workspace-reads`, stacked on (c) | migration 0006: `case_events`, `case_tasks`, `case_header.my_capacity` (FE-004, ARCH ruling 28 Oct), case-workspace suite (22) | COMPLETE — #21 merged c4b37c3 (SEC ACCEPT) |

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
Per-PR counts are in each PR description, from runs on the PR head. Final local run on `develop` c4b37c3
(31 Oct 2026, local PostgreSQL 16 via `pnpm db:local`):
- `pnpm lint`: exit 0 · `pnpm typecheck`: 0 errors · `pnpm db:lint`: 7 migration files, 0 findings
- `pnpm test`: 717/717 · `pnpm db:reset` then `pnpm test:db`: 208/208 (10 files)
- `node scripts/db/rehearse-shared.mjs`: REHEARSAL PASS · `pnpm build`: ok · `pnpm test:e2e`: 73/73
- CI green on each merged head (e.g. #21 f53d007, run 41229075061).

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
- ARCH follow-up after (a): report a key mismatch in `/api/health`.
- Hosted: the Chief Architect applies 0001–0006 with the plan procedure. DB never connects. Hosted notes:
  every deployment that shares the schema (previews included) must use the same `V13_SESSION_SECRET`, because the
  claims key is installed first-writer-wins at server start; seed part 2 needs 0001–0004; every request now takes a
  transaction id (`pg_current_xact_id()`), negligible at prototype load (SEC INFO).
