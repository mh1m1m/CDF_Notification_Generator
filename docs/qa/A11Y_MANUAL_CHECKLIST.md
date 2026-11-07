# Manual accessibility checklist (REQ-A11Y-003)

**Classification: SYNTHETIC-DATA REFERENCE IMPLEMENTATION.** Not CDF production. Every page, persona and case named here
is synthetic (CDF-DEMO-2026-0001 … 0010, `@example.test`).

V13-QA-018, from `docs/qa/M1_OPEN_QA_ROWS_DESIGN.md` §6. This checklist covers what axe and the reflow suite cannot
judge reliably. The audit (`docs/qa/ACCESSIBILITY_AUDIT.md`) maps every WCAG 2.2 A and AA success criterion to these
rows and to the automated suites.

## Status

**Every row is NOT_RUN.** Carrying out a row needs a person at a real screen reader and browser; this sandbox has
neither, and a check that was not run is never reported as passed. Who runs it is ARCH's call (ruling §6 on #132: the
owner, or UX with the owner). QA records the results here.

## How a row is recorded

| Field | Rule |
| --- | --- |
| Result | `NOT_RUN`, `PASS`, `FAIL` or `NOT_APPLICABLE`. Only a person who ran the row changes it. |
| Who | The person who ran it (a role or a synthetic handle; never a personal e-mail address). |
| Tool and version | The assistive technology and browser with versions, e.g. `NVDA 2025.3, Firefox 145`. |
| Date | `YYYY-MM-DD`. |
| Finding | For `FAIL`: the backlog row or issue (`UXB-nn`, `OI-nnn`, a PR). For `NOT_APPLICABLE`: why. |

A `PASS`, `FAIL` or `NOT_APPLICABLE` row without Who, Tool and version, and Date is invalid, and so is a `FAIL` without a
finding; `tests/unit/qa/a11y-docs.spec.ts` fails on either. Run each row in Arabic (RTL) and English (LTR), in the light
theme, and repeat M-05 and M-10 in the dark theme. Use the synthetic personas only.

The register's recommended tool, Microsoft Accessibility Insights for Web (its guided Assessment), is named for every
row where it applies.

## Screens

| Id | Screen | Where |
| --- | --- | --- |
| S01 | Sign-in | `/sign-in` (persona choice; no password) |
| S02 | My Work | `/my-work` (Investigator Beta, Secretary Alpha) |
| S03 | Case Portfolio | `/portfolio` with its filters (Secretary Alpha) |
| S04 | Case Details: overview | `/cases/{id}` (CDF-DEMO-2026-0001) |
| S05 | Case Details: events | `/cases/{id}/events` |
| S06 | Case Details: tasks | `/cases/{id}/tasks` |
| S07 | Case Details: notifications and the draft form | `/cases/{id}/notifications` |
| S08 | Notification Preview | `/cases/{id}/notifications?n={id}`: the sandboxed frame and the plain-text version (a WITNESS draft on CDF-DEMO-2026-0005) |
| S09 | Notification Center | `/notifications` with its filters |
| S10 | Workspace Switcher | the open menu on any page, and `/workspaces` (Governance Officer Delta, two workspaces) |
| S11 | Mobile Navigation | the side navigation at 360 px |
| S12 | Not found and generic states | `/no-such-route`, another case's id, the generic error and empty states |

The Notification Generator and the Search Interface have no page of their own in M1: the draft form is checked on S07
and the filters on S03 and S09 (design §2.1).

## Checks

