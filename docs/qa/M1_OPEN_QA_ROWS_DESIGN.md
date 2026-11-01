# M1 QA rows still NOT_STARTED: design note (V13-QA-013)

Status: DESIGN (V13-QA-013). Review: SEC first, then ARCH. Synthetic data only. No code ships with this note.

This note plans the M1 register rows that QA still owns and that are `NOT_STARTED`:

- the screenshot library and visual baselines (V13-QA-005): REQ-VIS-001, -004, -005, -010, -011, -012, -015 and -018;
- REQ-A11Y-003 (manual checklist) and REQ-A11Y-014 (UXQA-07 audit);
- REQ-QA-003 (Firefox and WebKit);
- REQ-CICD-002 (PR quality report).

For each row it says what QA builds, what needs ARCH (shared files: `.github/workflows/ci.yml`, `package.json`,
artifacts and retention) and what stays open, with the reason. Facts about the app are as of `develop` `b50dea9`.

## 1. Summary

| Row | QA builds | Needs ARCH | Stays open, and why |
| --- | --- | --- | --- |
| REQ-VIS-001 screens | `tests/visual/library.spec.ts` for the screens that exist (§2.1) | CI job and artifact (§8) | Notification Generator, Search Interface: no such page in M1; listed "not applicable", never staged |
| REQ-VIS-004 matrix | viewports × languages × themes × the states each screen really has (§2.2) | none beyond §8 | loading state: no route renders one (no `loading.tsx`, no `Suspense`); "not applicable" until FE adds one |
| REQ-VIS-005 no invented states | the state table is the source; a state needs a real route, persona and seed row (§2.3) | none | none |
| REQ-VIS-010 determinism | fixed data, browser clock, reduced motion, masks for server-clock text, Linux-only baselines (§3) | fonts in the visual job; decision D1 (server clock) | server-clock text is masked, not frozen, unless ARCH decides D1 |
| REQ-VIS-011 masking | masks plus a pre-capture data check that refuses non-synthetic text (§4) | none | none |
| REQ-VIS-012 never auto-approve | committed baselines, a guard against updating them in CI, review rule (§5) | the guard's workflow rule; decision D2 (what is committed) | none |
| REQ-VIS-015 UXQA-05 library | the library run, its manifest and `docs/qa/SCREENSHOT_LIBRARY.md` (§2.4) | artifact retention (§8) | none |
| REQ-VIS-018 UXQA-14 before/after | base vs head capture for a UX PR, paired index (§5.3) | an on-demand job input (§8) | none |
| REQ-A11Y-003 manual checklist | `docs/qa/A11Y_MANUAL_CHECKLIST.md` (§6) | none | carrying it out needs a person with a screen reader; this sandbox has none |
| REQ-A11Y-014 UXQA-07 audit | `docs/qa/ACCESSIBILITY_AUDIT.md` from the automated suites plus the checklist (§7) | none | the manual half, as REQ-A11Y-003; never a "compliant" claim |
| REQ-QA-003 Firefox, WebKit | `firefox-ar` and `webkit-ar` projects with an engine-neutral subset (§9) | a cross-browser job that installs the two browsers; decision D3 (when it runs) | Chromium-only suites stay Chromium-only (§9.2) |
| REQ-CICD-002 PR report | a report builder from the Playwright and Vitest results (§10) | job summary step; decision D4 (path for the builder) | "performance changes": nothing measures performance in M1 |

Delivery order (each its own QA PR, reviewed as the board says): §3 + §4 + §2 (library, no baselines) → §5
(baselines and guard) → §9 (cross-browser) → §10 (report) → §6 and §7 (checklist, audit). §5.3 rides the first UX PR
after §5.

## 2. Screenshot library (REQ-VIS-001, -004, -005, -015; UXQA-05)

### 2.1 Screens

| REQ-VIS-001 screen | M1 route | Persona |
| --- | --- | --- |
| My Work | `/my-work` | Investigator Beta, Secretary Alpha |
| Case Portfolio | `/portfolio` | Secretary Alpha |
| Case Details | `/cases/{id}` and its tabs `events`, `tasks`, `notifications` | Secretary Alpha |
| Notification Center | `/notifications` | Secretary Alpha |
| Notification Preview | `/cases/{id}/notifications?n={id}` (frame and plain-text version) | Secretary Alpha |
| Notification Generator | none in M1. The draft form on the case Notifications tab is captured with that tab | — |
| Search Interface | none in M1. The Portfolio and Center filters are captured with those screens | — |
| Workspace Switcher | the open menu on any page | Governance Officer Delta (two workspaces) |
| Mobile Navigation | the side navigation at 360 px | Secretary Alpha |

