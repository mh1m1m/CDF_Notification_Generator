# M1 design review (V13-UX-007)

**Classification: SYNTHETIC-DATA REFERENCE IMPLEMENTATION.** Synthetic personas and `CDF-DEMO-2026-NNNN` cases only.

Serves M1's exit gates QG-09 / Gate F (Arabic RTL, UX + QA) and the keyboard part of QG-08. Reviewer: QA.

## Method

- Build: `develop` at `f5a8fba` (after #50), production build (`pnpm build && pnpm start`), local PostgreSQL after
  `pnpm db:local start && pnpm db:reset`.
- Screens: Case Portfolio (`/portfolio`), My Work (`/my-work`), Case Workspace (`/cases/{id}` and its Events, Tasks and
  Notifications tabs, case `CDF-DEMO-2026-0001`), Workspace Switcher (shell menu and `/workspaces`).
- Personas: Secretary Alpha (portfolio, my work, case), Investigator Beta (my work), Governance Officer Delta (two
  workspaces: switcher menu and `/workspaces`).
- Locales: Arabic RTL (default) and English LTR (`v13_locale` cookie). Widths: 360, 768, 1280 and 1920 px.
- Per screen, a temporary Playwright capture (not committed) recorded a full-page screenshot, `dir`/`lang`, page
  `scrollWidth` against the viewport, elements outside the viewport (outside scroll regions), Latin and Arabic-Indic
  digit runs, and the Tab order with whether each stop draws a focus ring. QA-005 screenshots did not exist for these
  screens yet, so the review used the local app.
- Spec references: `docs/design/SCREENS.md` (S1–S3, S5), `docs/design/DESIGN_SYSTEM.md` §2 frame, §5 RTL rules, §4
  dates (`components/format.ts`).
- Notification Operations Center (S4): reviewed on `develop` `9290778` after #61 (Secretary Alpha, Governance Officer
  Delta; Investigator Beta gets the unknown-route 404, ruling D6). Rows M1-15 to M1-19.

## What passed

- `dir="rtl" lang="ar"` and `dir="ltr" lang="en"` on every screen; every page answered 200.
- No page-level horizontal scroll at any of the four widths, either locale (`scrollWidth == viewport` on all 64
  captures). Wide tables scroll inside their focusable scroll region.
- Tab order follows reading order on every screen at 360 and 1280 px: skip link → locale toggle → workspace switcher
  (when there are two workspaces) → sign out → navigation → page controls → table links and row actions. Every stop
  drew a visible focus ring (0 stops without one).
- Status glyphs (✓, lock) are not mirrored; the switcher chevron and menu read correctly in both directions.
- Counts, dates and task numbers use Arabic-Indic digits in Arabic and Latin digits in English; case numbers stay Latin
  in both.

## Findings

Severity: HIGH blocks the gate, MEDIUM visible defect, LOW polish. Status: FIXED (in this PR), ROUTED (sent to the
owner team through ARCH, with the task that closes it), RULED (an open rule ARCH has now decided).

