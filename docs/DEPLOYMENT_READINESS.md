# Deployment readiness — CDF V13 Enterprise

**SYNTHETIC-DATA REFERENCE IMPLEMENTATION — not CDF production.** This file is the hosting gate of ADR-005 as measured,
plus the readiness of the synthetic staging environment. It is not a readiness claim. Production promotion is BLOCKED
by design (QG-13), and nothing here approves a deployment. Requirement: REQ-DOC-008 (task V13-ARCH-011).

Last updated: **1 Nov 2026 07:53 UTC** (Chief Architect), `develop` `d399987`. Facts are taken from
`docs/DEPLOYMENT_STATUS.md`, `docs/OPEN_ISSUES.md` and `docs/IMPLEMENTATION_STATUS.md`, each with its own check time.

## 1. Production promotion gate (ADR-005, QG-13)

Production promotion stays blocked until every item below is verified with evidence. ADR-005 lists eight items, and
none is verified today (OI-013). "Known gap" states what the prototype does instead, where that is already known not to
meet the item.

| # | Gate item (ADR-005) | Verified | What is true today | Known gap | Who can clear it |
| - | ------------------- | -------- | ------------------ | --------- | ---------------- |
| 1 | Approved data classification | UNVERIFIED | No CDF classification of this platform's data has been supplied. The repository holds synthetic data only (CLAUDE.md §1); the repository scans check every tracked file for credentials and the demo inputs for personal-data shapes (SEC-APP-19, SEC-APP-20, #72). | — | CDF data governance, through the owner |
| 2 | Saudi data-residency requirements | UNVERIFIED | The database runs in Supabase `eu-central-1` and the functions in Vercel `fra1` (`docs/DEPLOYMENT_STATUS.md` §2–§3). | Neither location is in Saudi Arabia. | Owner and CDF approvals |
| 3 | Database region and hosting arrangement | UNVERIFIED | One schema, `cdf_notifications_v13`, inside the shared free-plan project CDF GC Review (ADR-012). Its administrator can read every V13 table (OI-014, accepted for synthetic data only). | Shared project, foreign region, free plan. PRODUCTION_SUBSTITUTION_REQUIRED: a dedicated RDS PostgreSQL in CDF Alibaba Cloud Riyadh, roles from the CDF DBA, credentials in KMS. | Owner and CDF infrastructure |
| 4 | Vercel hosting and processing locations | UNVERIFIED | Vercel project `cdf_notification_generator`, functions in `fra1`, Vercel Authentication on every deployment, free plan with a daily deployment limit (OI-038). | Foreign region. PRODUCTION_SUBSTITUTION_REQUIRED: the CDF Alibaba Cloud Riyadh runtime behind CDF network and identity controls. | Owner and CDF infrastructure |
| 5 | Contractual and cybersecurity approvals | UNVERIFIED | None requested or recorded. Deploying to Vercel or using Supabase is not a cybersecurity or residency approval (ADR-005). | — | CDF cybersecurity and procurement |
| 6 | Approved identity architecture | UNVERIFIED | Synthetic persona sign-in behind Vercel Authentication (ADR-004), enabled only by `V13_PERSONA_SIGNIN=enabled`; no Supabase Auth users (CLAUDE.md §2). | Not an identity provider. PRODUCTION_SUBSTITUTION_REQUIRED: the CDF corporate IdP (OIDC) with MFA. | CDF identity owner |
| 7 | Records-retention requirements | UNVERIFIED | No retention schedule has been supplied (SOURCE_REQUIRED, never invented). The audit ledger is append-only: no UPDATE, DELETE or TRUNCATE path for anyone (CLAUDE.md §4). | Keeping everything is not an approved schedule. | CDF records management |
| 8 | Incident-response and backup arrangements | UNVERIFIED | No production incident-response or backup runbook exists. For the prototype, `docs/hosted/ISOLATION_AND_RECOVERY_PLAN.md` §7–§8 covers recovery and incident handling in the shared project; full removal (`database/hosted/rollback_v13.sql`) runs only on the owner's explicit word. | The free plan has no point-in-time recovery (plan §7). PRODUCTION_SUBSTITUTION_REQUIRED: CDF SOC (SLS/SIEM) and CDF backup arrangements. | CDF SOC and infrastructure |

