# Design documentation — CDF V13 Enterprise (UX team)

**SYNTHETIC-DATA REFERENCE IMPLEMENTATION — not CDF production.** Owned by team UX (`docs/AGENT_TASK_BOARD.md` §1).
Reviewed by QA.

| File | Deliverable | Task |
| ---- | ----------- | ---- |
| [INFORMATION_ARCHITECTURE.md](INFORMATION_ARCHITECTURE.md) | E06 Enterprise information architecture: routes, navigation model, case context rules, role-aware areas | V13-UX-004 |
| [WORKSPACES.md](WORKSPACES.md) | E07 (M1 part) Multi-workspace UX: the three workspaces, the switcher, what switching changes and what it never changes | V13-UX-004 |
| [SCREENS.md](SCREENS.md) | Specs for the five foundational screens: Case Portfolio, My Work, Case Workspace, Notification Operations Center, Workspace Switcher | V13-UX-004 |
| [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md) | Token plan (V13-UX-001), shell components (V13-UX-002), data components (V13-UX-003), with props, states, accessibility and test ids | V13-UX-001..003 |
| [STRINGS.md](STRINGS.md) | Arabic and English text for the `common` and `shell` i18n namespaces (source for `lib/i18n/{common,shell}`) | V13-UX-004 |

## Labels used in these documents

- **FACT**: read from a named source (file and line, or Design Guide page).
- **RULING (UX)**: a design decision inside the UX team's scope (ADR-009), recorded here with its reason.
- **PROPOSAL**: needs another team's or the owner's agreement; the default applies until then.
- **SOURCE_REQUIRED**: a value only the owner can supply; a labelled fallback is used.

## Sources

| Id | Source | Used for |
| -- | ------ | -------- |
| DG | `CDF Design Guide(4).pdf` (project files; 87 pages, image only) | header p. 29, buttons p. 33, KPI card p. 37, tables p. 42–44 (rendered and read by UX on 28 Oct 2026) |
| TOK | `mh1m1m/cdf_case_management` `packages/ui/tokens/cdf-design-tokens.json` v1.1 | primitives, semantic light and dark, type scale, spacing, motion |
| PLT | `mh1m1m/cdf_case_management` `packages/ui/src/tokens.css`, `status.tsx`, `shell.tsx` (main `feffabe`) | AA-adjusted semantic layer (contrast-tested), status registry and indicator patterns, shell patterns |
| V13 | `/mnt/project-files/notifications/v13/` (`src/domain/epistemic.js`, `design/DESIGN_SYSTEM.md`) — frozen evidence, read only | Layer A states and symbols, Layer B kinds, the forbidden words for expected steps, the sending and correction badge family |
| PLAN | `docs/MASTER_EXECUTION_PLAN.md`, `docs/AGENT_TASK_BOARD.md`, `docs/ARCHITECTURE_DECISIONS.md` on `develop` `b02e672` | screens, roles, workspaces, scenarios A–E, gates |

Nothing in these documents uses real CDF data. Every example is synthetic (`CDF-DEMO-2026-0001` … `0010`,
_Secretary Alpha_, _Investigator Beta_, _Investigator Gamma_, _Governance Officer Delta_, `@example.test`).
