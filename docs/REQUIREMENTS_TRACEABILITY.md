# CDF V13 Enterprise — Requirements Traceability

**SYNTHETIC-DATA REFERENCE IMPLEMENTATION.** This register traces requirements for the CDF Case & Notification Intelligence Platform — V13 Enterprise (Cultural Development Fund — صندوق التنمية الثقافي). It is not a production system and does not represent any hosting approval.


**Status: DRAFT (V13-ARCH-004).** Generated 28 Oct 2026 01:44 UTC from the owner's directive batches. The requirement
texts have not yet been reviewed row by row against the sources. Every row started at `NOT_STARTED`; a row's status
changes only when its task lands with evidence, and the M1 rows were assessed in V13-PROC-012 (§3.1). This file was
created as `docs/TRACEABILITY.md` and renamed to the directive's name, `docs/REQUIREMENTS_TRACEABILITY.md` (REQ-DOC-004). Owner team `OPS` was folded into `ARCH`, because DevOps is the Chief
Architect's role (board §1). The CSV is the master copy; edit rows in place and never renumber them.
Milestones were re-mapped on 28 Oct 2026 at 02:35 UTC to the plan's eight milestones (`docs/MASTER_EXECUTION_PLAN.md`
§4). The register first used a five-milestone scheme of its own (OPEN_ISSUES OI-019). At the same time E12 moved to
PROC and UXQA-19 to UX, as in the plan's deliverable tables, and REQ-INFRA-006 now states the owner's Supabase
decision of 28 Oct 00:29 UTC.

## 1. Purpose

`REQUIREMENTS_REGISTER.csv` is the single consolidated requirements register required by ORCHESTRATION §18 and SWARM §2. It merges the owner's specification — CLOUD_INIT, PROMPT_A (Parts I–XXX), PROMPT_B (§0–§24), PROMPT_B_NOTE, ORCHESTRATION (§0–§22), SWARM and OWNER_NOTE — into one deduplicated list of 448 testable requirements. Overlapping statements were merged into one row, with the other sources in `Merged_From` (208 rows carry merges). Each PROMPT_A Part XXIX prohibition (#1–#20), each deliverable E01–E23 and UXQA-01–20, and each required docs file has its own row; the other "do not" rules are rows of their own or are folded into the row they restate. Every row started as `NOT_STARTED`; §3.1 gives the M1 rows as assessed against merged work.

## 2. Field definitions

| Field | Meaning |
|---|---|
| Requirement_ID | `REQ-<AREA>-NNN`, permanent; numbered in register order within each area |
| Source_Prompt | Primary source: CLOUD_INIT, PROMPT_A, PROMPT_B, PROMPT_B_NOTE, ORCHESTRATION, SWARM, OWNER_NOTE |
| Section | Part/section as written in the source, e.g. `Part V §4 Authorization Model`, `§6 Scenario B` |
| Requirement | One testable statement in English; Arabic UI labels kept verbatim |
| Priority | P1–P8 per ORCHESTRATION §15 (see §3) |
| Gate | Quality gates the row evidences: QG-01–QG-13 (ORCHESTRATION §19) and/or Gate A–J (PROMPT_B §23) |
| Milestone | M1–M8 or LATER, as defined in `docs/MASTER_EXECUTION_PLAN.md` §4 (summary below the table); the earliest milestone in which the requirement must be demonstrably met for that milestone's scope; standing controls apply from then on |
| Owner_Team | ARCH, DB, FE, UX, PROC, QA, SEC (see §3) |
| Architecture_Component | Where the requirement lands; where a later decision replaced the directive's path, the real path with the directive's in brackets (§3.2) |
| Implementation_Status | COMPLETE / IN_PROGRESS / BLOCKED / NOT_STARTED / PRODUCTION_SUBSTITUTION_REQUIRED |
| Test_ID | The merged tests that exercise the row: file and test title or id, or `review: #PR ACCEPT <sha>` for a document deliverable (§3.1); empty while none exists. Until V13-PROC-012 it held planned identifier patterns only |
| Evidence | The merge (sha and PR) and its CI run, or the document; blank until executed results exist |
| Open_Issue | The `docs/OPEN_ISSUES.md` items (OI-nnn) that block or qualify the row, or an unresolved approval the source itself flags |
| Merged_From | Other source sections folded into the row, separated by `; ` |

