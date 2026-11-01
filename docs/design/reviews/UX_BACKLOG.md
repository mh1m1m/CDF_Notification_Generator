# UX improvement backlog (UXQA-19, V13-UX-010)

**Classification: SYNTHETIC-DATA REFERENCE IMPLEMENTATION.** Synthetic personas and `CDF-DEMO-2026-NNNN` cases only.

Serves REQ-QA-038 (PROMPT_B §22 UXQA-19, §21.10 "Evidence-Based UX Backlog"): a continuously maintained,
evidence-based backlog that converts verified defects into development tasks with reproducible evidence.

## Rules

- **Only verified items.** An item enters the backlog only with evidence: a findings-register row, a PR review, an
  open-issue row or a test. Opinions without a reproduction stay out.
- **One owner task per item.** Each item names the team and the board task that closes it. Paths follow the board's
  ownership: UX does not fix FE, QA, SEC or PROC paths; items on those paths are routed through ARCH.
- **Severity** (as the M1 register): HIGH blocks a gate, MEDIUM visible defect, LOW polish.
- **Priority** orders the work:
  - **P1**: MEDIUM on an M1 gate screen (QG-09 / Gate F, QG-08), with a fix ready or in review.
  - **P2**: LOW visible defect on an M1 screen, or a check that keeps a fixed defect fixed.
  - **P3**: consistency or debt with a user-visible effect, or a fix that waits on another task.
  - **P4**: blocked on an owner decision or a source; no work until it arrives.
- **Status**: OPEN · IN_REVIEW (a PR is up) · BLOCKED (waits on a decision or source) · DONE (merged, with sha). A DONE
  item stays in the table for one review cycle with its merge sha, then moves to the closed list.
- **Maintenance.** UX updates this file in every UX PR that adds, fixes or re-checks a finding, and after each design
  re-review. A routed item is re-checked on `develop` once its fix merges, and only then marked DONE.

## Sources

| Source | What it holds | Evidence |
| --- | --- | --- |
| `docs/design/reviews/M1_DESIGN_REVIEW.md` (V13-UX-007) | Findings M1-01 … M1-19 on the M1 screens, ar/en, 360–1920 px | #69 `f069850` (CI 41248768824); M1-15 … M1-19 #76 `e9cd74d` (CI 41255696874) |
| `docs/design/reviews/UX009_TEXT_RESIZE_REFLOW.md` (V13-UX-009) | R-01 … R-04: text resize 200 %, reflow at 320 px, text spacing (WCAG 1.4.4, 1.4.10, 1.4.12) | #96 (in review) |
| `docs/OPEN_ISSUES.md` | Open issues with a user-visible effect (OI-005, OI-027, OI-037, OI-039, OI-050) | `develop` `11fad34` |
| QA reviews of UX PRs (`docs/teams/qa/STATUS.md`) | Every QA CHANGES on a UX PR was fixed in that PR; QA lists no open defects. QA's notes that fall to UX are entered here (UXB-13 from #82; UXB-14 and UXB-15 from QA's review of #97) | `develop` `11fad34` |
| UXB-07 re-check (V13-UX-013) | UXB-01 … 05, 08, 14 re-measured after FE-009 and FE-010; new UXB-17, UXB-18 | `develop` `ca16cba`; method in `M1_DESIGN_REVIEW.md` "Re-check" |

## Backlog

Ordered by priority, then severity.

