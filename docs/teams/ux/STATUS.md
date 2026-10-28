# UX status — CDF V13 Enterprise (synthetic data only)

Updated: 2026-10-28 · Branch: `feature/V13-UX-002-shell` · Base: `feature/V13-UX-001-tokens` + `develop` `e04c164`

## Completed
- V13-UX-004: information architecture, the five screen specs, design-system spec and strings, in `docs/design/`.
  PR #4, merged into `develop` (`54a94f3`). COMPLETE.
- V13-UX-001: one token source, `styles/tokens.css`, plus `globals.css` on semantic tokens, with 87 token tests. PR #8,
  CI green on `070a371`. IN_REVIEW (reviewer: QA).
- V13-UX-002: shell components in `components/shell/` (AppShell frame form, TopBar, SideNav, WorkspaceSwitcher,
  PersonaMenu, Breadcrumbs, PageHeading, CaseWorkspace, CaseHeader, CaseTabs, banner glyph). Also `Count`, icons, the
  `shell` strings, and shell styles. IN_REVIEW once its PR is open (reviewer: QA). The branch is stacked on UX-001
  because the shell styles use its tokens.

## Changed files (V13-UX-002)
- `components/shell/*` (new: `Breadcrumbs`, `CaseHeader`, `CaseTabs`, `CaseWorkspace`, `Disclosure`, `PageHeading`,
  `PersonaMenu`, `SideNav`, `TopBar`, `WorkspaceSwitcher`, `case-identity`; changed: `AppShell`, `SyntheticBanner`)
- `components/data/Count.tsx`, `components/icons/index.tsx`, `components/format.ts`
- `lib/i18n/shell/{ar,en}.ts`, `lib/i18n/common/{ar,en}.ts` (records state)
- `styles/globals.css` (shell section)
- `tests/unit/components/shell.spec.tsx`
- `docs/design/DESIGN_SYSTEM.md` §2 (as built), `docs/design/STRINGS.md` (as built), this file

## Test evidence (V13-UX-002, local, on the branch head before push)
| Command | Result |
| ------- | ------ |
| `pnpm lint` | pass (logical-css: 30 files) |
| `pnpm typecheck` | pass |
| `pnpm format:check` | pass |
| `pnpm test` | 19 files, 378 tests passed |
| `pnpm build` | pass |
| `PW_CHROMIUM_PATH=/opt/pw-browsers/chromium pnpm test:e2e` | 33 passed |
| Keyboard check (local Chromium, temporary preview page, not committed) | Enter opens the switcher; Arrow Down moves through the options and then the page link; Escape closes it and focus returns to the switcher; the breadcrumb chevron is mirrored in Arabic and not in English |

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
