# E01 — Current-state architecture

**CDF Case & Notification Intelligence Platform — V13 Enterprise · deliverable E01 · 2026-10-28**
**SYNTHETIC-DATA REFERENCE IMPLEMENTATION — not CDF production.** A read-only audit of what exists before the multi-case app is built in `mh1m1m/CDF_Notification_Generator`. Labels: **FACT** = read from the cited `path:line` or counted here; **ARCHITECT-VERIFIED** = stated by the Chief Architect, not re-checked; **INFERENCE**; **UNVERIFIED**. Nothing here is approved, deployed or production-ready.

> **Status of this audit (added 28 Oct 2026 01:30 UTC).** The audit is kept as written at 00:48 UTC. Later decisions
> changed four points: **Q2** is answered by the owner (use CDF GC Review with schema `cdf_notifications_v13`, ADR-012),
> so §2.4 and risk T15 now read "a shared project, isolated and verified" (`docs/DEPLOYMENT_STATUS.md`); **Q1** is on an
> owner card, with ADR-001 ("own records behind `CaseSourceAdapter`") in force meanwhile; §8 step 3 is tightened by
> ADR-003: no `@supabase/*` package at all; S9 is addressed by the isolation plan (`docs/hosted/`).
>
> **Further superseded passages (added 31 Oct 2026 23:32 UTC, from SEC's E01 review on #75).** Do not build from the
> passages below; the decisions cited govern.
>
> - **Identity** (§5 rows "Local-dev identity adapter" and "Supabase Auth identity adapter", §8 step 4): V13 has no
>   Supabase Auth users and no Supabase Auth adapter. Sign-in is a synthetic persona behind Vercel Authentication,
>   enabled only by `V13_PERSONA_SIGNIN=enabled` (ADR-004; CLAUDE.md §2 and §4), implemented in `lib/auth`.
>   PRODUCTION_SUBSTITUTION_REQUIRED: the CDF corporate IdP (OIDC).
> - **Target paths** (§5 "Target" column, §8): `supabase/migrations` and `supabase/seed` are `database/migrations`
>   and `database/seed`, applied by the repository's own runner in number order and recorded in
>   `cdf_notifications_v13.schema_migrations`. The Supabase migration tool is prohibited (ADR-012; CLAUDE.md §2).
>   `lib/server/db`, `lib/server/identity` and `lib/server/adapters` are `lib/db`, `lib/auth` and `lib/adapters`
>   (CLAUDE.md §3).
> - **Secret scanning** (§8 step 3): the repository scans for credentials in tracked files and for personal data in
>   demo inputs are V13-SEC-008 (#72).
> - **Public repository** (§1.2, risk S4, Q3): the repository was still public when checked on 31 Oct 2026 at
>   23:31 UTC (GitHub API `visibility: public`). Q3 stays open with the owner.

## 1. Scope and evidence base

### 1.1 Sources read (FACT)

| Source | Version / commit | SHA-256 (first 16 hex) | What was read |
|---|---|---|---|
| `notifications/v13/` (`cdf-notifications-v13-reference` 13.0.0-draft.1) | release `v13_release/package_info.json`: 798 files, ZIP `5823be3cc46a33b1…`, kept run `2026-10-27T23-41-01-547Z` | CHARTER.md `fd6d4ca96e0b0237`, policy_v13.json `8139465b34880768`, out/test_results.json `d54fea92feb78029` (each equal to the release `SHA256SUMS.txt`) | README, CHARTER, V13-00, V13-03 §1–2, V13-04 §1–2, V13-15 §6–8, V13-19 §1, §5–6, LEAD_notes; module exports; JSON counts by script |
| `notifications/generator/` (V12) | `DATA.version 'V12.0'` (`source/build_notification_generator.py:137`) | README `f87484bcfda01633`, AGENT_GUIDE `ad673fae4d90c1f5`, CDF_Notification_Generator.html `944ae1ea1be34162` (1,382,016 B), ui_v9.js `e37443f0049e4fe2`, engine_v9.js `8365e896d5b1b940` | README, AGENT_GUIDE §2–5, state/storage code, id and key functions, source layout |
| `notifications/journeys/` | `L2-2026-10-26b`, PROPOSED | level2_journeys.json `9d2db3d4766ab929` | header, counts |
| `notifications/templates/institutional-referral/` | base, v2, v3, v4 | — | READMEs (heads), listing |
| Registers | — | NOTIFICATION_REGISTER.csv `bda9b7b588d43b28`; COMMITTEE_FLOW_NOTIFICATION_REGISTER.csv `09b88e74738bcbb0` | header, row counts |
| `notifications/exports/` | `v12/` | — | listing only |
| Case platform `/home/user/cdf_case_management` | branch `claude/project-thread-vw6gd1` at **`cca3659`** "Merge pull request #105 …" (2026-10-18), the same commit as local `main` | — | CLAUDE.md, README, PROJECT_STATUS (top), `packages/ui/src`, `security-context.ts`, `identity/*`, `notifications/*`, workflow, domain, cited migrations, listings |

**The local checkout is behind its remote.** The cached `origin/main` is `c5bb2d1` (PR #114, 2026-10-19): 48 commits ahead, with 68 migrations against 64 here (adds `…2115`, `…2117`, `…2120`, `…2125`). Nothing was fetched, so the real remote may be further ahead. Platform facts below refer to `cca3659`.

### 1.2 Facts verified by the architect today (ARCHITECT-VERIFIED)
- `mh1m1m/CDF_Notification_Generator` was empty and is **public**. It now has an initial README commit on `main` and a `develop` branch.
- The Supabase organisation "CDF" is on the **free plan** with two projects: `CDF_GC_Review` (eu-central-1) and "CDF Case Management's Project" (ap-northeast-1), the case platform's hosted DEV. The 2-project limit refused a third.
- The owner's Vercel team has project `cdf_notification_generator`, linked to the new repo.
- Supabase has no region in Saudi Arabia.

### 1.3 Not inspected
`generator-v8/`, `eml/`, `previews/`, `review/`; root scripts; `exports/v12/` contents; release ZIP/xlsx/docx/pdf; V13 `design/`, `work/` and unlisted docs; platform ADRs and app code beyond routes; live Supabase, Vercel, GitHub and Linear state. **No test was executed and no code from the mount was run**: V13 counts come from the package's own recorded run, and platform test status is UNVERIFIED. `uploads/` was not opened; one sub-folder there contains real personal data and was excluded.

## 2. Existing architecture

### 2.1 V12 Notification Generator (`notifications/generator/`)
- **Purpose:** a secretariat tool. It composes any of 69 notifications (66 from the V8 workbook plus 3 witness notices) for one case context, previews them and exports `.eml`, HTML, text and CRM-card drafts. "It sends nothing" (README:3).
- **Stack:** a Python builder (openpyxl, Pillow) puts the workbook, `engine_v9.js`, `timelens_v10.js`, `ui_v9.js`, CSS and base64 images into one HTML file (AGENT_GUIDE §2). Tests run on Node 22 and headless Chromium.
- **Structure:** layers DATA/ASSETS → CORE (pure functions: `compose()`, case ledger, TimeLens, Outlook card) → UI (DOM) (AGENT_GUIDE:133-147). Three tracks (WB, IR, DR) with 77 statuses and 94 transitions (README:48-49).
- **Runtime:** an offline single page. "The browser never talks to anything. No fetch, no network, no storage beyond localStorage" (AGENT_GUIDE:147). One global state `S={ctx,…}` (ui_v9.js:7) is saved under one key, `cdf-notification-generator-v9` (ui_v9.js:2, :8).

### 2.2 V13 reference package (`notifications/v13/`)
- **Purpose:** a conceptual re-engineering of V12: procedural intelligence, two progress layers (A = what actually happened, B = what is expected), disclosure by design, authority and consistency checks, and a notification lifecycle (CHARTER §2–§11).
- **Stack:** one Node ≥22 ESM package, zero dependencies, `node:test`.
- **Structure:** seven domains in `src/`: `domain/` (concepts, status, epistemic, invariants), `journeys/` (catalogue, resolver, progress, 23 scenario fixtures), `disclosure/`, `authority/`, `nextAction/`, `consistency/`, `lifecycle/` (notification, idempotency, evidence, export, 7 mock adapters), `render/` (18 components, e-mail, platform, densities, tokens, escaping, i18n) and `demo/`.
- **Runtime:** pure functions plus in-memory state. The lifecycle keeps its records in JavaScript `Map`s (`lifecycle/notification.js:241-245`). Policy, catalogue and authority JSON are read from disk with `node:fs` (`disclosure/project.js:253`, `authority/check.js:120`, `render/model.js:33-39`). The adapters mirror the platform's `notify.*` and audit contracts and are labelled PRODUCTION_SUBSTITUTION_REQUIRED (CHARTER:142-145). Output is files: `out/demo/` holds 17 scenario folders, an index and a manifest.

### 2.3 Case-management reference platform (`cdf_case_management`)
- **Purpose:** an emulator of the production architecture of the CDF case and investigation platform (README:7-10), with synthetic data only.
- **Stack:** a pnpm monorepo on Node 22 with strict TypeScript; Next.js 16.4.0, React 19.3.0, Tailwind 4; the `postgres` driver; Supabase (Auth, Storage) behind ports; Vitest, Playwright and axe.
- **Structure:** `apps/investigation-web` (authenticated; 45 page routes including `/cases`, `/cases/[id]/…`, `/my-work`, `/committees`, `/meetings/[id]`, `/notifications`, `/settings/notifications`) and `apps/whistleblowing-web` (public portal); 11 packages; 64 migrations (`20261007000100_foundation.sql` … `20261007002110_continuity_committee_workbook.sql`); 7 synthetic seed files.
- **Runtime:** SQL runs only on the server. Each transaction first assumes a role with `SET LOCAL ROLE authenticated|anon` and sets `request.jwt.claims` (`packages/infrastructure/src/db/security-context.ts:48-72`); the apps log in as NOINHERIT roles `cdf_bff` and `cdf_portal`. Writes go only through `SECURITY DEFINER` commands that audit in the same transaction. Every application table has row-level security (RLS), checked by `tests/security/rls-coverage.spec.ts:28-36`. The `notify.*` engine comes from migration 1920 onward; the e-mail sender is a stub (`notifications/stub-email-sender.ts:1-15`).

### 2.4 Target infrastructure (ARCHITECT-VERIFIED)
A public repo holding only a README, a linked Vercel project, and no Supabase project available under the free plan (§1.2).

## 3. Actual capabilities

| Capability | Notification package (V12 · V13) | Case platform (`cca3659`) | Evidence |
|---|---|---|---|
| Stateless? | V12: no server; state lives in browser `localStorage`. V13: pure functions plus in-process `Map`s; nothing outlives the process | No: stateful server, PostgreSQL | ui_v9.js:2-16; notification.js:241-245 |
| Persists cases | V12: one context in `localStorage`, plus JSON export/import. V13: no; fixtures are read-only | Yes: `case_mgmt.case_record` (uuid key, `row_version`) | ui_v9.js:512-513; caseReadModel.js:1-14; mig 0400:103-129 |
| Case id hard-coded | V12: operator types `ref`; the demo loader hard-codes `CDF-IC-2026-DEMO-0001`. V13: the id is an input; lifecycle fixtures use one fixed case; the demo derives one per scenario; 23 W-C fixtures carry 21 distinct ids | No: UUID keys; `case_number` is display-only, pattern `^CDF-(CASE\|DEMO)-[0-9]{4}-[0-9]{4,5}$` | ui_v9.js:3, :25; lifecycle/fixtures.js:71-94; scenarios_inline.js:86; mig 0400:105 |
| Case context stored globally | V12: yes, one `S.ctx` and one storage key shared by all tabs. V13: no; module constants only | No: case from the route (`/cases/[id]`) and per-transaction claims; no browser storage in the apps (grep) | ui_v9.js:7-8; model.js:30-31 |
| Several cases open at once | V12: no; switching = importing over the context. V13: no UI; one process can hold several scenario cases in a `Map` | Yes: each case has its own URL under RLS | ui_v9.js:512-513; routes |
| Reads authoritative case data | V12: no; typed or imported in the browser. V13: no; mock read model over synthetic JSON. Level 1 (V8 codes S1–S5) has no platform source | Yes: it is the authoritative store | V13-03:30 (D-1), :92; caseReadModel.js:3-5 |
| Navigate between cases | No case list in either; V13 `out/demo/index.html` is a static gallery | Yes: `/cases` (at most 200 rows, no pagination), case tabs, My Work | investigation-gateway.ts:165-171 |
| Database | None in either | PostgreSQL 16+ / Supabase, 64 migrations | README:48-60 |
| Real authentication | None. V13 takes the actor's capacity as an input to `check()` | Two adapters, both PRODUCTION_SUBSTITUTION_REQUIRED: Supabase Auth (password, httpOnly cookies, `getUser()` validation) and local-dev JWT (local/test only, one shared dev password, refuses Vercel) | identity/supabase.ts:35-49; identity/local-dev.ts:69-90; server/identity.ts:17-20 |
| Permissions enforced server-side | V12: no; the role is a dropdown, gates are checkboxes. V13: `check()` and `project()` refuse by default, but inside the library, with no identity or server boundary | Yes: application pre-check (`@cdf/authorization`), RLS, `authz.*` functions and `SECURITY DEFINER` commands; no table write grants to app roles | V13-03:95, :99; check.js:120; mig 0500:44-83; rls-coverage.spec.ts:38-45 |
| Notifications stored | V12: a local issue log in `localStorage` plus exported files. V13: versions and an append-only evidence store in memory (model hash only) | Yes: `notify.outbox` (IN_APP/EMAIL rows, no content, immutable facts; RLS = own IN_APP rows) | ui_v9.js:472; evidence.js:1-14; mig 1920:107-126, :195-197 |
| Delivery attempts tracked | V12: no; nothing is sent. V13: yes, per attempt, in memory, with retries; "sent" is not "delivery confirmed" | Partly: counter 0–5, status PENDING/SENT/FAILED, one audit event per settlement; no per-attempt row, provider id or bounce; dispatch never scheduled | notifyOutbox.js:24-38; mig 1920:581-617; V13-03:31 (D-2) |
| Notifications linked to a case | V12: only via the free-text `ref` in the idempotency key and log. V13: yes; `case_id` comes from the authoritative object; a mismatch is refused (`CASE_OBJECT_MISMATCH`) | Indirect: `object_type` + `object_id` (14 types incl. CASE); no `case_id` column | build_notification_generator.py:529; notification.js:443-451; mig 2050:1805-1807 |
| Templates versioned | V12: package strings (`V12.0`, TimeLens `V11.0`); the IR template copied into folders v2–v4. V13: catalogue, policy, authority and rule-set version strings; one package-wide `TEMPLATE_VERSION` (`model.js:31`), and a different one in `fixtures.js:44` | No: `notify.template` = code, object type, mandatory flag, description; wording in `packages/i18n` by code. Forms are versioned; templates are not | mig 1920:36-41; PROJECT_STATUS:73 |
| Concurrent users | V12: one user per browser; tabs overwrite one key (INFERENCE). V13: no | Designed for it: transactions, optimistic `STALE_VERSION` check on case edits, unique `dedupe_key`. One global advisory lock serialises the audit chain; no load test (UNVERIFIED) | mig 0700:346; mig 1920:117; mig 0300:218-219 |
| Frontend reusable | V12: no; a 1.38 MB single file with 29 `innerHTML` sites and global state. V13: server-side string renderers (HTML, text, Adaptive Card) with escaping; no React | Yes: `@cdf/ui` React components with `tokens.css`, i18n and RTL; a private workspace package depending on `@cdf/contracts` and `@cdf/i18n` | ui_v9.js; render/*.js; packages/ui/package.json |
| Audit trail | V12: none. V13: mock hash-chained ledger in memory | `audit.audit_event`: append-only, hash-chained; UPDATE/DELETE/TRUNCATE rejected | mig 0300:141-159, :199-269 |
| Tests | V12: engine 86, sweep 212, UI 31, pixel 36 (README:11). V13: 14 files, **726/726 passed** in the recorded run | Unit, integration, e2e, a11y and 65 security spec files; pass status UNVERIFIED | v13/out/test_results.json `meta`; V13-00_gates.md:5 |

V13 records ten quality gates (`docs/V13-00_gates.md`). All pass except **G2 (status reproduction), which is PARTIAL**: only 10 of the 22 statuses declared by the scenario fixtures are reproduced from their recorded events (backlog BL-45, BL-46). G9 (security) is "unit/static level only; no penetration test".

## 4. Missing capabilities for an enterprise multi-case platform

**Missing everywhere, so they must be built:**
1. Organisation hierarchy, seven logical workspaces and a workspace switcher (no route or table found).
2. A scalable case portfolio: server-side pagination, filters, smart views, and table/card/kanban/timeline views. The platform list uses a fixed `limit 200`; 9 gateway queries use fixed limits.
3. Global search that authorises before returning results, counts or snippets; Ctrl/Cmd+K; a case quick switcher. No search route among the 45, and no command palette.
4. Per-case journey instances pinned to a catalogue version, with Level 1 from a recorded code. The platform holds no V8 code, and the mapping needs a source document (SOURCE_REQUIRED).
5. A per-case notification operations center. Outbox rows need a `case_id`, or a link to their source event (gap NG-19).
6. Notification versions, corrections, supersession and cancellation (V13 in memory only; none on the platform, V13-03:104).
7. Per-attempt delivery records, backoff, a dead-letter queue, a scheduled dispatcher and a real mail adapter.
8. Template versions with basis and content hash; one consolidated register as data.
9. Dashboards fed only by authorised queries; performance evidence at 100, 1k, 10k and 100k cases.
10. In the new repo, everything: shell, migrations, RLS, CI/CD, tests, Playwright visual QA, deployment evidence.

**Platform only (reuse it if V13 Enterprise sits on the platform):** persistent cases; case ACL and purpose-bound access; conflict declarations and recusal-aware committee seats; My Work; records of committees, meetings, votes, minutes, legal reviews and decisions; the audit ledger; the notification bell, list and settings; the RLS test harness.

**V13 only (port it to the server side):** event-evidenced progress; disclosure projection; authority decision rights; consistency and next-action rules; lifecycle and idempotency design; the 18 notification components.

## 5. Reusable components

| Component | Location | Classification | Why | Target in V13 Enterprise |
|---|---|---|---|---|
| V13 status model: separate procedure, task, meeting, decision, notification and delivery statuses, computed from recorded events | v13/src/domain/ | PRESERVE_AND_EXTEND | Each status comes only from the object's own events; 191/191 status and invariant tests pass. Needs TS types and DB check constraints | lib/domain + supabase/migrations |
| CaseStatus as V8 codes S1.01–S5.xx (Level 1 source) | v13/src/domain/status.js | REQUIRES_VERIFICATION | The platform workflow is CDF_CASE_V1 with 15 states (`packages/workflow/src/definition.ts:49-64`); no V8 code in the repo; mapping document missing | lib/domain (fails closed until mapped) |
| Journey definitions: catalogue_v13 (5 master stages, 28 sub-states, 22 journeys, 112 assignments), resolver, progress | v13/src/journeys/ | PRESERVE_AND_EXTEND | 78/78 journey and progress tests (gate G4); ids kept from V12; PROPOSED | lib/journeys + versioned reference tables |
| V12 level-2 catalogue `L2-2026-10-26b` | journeys/level2_journeys.json | DEPRECATE | Replaced by catalogue_v13; kept unchanged as the regression baseline | docs/reference |
| Disclosure policy and projection: 1,898 rows, 13 recipient classes, 51 fields, everything prohibited by default | v13/src/disclosure/ | PRESERVE_AND_EXTEND | Renderers refuse unprojected models; 18/18 tests (G5). Rows PROPOSED; e-mail part awaits the owner (LEAD_notes L-01) | lib/disclosure (server only) + policy-version table |
| Authority rules: 45 actions (39 OWNER_DECISION, 6 SOURCE_REQUIRED), `check()` | v13/src/authority/ | PRESERVE_AND_EXTEND | Fails closed; 83/83 tests (G3). Library-only: bind to verified identity; reconcile with `@cdf/authorization` | lib/authority + DB authz/RLS |
| Consistency rules PC-00…PC-29 and engine | v13/src/consistency/ | PRESERVE_AND_EXTEND | 121/121 tests; a blocking violation prevents VALIDATED | lib/notifications/consistency |
| Next-action logic | v13/src/nextAction/rules.js | PRESERVE_AND_EXTEND | 12/12 tests; deadlines only with a basis event and rule | lib/notifications/next-action |
| Notification lifecycle, idempotency key, evidence store | v13/src/lifecycle/ | REFACTOR | Sound states and sha256 key (120/120, security 41/41), but held in memory; must become DB rows with unique keys and commands that audit in the same transaction | lib/notifications + supabase/migrations |
| Mock platform adapters (7) | v13/src/lifecycle/adapters/ | REPLACE | Labelled mocks; their headers document the contracts real gateways must meet | lib/server/adapters |
| Renderers: 18 components; e-mail HTML, text and card; densities; escaping | v13/src/render/ | REFACTOR | 24/24 render, 13/13 render-security, 11/11 accessibility (heuristic) tests. String HTML suits e-mail, not the app; Outlook unverified; fixed `GENERATED_AT`/`TEMPLATE_VERSION` defaults | lib/render (e-mail) + components/notifications (React) |
| Demo fixtures: 23 W-C scenarios, inline scenarios, lifecycle fixture | v13/src/journeys/scenarios/, src/demo/, src/lifecycle/fixtures.js | REFACTOR | 12 of 22 declared statuses not reproduced (G2); `CDF-IC-2026-DEMO-…` refs do not match the platform pattern | supabase/seed + tests/fixtures |
| Test suite (14 files, 726 recorded passes), recorder and gate scripts | v13/tests/, v13/tools/ | PRESERVE_AND_EXTEND | Test ids are the requirement record; library-only (no DB, auth, browser, load) | tests/unit + CI gates |
| V12 generator: HTML tool, engine, TimeLens, UI, builder, patches | generator/ | DEPRECATE | Browser-only, personal data in `localStorage`, UI-only permissions; replaced by V13 | none (frozen evidence) |
| IR e-mail template (base, v2–v4), Secretariat Mail Composer | templates/institutional-referral/ | DEPRECATE | Single-file browser tools; the template shows the case reference (README open point vs AMB-181) | docs/reference (design input) |
| Notification registers (66 rows × 34 cols; 43 × 36) | NOTIFICATION_REGISTER.csv, COMMITTEE_FLOW_NOTIFICATION_REGISTER.csv | REFACTOR | Requirement and build status per notice (42 BUILT in register 1); merge into one generated register (V13-04 row PM-24) | docs/registers + notification-type reference data |
| V12 exports (xlsx, csv) | exports/v12/ | REQUIRES_VERIFICATION | Listed only; contents not read | docs/reference |
| V13 design tokens: 68 colours (24 equal to CDF primitives), 192 UNVERIFIED marks; Arabic font IBM Plex Sans Arabic (UNVERIFIED) | v13/design/tokens.json, src/render/tokens.js | REFACTOR | Overlaps platform tokens and uses a different font (`tokens.css:83`); keep only e-mail-specific tokens | one tokens.css + lib/render |
| Platform CDF tokens: CDF_Design_Tokens.json v1.1 primitives, AA-adjusted semantics, light/dark, RTL | packages/ui/src/tokens.css | PRESERVE_AND_EXTEND | Contrast tested (`tokens.test.ts`); brand Arabic font still BRAND_SOURCE_REQUIRED | styles/tokens.css (single source) |
| Platform UI components: CDFAppShell, CDFSideNav, CDFNotificationBell, CDFCaseHeader, CDFStagePanel, CDFProgressTracker, CDFTimeline, CDFWorkList, CDFCommandForm, CDFStatusBadge and more | packages/ui/src/*.tsx | PRESERVE_AND_EXTEND | React 19, i18n, RTL; a private package in another repo, so the reuse method is open (a copy will drift) | components/ui |
| Security-context pattern (`withUserContext`, `withAnonContext`, `createPool`) | packages/infrastructure/src/db/security-context.ts | PRESERVE | RLS behaves the same for server SQL and PostgREST; needs a NOINHERIT login role and a server-only DB URL | lib/server/db |
| Local-dev identity adapter | packages/infrastructure/src/identity/local-dev.ts | PRESERVE | Local/test only; refuses Vercel | lib/server/identity (dev only) |
| Supabase Auth identity adapter | packages/infrastructure/src/identity/supabase.ts | PRESERVE_AND_EXTEND | Anon key only, `getUser()` validation; untested against a hosted project (PROJECT_STATUS:68); no MFA | lib/server/identity |
| Platform `notify.*` engine: template, rule, preference, outbox, enqueue, claim/settle, reminders | migrations 1920 and later | PRESERVE_AND_EXTEND | V13-19 §5–6: `notify.*` is the backbone, no parallel outbox; stages S2–S4 (versions, attempts, corrections) are additive | platform migrations, or ported schema if standalone (Q1) |
| Audit ledger (`audit.record_event`, hash chain, immutability) | migration 0300 | PRESERVE | Same-transaction audit; the global lock needs a load test | supabase/migrations |
| Case master, CDF_CASE_V1 workflow, `authz.*` case functions, committee records | migrations 0400–0700, 1870–1910 and later; packages/workflow, packages/domain | PRESERVE | Authoritative case and procedural records with RLS and tests | read via `api.*` (layer) or ported (standalone, Q1) |

## 6. Technical risks

| Id | Risk | Evidence | Consequence / control |
|---|---|---|---|
| T1 | A second case system | the owner's recommendation (`v13_enterprise/INTAKE.md`); V13-19:103 ("no second outbox, event store or content store") | Two authoritative stores; decide Q1 before any schema work |
| T2 | No Level-1 source | V13-03:30; definition.ts:49-64 | Level 1 fails closed on real records until a mapping is approved |
| T3 | Two case-id formats | mig 0400:105 vs `CDF-IC-2026-DEMO-…` fixtures | Seeds rejected, or two id schemes |
| T4 | Outbox rows have no case link | mig 1920:107-126; mig 2050:1805-1807 | Per-case views need an additive column or view |
| T5 | V13 state in process memory | notification.js:241-245 | Serverless instances lose state and duplicate work; enforce keys in the DB |
| T6 | JSON read from disk; resolver chosen by file presence | project.js:253; check.js:120; model.js:252-259 | A bundle can drop files and silently change behaviour; use versioned tables or build-time imports |
| T7 | Fixture defects | gate G2 PARTIAL; LEAD_notes L-12 | Seeding them would encode wrong rules |
| T8 | Weak template versioning | model.js:31 vs fixtures.js:44; mig 1920:36-41 | No proof of which wording was sent |
| T9 | Unproven at scale | `limit 200` (investigation-gateway.ts:169); global audit lock (mig 0300:218-219); pool max 5 (security-context.ts:26) | No load evidence; claim only what is measured |
| T10 | Reuse across repos | `@cdf/*` are private workspace packages | Copies drift and duplicate shared services |
| T11 | Delivery not operational | stub sender; no scheduler (V13-03:31) | E-mail never leaves; a scheduled job is a human decision |
| T12 | Two token sources and fonts | tokens.css:83 vs tokens.json `type.family` | App and e-mails diverge; keep one source |
| T13 | Stale platform checkout | 48 commits / 4 migrations behind the cached `origin/main` | Re-baseline on remote `main` before reuse |
| T14 | Narrow test evidence | 726 library tests only | No DB, RLS, e2e or performance evidence yet |
| T15 | Free plan and region | §1.2 | No third project; synthetic staging only |

## 7. Security risks

| Id | Risk | Evidence | Control |
|---|---|---|---|
| S1 | V12 keeps names, e-mail addresses, references and the event ledger in `localStorage` with no expiry | ui_v9.js:2-16; v13 storage.js:4-6 | Never reuse V12 storage; V13's gate refuses INTERNAL/RESTRICTED data in the browser |
| S2 | V12 enforces permissions only in the UI | V13-03:95, :99 | Prohibited (CLAUDE.md §5); enforce in the DB |
| S3 | V12 guessable event ids; plaintext idempotency key containing case ref and recipient | engine_v9.js:29; build_notification_generator.py:529 | `gen_random_uuid` + sha256 keys (idempotency.js:57-68) |
| S4 | The new repo is public | §1.2 | No secrets or real data; branch protection UNVERIFIED |
| S5 | Cross-case leakage via search, counts, quick switcher, notifications or edited URL ids | CLAUDE.md §4; platform `case-isolation.spec.ts`, `api-idor.spec.ts` | Port these negative tests before features |
| S6 | Case content in notifications or e-mail | §39; AMB-181; IR template README; LEAD_notes L-01 | Content-free outbox; server-side disclosure before rendering |
| S7 | Privileged key reaching the browser | CLAUDE.md §4 | Server-only; port the lint rule on `@supabase/*` imports |
| S8 | Identity adapters are substitutes | local-dev.ts:84 (one shared password); Supabase password-only | Synthetic accounts in staging; corporate IdP in production |
| S9 | A shared Supabase project, if chosen under the 2-project limit | §1.2 | Separate schemas, roles and migration order; keep the platform's RLS intact |
| S10 | No in-country hosting | §1.2; INTAKE hosting gate | Synthetic data only; production blocked |
| S11 | Real personal data on the shared mount | an `uploads/` sub-folder (not opened) | Never import it into the repo, seeds or tests |
| S12 | Audit gaps | enqueue not audited (V13-03:106) | Audit every new transition in the same transaction |
| S13 | V13 security tests are unit-level | gate G9 | Add RLS penetration and live injection tests |

## 8. Migration requirements (in order)

1. **Decisions first:** Q1 (layer or standalone) and Q2 (database). Everything below depends on them.
2. **Re-baseline sources:** pin the V13 ZIP `5823be3c…`, the V12 hash ledger and the platform's current remote `main` (not `cca3659`).
3. **Repository foundation:** strict Next.js/TypeScript; `@supabase/*` only in `lib/server`; secret scanning; CI for lint, typecheck and unit tests; branch protection.
4. **Identity and security context:** port `security-context.ts` and the identity port; a NOINHERIT login role; Supabase Auth with synthetic users; no privileged key in the browser.
5. **Case registry (one route, never both):** *layer* = a read model over the platform's `api.*` in the user's context; *standalone* = a case table with UUID key, one agreed display-number pattern, case ACL, RLS and negative tests (cross-case, URL, workspace).
6. **Versioned reference data in migrations, PROPOSED until approved:** notification types (from the consolidated register); template versions (code, version, language, content hash, basis); catalogue, disclosure, authority and rule-set versions.
7. **Recorded events** keyed by case and object, with occurred/recorded times, provenance and causation/correlation ids (if layered: the platform's audit and case history).
8. **Per-case journey instances** pinned to a catalogue version: Layer A only from evidence events; Level 1 only from a recorded code plus an approved mapping (fail closed).
9. **Notification records:** immutable versions; server-derived `case_id` with the mismatch guard; originating event; template and policy versions; a unique idempotency key; transitions through `SECURITY DEFINER` commands auditing in the same transaction; consistency, disclosure and authority checks before VALIDATED/AUTHORIZED.
10. **Outbox and delivery:** extend `notify.*` (port it if standalone); append-only per-attempt records; backoff and dead letter; a scheduled dispatcher (human decision); the sender stays a labelled stub; a read mark or export never counts as delivery.
11. **Rendering:** project on the server, then render; React in-app; e-mail content limited by §39 and AMB-181.
12. **UI:** an Arabic-RTL shell on `@cdf/ui` patterns with one token source; a paginated portfolio; the case workspace; the notification operations center.
13. **Tests:** port the 14 V13 suites; add DB, RLS, security, e2e, Playwright and accessibility suites; run performance tests at 100/1k/10k/100k synthetic cases; record evidence and claim only what was measured.
14. **Seed data:** fix fixtures BL-45/BL-46 first, then generate synthetic multi-case data (`@example.test`, DEMO ids).
15. **Environments:** Vercel previews per PR and synthetic staging; the hosting gate blocks production.
16. **V12 coexistence:** no data import, since V12 holds data only in browser storage (V13-15:145); V12 and V13 stay frozen evidence.

## 9. Open questions for the owner

1. **Q1:** Is V13 Enterprise a layer over the existing case platform, or a standalone app with its own case records? (INTAKE.md routes this to the owner as a decision card.)
2. **Q2:** The free plan refuses a third Supabase project. Share the case platform's DEV project, replace `CDF_GC_Review`, or upgrade the plan?
3. Should `CDF_Notification_Generator` stay public?
4. Two missing documents (not new decisions): the CDF_CASE_V1 → V8 status mapping (or confirmation that Level 1 uses the platform's own states), and the brand Arabic font.
5. May a scheduled dispatch job run on Vercel for synthetic staging?
