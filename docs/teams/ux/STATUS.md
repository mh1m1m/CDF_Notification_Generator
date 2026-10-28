# UX status — CDF V13 Enterprise (synthetic data only)

Updated: 2026-10-28 · Branch: `docs/V13-UX-004-ia-and-screen-specs` · Base: `develop` `b02e672`

## Completed
- V13-UX-004 (part 1) — E06 information architecture, E07 M1 workspaces, specs for the five foundational screens,
  `common` and `shell` strings (ar/en) as a table — `docs/design/` — PR pending — IN_REVIEW once opened (reviewer: QA)
- V13-UX-001..003 — specs only (token plan, shell and data component props, states, accessibility, test ids) in
  `docs/design/DESIGN_SYSTEM.md`; code NOT_STARTED (waits for V13-ARCH-001)

## Changed files
- `docs/design/README.md`, `INFORMATION_ARCHITECTURE.md`, `WORKSPACES.md`, `SCREENS.md`, `DESIGN_SYSTEM.md`,
  `STRINGS.md`
- `docs/teams/ux/STATUS.md`

## Test evidence
| Command | Result | Counts | Commit |
| ------- | ------ | ------ | ------ |
| — | No code yet: documentation only. No test has been run. | — | — |

## Unresolved defects
- None in code. Open design items in `docs/design/DESIGN_SYSTEM.md` §6.
- QA `REVIEW: CHANGES 1bf99bd` (11 items): all addressed in the follow-up commit (ADR-013 DOM contract).

## Dependencies and requests
- ARCH answered 28 Oct (ADR-013): Tailwind 4; i18n `lib/i18n/<ns>/{ar,en}.ts`; `renderToStaticMarkup` tests; inline SVG
  icons. Waiting for the V13-ARCH-001 PR head to start tokens.css and the shell.
- ARCH/FE: a component gallery route for QA's axe and screenshot runs (PROPOSAL, DESIGN_SYSTEM.md §3.5).
- SEC (routed by ARCH): confirm whether investigators see the Notification Operations Center (D6).
- PROC: e-mail token snapshot agreed (DESIGN_SYSTEM.md §6 D9).
- Owner (SOURCE_REQUIRED, via ARCH): brand Arabic font files and licence (OI-005); brand confirmation of logo position
  in English (D2).