| ID | Item | Evidence | Reproduce | Sev. | Pri. | Owner (task) | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| UXB-01 | Notification Operations Center table is squeezed to the viewport: template codes break inside the identifier and are cut at the scroll-region edge; the caption is cut mid-word. Fix: minimum inline size, scroll inside the region, codes on one line (as M1-04 on `DataTable`). | M1-15 | Secretary Alpha, `/notifications`, ar, 360 px | MEDIUM | P1 | FE (V13-FE-009) | DONE: `961197e` (#82); re-checked by UXB-07 (V13-UX-013) on `develop` `ca16cba`: no page scroll at 320/360 px, table 1012 px inside a 288–328 px labelled region, codes on one line |
| UXB-02 | Notification dates and times are numeric in Arabic (`٢٠٢٦/١٠/٠٣، ١٢:٠٠ م`), not the long-month form. Fix: `components/format.ts`. The case Notifications tab is UXB-14. | M1-18 | Secretary Alpha, `/notifications`, ar | MEDIUM | P1 | FE (V13-FE-009) | DONE: `961197e` (#82); re-checked by UXB-07 (V13-UX-013) on `develop` `ca16cba`: `٣ أكتوبر ٢٠٢٦ في ١٢:٠٠ م` / `3 October 2026 at 12:00` |
| UXB-14 | The case Notifications tab still formats dates with its own `labels.ts` `dateTimeFormat` (Arabic shows `٠١‏/١١‏/٢٠٢٦، ٥:١٨ ص`, not the long-month form of DESIGN_SYSTEM §4), and its version column uses `numberFormat`, so the template version is Arabic-Indic instead of a Latin identifier in `bdi` (D10, as UXB-04). This is the M1-06 remainder left to FE; #82 fixed the Center only. | M1-06 and M1-17 on the case tab; QA review of #97 at `c24b31a`; `app/(platform)/cases/[caseId]/_components/CaseWorkspace.tsx:335` on `develop` `961197e` | Secretary Alpha, ar, `/cases/{0001}` Notifications tab | MEDIUM | P1 | FE (V13-FE-010, with UXB-05 and UXB-08; ARCH 1 Nov) | DONE: `21dbbaa` (#98, V13-FE-010); re-checked by UXB-07 (V13-UX-013) on `develop` `ca16cba`: `١ أكتوبر ٢٠٢٦ في ١٢:٠٠ م`; version `<bdi dir="ltr">1</bdi>` |
| UXB-16 | At 320 × 256 with the 1.4.12 text spacing, in English on `/notifications`, the current area link "Notification operations centre" (bold, kept on one line) reaches 321 of 320 px and the page scrolls inline. Its width depends on the font the browser has: 321 px in Liberation Sans, 294 px in Carlito. | UX-009 R-05; QA-010 #104, CI run 41266729412 (failed in the run and its retry) | Secretary Alpha, en, `/notifications`, 320 × 256, 1.4.12 spacing stylesheet, Liberation Sans or Arial metrics | MEDIUM | P1 | UX (V13-UX-012) | DONE: `aecd7ef` (#107, V13-UX-012); QA-010 font probe (Liberation Sans, DejaVu Sans, Carlito) passed |
| UXB-03 | Template code breaks at its hyphen (`CF-` / `20_INVESTIGATION_ASSIGNED`). | M1-16 | Secretary Alpha, `/notifications`, en, 768 px | LOW | P2 | FE (V13-FE-009) | DONE: `961197e` (#82); re-checked by UXB-07 (V13-UX-013) on `develop` `ca16cba`: `CF-24_MEETING_INVITATION` on one line (`nowrap`) at 768 px, en and ar |
| UXB-04 | Template version renders as `الإصدار ١`; under DESIGN_SYSTEM §6 D10 it is an identifier: Latin inside `<bdi dir="ltr">`. | M1-17 | Secretary Alpha, `/notifications`, ar | LOW | P2 | FE (V13-FE-009) | DONE: `961197e` (#82); re-checked by UXB-07 (V13-UX-013) on `develop` `ca16cba`: `<bdi dir="ltr">1</bdi>` |
| UXB-05 | The notification tables' caption sits inside the scrolling table, so its second line is cut at the region edge. Content stays reachable (1.4.10 passes); visible defect. `DataTable`'s sticky caption already solves it on the UX tables. | R-04 (UX-009) | Secretary Alpha, `/notifications` and case Notifications tab, ar and en, 320 px and 640 px | LOW | P2 | FE (V13-FE-010, after #82) | DONE: `21dbbaa` (#98, V13-FE-010); re-checked by UXB-07 (V13-UX-013) on `develop` `ca16cba`: the caption wraps inside the region's visible width at 320, 360, 640 and 768 px (Center and case tab, ar and en) |
| UXB-06 | Automate UX-009's six checks (no page-level inline scroll at 320 px and 200 %, no clipped text with the text-spacing override, tables scroll only in labelled regions …) so R-01 … R-03 stay fixed in the browser; `tests/unit/components/reflow.spec.ts` pins only the CSS. | UX-009 §4 | spec in UX009_TEXT_RESIZE_REFLOW.md §4 | LOW | P2 | QA (V13-QA-010) | DONE: `3d1376e` (#104, V13-QA-010) |
| UXB-07 | Re-run the M1 design review on UXB-01 … UXB-05 and UXB-14 once their fixes merge, using QA-005's screenshot library in place of the temporary capture; mark each item DONE with its sha. | M1 review "Next" | as each source row | LOW | P2 | UX (with QA-005) | DONE (V13-UX-013): own capture, as in UX-007, because QA-005's screenshot library is not built yet; method and figures in `M1_DESIGN_REVIEW.md` "Re-check" |
| UXB-08 | The case Notifications tab keeps FE's own table instead of `DataTable` (the rest of the Case Workspace moved in UX-008(c)), so it misses the shared minimum width, sticky caption and row ids, and can drift visually from the other tabs. | M1-11 remainder (#90 `f11e65a`, Notifications tab left alone by the brief) | `/cases/{0001}` Notifications tab vs Tasks tab, ar and en, 360 px | LOW | P3 | FE (V13-FE-010, with R-04; ARCH 1 Nov): on `DataTable` the tab gets the sticky caption, which also clears UXB-05 there | DONE: `21dbbaa` (#98, V13-FE-010); re-checked by UXB-07 (V13-UX-013) on `develop` `ca16cba`: the tab is a `DataTable` (row ids `case-notification-<id>`, 810/767 px table in a labelled region, caption in view) |
| UXB-13 | In the English UI the in-case preview frame is named "{Arabic event title} — design preview": an Arabic title inside an English sentence. Markup (`bdi`, `lang`) cannot go inside an attribute, so the bdi option is not available. Worse, `NotificationPreviewFrame` sets `lang="ar"` on the `<iframe>` element itself, and an element's `lang` also covers its attributes, so the English words "design preview" are tagged Arabic for screen readers. Recommendation: keep the Arabic title, because it is what identifies the notice. Drop `lang` and `dir` from the `<iframe>` element: the rendered document already declares `<html lang dir>` (`lib/notifications/render/platform.ts`, `email.ts`), so the frame's name then takes the page language. Add a unit test that the frame element carries no `lang`. | QA review of #82 (non-blocking, relayed by ARCH 1 Nov); `components/data/NotificationPreviewFrame.tsx` (`lang={lang}` on the iframe); call site `case.preview.frameTitle` in #82 head `830c26d` | Secretary Alpha, en, `/cases/{0001}` Notifications tab, open a preview; read the frame's accessible name and its language in the accessibility tree | LOW | P3 | UX (V13-UX-011, after #96): drop `lang`/`dir` on the iframe; unit tests: no `lang`/`dir` on the frame element, srcdoc still declares `lang="ar" dir="rtl"`; `sandbox=""`, srcdoc-only and the CSP unchanged. QA reviews; FE ACCEPTs if `app/**` changes | DONE: `ca16cba` (#100, V13-UX-011) |
| UXB-17 | The draft form on the case Notifications tab has unstyled controls: both selects and the "Create draft" button have no border and no background (computed `border: 0px`, `background: transparent`), so nothing marks them as controls (WCAG 2.2 SC 1.4.11 non-text contrast), the button reads as plain text, and the selects are 21–22 px tall (below SC 2.5.8's 24 px and the 44 px touch size of DESIGN_SYSTEM). At 320 px in Arabic the template select also cuts the start of its Latin code (`… IGATION_ASSIGNED`). The Center's filters on the same build are styled (1 px `#5E646B` border, filled Apply button). | Found by UXB-07 (V13-UX-013) on `develop` `ca16cba`; `app/(platform)/cases/[caseId]/notifications/_components/DraftForm.tsx` (`styles.form` from `case.module.css` sets layout only) | Secretary Alpha, `/cases/{0001}` Notifications tab, ar and en, 1280 px and 320 px; computed style of `draft-template`, `draft-recipient`, `draft-submit` | MEDIUM | P1 | UX, V13-UX-014 (shared form-control rule in `globals.css`; FE path-owner ACCEPT for the DraftForm hunks) | OPEN (V13-UX-014) |
| UXB-18 | The "Preview" link in the case Notifications table looks like plain text: `color: inherit`, no underline, normal weight, so it is told apart only by its column. Case numbers in the other tables are links too but bold. | Found by UXB-07 (V13-UX-013) on `develop` `ca16cba`; `case-notification-preview-link-<id>`; `styles/globals.css` `a { color: inherit }` | Secretary Alpha, `/cases/{0001}` Notifications tab, ar and en | LOW | P3 | UX, V13-UX-014 (one link-in-table-cell style in `globals.css`; FE path-owner ACCEPT for any FE hunk) | OPEN (V13-UX-014) |
| UXB-09 | Event and stage labels come from the Case Workspace's own maps (`labels.ts`), not the `lib/domain` catalogues; a code missing from one list shows as unknown on one screen and labelled on another. | OI-027 | compare an event code's label on the case Events tab with its catalogue entry | LOW | P3 | PROC (catalogues), then FE | BLOCKED (waits on PROC catalogues) |
| UXB-10 | The in-case preview of a restricted case (0009) fails closed for every persona, its team included, so the team sees the failure state instead of a preview. Correct fail-closed behaviour; the UX gap is that no persona can preview. | OI-050 | Secretary Alpha, `/cases/{0009}` Notifications tab, open a preview | LOW | P3 | ARCH (choose the read and its owner) | BLOCKED |
| UXB-11 | The case header stage is a plain label: no stage name from the journey catalogue (no new stage keys until the owner maps stages). | OI-039 (ARCH ruling, 1 Nov) | `/cases/{0001}` header | LOW | P4 | Owner (PROC brief V13-PROC-009) | BLOCKED (owner decision) |
| UXB-12 | Arabic text uses the documented fallback font stack, labelled SOURCE_REQUIRED; the brand Arabic font is not supplied. | OI-005 | any page, ar | LOW | P4 | Owner (font files and licence), then UX (`styles/tokens.css`) | BLOCKED (source) |
| UXB-15 | For four of the five notification recipient classes, opening the in-case preview shows the OI-037 state (`case-preview-unmapped`) instead of a preview frame; the recipient column itself shows the class label (M1-07). Migration 0004's codes do not match the disclosure policy's 13 classes, and the binding refuses every class without an exact match, which is correct fail-closed behaviour. | OI-037; QA review of #97 at `d7b7ad6`; Scenario E's OI-037 test (CASE_TEAM on 0001, COMMITTEE_MEMBERS on 0003) | Secretary Alpha, `/cases/{0001}` Notifications tab, open the preview of a CASE_TEAM row | LOW | P4 | Owner, via ARCH (REQ-GOV-014: disclosure rules) | BLOCKED (owner decision) |

## Ruled or accepted (not backlog)

| ID | Finding | Ruling |
| --- | --- | --- |
| M1-14 | Digits in the product name and in stored case titles | RULED (ARCH 31 Oct 23:00, DESIGN_SYSTEM §6 D10): shown as written |
| M1-19 | Native date inputs show `mm/dd/yyyy` in the Arabic UI (Chromium uses the browser locale) | NOTED (ARCH 31 Oct): accepted platform behaviour; labels are Arabic, values post as ISO |

## Closed

Fixed and re-checked on `develop`; evidence in the source register.

| Source | Items | Fixed by |
| --- | --- | --- |
| M1 review | M1-01, M1-02, M1-03 | #69 `f069850` (V13-UX-007) |
| M1 review | M1-04, M1-05, M1-06 (Portfolio, My Work), M1-13 | #85 `f45f192` (V13-UX-008(b)) |
| M1 review | M1-07 | #74 `a93fa61` (V13-FE-006 part 3) |
| M1 review | M1-08, M1-10 | #76 `e9cd74d` (V13-UX-008(a)) |
| M1 review | M1-06 (Case Workspace), M1-09, M1-11 (Case Workspace), M1-12 | #90 `f11e65a` (V13-UX-008(c)) |
| UX-009 | R-01, R-02, R-03 | #96 (in review; moves here on merge) |
