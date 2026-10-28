# PROC status — CDF V13 Enterprise (synthetic data only)

Updated: 2026-10-28 ~01:55 UTC · Branch: `claude/project-thread-94r9g5` · Base: `develop` b02e672

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
| same, `src/` + `tests/` only | FAIL (expected: evidence missing) | 713 run · 705 pass · 5 fail · 3 skipped | reference package |

## Unresolved defects
- Gate G2 PARTIAL in the reference package: 12 of 22 scenarios declare a status their own events do not give (BL-45,
  BL-46). Fixed in PROC-002 (plan §6).

## Dependencies and requests
- V13-ARCH-001 on `develop` (skeleton, Vitest, tsconfig).
- Plan §7 items 1–7 (server-only package, resolveJsonModule, ports in `lib/contracts`, i18n format, e-mail tokens,
  scenario case-number range, branch name).
