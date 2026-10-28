# E02 — Multi-case conceptual architecture

**CDF Case & Notification Intelligence Platform — V13 Enterprise · deliverable E02 · 2026-10-28**
**SYNTHETIC-DATA REFERENCE IMPLEMENTATION — not CDF production.** Owner: ARCH (task V13-ARCH-006, register row
REQ-ARCH-026). Status: **IN_REVIEW** (SEC reviews §5). It covers M1 in full and names the structure of M2–M8, so
that M1 leaves room for it.

Labels: **DECIDED** = an ADR in `docs/ARCHITECTURE_DECISIONS.md` · **DESIGNED** = a team design document, cited,
under review where noted · **PLANNED** = a milestone of `docs/MASTER_EXECUTION_PLAN.md` §4 · **PROPOSED** ·
**SOURCE_REQUIRED** · **PRODUCTION_SUBSTITUTION_REQUIRED**. Nothing here is approved for real data or production.

## 1. What changes

V12 and the V13 reference package revolve around one selected case. E01 §2–§3 found a stateless generator,
single-case fixtures and case context held in the browser. V13 Enterprise revolves around an organisation-wide
**portfolio** instead. Each case in it has its own lifecycle, procedures, tasks, notifications, decisions, evidence
and audit history, and many authorised people work on many cases at the same time through **workspaces**
(REQ-ARCH-016).

This document sets out the model that makes that safe:
- what the objects are;
- which boundary contains each one;
- who may see what;
- how a request, a procedural fact and a notification move through the layers.

## 2. Conceptual hierarchy

The tree follows the directive (Prompt A Part III). Each line gives the milestone in which that part arrives.

```
CDF ORGANISATION — one organisation, no commercial multi-tenancy (REQ-ARCH-018)
├── Enterprise Administration ....................... M6 (System Administration workspace)
├── Case Portfolio .................................. M1 /portfolio (table); M2 views, saved views, search
│   └── Case (UUID key; display number CDF-DEMO-2026-NNNN, never a key)
│       ├── Case details ............................ M1 overview
│       ├── Procedures and journeys ................. M1 recorded events; M3 procedures, journeys
│       ├── Investigation ........................... M6
│       ├── Committee activities .................... M6
│       ├── Decisions ............................... M6
│       ├── Notifications ........................... M1 history and drafts; M4 generation; M5 dispatch
│       ├── Evidence ................................ M6 (storage model open, §10)
│       └── Audit history ........................... M1 ledger; viewer later
├── Workspaces — lenses over the one portfolio ...... M1 Secretariat, Investigations, Governance; M6 the rest
├── My Work ......................................... M1 tasks; M2 deadlines and views
├── Notification Center ............................. M1 Operations Center list; M4–M5 operations
├── Committee Operations ............................ M6
├── Reporting & Analytics ........................... M6
└── Governance & Audit .............................. M1 ledger; M6 area
```

Workspaces are logical views over authorised data. They never become separate databases or separate security
domains (Part III and Part VIII; invariant P2 below).

## 3. Invariants

Every component keeps these rules. The first column gives the rule; the others say where it is enforced and how it is
proved.

