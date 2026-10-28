# Agent task board — CDF V13 Enterprise

**SYNTHETIC-DATA REFERENCE IMPLEMENTATION — not CDF production.** The single list of V13 work items. Task ids stand in
for Linear issues until Linear has room (ADR-007). Only the Chief Architect (ARCH) edits this file; teams report status
in `docs/teams/<team>/STATUS.md` and by message to ARCH, and ARCH updates the board when integrating.

Status words: NOT_STARTED · READY · IN_PROGRESS · IN_REVIEW · BLOCKED · DONE (= merged into `develop` with its
acceptance evidence) · PRODUCTION_SUBSTITUTION_REQUIRED.

## 1. Teams

| Team | Role | Owns (only this team edits) | Its PRs are reviewed by |
| ---- | ---- | --------------------------- | ----------------------- |
| **ARCH** | Chief Architect, integration, DevOps, hosted database operations | `package.json`, `pnpm-lock.yaml`, all root configs (`tsconfig.json`, `next.config.ts`, `eslint.config.mjs`, `vitest.config.ts`, `postcss.config.mjs`, prettier), `.github/**`, `.env.example`, `CLAUDE.md`, `README.md`, `docs/*.md` master files, `docs/architecture/CONCEPTUAL_ARCHITECTURE.md`, `docs/hosted/**`, `database/hosted/**`, `lib/contracts/**`, `lib/auth/**`, `lib/i18n/index.ts`, `lib/i18n/persona/**`, `proxy.ts`, `app/layout.tsx`, `app/api/health/**`, `scripts/ci/**` | SEC (security-relevant parts) |
| **DB** | Database and backend | `database/migrations/0001+`, `database/seed/**`, `lib/db/**`, `scripts/db/**`, `tests/integration/**`, `docs/architecture/DATA_MODEL.md` | SEC |
| **PROC** | Procedural intelligence | `lib/domain/**`, `lib/journeys/**`, `lib/disclosure/**`, `lib/authority/**`, `lib/notifications/**`, `tests/unit/{domain,journeys,disclosure,authority,notifications}/**`, i18n namespaces `status`, `journeys` | SEC |
| **FE** | Frontend and BFF | `app/(auth)/**`, `app/(platform)/**`, `app/api/**` except `app/api/health/**`, `lib/server/**`, `lib/adapters/**`, `lib/authz/**`, `tests/unit/{server,authz}/**`, i18n namespaces `auth`, `portfolio`, `case`, `myWork`, `notifications`, `workspaces` | QA (UI) and SEC (`lib/server`, `lib/adapters`, `lib/authz`) |
| **UX** | Design system, RTL, accessibility by design | `styles/**`, `components/**`, `lib/i18n/{common,shell}/**`, `docs/design/**`, `tests/unit/components/**` | QA |
| **QA** | Playwright, visual QA, the Sentinel, Truth Inspector and Design Critic harness | `playwright.config.ts`, `tests/e2e/**`, `tests/a11y/**`, `tests/visual/**`, `tests/sentinel/**`, `tests/truth/**`, `tests/critic/**`, `tests/fixtures/**`, `docs/qa/**` | ARCH |
| **SEC** | Security and adversarial testing | `tests/security/**`, `docs/security/**` | DB |

Every team also owns `docs/teams/<team>/` (its `STATUS.md`, template in `docs/teams/README.md`).

Rules: never edit a path another team owns; ask its owner through ARCH. A new dependency, a root config change or a
new i18n namespace goes through ARCH. A change to `lib/contracts/**` proposed inside a team PR (new ports, command schemas)
needs ARCH's `REVIEW: ACCEPT` as well as the board reviewer's. String files follow ADR-013. A PR may add several consecutive migrations; applied migrations are never edited.
ARCH applies migrations to the hosted schema only after the PR is merged into `develop`, with the plan's procedure
(`docs/hosted/ISOLATION_AND_RECOVERY_PLAN.md` §6). No team runs SQL on the hosted project.

## 2. How a task moves

1. Branch from `develop`: `<feature|fix|security|docs|test>/V13-<TEAM>-<NNN>-<slug>`. A team session that can push only to its own
   session branch (PROC) opens its PRs from that branch, one at a time; the PR title carries the task id.
2. Build with tests (positive and negative). Run locally: `pnpm lint && pnpm typecheck && pnpm db:lint && pnpm test`,
   plus `pnpm test:db` and `pnpm test:e2e` when the task touches them. Record real counts.
