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
| R-04 | Notification Operations Center; case Notifications tab | ar, en | 320 px; 640 px | The table caption is inside the scrolling table, so its second line is cut at the region edge (same as M1-15). Content is reachable by scrolling the region, so 1.4.10 passes; it is a visible defect. | LOW | `app/(platform)/notifications/_components/*`, case Notifications table | ROUTED → FE-009 (#82), with M1-15. DataTable's sticky caption already solves it on the UX tables |

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
