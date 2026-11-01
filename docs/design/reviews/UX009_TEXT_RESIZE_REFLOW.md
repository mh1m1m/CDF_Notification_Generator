# Text resize and reflow review (V13-UX-009)

**Classification: SYNTHETIC-DATA REFERENCE IMPLEMENTATION.** Synthetic personas and `CDF-DEMO-2026-NNNN` cases only.

Requirement: REQ-A11Y-010. WCAG 2.2 SC 1.4.4 Resize Text, 1.4.10 Reflow, 1.4.12 Text Spacing. Reviewer: QA (FE
ACCEPTs any `app/**` hunk; this PR has none).

## 1. Method

- Build: `develop` at `f11e65a` (after #90), production build (`pnpm build && pnpm start` through Playwright's web
  server), local PostgreSQL after `pnpm db:local start && pnpm db:reset`.
- Screens: Case Portfolio, My Work, Case Workspace (Overview, Recorded events, Tasks, Notifications; case
  `CDF-DEMO-2026-0001` or the persona's first case), Notification Operations Center, and the workspace switcher
  (open menu).
- Personas: Secretary Alpha (all pages), Governance Officer Delta (two workspaces: the switcher).
- Locales: Arabic RTL and English LTR (`v13_locale` cookie).
- Conditions (CSS px viewport, as the browser sees it):
  - **200% zoom**: 640 × 450 (1280 × 900 at 200%).
  - **Reflow**: 320 × 256 (1280 × 1024 at 400%).
  - **Text spacing**: the 1.4.12 override injected as a stylesheet (`line-height: 1.5`, paragraph spacing `2em`,
    `letter-spacing: 0.12em`, `word-spacing: 0.16em`, all `!important`), at 1280 × 900 and at 320 × 256.
- Per page and condition, a temporary Playwright capture (not committed) recorded a full-page screenshot, whether the
  page scrolls horizontally, every element outside the viewport (outside table scroll regions), every element that
  clips text (`overflow: hidden|clip` with `scrollWidth/Height` larger than its box), and every non-table element that
  scrolls inline. The skip link was focused and measured in each condition. 64 page captures plus 8 open-menu captures.

## 2. What passed

- **No two-dimensional page scroll** on any page, locale or condition (`scrollWidth == clientWidth` on all captures).
- **No clipped or overlapping text** at 200%, at 320 px, or with the text-spacing override, after R-01 and R-02. The
  screenshots were checked by eye for overlap.
- Data tables (Portfolio, My Work, case Tasks, case Notifications, Operations Center) scroll only inside their own
  focusable, labelled scroll region (`role="region"` named by the table caption). This is the exception 1.4.10 allows
  for content that needs two dimensions.
- The switcher menu stays inside the viewport at 320 px with the spacing override, and Escape closes it.
- The skip link, when focused, fits the viewport in every condition.

## 3. Findings

Severity: HIGH blocks the gate, MEDIUM visible defect, LOW polish. Status: FIXED (in this PR), ROUTED (owner team,
through ARCH).

| ID | Screen | Locale | Condition | Finding | Severity | Path | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| R-01 | Every platform page (area navigation) | ar, en | 320 px; 320 px + spacing | Under 768 px the area navigation was a row that scrolled inline: at 320 px "Notification operations centre" sat off-screen with no sign it was there (1.4.10). | MEDIUM | `styles/globals.css` (`.v13-side-nav`) | FIXED: the row wraps; no inline scroll. Pinned in `tests/unit/components/reflow.spec.ts` |
| R-02 | Case Workspace (tab row) | ar, en | 320 px; 320 px + spacing | The case tab row scrolled inline (M1-12's fix): at 320 px "Tasks" and "Notifications" were off-screen (1.4.10). | MEDIUM | `styles/globals.css` (`.v13-case-tabs`) | FIXED: the row wraps onto a second line; the open tab keeps its bar. Supersedes M1-12's scrolling row. Pinned in `reflow.spec.ts` |
| R-03 | Every page (skip link) | ar, en | all | The focused skip link had no width limit; it fitted in every condition, but nothing kept it so for longer strings. | LOW | `styles/globals.css` (`.v13-skip-link`) | FIXED (preventive): `max-inline-size: calc(100vw - 2 × space-3)`. Pinned in `reflow.spec.ts` |
| R-04 | Notification Operations Center; case Notifications tab | ar, en | 320 px; 640 px | The table caption is inside the scrolling table, so its second line is cut at the region edge (same as M1-15). Content is reachable by scrolling the region, so 1.4.10 passes; it is a visible defect. | LOW | `app/(platform)/notifications/_components/*`, case Notifications table | FIXED in V13-FE-010 (#98, `21dbbaa`): the case tab is a `DataTable` and the Center uses its caption pattern; re-checked V13-UX-013 (caption box = region box at 320 and 640 px, ar and en) |
| R-05 | Notification Operations Center (current area link) | en | 320 px + spacing | Found by QA-010's browser checks (#104, CI run 41266729412): the bold current link "Notification operations centre" kept one line (`white-space: nowrap`) and measured 321 px in a Liberation Sans / Arial-metric font, so the page scrolled by 1 px. With Carlito (this review's capture) it measured 294 px, so the review missed it. | MEDIUM | `styles/globals.css` (`.v13-side-nav-link`) | FIXED in V13-UX-012: the link wraps its own text (`overflow-wrap: anywhere`, `max-inline-size: 100%`, no `nowrap`). Pinned in `reflow.spec.ts`; QA-010's checks pass |
| R-06 | Case Workspace, Notifications tab (draft form) | ar, en | WebKit only: 320 px; 320 px + spacing; 640 px (en) | Found by QA's cross-browser run 41292116619 on #152: WebKit counts the template select's longest option label as scrollable overflow even though the select is clamped to the column, so the page scrolls inline. Chromium (this review's browser) clips a select's content by default, so §1 – §6 could not see it. | MEDIUM | `styles/globals.css` (`select.v13-control`) | FIXED in V13-UX-018 (UXB-20): `appearance: none` on the shared select rule, with a drawn chevron (inline end, `currentColor`) and the native arrow in forced colours; `overflow: clip` did not help (QA, #154). Pinned in `controls.spec.ts`; QA's WebKit run on #154 is the browser proof |

## 4. Spec for QA's a11y e2e check (QA owns `tests/a11y`)

One spec, Arabic and English, personas as in §1, after `pnpm db:reset`:

1. For each page in §1 and each condition — viewport 640 × 450; viewport 320 × 256; viewport 1280 × 900 and 320 × 256
   with the §1 spacing stylesheet added through `page.addStyleTag` — assert
   `document.documentElement.scrollWidth <= document.documentElement.clientWidth`.
2. At 320 × 256, assert every `[data-testid^="nav-"]` link and every `[data-testid^="case-tab-"]` link has a bounding
   box inside `0 … clientWidth` (R-01, R-02).
3. Outside `[data-scroll-region], .v13-scroll-region`, no visible element with text has `overflow` hidden or clip and
   `scrollWidth > clientWidth + 1` or `scrollHeight > clientHeight + 1`; skip `.v13-sr-only` and the unfocused skip
   link.
4. Every element that scrolls inline (`overflow-x: auto|scroll` with `scrollWidth > clientWidth`) is a scroll region
   with `role="region"`, an accessible name and `tabindex="0"`.
5. Focus the skip link (first Tab) at 320 × 256 with spacing: its box lies inside the viewport.
6. Open the switcher (Governance Officer Delta) at 320 × 256 with spacing: the menu's box lies inside the viewport;
   Escape closes it.

## 5. Re-check after M1 changes (V13-UX-016)

Pages that changed after this review were re-measured with the §1 conditions. The question was whether the newer
forms, pager, preview text and table-link styles keep the reflow, resize and text-spacing results of §2.

### Method

- **Build:** `develop` at `cfb82be` (after #128 UX-014, #131's base, #135 UX-015 and FE-013's pager), as a production
  build on a local PostgreSQL after `pnpm db:reset`. 26 extra synthetic drafts were created through the page, so that
  case `CDF-DEMO-2026-0001` has a second Notifications page.
- **Persona and locales:** Secretary Alpha, in ar and en.
- **Conditions:** 640 × 450 (200%), 320 × 256, and the 1.4.12 spacing stylesheet at 1280 × 900 and at 320 × 256.
- **Font probe:** each 320 px condition was run in the default font and again with Carlito, Liberation Sans and
  DejaVu Sans forced, as QA-010 does. The 1-px R-05 overflow only showed in one font.
- **States:**
  - Case Workspace: Overview, Recorded events, Tasks, and Notifications pages 1 and 2 (the `ListPager`, with the
    draft form).
  - The plain-text details of a notification preview.
  - The Notification Operations Center, with filters.
  - Case Portfolio, with filters.
  - My Work, with a task's status form open.
- **Checks:** §4 checks 1, 3 and 4 were run in a temporary Playwright capture (not committed), plus a screenshot of
  every state at 320 px. A closed `<select>` whose option text is wider than its box was also flagged, then checked by
  eye.

### Results

- **No new defect.** The page never scrolls inline. No text is clipped outside a labelled scroll region. Every
  element that scrolls inline is a labelled, focusable region. This holds on every state, locale, condition and font
  above.
- **Draft form template select.** At 320 px in Arabic, the closed select cuts the start of its Latin code. This is
  UXB-19, which was already known. V13-FE-016 (#131) shows the selected code as text under the select. Its UX browser
  check at `7c604f0` (ar and en; 320 px with and without spacing; all four fonts; 1280 px) found no page scroll and no
  clipping, with the code wrapping inside `<bdi dir="ltr">` (UX review ACCEPT on #131).
- **My Work status select.** It was flagged by the select heuristic. That was a false positive: a select is as wide as
  its widest option, and the screenshots show its text fits.
- **Preview plain text.** The `<pre>` wraps inside its box at every width:
  - 286 px at 320;
  - 606 px at 640;
  - 1,006 px at 1,280.

  With spacing at 320 px, the notification reference `NTF-DEMO-…` breaks at its hyphen. That wrap is needed there, and
  nothing is lost.
- **Next Action Card:** checked after #141 merged; see §6.

## 6. Next Action Card on the Overview (V13-UX-017)

FE-015 (#141) placed the card first on the Case Workspace Overview. QA's browser test (#150, merged as `8536e7e`)
checks that the card is first in the overview, before the stage card, and that it causes no inline scroll at 320 px in
ar and en. This check adds the other conditions: 200% zoom and 1.4.12 text spacing.

### Method

- **Build:** `develop` at `0a0c955`, as a production build on a local PostgreSQL after `pnpm db:reset`. No extra data
  was created.
- **Personas and cases:** cards found by visiting every seeded case each persona can open.
  - Secretary Alpha has a card on cases 0001, 0003, 0004, 0007 and 0008. Case 0001 was measured: "Schedule
    interview" / "جدولة المقابلة", status open, due in 9 days.
  - Investigator Beta has a card on 0001, 0003, 0005, 0006 and 0009. Case 0001 was measured: "Collect documents",
    a recorded "In progress" badge, due in 4 days.
- **Locales:** ar and en.
- **Conditions:** 640 × 450 (200%), 320 × 256, and the 1.4.12 spacing stylesheet at 1280 × 900 and at 320 × 256. Each
  320 px condition ran in four fonts: the default, Carlito, Liberation Sans and DejaVu Sans.
- **Checks:** a temporary Playwright capture (not committed) ran §4 checks 1, 3 and 4 on the page and on every element
  inside the card, and took a screenshot of the card. 40 captures.

### Results

- **No defect.**
- **Page:** the page never scrolls inline. `scrollWidth` equals `clientWidth` in all 40 captures.
- **Card box:** the card stays inside the content column.
  - At 320 px: 16 to 304 px (288 px wide).
  - At 640 px: 608 px wide.
  - At 1,280 px: 1,008 px wide.
- **Clipping:** no element in the card is clipped or scrolls inline. The one hidden span is the badge's
  `.v13-sr-only` "recorded" text, which is hidden on purpose and is skipped by §4 check 3.
- **Title:** it wraps instead of overflowing. "Collect documents" takes two lines at 320 px with spacing in DejaVu
  Sans. The card grows to fit it (287–292 px tall).
- **Status and due date:** the rows wrap under their labels. The day count stays on its own line.
- **Spacing gap:** with the spacing stylesheet, the 2em paragraph spacing adds a gap under the title. That is the
  override's own effect, and nothing overlaps.
