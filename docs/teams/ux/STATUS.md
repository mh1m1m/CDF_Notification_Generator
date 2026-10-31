# UX status — CDF V13 Enterprise (synthetic data only)

Updated: 2026-10-31 · Branch: `feature/V13-UX-003-data-components` · Base: `develop` `40901f3` (#14 merged; merged in)

## Completed
- V13-UX-004: information architecture, the five screen specs, design-system spec and strings, in `docs/design/`.
  PR #4, merged into `develop` (`54a94f3`). COMPLETE.
- V13-UX-001: one token source, `styles/tokens.css`, plus `globals.css` on semantic tokens, with 87 token tests. PR #8,
  CI green on `070a371`. IN_REVIEW (reviewer: QA).
- V13-UX-002: MERGED into `develop` (`40901f3`, PR #14, QA ACCEPT at `dd00ccc`). Shell components in `components/shell/` (AppShell frame form, TopBar, SideNav, WorkspaceSwitcher,
  PersonaMenu, Breadcrumbs, PageHeading, CaseWorkspace, CaseHeader, CaseTabs, banner glyph). Also `Count`, icons, the
  `shell` strings, and shell styles. PR #14, stacked on PR #8. IN_REVIEW (reviewer: QA).
- V13-UX-003: data components in `components/data/`: StatusBadge (four epistemic variants, type-enforced, with runtime
  guards), RecordedEventDate, DataTable (case scope), Pagination, Timeline, ExpectedSteps, Empty/Error/NotFound/Loading
  states, DeadlineText, Button/ButtonLink, ConfirmDialog, FilterBar; `common` strings; data styles. Stacked on PR #14.
  IN_REVIEW once its PR is open (reviewer: QA). Not built yet: the notification sending family (waits for
  V13-PROC-005).

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

## Unresolved defects
- None known.

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
