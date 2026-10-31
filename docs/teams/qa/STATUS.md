# QA status — CDF V13 Enterprise (synthetic data only)

Updated: 2026-10-31 · Branch: test/V13-QA-004-unmarked-status (base develop 2ec6ce0)

## Completed
- V13-QA-001 (design) — `docs/qa/TEST_ARCHITECTURE.md` — PR #1 — COMPLETE
- V13-QA-003 / V13-QA-004 (browser half) — Case Context Sentinel (S1–S8, P1) and Procedural Truth Inspector
  (T1–T7) with planted-fault self-tests — PRs #7 and #13 — COMPLETE (browser half); DB half IN_PROGRESS
  - #13: frames (same-origin, sandboxed srcdoc fallback, unreadable frame = S8/T7), case-insensitive P1,
    Arabic-Indic digit normalisation, RSC UTF-8 recovery (`recoverUtf8`), `SESSION_COOKIE_NAME` import
- This branch (IN_REVIEW): Inspector rule T8 per the ARCH ruling on FE-004, as an allow-list (ARCH review of #22,
  CHANGES 4f3fc97). The only element with `data-status` / `data-status-kind` and no `data-epistemic` that passes is
  a task with status OPEN and no `data-event-id`; every other unmarked status element fails T8. The Inspector now
  collects `[data-status]` / `[data-status-kind]` elements, not only `[data-epistemic]`. No component on develop
  2ec6ce0 renders status attributes yet, so no page fails T8 today. Mutation checks: completed-class-only logic fails
  the 5 new T8 tests; ignoring `data-event-id` fails the OPEN-with-event test; allow-all fails all 6 T8 tests.

- Follow-up 2 (this branch): the Inspector takes `BADGE_EPISTEMIC_VALUES` and `isCompletedClassStatus` from
  `lib/domain` (PROC-001, #18); the local copies are gone. New self-test (e′): DELIVERY_CONFIRMED shown as expected → T5.

## Changed files (this branch)
- tests/truth/inspector.ts
- tests/truth/planted-badge.spec.ts
- docs/teams/qa/STATUS.md

## Reviews
- #10 [V13-FE-002] REVIEW: ACCEPT 2bbacf2, re-confirmed ACCEPT 35e1e65 (session expiry kept on switch)
- #14 [V13-UX-002] REVIEW: CHANGES 1b0f29c (switcher Label in Name, test-id collision with FE-002)

## Test evidence
| Command | Result | Counts | Commit |
| ------- | ------ | ------ | ------ |
| `pnpm typecheck`, `pnpm lint`, `pnpm format:check` | pass | 0 warnings | this branch |
| `PW_CHROMIUM_PATH=/opt/pw-browsers/chromium pnpm test:e2e` | pass | 81 passed, 0 failed | this branch |

## Waiting
- Scenario C e2e (11 tests) on `test/V13-QA-002-scenario-c` (5bdfc4b, stacked on #10 35e1e65): PR opens after #10
  merges; it also exports the run's session secret to workers in `playwright.config.ts`.
- Epsilon pinning e2e (ARCH, DEPENDENCIES decision 10): minted Epsilon session, portfolio shows zero cases and
  count 0 from the database — after FE-003 (#19) and DB-002 (#15).
- Timeline and date entries become inspectable once PROC #18's status-kind vocabulary and DB-008's per-event status
  are on develop (ARCH ruling on FE-004).
- DB half of the Sentinel and the DB event oracle (after DB-002/003; local/CI database only).
- Scenarios A, B, D, E on real screens (FE-003..006); QA-005; QA-006 (OI-008).

## Unresolved defects
- none