**Result: QG-13 BLOCKED, by design** (OI-013). No deployment from this repository may hold real data, and no document
in it may describe a deployment as production or production-ready.

## 2. Synthetic staging readiness (V13-ARCH-003, V13-QA-006, Gate J)

Staging is the `develop` preview behind the staging alias, with synthetic data only.

| Step | Status | Evidence or blocker | Next owner |
| ---- | ------ | ------------------- | ---------- |
| Vercel project, Git link, a preview for every pushed branch | COMPLETE | `docs/DEPLOYMENT_STATUS.md` §3 | — |
| Vercel Authentication on every deployment (no custom domain) | COMPLETE | `docs/DEPLOYMENT_STATUS.md` §3 | — |
| No protection bypass on the staging alias | OPEN | OI-052: one shareable link, taken to be left by the Vercel connector's authenticated fetch, lets its holder past Vercel Authentication until 1 Nov 23:00:52 UTC; its token is not recorded anywhere | Owner |
| A deployment for every `develop` merge | BLOCKED (intermittent) | OI-038: the free plan's daily limit refuses some builds, so the staging alias can lag `develop` | Owner (plan) |
| Hosted schema: `0000`–`0005` applied, every per-step check PASS | COMPLETE | `docs/DEPLOYMENT_STATUS.md` §2; `docs/TEST_EVIDENCE.md` §2–§2.1 (fingerprint unchanged, isolation 27 checks, 0 breaches) | — |
| Hosted schema: `0006`–`0014` and the seed | BLOCKED | OI-034: waits for the owner to answer the Supabase connector's confirmation for statements that drop objects; never worked around | Owner ("ready"), then ARCH |
| Database login for the app | BLOCKED | OI-045: the owner runs `database/hosted/owner_set_app_login.sql` and sets `V13_DATABASE_URL` and `V13_SESSION_SECRET` as sensitive Vercel variables (`docs/hosted/OWNER_STEP_APP_LOGIN.md`). Claude never generates, reads, prints or passes these values | Owner, then ARCH |
| Pooler host for the app login confirmed from a live connection | NOT_STARTED | OI-007: read from the deployed health endpoint after OI-045 | ARCH |
| `/api/health` and `/api/health/isolation` PASS from the deployed preview | NOT_STARTED | Last read on 1 Nov at 01:32 UTC on `286eb93`: HTTP 503 `DB_NOT_CONFIGURED` (`docs/DEPLOYMENT_STATUS.md` §3) | ARCH (V13-ARCH-003) |
| Staging verification: smoke, case isolation, Scenarios A–E with deployment id and commit | NOT_STARTED | V13-QA-006, after the two owner steps above | QA and ARCH |
| Branch protection on `main` and `develop` | OPEN | OI-016: none; the GitHub connector cannot set it | Owner |
| Repository visibility | OPEN | OI-006 and E01 Q3: public, read from the GitHub API on 31 Oct at 23:31 UTC | Owner |

**Result: Gate J (QG-12) IN_PROGRESS.** Previews build and serve behind Vercel Authentication, but staging has no
database connection until OI-045 and OI-034 are cleared.

## 3. What this file never claims

- A READY Vercel deployment means that the build succeeded and the app serves. It is not an approval and not evidence
  for any item in §1.
- A green CI run, a passing gate or a COMPLETE row covers synthetic data and the prototype stack only.
- An item moves to verified only with its evidence: a CDF document, approval or measurement, cited here with its date.
  An inference never verifies an item.

## 4. Keeping it current

ARCH updates this file when a gate item gets evidence, when a staging step changes, and before the M1 milestone PR
(V13-ARCH-007), which reports every gate as measured. `docs/DEPLOYMENT_STATUS.md` remains the record of what each
connected system shows; this file only states what that means for promotion.
