# PROC status — CDF V13 Enterprise (synthetic data only)

Updated: 2026-10-28 ~03:45 UTC · Branch: `claude/project-thread-94r9g5` · Base: `develop` b02e672

## Completed
- Baseline of the V13 reference package reproduced on a scratch copy: 726 tests, 726 pass (Node v22.22.0).
- `docs/teams/proc/PORT_PLAN.md` — module mapping, porting rules, test carry-over, fixture fixes BL-45/BL-46,
  requests to ARCH — IN_REVIEW.

## In progress / next
| Task | State | Note |
| ---- | ----- | ---- |
| V13-PROC-001 domain status model | READY after V13-ARCH-001 | no code in the repository until the app skeleton is on `develop` |
| V13-PROC-002 journeys + BL-45/BL-46 fixture fixes | NOT_STARTED | fixtures fixed before DB-005 seeds from them |
| V13-PROC-003 disclosure | NOT_STARTED | |
| V13-PROC-004 authority | NOT_STARTED | |
| V13-PROC-005 notifications | NOT_STARTED | |

## Changed files
- `docs/teams/proc/PORT_PLAN.md`, `docs/teams/proc/STATUS.md`

## Test evidence
| Command | Result | Counts | Commit |
| ------- | ------ | ------ | ------ |
| `node --test "tests/**/*.test.js"` in a scratch copy of `/mnt/project-files/notifications/v13` with `journeys/`, `generator/` and the built demo | PASS | 726 tests · 726 pass · 0 fail · 0 skipped | reference package (not this repository) |
| `pnpm lint` · `pnpm typecheck` · `pnpm format:check` · `pnpm test` on this branch after merging `develop` f0a7220 (no PROC code yet) | PASS | lint 0 errors/warnings; typecheck 0 errors; format clean; unit 17 files · 251 tests · 251 pass | 8e8236c |
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
- Waiting: V13-ARCH-001 on `develop`.
