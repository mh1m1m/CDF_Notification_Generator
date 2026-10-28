# Master execution plan — CDF V13 Enterprise

**CDF Case & Notification Intelligence Platform — V13 Enterprise** (منصة ذكاء القضايا والإشعارات — الإصدار 13 المؤسسي)

**SYNTHETIC-DATA REFERENCE IMPLEMENTATION — not CDF production.** This is the one shared plan for every team. It
reconciles the owner's directive (five parts, received 28 Oct 2026 00:10–00:12 UTC) with the owner's later decisions,
and maps every requirement family to a milestone, a team, a gate and an evidence location. Status lives in
`docs/IMPLEMENTATION_STATUS.md`; tasks live in `docs/AGENT_TASK_BOARD.md`; decisions live in
`docs/ARCHITECTURE_DECISIONS.md`.

## 1. Sources and authority

| Order | Source | What it governs |
| ----- | ------ | --------------- |
| 1 | `CLAUDE.md` and the owner's binding decisions | Safety, architecture and working rules |
| 2 | Owner decision 28 Oct 2026 00:29 UTC (Supabase) | ADR-012: shared CDF GC Review project, own schema, safeguards |
| 3 | Owner instruction 28 Oct 2026 00:13 UTC | Swarm of team threads; Chief Architect coordinates; one repository |
| 4 | Master Orchestration Directive | Unified mission, vertical slices, QG-01..QG-13, first-response format |
| 5 | Cloud Project Initialization | GitHub, Supabase, Vercel, environment variables, verification, `docs/DEPLOYMENT_STATUS.md` |
| 6 | Multi-Agent Swarm Activation | Teams, parallel protocol, shared progress files, engineering controls |
| 7 | Prompt A — Autonomous Full-Stack Transformation Engine | Parts I–XXX, deliverables E01–E23 |
| 8 | Prompt B — Browser Intelligence, Visual QA & UX Optimisation Engine | Scenarios A–E, UXQA-01..20, Gates A–J, three QA components |
| 9 | V13 reference package (`/mnt/project-files/notifications/v13/`) and V12 generator | Domain rules to port; frozen evidence, never modified |

Where the Cloud Initialization prompt says "create a new Supabase project", the owner's later decision (2) governs:
no new project; V13 lives in schema `cdf_notifications_v13` of CDF GC Review.

## 2. Unified mission

Turn the single-case notification generator into a multi-case, multi-workspace platform with persistent case records,
case-level authorisation, procedural intelligence (actual progress kept apart from the expected process), case-linked
notifications with versions, disclosure control, dispatch and delivery evidence, and an append-only audit trail —
Arabic-first, accessible, and verified in a real browser at every slice. It runs on synthetic data only; production
stays blocked by the hosting gate (ADR-005, QG-13).

What is out of scope here: real data of any kind, real sending of e-mail, production hosting, and any claim of
production readiness.

## 3. Architecture in one page

- One Next.js 16 app (ADR-002) on Vercel (`fra1`, Vercel Authentication on every deployment).
- PostgreSQL schema `cdf_notifications_v13` in the shared Supabase project CDF GC Review (ADR-012), reached only from the
  server as `cdf_v13_app` → `SET LOCAL ROLE cdf_v13_user` with per-transaction claims (ADR-003).
- Ports in `lib/contracts`: `CaseSourceAdapter` (ADR-001), `IdentityProvider` (ADR-004), `AuditSinkPort`,
  `NotificationDispatchPort` (ADR-010), `ClockPort`.
- Reads: RLS-filtered views and functions. Writes: `api_*` `SECURITY DEFINER` commands that check authority and write
  the audit event in the same transaction (ADR-011).
- Case context comes from the URL (`/cases/<uuid>`) and the transaction's claims, never from browser storage or a
  global client state, so several cases can be open in several tabs at once.
- Domain logic ported from the V13 reference package: status model, journeys (three levels), disclosure projection,
  authority decision rights, consistency and next-action rules, notification lifecycle, e-mail rendering.

## 4. Milestones and slices

Each milestone is a set of vertical slices. Each slice delivers, in order: database change → backend logic →
authorisation → interface → UX → functional tests → security tests → Playwright → accessibility → visual review →
documentation → acceptance evidence. A slice is done only when its gates pass on `develop` and on the staging preview.