| # | Invariant | Enforced in | Proved by |
| - | --------- | ----------- | --------- |
| P1 | **The case is the unit of isolation.** Every case-scoped row carries `case_id`. Child rows reference their parent by `(id, case_id)`, so the database refuses a row that points at another case's record. | Schema (E03 §1, DESIGNED) | DB integrity tests; QA Scenario E; Case Context Sentinel (V13-QA-003) |
| P2 | **Workspaces are lenses.** A workspace chooses which cases and actions appear. It never changes who the user is and never widens access. The database re-checks the membership on every request. | `current_workspace_id()` (E03 §4); the switch Server Action (FE DESIGN §1); UX WORKSPACES §2 | Scenario C, including the refused switches (QA TEST_ARCHITECTURE) |
| P3 | **Context comes from the URL and the authenticated claims only.** The case UUID is in the route. Persona and workspace come from the signed session and become MAC-checked claims in each transaction. No case id is held in browser storage or long-lived client state, so cases in different tabs are independent renders. | ADR-003, ADR-014 (DECIDED); FE DESIGN §1 | Scenarios A and B; browser storage checked empty of case ids |
| P4 | **Truth comes from recorded events.** Statuses are folds over recorded events (Layer A). The expected process (Layer B) is always labelled as expected. A `recorded` mark carries its event id. | `lib/domain` (V13-PROC-001); ADR-013 DOM attributes; plan §8 ruling | Procedural Truth Inspector (V13-QA-004) |
| P5 | **Authorise twice, before anything is shown.** The application pre-checks; the database decides again with RLS and command checks. Unknown and unauthorised ids give the same answer. Counts, filters and search run after authorisation. | `lib/authz`; RLS; `can_access_case()` | Negative tests (CLAUDE.md §7): other case, workspace, persona; restricted; closed; unknown id |
| P6 | **Every change is a command that writes its audit event in the same transaction.** The ledger is append-only and hash-chained. Audit metadata holds ids and codes only. | `api_*` functions; ADR-011 (DECIDED) | `verify_audit_chain()`; append-only tests |
| P7 | **Every outside dependency sits behind a port**, and each prototype is labelled as one. | `lib/contracts` ports (plan §3) | §11 substitution table |
| P8 | **Synthetic data only** until the hosting gate passes. | ADR-005 (DECIDED) | QG-13 stays BLOCKED |

## 4. Domain contexts

The directive's Part IV tables are logical entities, to be consolidated rather than created one by one
(REQ-DATA-002). DB's M1 draft consolidates the M1 part into 18 tables (E03 §3, DESIGNED, under SEC review).

| Context | What it holds | M1 records (E03) | Later | Code home (board owner) | Arrives |
| ------- | ------------- | ---------------- | ----- | ----------------------- | ------- |
| Identity and access | personas, workspaces, roles; memberships (persona × workspace × role, with a validity window) | `persona`, `workspace`, `role`, `persona_workspace_membership`, `claims_key` | delegation (M2); conflict declarations and recusal, classification, organisation units (M6) | `lib/contracts`, `lib/auth` (ARCH); `lib/authz` (FE); migration 0001 (DB) | M1 |
| Case registry | the case and who may see it | `case_record` (stage, `is_restricted`, `records_state`, owning workspace, `source_system`, `source_ref`, `row_version`), `case_workspace_visibility`, `case_assignment` (capacity, window) | case types, status history (M3); participants, relationships, tags, classifications (M6) | `CaseSourceAdapter` (ARCH contract, FE adapter); migration 0002 (DB) | M1 |
| Procedural intelligence | what happened and what is expected | `procedural_event` (append-only, with provenance), `task` | procedures, types and transitions; task dependencies; journey definitions, versions and instances | `lib/domain`, `lib/journeys` (PROC); migration 0003 (DB) | M1 core, M3 |
| Notification intelligence | what is sent, to whom, with what disclosure, and what happened to it | `notification_template` and `_version` (content hash), `notification_recipient_class`, `notification` (idempotency key, supersession), `notification_event`, `dispatch_outbox` (content-free, unused until M5) | catalogue, renderings, disclosure policy versions (M4); approvals, dispatches, attempts, delivery events, acknowledgements, corrections (M5) | `lib/notifications`, `lib/disclosure`, `lib/render` (PROC); migration 0004 (DB) | M1 history, M4, M5 |
| Committee operations | committees, memberships, meetings, agendas, minutes, directions, recommendations, votes | — | all | not yet assigned | M6 |
| Decisions and execution | decisions, authorities, approvals, actions, implementation records | — | all; the reference package's authority rules (45 actions, E01 §5) | `lib/authority` (PROC) | M6 |
| Evidence and records | evidence, versions, access grants, chain of custody, retention | — | all; storage model open (§10) | not yet assigned | M6 |
| Audit and security | the ledger; later security and integration events | `audit_event` (hash chain, V13 advisory-lock namespace) | authorisation decisions, security events, integration events | migration 0001 (DB); `AuditSinkPort` | M1 |

