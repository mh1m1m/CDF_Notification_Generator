# CLAUDE.md — governing rules for CDF V13 Enterprise

**CDF Case & Notification Intelligence Platform — V13 Enterprise** (منصة ذكاء القضايا والإشعارات — الإصدار 13 المؤسسي)

These rules bind every Claude session and every team thread that works in this repository. They apply together with the
CDF build protocol and the CDF Connected Engineering Operating Model (CDF-CEOM) that govern the sibling repository
`mh1m1m/cdf_case_management`; where this file is silent, those rules apply. The owner's binding decisions are recorded in
`docs/ARCHITECTURE_DECISIONS.md` and are never re-raised.

## 0. What this repository is

- **Classification: SYNTHETIC-DATA REFERENCE IMPLEMENTATION.** Not CDF production, not Saudi-resident hosting, not an
  authorised whistleblowing channel, not a channel for real notifications. Never describe it as any of these and never
  write "production ready".
- Repository: `mh1m1m/CDF_Notification_Generator` (the existing repository; never create another).
- Hosting (prototype): Vercel project `cdf_notification_generator` (fra1, Vercel Authentication on every deployment).
- Database (prototype): the existing Supabase project **CDF GC Review** (`jeseeznffxlxmcljpmiu`), dedicated schema
  `cdf_notifications_v13`, which it **shares with another application**. ADR-012 and
  `docs/hosted/ISOLATION_AND_RECOVERY_PLAN.md` govern every database action there.
- Production path (not built here): CDF Alibaba Cloud Riyadh, RDS PostgreSQL, OSS, KMS, SLS/SIEM, CDF corporate IdP.
  Mark every simulated capability `PRODUCTION_SUBSTITUTION_REQUIRED` in code and docs.

## 1. Data safety — absolute

- Synthetic data only: _Employee Alpha_, _Investigator Beta_, _Witness Gamma_, _Secretary Alpha_, _Governance Officer
  Delta_; seeded case numbers `CDF-DEMO-2026-0001` … `CDF-DEMO-2026-0010` (unit-test fixtures that are never seeded
  may use other `CDF-DEMO-2026-NNNN` numbers); e-mail addresses `@example.test`.
- No real reports, allegations, cases, identities, personal data, documents, evidence, credentials, regulatory data or
  real CDF e-mail addresses — in code, fixtures, tests, screenshots, commits, PRs, issues, logs, Sentry or Mixpanel.
- Never open or copy `/mnt/project-files/uploads/hearth/be02c96c-1d82-4401-89e9-9cd0406d23ec` (real personal data).
- Never modify the V12/V13 evidence folders under `/mnt/project-files/notifications/` (generator, journeys, templates,
  exports, review, registers, uploads, v13, v13_release). Read them; copy synthetic material only.

## 2. The shared database (ADR-012) — read before any database work

- V13 lives **only** in schema `cdf_notifications_v13` and the roles `cdf_v13_owner` (NOLOGIN owner), `cdf_v13_app`
  (the app's only login) and `cdf_v13_user` (per-request role). Never create, alter, grant, revoke, comment on or drop
  anything else. Never touch the other application's schema, roles, functions, policies or data.
- Migrations are `database/migrations/NNNN_name.sql`, applied in order, recorded in
  `cdf_notifications_v13.schema_migrations`. **Never use the Supabase migration tool (`apply_migration`)**; it would
  write the other application's migration history. Applied migrations are never edited.
- Every hosted migration follows the plan's procedure: `pnpm db:lint` → local + CI green → independent review ACCEPT →
  hosted dry run (ROLLBACK) → apply → fingerprint unchanged → `database/hosted/isolation_checks.sql` PASS → advisors.
  Only the Chief Architect runs SQL on the hosted project, and only these scripts and migrations that are reviewed and
  merged into `develop`. Team threads never connect to it. A fingerprint difference or isolation breach stops all
  hosted work (plan §8).
- From migration `0012` on, a migration that changes a policy, an RLS flag, an ACL, a trigger's enabled state or a
  function definition ends with its own `cdf_notifications_v13.policy_version` row (`V13-ACCESS-NNNN`, NNNN its number)
  as its last statement, and `tests/integration/audit-outcome-policy-version.spec.ts` is extended to that row in the
  same PR. The post-apply check P10 fails when the live `_policy_fingerprint()` differs from the highest row.
- `database/hosted/rollback_v13.sql` runs **only on the owner's explicit word**.
- No Supabase Auth users, Storage buckets, Realtime, Vault, Edge Functions, extensions or Data API exposure for V13.
- V13 code never issues `NOTIFY`/`LISTEN`; advisory locks use the V13 namespace
  (`pg_advisory_xact_lock(hashtext('cdf_notifications_v13'), key)`).

## 3. Architecture rules

- One Next.js 16 App Router application (TypeScript strict, ESM, Node 22, pnpm). Next.js is presentation, BFF and UI
  orchestration. Business rules live in `lib/domain`, `lib/journeys`, `lib/notifications` (pure TypeScript) and in
  database command functions.
- Every infrastructure dependency sits behind a port in `lib/contracts` (e.g. `CaseSourceAdapter`, `IdentityProvider`,
  `AuditSinkPort`, `NotificationDispatchPort`, `ClockPort`). Implementations live in `lib/db`, `lib/auth` or
  `lib/adapters`. The `CaseSourceAdapter` architecture is an owner instruction: case data always comes through it.
- Data access is server-side SQL only (`postgres` driver, `prepare: false`) inside a per-transaction security context:
  `set_config('request.v13.claims', …, true)` + `SET LOCAL ROLE cdf_v13_user`. The browser never talks to the database.
  No `@supabase/*` package anywhere.
- Writes go through `cdf_notifications_v13.api_*` `SECURITY DEFINER` command functions (owned by `cdf_v13_owner`,
  `SET search_path = ''`, schema-qualified, authorisation checked inside, audit event written in the same transaction).
  `cdf_v13_user` has **no INSERT/UPDATE/DELETE on tables**.
- Case isolation is a first-class invariant: every read and write is keyed by `case_id` (UUID) and authorised for the
  current persona and workspace; display numbers (`CDF-DEMO-2026-NNNN`) are never keys; unknown and unauthorised look
  identical (404-equivalent, no existence leak).

## 4. Security rules

- RLS enabled on every V13 table, default deny, no privilege beyond what a policy needs. Authorisation enforced twice:
  application pre-check (`lib/authz`) **and** database (RLS + command checks). UI-only authorisation is prohibited.
- The audit ledger is append-only (no UPDATE/DELETE/TRUNCATE for anyone; hash-chained). Every command writes one.
- Notifications and their previews disclose only what the disclosure rules allow for that recipient and case; search
  and counts apply authorisation before results, facets or snippets.
- No secrets in Git; `.env.example` holds names only. The database URL, session secret and any token live only in Vercel
  (sensitive) or a developer's untracked `.env.local`. Never print, log or paste a secret.
- Errors shown to users are generic with a correlation ID; never stack traces, SQL errors or internal relationships.
  Never log credentials, session tokens or case narrative.
- Persona sign-in is a synthetic identity behind Vercel Authentication (ADR-004), enabled only by
  `V13_PERSONA_SIGNIN=enabled`. `PRODUCTION_SUBSTITUTION_REQUIRED`: CDF corporate IdP (OIDC).

## 5. Prohibited

Real or production data · secrets in Git or in the browser · disabling RLS · table write grants to application roles ·
audit modification paths · UI-only authorisation · sequential numbers as keys · cross-case data in any view, API or
notification · touching the other application's database objects · `apply_migration` · editing applied migrations ·
removing, skipping or weakening tests to get green · fabricated test results, deployments or agent activity ·
presenting a prototype substitution as a production control · **merging to `main` without the owner's merge** (only the
owner merges `develop` → `main`; Claude never merges to `main`).