| Milestone | Slices (directive §7) | Content | Exit gates |
| --------- | --------------------- | ------- | ---------- |
| **M1 — Enterprise foundation** | Slice 1 + core of Slices 2, 3, 5 | App shell; persona sign-in; DB connectivity; personas, roles, workspaces; design tokens; global navigation; **10 synthetic cases** (`CDF-DEMO-2026-0001…0010`, 0009 restricted, 0010 closed); **3 roles** (Committee Secretary, Investigator, Governance Officer) and **3 workspaces** (Secretariat, Investigations, Governance); the five foundational screens — **Case Portfolio, My Work, Case Workspace, Notification Operations Center, Workspace Switcher** — on persistent records; notification history per case; **Playwright tests proving case isolation** | QG-02/Gate B, QG-03/Gate C, QG-06/Gate A (M1 flows), QG-08/Gate E, QG-09/Gate F, QG-12/Gate J |
| M2 — Multi-case and multi-workspace | Slices 2 and 3 complete | Portfolio views (table, cards, kanban, timeline), server-side pagination and filters, saved views, global search with authorisation before results/counts/snippets, Ctrl/Cmd+K palette, quick case switcher, role-aware navigation, workspace dashboards, My Work with tasks and deadlines | + Gate G, QG-07/Gate D baselines |
| M3 — Procedural intelligence | Slice 4 | Case states, procedures, tasks, three-level journeys (Level 1 fails closed until the status mapping is supplied), Layer A actual progress from recorded events, Layer B expected process, procedural evidence | + QG-04/Gate I (Procedural Truth Inspector) |
| M4 — Notification Center | Slice 5 | Notification catalogue as versioned data, case-linked generation, template versions with content hash, recipient resolution, disclosure projection, notification history and preview | + QG-05 |
| M5 — Notification operations | Slice 6 | Approval, dispatch through the outbox, per-attempt delivery records, retry and dead letter, corrections and supersession, audit evidence; stub sender only | QG-05, QG-11 |
| M6 — Advanced capabilities | Slice 7 | Committee workspace, investigation views, legal review, competent-authority views, reporting, administrative oversight | QG-11 |
| M7 — Operational hardening | Slice 8 | Security review and adversarial testing, performance at 100 / 1k / 10k / 100k synthetic cases, backup and restore rehearsal, monitoring, incident response, deployment automation, production-readiness assessment | QG-10/Gate H; QG-13 stays BLOCKED |
| M8 — Final delivery | — | E19–E23, UXQA-18..20, executive architecture and approval paper, reproducible source package | All gates reported as measured |

Each milestone ends with one PR `develop` → `main` that the owner merges.

## 5. Quality gates (mandatory; a failed gate stays visible)

| Gate | Prompt B gate | Passes when | Measured by | Owner team | Evidence |
| ---- | ------------- | ----------- | ----------- | ---------- | -------- |
| QG-01 Source integrity | — | V12/V13 sources unchanged (hash ledger) | `SHA256SUMS` check of the evidence folders | ARCH | TEST_EVIDENCE |
| QG-02 Multi-case integrity | B Case isolation | No cross-case data in any UI, API or DB result | Case Context Sentinel (UI + API + DB) | QA + SEC | TEST_EVIDENCE |
| QG-03 Authorization | C Authorization | Unauthorised personas get nothing (same answer as unknown) | Negative tests, RLS penetration from `cdf_v13_user` | SEC | TEST_EVIDENCE |
| QG-04 Procedural truth | I Procedural accuracy | No invented completed action; actual vs expected always distinguishable | Procedural Truth Inspector | QA + PROC | TEST_EVIDENCE |
| QG-05 Disclosure | (C) | Restricted information never exposed to a recipient class that may not see it | Disclosure projection tests; restricted-case tests | PROC + SEC | TEST_EVIDENCE |
| QG-06 Functional correctness | A Functional integrity | Critical workflows pass | Playwright e2e, unit, DB tests | QA | TEST_EVIDENCE |
| QG-07 Visual quality | D Visual integrity | No unapproved critical visual regression; Design Critic findings triaged | Visual baselines + Design Critic | QA + UX | `tests/visual/`, UXQA reports |
| QG-08 Accessibility | E Accessibility | axe: 0 serious/critical on critical screens; keyboard paths work | axe + keyboard tests | QA + UX | TEST_EVIDENCE |
| QG-09 Arabic RTL | F Arabic RTL | Critical Arabic screens render correctly (dir, mirroring, numerals, truncation) | RTL Playwright checks + screenshots | UX + QA | TEST_EVIDENCE |
| — | G Responsive | Critical workflows work at 360, 768, 1280 and 1920 px | Playwright viewports | QA | TEST_EVIDENCE |
| QG-10 Performance | H Performance | Agreed budgets met (PROPOSED budgets in M7) | Load and browser timing tests | ARCH + QA | TEST_EVIDENCE |
| QG-11 Regression | (A, D) | Everything that passed still passes | Full suite on every PR | QA | CI runs |
| QG-12 Deployment | J Deployment verification | Staging deployment passes smoke tests | Smoke tests against the staging preview | ARCH + QA | DEPLOYMENT_STATUS |
| QG-13 Production authorization | — | Operational, cybersecurity, privacy and organisational approvals verified | Hosting gate checklist (ADR-005) | Owner | **BLOCKED by design** |

