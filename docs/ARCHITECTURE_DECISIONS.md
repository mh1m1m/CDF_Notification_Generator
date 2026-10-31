# Architecture decisions — CDF V13 Enterprise

**SYNTHETIC-DATA REFERENCE IMPLEMENTATION — not CDF production.** One file holds every architecture decision record
(ADR) for this repository. A decision changes only through a new ADR that supersedes the old one; accepted ADRs are not
edited except to record that supersession. Owner decisions are binding and are never re-raised.

Status words: **ACCEPTED** (in force) · **PROPOSED** (in force as the default while the owner decides; work continues
on it) · **SUPERSEDED**.

| ADR | Title | Status | Decided by |
| --- | ----- | ------ | ---------- |
| [ADR-001](#adr-001--case-records-own-v13-records-behind-a-casesourceadapter) | Case records: own V13 records behind a `CaseSourceAdapter` | PROPOSED (owner card open) | Chief Architect default; owner instruction to keep the adapter |
| [ADR-002](#adr-002--one-nextjs-application) | One Next.js application | ACCEPTED | Chief Architect |
| [ADR-003](#adr-003--server-side-sql-in-a-per-transaction-security-context) | Server-side SQL in a per-transaction security context | ACCEPTED | Chief Architect |
| [ADR-004](#adr-004--synthetic-persona-identity-behind-vercel-authentication) | Synthetic persona identity behind Vercel Authentication | ACCEPTED | Chief Architect |
| [ADR-005](#adr-005--hosting-and-data-residency-gate) | Hosting and data-residency gate | ACCEPTED | Owner directive |
| [ADR-006](#adr-006--branching-and-release-flow) | Branching and release flow | ACCEPTED | Chief Architect; owner merges `main` |
| [ADR-007](#adr-007--task-board-while-linear-is-full) | Task board while Linear is full | ACCEPTED | Chief Architect |
| [ADR-008](#adr-008--testing-and-independent-review) | Testing and independent review | ACCEPTED | Chief Architect |
| [ADR-009](#adr-009--one-design-system-and-token-source) | One design system and token source | ACCEPTED | Chief Architect |
| [ADR-010](#adr-010--notification-dispatch-through-a-transactional-outbox) | Notification dispatch through a transactional outbox | ACCEPTED (scheduler: owner decision) | Chief Architect |
| [ADR-011](#adr-011--append-only-hash-chained-audit-ledger) | Append-only hash-chained audit ledger | ACCEPTED | Chief Architect |
| [ADR-012](#adr-012--v13-inside-the-shared-cdf-gc-review-supabase-project) | V13 inside the shared CDF GC Review Supabase project | ACCEPTED | Owner decision, 28 Oct 2026 00:29 UTC |
| [ADR-013](#adr-013--ui-localisation-and-dom-evidence-conventions) | UI, localisation and DOM evidence conventions | ACCEPTED | Chief Architect, on UX, FE, PROC and QA requests |
| [ADR-014](#adr-014--identity-and-request-claims-contract-with-authenticated-claims) | Identity and request-claims contract, with authenticated claims | ACCEPTED (§4 rotation sentence superseded by ADR-018) | Chief Architect, on SEC finding TM-S4 |
| [ADR-015](#adr-015--case-read-contract-portfolio-case-header-and-v13-records) | Case read contract: portfolio, case header and V13 records | ACCEPTED | Chief Architect, on FE-003/FE-004, DB-002/DB-008 and SEC reviews |
| [ADR-016](#adr-016--domain-catalogues-labels-and-server-only-use-in-the-ui) | Domain catalogues, labels and server-only use in the UI | ACCEPTED | Chief Architect, on PROC-001 and QA-004 reviews |
| [ADR-017](#adr-017--audit-attribution-from-verified-claims-and-the-audited-workspace-switch) | Audit attribution from verified claims, and the audited workspace switch | ACCEPTED | Chief Architect, on DB-001/DB-007 and SEC reviews |
| [ADR-018](#adr-018--claims-key-installation-rotation-and-health) | Claims-key installation, rotation and health | ACCEPTED | Chief Architect, on DB-009 (OI-022) and SEC reviews |
| [ADR-019](#adr-019--port-contracts-own-their-refusals) | Port contracts own their refusals | ACCEPTED | Chief Architect, on the FE-005 review (#32) |

Next free number: **ADR-020**.

---

## ADR-001 — Case records: own V13 records behind a `CaseSourceAdapter`

- **Status:** PROPOSED. The owner has an open decision card on this question; until it is answered the default below is
  in force. The owner's instruction of 28 Oct 2026 00:29 UTC says to keep the `CaseSourceAdapter` architecture.
- **Context.** V13 Enterprise needs persistent, independent cases. Two routes exist (E01 §9 Q1): a layer over the
  existing case-management platform (`mh1m1m/cdf_case_management`), or a standalone application with its own case
  records. The platform's hosted DEV is a different Supabase project, its packages are private to its own monorepo, and
  a second authoritative case store is a known risk (E01 risk T1).
- **Decision.** V13 keeps its **own synthetic case records** in `cdf_notifications_v13` (`case_record`, keyed by UUID,
  with display number `CDF-DEMO-2026-NNNN` and the columns `source_system` and `source_ref`). Every read of case data
  goes through the port `CaseSourceAdapter` (`lib/contracts`). The first implementation reads V13's own tables; a later
  implementation can read an authoritative source (the case platform's `api.*`, or the CDF case system in production)
  without changing pages, journeys or notifications.
- **Consequences.** Case isolation, authorisation and audit are fully testable here. The records are explicitly
  labelled as V13's own synthetic copies (`source_system = 'V13_SYNTHETIC'`), never as the authoritative case store.
  Swapping the source is an adapter change plus a data-ownership review.
  `PRODUCTION_SUBSTITUTION_REQUIRED`: the authoritative CDF case system.

## ADR-002 — One Next.js application

- **Status:** ACCEPTED.
- **Context.** V13 Enterprise has no public intake portal; every user is an authenticated CDF staff persona. The case
  platform needs two apps because its whistleblowing portal is untrusted; that reason does not apply here.
- **Decision.** One Next.js 16 App Router application at the repository root (TypeScript strict, ESM, Node 22, pnpm).
  Next.js is presentation, BFF and UI orchestration only. Business rules live in pure TypeScript (`lib/domain`,
  `lib/journeys`, `lib/disclosure`, `lib/authority`, `lib/notifications`) and in database command functions.
  `proxy.ts` (Next.js 16) handles security headers and the session gate.
- **Consequences.** One deployment, one Vercel project, one CI pipeline. If an external-recipient portal is ever
  needed, it becomes a second app with its own login role and secrets (a new ADR).

## ADR-003 — Server-side SQL in a per-transaction security context

- **Status:** ACCEPTED.
- **Decision.**
  - The browser never talks to the database. No `@supabase/*` package is used anywhere; there is no Data API exposure.
  - The server uses the `postgres` driver with `prepare: false` through the Supabase pooler in transaction mode,
    logged in as `cdf_v13_app` (ADR-012). The connection string lives only in the Vercel environment (sensitive).
  - Every request runs in one transaction that first executes `set local role cdf_v13_user` and
    `select set_config('request.v13.claims', <json>, true)`. RLS policies and command functions read the claims through
    one helper function; nothing reads them from session state.
  - `cdf_v13_user` has SELECT only where an RLS policy allows it, and **no INSERT/UPDATE/DELETE on any table**. Writes
    go through `cdf_notifications_v13.api_*` `SECURITY DEFINER` functions owned by `cdf_v13_owner`, with
    `SET search_path = ''`, schema-qualified names, the authorisation check inside, and the audit event in the same
    transaction.
  - Authorisation is enforced twice: an application pre-check (`lib/authz`) and the database (RLS + command checks).
  - Unknown and unauthorised identifiers produce the same response (no existence leak). Display numbers are never keys.
- **Consequences.** Session-level state cannot leak between requests on pooled connections (all state is
  transaction-local). Every query must be schema-qualified because the login's `search_path` is empty.
  `PRODUCTION_SUBSTITUTION_REQUIRED`: RDS PostgreSQL in CDF Alibaba Cloud Riyadh, credentials from KMS.

## ADR-004 — Synthetic persona identity behind Vercel Authentication

- **Status:** ACCEPTED.
- **Context.** The directive asks for authentication with synthetic test accounts. Supabase Auth is not used (ADR-012
  keeps V13 away from the shared project's Auth). The deployment is only for the owner and the build team.
- **Decision.**
  - Every Vercel deployment is protected by Vercel Authentication (team members only). This is the outer gate.
  - Inside, a synthetic persona sign-in (Secretary Alpha, Investigator Beta, Investigator Gamma, Governance Officer
    Delta, …) issues the cookie `__Host-v13_session`: HttpOnly, Secure, SameSite=Lax, Path=/, signed with jose HS256
    using `V13_SESSION_SECRET` (at least 32 bytes), 8-hour lifetime. The server verifies it on every request; the
    database re-checks that the persona exists and is active.
  - Persona sign-in works only when `V13_PERSONA_SIGNIN=enabled`. Without the flag it refuses (fail closed).
  - The identity sits behind the port `IdentityProvider` (`lib/contracts`).
- **Consequences.** No passwords are stored or typed. Anyone who passes Vercel Authentication can choose any persona,
  which is acceptable only for synthetic data. `PRODUCTION_SUBSTITUTION_REQUIRED`: the CDF corporate IdP (OIDC) with
  MFA, roles from the CDF directory.

## ADR-005 — Hosting and data-residency gate

- **Status:** ACCEPTED (owner directive, Prompt A Part V).
- **Decision.** This repository runs **synthetic data only**. Production promotion stays blocked until each of these is
  verified with evidence: approved data classification; Saudi data-residency requirements; database region and hosting
  arrangement; Vercel hosting and processing locations; contractual and cybersecurity approvals; approved identity
  architecture; records-retention requirements; incident-response and backup arrangements. Today every item is
  UNVERIFIED. The Supabase project is in `eu-central-1` and the Vercel functions run in `fra1`; neither is in Saudi
  Arabia.
- **Consequences.** Quality gate QG-13 (Production Authorization) stays FAILED/BLOCKED and visible; no document in this
  repository claims production readiness. Deploying to Vercel or using Supabase is not a cybersecurity or residency
  approval.

## ADR-006 — Branching and release flow

- **Status:** ACCEPTED.
- **Decision.**
  - `main` is the protected release line. Only the owner merges into it (milestone PRs `develop` → `main`). Claude never
    merges to `main`.
  - `develop` is the integration branch. Team work happens on `<feature|fix|security|docs|test>/V13-<TEAM>-<NNN>-<slug>`
    branched from `develop`; PRs target `develop`; the Chief Architect merges them (merge commits) after an independent
    ACCEPT of the exact head and green CI.
  - Vercel builds a preview for every pushed branch and PR. The `develop` preview is the **synthetic staging**
    environment. Production deployments come only from `main`, and production stays blocked by ADR-005.
  - Migrations: one numbered file per PR, applied in number order (ADR-012 procedure).
- **Consequences.** Teams never edit each other's paths; shared files change only through the Chief Architect.

## ADR-007 — Task board while Linear is full

- **Status:** ACCEPTED.
- **Context.** CDF-CEOM makes Linear the system of record for work items. Creating issues failed: the Linear workspace
  is at its free-plan issue limit (OPEN_ISSUES OI-001).
- **Decision.** Task ids `V13-<TEAM>-<NNN>` in `docs/AGENT_TASK_BOARD.md` stand in for Linear issues. Branches and PR
  titles carry the task id. When Linear has room, each open task gets one Linear issue with the same id in its title,
  and the board links it.
- **Consequences.** The board is the single source for V13 task status until then; it is updated in the same PR as the
  work it describes.

## ADR-008 — Testing and independent review

- **Status:** ACCEPTED.
- **Decision.**
  - Vitest for unit tests and for database integration and security tests against a local PostgreSQL 16 cluster
    started without Docker (`pnpm db:local`), with the same three V13 roles and the same migrations as the hosted
    project. Playwright (with axe) for end-to-end, accessibility, RTL, responsive and visual tests.
  - Every PR is reviewed by an independent team (board), which posts `REVIEW: ACCEPT <sha>` or
    `REVIEW: CHANGES <sha>`. QA's own PRs are reviewed by the Chief Architect.
  - Security-sensitive work needs negative tests: other case, other workspace, other persona, restricted case, closed
    case, unknown id.
  - Test results are recorded with the command, commit and real counts in `docs/TEST_EVIDENCE.md`. A failing mandatory
    gate stays visible; no test is skipped or weakened to get green.
- **Consequences.** Three independent checks run continuously: the Case Context Sentinel, the Procedural Truth
  Inspector and the Autonomous Design Critic (`docs/MASTER_EXECUTION_PLAN.md` §8).

## ADR-009 — One design system and token source

- **Status:** ACCEPTED.
- **Decision.** One CSS token file (`styles/tokens.css`) derived from the CDF Design Tokens v1.1 primitives with the
  AA-adjusted semantic layer already used by the case platform (`packages/ui/src/tokens.css` there), light and dark,
  Arabic RTL first, logical CSS properties only. V13's e-mail tokens are used only for e-mail rendering. The brand
  Arabic font is SOURCE_REQUIRED (OPEN_ISSUES OI-005); until it is supplied a documented fallback stack is used and
  labelled.
- **Consequences.** No component defines its own colours, spacing or fonts. All user-facing text comes from `lib/i18n`.

## ADR-010 — Notification dispatch through a transactional outbox

- **Status:** ACCEPTED. Whether a scheduled dispatcher may run on Vercel is an owner decision (OPEN_ISSUES OI-015).
- **Decision.** A notification is a case-keyed record with immutable versions (template version, policy version,
  content hash, idempotency key unique in the database). Approval and dispatch are `api_*` commands. Dispatch writes a
  **content-free** outbox row in the same transaction; every delivery attempt is its own append-only row; retries use
  backoff and end in a dead-letter state. The sender is a labelled stub that sends nothing; a read mark or an export
  never counts as delivery.
- **Consequences.** Delivery tracking, retry and correction are testable without sending anything.
  `PRODUCTION_SUBSTITUTION_REQUIRED`: the approved CDF mail gateway and scheduler.

## ADR-011 — Append-only hash-chained audit ledger

- **Status:** ACCEPTED.
- **Decision.** `cdf_notifications_v13.audit_event` is append-only: UPDATE, DELETE and TRUNCATE are rejected for every
  role by trigger and by privilege. Each row carries the previous row's hash; the chain is serialised with
  `pg_advisory_xact_lock(hashtext('cdf_notifications_v13'), <key>)` so it never touches another application's lock
  space. Every command writes its event in its own transaction. Audit metadata holds ids and codes only, never case
  narrative or free-text reasons.
- **Consequences.** The global chain lock limits write throughput; QG-10 performance evidence must measure it.
  `PRODUCTION_SUBSTITUTION_REQUIRED`: CDF SLS/SIEM export.

## ADR-012 — V13 inside the shared CDF GC Review Supabase project

- **Status:** ACCEPTED. Owner decision of 28 Oct 2026 00:29 UTC: use the existing Supabase project CDF GC Review with a
  dedicated schema `cdf_notifications_v13`; do not create another project; do not upgrade; preserve every GC Review
  object and its data; inspect dependencies and prepare a recovery plan before any migration; stop database changes if
  safe isolation cannot be demonstrated.
- **Decision.**
  - V13 owns exactly one schema, `cdf_notifications_v13`, and three roles: `cdf_v13_owner` (NOLOGIN; owns every V13
    object), `cdf_v13_app` (the app's only login; NOINHERIT; 8 connections; 10 s statement, 15 s idle-in-transaction,
    3 s lock timeouts; empty `search_path`) and `cdf_v13_user` (the per-request role). None is superuser, none bypasses
    RLS, none can create roles or databases.
  - The V13 roles hold no privilege outside the V13 schema; PUBLIC and every GC Review or Supabase API role hold nothing
    on it. V13 keeps its own migration history (`cdf_notifications_v13.schema_migrations`) and never writes
    `supabase_migrations`. The Supabase migration tool is never used for V13.
  - V13 uses no Supabase Auth, Storage, Realtime, Vault, Edge Functions, extensions or Data API exposure, and never
    issues `NOTIFY`/`LISTEN`.
  - Every hosted change follows the go/no-go procedure in `docs/hosted/ISOLATION_AND_RECOVERY_PLAN.md`: local rehearsal,
    hosted dry run, apply, fingerprint of all non-V13 objects identical before and after, isolation checks PASS,
    advisors, GC Review still working. `database/hosted/rollback_v13.sql` removes everything V13 created and runs only on
    the owner's explicit word.
- **Evidence.** Bootstrap applied 28 Oct 2026 01:03:21 UTC; fingerprint of 648 non-V13 objects identical before and
  after; isolation PASS (27 checks, 0 breaches); re-verified 01:18 UTC (`docs/TEST_EVIDENCE.md` §2).
- **Consequences.** Residual risks that cannot be removed while one database is shared are listed in the plan §9
  (catalog metadata visibility, shared CPU/memory/connections, shared administrator, project-level settings).
  `PRODUCTION_SUBSTITUTION_REQUIRED`: a dedicated database in the CDF Alibaba Cloud Riyadh RDS PostgreSQL instance.

## ADR-013 — UI, localisation and DOM evidence conventions

- **Status:** ACCEPTED. Chief Architect, 28 Oct 2026, answering the questions of UX (styling, strings, component
  tests, icons), FE and PROC (string namespaces) and QA (attribute contracts, `docs/qa/TEST_ARCHITECTURE.md` §5).
- **Decision.**
  - **Styling.** Tailwind CSS 4 (`tailwindcss` with `@tailwindcss/postcss`, the only CSS tooling). Design tokens are
    CSS custom properties in `styles/tokens.css`, exposed through `@theme` (ADR-009; UX owns `styles/**`). Logical CSS
    properties only (lint-checked). UX ruling D1 applies: square corners for buttons, cards, inputs and tables (CDF
    Design Guide pp. 33, 37), pill shape only for status chips.
  - **Icons.** Inline SVG React components in `components/icons`; no icon library; decorative icons are `aria-hidden`.
  - **Strings.** One folder per namespace: `lib/i18n/<namespace>/ar.ts` exports a flat `as const` object and
    `lib/i18n/<namespace>/en.ts` is typed `Record<keyof typeof ar, string>`, so a missing or extra English key fails
    typecheck. Namespace ids are camelCase: `common`, `shell` (UX); `status`, `journeys` (PROC); `auth`, `portfolio`,
    `case`, `myWork`, `notifications`, `workspaces` (FE); `persona` (ARCH). `lib/i18n/index.ts` (ARCH) registers all of
    them; keys are addressed `<namespace>.<key>`. Arabic is the default locale (`dir="rtl"`). A new namespace goes
    through ARCH.
  - **Component tests.** `react-dom/server` `renderToStaticMarkup` in Vitest's node environment
    (`tests/unit/**/*.spec.{ts,tsx}`); interaction behaviour is tested with Playwright. No Testing Library or jsdom
    unless a later PR shows the need, with its reason in `docs/DEPENDENCIES.md`.
  - **DOM evidence attributes** (the contract the Case Context Sentinel and the Procedural Truth Inspector read):
    - every element that owns a case's content (case workspace root, portfolio row, My Work task row, notification
      row, preview) carries `data-case-id` (the case UUID) and `data-case-ref` (its display number); the case workspace
      root also carries `data-testid="case-workspace"`;
    - the workspace switcher carries `data-testid="workspace-switcher"` and `data-workspace-code`;
    - every count shown carries `data-testid="count-<name>"` and `data-count`;
    - every StatusBadge, Timeline entry and progress mark carries `data-epistemic` (`recorded` · `expected` ·
      `conditional` · `awaiting_approval`), `data-event-id` (required exactly when `recorded`), `data-status-kind` and
      `data-status`; the component's type makes a `recorded` badge without an event id impossible.

    These attributes repeat only what the element already shows to a viewer who may see it. They are
    production-safe and never a test bypass.
- **Consequences.** The Sentinel enforces: inside an element with `data-case-id=X`, no descendant carries another
  `data-case-id` and no text contains another case's reference. A component that renders case content without these
  attributes fails review.

## ADR-014 — Identity and request-claims contract, with authenticated claims

- **Status:** ACCEPTED. Chief Architect, 28 Oct 2026, on SEC finding TM-S4 (HIGH) and recommendations SEC-REC-01..04
  (`docs/security/THREAT_MODEL.md`), aligned with DB's migration 0001 draft. Extends ADR-003 and ADR-004.
  **Supersession (31 Oct 2026):** the rotation sentence of §4 ("Rotation: the Chief Architect clears the key … the
  application installs the new one") is superseded by [ADR-018](#adr-018--claims-key-installation-rotation-and-health),
  which fixes the order of the steps. The rest of this ADR is unchanged.
- **Context.** `request.v13.claims` is an ordinary setting: any SQL running inside the request transaction (for
  example through an injection in the BFF) can overwrite it, or `reset role`, and act as any persona. The foundation
  and DB's draft also used different claim shapes.
- **Decision.**
  1. **Authority.** The database is the authority for personas, workspaces, memberships (persona × workspace × role,
     with a validity window) and roles. `lib/contracts` mirrors the seed's fixed ids (personas `0b…`, workspaces
     `0a…`) and memberships, for sign-in and the application pre-check. A unit test pins the mirror; a DB integration
     test compares it with the seed.
  2. **Session.** The cookie (ADR-004) carries `persona_id` and `active_workspace` (its code). A workspace switch
     re-issues the cookie and is allowed only to a workspace in which the persona holds a membership; the database
     re-checks the membership on every request. The negative-test personas (expired membership, inactive persona)
     exist in the seed and the registry but are not offered on the sign-in page.
  3. **Claims.** Each request transaction sets `request.v13.claims` to exactly
     `{"v":1,"persona_id":"<uuid>","workspace_id":"<uuid>","correlation_id":"<uuid>"}`. Roles are never sent; the
     database derives them from active memberships.
  4. **Claims MAC (SEC-REC-01).** The server also sets `request.v13.claims_mac` = base64url(HMAC-SHA256(K, claims ‖
     "|" ‖ a value unique to the transaction)), for example `pg_current_xact_id()` read in the same transaction.
     K = HKDF-SHA256 of `V13_SESSION_SECRET` with info `cdf-v13/request-claims/v1`, so no new secret exists. The
     database keeps K in an owner-only table (RLS on, deny-all, no grants). The claims helpers (`SECURITY DEFINER`,
     owned by `cdf_v13_owner`, core SQL only, no extension) recompute the MAC and resolve to NULL on any mismatch, so
     a forged or replayed claim grants nothing. The application installs K through one command that succeeds only
     while no key exists (idempotent for the same key; audited without key material). Rotation: the Chief Architect
     clears the key with a reviewed hosted script and the application installs the new one.
  5. **Role check (SEC-REC-02).** Policies also require `current_user = 'cdf_v13_user'`; `cdf_v13_app` holds no
     privilege of its own.
  6. **Audit chain (SEC-REC-03).** `verify_audit_chain()` runs after every hosted migration and in the staging checks;
     the hosted isolation checks gain a check that the audit trigger is enabled.
  7. **Deployments (SEC-REC-04).** Vercel Git fork protection stays on, and the database URL and session secret are
     scoped to the `develop` branch preview only, so previews of forked pull requests never receive them.
- **Consequences.**
  - Built by DB in V13-DB-001 (migration 0001 and `lib/db/security-context.ts`) and reviewed by SEC. Until it is
    merged, TM-S4 stays HIGH and the control is parameterised SQL only (no `unsafe` calls outside migration tooling,
    lint-enforced).
  - Residual risk: an injection that ran before the first key install could plant its own key; the real application's
    MACs would then fail and every request would see nothing, so the plant is detected at once. Reading the
    transaction value costs one extra round trip per request.
  - `PRODUCTION_SUBSTITUTION_REQUIRED`: the CDF corporate IdP issues signed tokens, and the ASP.NET Core API on CDF
    Alibaba Cloud Riyadh sets the database context with a key held in KMS.

---

## ADR-015 — Case read contract: portfolio, case header and V13 records

- **Status:** ACCEPTED. Chief Architect, 31 Oct 2026, on the reviews of FE-003 (#19), FE-004 (#23), DB-002 (#15) and
  DB-008 (#21), with SEC's rulings. Extends ADR-001 and ADR-003.
- **Context.** The five M1 screens read cases from the `CaseSourceAdapter` and V13's own procedural and notification
  records. Totals and counts must never reveal a case the persona may not see (directive §40). Paging must be stable,
  and the UI must never render a row that breaks the contract.
- **Decision.**
  1. **Case summary.** `CaseSummary` carries:
     - `case_id`, the uuid key;
     - `case_number`, `CDF-DEMO-2026-NNNN`, for display only and never a key;
     - exactly one of `title_key` (an i18n key) or `synthetic_title` ({ar, en} synthetic text);
     - `lifecycle_stage` (a code), `records_state` (ACTIVE or CLOSED) and `is_restricted`;
     - `source_system` (a code), `source_ref` and `updated_at`. `source_ref` uses the database's pattern
       `^[A-Za-z0-9._:-]{1,80}$`.
  2. **Portfolio.** `CaseListFilter` has:
     - `records_state` and `lifecycle_stage`;
     - `text`: 1–100 characters, no control characters, matched only within the cases the identity may already see;
     - `limit`: 1–99, default 25;
     - an opaque cursor of at most 512 characters, where a malformed cursor is a generic validation error;
     - `assigned_to_me`: an active case assignment in any capacity (task-only assignees excluded).

     The adapter reads `portfolio_count` and `portfolio_page` in **one statement**. Both therefore see one snapshot, with
     RLS applied before the count. `total` counts only authorised cases matching the same filters, cursor aside.
     - `PORTFOLIO_DB_ROW_BOUND` = 100, the function's clamp.
     - `PORTFOLIO_PAGE_MAX` = 99, because the adapter reads one look-ahead row to know whether a next page exists
       (OI-025).
     - A page longer than its own total is refused.
     - The row summaries `last_event_id` and `last_event_at` are set together or are both null. `my_open_task_count`
       counts the identity's own open tasks in that case.
  3. **Case header.** `CaseSourceAdapter.getCase` returns `CaseHeader`: the summary plus `my_capacity`, the caller's own
     active capacity on the case, as a code or null. An unknown case and an unauthorised case both give `null`.
  4. **V13 records.** `ProceduralRecordsReader` (`listEvents`, `listTasks`) and `NotificationRecordsReader`
     (`listForCase`) read through the SECURITY INVOKER functions `case_events`, `case_tasks` and `case_notifications`.
     RLS applies inside every call, and an unknown case and an unauthorised case both give zero rows.
     - Every row must belong to the case asked for, which the adapter checks again.
     - Capacities appear as codes, plus `is_mine`. A persona id is never returned.
     - V13 is the system of record for these records. Only their hosting is a production substitution.
  5. **Fail closed.** A row that breaks the Zod contract refuses the whole result: the BFF answers UNAVAILABLE with a
     correlation id, never a partial page. Reads use explicit column lists, never `select *`, and unit tests pin this.
  6. **No column grants** on `case_assignment`, `task` and `procedural_event` (ruling on SEC's INFO note, #21).
     - `cdf_v13_user` keeps SELECT under RLS on these tables, persona ids included, for the cases it may access. That is
       within the access matrix.
     - The invoker read functions need `persona_id` to compute `is_mine` and `my_capacity`. A column restriction would
       force them to SECURITY DEFINER and take the check out of RLS.
     - The BFF reads only through the read functions, and SEC's static boundary suite checks that.
- **Consequences.**
  - Lists of events, tasks and notifications per case are not paged in M1. Synthetic volumes are at most 20 rows per
    case, and OI-026 tracks paging.
  - Task statuses come from migration 0003. Their catalogue moves to `lib/domain` with PROC-006 (OI-029).
  - `PRODUCTION_SUBSTITUTION_REQUIRED`: the production case source is the CDF case system of record, reached through the
    ASP.NET Core API on CDF Alibaba Cloud Riyadh. V13's own records move to RDS PostgreSQL.

---

## ADR-016 — Domain catalogues, labels and server-only use in the UI

- **Status:** ACCEPTED. Chief Architect, 31 Oct 2026, on the reviews of PROC-001 (#18) and QA-004 (#22). Extends ADR-013.
- **Context.** Status codes, epistemic states and their labels must mean the same in the domain rules, the Truth
  Inspector and the UI. The UI must not become a second place where procedural truth is decided.
- **Decision.**
  1. **Labels.** Domain labels are {ar, en} data in `lib/domain` and `lib/journeys`, next to their codes. The `status`
     and `journeys` i18n namespaces mirror them when the first UI keys land, and a unit test pins the mirror.
     Components render text only through `lib/i18n`.
  2. **Catalogues.** `COMPLETED_CLASS_STATUSES` and the epistemic lists live in `lib/domain`. PROC owns them, and the
     Truth Inspector (QA) imports them instead of keeping copies. The case task status catalogue (`CASE_TASK_STATUSES`,
     PROC-006) follows the same rule and is pinned to the database constraint.
  3. **Server-only.** UI code uses `lib/domain` only on the server, never in a `"use client"` module. A recorded
     `event_id` shown on a badge comes only from the authorised case's own rows.
  4. **Rule texts and document markings** (clarification, Chief Architect, 31 Oct 2026, on the review of PROC-007,
     #48). The consistency-rule messages, the next-action rule texts and the export's status labels are domain data of
     the same kind: {ar, en} next to their codes in `lib/notifications`. When a UI component first renders one, PROC
     mirrors it into `lib/i18n` with a unit test that pins the mirror, and the component renders through `lib/i18n`.
     A fixed bilingual marking of a generated document (the export's notice: both languages always printed together,
     never switched by locale) stays with the code that writes the document. The notification renderers' wording
     is user-facing text and lives in the PROC-owned `notificationRender` namespace (#48, OPEN_ISSUES OI-036).
- **Consequences.** A status shown in the UI is either derived from a recorded event or shown as not recorded (rule T5,
  test T8). A new status code needs a catalogue change in `lib/domain` (PROC) before any UI uses it.

---

## ADR-017 — Audit attribution from verified claims, and the audited workspace switch

- **Status:** ACCEPTED. Chief Architect, 31 Oct 2026, on the reviews of DB-001 (#12) and DB-007 (#17), with SEC's notes.
  Extends ADR-011 and ADR-014 §2.
- **Context.** An audit row is only as trustworthy as its attribution. A command parameter such as a correlation id
  could be forged by the caller. A workspace switch changes what a persona sees, so it must leave a record.
- **Decision.**
  1. **Attribution.** Audit attribution comes only from the verified claims (ADR-014 §4). Commands take no
     `p_correlation_id`. `_append_audit` takes five arguments, and the correlation id is read from
     `current_correlation_id()`.
  2. **Workspace switch.** It is the command `api_switch_workspace(p_workspace_id)`. The target must be an active
     workspace in which the persona's membership is valid now. NULL, unknown, inactive and non-member targets are
     refused alike, and a refused switch writes nothing.
     - A successful switch writes one `WORKSPACE_SWITCHED` audit row with ids only.
     - The BFF re-issues the session cookie only after the command commits, and a switch keeps the session's expiry.
- **Consequences.**
  - The database still re-checks the membership on every request, so even a cookie written early could not widen
    access (OI-023).
  - Repeated switches can pad the ledger at request rate. A BFF rate limit after M1 addresses that (OI-024).

---

## ADR-018 — Claims-key installation, rotation and health

- **Status:** ACCEPTED. Chief Architect, 31 Oct 2026, on DB-009 (#28, OI-022) and SEC's review. Supersedes the
  rotation sentence of ADR-014 §4.
- **Context.** The claims key K (ADR-014 §4) is installed once, first writer wins. A deployment whose
  `V13_SESSION_SECRET` derives a different K fails closed on every request. Before DB-009 nothing showed which state a
  deployment was in.
- **Decision.**
  1. **Installation.** `instrumentation.ts` `register()` calls `installClaimsKeyAtStartup`.
     - It never throws, and it logs one line holding a code only.
     - If the install fails, `withRequestContext` retries it on the next request.
     - `api_install_claims_key` is idempotent for the same key. It refuses a different key (V1409) and writes an audit
       row without key material.
  2. **Shared secret.** Every deployment that holds `V13_DATABASE_URL` must hold the same `V13_SESSION_SECRET`. ADR-014
     §7 scopes both to the `develop` branch preview.
  3. **Rotation order.**
     1. Set the new secret in Vercel and redeploy. Health then shows `CLAIMS_KEY_MISMATCH`.
     2. Run the reviewed `database/hosted/reset_claims_key.sql`. It deletes the key row and audits `CLAIMS_KEY_CLEARED`.
        Health shows `CLAIMS_KEY_NOT_INSTALLED`.
     3. The first request context installs the new key, and health shows `ok`.
  4. **Health.** `/api/health` reports `db.claims_key` as a code only, computed with a transaction-bound HMAC probe over
     a domain-separated label (`claims_key_state`, migration 0007).
     - INSTALLED_MATCH means `ok`.
     - INSTALLED_MISMATCH gives 503 `CLAIMS_KEY_MISMATCH`.
     - NOT_INSTALLED gives 503 `CLAIMS_KEY_NOT_INSTALLED`.
     - NOT_CHECKED, when the deployment has no usable session secret, does not degrade health. That deployment has no
       claims context to verify.
- **Consequences.**
  - Monitoring must expect `CLAIMS_KEY_NOT_INSTALLED` after a reset, and on a fresh deployment until the first request
    context (SEC INFO on #28).
  - `PRODUCTION_SUBSTITUTION_REQUIRED`: production keeps the key in CDF KMS and checks it by key id.

---

## ADR-019 — Port contracts own their refusals

- **Status:** ACCEPTED. Chief Architect, 31 Oct 2026, on the review of FE-005 (#32, ARCH CHANGES `38664b8`, ACCEPT
  `018b46e`). Extends ADR-003 and ADR-015.
- **Context.** A port in `lib/contracts` is the seam where the prototype implementation (V13's own PostgreSQL records)
  is replaced by the production one (the CDF case system behind the ASP.NET Core API on Alibaba Cloud Riyadh). In #32,
  `lib/server/my-work.ts` decided between the stale-version message and the generic message by catching an error class
  exported by the prototype adapter. A production adapter could then only be substituted by importing from the
  prototype adapter, which turns the dependency the wrong way.
- **Decision.**
  1. Any refusal a port's caller branches on is part of the port's contract. Its code list and its error class live in
     `lib/contracts`, next to the port, as pure TypeScript.
  2. The port's doc comment says how a refusal is signalled and that any other error is an unexpected failure. For
     example: "a refusal throws `TaskCommandRefusedError` with one of `TASK_COMMAND_REFUSALS`".
  3. Adapters map their own failure codes (for V13, the commands' SQLSTATEs) onto the contract's codes and let anything
     unmapped propagate unchanged. `lib/server` imports refusal types only from `@/lib/contracts`. Adapters are imported
     only by the composition roots (`lib/server/*-binding.ts`, `lib/server/case-source.ts`, `lib/server/records.ts`).
  4. The refusal error's message is the refusal code only: nothing caller-supplied and nothing from the database.
- **Consequences.**
  - `TaskCommandRefusedError` moved into `lib/contracts/my-work.ts` (#32).
  - `InvalidCursorError`, which `lib/server/cases.ts` still imports from `lib/adapters/case-source/cursor.ts`, follows
    in an FE follow-up after #19 (OI-031).
  - New command ports (notification drafts, FE-006) start this way.