| Id | What to check | WCAG 2.2 SC | Tool | Screens |
| --- | --- | --- | --- | --- |
| M-01 | Screen reader, NVDA with Firefox: reading order, landmarks, headings, names, roles and states, and what is announced after an action (a filter applied, a draft created, a workspace switched) | 1.1.1, 1.3.1, 1.3.2, 2.4.2, 4.1.2, 4.1.3 | NVDA with Firefox; Accessibility Insights for Web, Assessment | all |
| M-02 | Screen reader, VoiceOver with Safari: the same as M-01 | 1.3.1, 1.3.2, 2.4.2, 4.1.2, 4.1.3 | VoiceOver with Safari (macOS) | all |
| M-03 | Arabic and English mixed in one line: Latin references (CDF-DEMO numbers, notice references, ids) read in the right order and language; `lang` changes are announced; the preview frame's title (UX-011) is read | 1.3.2, 3.1.1, 3.1.2, 4.1.2 | NVDA with Firefox; VoiceOver with Safari | all |
| M-04 | Keyboard only: every control is reachable and operable, the focus order follows the meaning of the page in both directions, nothing traps focus, the skip link moves to the main content, and no single-key shortcut exists | 2.1.1, 2.1.2, 2.1.4, 2.4.1, 2.4.3 | Keyboard; Accessibility Insights for Web, Assessment | all |
| M-05 | Focus is visible on every control (after UX-014) and is never hidden behind sticky or overlapping content, in light and dark themes | 2.4.7, 2.4.11, 1.4.11 | Keyboard; Accessibility Insights for Web, Assessment | all |
| M-06 | Headings and labels describe their topic or purpose; every field has a visible label or instruction; every link's purpose is clear from its text or context; the visible label is part of the accessible name | 2.4.4, 2.4.6, 2.5.3, 3.3.2 | Screen reader; Accessibility Insights for Web, Assessment | all |
| M-07 | Errors: a refused or invalid input is identified in text and the message says how to fix it; nothing a user submits needs to be typed twice; a submission that commits something can be checked or reversed (see the audit's Q-01) | 3.3.1, 3.3.3, 3.3.4, 3.3.7 | Keyboard; screen reader | S01, S03, S07, S09, S10 |
| M-08 | Content that appears on hover or focus (tooltips, the persona menu, the switcher) can be dismissed without moving focus, can be hovered, and stays until dismissed | 1.4.13 | Mouse and keyboard; Accessibility Insights for Web, Assessment | S02, S03, S04, S09, S10, S11 |
| M-09 | No instruction relies on shape, size, position or sound alone, and no state is shown by colour alone | 1.3.3, 1.4.1 | Visual review; Accessibility Insights for Web, Assessment | all |
| M-10 | Forced colours (a Windows contrast theme): text, control borders, focus, the status badges and the select arrow stay visible | 1.4.1, 1.4.11, 2.4.7 | Windows contrast theme in Edge or Chrome | all |
| M-11 | Browser zoom to 200 % and 400 % in a real browser (not a viewport): no loss of content or function, no two-way scrolling except for data tables; then a text-spacing bookmarklet at 100 % | 1.4.4, 1.4.10, 1.4.12 | Browser zoom (Chrome, Firefox, Safari) | all |
| M-12 | The notification preview read as a notice: the frame has a title, its language and direction, one h1 and a reading order a recipient would follow; the plain-text version reads the same content in the same order | 1.3.1, 1.3.2, 2.4.2, 3.1.1, 4.1.2 | NVDA with Firefox; VoiceOver with Safari | S08 |
| M-13 | Consistency and predictability: navigation, the switcher and the persona menu are in the same place and named the same on every page; focusing or changing a control (a filter, a select) does not change the page by itself; help, where offered, is in the same place; a case can be reached in more than one way | 2.4.5, 3.2.1, 3.2.2, 3.2.3, 3.2.4, 3.2.6 | Keyboard; visual review | all |
| M-14 | Pointer: every target is at least 24 × 24 CSS px or spaced (on touch at 360 px too); actions fire on release and can be cancelled; nothing needs dragging or a path gesture | 2.5.1, 2.5.2, 2.5.7, 2.5.8 | Touch device or emulation; Accessibility Insights for Web, Assessment | all |
| M-15 | Orientation and input purpose: every page works in portrait and landscape; fields that collect the user's own data say their purpose (autocomplete) | 1.3.4, 1.3.5 | Device rotation; Accessibility Insights for Web, Assessment | all |
| M-16 | Sign-in: no cognitive function test (no password to remember or transcribe, no puzzle); the session limit (8 hours) is announced before it ends or can be extended, and nothing typed is lost when it ends | 2.2.1, 3.3.8 | Visual review; keyboard | S01, S07 |
| M-17 | Moving content: the loading skeleton's pulse stops when reduced motion is set and does not run more than five seconds next to other content; nothing flashes | 2.2.2, 2.3.1 | Visual review with and without reduced motion | S02, S03, S04, S09 |
| M-18 | Contrast in every state (rest, hover, focus, selected, disabled, error) in the light and dark themes, measured with a contrast analyser on the rendered page, including the drawn select controls and badges axe leaves for review | 1.4.3, 1.4.11 | Colour Contrast Analyser; Accessibility Insights for Web, Assessment | all |

## Results

### M-01

| Screen | Lang | Result | Who | Tool and version | Date | Finding |
| --- | --- | --- | --- | --- | --- | --- |
| S01 Sign-in | ar | NOT_RUN |  |  |  |  |
| S01 Sign-in | en | NOT_RUN |  |  |  |  |
| S02 My Work | ar | NOT_RUN |  |  |  |  |
| S02 My Work | en | NOT_RUN |  |  |  |  |
| S03 Case Portfolio | ar | NOT_RUN |  |  |  |  |
| S03 Case Portfolio | en | NOT_RUN |  |  |  |  |
| S04 Case Details: overview | ar | NOT_RUN |  |  |  |  |
| S04 Case Details: overview | en | NOT_RUN |  |  |  |  |
| S05 Case Details: events | ar | NOT_RUN |  |  |  |  |
| S05 Case Details: events | en | NOT_RUN |  |  |  |  |
| S06 Case Details: tasks | ar | NOT_RUN |  |  |  |  |
| S06 Case Details: tasks | en | NOT_RUN |  |  |  |  |
| S07 Case Details: notifications and the draft form | ar | NOT_RUN |  |  |  |  |
| S07 Case Details: notifications and the draft form | en | NOT_RUN |  |  |  |  |
| S08 Notification Preview | ar | NOT_RUN |  |  |  |  |
| S08 Notification Preview | en | NOT_RUN |  |  |  |  |
| S09 Notification Center | ar | NOT_RUN |  |  |  |  |
| S09 Notification Center | en | NOT_RUN |  |  |  |  |
| S10 Workspace Switcher | ar | NOT_RUN |  |  |  |  |
| S10 Workspace Switcher | en | NOT_RUN |  |  |  |  |
| S11 Mobile Navigation | ar | NOT_RUN |  |  |  |  |
| S11 Mobile Navigation | en | NOT_RUN |  |  |  |  |
| S12 Not found and generic states | ar | NOT_RUN |  |  |  |  |
| S12 Not found and generic states | en | NOT_RUN |  |  |  |  |

### M-02

| Screen | Lang | Result | Who | Tool and version | Date | Finding |
| --- | --- | --- | --- | --- | --- | --- |
| S01 Sign-in | ar | NOT_RUN |  |  |  |  |
| S01 Sign-in | en | NOT_RUN |  |  |  |  |
| S02 My Work | ar | NOT_RUN |  |  |  |  |
| S02 My Work | en | NOT_RUN |  |  |  |  |
| S03 Case Portfolio | ar | NOT_RUN |  |  |  |  |
| S03 Case Portfolio | en | NOT_RUN |  |  |  |  |
| S04 Case Details: overview | ar | NOT_RUN |  |  |  |  |
| S04 Case Details: overview | en | NOT_RUN |  |  |  |  |
| S05 Case Details: events | ar | NOT_RUN |  |  |  |  |
| S05 Case Details: events | en | NOT_RUN |  |  |  |  |
| S06 Case Details: tasks | ar | NOT_RUN |  |  |  |  |
| S06 Case Details: tasks | en | NOT_RUN |  |  |  |  |
| S07 Case Details: notifications and the draft form | ar | NOT_RUN |  |  |  |  |
| S07 Case Details: notifications and the draft form | en | NOT_RUN |  |  |  |  |
| S08 Notification Preview | ar | NOT_RUN |  |  |  |  |
| S08 Notification Preview | en | NOT_RUN |  |  |  |  |
| S09 Notification Center | ar | NOT_RUN |  |  |  |  |
| S09 Notification Center | en | NOT_RUN |  |  |  |  |
| S10 Workspace Switcher | ar | NOT_RUN |  |  |  |  |
| S10 Workspace Switcher | en | NOT_RUN |  |  |  |  |
| S11 Mobile Navigation | ar | NOT_RUN |  |  |  |  |
| S11 Mobile Navigation | en | NOT_RUN |  |  |  |  |
| S12 Not found and generic states | ar | NOT_RUN |  |  |  |  |
| S12 Not found and generic states | en | NOT_RUN |  |  |  |  |

### M-03

| Screen | Lang | Result | Who | Tool and version | Date | Finding |
| --- | --- | --- | --- | --- | --- | --- |
| S01 Sign-in | ar | NOT_RUN |  |  |  |  |
| S01 Sign-in | en | NOT_RUN |  |  |  |  |
| S02 My Work | ar | NOT_RUN |  |  |  |  |
| S02 My Work | en | NOT_RUN |  |  |  |  |
| S03 Case Portfolio | ar | NOT_RUN |  |  |  |  |
| S03 Case Portfolio | en | NOT_RUN |  |  |  |  |
| S04 Case Details: overview | ar | NOT_RUN |  |  |  |  |
| S04 Case Details: overview | en | NOT_RUN |  |  |  |  |
| S05 Case Details: events | ar | NOT_RUN |  |  |  |  |
| S05 Case Details: events | en | NOT_RUN |  |  |  |  |
| S06 Case Details: tasks | ar | NOT_RUN |  |  |  |  |
| S06 Case Details: tasks | en | NOT_RUN |  |  |  |  |
| S07 Case Details: notifications and the draft form | ar | NOT_RUN |  |  |  |  |
| S07 Case Details: notifications and the draft form | en | NOT_RUN |  |  |  |  |
| S08 Notification Preview | ar | NOT_RUN |  |  |  |  |
| S08 Notification Preview | en | NOT_RUN |  |  |  |  |
| S09 Notification Center | ar | NOT_RUN |  |  |  |  |
| S09 Notification Center | en | NOT_RUN |  |  |  |  |
| S10 Workspace Switcher | ar | NOT_RUN |  |  |  |  |
| S10 Workspace Switcher | en | NOT_RUN |  |  |  |  |
| S11 Mobile Navigation | ar | NOT_RUN |  |  |  |  |
| S11 Mobile Navigation | en | NOT_RUN |  |  |  |  |
| S12 Not found and generic states | ar | NOT_RUN |  |  |  |  |
| S12 Not found and generic states | en | NOT_RUN |  |  |  |  |

### M-04

| Screen | Lang | Result | Who | Tool and version | Date | Finding |
| --- | --- | --- | --- | --- | --- | --- |
| S01 Sign-in | ar | NOT_RUN |  |  |  |  |
| S01 Sign-in | en | NOT_RUN |  |  |  |  |
| S02 My Work | ar | NOT_RUN |  |  |  |  |
| S02 My Work | en | NOT_RUN |  |  |  |  |
| S03 Case Portfolio | ar | NOT_RUN |  |  |  |  |
| S03 Case Portfolio | en | NOT_RUN |  |  |  |  |
| S04 Case Details: overview | ar | NOT_RUN |  |  |  |  |
| S04 Case Details: overview | en | NOT_RUN |  |  |  |  |
| S05 Case Details: events | ar | NOT_RUN |  |  |  |  |
| S05 Case Details: events | en | NOT_RUN |  |  |  |  |
| S06 Case Details: tasks | ar | NOT_RUN |  |  |  |  |
| S06 Case Details: tasks | en | NOT_RUN |  |  |  |  |
| S07 Case Details: notifications and the draft form | ar | NOT_RUN |  |  |  |  |
| S07 Case Details: notifications and the draft form | en | NOT_RUN |  |  |  |  |
| S08 Notification Preview | ar | NOT_RUN |  |  |  |  |
| S08 Notification Preview | en | NOT_RUN |  |  |  |  |
| S09 Notification Center | ar | NOT_RUN |  |  |  |  |
| S09 Notification Center | en | NOT_RUN |  |  |  |  |
| S10 Workspace Switcher | ar | NOT_RUN |  |  |  |  |
| S10 Workspace Switcher | en | NOT_RUN |  |  |  |  |
| S11 Mobile Navigation | ar | NOT_RUN |  |  |  |  |
| S11 Mobile Navigation | en | NOT_RUN |  |  |  |  |
| S12 Not found and generic states | ar | NOT_RUN |  |  |  |  |
| S12 Not found and generic states | en | NOT_RUN |  |  |  |  |

### M-05

| Screen | Lang | Result | Who | Tool and version | Date | Finding |
| --- | --- | --- | --- | --- | --- | --- |
| S01 Sign-in | ar | NOT_RUN |  |  |  |  |
| S01 Sign-in | en | NOT_RUN |  |  |  |  |
| S02 My Work | ar | NOT_RUN |  |  |  |  |
| S02 My Work | en | NOT_RUN |  |  |  |  |
| S03 Case Portfolio | ar | NOT_RUN |  |  |  |  |
| S03 Case Portfolio | en | NOT_RUN |  |  |  |  |
| S04 Case Details: overview | ar | NOT_RUN |  |  |  |  |
| S04 Case Details: overview | en | NOT_RUN |  |  |  |  |
| S05 Case Details: events | ar | NOT_RUN |  |  |  |  |
| S05 Case Details: events | en | NOT_RUN |  |  |  |  |
| S06 Case Details: tasks | ar | NOT_RUN |  |  |  |  |
| S06 Case Details: tasks | en | NOT_RUN |  |  |  |  |
| S07 Case Details: notifications and the draft form | ar | NOT_RUN |  |  |  |  |
| S07 Case Details: notifications and the draft form | en | NOT_RUN |  |  |  |  |
| S08 Notification Preview | ar | NOT_RUN |  |  |  |  |
| S08 Notification Preview | en | NOT_RUN |  |  |  |  |
| S09 Notification Center | ar | NOT_RUN |  |  |  |  |
| S09 Notification Center | en | NOT_RUN |  |  |  |  |
| S10 Workspace Switcher | ar | NOT_RUN |  |  |  |  |
| S10 Workspace Switcher | en | NOT_RUN |  |  |  |  |
| S11 Mobile Navigation | ar | NOT_RUN |  |  |  |  |
| S11 Mobile Navigation | en | NOT_RUN |  |  |  |  |
| S12 Not found and generic states | ar | NOT_RUN |  |  |  |  |
| S12 Not found and generic states | en | NOT_RUN |  |  |  |  |

### M-06

| Screen | Lang | Result | Who | Tool and version | Date | Finding |
| --- | --- | --- | --- | --- | --- | --- |
| S01 Sign-in | ar | NOT_RUN |  |  |  |  |
| S01 Sign-in | en | NOT_RUN |  |  |  |  |
| S02 My Work | ar | NOT_RUN |  |  |  |  |
| S02 My Work | en | NOT_RUN |  |  |  |  |
| S03 Case Portfolio | ar | NOT_RUN |  |  |  |  |
| S03 Case Portfolio | en | NOT_RUN |  |  |  |  |
| S04 Case Details: overview | ar | NOT_RUN |  |  |  |  |
| S04 Case Details: overview | en | NOT_RUN |  |  |  |  |
| S05 Case Details: events | ar | NOT_RUN |  |  |  |  |
| S05 Case Details: events | en | NOT_RUN |  |  |  |  |
| S06 Case Details: tasks | ar | NOT_RUN |  |  |  |  |
| S06 Case Details: tasks | en | NOT_RUN |  |  |  |  |
| S07 Case Details: notifications and the draft form | ar | NOT_RUN |  |  |  |  |
| S07 Case Details: notifications and the draft form | en | NOT_RUN |  |  |  |  |
| S08 Notification Preview | ar | NOT_RUN |  |  |  |  |
| S08 Notification Preview | en | NOT_RUN |  |  |  |  |
| S09 Notification Center | ar | NOT_RUN |  |  |  |  |
| S09 Notification Center | en | NOT_RUN |  |  |  |  |
| S10 Workspace Switcher | ar | NOT_RUN |  |  |  |  |
| S10 Workspace Switcher | en | NOT_RUN |  |  |  |  |
| S11 Mobile Navigation | ar | NOT_RUN |  |  |  |  |
| S11 Mobile Navigation | en | NOT_RUN |  |  |  |  |
| S12 Not found and generic states | ar | NOT_RUN |  |  |  |  |
| S12 Not found and generic states | en | NOT_RUN |  |  |  |  |

### M-07

| Screen | Lang | Result | Who | Tool and version | Date | Finding |
| --- | --- | --- | --- | --- | --- | --- |
| S01 Sign-in | ar | NOT_RUN |  |  |  |  |
| S01 Sign-in | en | NOT_RUN |  |  |  |  |
| S03 Case Portfolio | ar | NOT_RUN |  |  |  |  |
| S03 Case Portfolio | en | NOT_RUN |  |  |  |  |
| S07 Case Details: notifications and the draft form | ar | NOT_RUN |  |  |  |  |
| S07 Case Details: notifications and the draft form | en | NOT_RUN |  |  |  |  |
| S09 Notification Center | ar | NOT_RUN |  |  |  |  |
| S09 Notification Center | en | NOT_RUN |  |  |  |  |
| S10 Workspace Switcher | ar | NOT_RUN |  |  |  |  |
| S10 Workspace Switcher | en | NOT_RUN |  |  |  |  |

### M-08

| Screen | Lang | Result | Who | Tool and version | Date | Finding |
| --- | --- | --- | --- | --- | --- | --- |
| S02 My Work | ar | NOT_RUN |  |  |  |  |
| S02 My Work | en | NOT_RUN |  |  |  |  |
| S03 Case Portfolio | ar | NOT_RUN |  |  |  |  |
| S03 Case Portfolio | en | NOT_RUN |  |  |  |  |
| S04 Case Details: overview | ar | NOT_RUN |  |  |  |  |
| S04 Case Details: overview | en | NOT_RUN |  |  |  |  |
| S09 Notification Center | ar | NOT_RUN |  |  |  |  |
| S09 Notification Center | en | NOT_RUN |  |  |  |  |
| S10 Workspace Switcher | ar | NOT_RUN |  |  |  |  |
| S10 Workspace Switcher | en | NOT_RUN |  |  |  |  |
| S11 Mobile Navigation | ar | NOT_RUN |  |  |  |  |
| S11 Mobile Navigation | en | NOT_RUN |  |  |  |  |

### M-09

| Screen | Lang | Result | Who | Tool and version | Date | Finding |
| --- | --- | --- | --- | --- | --- | --- |
| S01 Sign-in | ar | NOT_RUN |  |  |  |  |
| S01 Sign-in | en | NOT_RUN |  |  |  |  |
| S02 My Work | ar | NOT_RUN |  |  |  |  |
| S02 My Work | en | NOT_RUN |  |  |  |  |
| S03 Case Portfolio | ar | NOT_RUN |  |  |  |  |
| S03 Case Portfolio | en | NOT_RUN |  |  |  |  |
| S04 Case Details: overview | ar | NOT_RUN |  |  |  |  |
| S04 Case Details: overview | en | NOT_RUN |  |  |  |  |
| S05 Case Details: events | ar | NOT_RUN |  |  |  |  |
| S05 Case Details: events | en | NOT_RUN |  |  |  |  |
| S06 Case Details: tasks | ar | NOT_RUN |  |  |  |  |
| S06 Case Details: tasks | en | NOT_RUN |  |  |  |  |
| S07 Case Details: notifications and the draft form | ar | NOT_RUN |  |  |  |  |
| S07 Case Details: notifications and the draft form | en | NOT_RUN |  |  |  |  |
| S08 Notification Preview | ar | NOT_RUN |  |  |  |  |
| S08 Notification Preview | en | NOT_RUN |  |  |  |  |
| S09 Notification Center | ar | NOT_RUN |  |  |  |  |
| S09 Notification Center | en | NOT_RUN |  |  |  |  |
| S10 Workspace Switcher | ar | NOT_RUN |  |  |  |  |
| S10 Workspace Switcher | en | NOT_RUN |  |  |  |  |
| S11 Mobile Navigation | ar | NOT_RUN |  |  |  |  |
| S11 Mobile Navigation | en | NOT_RUN |  |  |  |  |
| S12 Not found and generic states | ar | NOT_RUN |  |  |  |  |
| S12 Not found and generic states | en | NOT_RUN |  |  |  |  |

### M-10

| Screen | Lang | Result | Who | Tool and version | Date | Finding |
| --- | --- | --- | --- | --- | --- | --- |
| S01 Sign-in | ar | NOT_RUN |  |  |  |  |
| S01 Sign-in | en | NOT_RUN |  |  |  |  |
| S02 My Work | ar | NOT_RUN |  |  |  |  |
| S02 My Work | en | NOT_RUN |  |  |  |  |
| S03 Case Portfolio | ar | NOT_RUN |  |  |  |  |
| S03 Case Portfolio | en | NOT_RUN |  |  |  |  |
| S04 Case Details: overview | ar | NOT_RUN |  |  |  |  |
| S04 Case Details: overview | en | NOT_RUN |  |  |  |  |
| S05 Case Details: events | ar | NOT_RUN |  |  |  |  |
| S05 Case Details: events | en | NOT_RUN |  |  |  |  |
| S06 Case Details: tasks | ar | NOT_RUN |  |  |  |  |
| S06 Case Details: tasks | en | NOT_RUN |  |  |  |  |
| S07 Case Details: notifications and the draft form | ar | NOT_RUN |  |  |  |  |
| S07 Case Details: notifications and the draft form | en | NOT_RUN |  |  |  |  |
| S08 Notification Preview | ar | NOT_RUN |  |  |  |  |
| S08 Notification Preview | en | NOT_RUN |  |  |  |  |
| S09 Notification Center | ar | NOT_RUN |  |  |  |  |
| S09 Notification Center | en | NOT_RUN |  |  |  |  |
| S10 Workspace Switcher | ar | NOT_RUN |  |  |  |  |
| S10 Workspace Switcher | en | NOT_RUN |  |  |  |  |
| S11 Mobile Navigation | ar | NOT_RUN |  |  |  |  |
| S11 Mobile Navigation | en | NOT_RUN |  |  |  |  |
| S12 Not found and generic states | ar | NOT_RUN |  |  |  |  |
| S12 Not found and generic states | en | NOT_RUN |  |  |  |  |

### M-11

| Screen | Lang | Result | Who | Tool and version | Date | Finding |
| --- | --- | --- | --- | --- | --- | --- |
| S01 Sign-in | ar | NOT_RUN |  |  |  |  |
| S01 Sign-in | en | NOT_RUN |  |  |  |  |
| S02 My Work | ar | NOT_RUN |  |  |  |  |
| S02 My Work | en | NOT_RUN |  |  |  |  |
| S03 Case Portfolio | ar | NOT_RUN |  |  |  |  |
| S03 Case Portfolio | en | NOT_RUN |  |  |  |  |
| S04 Case Details: overview | ar | NOT_RUN |  |  |  |  |
| S04 Case Details: overview | en | NOT_RUN |  |  |  |  |
| S05 Case Details: events | ar | NOT_RUN |  |  |  |  |
| S05 Case Details: events | en | NOT_RUN |  |  |  |  |
| S06 Case Details: tasks | ar | NOT_RUN |  |  |  |  |
| S06 Case Details: tasks | en | NOT_RUN |  |  |  |  |
| S07 Case Details: notifications and the draft form | ar | NOT_RUN |  |  |  |  |
| S07 Case Details: notifications and the draft form | en | NOT_RUN |  |  |  |  |
| S08 Notification Preview | ar | NOT_RUN |  |  |  |  |
| S08 Notification Preview | en | NOT_RUN |  |  |  |  |
| S09 Notification Center | ar | NOT_RUN |  |  |  |  |
| S09 Notification Center | en | NOT_RUN |  |  |  |  |
| S10 Workspace Switcher | ar | NOT_RUN |  |  |  |  |
| S10 Workspace Switcher | en | NOT_RUN |  |  |  |  |
| S11 Mobile Navigation | ar | NOT_RUN |  |  |  |  |
| S11 Mobile Navigation | en | NOT_RUN |  |  |  |  |
| S12 Not found and generic states | ar | NOT_RUN |  |  |  |  |
| S12 Not found and generic states | en | NOT_RUN |  |  |  |  |

### M-12

| Screen | Lang | Result | Who | Tool and version | Date | Finding |
| --- | --- | --- | --- | --- | --- | --- |
| S08 Notification Preview | ar | NOT_RUN |  |  |  |  |
| S08 Notification Preview | en | NOT_RUN |  |  |  |  |

### M-13

| Screen | Lang | Result | Who | Tool and version | Date | Finding |
| --- | --- | --- | --- | --- | --- | --- |
| S01 Sign-in | ar | NOT_RUN |  |  |  |  |
| S01 Sign-in | en | NOT_RUN |  |  |  |  |
| S02 My Work | ar | NOT_RUN |  |  |  |  |
| S02 My Work | en | NOT_RUN |  |  |  |  |
| S03 Case Portfolio | ar | NOT_RUN |  |  |  |  |
| S03 Case Portfolio | en | NOT_RUN |  |  |  |  |
| S04 Case Details: overview | ar | NOT_RUN |  |  |  |  |
| S04 Case Details: overview | en | NOT_RUN |  |  |  |  |
| S05 Case Details: events | ar | NOT_RUN |  |  |  |  |
| S05 Case Details: events | en | NOT_RUN |  |  |  |  |
| S06 Case Details: tasks | ar | NOT_RUN |  |  |  |  |
| S06 Case Details: tasks | en | NOT_RUN |  |  |  |  |
| S07 Case Details: notifications and the draft form | ar | NOT_RUN |  |  |  |  |
| S07 Case Details: notifications and the draft form | en | NOT_RUN |  |  |  |  |
| S08 Notification Preview | ar | NOT_RUN |  |  |  |  |
| S08 Notification Preview | en | NOT_RUN |  |  |  |  |
| S09 Notification Center | ar | NOT_RUN |  |  |  |  |
| S09 Notification Center | en | NOT_RUN |  |  |  |  |
| S10 Workspace Switcher | ar | NOT_RUN |  |  |  |  |
| S10 Workspace Switcher | en | NOT_RUN |  |  |  |  |
| S11 Mobile Navigation | ar | NOT_RUN |  |  |  |  |
| S11 Mobile Navigation | en | NOT_RUN |  |  |  |  |
| S12 Not found and generic states | ar | NOT_RUN |  |  |  |  |
| S12 Not found and generic states | en | NOT_RUN |  |  |  |  |

### M-14

| Screen | Lang | Result | Who | Tool and version | Date | Finding |
| --- | --- | --- | --- | --- | --- | --- |
| S01 Sign-in | ar | NOT_RUN |  |  |  |  |
| S01 Sign-in | en | NOT_RUN |  |  |  |  |
| S02 My Work | ar | NOT_RUN |  |  |  |  |
| S02 My Work | en | NOT_RUN |  |  |  |  |
| S03 Case Portfolio | ar | NOT_RUN |  |  |  |  |
| S03 Case Portfolio | en | NOT_RUN |  |  |  |  |
| S04 Case Details: overview | ar | NOT_RUN |  |  |  |  |
| S04 Case Details: overview | en | NOT_RUN |  |  |  |  |
| S05 Case Details: events | ar | NOT_RUN |  |  |  |  |
| S05 Case Details: events | en | NOT_RUN |  |  |  |  |
| S06 Case Details: tasks | ar | NOT_RUN |  |  |  |  |
| S06 Case Details: tasks | en | NOT_RUN |  |  |  |  |
| S07 Case Details: notifications and the draft form | ar | NOT_RUN |  |  |  |  |
| S07 Case Details: notifications and the draft form | en | NOT_RUN |  |  |  |  |
| S08 Notification Preview | ar | NOT_RUN |  |  |  |  |
| S08 Notification Preview | en | NOT_RUN |  |  |  |  |
| S09 Notification Center | ar | NOT_RUN |  |  |  |  |
| S09 Notification Center | en | NOT_RUN |  |  |  |  |
| S10 Workspace Switcher | ar | NOT_RUN |  |  |  |  |
| S10 Workspace Switcher | en | NOT_RUN |  |  |  |  |
| S11 Mobile Navigation | ar | NOT_RUN |  |  |  |  |
| S11 Mobile Navigation | en | NOT_RUN |  |  |  |  |
| S12 Not found and generic states | ar | NOT_RUN |  |  |  |  |
| S12 Not found and generic states | en | NOT_RUN |  |  |  |  |

### M-15

| Screen | Lang | Result | Who | Tool and version | Date | Finding |
| --- | --- | --- | --- | --- | --- | --- |
| S01 Sign-in | ar | NOT_RUN |  |  |  |  |
| S01 Sign-in | en | NOT_RUN |  |  |  |  |
| S02 My Work | ar | NOT_RUN |  |  |  |  |
| S02 My Work | en | NOT_RUN |  |  |  |  |
| S03 Case Portfolio | ar | NOT_RUN |  |  |  |  |
| S03 Case Portfolio | en | NOT_RUN |  |  |  |  |
| S04 Case Details: overview | ar | NOT_RUN |  |  |  |  |
| S04 Case Details: overview | en | NOT_RUN |  |  |  |  |
| S05 Case Details: events | ar | NOT_RUN |  |  |  |  |
| S05 Case Details: events | en | NOT_RUN |  |  |  |  |
| S06 Case Details: tasks | ar | NOT_RUN |  |  |  |  |
| S06 Case Details: tasks | en | NOT_RUN |  |  |  |  |
| S07 Case Details: notifications and the draft form | ar | NOT_RUN |  |  |  |  |
| S07 Case Details: notifications and the draft form | en | NOT_RUN |  |  |  |  |
| S08 Notification Preview | ar | NOT_RUN |  |  |  |  |
| S08 Notification Preview | en | NOT_RUN |  |  |  |  |
| S09 Notification Center | ar | NOT_RUN |  |  |  |  |
| S09 Notification Center | en | NOT_RUN |  |  |  |  |
| S10 Workspace Switcher | ar | NOT_RUN |  |  |  |  |
| S10 Workspace Switcher | en | NOT_RUN |  |  |  |  |
| S11 Mobile Navigation | ar | NOT_RUN |  |  |  |  |
| S11 Mobile Navigation | en | NOT_RUN |  |  |  |  |
| S12 Not found and generic states | ar | NOT_RUN |  |  |  |  |
| S12 Not found and generic states | en | NOT_RUN |  |  |  |  |

### M-16

| Screen | Lang | Result | Who | Tool and version | Date | Finding |
| --- | --- | --- | --- | --- | --- | --- |
| S01 Sign-in | ar | NOT_RUN |  |  |  |  |
| S01 Sign-in | en | NOT_RUN |  |  |  |  |
| S07 Case Details: notifications and the draft form | ar | NOT_RUN |  |  |  |  |
| S07 Case Details: notifications and the draft form | en | NOT_RUN |  |  |  |  |

### M-17

| Screen | Lang | Result | Who | Tool and version | Date | Finding |
| --- | --- | --- | --- | --- | --- | --- |
| S02 My Work | ar | NOT_RUN |  |  |  |  |
| S02 My Work | en | NOT_RUN |  |  |  |  |
| S03 Case Portfolio | ar | NOT_RUN |  |  |  |  |
| S03 Case Portfolio | en | NOT_RUN |  |  |  |  |
| S04 Case Details: overview | ar | NOT_RUN |  |  |  |  |
| S04 Case Details: overview | en | NOT_RUN |  |  |  |  |
| S09 Notification Center | ar | NOT_RUN |  |  |  |  |
| S09 Notification Center | en | NOT_RUN |  |  |  |  |

### M-18

| Screen | Lang | Result | Who | Tool and version | Date | Finding |
| --- | --- | --- | --- | --- | --- | --- |
| S01 Sign-in | ar | NOT_RUN |  |  |  |  |
| S01 Sign-in | en | NOT_RUN |  |  |  |  |
| S02 My Work | ar | NOT_RUN |  |  |  |  |
| S02 My Work | en | NOT_RUN |  |  |  |  |
| S03 Case Portfolio | ar | NOT_RUN |  |  |  |  |
| S03 Case Portfolio | en | NOT_RUN |  |  |  |  |
| S04 Case Details: overview | ar | NOT_RUN |  |  |  |  |
| S04 Case Details: overview | en | NOT_RUN |  |  |  |  |
| S05 Case Details: events | ar | NOT_RUN |  |  |  |  |
| S05 Case Details: events | en | NOT_RUN |  |  |  |  |
| S06 Case Details: tasks | ar | NOT_RUN |  |  |  |  |
| S06 Case Details: tasks | en | NOT_RUN |  |  |  |  |
| S07 Case Details: notifications and the draft form | ar | NOT_RUN |  |  |  |  |
| S07 Case Details: notifications and the draft form | en | NOT_RUN |  |  |  |  |
| S08 Notification Preview | ar | NOT_RUN |  |  |  |  |
| S08 Notification Preview | en | NOT_RUN |  |  |  |  |
| S09 Notification Center | ar | NOT_RUN |  |  |  |  |
| S09 Notification Center | en | NOT_RUN |  |  |  |  |
| S10 Workspace Switcher | ar | NOT_RUN |  |  |  |  |
| S10 Workspace Switcher | en | NOT_RUN |  |  |  |  |
| S11 Mobile Navigation | ar | NOT_RUN |  |  |  |  |
| S11 Mobile Navigation | en | NOT_RUN |  |  |  |  |
| S12 Not found and generic states | ar | NOT_RUN |  |  |  |  |
| S12 Not found and generic states | en | NOT_RUN |  |  |  |  |