No gate is reported as passed without the evidence named here.

## 6. Deliverables — Prompt A (E01–E23)

| Id | Deliverable | Location | Team | Milestone |
| -- | ----------- | -------- | ---- | --------- |
| E01 | Enterprise current-state audit | `docs/CURRENT_STATE_ARCHITECTURE.md` | ARCH | M1 (done) |
| E02 | Multi-case conceptual architecture | `docs/architecture/CONCEPTUAL_ARCHITECTURE.md` | ARCH | M1 |
| E03 | Enterprise data model and ERD | `docs/architecture/DATA_MODEL.md` | DB | M1, extended each milestone |
| E04 | SQL migrations | `database/migrations/` | DB | every milestone |
| E05 | RLS and authorisation matrix | `docs/security/AUTHORIZATION_MATRIX.md` | SEC + DB | M1 |
| E06 | Enterprise information architecture | `docs/design/INFORMATION_ARCHITECTURE.md` | UX | M1 |
| E07 | Multi-workspace UX/UI design | `docs/design/WORKSPACES.md` | UX | M1–M2 |
| E08 | Case Portfolio and Case Workspace | `app/`, `components/` | FE + UX | M1–M2 |
| E09 | Enterprise dashboard | `app/`, `components/` | FE + UX | M2 |
| E10 | Notification Operations Center | `app/`, `components/` | FE + UX | M1 (list), M4–M5 |
| E11 | Three-level journey integration | `lib/journeys/` | PROC | M3 |
| E12 | Notification dispatch architecture | `docs/architecture/DISPATCH.md`, `lib/notifications/` | PROC + DB | M5 |
| E13 | Complete Next.js source code | repository | all | every milestone |
| E14 | Backend implementation | `database/`, `lib/server/` | DB + FE | every milestone |
| E15 | GitHub repository | `mh1m1m/CDF_Notification_Generator` | ARCH | M1 |
| E16 | Vercel preview / staging deployment | `docs/DEPLOYMENT_STATUS.md` | ARCH | M1 |
| E17 | Automated test suite | `tests/` | QA + SEC + all | every milestone |
| E18 | Security and performance report | `docs/security/SECURITY_REPORT.md`, `docs/PERFORMANCE.md` | SEC + ARCH | M7 |
| E19 | Migration and rollback plan | `docs/hosted/ISOLATION_AND_RECOVERY_PLAN.md`, `docs/MIGRATION_FROM_V12.md` | ARCH + DB | M1 (hosted), M8 |
| E20 | Production readiness assessment | `docs/DEPLOYMENT_READINESS.md` | ARCH | M7 |
| E21 | Operational runbooks | `docs/runbooks/` | ARCH | M7 |
| E22 | Executive architecture and approval paper | `docs/EXECUTIVE_PAPER.md` (Arabic and English) | ARCH | M8 |
| E23 | Reproducible source package | release artefact with checksums | ARCH | M8 |

## 7. Deliverables — Prompt B (UXQA-01..20)

| Id | Deliverable | Team | Milestone |
| -- | ----------- | ---- | --------- |
| UXQA-01 | Browser testing architecture | QA | M1 |
| UXQA-02 | Playwright test suite | QA | M1, every milestone |
| UXQA-03 | Multi-case journey tests (Scenarios A, B, E) | QA | M1 |
| UXQA-04 | Workspace navigation tests (Scenario C) | QA | M1 |
| UXQA-05 | Screenshot evidence library | QA | M1 |
| UXQA-06 | Visual regression baselines | QA + UX | M2 |
| UXQA-07 | Accessibility audit | QA + UX | M1, M7 |
| UXQA-08 | Arabic RTL quality report | UX + QA | M1 |
| UXQA-09 | Enterprise UX heuristic assessment | UX (Design Critic) | M2 |
| UXQA-10 | AI visual design recommendations | UX (Design Critic) | M2 |
| UXQA-11 | Performance and responsiveness report | QA | M7 |
| UXQA-12 | Adversarial interaction test results | SEC + QA | M2, M7 |
| UXQA-13 | Corrected UI components | UX + FE | every milestone |
| UXQA-14 | Before/after comparison | QA | every milestone |
| UXQA-15 | GitHub CI/CD quality pipeline | QA + ARCH | M1 |
| UXQA-16 | Vercel preview verification | QA + ARCH | M1 |
| UXQA-17 | Database authorisation test report | SEC | M1 |
| UXQA-18 | UX quality scorecard | QA | M8 |
| UXQA-19 | Prioritised UX improvement backlog | UX | continuous |
| UXQA-20 | Executive UX/UI assurance report | QA + UX | M8 |