3. Open a PR into `develop` titled `[V13-<TEAM>-<NNN>] …` with the CEOM sections (CLAUDE.md §6).
4. The reviewing team posts `REVIEW: ACCEPT <sha>` or `REVIEW: CHANGES <sha>` with reasons on the PR.
5. ARCH merges the accepted head when CI is green, runs the full suite on `develop`, applies migrations to staging, and
   marks the task DONE here.

## 3. Milestone M1 — Enterprise foundation

Acceptance target (owner's first-milestone suggestion): 10 synthetic cases, 3 roles, 3 workspaces (at least 2
required), persistent records in the database, the five foundational screens working, and Playwright tests proving
case isolation, all on the staging deployment.

Phase A runs now. Phase B starts when V13-ARCH-001 is merged into `develop`. Phase C closes the milestone.

### Phase A — foundation

| Id | Task | Team | Depends on | Acceptance | Status |
| -- | ---- | ---- | ---------- | ---------- | ------ |
| V13-ARCH-001 | Repository foundation: Next.js 16 app shell, configs, `lib/contracts` (incl. `CaseSourceAdapter`), `lib/db` security context, `lib/auth` session, `proxy.ts`, health and isolation-probe routes, local PostgreSQL tooling and migration runner/linter, CI, Playwright smoke | ARCH | — | lint, typecheck, format, db:lint, unit, DB integration, build and e2e smoke all green locally; CI green | IN_REVIEW |
| V13-ARCH-002 | Shared documentation: CLAUDE.md, plan, board, ADRs, status, evidence, open issues, deployment status, E01 | ARCH | — | files present on `develop`, facts verified | IN_PROGRESS |
| V13-ARCH-003 | Staging connection: app-login verifier (SCRAM, set out of band), Vercel environment variables (sensitive), `develop` preview deployed, `/api/health` and `/api/health/isolation` PASS from the deployed app login | ARCH | ARCH-001 | plan §6 steps 6–7 recorded with evidence; DEPLOYMENT_STATUS updated | NOT_STARTED |
| V13-ARCH-004 | Requirements register and traceability (E-, UXQA-, QG-, Gate ids → tasks → tests) | ARCH | — | `docs/REQUIREMENTS_REGISTER.csv` + `docs/TRACEABILITY.md` | IN_PROGRESS |

### Phase B — parallel build

