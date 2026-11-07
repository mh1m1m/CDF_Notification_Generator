# QA status — CDF V13 Enterprise (synthetic data only)

Updated: 2026-11-01 · Branch: docs/V13-QA-013-visual-a11y-crossbrowser-design (base develop b50dea9)

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
- V13-QA-007 (OI-048, REQ-QA-013) — PR #84 — merged (eee17f7): **D4** (a notification's recipient persona not on
  that case's team when it was created) and **P3/P4** (outbound request bodies: Server Actions, form posts, fetch).
- V13-QA-008 (REQ-CASE-014, §7.1) — PR #88 — merged (f683eb8): leak-suite guard G1–G4 (no pin, focus or
  unlisted skip on a leak-detection suite), planted negatives for every form. ARCH CHANGES on cd15ddf addressed:
  TypeScript-parser tokenising (a regex quote hid case-pages.spec.ts after line 30), a pin planted in all 135
  test/describe bodies of the 13 suites, Vitest `suite` and `test.step.skip`, `failOnFlakyTests` in CI, and the
  session-secret pin for the allow-listed skips. OI-051 (Sentinel self-test (o) timed out once in FE's run) fixed on
  the same branch: reproduced 5/300 under 8 workers; the trace shows every assertion passed, then `server.close()`
  waited on a socket Chromium had opened with no request. Fix: `closeAllConnections()` first (as the OI-047 test
  already did), and the refetch timeout is never 0 (Playwright reads 0 as none). After: 0/600. SEC CHANGES on bf063a9:
  G5 (alias, renamed/namespace import, element access, `?.`, `!`, parentheses, redeclaration, pin methods on other
  objects, Vitest/Playwright retry options) with 19 planted negatives; SEC's notification-center and surface suites
  added (15 suites, 156 bodies planted). ARCH CHANGES on 488d93d: G6 (Vitest skip/only/todo/fails options,
  Playwright skip/fixme/fail annotations, any key form) and computed retry keys, one planted negative per form.
- V13-QA-010 (register §4, WCAG 1.4.4 / 1.4.10 / 1.4.12) — PR #104 — merged (3d1376e) — COMPLETE:
  `tests/a11y/reflow.a11y.spec.ts`, 19 tests. Eight pages × ar/en × four conditions (640×450 = 200 % zoom,
  320×256 = 400 %, text spacing at 1280 and at 320): no page scroll and no element past either inline edge, nav and
  case tabs in view, no clipped text, every inline scroller (`[data-scroll-region]`, `.v13-scroll-region`) a
  focusable named region; skip link first in tab order; switcher menu in view at 320 px and closes on Escape. Seven
  planted faults must be caught.
- V13-QA-009 (REQ-NOTIF-011, REQ-QA-012 disclosure half) — PR #114 — merged (ac2499b) — COMPLETE: Scenario E WITNESS
  preview in an ar and an en template; withheld fields absent from the frame, its names, its title and every payload;
  the generalized classification only; allowed fields as the control; oracle from the policy file, cross-checked field
  by field with `decide()` from `lib/disclosure` through `tests/fixtures/server-module.ts` (child Node process).
- V13-QA-012 — PR #125 — merged (3df2416) — COMPLETE:
  (b) the plain-text version (FE-011) withholds the same fields: no withheld-field marker or field name, not the
  notice's own marking; the class-safe wording, event title, issuer, notice reference and confidentiality notice in it
  (control). (c) SEC INFO 1 on #114 was a real gap: the router aborts its RSC fetch once it has consumed the payload,
  Chromium keeps no body for it, and `response.text()` gave "" for the click's payload. Bodies are now read in the test
  through `page.route` + `route.fetch()`; an unreadable body fails, and the click's payload and the reload's document
  must each carry the frame. (d) SEC INFO 2: the precondition is the claims key (ADR-014), not data; reproduced
  (`CLAIMS_KEY_MISMATCH` after a restart with a new secret; the spec passes twice on one database, and across a
  restart with the same secret); stated in the spec header and TEST_ARCHITECTURE §6.

- V13-QA-013 — this branch — IN_REVIEW (SEC, then ARCH): design note `docs/qa/M1_OPEN_QA_ROWS_DESIGN.md` for the
  M1 rows still NOT_STARTED in QA's name (REQ-VIS-001, -004, -005, -010, -011, -012, -015, -018; REQ-A11Y-003, -014;
  REQ-QA-003; REQ-CICD-002): what QA builds, what needs ARCH in CI, what stays open; ARCH rulings D1–D4 folded in.

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
| #74 FE-006 part 3 (re-review) | ACCEPT e8829ce | accessible names and the OI-037 notice fixed |
| #85 UX-008b | ACCEPT 6caa174 | 48 page loads clean; note: table text 12 px (body2) |
| #81 FE-008 | ACCEPT 5dbe293 | no role shown for Epsilon/Zeta anywhere; controls correct |
| #90 UX-010 | ACCEPT bf4f53e | 12 px table text fixed: cells 16 px, secondary 14 px |
| #82 FE-009 | ACCEPT 830c26d (merged 961197e) | notes: mixed-language frame title (UXB-13); scenario-e literal → i18n key in QA-009 |
| #96 | ACCEPT cb2c5ee (merged 68a42b9) | |
| #97 | CHANGES c24b31a → CHANGES d7b7ad6 → ACCEPT 745acdd (merged 2bccba2) | |
| #98 FE-010 | ACCEPT 7a5b987, d05fcf4 | 3 personas × visible cases × ar/en × 320/1280 clean; mutation of the version pin fails 2/44 |
| #107 UX-012 | ACCEPT a2cf6dc (merged aecd7ef) | reflow at 320 px: base overflows with Liberation Sans (321) and DejaVu Sans (333/367); #107 clean in all three fonts |
| #112 FE-012 | ACCEPT 7971547, c2021cf (merged abdd885) | QA's P3 hunk: the tampered 0004→0001 post is refused, P3 still flags it |
| #100 UX-011 | ACCEPT f748c53 (merged ca16cba) | frame named in the page language |
| #116 FE-011 | ACCEPT 0934b80, 9bc6d52, 0bbc7c2 | twin text has no withheld-field markers; re-confirms after develop merges |
| #121 FE-013 | ACCEPT 19cf34c, 7c23c2e (merged 4f94b07) | 61-row paging walk ar/en at 320 px; non-canonical cursors give the empty state |
| #122 UX-013 | ACCEPT f9536a4 | UXB-17/18 confirmed in the browser |
| #128 UX-014 | ACCEPT cf8a348 | 4 pages × ar/en × 320/768/1280: fields 40 px with a ≥ 3:1 border, table links underlined, axe incl. WCAG 2.2 AA clean |

