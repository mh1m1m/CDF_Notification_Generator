# Accessibility audit, WCAG 2.2 A and AA (REQ-A11Y-014)

**Classification: SYNTHETIC-DATA REFERENCE IMPLEMENTATION.** Not CDF production. This audit is not a statement of
conformance: it records what was checked, by which suite, with what result, and what was not checked. Every page,
persona and case is synthetic.

V13-QA-018, from `docs/qa/M1_OPEN_QA_ROWS_DESIGN.md` §7 (UXQA-07). Manual rows are in
`docs/qa/A11Y_MANUAL_CHECKLIST.md`; screen ids (S01–S12) are defined there.

## Result values

| Value | Meaning |
| --- | --- |
| PASS (automated) | An automated suite in CI checks this criterion on every screen in scope, and it passed. |
| PASS (manual) | Every manual row named for it was run and passed. |
| NOT_RUN | Coverage is partial or manual-only, and the manual rows have not been run. |
| FAIL | A check found a failure; the finding is linked. |
| NOT_APPLICABLE | M1 has no content this criterion applies to; the reason is given. |

No row is PASS today. The automated suites pass on what they check, but none of them covers every screen for any
criterion, so each row stays NOT_RUN until its manual rows are run (design §7: a row whose only coverage is manual
stays NOT_RUN). `tests/unit/qa/a11y-docs.spec.ts` checks that every criterion is listed once, that a manual PASS has
every named manual row passed, and that the manual rows named here exist.

## Scope

- Screens S01–S12 (the M1 pages of REQ-VIS-001, the switcher, the 404 and generic states), Arabic (RTL) and English
  (LTR), light and dark themes, at the viewports of design §2.2.
- Automated runs: Chromium (`desktop-ar`) in CI; the cross-browser workflow also runs `tests/a11y` in Firefox and
  WebKit (`tests/fixtures/browsers.ts`). The counts below are Chromium's.
- Out of scope: the CDF corporate IdP's sign-in (`PRODUCTION_SUBSTITUTION_REQUIRED`), e-mail clients rendering a sent
  notice (no dispatch in M1), and WCAG AAA.
- WCAG 2.2 removed 4.1.1 Parsing; it is not listed.

## Evidence

