# PROC port plan — V13 reference package → `lib/` (strict TypeScript)

**SYNTHETIC-DATA REFERENCE IMPLEMENTATION — not CDF production.** Team PROC (procedural intelligence). Tasks
V13-PROC-001 … 005 (`docs/AGENT_TASK_BOARD.md`). Status of this plan: PROPOSED, for the Chief Architect's review.

## 1. Source and baseline (FACT, measured 28 Oct 2026 ~01:45 UTC)

- Source: the V13 reference package, `/mnt/project-files/notifications/v13/` (read-only evidence; never modified).
  Node 22, ESM, zero dependencies, `node --test`. `src/` = 52 JS files, 12,569 lines, plus three data files
  (`catalogue_v13.json` 303 KB, `policy_v13.json` 681 KB, `authority_v13.json` 150 KB) and 22 scenario fixtures.
  `tests/` = 14 files, 8,288 lines.
- Recorded result: 726 tests, 726 pass (run `2026-10-27T23-41-01-547Z`, `docs/V13-14_test_results.md`).
- Reproduced by PROC on a scratch copy of the package with its sibling evidence folders (`journeys/`, `generator/`)
  and the demo built first (`node src/demo/build_demo.js`): **726 tests, 726 pass, 0 fail, 0 skipped**, Node v22.22.0.
- Without the sibling evidence and the demo output the same suite gives 726 / 720 pass / 6 fail (REG-09 … REG-14).
  The package is therefore not self-contained: 14 REG tests and 3 ST tests read V12 evidence, `work/` notes, the charter
  or generated demo files. §5 says how each is carried over.

Per file: a11y 11 · authority 83 · consistency 121 · disclosure 18 · invariants 156 · journeys 56 · lifecycle 120 ·
next_action 12 · progress 22 · regression 14 · render 24 · security_lifecycle 41 · security_render 13 · status 35.

## 2. Module mapping (board §1 ownership)