## Changed files (this branch)
- docs/qa/M1_OPEN_QA_ROWS_DESIGN.md (new)
- docs/qa/TEST_ARCHITECTURE.md §10 (pointer); docs/teams/qa/STATUS.md

## Test evidence
| Command | Result | Counts | Commit |
| ------- | ------ | ------ | ------ |
| `pnpm typecheck`, `pnpm lint`, `pnpm format:check` | pass | 0 warnings | this branch |
| #58 head: `pnpm db:reset && PW_CHROMIUM_PATH=/opt/pw-browsers/chromium pnpm test:e2e` | pass | A, B, D 50/50 at repeat-each=5 | #58 |
| develop b5d810c + #51 74176da: unit / e2e | pass | 1775 / 141 | review |
| develop b5d810c + #63 ab52116: unit / e2e | pass | 1725 / 138 | review |
| develop b5d810c + #61 920e98a: unit / e2e | pass | 1802 / 144 | review |
| #98 7a5b987: unit / test:db / e2e (incl. reflow) | pass | 2026 / 468 / 252 | review |
| QA-012 on develop 0bc2542 + #116 0bbc7c2 (tree = develop 61b57cf + QA-012): lint, typecheck, format:check; `pnpm db:reset && pnpm test:e2e` | pass | e2e 335/335 | QA-012 |
| QA-012 mutations (build + start, `db:reset` each): RSC bodies dropped → "frame document in the click's payload"; RSC body unreadable → unread check; case number appended to the plain-text version → "case_number … in the plain-text version"; own marking appended → own-marking check; Scenario E twice on one database | fail ×4 as expected; 11/11 twice | | QA-012 |
| QA-011 guard spec (`tests/sentinel/leak-suite-guard.spec.ts`), lint, typecheck, format:check | pass | 104/104 | QA-011 |
| QA-011 mutations: old guard against the new G6 plants; L1 without the unregistered-call check; without the status check; without the file check | fail 13 / 2 / 2 / 1 as expected | | QA-011 |

