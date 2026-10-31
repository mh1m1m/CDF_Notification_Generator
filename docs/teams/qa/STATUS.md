# QA status — CDF V13 Enterprise (synthetic data only)

Updated: 2026-10-31 · Branch: test/V13-QA-005-oi028-title (base develop 434f905)

## Completed
- V13-QA-001 (design) — `docs/qa/TEST_ARCHITECTURE.md` — PR #1 — COMPLETE
- V13-QA-003 / V13-QA-004 (browser half) — Case Context Sentinel (S1–S8, P1) and Procedural Truth Inspector
  (T1–T8) with planted-fault self-tests — PRs #7, #13, #22 — COMPLETE (browser half); DB half IN_PROGRESS
  - #13: frames (same-origin, sandboxed srcdoc fallback, unreadable frame = S8/T7), case-insensitive P1,
    Arabic-Indic digit normalisation, RSC UTF-8 recovery (`recoverUtf8`), `SESSION_COOKIE_NAME` import
  - #22: T8 allow-list per the ARCH ruling on FE-004; vocabularies from `lib/domain`
- V13-QA-002 Scenario C (workspace switch, 11 tests with negatives) — PR #33 — merged

## In review
- `test/V13-QA-003-payload-reads`: Sentinel rule **P2**. Found while re-reviewing #19 on a seeded database:
  Chromium sometimes never hands over the body of a Next.js prefetch (RSC) response, or evicts it. The payload
  recorder then hung or dropped that body without saying so. Now each body read has a timeout; a GET the browser
  does not hand over is fetched again with the same RSC headers (`(fetched again)` in the finding), and a payload
  that still cannot be read is a P2 violation. Self-tests (n) unreadable and not refetchable → P2; (o) a leak only
  visible on refetch → P1. Mutation check: dropping P2 fails (n).
- This branch: **OI-028** root cause and fix (below), and this STATUS update.

## OI-028 — root cause (flaky `document-title` in "My work after persona sign-in")
- The persona sign-in lands on `/my-work` by a client-side navigation (the navigation timing entry stays
  `/sign-in`). Next.js removes the old `<title>` and streams the new page's metadata slightly later.
- Local probe (MutationObserver, 40 runs, not committed): in 38/40 runs the URL is already `/my-work` while the
  document has **no `<title>` element** for 4–129 ms. `toHaveURL(/my-work)` can resolve inside that gap.
- Proof: axe-core started inside the gap reports `document-title` in **18/18** runs where the gap was observed
  (2 runs did not show the gap). The CI failure (run 40631508845, `0f22e04`) is this race on a slower runner.
  Locally the original test did not fail in 100 runs, nor 40 runs with 6× CPU throttling: the gap is short.
- Fix (`tests/a11y/smoke.a11y.spec.ts`): every scan first waits for a non-empty title. Not weakened: a page whose
  title is removed still fails (mutation check: the test fails with "the document has a non-empty <title> before
  the scan").
- Product note for ARCH/FE (not a defect claim): the final page always has its title; the gap exists only during
  the soft navigation.

## Changed files (this branch)
- tests/a11y/smoke.a11y.spec.ts
- docs/teams/qa/STATUS.md

## Reviews
- #10 [V13-FE-002] REVIEW: ACCEPT 2bbacf2, re-confirmed ACCEPT 35e1e65 (session expiry kept on switch)
- #14 [V13-UX-002] REVIEW: CHANGES 1b0f29c (switcher Label in Name, test-id collision with FE-002)
- #19 [V13-FE-003] REVIEW: ACCEPT 983ad04 — seeded local database, build + start: rows and totals match DATA_MODEL
  §5 for Alpha 7, Beta 7 (0009 flagged), Gamma 6 (no 0009), Delta 7; Sentinel DOM + payloads clean; Truth clean;
  axe 0 in light and dark; no horizontal scroll at 375 px; hostile filters give the generic state with a
  correlation id

## Test evidence
| Command | Result | Counts | Commit |
| ------- | ------ | ------ | ------ |
| `pnpm typecheck`, `pnpm lint`, `pnpm format:check` | pass | 0 warnings | this branch |
| `PW_CHROMIUM_PATH=/opt/pw-browsers/chromium pnpm test:e2e` (no database, as CI) | pass | 94 passed, 0 failed | `test/V13-QA-003-payload-reads` 067ccab |
| `pnpm exec playwright test tests/a11y` | pass | 3 passed | this branch |

## Waiting
- Epsilon pinning e2e (ARCH, DEPENDENCIES decision 10): minted Epsilon session, portfolio shows zero cases and
  count 0 from the database. CI's e2e job has no database, so this needs a database-backed e2e job (ARCH decision).
- Timeline and date entries become inspectable once PROC's status-kind vocabulary and DB-008's per-event status
  are on develop (ARCH ruling on FE-004).
- DB half of the Sentinel and the DB event oracle (local/CI database only).
- UI reviews #23 FE-004 and #32 FE-005; re-review #14 after UX fixes.
- Scenarios A, B, D, E on real screens (FE-003..006); QA-005; QA-006 (OI-008).

## Unresolved defects
- none open from QA
