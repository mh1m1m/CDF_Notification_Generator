# PROC status — CDF V13 Enterprise (synthetic data only)

Updated: 2026-10-28 ~04:25 UTC · Branch: `claude/project-thread-94r9g5` · Base: `develop` 2990c28

## Completed
- Baseline of the V13 reference package reproduced on a scratch copy: 726 tests, 726 pass (Node v22.22.0).
- `docs/teams/proc/PORT_PLAN.md` — module mapping, porting rules, test carry-over, fixture fixes BL-45/BL-46,
  requests to ARCH — COMPLETE (PR #3 merged into `develop` 2990c28).
- Full port of all five modules on a scratch copy: tsc 0 errors, 734 pass, 0 skipped (lands PR by PR, below).

## In progress / next
| Task | State | Note |
| ---- | ----- | ---- |
| V13-PROC-001 domain status model | IN_REVIEW | `lib/domain` + `tests/unit/domain` (203 tests); badge mapping (ADR-013) and rule T5 list; format gate waits ARCH-002 (`__evidence__` ignores) |
| V13-PROC-002 journeys + BL-45/BL-46 fixture fixes | NOT_STARTED | fixtures fixed before DB-005 seeds from them |
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
| PROC-001: `pnpm format:check` | FAIL (expected until ARCH-002) | only `tests/unit/domain/__evidence__/{level2_journeys,v9_data}.json`, byte-exact copies that ARCH-002 puts in `.prettierignore` | PROC-001 head |
| PROC-001: copy-time scan `tests/unit/domain/evidence-scan.spec.ts` (EVS-01/02) | PASS | 4 evidence files · 0 hits · 0 allowed | PROC-001 head |
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
- Gate G2 PARTIAL in the reference package: 12 of 22 scenarios declare a status their own events do not give (BL-45,
  BL-46). Fixed in PROC-002 (plan §6).

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
- Waiting: ARCH-002 (`tests/unit/**/__evidence__/` in `.prettierignore` and ESLint ignores); SEC review of PROC-001.