A screen with no route is listed as "not applicable in M1: no page". It is never stood in for by a fixture page.

### 2.2 Matrix

- Viewports: desktop 1280 × 800, tablet 768 × 1024, mobile 360 × 780. `deviceScaleFactor` 1 everywhere.
- Languages: `ar` (RTL) and `en` (LTR), set by the locale cookie.
- Themes: light and dark. The app supports dark through `prefers-color-scheme` (`styles/tokens.css`), so the run
  sets `colorScheme` per capture. Nothing else is themed.
- States, per screen, only where the app has them (§2.3): data, empty, error, restricted, loading.

### 2.3 States: only real ones (REQ-VIS-005)

Each state is a real route, a real persona and a seeded or test-created row. A table in the spec names them, and a
state with no way to reach it is a row "not applicable" with the reason. It is never styled into existence.

| State | How it is reached | Screens |
| --- | --- | --- |
| data | seeded cases and tasks | all |
| empty | Zeta (inactive membership) or Epsilon (expired), the QA-002 minted personas; a filter with no match | My Work, Portfolio, Center, case tabs |
| error | the generic preview state (`?n=` unknown id); a refused draft; the not-found page (`/cases/{unknown}`) | preview, draft form, not found |
| restricted | an unassigned persona on 0009 sees the not-found page: restricted and unknown look the same by design (CLAUDE.md §3) | captured once as "restricted = not found" |
| loading | no route renders a loading state today | not applicable |

### 2.4 Output

- Files: `test-results/library/<screen>/<state>.<lang>.<viewport>.<theme>.png`, plus `manifest.json` listing each
  file with screen, state, persona, route, commit and the masks applied.
- `docs/qa/SCREENSHOT_LIBRARY.md` is the index. It is regenerated from the manifest by the spec, never hand-edited. It
  lists every "not applicable" cell with its reason, so a missing screenshot is visible.
- The PNGs are not committed (§5.1). They are the CI artifact of the visual job (§8).
- Size: about 9 screens × 3 viewports × 2 languages × 2 themes × 1–3 states ≈ 200 images per run.

## 3. Determinism (REQ-VIS-010)

| Source of change | Control |
| --- | --- |
| Data | `pnpm db:reset` before the run, seeded rows only. A test that must create a row (a draft for the preview) masks its run-specific text (§3.1) |
| Browser time | `page.clock.setFixedTime` to one instant inside the seed's date range, before the first navigation |
| Server time | My Work's deadline words (`DeadlineText`: "overdue 3 days") and the created time of a run-made draft come from the server clock, which the browser clock cannot reach. They are masked (§3.1). Decision D1 asks whether FE adds a test-only clock instead |
| Motion | `reducedMotion: "reduce"`, `animations: "disabled"`, `caret: "hide"` in every capture |
| Fonts | the app uses system font stacks (`--cdf-font-ar`, `--cdf-font-latin`). Glyphs differ by machine (the QA-010 font probe: Liberation Sans 321 px against Carlito 294 px for the same link). Baselines are made and compared only in the CI visual job on one Ubuntu image with a fixed font set. They are never made in a Claude sandbox |
| Viewport | fixed per capture (§2.2); full-page screenshots wait for `document.fonts.ready` and for the main landmark |
| Random identifiers | seed ids are fixed. Run-made ids (notification UUIDs, `NTF-DEMO-XXXXXXXX`, correlation ids) are masked |

### 3.1 Masks

The spec passes Playwright `mask` locators with one fixed `maskColor`, and the manifest lists each mask:

- `[data-testid="correlation-id"]` and `case-preview-correlation-id`;
- the deadline text cells on My Work;
- the created time and the notice reference of a draft the run made;
- in the preview frame, the notice reference (`[data-field="notice_reference"]`).

A mask hides only what changes between runs. It is never used to hide a defect, and the manifest makes each one
reviewable.

## 4. Masking and data safety (REQ-VIS-011)

All data is synthetic (CLAUDE.md §1), so masks here serve determinism, not secrecy. One check still runs before
every capture, so that a screenshot can never carry anything else:

