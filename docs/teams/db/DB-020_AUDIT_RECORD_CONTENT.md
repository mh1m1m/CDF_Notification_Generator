# V13-DB-020 — Audit record content: outcome and policy version (design note)

**SYNTHETIC-DATA REFERENCE IMPLEMENTATION — not CDF production.** Team DB · 1 Nov 2026 · status: **PROPOSED**, with the Chief Architect's
decisions of 1 Nov (PR #115 comment 6553045144) folded in (§7), for acceptance. No migration is written until this note is accepted. Requirement: **REQ-AUD-005** "Each
audit record includes actor, action, target, timestamp, outcome, correlation ID and the relevant policy version."
Governing: ADR-011 (append-only hash-chained ledger), ADR-017 (attribution from verified claims).

## 1. Gap today

`cdf_notifications_v13.audit_event` (migration 0001) already carries five of the seven items:

| REQ-AUD-005 item | Column today |
| ---------------- | ------------ |
| actor | `actor_persona_id` (from verified claims only, ADR-017) |
| action | `action` |
| target | `entity_type`, `entity_id`, `case_id` |
| timestamp | `occurred_at` (`clock_timestamp()`) |
| correlation ID | `correlation_id` (from verified claims only) |
| **outcome** | **missing** |
| **policy version** | **missing** |

Writers: `api_install_claims_key` (CLAIMS_KEY_INSTALLED), `api_update_task_status` (TASK_STATUS_CHANGED),
`api_create_notification_draft` (NOTIFICATION_DRAFT_CREATED), `api_switch_workspace` (WORKSPACE_SWITCHED), and the two
seeds (SEED_M1_LOADED, SEED_M1_CASES_LOADED). All go through `_append_audit`. A refused command raises and its
transaction rolls back, so today **every row is a success** and no refusal is ever recorded.

## 2. Hash-chain inputs

**Before (hash version 1, rows written by 0001–0011):**

```
row_hash = sha256( seq | occurred_at (UTC, µs) | actor | workspace | action | entity_type | entity_id | case_id
                   | correlation_id | metadata::text | prev_hash )          -- NULL ids as '-', '|' separators
```

**After (hash version 2, every row written once the new migration is applied):**

```
row_hash = sha256( 'v2' | seq | occurred_at (UTC, µs) | actor | workspace | action | entity_type | entity_id | case_id
                   | correlation_id | outcome | policy_version | metadata::text | prev_hash )
```

- The leading `'v2'` domain-separates the two formulas, so no version-1 input string can equal a version-2 one.
- `outcome` is a code (§3); `policy_version` is a fixed-format code (§4), `'-'` only if absent (not allowed for v2).
- `prev_hash` still chains every row to the one before it, across the version boundary: the first v2 row's
  `prev_hash` is the last v1 row's `row_hash`.

## 3. Outcome

New column `outcome text not null default 'SUCCEEDED'`, check `outcome in ('SUCCEEDED', 'REFUSED')`.

- **SUCCEEDED**: the command did what was asked (every row written today).
- **REFUSED**: written only by V13-DB-021 (decision 1, §7). Not written by this step.
- Only decided values are pinned. Another value (for example a NO_CHANGE for an idempotent command) is a one-line
  migration when a writer needs it.

**Refusals (decided: A).** PostgreSQL cannot commit an audit row inside the transaction that is
rolling back, and V13 has no autonomous transactions (no dblink, no extensions, CLAUDE.md §2). Two ways:

- **(A, decided) Successes now, refusals as their own step.** This step records `outcome` for every committed
  command (SUCCEEDED). A later task (DB-021, with SEC) adds `api_record_refusal(p_command text, p_code text,
  p_entity_type text, p_entity_id uuid)`: SECURITY DEFINER, called by `lib/db` in a **new** transaction after a command
  raised a V14xx code. Actor, workspace and correlation id still come from the verified claims; the arguments are
  codes and ids only (allow-listed command and refusal codes); the case id is recorded only if `can_access_case` is
  true, so a refusal row never confirms that a hidden case exists. Rate and volume limits are part of that task.
- **(B) Refusals in the same step.** Same as A, built now. Larger change (lib/db, SEC suites, new command), and the
  refusal path needs its own threat review; it would delay REQ-AUD-005's outcome and policy-version columns.

**Which command supplies each new value.** No caller passes either value. `_append_audit` keeps its signature; it
sets `outcome` and reads `policy_version` itself, inside the chain lock, so no command can choose or forge them.

| Writer (action) | outcome | policy_version |
| --- | --- | --- |
| `api_install_claims_key` (CLAIMS_KEY_INSTALLED) | SUCCEEDED, by `_append_audit` | latest `policy_version` row, by `_append_audit` |
| `api_update_task_status` (TASK_STATUS_CHANGED) | SUCCEEDED, by `_append_audit` | same |
| `api_create_notification_draft` (NOTIFICATION_DRAFT_CREATED) | SUCCEEDED, by `_append_audit` | same |
| `api_switch_workspace` (WORKSPACE_SWITCHED) | SUCCEEDED, by `_append_audit` | same |
| seed 0001 (SEED_M1_LOADED), seed 0002 (SEED_M1_CASES_LOADED) | SUCCEEDED, by `_append_audit` | same |
| `api_record_refusal` (V13-DB-021, not this step) | REFUSED, by an internal `_append_audit_outcome` that only that command may call | same |

If no `policy_version` row exists, `_append_audit` raises and the command rolls back, so a v2 row can never carry an
absent version. No existing command body changes in this step.

## 4. Policy version

The relevant policy for a V13 database command is the **access policy the database enforced**: the RLS policies and
the authorisation functions (`can_access_case`, `is_assigned_to_case`, `current_*`, `has_role`, the commands' own
checks). Proposal:

- New owner-only table `policy_version (version text primary key check (version ~ '^V13-ACCESS-\d{4}$'), fingerprint
  text not null, recorded_at timestamptz not null default clock_timestamp(), migration text not null)`, RLS enabled
  and forced, deny-all, append-only (same trigger as the ledger). Each migration that changes the access policy inserts
  a row: `version` = `V13-ACCESS-<NNNN>` (the migration number), `fingerprint` = `_policy_fingerprint()`.
- **What `_policy_fingerprint()` covers** (decision 2), for objects in `cdf_notifications_v13` only (ADR-012: the
  hosted database is shared; it reads the catalogue for that schema and nothing else):
  - every policy: table, name, command, roles, permissive or restrictive, USING and WITH CHECK (`pg_get_expr`);
  - every table's `relrowsecurity` and `relforcerowsecurity`;
  - the ACL of every table, view and sequence, of every function, and of the schema itself;
  - the definition of every function in the schema (`pg_get_functiondef`).
  Each part is ordered by schema-qualified name, functions by `oid::regprocedure::text` so overloads sort
  deterministically; the result is sha256 of the joined text. So `DISABLE ROW LEVEL SECURITY`, a new `GRANT` and a
  changed function body each change the fingerprint, not only a policy expression.
- **Computed on the server at apply time, never a literal.** The migration inserts `_policy_fingerprint()`'s result on
  the server it runs on (local PostgreSQL 16, CI's 17 and the hosted server may print definitions differently). The
  guard compares the live value with the latest row on the same server.
- **"Latest" is the highest `version`** (`order by version desc limit 1`; fixed four digits, so text order is number
  order), never `recorded_at`.
- `_append_audit` writes the latest version into the row (inside the chain lock; one primary-key read).
- `audit_event.policy_version` gets a foreign key to `policy_version.version` (ARCH left it to DB; taken, it makes
  the invariant explicit and costs one index lookup per append).
- **Guard (automated, ruling (b) on #71):** a test, and a new check in `post_apply_checks.sql` (ARCH path, proposed),
  recomputes the live fingerprint and fails unless it equals the latest row's. A migration that changes a policy or an
  authorisation function without recording a new version therefore fails CI and the hosted post-apply check.
- The first row is `V13-ACCESS-0012`, inserted as the last statement of 0012, so it fingerprints the access policy as
  0012 leaves it (including the new table and functions).
- The **disclosure** policy version of a notification (lib/disclosure, `policy_version` in the M5 lifecycle model) is a
  property of the notification record, not of the database access rule. It belongs on the notification row when M5
  builds dispatch (REQ-AUD-003, M5 in the register), not in this step. REQ-AUD-005 therefore stays IN_PROGRESS for
  that part; PROC's register pass records it.

## 5. How rows written before the change verify

- The migration adds three columns to `audit_event` with constant defaults: `hash_version smallint not null default 1`,
  `outcome text not null default 'SUCCEEDED'`, `policy_version text`. In PostgreSQL 11+ adding a column with a
  constant default is a catalogue-only change: **no existing row is rewritten**, no UPDATE runs, the append-only
  trigger never fires, and existing `row_hash` values stay as they are.
- A check constraint pins the meaning of old rows: `hash_version = 1 implies (outcome = 'SUCCEEDED' and policy_version
  is null)`, and `hash_version = 2 implies policy_version ~ '^V13-ACCESS-\d{4}$'`. A version-1 row can therefore
  never carry an outcome or policy version that its hash does not cover. The constraint is validated against existing
  rows when it is added (they hold the defaults).
- `_audit_row_hash` keeps its v1 signature and body unchanged; a new `_audit_row_hash_v2(…)` computes §2. `_append_audit`
  writes `hash_version = 2` with the v2 hash. The column default stays 1 only so the ALTER is catalogue-only; the
  migration then sets the default to 2 so no path can write a v1 row by omission (and `_append_audit` sets it
  explicitly anyway).
- `verify_audit_chain()` recomputes each row with the formula of its `hash_version`, and also fails when
  `hash_version` decreases along `seq` (no v1 row after the first v2 row: a downgrade would drop outcome and policy
  version from the hash). Its result shape is unchanged (counts and first broken seq only).
- Tests (integration, `catalog-audit.spec.ts` + a new suite):
  - a ledger built by 0000–0011 with rows of every writer, then the new migration: `verify_audit_chain()` is valid,
    every pre-existing `row_hash` is byte-identical, rows are `hash_version 1`; new rows are v2 with SUCCEEDED and the
    current policy version; the chain crosses the boundary;
  - negatives: a v2 row with its outcome or policy version changed (trigger disabled as in the existing test) is
    reported at its seq; a v1 row inserted after a v2 row is reported; a v1 row with a non-default outcome is refused
    by the constraint; an outcome outside SUCCEEDED/REFUSED is refused; each of disabling RLS on one table, granting
    one table privilege and changing one function body without a new `policy_version` row fails the fingerprint
    guard (decision 2), and recording a new row makes it pass again;
  - the hosted resume rehearsal (`hosted-resume.spec.ts`) keeps verifying across the change.
- Hosted: the hosted project holds version-1 rows today (at least CLAIMS_KEY_INSTALLED). They verify unchanged by the
  argument above; `post_apply_checks.sql` P07 keeps running `verify_audit_chain()`.

## 6. What the migration would contain (for sizing; not written yet)

Migration 0012: three columns + two check constraints on `audit_event`; `policy_version` table (RLS, deny-all,
append-only triggers) + its first row (last statement); foreign key from `audit_event.policy_version`;
`_policy_fingerprint()` (owner only); `_audit_row_hash_v2`; new bodies for
`_append_audit` and `verify_audit_chain()` (same signatures; dropped and created again in the same migration with
their grants restored, so the rollback register files them under **Replaces** of 0012 exactly). No change to any `api_*` command, grant or
RLS policy. Rollback-register entry §9. A separate commit in the same PR adds the fingerprint check to
`database/hosted/post_apply_checks.sql` for ARCH to accept as owner (decision 3). SEC reviews; the definer allow-list (SEC path) gains `_policy_fingerprint` only
if it is SECURITY DEFINER (proposed: invoker, owner-only EXECUTE).

## 7. Decisions (Chief Architect, 1 Nov, PR #115 comment 6553045144)

1. **Refusals: A.** This step records SUCCEEDED for committed commands. Recording refusals is **V13-DB-021**, starting
   with its own short design note and SEC's threat review before any code: allow-listed command and refusal codes, ids
   only; the case id only when `can_access_case` is true; attribution only from the verified claims; volume limits; how
   `lib/db` calls it in a new transaction without turning the refusal into an oracle. NO_CHANGE is dropped from the
   check (§3).
2. **Policy version: the database access-policy fingerprint**, with the disclosure policy version on the notification
   record in M5 (REQ-AUD-005 stays IN_PROGRESS for that part). Conditions, folded into §4 and §5: the fingerprint
   covers policies, RLS enabled and forced flags, the ACLs of tables, views, sequences, functions and the schema, and
   every function definition; scope `cdf_notifications_v13` only; deterministic order, functions by `regprocedure`;
   computed on the server at apply time; latest = highest version; negative tests for disabled RLS, one grant and one
   changed function body. Optional foreign key: taken.
3. **`post_apply_checks.sql`:** DB proposes the lines in the 0012 PR as a separate commit; ARCH accepts them as owner.