Milestones (plan §4): **M1** enterprise foundation (Slice 1 and the core of Slices 2, 3 and 5: app shell, persona sign-in, 10 synthetic cases, 3 roles, 3 workspaces, the five foundational screens, case-linked notification history, Playwright isolation tests, CI, synthetic staging) · **M2** multi-case and multi-workspace (Slices 2–3 complete: portfolio views, saved views, global search and palette, quick case switcher, workspace dashboards, My Work with deadlines) · **M3** procedural intelligence (Slice 4: journeys, actual and expected progress) · **M4** Notification Center (Slice 5: catalogue, templates, recipients, disclosure, generation) · **M5** notification operations (Slice 6: approval, outbox dispatch, delivery records, retry, corrections; stub sender) · **M6** advanced capabilities (Slice 7: committees, investigations, legal review, competent authority, reporting, administration) · **M7** operational hardening (Slice 8: security, performance, backup, monitoring, readiness assessment) · **M8** final delivery (E22, E23, UXQA-18, UXQA-20) · **LATER** conditional on approvals that do not exist (e.g. real-data production release).

## 3. Counts (computed from the CSV)

Total rows: **448**. By primary source: CLOUD_INIT 17, PROMPT_A 277, PROMPT_B 84, PROMPT_B_NOTE 4, ORCHESTRATION 49, SWARM 14, OWNER_NOTE 3.

**By area**

| Area | Rows | Area | Rows |
|---|---|---|---|
| INFRA | 10 | PERF | 12 |
| ARCH | 29 | CICD | 12 |
| DATA | 27 | DEPLOY | 16 |
| SEC | 31 | PROD | 22 |
| IA | 12 | MIG | 7 |
| DASH | 11 | TEST | 5 |
| WS | 11 | QA | 39 |
| PORT | 13 | A11Y | 14 |
| CASE | 15 | RTL | 6 |
| TASK | 6 | VIS | 18 |
| SRCH | 8 | DS | 16 |
| NOTIF | 18 | GOV | 28 |
| JRN | 12 | SWARM | 11 |
| DISP | 15 | DOC | 16 |
| AUD | 8 |  |  |

**By priority**

| Priority | Meaning | Rows |
|---|---|---|
| P1 | Security, privacy, mandatory governance | 80 |
| P2 | Procedural truth, data integrity | 77 |
| P3 | Multi-case isolation, authorization | 47 |
| P4 | Functional correctness | 93 |
| P5 | Maintainability, architecture simplicity | 79 |
| P6 | Accessibility, usability | 40 |
| P7 | Visual quality, brand | 28 |
| P8 | Optional enhancement | 4 |

**By milestone**

| M1 | M2 | M3 | M4 | M5 | M6 | M7 | M8 | LATER |
|---|---|---|---|---|---|---|---|---|
| 280 | 59 | 13 | 10 | 23 | 23 | 30 | 6 | 4 |

**By owner team**

| Code | Team | Rows |
|---|---|---|
| ARCH | Chief Architect & Orchestrator, DevOps & Deployment | 132 |
| DB | Database & Supabase | 55 |
| FE | Frontend Engineering | 69 |
| UX | UX/UI Design | 40 |
| PROC | Procedural Intelligence | 37 |
| QA | Playwright & Visual QA | 76 |
| SEC | Security & Adversarial Testing | 39 |

### 3.1 M1 coverage (V13-PROC-012)