- Page text and every `srcdoc` must match only synthetic forms. Case numbers are `CDF-DEMO-2026-0001`…`0010`, and
  e-mail addresses are `@example.test` only. There is no `@cdf.gov.sa` or other real domain, and no persona name
  outside the synthetic list.
- No session cookie value, token or secret appears in the DOM. The check reuses the Sentinel's text scanning
  (`tests/sentinel/sentinel.ts`).
- A failed check fails the test and writes no image.

## 5. Baselines and review (REQ-VIS-012, REQ-VIS-018)

### 5.1 What is committed (decision D2)

The full library (§2.4) is about 200 images per run: too many to commit and review. QA proposes this split:

- **Baselines, committed** under `tests/visual/__screenshots__/`: a regression subset. It covers each screen in its
  data state, at desktop and mobile, in ar and en, light theme, plus the workspace switcher open: about 30 images. These
  run on every PR through `toHaveScreenshot` (`threshold: 0.2`, `maxDiffPixels: 0`).
- **Library, not committed**: the full matrix, as a CI artifact (§8), for UXQA-05 and design reviews.

### 5.2 Never auto-approved

- No config sets `updateSnapshots` other than `"none"` in CI, and no workflow passes `--update-snapshots`.
- `tests/sentinel/leak-suite-guard.spec.ts` gains a rule G7 that fails on either, with a planted negative for each
  form, as G1–G6 have.
- A baseline changes only in a PR that says so in its body and lists each changed file. The reviewer's verdict names
  the changed baselines, and an ACCEPT that does not list them does not cover them.
- When a comparison fails, Playwright writes the expected, actual and diff images. They go into the artifact and the
  PR report (§10). A changed screen is reported, never silently re-baselined.
- A new baseline is made in the CI visual job on demand (§8) and downloaded from its artifact, not from a sandbox (§3).

### 5.3 Before and after (UXQA-14)

For a UX or FE PR that changes the look, the on-demand job runs the library twice: once on the PR's base and once on
its head. It pairs each image as `before | after | diff` and writes `test-results/before-after/index.html` plus a
manifest. An unchanged pair is listed as unchanged. The design review (`docs/design/reviews/`) links the artifact
instead of a hand capture, which replaces the temporary captures UX-007 and UX-013 used.

## 6. Manual accessibility checklist (REQ-A11Y-003)

File: `docs/qa/A11Y_MANUAL_CHECKLIST.md`. One row per check, per screen, in ar and en. Each row records the result,
who ran it, the tool and version, and the date. It covers what axe and the reflow suite cannot judge reliably:

- screen reader reading order and announcements (NVDA with Firefox, VoiceOver with Safari), including Arabic and
  English mixed in one line (bidi, `lang` changes, the frame title from UX-011);
- meaningful focus order and the visibility of focus on every control after UX-014;
- headings and labels that describe their purpose (SC 2.4.6), and error messages that suggest a fix (SC 3.3.3);
- content on hover or focus (SC 1.4.13), and whether instructions rely on sensory characteristics (SC 1.3.3);
- the forced-colors and high-contrast modes, and 200 % browser zoom in a real browser rather than a viewport;
- the notification preview read as a notice: the frame and the plain-text version.

The register's recommended tool, Microsoft Accessibility Insights (guided assessment), is named for each row where it
applies.

**Stays open:** the checklist is written by QA, but carrying it out needs a person at a real screen reader and
browser. This sandbox has neither, and a check that was not run is never reported as passed. Who runs it is ARCH's
to assign (UX or the owner). QA records the results.

## 7. Accessibility audit (REQ-A11Y-014, UXQA-07)

File: `docs/qa/ACCESSIBILITY_AUDIT.md`, one table per WCAG 2.2 A/AA success criterion. Each row names:

- the automated suite that covers it, with its run ID and count: axe in `tests/a11y` and the specs; reflow
  (QA-010); keyboard;
- the manual checklist row (§6);
- the result: PASS (automated), PASS (manual), NOT_RUN or FAIL, with the finding's link.

The audit states what it does not cover. It never says "WCAG compliant", in line with the register row's own note
and the CDF-DEV-AUDIT evidence rules. **Stays open:** every row whose only coverage is manual stays NOT_RUN until §6 is
carried out.

## 8. What needs ARCH in CI (shared files)

