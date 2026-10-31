# QA status — CDF V13 Enterprise (synthetic data only)

Updated: 2026-10-31 · Branch: test/V13-QA-002-pin-positive-control (base develop d694ff8)

## Completed
- V13-QA-001 (design) — `docs/qa/TEST_ARCHITECTURE.md` — PR #1 — COMPLETE
- V13-QA-003 / V13-QA-004 (browser half) — Case Context Sentinel (S1–S8, P1, P2) and Procedural Truth Inspector
  (T1–T8) with planted-fault self-tests — PRs #7, #13, #22, #37 — COMPLETE (browser half); DB half IN_PROGRESS
  - #13: frames (same-origin, sandboxed srcdoc fallback, unreadable frame = S8/T7), case-insensitive P1,
    Arabic-Indic digit normalisation, RSC UTF-8 recovery (`recoverUtf8`), `SESSION_COOKIE_NAME` import
  - #22: T8 allow-list per the ARCH ruling on FE-004; vocabularies from `lib/domain`
  - #37: **P2** — a payload body the browser does not hand over (pending or evicted Next.js prefetch) is fetched
    again with the same RSC headers; one that still cannot be read is a violation, never dropped
- V13-QA-005 (part) — **OI-028** root cause and fix — PR #38 — merged. The persona sign-in lands on `/my-work` by a
  client-side navigation; for 4–129 ms the URL is the new one and the document has no `<title>` while Next.js
  streams the metadata (38/40 probe runs). axe started inside that gap reports `document-title` in 18/18 runs. Every
  scan now waits for a non-empty title; a page without a title still fails (mutation check).
- V13-QA-002 Scenario C (workspace switch, 11 tests with negatives) — PR #33 — merged. Scenarios A, B, D, E:
  NOT_STARTED (next).
- V13-QA-002 negative-persona pin — PR #43 — merged. Minted Epsilon (expired membership) and Zeta (inactive):
  empty portfolio with count 0, no My Work task, 404 for every seeded case on every Case Workspace tab; Sentinel with
  an empty visible set over pages and payloads.

## This branch (IN_REVIEW)
- Positive control for #43 (ARCH review of #43): Secretary Alpha on the same paths sees her 7 cases (rows and
  count 7), her 7 open tasks (strip 7), case 0001 on all 4 tabs, and 404 for hidden 0002. Now that FE-004 and FE-005
  are on develop, the pin also requires `not-found-state` on the 404s and the My Work strip at 0 (no longer optional).
  Mutation check: running the control with a minted Epsilon session fails all 3 control tests.

## Reviews (all on a seeded local database, build + start, Sentinel + payloads + Truth + axe)
| PR | Verdict | Notes |
| -- | ------- | ----- |
| #10 FE-002 | ACCEPT 2bbacf2, 35e1e65 | session expiry kept on switch |
| #14 UX-002 | CHANGES 1b0f29c → ACCEPT dd00ccc | Label in Name; test-id collision; identity guard |
| #16 UX-003 | CHANGES cfab726 → ACCEPT e14d509 | badges did not wrap (WCAG 1.4.10) at 375 px |
| #19 FE-003 | ACCEPT 983ad04 | visibility per persona = DATA_MODEL §5; found the P2 harness gap |
| #23 FE-004 | CHANGES fdf2327 → ACCEPT d439d59 | table scroll wrappers not focusable at 375 px; 116 negative URLs 404 |
| #32 FE-005 | ACCEPT 018b46e, 29106d7 | command, stale, 4 forged task ids, closed case |
| #36 ARCH-008 | ACCEPT ca4fc1a | database-backed e2e; URL guard checked with 9 URLs |

## Changed files (this branch)
- tests/e2e/negative-personas-pinning.spec.ts
- docs/teams/qa/STATUS.md

## Test evidence
| Command | Result | Counts | Commit |
| ------- | ------ | ------ | ------ |
| `pnpm typecheck`, `pnpm lint`, `pnpm format:check` | pass | 0 warnings | this branch |
| `pnpm db:reset && PW_CHROMIUM_PATH=/opt/pw-browsers/chromium pnpm test:e2e` | pass | 104 passed, 0 failed | this branch |

## Waiting / next
- Scenarios A, B, D on the merged pages (E after FE-006).
- QA-004: Truth Inspector on the case pages with a DB event oracle (local/CI database only); DB half of the Sentinel.
- QA-005 (rest): five-screen audit, screenshot library; QA-006 staging Gate J (OI-008).
- Local note: the local PostgreSQL cluster can stop between runs; `pnpm db:local start` before `pnpm db:reset`.

## Unresolved defects
- none open from QA
