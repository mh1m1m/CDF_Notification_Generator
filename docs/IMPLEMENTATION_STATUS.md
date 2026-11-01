# Implementation status — CDF V13 Enterprise

**SYNTHETIC-DATA REFERENCE IMPLEMENTATION — not CDF production.** Status words: COMPLETE · IN_PROGRESS · BLOCKED ·
NOT_STARTED · PRODUCTION_SUBSTITUTION_REQUIRED. A capability is COMPLETE only with its implementation and verification
evidence (`docs/TEST_EVIDENCE.md`). No overall completion percentage is given: each gate is reported on its own.

Last updated: **1 Nov 2026 07:53 UTC** (Chief Architect), `develop` `d399987`.

## 1. Milestones

| Milestone | Status | Notes |
| --------- | ------ | ----- |
| M1 — Enterprise foundation | IN_PROGRESS | On `develop`: app foundation (#6, #20), data model and commands in migrations 0000–0014 with the synthetic seed (DB-001..015, DB-019..022), domain status model (#18), task status catalogue (#35), journeys (#24), authority check (#39), disclosure projection (#40), notification composition and renderer wording (#45, #48), the notification model from server records (#55) and its `data-epistemic` list (#67), workspace switcher, its audited call and the shell switcher menu (#10, #27, #50), Case Portfolio (#19), Case Workspace (#23), My Work (#32), shell and data components (#14, #16), the preview frame (#54), the notification draft and the Notification Operations Center list (#51, #61), the database-backed e2e job (#36), Scenarios A–E and the negative-persona pins with their positive control (#33, #43, #51, #53, #58), database and case-page adversarial suites (#29, #49), threat model and authorisation matrix (#2), post-apply checks (#30), the hosted resume rehearsal and the seed lint (#56, #62), owner decision briefs (#57), the QG-01 source ledger (#64), the M1 design review (#69), the Sentinel and Truth Inspector database halves and T9 (#68, #73), the repository scans (#72), the M1 register pass (#71), the deployment-readiness file (#77), the not-found landmark and filter reset (#63), the register wording pass (#79), the Sentinel timing fixes and read-function pass (#78), SEC's Center security tests (#70), the platform frame (#76, UX-008 part (a)), the second and third register passes (#80, #86), the in-case preview (#74, FE-006 part 3), the Sentinel's recipient rule D4 and request rules P3 and P4 (#84), Portfolio and My Work on the shared components (#85, UX-008 part (b)), workspace roles only from database-confirmed memberships (#81), the personal-data scan over migrations and hosted scripts (#87), the fourth, fifth and sixth register passes (#89, #94, #99), the database-security suites failing in CI when the database is not ready (#91, #92), the Case Workspace on the shared components (#90, UX-008 part (c)), the design-review fixes on the Center and the case overview (#82, FE-009), one journey instance per case (#95, PROC-018), the text-resize and reflow review with its fixes (#96, UX-009), the leak-suite guard (#88, QA-008), the UX improvement backlog (#97, UX-010), the seventh and eighth register passes (#102, #111), the Surface suite's missing-build case (#103, SEC-012), the per-migration rollback register (#101, DB-018), the plain-text twin of the platform preview (#106, PROC-021), the case Notifications tab on the shared table (#98, FE-010), the export isolation tests (#108, SEC-013), ADR-020 (#109), the keyset-paged case reads in migration 0011 (#110, DB-019), the reflow fix for CI's fonts (#107, UX-012), the audit-record design note (#115, DB-020), the export bound to its model (#113, PROC-022), the reflow browser checks (#104, QA-010), the draft bound to its case (#112, FE-012), the preview frame's language attributes (#100, UX-011), the refused-command design note (#120, DB-021), Scenario E's WITNESS disclosure checks (#114, QA-009), the ninth register pass (#118), the audit outcome and access-policy version in migration 0012 (#119, DB-020), the plain-text version in the in-case preview (#116, FE-011), the Next Action Card sources note (#124, PROC-025), the re-check of the M1 design review fixes (#122, UX-013), the paged Case Workspace lists (#121, FE-013), Scenario E's plain-text and response-body checks (#125, QA-012), the tenth register pass (#126, PROC-024), refused commands audited in migration 0013 (#127, DB-021), one shared form-control rule (#128, UX-014), the caller's open tasks on a case in migration 0014 (#129, DB-022), the design note for QA's open M1 rows (#132, QA-013), release tags and the changelog (#133, ARCH-012), `nextActionForCase` (#130, PROC-026), the Next Action Card (#135, UX-015), the case-access audit design note (#137, DB-023), the leak-suite guard's load-time listing check (#136, QA-011), the eleventh register pass (#139, PROC-027), the overview's own open tasks on the paged read (#138, FE-014), the Next Action Card on the overview (#141, FE-015), Server Action forms with JavaScript off (#143, ARCH-013) and their browser test (#148, QA-021). In review: the template code under the draft form's select (#131, FE-016), the case-access audit in migration 0015 (#142, DB-023) and its wiring (#147, FE-017), the screenshot library (#140, QA-014) and its baselines (#145, QA-015), and the reflow re-check (#146, UX-016). Hosted: 0000–0005 applied with every check PASS; 0006 waits for the owner to answer the connector's confirmation (OI-034). Staging sign-in waits for the owner step (OI-045) |
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
| Database: V13 migrations 0001–0014 and the seed on the hosted project | BLOCKED | 0001–0005 applied 31 Oct with every per-step check PASS (TEST_EVIDENCE §2.1); 0006 waits for the owner to answer the Supabase connector's confirmation (OI-034); then 0007–0014, the seeds and the post-apply checks (V13-ARCH-005), the sequence V13-DB-016 rehearses (#56) |
| Database: recovery plan and rollback script | COMPLETE | `docs/hosted/ISOLATION_AND_RECOVERY_PLAN.md`; rollback rehearsed locally (TEST_EVIDENCE §1.2) |
| Vercel project linked to the repository | COMPLETE | DEPLOYMENT_STATUS §3 |
| Vercel environment variables | IN_PROGRESS | the two plain switches are set on the `develop` preview; the two sensitive values wait for the owner step (OI-045, `docs/hosted/OWNER_STEP_APP_LOGIN.md`) |
| CI on every PR and every `develop` push | COMPLETE | six jobs (TEST_EVIDENCE §4) |
| Successful deployment | COMPLETE | `develop` merges deploy READY on the staging alias when Vercel's daily limit allows (OI-038: several merges on 31 Oct have no deployment; the newest READY one is `9290778`); `/api/health` answers 503 `DB_NOT_CONFIGURED` as expected until the owner step (OI-045, DEPLOYMENT_STATUS §3). The two early builds failed `NEXT_NO_VERSION` before the app existed (OI-010) |
| Deployment verification (DB connectivity, sign-in, isolation probe, Playwright smoke) | BLOCKED | the database, sign-in and probe checks need `V13_DATABASE_URL` and `V13_SESSION_SECRET` (owner step); the smoke run is OI-008 (DEPLOYMENT_STATUS §5) |

## 3. Quality gates

| Gate | Status | Evidence / reason |
| ---- | ------ | ----------------- |
| QG-01 Source integrity | IN_PROGRESS | V13-PROC-010 (#64, `dabc11f`, merged): `scripts/integrity/source-ledger.mjs` captures and verifies path, size and sha256 of every file under the evidence roots; PROC's baseline ledger (31 Oct, r2: 19 roots, 2,544 files, 707,615,739 bytes) verified PASS straight after capture, and a later `verify` reports any change from it; the ledger stays outside the repository; no V13 task writes to these folders. E01 (`docs/CURRENT_STATE_ARCHITECTURE.md`, REQ-ARCH-025) has SEC's ACCEPT `b8f47ab` (#75) |
| QG-02 / Gate B Multi-case integrity | IN_PROGRESS | Case Context Sentinel part 1 and frame rule merged (#7, #13), and its database half (#68); SEC's case-page adversarial tests run it on every Case Workspace tab (#49); the two Sentinel self-test timing faults are fixed (#78, OI-046, OI-047), with a pass over the case-returning read functions; REQ-QA-013's recipient rule D4 and request rules P3 and P4 merged (#84, OI-048 resolved). REQ-CASE-014's guard merged (#88, V13-QA-008): CI fails when one of the 15 leak-detection suites is pinned, focused, retried or skipped outside the reviewed allow-list, and `failOnFlakyTests` makes a leak seen once a red run; the allow-listed database skip fails in CI when the database is not ready (#91, #92). The journey resolver refuses another case's events, payload references included (#95, REQ-JRN-007). Open: the Surface suite's missing-build skip (#103, V13-SEC-012) and the QG-02 rows still IN_PROGRESS in the register (12 of 29 COMPLETE after the sixth pass, #99) |
| QG-03 / Gate C Authorization | IN_PROGRESS | database: RLS, command checks and the persona × workspace × case adversarial suites (#29); application pre-check `lib/authz` (#9); application adversarial tests (#11, #49); negative-persona pins with a positive control (#43, #53); post-apply checks (#30). The Notification Operations Center and the draft command landed with their negative tests (#51, #61); SEC's Center security tests merged (#70, V13-SEC-007). The in-case preview landed with its negative tests (#74): an unknown id, another case's notification and an unauthorised one show the same generic state. The shell names a role only from a membership the database confirms (#81, OI-044). Open: OI-049 (LOW: the draft takes its case from the form; the command re-checks it). The gate stays IN_PROGRESS while its register rows are open (`docs/REQUIREMENTS_TRACEABILITY.md` §3.1) |
| QG-04 / Gate I Procedural truth | IN_PROGRESS | domain status model (#18); Truth Inspector part 1, follow-ups and T8 (#7, #13, #22), the database halves (#68) and the preview-frame rule set T9 (#73, ADR-016 item 5) |
| QG-05 Disclosure | IN_PROGRESS | disclosure projection ported, default deny, PROPOSED policy (#40); notification composition and renderers (#45, #48); the model from server records, projected per recipient (#55); authority check (#39). The in-case preview projects per recipient on server records only (#74, OI-035 resolved); a restricted case fails closed until a read returns the access-list result (OI-050). Open: OI-033; the recipient codes (OI-037) and stage names (OI-039) wait for owner decisions, with briefs in #57 |
| QG-06 / Gate A Functional correctness | NOT_STARTED | |
| QG-07 / Gate D Visual quality | NOT_STARTED | |
| QG-08 / Gate E Accessibility | IN_PROGRESS | axe checks run in the e2e job on every PR; OI-028's root cause is found and fixed in #38; QA's 375 px review of #23 found scrollable regions keyboard users cannot reach (being fixed in #23); the five-screen audit is QA-005; QA found a second main landmark when a case page renders not-found inside the shell (OI-042, V13-FE-007), fixed by #63 (`63d1271`); the M1 design review (#69) checked the Tab order and the focus ring of every stop on the four M1 screens at 360 and 1280 px; UX-009's text-resize and reflow review (#96) fixed the area navigation and the case tab row at 320 px, pinned in unit tests, and its browser checks are #104 (V13-QA-010) |
| QG-09 / Gate F Arabic RTL | IN_PROGRESS | M1 design review merged (#69, `f069850`): `dir`/`lang` correct on the four M1 screens in Arabic and English, digits by what the number is (DESIGN_SYSTEM §6 D10); findings M1-01..13 FIXED in the review register (#69, #74, #76, #85, #90; M1-14 ruled under D10), with the case Notifications tab's dates, version and table left to V13-FE-010 (#98); the Center's M1-15..18 fixed in code by #82 and still ROUTED until UX's re-check (UXB-07); M1-19 noted (`docs/design/reviews/M1_DESIGN_REVIEW.md`, `docs/design/reviews/UX_BACKLOG.md`) |
| Gate G Responsive | IN_PROGRESS | #69 measured 360, 768, 1280 and 1920 px in both languages: no page-level horizontal scroll in 64 captures; squeezed tables at 360 px (M1-04, M1-05, M1-15) are routed to V13-UX-008 and V13-FE-009 |
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
| Requirements register and traceability | IN_PROGRESS | V13-ARCH-004: `docs/REQUIREMENTS_REGISTER.csv` and `docs/REQUIREMENTS_TRACEABILITY.md`; M1 status pass merged (#71); second pass V13-PROC-013 |
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