| ID | Screen | Persona | Locale | Viewport | What is wrong | Severity | Owner path | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| M1-01 | All platform pages | All | ar, en | all | Platform navigation (`.v13-nav-list`) had no styles: three bare stacked links running into the page heading, no touch-size targets, no separation. | MEDIUM | `styles/globals.css` | FIXED (interim row of links; see M1-10 for the frame) |
| M1-02 | Workspaces page | Governance Officer Delta | ar, en | all | `.v13-card-list` / `.v13-card` had no styles: workspace options were bare text, the current workspace was not distinguishable except by the word "Current". | MEDIUM | `styles/globals.css` | FIXED (card grid, current card marked) |
| M1-03 | Workspace switcher menu | Governance Officer Delta | ar, en | 360 | The open menu panel (16rem, anchored to the inline end of the button) crossed the viewport edge (measured 143–399 px on a 360 px viewport in RTL). | MEDIUM | `styles/globals.css` | FIXED (under 768 px the panel joins the flow under its button; now 16–344 px) |
| M1-04 | My Work | Secretary Alpha, Investigator Beta | ar, en | 360 | The table is squeezed to the viewport: case numbers break over four lines (`CDF-` / `DEMO-` / `2026-` / `0003`), titles wrap word by word. DESIGN_SYSTEM §5: case numbers never truncate or break. The table should keep a minimum width and scroll inside its region, and the case number cell should not wrap (Portfolio already does `nowrap`). | MEDIUM | `app/(platform)/my-work/_components/my-work.module.css` | FIXED in V13-UX-008(b) (DataTable: table min-inline-size 40rem inside the scroll region, case numbers `nowrap`, caption sticky at the region's visible width; checked at 360/768/1280 in ar and en, no page scroll) |
| M1-05 | Case Portfolio | Secretary Alpha | ar | 360 | Title column wraps word by word; the case number takes most of the width. Same fix as M1-04 (table minimum inline size inside the scroll region). | LOW | `app/(platform)/portfolio/_components/*.module.css` | FIXED in V13-UX-008(b) (as M1-04; the title cell keeps a 12rem minimum so it wraps by phrase) |
| M1-06 | Portfolio, My Work, Case Workspace | All | ar | all | Dates render numerically (`٢٠٢٦/٠٢/٠٢`) in Arabic and as `2 Feb 2026` in English. DESIGN_SYSTEM §4: Gregorian, Riyadh time, long month (`٢٠ أكتوبر ٢٠٢٦`) through `components/format.ts`. FE's `labels.ts` builds its own `Intl.DateTimeFormat` (`dateStyle: "medium"`; date-only values in UTC, date-times in Riyadh). | MEDIUM | `app/(platform)/cases/[caseId]/_components/labels.ts` | FIXED in V13-UX-008(b) (Portfolio, My Work) and V13-UX-008(c) (Case Workspace header, events and tasks), all through `components/format.ts`. The case Notifications tab is left to FE (UX-008 brief; same as M1-18 → FE-009) |
| M1-07 | Case Workspace, Notifications tab | Secretary Alpha | ar | all | Raw codes in the Arabic UI: status `DRAFT`, recipient class `CASE_TEAM`; the template shows only its code `CF-20_INVESTIGATION_ASSIGNED`. Needs i18n labels (template code can stay as a secondary line). | MEDIUM | `app/(platform)/cases/[caseId]/_components/CaseWorkspace.tsx`, `lib/i18n` (FE namespaces) | FIXED in V13-FE-006 part 3 (#74, merged as `a93fa61`): status and recipient class labels, template name beside its code |
| M1-08 | Case Workspace (all tabs) | Secretary Alpha | ar, en | all | Breadcrumb has no separator (`محفظة القضايا CDF-DEMO-2026-0001` reads as one phrase) and no `aria-current`. The shell `Breadcrumbs` component draws the mirrored separator. | MEDIUM | `app/(platform)/cases/[caseId]/_components/CaseWorkspace.tsx` | FIXED in V13-UX-008(a) (shell TopBar + SideNav with aria-current; shell Breadcrumbs) |
| M1-09 | Case Workspace, Overview | Secretary Alpha | ar, en | all | "My open tasks in this case" appears twice (table caption and heading); the "Latest recorded events" block has no list styling. | LOW | `app/(platform)/cases/[caseId]/_components/CaseWorkspace.tsx` | ROUTED → FE-009 |
| M1-10 | All platform pages | All | ar, en | all | The platform layout still uses the foundation's session-bar form of `AppShell` with an interim nav list, not the specified frame (TopBar + SideNav, DESIGN_SYSTEM §2). Consequences: the active workspace shows twice (the "Active workspace" fact and the switcher), at 360/768 sign-out wraps to its own row, and the nav marks no current page (`aria-current="page"` missing). | MEDIUM | `app/(platform)/layout.tsx`, `app/(platform)/_components/PlatformNav.tsx` | FIXED in V13-UX-008(a) (shell TopBar + SideNav with aria-current; shell Breadcrumbs) |
| M1-11 | Portfolio, My Work, Case Workspace | All | ar, en | all | The FE screens build their own tables, tabs, case header and badges with CSS modules instead of the UX library (`DataTable`, `CaseTabs`, `CaseHeader`, `Breadcrumbs`, `StatusBadge`, `DeadlineText`). This is the common cause of M1-04 to M1-09 and of visual drift between screens (e.g. the "Assigned to you" chip on the Tasks tab is a plain bordered box). | MEDIUM | `app/(platform)/**` | FIXED in V13-UX-008(b) (Portfolio, My Work) and V13-UX-008(c) (Case Workspace: `CaseWorkspace`, `CaseHeader`, `CaseTabs`, `Timeline`, `DataTable`, `StatusBadge`). The case Notifications tab keeps FE's table (left alone by the brief) |
| M1-12 | Case Workspace, tab row | Secretary Alpha | en | 360 | The tab row wraps ("Notifications" drops to a second line). The `CaseTabs` component scrolls the row instead. | LOW | `app/(platform)/cases/[caseId]/_components/case.module.css` | FIXED in V13-UX-008(c) (`CaseTabs` scrolls the row; one row at 360/768/1280 in ar and en) |
| M1-13 | Portfolio | Secretary Alpha | ar, en | 1280, 1920 | Records-state cell for a closed case stacks the lock glyph above the word "Closed" instead of inline. | LOW | `app/(platform)/portfolio/_components/*.module.css` | FIXED in V13-UX-008(b) (glyph and word inline, `nowrap`) |
| M1-14 | Shell and case titles | All | ar | all | Digits in Arabic text that is neither a count nor an identifier: the product name `الإصدار 13 المؤسسي` uses Latin `13`; synthetic case titles use Arabic-Indic (`قضية تجريبية ٠٠٠١`) next to the Latin case number. DESIGN_SYSTEM §5 covers counts (Arabic-Indic) and display numbers (Latin) but not a version number in a name or a number inside a title. | LOW | `lib/i18n/common` (product name), seed titles | RULED (ARCH 31 Oct 23:00, DESIGN_SYSTEM §6 D10): product name and stored titles are shown as written; no change |
| M1-15 | Notification Operations Center | Secretary Alpha | ar | 360 | The table is squeezed to the viewport. Template codes break inside the identifier (`CF-` / `20_INVESTIGATION_ASSIGNED`) and are cut at the scroll-region edge. The caption is cut mid-word. Same cause as M1-04/M1-05: the table needs a minimum inline size and should scroll inside its region, with codes kept on one line. | MEDIUM | `app/(platform)/notifications/_components/center.module.css` | ROUTED → FE-009 |
| M1-16 | Notification Operations Center | Secretary Alpha | en | 768 | The template code breaks at its hyphen (`CF-` / `20_INVESTIGATION_ASSIGNED`). | LOW | `app/(platform)/notifications/_components/center.module.css` | ROUTED → FE-009 |
| M1-17 | Notification Operations Center | Secretary Alpha | ar | all | The template version renders as `الإصدار ١`. Under D10 a template version is an identifier, so it should be Latin inside `<bdi dir="ltr">`. | LOW | `app/(platform)/notifications/_components/NotificationCenterView.tsx` | ROUTED → FE-009 |
| M1-18 | Notification Operations Center | Secretary Alpha | ar, en | all | Dates and times are numeric in Arabic (`٢٠٢٦/١٠/٠٣، ١٢:٠٠ م`), unlike the long-month form in DESIGN_SYSTEM §4. This is the same issue as M1-06, on FE's page. | MEDIUM | `app/(platform)/notifications/**` | ROUTED → FE-009 |
| M1-19 | Notification Operations Center, date filters | Secretary Alpha | ar | all | The native date inputs show `mm/dd/yyyy` in the Arabic UI. Chromium formats `<input type="date">` by the browser locale, not the page `lang`. This is accepted platform behaviour; the labels are Arabic and the value posts as ISO. Noted for QA. | LOW | none | NOTED (ARCH 31 Oct: accepted platform behaviour) |

## Next

- Re-run this review on the routed findings when FE's fixes land; QA-005's screenshots replace the temporary capture.