## Waiting / next
- V13-QA-024 — branch test/V13-QA-024-mask-rule-hardening — IN_REVIEW (ARCH): #162's two INFOs. The correlation id's
  capture rule gets `white-space: nowrap; overflow: hidden; vertical-align: top` like every other width rule, and a
  static check pins that every width rule has nowrap and overflow hidden; the probe's long id is now the widest hex
  glyph (`d`) instead of the narrowest (`f`); the planted page gains a correlation id (its rule taken out → the probe
  fails) and a planted test takes out only the deadline's `block-size: 1lh` (exactly the two overdue variants move).
  Local captures of the 9 baseline cells (36 images) are byte-identical between develop a82e12a and this branch, so no
  baseline changes. Mutations: correlation rule without nowrap/overflow → the static check fails; `block-size: 1lh`
  dropped → the control and the planted test fail; correlation rule dropped → 5 tests fail.
- V13-QA-019 — #167, merged into develop as a82e12a — COMPLETE (ARCH and SEC ACCEPT e2443d1; SEC reviewed the
  `tests/security/e2e/surface.spec.ts` and `build-readiness.spec.ts` hunks): the run-time half of the leak-suite guard
  (TEST_ARCHITECTURE §7.1).
  `tests/critic/leak-skip-reporter.ts`, registered in playwright.config.ts for every run, fails the run when a test
  in a leak suite ends "skipped" without a holding allowance or has no result; a run where no test began (`--list`)
  is not judged. Allowed skips call one function from `tests/fixtures/skip-conditions.ts`
  (`sessionSecretMissing`, `externalDeployment`, `localBuildMissing`), and the reporter calls the same function at
  the end of the run. The non-Playwright leak suites are pinned to exactly `tests/security/db/case-matrix.spec.ts`
  (its test:db half is ARCH's). Planted runs (temp config, no webServer, no DB): a helper's run-time skip fails;
  an allowance whose condition does not hold fails; `--max-failures=1` reports "no result"; `--list` exits 0.
  Mutations M1–M6 (reporter dropped from the local list; "skipped" ignored; "no result" ignored; allowance widened;
  `--list` not exempt; status not overridden) each fail the guard.
  Review round 1 (#167, ARCH 6708849007 R1 + SEC 6708813324 / ARCH R2, CHANGES aca2f78): a helper's `test.fail()`,
  `expectedStatus = "failed"` or hook pin is now a "pinned to fail" finding, and an `afterEach` status overwrite a
  "passed with errors" finding, neither ever allowed; an allowance covers only a skip whose annotation was made in the
  suite's own file (ARCH I1); a truth table pins each skip condition, and a signalled run asserts no environment
  condition holds. Mutations N1–N6 (pin ignored; passed-with-errors ignored; skip location ignored; each condition
  made always true) each fail the guard.
- V13-QA-023 — #162, merged into develop as f0f8437 — COMPLETE: the mask width
  probe (TEST_ARCHITECTURE §10). Found while building: the capture style never reached the sandboxed preview frame
  (now put into every frame for the capture; the 4 notification-preview baselines change and are replaced from the PR's
  own CI artifact), and the overdue glyph's fallback font can make the deadline's line taller (`block-size: 1lh`).
  CI run 42378737736 (9dd7d84): the 4 preview snapshots missing, nothing else failed, every probe variant identical.
  Its retry made the candidates on the first attempt's leftover draft (about 100 px taller), so the 4 PNGs are the
  first attempt's images from artifact 13576528654, and a candidate is now written on the first attempt only.
  CI run 42379165277 (46bdb25): every job green, visual 10/10 in comparison mode, every probe variant identical.
  Count tiles get a width rule on their value; all other 32 baselines stay byte-identical locally. Local: library
  244/244 images, 0 moved, every mask matched (deadline 136, counts 80, correlation id 24, draft time 12, notice
  reference 12); library-index 24/24.
- V13-QA-022 — #158, merged into develop as 119bea6 — COMPLETE: case-access audit in the
  browser (DB-023 D1, REQ-AUD-001), project `access-audit` after `desktop-ar`. Beta views the portfolio and My Work
  with every case link in view and hovered → 0 access rows and no counted open (control: case routes really
  prefetched); document load, reload and client navigation to restricted 0009 → exactly one RESTRICTED_CASE_OPENED
  each; document load, tab change and reload of 0001 → exactly one open each (rows + carried + window change).
  Mutations: case-tab metadata loading the case again → test 1 fails (4 rows); the page opening the case twice →
  test 2 fails (2 rows). Ledger read as the local administrator, read-only (`ledger()` in `tests/fixtures/db.ts`).
  Chromium only: listed in `CHROMIUM_ONLY` (tests/fixtures/browsers.ts) with its reason, so the cross-browser
  projects never run it.
  Guard B1 lists the local configuration and expects the exact project set (desktop-ar, access-audit, the engines
  when selected); access-audit depends on every other project the run lists. CI 42379976804 at 80324d8 green.
- V13-QA-015 adoption — #159, merged into develop as 15f938d — COMPLETE: the 36 baselines committed under
  `tests/visual/__screenshots__/`, taken from CI only (ARCH's decision, 7 Nov): artifact 13574858048
  (`visual-results`) of #159's own pull_request CI run 42374093449, job 128408023113, at 0b40b1a (the capture-style
  fix). In that run every one of the 9 tests failed on missing snapshots alone, and each candidate is byte-identical to
  Playwright's actual image. The PR lists every file's sha256. Design §8 now describes the visual job as built
  (ARCH-014). The first images (artifact 13081138200, develop run 41301822994, 1 Nov) were withdrawn: their first
  comparison (#159 run 42372979341, 7 Nov) passed 6/9, my-work, case-overview and workspace-switcher failed.
  Cause: the masked deadline words count days on the server clock, so their width changed between 1 Nov (candidates)
  and 7 Nov and moved My Work's columns and the overview's mask edge. Fix: CAPTURE_STYLE gives `[data-deadline-state]`
  a fixed width during the capture only (masked boxes only). Local probe: deadline words rewritten between two captures
  of the three screens, ar and en: byte-identical with the fix, different on all three without it. Second local probe
  (asked by ARCH): every task's due_date moved back 1, 7 and 14 days on a fresh local database, the three screens recaptured in
  ar and en, desktop and mobile. With a ch width my-work ar desktop still moved (an overdue deadline is bold, and ch
  follows the weight), so the width is now 14rem; then my-work and workspace-switcher were byte-identical at every
  shift. case-overview differed only in its open-tasks row, whose plain due date (unmasked) the probe itself rewrote; a
  real clock never changes that date. Restored with `pnpm db:reset`. Both probes are local, not CI evidence.
- V13-QA-011 — branch test/V13-QA-011-guard-followups — IN_REVIEW (ARCH): G6 plain-literal annotation `type`;
  L1 `playwright test --list` per guarded Playwright suite vs its own test calls (helpers in other files caught at load time; run-time skips from helpers stay a stated limit, review covers them);
  surface allow-list reason updated after V13-SEC-012. TEST_ARCHITECTURE §7.1.
- After #61 merges: a Center Back step in Scenario D.
- Harness: axe excludes sandboxed srcdoc frames and scans the srcdoc separately (axe hangs on them today);
  preview-frame rule set per the ARCH ruling once PROC-011 exports the renderer's values; P2 for Server Action POST
  bodies Chromium drops after a redirect.
- Import a model-field list from `lib/notifications` into Scenario E once PROC exports one (ARCH INFO 1 on #114).
- QA-004: Truth Inspector on the case pages with a DB event oracle (local/CI database only); DB half of the Sentinel.
- QA-005 (rest): five-screen audit, screenshot library; QA-006 staging Gate J (OI-008).
- Local note: the local PostgreSQL cluster can stop between runs; `pnpm db:local start` before `pnpm db:reset`.
- V13-QA-014 — #140, merged into develop as 6401c45 — COMPLETE: screenshot library without baselines (design
  §2–§4); ARCH hunk `.env.example` (`V13_E2E_VISUAL`); the CI visual job (§8) is ARCH's.
- V13-QA-015 — #145, merged into develop as f7adcda — COMPLETE: visual baselines (36,
  committed only from the CI visual job's candidates) and guard G7 (`updateSnapshots` pinned, no update flag in
  workflows or scripts). Evidence: guard spec 129/129, library-index 13/13, unit 2401/2401, e2e 401/401, lint and
  typecheck clean; local baseline probes (missing → 9 fail + 36 candidates; candidates in place → 9/9 on three fresh
  databases; swapped image → fail with diff); library 244/244, identical to V13-QA-014's 3a75a42 in two runs. No ARCH hunk; the CI visual job (`V13_E2E_VISUAL=baseline`, upload
  `test-results/baseline-candidates/` and the Playwright output) is ARCH's.
- V13-QA-020 — #150, merged into develop as 8536e7e — COMPLETE: Next Action Card browser test (6 tests, ar/en at
  320 px: the card first in the overview before the stage card, its :target link, NONE renders nothing, page 2 keeps
  the first page's task); four mutations caught; e2e 372/372, unit 2412/2412; card-first check 6/6 at 270af33.
- V13-QA-021 — #148, merged into develop as d399987 — COMPLETE: Server
  Action forms with JavaScript off (sign-in, workspace switch), same-origin `Origin` pinned; fails on `no-referrer`
  (2 tests, `Origin: "null"`), passes on the fix; the no-JS sign-in observation from the FE-016 review is closed by it.
- V13-QA-016 — branch test/V13-QA-016-firefox-webkit — IN_REVIEW (ARCH, SEC for the CI hunk): `firefox-ar` and
  `webkit-ar` projects only when `V13_E2E_BROWSERS` names them; `.github/workflows/cross-browser.yml` (ARCH hunk) on
  develop pushes and the `cross-browser` label; guard B1 keeps every Sentinel spec and leak suite on Chromium. The
  engines cannot run in the Claude sandbox: their evidence is the workflow's runs, recorded here.
  - Run 41287885521 (39a6b03): Firefox 71/71; WebKit 25 passed, 44 failed, 2 not run: no session cookie (WebKit drops
    the Secure `__Host-` cookie on plain-http localhost). Fixed by the TLS front (e65710e, d75a8a3).
  - Run 41289100450 (d75a8a3): workflow load error (runner context in a job's env); fixed in eb7f76c.
  - Run 41290376443 (348fa7a): Firefox 71/71; WebKit 66/71. The 5 failures are reflow check 1 on the case
    Notifications tab (`/cases/<0001>/notifications`): the page scrolls inline (567–803 px at 320, 641 at 640) in ar
    and en, while no measured element lies past an edge. A WebKit-only finding, not skipped; check 1 now names what
    widens the page so the next run can route it to its owner.

## Unresolved defects
- none open from QA