## 6. How the swarm works (details in `docs/AGENT_TASK_BOARD.md`)

- Teams: ARCH (Chief Architect, also DevOps), DB, PROC, FE, UX, QA, SEC. Each team owns paths; **never edit a path
  another team owns** — ask the owner team through the Chief Architect. Shared files (`package.json`, lockfile,
  configs, `lib/contracts`, `CLAUDE.md`, `docs/*.md` master files) change only through ARCH.
- Branch from `develop`: `<feature|fix|security|docs|test>/V13-<TEAM>-<NNN>-<slug>`. PR into `develop`, title
  `[V13-<TEAM>-<NNN>] …`, body with the CEOM sections (Linear Issue · Summary · Why · Architecture Impact · Database
  Changes · Security Impact · Privacy/Data Impact · RLS Impact · Tests · Evidence · Deployment Impact · Production
  Substitution · Known Limitations). Linear refuses new issues (free plan limit, OPEN_ISSUES OI-001), so the task id
  stands in for the Linear issue until the owner frees it.
- Every PR is reviewed by the independent team named on the board (verdict comment `REVIEW: ACCEPT <sha>` or
  `REVIEW: CHANGES <sha>` with reasons). ARCH merges into `develop` (merge commits) only after ACCEPT of the exact head
  and green CI. `develop` → `main` is a milestone PR the owner merges.
- Each team keeps `docs/teams/<team>/STATUS.md` current: completed work, changed files, test evidence (commands and real
  counts), unresolved defects, dependencies. Report to the Chief Architect by cross-session message.
- Never claim a test passed, a deployment exists or a gate is met without having run or seen it.

## 7. Definition of done (security-sensitive work)

Requirement id (register) · migration (if any) · RLS policy · server authorisation · audit event · automated tests ·
**negative tests** (other case, other workspace, other persona, restricted, closed, unknown id) · docs updated · lint,
typecheck, unit, DB and e2e green · no secrets · reviewed ACCEPT. Answer for every feature: what requirement, where is
access enforced, what audit event, how tested, what production component replaces the prototype.

## 8. Commands

```bash
pnpm install
pnpm db:local start && pnpm db:reset   # local PostgreSQL 16 (no Docker) with V13 roles, migrations, seed
pnpm dev                               # http://localhost:3000
pnpm lint && pnpm typecheck && pnpm db:lint
pnpm test        # unit
pnpm test:db     # integration + security against the local database
pnpm test:e2e    # Playwright (PW_CHROMIUM_PATH=/opt/pw-browsers/chromium in Claude sandboxes)
```

## 9. Conventions

- Arabic RTL first, English LTR second; all user-facing text from `lib/i18n`; logical CSS properties only.
- One Zod schema per command in `lib/contracts` (validation), re-validated on the server and again in the database.
- `data-testid` on every interactive element used by tests.
- Dependencies need a reason in `docs/DEPENDENCIES.md`; exact versions; lockfile committed.
- Status words: COMPLETE · IN_PROGRESS · BLOCKED · NOT_STARTED · PRODUCTION_SUBSTITUTION_REQUIRED.
- Commit messages end with the session's `Co-Authored-By` and `Claude-Session` lines.
