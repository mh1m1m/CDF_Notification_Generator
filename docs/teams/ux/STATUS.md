# UX status — CDF V13 Enterprise (synthetic data only)

Updated: 2026-11-01 · Branch: `feature/V13-UX-015-next-action-card` · Base: `develop` `772e26d`

## Completed
- V13-UX-004: information architecture, screen specs, design-system spec and strings (`docs/design/`). PR #4. DONE.
- V13-UX-001: token source `styles/tokens.css` and semantic `globals.css`. PR #8. Merged.
- V13-UX-002: shell components (`components/shell/`), `Count`, icons, `shell` strings, shell styles. PR #14, QA ACCEPT
  `dd00ccc`, merged into `develop` as `40901f3`.
- V13-UX-003: data components (`components/data/`), formatting helpers, common strings, data styles. PR #16, QA
  re-confirmed after the badge reflow fix, merged into `develop` as `78b278f`.

## In progress: V13-UX-005 (swap in the shell's WorkspaceSwitcher menu)
- `app/(platform)/layout.tsx` renders `components/shell/WorkspaceSwitcher` (in-place menu, options post to
  `switchWorkspace`) instead of FE's link-only switcher; FE's `_components/WorkspaceSwitcher.tsx` is removed. The
  options come from `app/(platform)/_components/workspace-options.ts`: switchable memberships with name and roles; an
  active workspace that is not switchable is shown alone as text. `app/**` rides this PR by ARCH's prior agreement;
  FE posts `REVIEW: ACCEPT` for that part, QA reviews the PR.
- `Disclosure` now closes when an item is chosen (submit or link): the TopBar survives client-side navigation, and
  the menu stayed open over the next page (found by the new e2e).
- Test ids as SCREENS.md S5. Scenario C: its one `workspace-switcher-open` step now opens the menu and follows
  `workspace-menu-all` to `/workspaces`; Beta's negative asserts no menu link and no menu option. Everything else is
  unchanged. New `tests/e2e/shell-workspace-menu.spec.ts`: switch both ways from the menu, the menu closes after a
  switch, keyboard Enter/Escape with focus return, one `workspace-switcher` per page and no page ids in the menu.
- Local, after `pnpm db:local start` + `pnpm db:reset`: lint, typecheck, format, build pass; unit 60 files 1564;
  test:db 22 files 372; e2e 104 passed. (Without `db:local start` the app cannot reach the database and the
  negative-persona and switch e2e fail on develop too; that is the environment, not the code.)

## QA CHANGES on #14 at `1b0f29c` (28 Oct), fixed 31 Oct
1. Workspace menu option buttons no longer carry `aria-label`; a visually hidden verb precedes the visible name and
   role, so the accessible name contains the visible label (WCAG 2.5.3). Tests: no `aria-label`, verb before name.
2. Menu test ids renamed to `workspace-menu-option-<CODE>`, `workspace-menu-current`, `workspace-menu-all`, so they
   never collide with FE's `/workspaces` page ids (`workspace-option-<CODE>`, `workspace-current`). Test: the menu
   renders none of the page ids. SCREENS.md S5 and DESIGN_SYSTEM.md §2 updated. This changes the UX-004 spec ids;
   ARCH ruling requested.
3. `case-identity.ts` now uses the contract's `UUID_PATTERN` and `CASE_NUMBER_PATTERN`. Negative tests: upper-case
   UUID, non-RFC-9562 UUID, `CDF-PROD-…` and `CDF-DEMO-2025-…` refs are refused.

## Changed files (V13-UX-002)
- `components/shell/*` (new: `Breadcrumbs`, `CaseHeader`, `CaseTabs`, `CaseWorkspace`, `Disclosure`, `PageHeading`,
  `PersonaMenu`, `SideNav`, `TopBar`, `WorkspaceSwitcher`, `case-identity`; changed: `AppShell`, `SyntheticBanner`)
- `components/data/Count.tsx`, `components/icons/index.tsx`, `components/format.ts`
- `lib/i18n/shell/{ar,en}.ts`, `lib/i18n/common/{ar,en}.ts` (records state)
- `styles/globals.css` (shell section)
- `tests/unit/components/shell.spec.tsx`
- `docs/design/DESIGN_SYSTEM.md` §2 (as built), `docs/design/STRINGS.md` (as built), this file