CI run [42393111241](https://github.com/mh1m1m/CDF_Notification_Generator/actions/runs/42393111241) on `develop`
6046ab1, every job green: unit job 128464658939, end-to-end job 128464658963 (the a11y suites run in it). Test counts
are from `vitest list` and `playwright test --list` on 6046ab1.

| Id | Suite | Tests | What it checks |
| --- | --- | --- | --- |
| AX-1 | `tests/a11y/smoke.a11y.spec.ts` | 3 | axe-core 4.14.0, tags `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`; serious and critical only; S01 in ar and en, S02 in ar; light theme |
| AX-2 | `tests/a11y/not-found.a11y.spec.ts` | 2 | axe-core 4.14.0, default rules, every impact; S12 (unknown route, another case's id, a display number as a case URL); one main landmark |
| RF | `tests/a11y/reflow.a11y.spec.ts` | 19 | the six checks of `docs/design/reviews/UX009_TEXT_RESIZE_REFLOW.md` §4 at 200 % and 400 % and with text spacing, ar and en, on S02–S07, S09, S10, S11; each check planted first |
| KB | `tests/e2e/shell-workspace-menu.spec.ts:50` | 1 | the switcher by keyboard: Enter opens, Escape closes, focus returns |
| ER | `tests/e2e/scenario-e-notification-draft.spec.ts:164` | 1 | a refused draft shows a generic error in text and focus moves to it |
| UT | `tests/unit/components/tokens.spec.ts` | 19 | text pairs 4.5:1 and control, focus and indicator borders 3:1, light and dark |
| UC | `tests/unit/components/controls.spec.ts` | 14 | control border, height (40 px), select chevron, forced colours; table links underlined |
| UR | `tests/unit/components/reflow.spec.ts` | 6 | the reflow CSS rules of UX-009 |
| US | `tests/unit/components/shell.spec.tsx` | 32 | shell landmarks, `aria-current`, one `h1`, ar and en |
| UD | `tests/unit/components/data.spec.tsx` | 41 | status badges distinct without colour, table captions, `aria-sort`, pagination |
| UN | `tests/unit/notifications/a11y.spec.ts` | 11 | the generated notice and e-mail HTML: A11Y-01 … A11Y-11 |

**Exploratory probe (local, not committed, not CI evidence).** On 2026-11-07 QA ran axe-core 4.14.0 with the tags
`wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`, `wcag22aa` and `best-practice`, every impact, on S01–S10 and S12 in ar and
en, light and dark (48 scans, local database after `pnpm db:reset`, Chromium). Result: no violation in the light
theme; two in the dark theme (F-01). axe could not enter the sandboxed preview frame (scripts are not allowed in it,
so axe waits for it until the test times out); the frame was excluded and its content is covered by UN and M-12.
axe left colour contrast for review on the drawn select controls (`draft-template`, `draft-recipient`,
`portfolio-stage`, `portfolio-state`, `notifications-status`: the chevron is a background gradient) and on badge
glyphs (no text); M-18 covers them.

## Criteria

### 1. Perceivable

| SC | Level | Title | Automated coverage | Manual rows | Result | Note |
| --- | --- | --- | --- | --- | --- | --- |
| 1.1.1 | A | Non-text content | UN A11Y-10 (notices have no images); probe: image-alt and svg rules pass on every screen (icons are `aria-hidden`) | M-01 | NOT_RUN |  |
| 1.2.1 | A | Audio-only and video-only (prerecorded) | none | none | NOT_APPLICABLE | No audio or video in M1: no `audio`, `video` or embedded media in `app/` or `components/`. |
| 1.2.2 | A | Captions (prerecorded) | none | none | NOT_APPLICABLE | No audio or video in M1. |
| 1.2.3 | A | Audio description or media alternative (prerecorded) | none | none | NOT_APPLICABLE | No audio or video in M1. |
| 1.2.4 | AA | Captions (live) | none | none | NOT_APPLICABLE | No live media in M1. |
| 1.2.5 | AA | Audio description (prerecorded) | none | none | NOT_APPLICABLE | No audio or video in M1. |
| 1.3.1 | A | Info and relationships | AX-1, AX-2 on S01, S02 (ar), S12; US landmarks and `aria-current`; UD table captions and `aria-sort`; UN A11Y-02, A11Y-06 | M-01, M-02, M-12 | NOT_RUN |  |
| 1.3.2 | A | Meaningful sequence | UN A11Y-11 (Latin references isolated in Arabic notices) | M-01, M-02, M-03, M-12 | NOT_RUN |  |
| 1.3.3 | A | Sensory characteristics | none | M-09 | NOT_RUN |  |
| 1.3.4 | AA | Orientation | none | M-15 | NOT_RUN | No orientation lock found in `app/`, `components/` or `styles/`; M-15. |
| 1.3.5 | AA | Identify input purpose | none | M-15 | NOT_RUN | M1 asks the user for no personal data (persona sign-in); M-15 confirms. |
| 1.4.1 | A | Use of colour | UC links in tables underlined; UD badges distinct without colour; UN A11Y-03 | M-09, M-10 | NOT_RUN |  |
| 1.4.2 | A | Audio control | none | none | NOT_APPLICABLE | No audio in M1. |
| 1.4.3 | AA | Contrast (minimum) | UT 4.5:1 for every text token pair, both themes; UN A11Y-04; AX-1 on S01, S02 (light); probe: dark theme fails on S04 and S06 | M-18 | FAIL | F-01. |
| 1.4.4 | AA | Resize text | RF 200 % (640 × 450), ar and en, on S02–S07, S09, S10 | M-11 | NOT_RUN | S01, S08 and S12 are not in RF (F-03); M-11 checks real browser zoom. |
| 1.4.5 | AA | Images of text | none | none | NOT_APPLICABLE | No images of text: the only images are `aria-hidden` SVG icons. |
| 1.4.10 | AA | Reflow | RF 320 × 256, ar and en, on S02–S07, S09–S11; UR; e2e at 320–375 px on S07 and S08 | M-11 | NOT_RUN | S01 and S12 are not in RF (F-03); M-11. |
| 1.4.11 | AA | Non-text contrast | UT 3:1 for control border and focus tokens, both themes; UC control border and select chevron | M-05, M-10, M-18 | NOT_RUN | Token pairs are pinned; their use on every control is M-05 and M-10. |
| 1.4.12 | AA | Text spacing | RF spacing stylesheet at 1280 × 900 and 320 × 256, ar and en, on S02–S07, S09, S10; checks 5 and 6 | M-11 | NOT_RUN | S01, S08 and S12 are not in RF (F-03). |
| 1.4.13 | AA | Content on hover or focus | RF check 6 (the switcher closes on Escape); KB | M-08 | NOT_RUN |  |

### 2. Operable

| SC | Level | Title | Automated coverage | Manual rows | Result | Note |
| --- | --- | --- | --- | --- | --- | --- |
| 2.1.1 | A | Keyboard | KB (switcher: Enter opens, Escape closes, focus returns); UN A11Y-09 (native `details`) | M-04 | NOT_RUN |  |
| 2.1.2 | A | No keyboard trap | KB (focus returns to the control) | M-04 | NOT_RUN |  |
| 2.1.4 | A | Character key shortcuts | none | M-04 | NOT_RUN | No single-key shortcut found in `app/` or `components/`; M-04 confirms. |
| 2.2.1 | A | Timing adjustable | none | M-16 | NOT_RUN | The session ends after 8 hours (`SESSION_MAX_AGE_SECONDS`); M-16. |
| 2.2.2 | A | Pause, stop, hide | none | M-17 | NOT_RUN | The loading skeleton pulses (`v13-pulse`); reduced motion stops it; M-17. |
| 2.3.1 | A | Three flashes or below threshold | none | M-17 | NOT_RUN | M-17. |
| 2.4.1 | A | Bypass blocks | RF check 5 (skip link at 320 × 256); UN A11Y-06; AX-1, AX-2 (bypass, landmark rules) | M-04 | NOT_RUN |  |
| 2.4.2 | A | Page titled | AX-1, AX-2 (document-title) on S01, S02, S12; UN A11Y-01 | M-01, M-02, M-12 | NOT_RUN | Presence is checked; whether a title describes the page is M-01. |
| 2.4.3 | A | Focus order | KB; ER (a refusal moves focus to the error) | M-04 | NOT_RUN |  |
| 2.4.4 | A | Link purpose (in context) | UN A11Y-08; AX-1, AX-2 (link-name) | M-06 | NOT_RUN |  |
| 2.4.5 | AA | Multiple ways | none | M-13 | NOT_RUN | Navigation, breadcrumbs, the portfolio filters and My Work reach a case; M-13 confirms. |
| 2.4.6 | AA | Headings and labels | UN A11Y-02; US one `h1` per page | M-06 | NOT_RUN |  |
| 2.4.7 | AA | Focus visible | UN A11Y-07; UT focus token 3:1 | M-05, M-10 | NOT_RUN |  |
| 2.4.11 | AA | Focus not obscured (minimum) | RF check 5 (the focused skip link lies inside the viewport) | M-05 | NOT_RUN |  |
| 2.5.1 | A | Pointer gestures | none | M-14 | NOT_RUN | No path or multipoint gesture found; M-14. |
| 2.5.2 | A | Pointer cancellation | none | M-14 | NOT_RUN | Native buttons and links only; M-14. |
| 2.5.3 | A | Label in name | AX-1, AX-2 (label-content-name-mismatch is experimental in axe and not run) | M-06 | NOT_RUN |  |
| 2.5.4 | A | Motion actuation | none | none | NOT_APPLICABLE | Nothing responds to device motion: no `devicemotion` or `deviceorientation` handler. |
| 2.5.7 | AA | Dragging movements | none | M-14 | NOT_RUN | No drag interaction found; M-14. |
| 2.5.8 | AA | Target size (minimum) | UC controls at least 40 px tall; probe: target-size passes on every screen (axe `wcag22aa`, not in CI's tags: F-02) | M-14 | NOT_RUN |  |

### 3. Understandable

| SC | Level | Title | Automated coverage | Manual rows | Result | Note |
| --- | --- | --- | --- | --- | --- | --- |
| 3.1.1 | A | Language of page | AX-1, AX-2 (html-has-lang, html-lang-valid); smoke checks `lang` after the switch; UN A11Y-01 | M-03, M-12 | NOT_RUN |  |
| 3.1.2 | AA | Language of parts | UN A11Y-11 (`bdi dir="ltr"`) | M-03 | NOT_RUN |  |
| 3.2.1 | A | On focus | none | M-13 | NOT_RUN |  |
| 3.2.2 | A | On input | none | M-13 | NOT_RUN |  |
| 3.2.3 | AA | Consistent navigation | US one shell on every page | M-13 | NOT_RUN |  |
| 3.2.4 | AA | Consistent identification | none | M-13 | NOT_RUN |  |
| 3.2.6 | A | Consistent help | none | M-13 | NOT_RUN | M1 offers no help mechanism on the platform pages; M-13 records whether that holds. |
| 3.3.1 | A | Error identification | ER (refusals are generic, in text, focused) | M-07 | NOT_RUN |  |
| 3.3.2 | A | Labels or instructions | AX-1, AX-2 (label rules) on S01, S12 | M-06 | NOT_RUN |  |
| 3.3.3 | AA | Error suggestion | none | M-07 | NOT_RUN |  |
| 3.3.4 | AA | Error prevention (legal, financial, data) | none | M-07 | NOT_RUN | Whether a notification draft is a commitment this SC covers is a question for ARCH (Q-01). |
| 3.3.7 | A | Redundant entry | none | M-07 | NOT_RUN |  |
| 3.3.8 | AA | Accessible authentication (minimum) | none | M-16 | NOT_RUN | Persona sign-in asks for no password. `PRODUCTION_SUBSTITUTION_REQUIRED`: the CDF corporate IdP's own sign-in is audited with it. |

### 4. Robust

| SC | Level | Title | Automated coverage | Manual rows | Result | Note |
| --- | --- | --- | --- | --- | --- | --- |
| 4.1.2 | A | Name, role, value | AX-1, AX-2 (aria and name rules); US, UD | M-01, M-02, M-03, M-12 | NOT_RUN |  |
| 4.1.3 | AA | Status messages | none | M-01, M-02 | NOT_RUN |  |

## Findings

Each finding goes to its owner as a backlog row through ARCH (QA does not edit another team's paths).

| Id | Severity | What | Where | Proposed owner | Status |
| --- | --- | --- | --- | --- | --- |
| F-01 | serious (axe) | SC 1.4.3 fails in the dark theme: the "mine" task flag uses `--cdf-indicator-text` (#101820) as text with no fill, 1.1:1 on the case overview's surface (#19212b) and 1.5:1 on the tasks tab (#303841). The probe flagged it in English; the Arabic scans of the same pages did not, which the owner should check. | `app/(platform)/cases/[caseId]/_components/case.module.css` `.flag`, `data-testid="case-task-mine"`, S04 and S06, dark theme | FE (UX for the token choice) | open |
| F-02 | coverage | CI's axe runs cover S01, S02 (ar, light) and S12 only, without the `wcag22aa` rules (target size, focus not obscured) and without the dark theme; AX-1 counts serious and critical only. F-01 shows what that misses. | `tests/a11y/` | QA: an axe spec over S01–S12 × ar, en × light, dark with `wcag22aa` and every impact; it can land only once F-01 is fixed, unless ARCH allows a tracked exception | proposed (V13-QA-025) |
| F-03 | coverage | RF does not open S01, S08 (the preview frame) or S12. | `tests/a11y/reflow.a11y.spec.ts` | QA, with F-02 | proposed |
| Q-01 | question | Is creating a notification draft a commitment SC 3.3.4 covers? Nothing is sent in M1. | — | ARCH | open |

## What this audit does not cover

- Every manual row (`docs/qa/A11Y_MANUAL_CHECKLIST.md`): NOT_RUN until a person at a real screen reader and browser runs
  it (ARCH's call on who).
- Real mobile devices and assistive technology on them.
- The CDF corporate IdP's sign-in and any e-mail client rendering a sent notice.
