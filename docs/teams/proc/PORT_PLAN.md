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
3. **Server-only and the disclosure boundary.** `lib/disclosure`, `lib/authority`, `lib/notifications/render`,
   `lib/notifications/next-action` and `lib/notifications/lifecycle` start with `import 'server-only'` (package
   `server-only` 0.0.1, in the foundation). Node built-ins used: `node:crypto` only. `server-only` blocks imports
   only: a Server Component could still hand an unprojected model to a client component, and the model would then
   travel in the RSC payload. Therefore (SEC review of PR #3):
   - `lib/disclosure` `project()` returns a branded type `Projected<T>` (a compile-time brand on top of the runtime
     `_disclosure_applied` marker and registry); renderers and every app view model built from a notification accept
     only `Projected<T>`, so an unprojected model does not type-check, and `assertProjected` still refuses it at run time;
   - the e-mail preview is shown only in a sandboxed `<iframe srcdoc>` with no `allow-scripts` and no
     `allow-same-origin`, never through `dangerouslySetInnerHTML` (FE builds the page; REQ-NOTIF-011). PROC's renderer
     returns the HTML string and never a React element;
   - `policy_v13.json` and `authority_v13.json` are imported only by `lib/disclosure/project.ts` and
     `lib/authority/check.ts` (both server-only) and are never re-exported through `lib/domain`, `lib/journeys` or any
     module without `import 'server-only'`, so neither file can reach a client bundle. A unit test asserts that no
     other `lib/` file imports either JSON file.
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
| Runs the V12 engine suite on an untouched V12 copy (86 tests, 437 MB generator) | REG-13 | **NOT_PORTED**: the test does not exist in the repository (no skipped test in the committed suite). It would need the V12 generator source and its 86-test engine suite; it stays in the reference package |
| Checks the V12 hash ledger | REG-14 | **PARTIAL**: checks the 5 V12 journey-catalogue rows against frozen copies; the 95 `generator/source/` rows are not verified (4.8 MB of V12 generator code not copied) |
| Re-checks the 77 V12 sample e-mails for `X-Unsent` | PC-15 | **PARTIAL**: the 77 V12 sample EMLs (118 MB) are not in the repository; the synthetic PC-15 cases run |
| Quotes lines of V12 e-mails and samples (V12 replays) | PC-02, PC-06, PC-07, PC-09, PC-17 (×2), PC-18, PC-22, PC-23, PC-24 (×2) | **PARTIAL**: V12 EML evidence is never copied into the repository (Chief Architect, 28 Oct); the replay's rule assertions run, the quoted V12 line is reported as not re-verified |

Repository count when PROC-005 lands: **734 pass, 0 skipped** (725 ported reference tests + 9 BADGE tests for the
ADR-013 mapping); REG-13 not ported; REG-14, PC-15 and the eleven V12 replays partial. The exact list per test id is
recorded in each PR.

### Equivalence evidence

Beyond the tests, the port is compared with the reference package by script, and each PR names the commit the
comparison ran on: journey outputs (`resolveLevel1`, `resolveLevel2_3`, `buildProgressView`) for every scenario ×
13 recipient classes; `decide()` over every recipient × field × channel × context (42,840 combinations); the in-memory
demo build against the reference `out/demo/MANIFEST.json` (516 files, sha256). Scenarios changed by the BL-45 fixture
corrections are listed as expected differences with their reason.

### Copy-time scan of the evidence files

Every file under a PROC `tests/unit/**/__evidence__/` folder (including the charter and `work/` excerpts) is scanned
before its sha256 manifest is taken, and again on every test run (a unit spec in the PROC test folders). Patterns:
e-mail addresses not `@example.test`; `gov.sa`; national-ID-like numbers (10 digits starting 1 or 2, not inside a
longer alphanumeric run); `+966` / `00966` and `05` phone numbers; SA IBANs; case references outside `CDF-DEMO`. A
reviewed false positive is allowed only by an exact entry (file name, pattern, matched text) with its reason. Each PR
records the command and its result.

Scratch run (28 Oct ~02:45 UTC, 15 files): 0 hits, 1 allowed — `v9_data.json` line 4252 `CDF-IC-2026-0001`, inside the
V12 synthetic rule text "do not use the former CDF-IC-2026-0001 as a fact without checking" (a superseded synthetic
reference). To get there, the V12 hash-ledger copy was cut to the 100 rows REG-14 reads (header + `journeys/` +
`generator/source/`): the other rows' byte sizes matched the national-ID pattern, and one sha256 contained a 10-digit
run, which the boundary rule now excludes.

Update (ARCH, 28 Oct 04:05): the allowance is dropped. The repository copy of `v9_data.json` carries `CDF-DEMO-2026-0001`
in that rule text instead, like the charter and `ui_v9.js` copies; `docs/teams/proc/EVIDENCE_MANIFEST.md` records each
difference from the source and the sha256 of the committed bytes. The scan now runs with no allowance: 15 files, 0 hits.

## 6. Fixture fixes before any seed reads the scenarios (BL-45, BL-46; gate G2)

ST-34 lists 12 scenarios whose declared object status is not what the domain fold of their own events gives.

- **BL-45 (five fixture defects)** — fix the fixture, never the fold or a rule (done in the scratch port; listed with
  before/after in the PROC-002 PR):

  | Scenario | Before | After | Rule that required it |
  | -------- | ------ | ----- | --------------------- |
  | EC-01 | REPORT COMPLETED from `evt-EC-01-08` (a case-code event) | REPORT OPEN from `evt-EC-01-01` (`REPORT_RECEIVED`) | a procedural object's status comes only from its own driving events (charter §2 domain B; `drivingEvents` in `lib/domain/status`), never from the case code (backlog BL-45) |
  | SUM-01 | REFERRAL IN_PROGRESS from `evt-SUM-01-09` (a case-code event) | no declared status (`null`): no recorded event drives the referral | same |
  | WIT-01 | HEARING SCHEDULED from `evt-WIT-01-01` (`STATEMENT_REQUESTED`) | no declared status (`null`): a statement request drives a TASK, never a hearing | same (`STATEMENT_REQUESTED` drives TASK → ASSIGNED only) |
  | CF-35 | `AUTHORITY_DECISION_RECORDED` names the recommendation by a bare id | the same event carries the typed reference `{type: RECOMMENDATION, id}`; the fold then gives the declared DECIDED from `evt-CF-35-09` | the RECOMMENDATION table's decision rows match a typed `payload.target` (backlog BL-45: "a typed reference from the decision event to the recommendation") |
  | CF-37 | DECISION DECIDED from its notice `evt-CF-37-01` | adds `evt-CF-37-00a` `PACKAGE_SUBMITTED_TO_AUTHORITY` and `evt-CF-37-00b` `AUTHORITY_DECISION_RECORDED` (outcome APPROVE) before the notice; DECIDED from `evt-CF-37-00b` | FI-11: a decision is never inferred from the issue or delivery of its notice |

- **BL-46 (seven journey-bound procedures: CF-15 … CF-19, CF-23b, CF-36)** — ON HOLD (Chief Architect, 28 Oct): new
  PROCEDURE rows change status semantics and need the owner's approval (REQ-GOV-014). The proposal is in
  `docs/teams/proc/PROPOSALS.md`; until approved the port keeps the reference behaviour and ST-34's documented
  differences.
- Acceptance for BL-45: the five scenarios no longer appear in ST-34's differences, no rule or status meaning changes,
  and the journey, progress and render tests that read these fixtures stay green. Lands before DB-005 seeds anything
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