## Test evidence (V13-UX-002, local, 31 Oct after the QA fixes and the develop `a6c224a` merge)
| Command | Result |
| ------- | ------ |
| `pnpm lint` | pass (logical-css: 34 files) |
| `pnpm typecheck` | pass |
| `pnpm format:check` | pass |
| `pnpm test` | 34 files, 768 tests passed |
| `pnpm build` | pass |
| `PW_CHROMIUM_PATH=/opt/pw-browsers/chromium pnpm test:e2e` | 81 passed |
| Keyboard check (local Chromium, temporary preview page, not committed) | Enter opens the switcher; Arrow Down moves through the options and then the page link; Escape closes it and focus returns to the switcher; the breadcrumb chevron is mirrored in Arabic and not in English |

## Test evidence (V13-UX-003, local, 31 Oct after merging develop `40901f3` and the badge reflow fix)

The earlier merge brought develop's `lib/domain` badge module. `StatusBadge` takes its completed class from
`COMPLETED_CLASS_STATUSES` (11 statuses, ARCH 28 Oct 03:50), the list the Truth Inspector uses, instead of its own copy.

| Command | Result |
| ------- | ------ |
| `pnpm lint` · `pnpm typecheck` · `pnpm format:check` · `pnpm build` | pass |
| `pnpm test` | 45 files, 1063 tests passed |
| `pnpm db:reset` then `pnpm test:db` | 19 files, 352 tests passed (a run straight after e2e, without a reset, failed 18 on leftover e2e state; ARCH's reset-first rule) |
| `pnpm db:reset` then `PW_CHROMIUM_PATH=/opt/pw-browsers/chromium pnpm test:e2e` | 92 passed |
| Badge reflow, local Chromium at 375 px on the built CSS (temporary page, not committed) | badge 343 px, no sideways scroll, ar and en |
| axe-core (WCAG 2.0/2.1/2.2 A and AA), 28 Oct, temporary preview page, not committed | 0 violations: Arabic light, English light, Arabic dark |
| QA's `checkTruth` over the rendered markup (unit test) | no violation, apart from one planted wrong-status badge, which it reports as T4 |

## QA CHANGES on #16 at `cfab726` (31 Oct), fixed
- `.v13-badge` had `white-space: nowrap`; a long English conditional badge was 424 px wide at 375 px (WCAG 1.4.10).
  The badge now wraps (`max-inline-size: 100%`, `overflow-wrap: anywhere`, the text span may shrink), the glyph stays
  whole on the first line, and the corner radius is half the one-line height, so a wrapped badge does not clip its
  text. Checked with local Chromium at 375 px on the built CSS (temporary page, not committed): badge 343 px, no
  sideways scroll, ar and en. Unit tests pin the rule.

## Conditions recorded from ARCH (31 Oct)
- Test ids ruling CONFIRMED: menu `workspace-menu-*`, `/workspaces` page `workspace-option-<CODE>` /
  `workspace-current`. Whichever PR swaps FE's switcher for the shell menu must, in the same PR and with QA, update
  Scenario C's `workspace-switcher-open` selector and leave exactly one `data-testid="workspace-switcher"` per page.
- Run `pnpm db:reset` before every local `pnpm test:e2e` (CI e2e runs on a migrated, seeded database since #36).

## V13-UX-006: NotificationPreviewFrame (IN_REVIEW once its PR is open; QA, plus SEC for the sandbox and CSP)
- `components/data/NotificationPreviewFrame.tsx` (server component), `common.preview.caption`, preview styles,
  `tests/unit/components/preview-frame.spec.tsx` (real renderer output from the demo builder, e-mail and platform, ar
  and en; sandbox empty, no `src`, srcdoc round-trips exactly, nothing injected into the page, refusals log no
  content, type-only imports from `lib/notifications`).
- CSP check (local Chromium, 31 Oct, throwaway page served with the exact `pageContentSecurityPolicy` of
  `lib/http/csp.ts`, not committed): all four documents render in `about:srcdoc`, the renderer's inline styles apply
  (marking background set), headings present, no `securitypolicyviolation`; a script and an `onerror` handler in a
  hostile document never ran (Chromium: "Blocked script execution … sandboxed"). Firefox and WebKit not installed here.
  No CSP change needed. The committed e2e under the page policy belongs with FE-006's page (FE DESIGN §13): the demo
  builder cannot be imported by Playwright's loader (JSON imports need import attributes).

## V13-UX-007: M1 design review (IN_REVIEW once its PR is open; reviewer QA)
- Review of Case Portfolio, My Work, Case Workspace (four tabs) and the Workspace Switcher in Arabic RTL and English LTR
  at 360, 768, 1280 and 1920 px: `docs/design/reviews/M1_DESIGN_REVIEW.md` (14 findings).
- Fixed in UX paths (`styles/globals.css`): M1-01 platform nav list, M1-02 workspace cards, M1-03 switcher menu panel
  inside the viewport under 768 px.
- Routed through ARCH: M1-04, 05, 06, 08, 10–13 → V13-UX-008 (next, after #69); M1-07 → FE-006 part 3; M1-09 →
  FE-009. M1-14 ruled by ARCH (31 Oct 23:00), recorded as DESIGN_SYSTEM §6 D10.
- Notification Operations Center (S4) waits for #61.
- Evidence: temporary local Playwright capture (not committed), 64 page captures plus 4 open-menu captures, every page
  200, no page-level horizontal scroll, every Tab stop with a visible focus ring.

## V13-UX-008(a): platform frame. PR #76, merged into `develop` as `e9cd74d`
- `app/(platform)/layout.tsx` uses the AppShell frame form: TopBar (WorkspaceSwitcher, PersonaMenu with sign-out) and
  the role-aware SideNav with `aria-current="page"` (client `SideNavAuto`, `usePathname`; case pages mark no area).
- Case pages use the shell Breadcrumbs (mirrored separator, `aria-current`), keeping `case-crumb-portfolio`.
- Closes M1-08 and M1-10; the interim `.v13-nav-list` styles (M1-01) are removed. S4 rows M1-15 to M1-19 registered.
- ARCH agreement (31 Oct 23:19): one line in `tests/e2e/smoke.spec.ts` opens the persona menu before sign-out.

## V13-UX-008(b): Portfolio and My Work on the shared components. PR #85, merged into `develop` as `f45f192`
- Both tables on `DataTable` (case scope: `data-case-id`/`data-case-ref` per row, new `captionId`, `rowTestId`,
  `rowData`, `tableData`, per-column `cellData`; only `data-*` attributes pass, checked at render). Every e2e test id kept.
- Dates through `components/format.ts` (long month, Riyadh). My Work due dates on `DeadlineText`, which now also takes
  the server's `{date, days}` (no client clock).
- My Work task status (ARCH ruling, 1 Nov): an event-backed status is the `StatusBadge` recorded variant
  (`data-epistemic="recorded"`, `data-event-id`, `data-task-status` kept); an untouched OPEN task stays a plain span with
  no epistemic claim. `StatusBadge` `evidence.recordedAt` is optional: without it the badge says "recorded" and shows no
  time. `StatusBadge` takes extra `data-*` attributes that never override its own.
- Layout: table minimum 40rem inside the scroll region, sticky caption at the region's visible width, case numbers and
  glyph + word cells `nowrap`, scroll region is the containing block for screen-reader text (it had widened the page at
  360 px). Closes M1-04, M1-05, M1-13; M1-06 and M1-11 partly (Case Workspace in (c)).
- Tests: unit 1,925/1,925 (new: undated recorded badge in ar and en; data passthrough and refusal), lint, typecheck,
  e2e 194/194 locally. Visual check at 360/768/1280 in ar and en with a scratch spec (deleted): no page scroll, caption
  inside the region, no broken case numbers.

## V13-UX-008(c): Case Workspace on the shared components. PR #90, merged into `develop` as `f11e65a`
- Overview, Recorded events and Tasks use `CaseWorkspace`, `Breadcrumbs`, `CaseHeader`, `CaseTabs`, `Timeline`,
  `DataTable` and `StatusBadge`; dates through `components/format.ts`. The Notifications tab is unchanged (brief).
- `CaseHeader`: `stageCode` (data-stage), `capacityCode` (data-capacity, with a "no recorded capacity" line when
  null), closed notice is `role="note"`. The stage is the plain label: the case read has no event for it.
- `Timeline`: an entry's `status` is optional. The event read has no status field, so case events are records only:
  no badge, no data-epistemic, data-status-kind or data-status (as before). Entries take a test id, data-* and a
  details line (actor, provenance). Ruling asked of ARCH (option A recommended and built; B = add to_status to the read).
- Recorded task statuses on `StatusBadge` without a time, an untouched OPEN task a plain span (same rule as My Work).
- Closes M1-06, M1-11 and M1-12 (Notifications tab excepted). M1-09 stays with FE-009.
- FE CHANGES 9713e07: `case-title`, `case-event-occurred` and `case-event-recorded` restored (CaseHeader title id;
  Timeline `timeTestIds`, `alwaysShowOccurred` so both times show as before). DataTable `captionVisuallyHidden`
  (ARCH ruling: #90 before FE-009 #82); the Overview's task table uses it, so "My open tasks in this case" is shown
  once (M1-09, QA decides). Unit 1,992/1,992, e2e 227/227 locally.
- QA note on #85: table data was 12 px (Body 2); now the body size like the Notification Center, secondary lines
  Body 1. Checked in Arabic at 360 px (16 px cells, no page scroll). DESIGN_SYSTEM DataTable row updated.
- Tests: unit 1,972/1,972 (new: record-only Timeline entries, data refusal, CaseHeader codes and no-capacity line,
  closed notice role), lint, typecheck, format, e2e 224/224 locally. Visual check at 360/768/1280 in ar and en
  (overview, events, tasks, closed case): no page scroll, tab row on one line, no broken case numbers.

## V13-UX-009: text resize and reflow (REQ-A11Y-010). PR #96, QA ACCEPT `cb2c5ee`, CI 41264584584, merged into `develop` as `68a42b9`
- Review of the five M1 screens in ar and en at 200% zoom, 320 px and with the WCAG 1.4.12 spacing override:
  `docs/design/reviews/UX009_TEXT_RESIZE_REFLOW.md` (4 findings). No two-dimensional page scroll anywhere; tables
  scroll only inside their labelled regions.
- Fixed in `styles/globals.css`: R-01 area navigation and R-02 case tabs wrap instead of scrolling (nothing off-screen
  at 320 px), R-03 skip link width limit. R-04 (caption inside the scrolling table) → FE (V13-FE-010, after #82).
- `tests/unit/components/reflow.spec.ts` pins R-01 to R-03 and the no-clipping rules (fails on the old stylesheet).
- Spec for QA's a11y e2e in the register §4 (V13-QA-010). M1-09 recorded FIXED by #90; M1-12 now wraps (R-02).

## V13-UX-010: UX improvement backlog (UXQA-19, REQ-QA-038). PR #97, QA ACCEPT `745acdd`, merged as `2bccba2`
- `docs/design/reviews/UX_BACKLOG.md`: 15 open items (UXB-01 … UXB-15) with evidence, reproduction, severity,
  priority, owner task and status; ruled and closed findings listed. QA CHANGES at `c24b31a` and `d7b7ad6` fixed in
  `d7b7ad6` and `745acdd` (UXB-14 case-tab dates and version, #82 statuses, UXB-15 OI-037 replaces the preview).

## V13-UX-011: preview frame named in the page language (UXB-13). PR #100, FE and QA ACCEPT `f748c53`, CI 41270730010, merged as `ca16cba`
- `components/data/NotificationPreviewFrame.tsx`: no `lang` or `dir` on the `<iframe>` element. Its `lang` also
  covered the `title`, so "— design preview" in the English UI was tagged Arabic. The document inside keeps its own
  `<html lang dir>` from the renderer. The `lang` prop is removed; FE's call site in `CaseWorkspace.tsx` drops it (one
  line). `sandbox=""`, srcdoc-only, the refusals and the CSP are unchanged.
- Tests: `tests/unit/components/preview-frame.spec.tsx` (no `lang`/`dir` on the frame element, the srcdoc still
  declares them, an Arabic notice on an ar and an en page) and FE's `tests/unit/server/notification-preview.spec.tsx`
  (the same on the case tab's preview). 7 of 49 fail on the old component, 49 pass now.

## V13-UX-012: current area link wraps (UXB-16, UX-009 R-05). PR #107, QA ACCEPT `a2cf6dc`, merged as `aecd7ef`
- `.v13-side-nav-link` wraps its own text (`overflow-wrap: anywhere`, `max-inline-size: 100%`, no `nowrap`); the bold
  current link measured 321 px at 320 px with the 1.4.12 spacing in Liberation Sans, 294 px in Carlito. Pin in
  `reflow.spec.ts`; QA-010's font probe (Liberation Sans, DejaVu Sans, Carlito) passed.

## V13-UX-013: UXB-07 re-check of the routed M1 findings. PR #122, QA ACCEPT `f9536a4`, CI 41273685051, merged as `452b467`
- Re-measured UXB-01 … 05, 08, 14 on `develop` `ca16cba` (after FE-009 `961197e`, FE-010 `21dbbaa`) in ar and en at
  320–1280 px with an own capture (QA-005's library not built yet): all DONE. M1-15 … M1-18, the case-tab remainders of
  M1-06/M1-11/M1-17 and UX-009 R-04 recorded FIXED. UXB-06, 13, 16 DONE with their merge shas.
- New: UXB-17 (MEDIUM, draft form controls unstyled: no border, 21–22 px selects) and UXB-18 (LOW, "Preview" link
  looks like text), both routed by ARCH to V13-UX-014 (from `develop` after this PR merges). Docs only.

## V13-UX-014: one form-control rule and underlined table links (UXB-17, UXB-18). PR #128, QA ACCEPT `cf8a348`, CI 41276246852, merged as `772e26d`
- `styles/globals.css`: `.v13-control` is the one look for a text input, select or textarea (control-token border,
  2.5rem, max-inline-size 100%); a link in any `tbody` is underlined (`tbody a:not(.v13-btn)`).
- FE hunks: class names in DraftForm, NotificationCenterView, PortfolioView and MyWorkView; the two `.field input,
  .field select` module rules removed. The draft submit is `.v13-btn-primary`, My Work's status submit
  `.v13-btn-secondary` (same bare-control defect, fixed by the same rule).
- Tests: `tests/unit/components/controls.spec.ts` (14 tests fail on `61b57cf`). Local after merging develop `4f94b07`
  (#121, #122): lint 0, typecheck 0, unit 2,298/2,298, e2e 336/336. Browser, ar and en, 320 and 1280 px: fields 40 px with a 1 px `#5E646B` border
  (5.43:1), table links underlined on the case tab, Center, Portfolio and My Work, no page scroll at 320 px.
- Split out: UXB-19 (LOW), the closed template select's code clip at 320 px in Arabic; not fixable in CSS. ARCH ruled
  option (b): FE shows the selected code under the select in `<bdi>` (V13-FE-016).

## V13-UX-015: Next Action Card design (REQ-IA-009) on PROC's contract (#124). IN_REVIEW once its PR is open; QA
- `components/data/NextActionCard.tsx`: NONE renders nothing; a TASK shows the recorded title as an underlined link in
  `<bdi>`, the status FE renders (existing labels and badge) and, only when recorded, the due date with `DeadlineText`.
- Strings `common.nextAction.heading|status|dueDate` (ar, en). Styles `.v13-next-action*` in `styles/globals.css`.
- Spec: SCREENS.md S3 (Next Action Card), DESIGN_SYSTEM.md §3.4a, STRINGS.md.
- Tests: `tests/unit/components/next-action-card.spec.tsx` (14). FE wires the card (calls `nextActionForCase`, passes
  status, day count and a link that shows the task on any page of the Tasks tab); QA checks it on the page then.

## Unresolved defects
- UXB-17 (MEDIUM) and UXB-18 (LOW) are fixed by #128 (`772e26d`), DONE once re-checked on `develop`. UXB-19 (LOW) is OPEN, owned by FE as V13-FE-016
  (ARCH ruling). Other open items are in `docs/design/reviews/UX_BACKLOG.md`.

## Dependencies and requests
- ARCH: the root layout's `<header class="v13-topbar">` and the TopBar `<header>` would make two banner landmarks once
  FE-002 adopts TopBar. Proposal: the root layout keeps the banner in a plain `<div>` (or only on the sign-in page),
  and the language switch moves into TopBar on platform pages.
- ARCH: `next dev` writes an untracked `AGENTS.md` at the root (Next 16 `agentRules`). Consider `agentRules: false` or
  a `.gitignore` entry.
- FE (V13-FE-002): wire `AppShell` frame form, `TopBar`, `SideNav`, `WorkspaceSwitcher` (field `workspace`) and
  `PersonaMenu` in `app/(platform)/layout.tsx`, then the session-bar form is removed.
- ARCH/FE: a component gallery route for QA's axe and screenshot runs (PROPOSAL, DESIGN_SYSTEM.md §3.5).
- Owner (SOURCE_REQUIRED, via ARCH): brand Arabic font (OI-005), the CDF logo asset, brand confirmation of the logo
  position in English (D2).