Rules at the boundaries between contexts:
- **One access rule.** Only the case registry decides whether a case is visible: `can_access_case()`, "the single
  case-access rule" in E03 §5. Every other context asks it and never keeps its own copy of the answer.
- **One case for life.** A procedural event, task or notification belongs to exactly one case and cannot be moved
  to another.
- **Notifications read procedural facts; they never create them.** No case transition is inferred from a notification
  (REQ-CASE-008).
- **Disclosure stands between content and every renderer.** Everything is prohibited unless the recipient class's
  policy allows it. The reference policy has 1,898 rows over 13 recipient classes (E01 §5).
- **Audit is write-only for the application.** Commands write it; no application role can read it; verification is an
  administrator function.

## 5. Authorisation model

### 5.1 Layers

```
Browser
 └─► Vercel Authentication — team members only; the outer gate (ADR-004)
      └─► proxy.ts — security headers and the session gate
           └─► session cookie __Host-v13_session — persona_id + active workspace; HS256, 8 hours (ADR-004)
                └─► lib/authz pre-check — pure role × workspace × action table; a refusal looks like "not found"
                     └─► lib/db withRequestContext — BEGIN · SET LOCAL ROLE cdf_v13_user ·
                          request.v13.claims + request.v13.claims_mac (ADR-014)
                          └─► PostgreSQL — _verified_claims() → current_persona_id(), current_workspace_id(),
                               current_role_codes() → can_access_case() → RLS on every row and the checks inside
                               each api_* command (role, capacity, case state, row_version)
```

A forged claim, a claim rewritten after its MAC, or a MAC replayed from another transaction resolves to "no claims",
so it grants nothing (ADR-014). Policies also require `current_user = 'cdf_v13_user'`, so a query that escaped the
request context sees nothing.

RLS binds the caller, never the table owner (threat TM-T10). Every V13 table is owned by `cdf_v13_owner`, and RLS does
not apply to a table's owner (no V13 table uses FORCE ROW LEVEL SECURITY). So every V13 view is created
`WITH (security_invoker = true)`, and every read function (`portfolio_page()`, `case_header()`, `my_work_tasks()`,
`case_notifications()` and later ones) is `SECURITY INVOKER`, so RLS applies to the caller. `SECURITY DEFINER` is
allowed in four groups only:
- the `api_*` commands. RLS does not apply inside them, so their own checks are the control there, and every
  case-keyed command calls `can_access_case()` itself;
- the claims and access-rule helpers that policies and commands call (`_verified_claims()` and the functions it uses,
  the `current_*()` functions, `has_role()`, `_is_colleague()`, `is_assigned_to_case()`, `can_access_case()`), which
  answer only questions about the caller's own claims and access, and the trigger `_case_owning_visibility()`, which
  keeps a case's owning workspace listed as visible;
- `current_persona()`, which returns only the caller's own row;
- the audit internals `_append_audit()` and `verify_audit_chain()`, which are not granted to `cdf_v13_user`.

SEC's catalog test SEC-DB-30 fails on any V13 view without `security_invoker` and on any `SECURITY DEFINER` function
outside these groups.

### 5.2 The case-access rule (M1)

A persona sees a case only when all of these hold (E03 §5):
- its claims verify to an active persona;
- that persona holds an active membership in the claimed workspace;
- the case is visible in that workspace;
- the case is not restricted, or the persona holds an active assignment on it.

Closed cases stay readable, and every command refuses to change them.

### 5.3 The directive's authorisation dimensions (REQ-SEC-009)

