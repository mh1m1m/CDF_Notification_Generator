# QA status — CDF V13 Enterprise (synthetic data only)

Updated: 2026-10-28 · Branch: test/V13-QA-004-followups (base develop f384507)

## Completed
- V13-QA-001 (design) — `docs/qa/TEST_ARCHITECTURE.md` — merged via PR #1 — COMPLETE
- V13-QA-003 / V13-QA-004 (browser half) — Case Context Sentinel (S1–S7, P1) and Procedural Truth Inspector (T1–T6)
  with planted-fault self-tests — merged via PR #7 — COMPLETE (browser half); DB half IN_PROGRESS
- Review follow-ups of #7 (this branch) — IN_REVIEW:
  1. Inspector walks same-origin frames (notification previews), paths prefixed `frame(url)`
  3. P1 matches case ids and references case-insensitively
  4. Arabic-Indic and Extended Arabic-Indic digits are normalised before matching, in the DOM and in payloads
  5. `tests/fixtures/personas.ts` imports `SESSION_COOKIE_NAME` from `lib/auth/session`
  - Found and fixed: Chromium returns a charset-less text body (Next.js RSC `text/x-component`) decoded as
    Windows-1252, so Arabic text in RSC payloads arrived as mojibake and digit normalisation could not see it.
    `recoverUtf8` restores the UTF-8 text before scanning (self-test (j) and a byte-level unit test).

## Changed files (this branch)
- tests/sentinel/sentinel.ts, tests/sentinel/planted-leak.spec.ts
- tests/truth/inspector.ts, tests/truth/planted-badge.spec.ts
- tests/fixtures/synthetic-case-page.ts, tests/fixtures/personas.ts
- docs/teams/qa/STATUS.md

## Test evidence
| Command | Result | Counts | Commit |
| ------- | ------ | ------ | ------ |
| `pnpm typecheck` | pass | — | this branch |
| `pnpm lint` | pass | 0 warnings | this branch |
| `pnpm format:check` | pass | — | this branch |
| `PW_CHROMIUM_PATH=/opt/pw-browsers/chromium pnpm test:e2e` | pass | 39 passed, 0 failed | this branch |

New self-tests: Sentinel (h) upper-case id → P1, (i) Arabic-Indic ref → S4, (j) Extended Arabic-Indic ref in a
payload with Arabic text → P1, (k) other case inside a same-origin frame → S5, recoverUtf8 unit test; Inspector badge
inside a same-origin frame → T3.

## Unresolved defects
- none

## Dependencies and requests
- Follow-up 2: replace the local `COMPLETED_CLASS` with `lib/domain` `COMPLETED_CLASS_STATUSES` when PROC-001 merges.
- DB half of the Sentinel and the DB event oracle: after DB-002/003 (local/CI database only).
- Scenarios A–E on real screens: after FE-002..006.
- V13-QA-006 staging: OI-008 (Vercel Authentication bypass is an owner decision, raised by ARCH).
