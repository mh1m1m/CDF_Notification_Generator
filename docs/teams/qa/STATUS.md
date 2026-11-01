# QA status — CDF V13 Enterprise (synthetic data only)

Updated: 2026-11-01 · Branch: test/V13-QA-007-recipient-and-request-rules (base develop fddbff8)

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
- V13-QA-002 Scenario C (workspace switch, 11 tests with negatives) — PR #33 — merged.
- V13-QA-002 negative-persona pin — PR #43 — merged. Minted Epsilon (expired membership) and Zeta (inactive):
  empty portfolio with count 0, no My Work task, 404 for every seeded case on every Case Workspace tab; Sentinel with
  an empty visible set over pages and payloads. Positive control (Secretary Alpha, same paths) — PR #53 — merged.
- V13-QA-002 Scenarios A, B, D — PR #58 — merged (develop b5d810c). `tests/fixtures/db.ts`: read-only oracle in each
  persona's own security context (signed claims, `SET LOCAL ROLE cdf_v13_user`, every transaction rolled back).
  A: case switching, back/forward/reload, storage free of case ids. B: two cases in two tabs, one task row and one
  event changed, stale update, hidden task answers like an unknown one. D: filters in the URL. Pinned two defects
  with `test.fail()`: OI-042 (nested `<main>` on the case 404) and OI-043 (filter form keeps stale values after
  Clear/Back). Both fixed by V13-FE-007 (#63, ACCEPT ab52116), which removes the pins.
- Scenario E (notification draft) is FE's spec in #51, reviewed by QA.
- V13-QA-003/004 DB half — PRs #68 (D1–D3, U1–U4), #73 (T9 preview-frame rule set), #78 (OI-046, OI-047, read
  functions, Epsilon/Zeta, CASE-014 triage, Scenario A history helper) — merged (24616f6).
- V13-QA-007 (OI-048, REQ-QA-013) — this branch — IN_PROGRESS (review): **D4** (a notification's recipient persona
  not on that case's team when it was created) and **P3/P4** (outbound request bodies: form posts, Server Action
  calls); planted-fault self-tests and a real-app check. The D4 join awaits DB's agreement through ARCH.

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
| #50 UX-005 (incl. SEC-APP-11) | CHANGES → ACCEPT 77d1268 | locator picked the hidden menu form; scoped to `workspaces-page` |
| #51 FE-006 part 1 | CHANGES 661b7e7 → ACCEPT 74176da | draft form reflowed at 375 px; focus now moves to the refusal; assertions by row id |
| #54 UX-006 | ACCEPT 8292db2 (merged 9d5fa72) | sandboxed srcdoc preview works under the page CSP; 343 px at 375 |
| #61 FE-006 Center | CHANGES dd9aa9c → ACCEPT 920e98a | Back restored stale filter values; fixed by form-level `autoComplete="off"` |
| #63 FE-007 | CHANGES e1434b4 → ACCEPT ab52116 | OI-042 + OI-043; former pins 35/35 at repeat-each=5; mutation check |
| #74 FE-006 part 3 | CHANGES 982bd76 | preview link's accessible name uses raw codes; OI-037 notice shows the bare code |
| #76 UX-008a | CHANGES bc42998 → ACCEPT c2a849f | switcher panel off screen at 768/900; two banner landmarks |

## Changed files (this branch)
- tests/fixtures/db-snapshot.ts, tests/sentinel/db-sentinel.ts, tests/sentinel/db.spec.ts (D4)
- tests/sentinel/sentinel.ts, tests/sentinel/planted-request-leak.spec.ts, tests/sentinel/request-leak-app.spec.ts
  (P3, P4)
- docs/qa/TEST_ARCHITECTURE.md §7, §7.1; docs/teams/qa/STATUS.md

## Test evidence
| Command | Result | Counts | Commit |
| ------- | ------ | ------ | ------ |
| `pnpm typecheck`, `pnpm lint`, `pnpm format:check` | pass | 0 warnings | this branch |
| #58 head: `pnpm db:reset && PW_CHROMIUM_PATH=/opt/pw-browsers/chromium pnpm test:e2e` | pass | A, B, D 50/50 at repeat-each=5 | #58 |
| develop b5d810c + #51 74176da: unit / e2e | pass | 1775 / 141 | review |
| develop b5d810c + #63 ab52116: unit / e2e | pass | 1725 / 138 | review |
| develop b5d810c + #61 920e98a: unit / e2e | pass | 1802 / 144 | review |

## Waiting / next
- After #61 merges: a Center Back step in Scenario D.
- Harness: axe excludes sandboxed srcdoc frames and scans the srcdoc separately (axe hangs on them today);
  preview-frame rule set per the ARCH ruling once PROC-011 exports the renderer's values; P2 for Server Action POST
  bodies Chromium drops after a redirect.
- QA-004: Truth Inspector on the case pages with a DB event oracle (local/CI database only); DB half of the Sentinel.
- QA-005 (rest): five-screen audit, screenshot library; QA-006 staging Gate J (OI-008).
- Local note: the local PostgreSQL cluster can stop between runs; `pnpm db:local start` before `pnpm db:reset`.

## Unresolved defects
- none open from QA