| Dimension | Mechanism | Arrives |
| --------- | --------- | ------- |
| Role-based (RBAC) | a role per membership, derived in the database; the client never sends roles | M1 |
| Attribute-based (ABAC) | case attributes `is_restricted` and `records_state`; classification later | M1; classification M6 |
| Case-level rules | `case_workspace_visibility` and `case_assignment` | M1 |
| Procedural capacity | `case_assignment.capacity` (LEAD_INVESTIGATOR, INVESTIGATOR, SECRETARY, GOVERNANCE_REVIEWER; DESIGNED); procedure-level authorisation (REQ-SEC-014) | M1 capacity; M3 procedure level |
| Classification | M1 has one flag, restricted; a classification scheme is SOURCE_REQUIRED | M6 |
| Delegation | delegated work appears in My Work (REQ-DATA-004) | M2 |
| Recusal | a recused member loses access to restricted deliberations (REQ-SEC-015) | M6 |
| Need-to-know | a restricted case is visible only with an active assignment (REQ-SEC-013) | M1 |
| Recipient-specific disclosure | disclosure projection before rendering (REQ-NOTIF-016) | M4 |

### 5.4 Administrators

Administrative or technical privilege never grants case content (REQ-SEC-016). In M1 no role reaches case content
through administration. The System Administration workspace (M6, PLANNED) gets configuration rights only.

Two technical functions sit outside the case-access rule. `verify_audit_chain()` runs only as the owner or the
administrator; it is not granted to `cdf_v13_user` and returns counts only. `api_install_claims_key()` is the one
technical command the request role can call: it installs the claims key once, refuses a different key, and is audited
without key material. Rotating the key clears it with an audited script that only the Chief Architect runs
(`database/hosted/reset_claims_key.sql`, DB-001); the app then installs the new key (ADR-014).

One residual risk comes from sharing the database. The shared project's administrator `postgres` can read V13
tables (OI-014). This is acceptable only for synthetic data; production needs a dedicated database (ADR-012).

### 5.5 The directive's mandatory security tests (Part V)

| Test | Where it is proved | Arrives |
| ---- | ------------------ | ------- |
| User A cannot reach Case B by changing the URL (REQ-SEC-017) | FE-004 negative tests; SEC-APP-01 and SEC-DB-18; QA Scenarios A and D | M1 |
| A committee member cannot reach a case outside their membership (REQ-SEC-018) | committee workspace tests | M6 |
| A recused member loses access to restricted deliberations (REQ-SEC-015) | committee workspace tests | M6 |
| An external recipient never reaches internal information (REQ-NOTIF-017) | dispatch and disclosure tests | M5 |
| Changing workspace grants nothing (REQ-SEC-019) | SEC-DB-06 and SEC-APP-05; QA Scenario C with refused switches | M1 |
| A service-role credential never reaches the browser (REQ-SEC-002) | bundle scan (REQ-DEPLOY-013); SEC-APP-13 | M1 |

External recipients have no login at all in V13. Every user is an authenticated CDF staff persona, and a portal
would be a second app under a new ADR (ADR-002). V13 has no service-role key either: there is no `@supabase/*`
package and no Data API exposure (ADR-003, ADR-012).

## 6. Runtime view: one request

```mermaid
sequenceDiagram
  autonumber
  participant B as Browser
  participant V as Vercel Authentication
  participant P as proxy.ts
  participant S as Server Component or Action
  participant Z as lib/authz
  participant A as lib/server and CaseSourceAdapter
  participant D as lib/db withRequestContext
  participant G as PostgreSQL cdf_notifications_v13
  B->>V: GET /cases/{uuid}/tasks
  V->>P: team member only
  P->>S: verified session (persona, workspace)
  S->>Z: precheck(claims, case.tasks.read, uuid)
  Z-->>S: allow (a refusal renders the same not-found page)
  S->>A: listCaseTasks(uuid)
  A->>D: one transaction
  D->>G: BEGIN · SET LOCAL ROLE cdf_v13_user · claims + MAC
  G-->>D: rows RLS allows (none for unknown or unauthorised)
  D-->>A: COMMIT
  A-->>S: view model, never raw rows
  S-->>B: HTML; every case-owned element carries data-case-id
```

A write follows the same path and adds these steps (FE DESIGN §3):
1. The input is validated with the command's Zod schema from `lib/contracts`.
2. The case id comes from the route and is re-validated on the server.
3. The current `row_version` is sent.
4. One `api_*` call writes three things in the same transaction: the change, its procedural or notification event,
   and its audit event.