| Reference (`src/`) | Target | Task | Notes |
| ------------------ | ------ | ---- | ----- |
| `domain/concepts.js`, `epistemic.js`, `status.js`, `invariants.js` | `lib/domain/` | PROC-001 | 20 concepts, 148 event types, 7 status objects, epistemic classes, 27 invariants |
| `journeys/catalogue_v13.json`, `resolve.js`, `progress.js`, `scenarios/*.json` | `lib/journeys/` | PROC-002 | Layer A (actual) and Layer B (expected) stay separate types; Level 1 fails closed (OI-004) |
| `disclosure/policy_v13.json`, `project.js` | `lib/disclosure/` | PROC-003 | server-only; `project()` is the only way to a renderable model |
| `authority/authority_v13.json`, `check.js` | `lib/authority/` | PROC-004 | `check()` fails closed; SOURCE_REQUIRED rows refuse |
| `lifecycle/notification.js`, `idempotency.js`, `evidence.js`, `export.js`, `util.js` | `lib/notifications/lifecycle/` | PROC-005 | state machine, sha256 idempotency key, evidence records |
| `consistency/rules.js`, `engine.js` | `lib/notifications/consistency/` | PROC-005 | PC-00 … PC-29 |
| `nextAction/rules.js` | `lib/notifications/next-action/` | PROC-005 | |
| `render/*.js` | `lib/notifications/render/` | PROC-005 | server-side e-mail and preview rendering with escaping |
| `lifecycle/adapters/*.js` (mocks of the case platform's `notify.*`, audit ledger, read models) | `tests/unit/notifications/fakes/` | PROC-005 | in-memory test doubles only, labelled `PRODUCTION_SUBSTITUTION_REQUIRED`; real implementations belong behind ports in `lib/contracts` (ARCH) and `lib/db` / `lib/adapters` (DB / FE) |
| `lifecycle/fixtures.js`, `demo/scenarios_inline.js`, `demo/consistency_ctx.js`, `demo/build_demo.js` | `tests/unit/notifications/support/` | PROC-005 | test support; the demo builder renders in memory (no files written) |

Dependency order inside PROC: 001 → 002 → (003 ∥ 004) → 005. Nothing in `lib/` reads the file system at run time:
data files are imported statically (`resolveJsonModule`) so the Next.js bundle carries them, and each loader validates
the data's shape once at load and fails closed on a mismatch.

## 3. Porting rules

1. **Behaviour first.** Every exported function keeps its name, inputs, outputs and error codes. Types are added; logic
   is not "improved" in the same change. A behaviour change is a separate, named commit with its own test.
2. **Strict TypeScript.** No `any` in exported signatures; `unknown` + narrowing at the data boundary. Discriminated
   unions for status objects, epistemic classes, Layer A states and Layer B kinds, so "actual" and "expected" cannot be
   assigned to each other. Frozen data stays frozen (`as const` + `Object.freeze`).
3. **Server-only.** `lib/disclosure`, `lib/authority`, `lib/notifications/render` and `lib/notifications/lifecycle`
   start with `import 'server-only'` (needs the `server-only` package: request to ARCH, §7). Node built-ins used:
   `node:crypto` only.
4. **SOURCE_REQUIRED stays.** No value marked SOURCE_REQUIRED, PROPOSED or UNVERIFIED in the package becomes a fact in
   the port. Level 1 still refuses without the V8 mapping (OI-004). The seven open owner decisions (OI-012) stay on
   their safe defaults.
5. **Synthetic identifiers.** Case references move from `CDF-IC-2026-DEMO-NNNN` to the repository format
   `CDF-DEMO-2026-NNNN` (CLAUDE.md §1). Only the literal changes; the tests that assert the format change with it, and
   the change is listed in the PR. UUIDs and opaque ids are kept.
6. **User-facing text.** The package keeps `{ ar, en }` pairs beside the code. They move to the PROC i18n namespaces
   `status` and `journeys` in the format ARCH sets in `lib/i18n/index.ts`; the domain modules re-export the same label
   objects, so the label tests keep running unchanged.

## 4. Tests

- Runner: Vitest (ARCH config). Each `node:test` file becomes one Vitest file under `tests/unit/<area>/`; `test` and
  `describe` come from `vitest`, assertions stay `node:assert/strict`, so assertion text is unchanged. Test ids
  (ST-, INV-, JR-, PG-, DIS-, AUT-, LC-, PC-, NA-, REN-, SEC-, A11Y-, REG-) and titles are kept, so counts compare
  one to one with the 726.
- `t.diagnostic(...)` becomes a note attached to the test (Vitest `task.meta`) and is printed in the PROC evidence.
- Every PR records, per file: reference count, ported count, pass, fail, not ported (with reason). Nothing is skipped
  silently; a test that cannot run in the repository is listed by id.

## 5. Tests that read files

Measured on the scratch copy by removing what the package reads from outside `src/`:

- with only `src/` + `tests/`: 713 tests ran (the REG file aborted), 705 pass, 5 fail (JR-01, JR-05, JR-17, JR-18 and
  the REG file), 3 skipped (ST-18, ST-22, ST-33: their evidence was not reachable);
- with `work/`, the charter and `docs/` added: 726 / 720 pass / 6 fail (REG-09 … REG-14: demo output and V12 evidence);
- with the sibling V12 folders and the demo built: 726 / 726.

How each kind is carried over:

| Kind | Examples | Carried over as |
| ---- | -------- | --------------- |
| Reads the package's own `src/` data or sources (catalogue, policy, authority JSON, scenario files, source text checks) | AUT-101, DIS-01, PC-15, PC-00f, INV-00c, JR-20, REN-23, SEC-11, ST-12, ST-19 … ST-21, ST-28, ST-29, ST-32, ST-34 | Static imports of the ported data; source-text checks read the ported `lib/` files |
| Reads the charter or `work/` notes (lead rulings, concept CSV, event-type list, journey trace) | ST-01, ST-07, ST-18, JR-01, JR-05, JR-17, JR-18 | Frozen synthetic excerpts under `tests/unit/<area>/__evidence__/` with a sha256 manifest of the mount copies at copy time |
| Reads the owner's directive text | ST-33 | **Not copied** (owner message, not repository material): ST-33 keeps the constants already in the test and records that the source excerpt is not in the repository |
| Reads V12 evidence (`journeys/level2_journeys.json`, `generator/source/tests/v9_data.json`, the V12 hash ledger) | ST-22, REG-14 | Frozen copies of the two synthetic JSON files with their sha256; the ledger check recomputes against those copies only (ADAPTED) |
| Reads generated demo output (`out/demo/`) | REG-01 … REG-12, A11Y-* | The demo builder renders in memory inside the test; no files written |
| Runs the V12 engine suite on an untouched V12 copy (86 tests, 437 MB generator) | REG-13 | **Not portable**: stays in the reference package; listed as NOT PORTED with the reason |

Expected repository count when PROC-005 lands: **725 ported + 1 not ported (REG-13)**. The exact list per test id is
recorded in each PR.

## 6. Fixture fixes before any seed reads the scenarios (BL-45, BL-46; gate G2)

ST-34 lists 12 scenarios whose declared object status is not what the domain fold of their own events gives.

- **BL-45 (five fixture defects)** — fix the fixture, never the fold:
  - EC-01: a REPORT status is declared from case-code events; declare the status the report's own events give
    (`REPORT_ACKNOWLEDGED` → the fold's state) and keep the case code on the case record only.
  - SUM-01: same pattern for the REFERRAL (no referral status from `CASE_STATUS_RECORDED`).
  - CF-35: the decision event targets the recommendation by bare id; give it the typed reference the fold needs, so the
    RECOMMENDATION status and its source event follow from the events.
  - CF-37: a DECISION is declared DECIDED from its notice; add the decision's own `AUTHORITY_DECISION_RECORDED` event
    before the notice.
  - WIT-01: a HEARING is declared SCHEDULED from a statement request; the declared object becomes the one the events
    support, or the scenario declares no status for it.
- **BL-46 (seven journey-bound procedures: CF-15 … CF-19, CF-23b, CF-36)** — one mapping table from journey events to
  the PROCEDURE lifecycle, so the generic PROCEDURE table and the catalogue cannot disagree. The table is a modelling
  artefact derived from the catalogue (labelled PROPOSED), not a governance value.
- Acceptance: ST-34 reports 0 differences, ST-34 becomes a strict assertion (not a diagnostic), and the journey,
  progress and render tests that read these fixtures stay green. This lands in PROC-002 before DB-005 seeds anything
  from the scenarios.

## 7. Requests to ARCH (through the Chief Architect)

1. `server-only` package (exact version) for the server-only modules (§3.3).
2. `tsconfig`: `resolveJsonModule: true` (static data imports); confirm the Vitest config includes `tests/unit/**`.
3. Ports in `lib/contracts` for what the reference mocks: notification outbox, audit sink, evidence store, recipient
   resolution, case read model (= `CaseSourceAdapter`), procedural read model, clock, id source. PROC proposes the
   interface shapes in the PROC-005 PR; ARCH owns the files.
4. i18n namespace file format for `status` and `journeys` (§3.6).
5. E-mail rendering needs inline colour values (`design/tokens.json` in the package). Proposal: PROC carries a frozen
   e-mail token snapshot in `lib/notifications/render/` until UX publishes `styles/tokens.css`, then reads the same
   source. UX to confirm.
6. Scenario case references: the 22 journey scenarios use case numbers beyond 0010 (0015 … 0037, 0901 … 0907). Default:
   keep the numbers in the repository format (`CDF-DEMO-2026-0015`) as unit-test fixtures that are never seeded; the M1
   seed keeps 0001 … 0010. ARCH to confirm or give another range.
7. Branch: this session can push only to `claude/project-thread-94r9g5`, so PROC PRs come from that branch one at a time
   (titles `[V13-PROC-00N] …`), not from `feature/V13-PROC-…` branches.
