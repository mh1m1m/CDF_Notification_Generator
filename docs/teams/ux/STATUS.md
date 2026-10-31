# UX status — CDF V13 Enterprise (synthetic data only)

Updated: 2026-10-31 · Branch: `fix/V13-UX-007-m1-design-review` · Base: `develop` `f5a8fba`

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