5. A failure reaches the user as a generic message with a correlation id.

Pooled connections cannot leak context between requests. Everything is transaction-local (`SET LOCAL`,
`set_config(…, true)`), and the login `cdf_v13_app` holds no privilege of its own (ADR-003, ADR-014).

## 7. Multi-case context

- **The URL is the only case context** (`/cases/[uuid]/…`). Display numbers are shown but never accepted as keys
  (UX INFORMATION_ARCHITECTURE §2).
- **The workspace lives in the signed session** and is shared by the persona's tabs. Another tab re-checks access on
  its next request (UX WORKSPACES §4). Per-tab workspaces would move the workspace into the URL; that is PROPOSED and
  not part of M1.
- **One case per case page.** Every case-owned element carries `data-case-id` and `data-case-ref` (ADR-013). The Case
  Context Sentinel fails any page where a case's element contains another case's id or reference.
- **Views are restorable without storage.** Portfolio filters live in the query string, so a view can be shared and
  restored (Scenarios A and D).
- **Batches are per case.** Multi-case generation (M4) evaluates and authorises each case on its own (REQ-NOTIF-008).

## 8. Procedural truth: two layers, three levels

- **Layer A — actual progress.** Folds over recorded procedural events, which are append-only and carry their
  provenance (`RECORDED_IN_V13` or `SEED_SYNTHETIC`). A status exists only where an event supports it (REQ-JRN-001,
  a standing rule from M1).
- **Layer B — expected process.** Comes from the journey definition version pinned to the case (M3). It is always
  labelled expected, conditional or awaiting approval and is never shown as done. History is never re-read through a
  newer definition (REQ-JRN-006, -008, -009).
- **Separate status families.** Case, procedure, task, meeting, decision, notification and delivery statuses are
  modelled and shown apart (REQ-JRN-002), as in the reference status model (E01 §5).
- **Three levels.** Level 1 is the master case journey. It fails closed until the CDF_CASE_V1 → V8 mapping is supplied
  (OI-004, SOURCE_REQUIRED). Level 2 is the purpose-specific journeys and Level 3 the detailed steps. Each case has its
  own journey instance (REQ-JRN-007), and what a recipient sees of a journey follows disclosure (M4).
- **Status meaning is the owner's decision.** A change to status semantics needs the owner's approval
  (REQ-GOV-014). For example, PROC's BL-46 proposal waits for that approval (OI-020).
- **DOM mapping.** The epistemic classes map to the four DOM values as in plan §8.

## 9. Notification pipeline

The directive's nine stages (REQ-DISP-002) stay separate components:

| # | Stage | What it does | Component | Arrives |
| - | ----- | ------------ | --------- | ------- |
| 1 | Event detection | finds a recorded procedural event that a notification definition listens for | `procedural_event`; `lib/notifications` | M4 |
| 2 | Eligibility | catalogue rules decide whether a notice is due; consistency rules PC-00…PC-29 block invalid ones | `lib/notifications` | M4 |
| 3 | Recipient resolution | turns a recipient class into the case's people or an external class | `lib/notifications` | M4 |
| 4 | Disclosure projection | gives the recipient class only the permitted fields; everything else is prohibited by default | `lib/disclosure` | M4 |
| 5 | Rendering | renders from a template version with a content hash, as HTML and plain text | `lib/render`; `notification_template_version` | M4 |
| 6 | Authorisation | review and approval as `api_*` commands, checked against the authority rules | `api_*`; `lib/authority` | M5 |
| 7 | Dispatch | writes a content-free outbox row in the same transaction; the idempotency key is unique in the database | `dispatch_outbox` | M5 |
| 8 | Delivery tracking | writes one append-only row per attempt with the states Queued, Submitted, Provider accepted, Delivered (only where verifiable), Failed and Acknowledged; retries with backoff and ends in a dead letter | attempt and delivery-event records | M5 |
| 9 | Audit evidence | writes an audit event at every step | `audit_event` | M1 onwards |