The 280 rows with `Milestone` = M1, counted from this CSV. Their statuses were assessed against the merges up to
`develop` **`4cc72ec`** (merge of #67, 31 Oct 2026), plus #72 (REQ-SEC-002, REQ-GOV-001), #75 (REQ-ARCH-025) and #77
(REQ-DOC-008). The status of each row comes from merged files only: COMPLETE needs the implementing code and a test that exercises it, both
merged, with the test named in `Test_ID` and the merge (and its CI run) in `Evidence`; IN_PROGRESS means part of it is
merged; BLOCKED names its open issue; nothing was taken from a plan or a STATUS line. Two kinds of row follow the Chief
Architect's rulings on #71:

- A **document deliverable** is COMPLETE when the document is merged, an independent reviewer accepted it and it covers
  what the row asks for M1; its `Test_ID` reads `review: #PR ACCEPT <sha>`. A living document that M1 only starts stays
  IN_PROGRESS.
- A **standing rule** (a prohibition or a process rule) is COMPLETE only when an automated check enforces it and
  `Test_ID` names that check. Otherwise it stays IN_PROGRESS with `Evidence` "standing rule, review-enforced; no breach
  found on develop `<sha>`".

COMPLETE rows on QG-02, QG-03 or QG-05, or owned by SEC, were checked by SEC before merge. REQ-SEC-002 and REQ-GOV-001
are COMPLETE on SEC-008's repository scans (#72, `afa6684`), at SEC's verdict. Later merges (#61, #68, #69 and onwards)
were not re-assessed in this pass; their owners update their rows (§6).

**By status**

| Status | Rows |
|---|---|
| COMPLETE | 68 |
| IN_PROGRESS | 172 |
| — of which review-enforced standing rules | 51 |
| — of which document or configuration evidence only, no test | 39 |
| BLOCKED | 16 |
| PRODUCTION_SUBSTITUTION_REQUIRED | 1 |
| NOT_STARTED | 23 |
| **Total** | **280** |

**By owner team**

| Owner team | Rows | COMPLETE | IN_PROGRESS | BLOCKED | PSR | NOT_STARTED |
|---|---|---|---|---|---|---|
| ARCH | 105 | 9 | 82 | 12 | 0 | 2 |
| QA | 51 | 9 | 24 | 4 | 0 | 14 |
| DB | 33 | 15 | 17 | 0 | 1 | 0 |
| FE | 31 | 12 | 19 | 0 | 0 | 0 |
| SEC | 27 | 14 | 13 | 0 | 0 | 0 |
| UX | 26 | 5 | 14 | 0 | 0 | 7 |
| PROC | 7 | 4 | 3 | 0 | 0 | 0 |

PSR = PRODUCTION_SUBSTITUTION_REQUIRED.

**By gate** (a row with several gates counts under each; "(none)" is a row without a gate)

| Gate | Rows | COMPLETE | IN_PROGRESS | BLOCKED | PSR | NOT_STARTED |
|---|---|---|---|---|---|---|
| QG-01 | 10 | 2 | 8 | 0 | 0 | 0 |
| QG-02 | 29 | 10 | 16 | 3 | 0 | 0 |
| QG-03 | 32 | 21 | 8 | 2 | 1 | 0 |
| QG-04 | 11 | 5 | 6 | 0 | 0 | 0 |
| QG-05 | 18 | 6 | 10 | 1 | 0 | 1 |
| QG-06 | 23 | 4 | 16 | 2 | 0 | 1 |
| QG-07 | 18 | 1 | 7 | 0 | 0 | 10 |
| QG-08 | 17 | 3 | 10 | 0 | 0 | 4 |
| QG-09 | 7 | 1 | 4 | 0 | 0 | 2 |
| QG-10 | 4 | 1 | 3 | 0 | 0 | 0 |
| QG-11 | 14 | 0 | 11 | 2 | 0 | 1 |
| QG-12 | 15 | 0 | 4 | 10 | 0 | 1 |
| QG-13 | 15 | 1 | 11 | 3 | 0 | 0 |
| Gate A | 4 | 0 | 3 | 1 | 0 | 0 |
| Gate B | 19 | 7 | 9 | 3 | 0 | 0 |
| Gate C | 23 | 14 | 7 | 2 | 0 | 0 |
| Gate D | 5 | 0 | 2 | 0 | 0 | 3 |
| Gate E | 16 | 3 | 9 | 0 | 0 | 4 |
| Gate F | 6 | 1 | 3 | 0 | 0 | 2 |
| Gate G | 6 | 0 | 4 | 1 | 0 | 1 |
| Gate H | 2 | 0 | 2 | 0 | 0 | 0 |
| Gate I | 5 | 3 | 2 | 0 | 0 | 0 |
| Gate J | 10 | 0 | 1 | 9 | 0 | 0 |
| (none) | 110 | 18 | 85 | 2 | 0 | 5 |

### 3.2 Superseded wording (Chief Architect)

Some requirement texts, taken from the directive, name something that a later binding decision replaced. The
requirement text stays as written; the replacing decision is noted in `Evidence`, and `Architecture_Component` names
the real location with the directive's path in brackets. Nothing was silently rewritten.

| Rows | Directive's wording | Replaced by | Decision |
|---|---|---|---|
| REQ-ARCH-024; components of REQ-DATA-020, -022, -024, -026, REQ-SEC-003, -011, REQ-TEST-004, -005 | `supabase/` (migrations, seeds, tests) | `database/migrations` and `database/seed`, applied by the repository runner; tests in `tests/integration`, `tests/security/db` and `tests/unit` | ADR-012; CLAUDE.md §2 (the Supabase migration tool is never used) |
| REQ-ARCH-024 | `features/`, `lib/database`, `lib/permissions` | `app/`, `components/`, `lib/server`; `lib/db`; `lib/authz` | CLAUDE.md §3 |
| REQ-SEC-005 | "Supabase Auth" | Synthetic persona sign-in behind Vercel Authentication; PRODUCTION_SUBSTITUTION_REQUIRED: the CDF corporate IdP (OIDC) | ADR-004; CLAUDE.md §2 |
| REQ-INFRA-009 | "Supabase environment variables" | `V13_DATABASE_URL` and `V13_SESSION_SECRET`, sensitive Vercel variables that the owner sets (OI-045) | ADR-012; CLAUDE.md §3 (no `@supabase/*` package) |
| REQ-DOC-004 | `docs/REQUIREMENTS_TRACEABILITY.md` | This file, renamed from `docs/TRACEABILITY.md` to the directive's name | — |
| REQ-DOC-012 | Ten named columns | The ten columns plus `Gate`, `Milestone`, `Owner_Team` and `Merged_From` (§2) | — |

## 4. Gate crosswalk

PROMPT_A Part XXIII "Mandatory Gates" lists the conditions that block production deployment (register row REQ-CICD-010). The single gate rule — all gates pass with evidence, failed gates stay visible — is REQ-GOV-028. "Rows tagged" counts register rows whose `Gate` field names the gate.

| QG (ORCHESTRATION §19) | PROMPT_B §23 gate | PROMPT_A Part XXIII: production blocked when… | Rows tagged (QG / B gate) |
|---|---|---|---|
| QG-01 Source Integrity | — | — | 10 / — |
| QG-02 Multi-Case Integrity | Gate B Case Isolation | Authorization tests fail | 31 / Gate B 20 |
| QG-03 Authorization | Gate C Authorization | Authorization tests fail; Security checks fail | 41 / Gate C 27 |
| QG-04 Procedural Truth | Gate I Procedural Accuracy | — | 35 / Gate I 9 |
| QG-05 Disclosure | Gate C (restricted content) — no dedicated B gate | Disclosure tests fail; Security checks fail | 29 / Gate C 27 |
| QG-06 Functional Correctness | Gate A Functional Integrity; Gate G Responsive Experience (nearest, no direct QG) | Critical tests fail; Database migrations fail | 44 / Gate A 4, Gate G 7 |
| QG-07 Visual Quality | Gate D Visual Integrity | — | 31 / Gate D 8 |
| QG-08 Accessibility | Gate E Accessibility | — | 17 / Gate E 16 |
| QG-09 Arabic RTL | Gate F Arabic RTL | — | 9 / Gate F 7 |
| QG-10 Performance | Gate H Performance | — | 14 / Gate H 8 |
| QG-11 Regression | Gate D (visual regressions only) | Critical tests fail | 15 / Gate D 8 |
| QG-12 Deployment | Gate J Deployment Verification | — (smoke tests follow production deployment in the pipeline) | 16 / Gate J 10 |
| QG-13 Production Authorization | — | Required deployment approvals are missing; Infrastructure residency requirements are unresolved | 37 / — |

Gate G (Responsive Experience) has no direct QG equivalent; QG-01 and QG-13 have no PROMPT_B gate; "Database migrations fail" has no dedicated QG and is mapped to QG-06.

## 5. Deliverables

**PROMPT_A Part XXVII — E01–E23**

| Code | Deliverable | Row | Owner | Milestone |
|---|---|---|---|---|
| E01 | Enterprise Current-State Audit | REQ-ARCH-025 | ARCH | M1 |
| E02 | Multi-Case Conceptual Architecture | REQ-ARCH-026 | ARCH | M1 |
| E03 | Enterprise Data Model and ERD | REQ-DATA-025 | DB | M1 |
| E04 | Supabase SQL Migrations | REQ-DATA-026 | DB | M1 |
| E05 | RLS and Authorization Matrix | REQ-SEC-029 | SEC | M1 |
| E06 | Enterprise Information Architecture | REQ-IA-012 | UX | M1 |
| E07 | Multi-Workspace UX/UI Design | REQ-WS-011 | UX | M1 |
| E08 | Case Portfolio and Case Workspace | REQ-PORT-013 | FE | M1 |
| E09 | Enterprise Dashboard | REQ-DASH-011 | FE | M2 |
| E10 | Notification Operations Center | REQ-NOTIF-018 | FE | M1 |
| E11 | Three-Level Journey Integration | REQ-JRN-012 | PROC | M3 |
| E12 | Notification Dispatch Architecture | REQ-DISP-015 | PROC | M5 |
| E13 | Complete Next.js Source Code | REQ-ARCH-027 | FE | M1 |
| E14 | Supabase Backend Implementation | REQ-DATA-027 | DB | M1 |
| E15 | GitHub Repository | REQ-CICD-011 | ARCH | M1 |
| E16 | Vercel Preview/Staging Deployment | REQ-DEPLOY-015 | ARCH | M1 |
| E17 | Automated Test Suite | REQ-TEST-005 | QA | M1 |
| E18 | Security and Performance Report | REQ-SEC-030 | SEC | M7 |
| E19 | Migration and Rollback Plan | REQ-MIG-007 | ARCH | M1 |
| E20 | Production Readiness Assessment | REQ-PROD-019 | ARCH | M7 |
| E21 | Operational Runbooks | REQ-PROD-020 | ARCH | M7 |
| E22 | Executive Architecture and Approval Paper | REQ-PROD-021 | ARCH | M8 |
| E23 | Final Reproducible Source Package | REQ-PROD-022 | ARCH | M8 |

**PROMPT_B §22 — UXQA-01–20**

| Code | Deliverable | Row | Owner | Milestone |
|---|---|---|---|---|
| UXQA-01 | Browser Testing Architecture | REQ-QA-031 | QA | M1 |
| UXQA-02 | Playwright Test Suite | REQ-QA-032 | QA | M1 |
| UXQA-03 | Multi-Case Journey Tests | REQ-QA-033 | QA | M1 |
| UXQA-04 | Workspace Navigation Tests | REQ-QA-034 | QA | M1 |
| UXQA-05 | Screenshot Evidence Library | REQ-VIS-015 | QA | M1 |
| UXQA-06 | Visual Regression Baselines | REQ-VIS-016 | QA | M2 |
| UXQA-07 | Accessibility Audit | REQ-A11Y-014 | QA | M1 |
| UXQA-08 | Arabic RTL Quality Report | REQ-RTL-006 | QA | M1 |
| UXQA-09 | Enterprise UX Heuristic Assessment | REQ-QA-035 | UX | M2 |
| UXQA-10 | AI Visual Design Recommendations | REQ-VIS-017 | UX | M2 |
| UXQA-11 | Performance and Responsiveness Report | REQ-PERF-012 | QA | M7 |
| UXQA-12 | Adversarial Interaction Test Results | REQ-QA-036 | QA | M2 |
| UXQA-13 | Corrected UI Components | REQ-DS-016 | UX | M1 |
| UXQA-14 | Before/After Comparison | REQ-VIS-018 | QA | M1 |
| UXQA-15 | GitHub CI/CD Quality Pipeline | REQ-CICD-012 | ARCH | M1 |
| UXQA-16 | Vercel Preview Verification | REQ-DEPLOY-016 | QA | M1 |
| UXQA-17 | Supabase Authorization Test Report | REQ-SEC-031 | SEC | M1 |
| UXQA-18 | UX Quality Scorecard | REQ-QA-037 | QA | M8 |
| UXQA-19 | Prioritized UX Improvement Backlog | REQ-QA-038 | UX | M1 |
| UXQA-20 | Executive UX/UI Assurance Report | REQ-QA-039 | QA | M8 |

## 6. How to update

- **One register.** Edit only `REQUIREMENTS_REGISTER.csv`; never start a second register (ORCHESTRATION §18). Keep UTF-8, the header row and RFC 4180 quoting.
- **Status vocabulary:** `COMPLETE`, `IN_PROGRESS`, `BLOCKED`, `NOT_STARTED`, `PRODUCTION_SUBSTITUTION_REQUIRED` (a prototype stand-in, such as the synthetic persona sign-in of ADR-004 in place of the CDF corporate identity provider, that must be replaced before production).
- **COMPLETE needs proof.** A row may be marked COMPLETE only when `Test_ID` names real tests and `Evidence` points to executed results (CI run ID and commit, a `docs/TEST_EVIDENCE.md` entry, a deployment URL or screenshot reference). Planned patterns and passing builds are not evidence.
- **BLOCKED** rows state the blocker in `Open_Issue`. A failed gate stays visible; never hide it behind a percentage (ORCHESTRATION §19).
- **IDs are permanent.** New requirements take the next number in their area; never renumber or reuse an ID. When a requirement turns out to duplicate another, fold it into the surviving row's `Merged_From`.
- **Owners update, the Chief Architect reviews.** Each team updates its rows with each integrated increment; the Chief Architect checks coherence.
- After every edit, recompute the counts and tables in this file from the CSV with a script; never hand-edit them.

## Resolutions of the ambiguities found while building the register (Chief Architect, 28 Oct 2026)

| # | Ambiguity | Resolution |
| - | --------- | ---------- |
| 1 | Case-specific journeys: the first slice or later | Per-case journey instances in M1 (REQ-JRN-007); three-level actual and expected progress in M3 |
| 2 | The two M1 workspaces are not named | Three workspaces: SECRETARIAT, INVESTIGATIONS, GOVERNANCE (ADR-014, DB seed) |
| 3 | "Case Administration" workspace has no defined focus | Not in M1; open until a source defines it (REQ-WS-009) |
| 4 | No performance budgets in any source | Budgets are agreed in M7 (QG-10 / Gate H stay NOT_STARTED until then) |
| 5 | Gate G and "database migrations fail" have no QG | Mapped to QG-06, as the crosswalk shows |
| 6 | Option A/B/C open; existence of a CDF case system unverified | ADR-001 default (own records behind `CaseSourceAdapter`), owner card open (OI-003) |
| 7 | "Approved region" for the Supabase project | Owner decision 28 Oct 00:29: the existing project CDF GC Review, `eu-central-1` (ADR-012); production stays blocked by the hosting gate (ADR-005) |
| 8 | Staging environment vs the Development/Preview/Production scopes | Staging is the `develop` branch preview (DEPLOYMENT_STATUS §3–§4) |
| 9 | Notification Operations Center in M1, most of its views from Slices 5–6 | The screen exists in M1 with the views M1 statuses support; the rest arrive in M4 and M5 |
| 10 | Vercel project name | `cdf_notification_generator` (exists) |
| 11 | "Administrative campaigns, if approved" names no approver | LATER; the approver is the owner's decision when campaigns are planned |
| 12 | Delivery channels are only "evaluated" | Evaluated in M5; a stub sender only until then (ADR-010, OI-015) |
| 13 | Availability of the official CDF Design Guide | Available: UX cites its pages (pp. 29, 33, 37, 42). The brand Arabic font stays SOURCE_REQUIRED (OI-005) |
| 14 | Performance is not on the ORCHESTRATION §15 priority scale | Treated as P4 |
