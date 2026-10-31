# Implementation status — CDF V13 Enterprise

**SYNTHETIC-DATA REFERENCE IMPLEMENTATION — not CDF production.** Status words: COMPLETE · IN_PROGRESS · BLOCKED ·
NOT_STARTED · PRODUCTION_SUBSTITUTION_REQUIRED. A capability is COMPLETE only with its implementation and verification
evidence (`docs/TEST_EVIDENCE.md`). No overall completion percentage is given: each gate is reported on its own.

Last updated: **31 Oct 2026 22:00 UTC** (Chief Architect), `develop` `b5d810c`.

## 1. Milestones

| Milestone | Status | Notes |
| --------- | ------ | ----- |
| M1 — Enterprise foundation | IN_PROGRESS | On `develop`: app foundation (#6, #20), data model and commands in migrations 0000–0010 with the synthetic seed (DB-001..015), domain status model (#18), task status catalogue (#35), journeys (#24), authority check (#39), disclosure projection (#40), notification composition and renderer wording (#45, #48), the notification model from server records (#55), workspace switcher and its audited call (#10, #27), Case Portfolio (#19), Case Workspace (#23), My Work (#32), shell and data components (#14, #16), the database-backed e2e job (#36), Scenario C and the negative-persona pins with their positive control (#33, #43, #53), database and case-page adversarial suites (#29, #49), threat model and authorisation matrix (#2) and post-apply checks (#30). In review: notification draft and Scenario E (#51, FE-006 part 1), the shell workspace switcher menu (#50), the preview frame (#54), the hosted resume rehearsal (#56), owner decision briefs (#57), Scenarios A, B and D (#58, draft). Not started: the Operations Center list and preview (FE-006 part 2). Hosted: 0000–0005 applied with every check PASS; 0006 waits for the owner to answer the connector's confirmation (OI-034). Staging sign-in waits for the owner step |
| M2 — Multi-case and multi-workspace | NOT_STARTED | |
| M3 — Procedural intelligence | NOT_STARTED | |
| M4 — Notification Center | NOT_STARTED | |
| M5 — Notification operations | NOT_STARTED | |
| M6 — Advanced capabilities | NOT_STARTED | |
| M7 — Operational hardening | NOT_STARTED | |
| M8 — Final delivery | NOT_STARTED | |

## 2. Infrastructure (Cloud Initialization)

| Item | Status | Evidence |
| ---- | ------ | -------- |
| GitHub repository (existing, `develop` integration branch) | COMPLETE | DEPLOYMENT_STATUS §1 |
| Branch protection on `main` | BLOCKED | no connector tool; owner setting (OI-016) |
| Database: V13 schema and roles in CDF GC Review, isolated | COMPLETE | TEST_EVIDENCE §1–§2; ADR-012 |
| Database: V13 migrations 0001–0010 and the seed on the hosted project | BLOCKED | 0001–0005 applied 31 Oct with every per-step check PASS (TEST_EVIDENCE §2.1); 0006 waits for the owner to answer the Supabase connector's confirmation (OI-034); then 0007–0010, the seeds and the post-apply checks (V13-ARCH-005), the sequence V13-DB-016 rehearses (#56) |
| Database: recovery plan and rollback script | COMPLETE | `docs/hosted/ISOLATION_AND_RECOVERY_PLAN.md`; rollback rehearsed locally (TEST_EVIDENCE §1.2) |
| Vercel project linked to the repository | COMPLETE | DEPLOYMENT_STATUS §3 |
| Vercel environment variables | IN_PROGRESS | the two plain switches are set on the `develop` preview; the two sensitive values wait for the owner step (`docs/hosted/OWNER_STEP_APP_LOGIN.md`) |
| CI on every PR and every `develop` push | COMPLETE | six jobs (TEST_EVIDENCE §4) |
| Successful deployment | COMPLETE | every `develop` merge since #6 deploys READY on the staging alias; `/api/health` answers 503 `DB_NOT_CONFIGURED` as expected until the owner step (DEPLOYMENT_STATUS §3). The two early builds failed `NEXT_NO_VERSION` before the app existed (OI-010) |
| Deployment verification (DB connectivity, sign-in, isolation probe, Playwright smoke) | BLOCKED | the database, sign-in and probe checks need `V13_DATABASE_URL` and `V13_SESSION_SECRET` (owner step); the smoke run is OI-008 (DEPLOYMENT_STATUS §5) |

## 3. Quality gates

| Gate | Status | Evidence / reason |
| ---- | ------ | ----------------- |
| QG-01 Source integrity | IN_PROGRESS | V13-PROC-010 (#64, in review): `scripts/integrity/source-ledger.mjs` captures and verifies path, size and sha256 of every file under the evidence roots; PROC's baseline ledger (31 Oct, r2: 19 roots, 2,544 files, 707,615,739 bytes) verified PASS straight after capture, and a later `verify` reports any change from it; the ledger stays outside the repository; no V13 task writes to these folders |
| QG-02 / Gate B Multi-case integrity | IN_PROGRESS | Case Context Sentinel part 1 and frame rule merged (#7, #13); SEC's case-page adversarial tests run it on every Case Workspace tab (#49) |
| QG-03 / Gate C Authorization | IN_PROGRESS | database: RLS, command checks and the persona × workspace × case adversarial suites (#29); application pre-check `lib/authz` (#9); application adversarial tests (#11, #49); negative-persona pins with a positive control (#43, #53); post-apply checks (#30). Not met until the notification screens and their negative tests land (FE-006) |
| QG-04 / Gate I Procedural truth | IN_PROGRESS | domain status model (#18); Truth Inspector part 1, follow-ups and T8 (#7, #13, #22) |
| QG-05 Disclosure | IN_PROGRESS | disclosure projection ported, default deny, PROPOSED policy (#40); notification composition and renderers (#45, #48); the model from server records, projected per recipient (#55); authority check (#39). Open: OI-035 (FE-006's preview) and OI-033; the recipient codes (OI-037) and stage names (OI-039) wait for owner decisions, with briefs in #57 |
| QG-06 / Gate A Functional correctness | NOT_STARTED | |
| QG-07 / Gate D Visual quality | NOT_STARTED | |
| QG-08 / Gate E Accessibility | IN_PROGRESS | axe checks run in the e2e job on every PR; OI-028's root cause is found and fixed in #38; QA's 375 px review of #23 found scrollable regions keyboard users cannot reach (being fixed in #23); the five-screen audit is QA-005; QA found a second main landmark when a case page renders not-found inside the shell (OI-042, V13-FE-007) |
| QG-09 / Gate F Arabic RTL | NOT_STARTED | |
| Gate G Responsive | NOT_STARTED | |
| QG-10 / Gate H Performance | NOT_STARTED | budgets to be agreed in M7 |
| QG-11 Regression | IN_PROGRESS | CI runs lint, unit, rehearsal, database integration, build and e2e on every PR and `develop` push (TEST_EVIDENCE §4) |
| QG-12 / Gate J Deployment | IN_PROGRESS | previews build and serve; staging verification waits for the owner step (QA-006) |
| QG-13 Production authorization | BLOCKED | by design: hosting gate items all UNVERIFIED (ADR-005, OI-013) |

## 4. Deliverables

| Deliverable | Status | Location |
| ----------- | ------ | -------- |
| E01 Current-state audit | COMPLETE | `docs/CURRENT_STATE_ARCHITECTURE.md` |
| E02 Conceptual architecture | COMPLETE | `docs/architecture/CONCEPTUAL_ARCHITECTURE.md` (#5) |
| E05 Threat model and authorisation matrix (M1 part) | COMPLETE | #2 (`f429f6f`; DB ACCEPT `8fcb8b1`; CI 41240021497) |
| E19 Migration and rollback plan — hosted part | COMPLETE | `docs/hosted/ISOLATION_AND_RECOVERY_PLAN.md` |
| E19 Migration from V12 | NOT_STARTED | |
| Requirements register and traceability | IN_PROGRESS | V13-ARCH-004 |
| All other E- and UXQA- deliverables | NOT_STARTED | `docs/MASTER_EXECUTION_PLAN.md` §6–§7 |

## 5. Production substitutions (PRODUCTION_SUBSTITUTION_REQUIRED)

| Prototype | Production replacement |
| --------- | ---------------------- |
| Shared Supabase project CDF GC Review, schema `cdf_notifications_v13` | Dedicated database in CDF Alibaba Cloud Riyadh RDS PostgreSQL; roles from the CDF DBA; credentials in KMS |
| Vercel (`fra1`) behind Vercel Authentication | CDF Alibaba Cloud Riyadh runtime behind the CDF network and identity controls |
| Synthetic persona sign-in | CDF corporate IdP (OIDC) with MFA |
| V13's own synthetic case records | The authoritative CDF case system through `CaseSourceAdapter` |
| Stub notification sender, no scheduler | Approved CDF mail gateway and scheduler |
| Audit ledger in the application database | CDF SLS/SIEM export |