| Id | Task | Team | Depends on | Acceptance | Status |
| -- | ---- | ---- | ---------- | ---------- | ------ |
| V13-DB-001 | Migration 0001: identity and access core — `workspace`, `role`, `persona`, `persona_workspace_membership` (persona × workspace × role, active window); claims helpers (`current_persona_id()`, `current_workspace()`), all `security definer` helpers with `search_path = ''`; explicit restrictive deny-all policy on `schema_migrations`; audit ledger `audit_event` (append-only, hash chain, V13 advisory-lock namespace, ADR-011) | DB | ARCH-001 | db:lint; every table RLS on, no write grants; audit UPDATE/DELETE/TRUNCATE refused; chain verifies; negative tests | READY after ARCH-001 |
| V13-DB-002 | Migration 0002: case registry — `case_record` (uuid key, display number `CDF-DEMO-2026-NNNN` unique, title, stage, `is_restricted`, records state ACTIVE/CLOSED, `source_system`, `source_ref`, `row_version`), `case_assignment` (persona × case × capacity, active window), workspace visibility; `can_access_case(uuid)`; RLS on every case-keyed table through it; read functions for the portfolio (keyset pagination, filters, counts only after authorisation) and the case header | DB | DB-001 | other-case, other-workspace, restricted (0009), closed (0010) and unknown-id tests at DB level; unknown = unauthorised | NOT_STARTED |
| V13-DB-003 | Migration 0003: procedural core — `procedural_event` (case-keyed, occurred/recorded times, provenance, causation id), `task` (case-keyed, assignee, status, due date, `row_version`); commands `api_update_task_status` (authorised, audited, optimistic concurrency) | DB | DB-002 | Scenario B at DB level: a task change in one case leaves every other case unchanged; stale version refused | NOT_STARTED |
| V13-DB-004 | Migration 0004: notification core — `notification_template`, `notification_template_version` (code, version, language, content hash, basis), `notification` (case-keyed, template version, recipient class, lifecycle status, idempotency key unique), `notification_event`; commands `api_create_notification_draft`; content-free `dispatch_outbox` table (ADR-010, used from M5) | DB | DB-002 | a notification can never carry another case's id (server-derived `case_id`, mismatch refused); duplicate idempotency key refused; audited | NOT_STARTED |
| V13-DB-005 | M1 synthetic seed (`database/seed/`): 4+ personas, 3 roles, 3 workspaces, memberships, 10 cases (0009 restricted, 0010 closed), assignments, tasks, recorded events, templates, notifications | DB | DB-001..004 | only synthetic names, `@example.test`, `CDF-DEMO-2026-NNNN`; seed is idempotent; documented visibility table per persona | NOT_STARTED |
| V13-DB-006 | Scripted rehearsal of the shared-database procedure: `scripts/db/rehearse-shared.mjs` builds a Supabase-like local cluster (non-superuser `postgres`, foreign schema and roles) and runs the steps of `docs/TEST_EVIDENCE.md` §1.2 (dry run, apply, fingerprint, isolation, four planted faults, refused and clean rollback); CI job | DB | ARCH-001 | output matches §1.2 on every run; any change to `database/hosted/**` or a migration runs it | READY after ARCH-001 |
| V13-PROC-001 | Port the V13 status model to `lib/domain`: separate procedure, task, meeting, decision, notification and delivery statuses computed from recorded events; epistemic states (completed, expected, conditional, awaiting approval) | PROC | ARCH-001 | ported tests green; no status without an event; types exported for UI | READY after ARCH-001 |
| V13-PROC-002 | Port journeys to `lib/journeys`: catalogue v13 as versioned data, resolver, Layer A (actual, from events) and Layer B (expected) progress; Level 1 fails closed until the status mapping is supplied (OI-004) | PROC | PROC-001 | ported journey/progress tests green; actual and expected never merged | NOT_STARTED |
| V13-PROC-003 | Port disclosure projection to `lib/disclosure` (server-only): policy version, recipient classes, default prohibited; renderers refuse unprojected models | PROC | PROC-001 | ported disclosure tests green; restricted fields never projected to a class without the right | NOT_STARTED |
| V13-PROC-004 | Port authority decision rights to `lib/authority` (`check()` fail closed) bound to the persona's capacity | PROC | PROC-001 | ported tests green; reconciled with DB command checks (table in PR) | NOT_STARTED |
| V13-PROC-005 | Port notification composition to `lib/notifications`: lifecycle states, sha256 idempotency key, consistency rules PC-00..PC-29, next action, server-side e-mail/preview rendering with escaping | PROC | PROC-001, PROC-003 | ported tests green; preview shows the case reference, stage and recipient of its own case only | NOT_STARTED |
| V13-FE-001 | BFF read services (`lib/server`) and the first `CaseSourceAdapter` implementation (`lib/adapters/case-source/postgres.ts`) reading V13's own records inside `withRequestContext`; application pre-check `lib/authz` | FE | ARCH-001, DB-002 | unit tests with a fake adapter; integration against local DB; unknown and unauthorised give the same result | READY after ARCH-001 (fake adapter first) |
| V13-FE-002 | Platform layout and Workspace Switcher: role-aware navigation, active workspace in the session, switching re-checked by the database | FE | UX-002, DB-001 | Scenario C passes; switching never widens access | NOT_STARTED |
| V13-FE-003 | Case Portfolio (`/portfolio`): server-side pagination, filters, Arabic-first table, no case outside the persona's access, counts after authorisation | FE | FE-001, UX-003 | Scenario D (search/filter) basics; restricted case invisible to non-assigned personas | NOT_STARTED |
| V13-FE-004 | Case Workspace (`/cases/[caseId]`): header, overview, recorded events, tasks, notifications of this case; the URL is the only case context (no browser storage, no global case state) | FE | FE-001, PROC-001, UX-002 | Scenarios A and B pass; two tabs on two cases stay independent | NOT_STARTED |
| V13-FE-005 | My Work (`/my-work`): tasks of the signed-in persona across authorised cases; task status update through `api_update_task_status` | FE | DB-003 | Scenario B passes; stale update shows a generic error with correlation id | NOT_STARTED |
| V13-FE-006 | Notification Operations Center (`/notifications`) and the case Notifications tab: history per case, filters, generate a draft (Server Action + Zod schema from `lib/contracts`) with preview | FE | DB-004, PROC-005 | Scenario E passes; no notification appears under another case | NOT_STARTED |
| V13-UX-001 | One token source `styles/tokens.css` from CDF Design Tokens v1.1 (light, dark, RTL), Arabic font fallback labelled SOURCE_REQUIRED (OI-005) | UX | ARCH-001 | contrast AA tested; no literal colours in components | READY after ARCH-001 |
| V13-UX-002 | Shell components: AppShell, SideNav, TopBar, WorkspaceSwitcher, CaseHeader, Breadcrumbs, synthetic-data banner | UX | UX-001 | keyboard and screen-reader paths; RTL and LTR snapshots | NOT_STARTED |
| V13-UX-003 | Data components: DataTable with pagination, StatusBadge with distinct epistemic variants, Timeline, EmptyState, ErrorState (generic message + correlation id), loading states | UX | UX-001 | axe clean; actual vs expected visibly distinct without colour alone | NOT_STARTED |
| V13-UX-004 | Information architecture and specs for the five foundational screens (E06, E07 part) in `docs/design/`; `common` and `shell` i18n namespaces in Arabic and English | UX | — | specs reviewed by QA; every string in `lib/i18n` | READY after ARCH-001 |
| V13-QA-001 | Browser testing architecture (UXQA-01): Playwright projects (desktop, mobile; ar, en), persona sign-in fixture, evidence layout, trace/screenshot policy; CI job with ARCH (UXQA-15) | QA | ARCH-001 | runs locally with `PW_CHROMIUM_PATH`; evidence written under `test-results/` | READY after ARCH-001 |
| V13-QA-002 | Scenarios A–E as e2e tests (UXQA-03, UXQA-04) | QA | FE-002..006 | all five pass on `develop` and on staging | NOT_STARTED |
| V13-QA-003 | Case Context Sentinel: UI (DOM), API (BFF responses) and DB (direct queries as `cdf_v13_user`, with SEC) checks that everything shown belongs to the case in context | QA | FE-004, DB-002 | runs on every PR; a planted cross-case leak makes it fail | NOT_STARTED |
| V13-QA-004 | Procedural Truth Inspector (M1 scope): every status badge and timeline entry maps to a recorded event | QA | FE-004, PROC-001 | a planted unrecorded "completed" badge makes it fail | NOT_STARTED |
| V13-QA-005 | Accessibility, RTL and responsive checks plus the screenshot library for the five screens (UXQA-05, -07, -08) | QA | FE-003..006 | axe 0 serious/critical; RTL checks; 360/768/1280/1920 px | NOT_STARTED |
| V13-SEC-001 | Threat model and authorisation matrix for M1 (E05 part): personas, workspaces, cases, trust boundaries, the shared database | SEC | — | reviewed by DB; every matrix cell has a planned test | READY |
| V13-SEC-002 | Database adversarial tests: forged or missing claims, RLS bypass attempts as `cdf_v13_user`, command abuse, cross-case and cross-workspace access, restricted and closed cases, audit tampering | SEC | DB-001..004 | all refused; results in TEST_EVIDENCE (UXQA-17) | NOT_STARTED |
| V13-SEC-003 | Application adversarial tests: URL id swap, display-number lookup, tampered/expired cookie, sign-in flag off, server-action origin checks, security headers and CSP, error leakage | SEC | FE-001..006 | all refused or generic; no stack trace or SQL text in any response | NOT_STARTED |

### Phase C — integration and milestone

| Id | Task | Team | Depends on | Acceptance | Status |
| -- | ---- | ---- | ---------- | ---------- | ------ |
| V13-ARCH-005 | Apply each accepted migration to the hosted schema with the plan's procedure; update evidence | ARCH | each DB PR | fingerprint unchanged; isolation PASS; advisors clean | NOT_STARTED |
| V13-QA-006 | Staging verification (UXQA-16, Gate J): smoke, case isolation and Scenarios A–E against the staging preview | QA + ARCH | ARCH-003, QA-002 | results recorded with deployment id and commit | NOT_STARTED |
| V13-ARCH-006 | E02 conceptual architecture | ARCH | — | `docs/architecture/CONCEPTUAL_ARCHITECTURE.md` | NOT_STARTED |
| V13-ARCH-007 | M1 milestone PR `develop` → `main` for the owner's merge, with gate evidence | ARCH | all M1 tasks | every M1 gate reported as measured | NOT_STARTED |

## 4. Later milestones

M2–M8 tasks are added when M1 closes (`docs/MASTER_EXECUTION_PLAN.md` §4).
