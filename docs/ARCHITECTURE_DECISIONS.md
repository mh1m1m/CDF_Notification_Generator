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

Next free number: **ADR-013**.

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
