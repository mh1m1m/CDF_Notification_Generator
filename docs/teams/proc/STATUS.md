# PROC status — CDF V13 Enterprise (synthetic data only)

Updated: 2026-10-31 ~18:45 UTC · Branch: `claude/project-thread-94r9g5` · Base: `develop` 64aa5c1

## Completed
- Baseline of the V13 reference package reproduced on a scratch copy: 726 tests, 726 pass (Node v22.22.0).
- `docs/teams/proc/PORT_PLAN.md` — module mapping, porting rules, test carry-over, fixture fixes BL-45/BL-46,
  requests to ARCH — COMPLETE (PR #3 merged into `develop` 2990c28).
- Full port of all five modules on a scratch copy: tsc 0 errors, 734 pass, 0 skipped (lands PR by PR, below).

## In progress / next
| Task | State | Note |
| ---- | ----- | ---- |
| V13-PROC-001 domain status model | COMPLETE | PR #18 merged into `develop` 64aa5c1 (31 Oct) |
| V13-PROC-002 journeys + BL-45 fixture fixes | IN_REVIEW | `lib/journeys` + `tests/unit/journeys` (81 tests); BL-45 fixed (five scenarios); BL-46 held (OI-020) |
| V13-PROC-003 disclosure | NOT_STARTED | |
| V13-PROC-004 authority | NOT_STARTED | |
| V13-PROC-005 notifications | NOT_STARTED | |

## Changed files
- PR #3: `docs/teams/proc/PORT_PLAN.md`, `docs/teams/proc/STATUS.md`
- PROC-001: `lib/domain/{badge,concepts,epistemic,index,invariants,nil,status,types}.ts`,
  `tests/unit/domain/{badge,evidence-scan,invariants,status}.spec.ts`, `tests/unit/domain/__evidence__/` (4 files),
  `docs/teams/proc/EVIDENCE_MANIFEST.md`, `docs/teams/proc/PORT_PLAN.md` (§5 note), this file

## Test evidence
| Command | Result | Counts | Commit |
| ------- | ------ | ------ | ------ |
| `node --test "tests/**/*.test.js"` in a scratch copy of `/mnt/project-files/notifications/v13` with `journeys/`, `generator/` and the built demo | PASS | 726 tests · 726 pass · 0 fail · 0 skipped | reference package (not this repository) |
| `pnpm lint` · `pnpm typecheck` · `pnpm format:check` · `pnpm test` on this branch after merging `develop` f0a7220 (no PROC code yet) | PASS | lint 0 errors/warnings; typecheck 0 errors; format clean; unit 17 files · 251 tests · 251 pass | 8e8236c |
| PROC-001: `pnpm lint` · `pnpm typecheck` · `pnpm test` (develop 2990c28 + PROC-001) | PASS | lint exit 0; typecheck exit 0; unit 22 files · 541 tests · 541 pass, of which `tests/unit/domain` 4 files · 203 pass · 0 skipped | PROC-001 head |
| PROC-001: `pnpm format:check` | FAIL then (expected) | only the two byte-exact evidence JSON copies; fixed by #20 (evidence ignores) | 37a5cfc |
| PROC-001 after merging `develop` 2ec6ce0: `pnpm format:check` · `pnpm lint` · `pnpm typecheck` · `pnpm test` | PASS | format, lint, typecheck exit 0; unit 30 files · 694 pass, of which `tests/unit/domain` 4 files · 203 pass · 0 skipped; EVIDENCE_MANIFEST sha256 of all 4 domain copies match byte for byte | merge of 2ec6ce0 |
| PROC-001: copy-time scan `tests/unit/domain/evidence-scan.spec.ts` (EVS-01/02) | PASS | 4 evidence files · 0 hits · 0 allowed | PROC-001 head |
| PROC-002: `pnpm format:check` · `pnpm lint` · `pnpm typecheck` · `pnpm test` (develop 64aa5c1 + PROC-002) | PASS | all exit 0; unit 33 files · 775 pass, of which `tests/unit/journeys` 3 files · 81 pass · 0 skipped; evidence scan (EVS-01) now covers the journeys evidence and `lib/journeys/**/*.json`: 0 hits | PROC-002 head |
| PROC-002 equivalence: reference `src/journeys/{resolve,progress}.js` vs `lib/journeys` on the same inputs (22 reference scenario files, refs `CDF-IC-2026-DEMO-NNNN` normalised to `CDF-DEMO-2026-NNNN`), 32 runs incl. variants × (resolve + 13 recipient classes) | PASS | 448 outputs compared, 0 differ; catalogue identical after the ref rename | PROC-002 working tree on 64aa5c1 (after prettier) |
| PROC-002 fixture effect (BL-45): `lib/journeys` on reference vs ported fixtures | EXPECTED DIFFERENCES ONLY | 5 scenario files changed (EC-01, SUM-01, WIT-01, CF-35, CF-37); 448 outputs compared, 2 differ, both CF-37 (base and CF-37-V1: the added `AUTHORITY_DECISION_RECORDED` before the notice); ST-34 now lists only the 7 BL-46 scenarios | same |
| same, `src/` + `tests/` only | FAIL (expected: evidence missing) | 713 run · 705 pass · 5 fail · 3 skipped | reference package |

### Baseline without sibling evidence (`src/` + `tests/` only): causes

| Test | Result | Cause |
| ---- | ------ | ----- |
| JR-01 | FAIL | reads `work/` journey-assignment CSV (112 V12 assignments), not present |
| JR-05 | FAIL | reads `work/new_event_types.md` (lead ruling L-05 list), not present |
| JR-17 | FAIL | reads the `work/` V12 → V13 traceability CSV, not present |
| JR-18 | FAIL | reads the `work/` assignment and journey-change CSVs, not present |
| `tests/regression.test.js` (file) | FAIL | the file aborts at load: `out/demo/MANIFEST.json` (generated demo) and the V12 sibling folders are missing, so its 14 tests do not run and the file counts as one failed test (726 − 14 + 1 = 713) |
| ST-18 | SKIPPED | `work/V13-02_concepts.csv` not present |
| ST-22 | SKIPPED | `../../journeys/level2_journeys.json` (V12 evidence) not reachable |
| ST-33 | SKIPPED | the owner's directive text under `work/owner_messages_2026-10-27/` not reachable |

With `work/`, the charter and `docs/` added the result is 726 / 720 pass / 6 fail (REG-09 … REG-14: demo output and V12
evidence); with the V12 siblings and the demo built, 726 / 726.

## Unresolved defects
- Gate G2 PARTIAL: 7 of 22 scenarios declare a status their own events do not give (BL-46: CF-15 … CF-19, CF-23b,
  CF-36), listed by ST-34. BL-45 (the other five) fixed in PROC-002. BL-46 waits for the owner (OI-020).

## Dependencies and requests
- V13-ARCH-001 merged into `develop` (f0a7220, 28 Oct); merged into this branch.
- Plan §7 answered by ARCH (28 Oct ~01:53 UTC): `server-only` 0.0.1 and `resolveJsonModule` in the foundation; tests
  named `*.spec.ts`; port shapes proposed under `lib/contracts/ports/` (ARCH + SEC accept), reusing `CaseSourceAdapter`,
  `ClockPort`, `IdGeneratorPort`, `AuditSinkPort`; i18n per ADR-013 (`lib/i18n/{status,journeys}/{ar,en}.ts`); e-mail
  token snapshot accepted as interim (UX to confirm); unit fixtures may use other `CDF-DEMO-2026-NNNN` numbers, never
  seeded; PRs from `claude/project-thread-94r9g5` one at a time.
- Answered: the epistemic mapping (seven domain classes → ADR-013's four `data-epistemic` values) is ruled in
  `docs/MASTER_EXECUTION_PLAN.md` §8 "Epistemic mapping"; built as `lib/domain/badge.ts` with 9 tests in the port.
- SEC review of PR #3 (`REVIEW: CHANGES 1c9d826`): disclosure boundary (`Projected<T>`, sandboxed preview), policy and
  authority JSON server-only, copy-time evidence scan: added to PORT_PLAN §3.3 and §5.
- BL-46 held for the owner (OI-020); proposal in `docs/teams/proc/PROPOSALS.md`.
- ARCH 28 Oct ~03:47–04:05: rule T5 list (`COMPLETED_CLASS_STATUSES`, 11 entries) owned by PROC in `lib/domain`; QA
  imports it once PROC-001 merges. ADR-016: domain {ar,en} labels stay in `lib/domain`; `lib/i18n` status/journeys hold
  the UI keys, pinned equal by a unit test (lands with the first UI keys). Evidence check accepted; `v9_data.json` copy
  renamed `CDF-IC-2026-0001` → `CDF-DEMO-2026-0001`, scan allowance dropped.
- Checks moved out of the domain specs because they read other modules' data: ST-29b, ST-32b, ST-34 land with PROC-002;
  ST-28b with PROC-004; ST-07b with PROC-005. Each is strict (a missing file fails).
- Evidence ignores landed in #20 (develop 2ec6ce0, 31 Oct). Waiting: SEC review of PR #18.
