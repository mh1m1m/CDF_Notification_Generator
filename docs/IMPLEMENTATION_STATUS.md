# Implementation status — CDF V13 Enterprise

**SYNTHETIC-DATA REFERENCE IMPLEMENTATION — not CDF production.** Status words: COMPLETE · IN_PROGRESS · BLOCKED ·
NOT_STARTED · PRODUCTION_SUBSTITUTION_REQUIRED. A capability is COMPLETE only with its implementation and verification
evidence (`docs/TEST_EVIDENCE.md`). No overall completion percentage is given: each gate is reported on its own.

Last updated: **28 Oct 2026 02:02 UTC** (Chief Architect).

## 1. Milestones

| Milestone | Status | Notes |
| --------- | ------ | ----- |
| M1 — Enterprise foundation | IN_PROGRESS | Hosted database isolation done; app foundation being built; team build starts after it lands |
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
| Database: recovery plan and rollback script | COMPLETE | `docs/hosted/ISOLATION_AND_RECOVERY_PLAN.md`; rollback rehearsed locally (TEST_EVIDENCE §1.2) |
| Vercel project linked to the repository | COMPLETE | DEPLOYMENT_STATUS §3 |
| Vercel environment variables | IN_PROGRESS | the two plain switches are set on the `develop` preview; the two sensitive values wait for the owner step (`docs/hosted/OWNER_STEP_APP_LOGIN.md`) |
| Successful deployment | NOT_STARTED | two builds failed `NEXT_NO_VERSION` before the app existed (OI-010) |
| Deployment verification (build, DB connectivity, sign-in, Playwright smoke) | NOT_STARTED | DEPLOYMENT_STATUS §5 |

## 3. Quality gates

| Gate | Status | Evidence / reason |
| ---- | ------ | ----------------- |
| QG-01 Source integrity | NOT_STARTED | hash check of the V12/V13 evidence folders to be scripted; nothing in them has been modified |
| QG-02 / Gate B Multi-case integrity | NOT_STARTED | |
| QG-03 / Gate C Authorization | NOT_STARTED | database-level isolation from GC Review is proven (TEST_EVIDENCE §2); case-level authorisation is not built yet |
| QG-04 / Gate I Procedural truth | NOT_STARTED | |
| QG-05 Disclosure | NOT_STARTED | |
| QG-06 / Gate A Functional correctness | NOT_STARTED | |
| QG-07 / Gate D Visual quality | NOT_STARTED | |
| QG-08 / Gate E Accessibility | NOT_STARTED | |
| QG-09 / Gate F Arabic RTL | NOT_STARTED | |
| Gate G Responsive | NOT_STARTED | |
| QG-10 / Gate H Performance | NOT_STARTED | budgets to be agreed in M7 |
| QG-11 Regression | NOT_STARTED | |
| QG-12 / Gate J Deployment | NOT_STARTED | |
| QG-13 Production authorization | BLOCKED | by design: hosting gate items all UNVERIFIED (ADR-005, OI-013) |

## 4. Deliverables

| Deliverable | Status | Location |
| ----------- | ------ | -------- |
| E01 Current-state audit | COMPLETE | `docs/CURRENT_STATE_ARCHITECTURE.md` |
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