| Item | Proposal |
| --- | --- |
| Visual job | a `visual` job in `ci.yml`: the same database service and steps as `e2e`, plus `fonts-liberation fonts-dejavu-core fonts-crosextra-carlito fonts-noto-core` installed explicitly, and `pnpm exec playwright test --project=visual-*` |
| When | the baseline subset (§5.1) on every PR; the full library and the before/after run on `workflow_dispatch` with an input `mode: library | before-after` and, for before/after, `base` |
| Artifacts | `visual-results` (diffs, library, manifest), retention 14 days like the other jobs; the before/after artifact 30 days, so a design review can link it |
| Guard | G7 (§5.2) runs in the existing e2e job; no workflow passes `--update-snapshots` |
| Cross-browser job | §9.3 |
| Report | §10.2 |

No new dependency is needed. `@playwright/test` and `@axe-core/playwright` are already in the lockfile.

## 9. Firefox and WebKit (REQ-QA-003)

### 9.1 Projects

`playwright.config.ts` gains `firefox-ar` and `webkit-ar` (1280 × 800, `ar-SA`). They are selected only when
`V13_E2E_BROWSERS` names them, so a plain `pnpm test:e2e`, including in this sandbox, still runs Chromium only.
`playwright install` is never run in a Claude sandbox: only the pre-installed Chromium is used there.

### 9.2 What they run

These are engine-neutral suites: the e2e scenarios, smoke, `tests/a11y` (axe and reflow) and the visual baseline
subset with its own baselines per engine.

They do not run the suites that depend on Chromium's DevTools protocol:
- the Sentinel's response-body reads and P4 request bodies;
- the CSP console checks that match Chromium's message text.

Those suites stay Chromium-only through `testMatch` and `testIgnore` on the two projects, never through `test.skip`.
A skip in a leak-detection suite is refused by the leak-suite guard (QA-008), and that rule stays as it is.

### 9.3 CI (decision D3)

A `cross-browser` job runs `pnpm exec playwright install --with-deps firefox webkit` and then
`V13_E2E_BROWSERS=firefox-ar,webkit-ar pnpm test:e2e`. QA proposes it runs nightly and on `workflow_dispatch`. It
would be a required PR check only after five green nightly runs in a row, because a red engine-specific result needs
a triage path before it can block merges. Results are reported as "Chromium/Firefox/WebKit emulation", never as
real-device testing (TEST_ARCHITECTURE §1 rule 5).

**Stays open:** this sandbox cannot run Firefox or WebKit, so QA's local evidence for §9 is the Chromium run plus
the CI job's results, which QA reads and records.

## 10. PR quality report (REQ-CICD-002)

### 10.1 Content

Each PR run gets one Markdown report, built from what the jobs already write. Nothing is generated by a model.

| Section | Source |
| --- | --- |
| Failed tests | Playwright JSON and JUnit, Vitest JUnit: test, file:line, first error line |
| Screenshots | failed `toHaveScreenshot` comparisons: expected, actual and diff file names in the artifact |
| UX findings | reflow and layout failures (QA-010 checks 1–6), by page, language and viewport |
| Accessibility findings | axe violations by rule, impact, page and node count |
| Performance changes | "not measured in M1" (stays open: no performance baseline or budget exists; one needs a source and an ARCH decision) |
| Recommended corrections | a fixed table from rule to the usual correction (for example `color-contrast` → token pair, reflow check 1 → `min-inline-size: 0` on the flex child), linked to UX_BACKLOG conventions; never invented per run |

### 10.2 Where it lives (decision D4)

- The builder is a small Node script with no new dependency. QA proposes `tests/report/pr-report.ts`, a new
  QA-owned path, which needs ARCH to add it to QA's paths. The alternative is `tests/fixtures/report/`.
- CI runs it in an `if: always()` step after the e2e, unit and visual jobs and writes it to `$GITHUB_STEP_SUMMARY`.
  No PR comment and no extra token are needed.
- The same file goes into the job's artifact.

## 11. Decisions for ARCH

- **D1 Server clock.** Mask server-clock text (QA's default, no app change), or have FE add a test-only clock that is
  read only when `V13_PERSONA_SIGNIN=enabled` and a test variable is set. The second gives frozen deadline words, but
  it is an app seam, so it needs FE, SEC and ARCH.
- **D2 Baselines.** Commit the about-30-image subset and keep the full library as an artifact (QA's proposal), or
  something else.
- **D3 Cross-browser.** Run nightly plus on demand, and become required after five green nightly runs (QA's
  proposal), or required from the start.
- **D4 Report path.** `tests/report/` as a new QA path, or `tests/fixtures/report/`.