What M1 delivers:
- each case's notification history;
- the Operations Center list across the cases the persona may see;
- the draft command `api_create_notification_draft`, which binds the authorised case id, the template version and
  the idempotency key.

Nothing is sent in M1. The sender is a labelled stub that sends nothing (ADR-010). In-app and corporate e-mail are
evaluated as channels in M5. SMS and WhatsApp are never added (REQ-DISP-011). A provider's acceptance or a read mark
is never reported as "read".

## 10. Open structure decisions (none blocks M1)

| Item | Default in force | Decided by | Needed by |
| ---- | ---------------- | ---------- | --------- |
| Where case records live (OI-003) | ADR-001: V13's own synthetic records behind `CaseSourceAdapter` | Owner (card open) | — (the default works through M8) |
| Level 1 status mapping (OI-004) | Level 1 fails closed | Owner (document) | M3 |
| BL-46 procedure status rows (OI-020) | the reference package's behaviour | Owner | M3 |
| Scheduler for reminders and dispatch (OI-015) | none runs; stub sender | Owner | M5 |
| Seven V13 package decisions, V13-16-01..05, 07, 08 (OI-012) | the affected rules stay PROPOSED and fail closed | Owner | M4 |
| Evidence file storage | none: ADR-012 rules out Supabase Storage in the shared project | ARCH proposal, then owner | M6 |
| Classification scheme, recusal rules, committee sources | none in M1 | SOURCE_REQUIRED | M6 |

## 11. Prototype and production

| Concern | This repository (synthetic staging) | Production substitution (PRODUCTION_SUBSTITUTION_REQUIRED) | ADR |
| ------- | ----------------------------------- | ---------------------------------------------------------- | --- |
| Web and BFF | Next.js 16 on Vercel `fra1`, behind Vercel Authentication | the CDF runtime on Alibaba Cloud Riyadh, behind the CDF identity provider | ADR-002, ADR-004 |
| Identity | synthetic personas, signed session cookie | CDF corporate IdP (OIDC with MFA); roles from the CDF directory | ADR-004, ADR-014 |
| Request context | HMAC-authenticated claims keyed from the session secret | the ASP.NET Core API sets the database context with a key held in KMS | ADR-014 |
| Database | schema `cdf_notifications_v13` in the shared Supabase project CDF GC Review (`eu-central-1`) | a dedicated RDS PostgreSQL database in CDF Alibaba Cloud Riyadh | ADR-012 |
| Case source | V13's own synthetic `case_record` | the authoritative CDF case system through `CaseSourceAdapter` | ADR-001 |
| Notification sending | stub sender with a content-free outbox | the approved CDF mail gateway and scheduler | ADR-010 |
| Audit | hash-chained ledger in the schema | the same, plus CDF SLS/SIEM export | ADR-011 |
| Secrets | Vercel sensitive variables, Preview on `develop` only | KMS | ADR-014 |

Production stays blocked by the hosting gate (ADR-005, QG-13), and every check in it is UNVERIFIED.

## 12. Scale assumptions, to be measured

These are assumptions to test, not claims.
- Lists use keyset pagination with page limits (`portfolio_page`, 1–100 rows), indexed predicates and counts taken
  after RLS. No list loads the whole portfolio into the browser (REQ-PERF-002, -003).
- The audit chain serialises writes on one advisory lock in the V13 namespace (ADR-011). Its throughput is measured
  in M7 at 100, 1,000, 10,000 and 100,000 synthetic cases (QG-10). Until then no scale is claimed (REQ-PERF-001).
- The shared project's limits apply: `cdf_v13_app` has 8 connections and a 10-second statement timeout (ADR-012).

## 13. Traceability

REQ-ARCH-026 (this deliverable) · REQ-ARCH-016, -017, -018 · REQ-SEC-009, -013, -016, -017, -019 · REQ-WS-001, -002 ·
REQ-CASE-008, -012, -013 · REQ-JRN-001, -002, -007 · REQ-DISP-002, -011 · REQ-AUD-001, -005, -006 · REQ-GOV-010,
-011, -014.