Scenarios (Prompt B §6): **A** case switching and context restore; **B** two cases in two tabs, a change in one leaves
the other untouched; **C** workspace switching with permission checks; **D** global search, filters kept, no restricted
result; **E** notification generated in case A never appears as case B's record.

## 8. The three continuous QA components

| Component | What it proves | Layers | Where |
| --------- | -------------- | ------ | ----- |
| **Case Context Sentinel** (مراقب سلامة سياق القضية) | Every case number, recipient, notification, task and count on a screen or in a response belongs to the case and persona in context; nothing crosses between cases, tabs or workspaces | UI (DOM), API (BFF responses), DB (direct queries as `cdf_v13_user`) | `tests/sentinel/` (QA), DB half with SEC |
| **Procedural Truth Inspector** (مدقق الحقيقة الإجرائية) | Every status badge, progress mark and notification statement maps to a recorded event, or is labelled expected, conditional or awaiting approval | UI + domain + DB | `tests/truth/` (QA with PROC) |
| **Autonomous Design Critic** (الناقد البصري المستقل) | Specific, evidenced design findings from screenshots, page structure and the CDF design guide; each correction on its own branch, re-tested before it is proposed | UI | `tests/critic/` + `docs/design/critic/` (UX with QA) |

Epistemic mapping (Chief Architect ruling, 28 Oct 2026, on PROC, UX and QA questions; DOM values from ADR-013). The
domain keeps the reference package's seven classes; `lib/domain` maps them to the four DOM values:

- `RECORDED_FACT` → `recorded`, with its event id.
- `DERIVED_FROM_VERIFIED_FACTS` → `recorded`, only when the shown status is exactly what the PROC-001 fold yields from
  the case's recorded events. Its `data-event-id` is the latest recorded event of the same case that the derivation
  rests on. Other derivations (counts, percentages, forecasts) are plain text with `data-count`, never a badge.
- `EXPECTED_PROCESS` → `expected`.
- `CONDITIONAL_STEP` → `conditional`.
- `SUBJECT_TO_APPROVAL` → `awaiting_approval`.
- `PROPOSED_ACTION` and `UNVERIFIED_INFORMATION` are refused: never a badge in M1. A new DOM value needs a new ADR
  with its Inspector rule.

## 9. Working cycle and teams

Plan → delegate → execute in parallel → review → integrate → test → correct → deploy to staging → verify → continue.

Seven teams (`docs/AGENT_TASK_BOARD.md`): ARCH (Chief Architect, also DevOps), DB, PROC, FE, UX, QA, SEC. Each team
works in its own thread on its own branches and paths, reports through `docs/teams/<team>/STATUS.md` and a message to
the Chief Architect, and has its PRs reviewed by another team. The Chief Architect integrates into `develop`, runs the
full suite after each integration, applies reviewed migrations to the hosted schema with the plan's procedure, and
keeps this plan, the board and the status file current.

## 10. Environments

| Environment | Database | App | Data | Purpose |
| ----------- | -------- | --- | ---- | ------- |
| Local | PostgreSQL 16 started by `pnpm db:local` (no Docker), same roles and migrations | `pnpm dev` | synthetic seed | development, unit/DB/e2e tests |
| CI | PostgreSQL 17 service container in GitHub Actions (the hosted project runs 17.11) | production build | synthetic seed | every PR and push |
| Staging | `cdf_notifications_v13` in CDF GC Review | Vercel preview of `develop` | synthetic seed | integration, Gate J smoke, owner review |
| Production | none | blocked | — | blocked by ADR-005 / QG-13 |

## 11. Hosting gate (ADR-005)

All UNVERIFIED today: data classification · Saudi data residency · database region and hosting arrangement · Vercel
processing locations · contractual and cybersecurity approvals · identity architecture · records retention ·
incident response and backup. Production promotion stays blocked until each has evidence.

## 12. Risks

Technical risks T1–T15 and security risks S1–S13 are in `docs/CURRENT_STATE_ARCHITECTURE.md` §6–§7. Shared-database
residual risks are in `docs/hosted/ISOLATION_AND_RECOVERY_PLAN.md` §9. Open items are in `docs/OPEN_ISSUES.md`.
