# Threat model — CDF V13 Enterprise, milestone M1

**SYNTHETIC-DATA REFERENCE IMPLEMENTATION — not CDF production.** Task V13-SEC-001 (deliverable E05, part 1 of 2; the
authorisation matrix is `docs/security/AUTHORIZATION_MATRIX.md`). Owner team: SEC. Reviewer: DB.

Status: **IN_REVIEW** (design document; no test in it has run yet). Written 28 Oct 2026 against `develop` `b02e672`,
before V13-ARCH-001 and V13-DB-001..004 exist. Every table, function and route named here is the **planned** one from
`docs/AGENT_TASK_BOARD.md`; where the build differs, the build PR updates this file or SEC files a defect.

Method: STRIDE per trust boundary, then one line per threat with the planned control, where it is enforced, the test
that proves it and the residual risk. Test ids (`SEC-DB-nn`, `SEC-APP-nn`) are defined in the matrix §6.

## 1. Scope and assets

| Asset | Why it matters | Classification here |
| ----- | -------------- | ------------------- |
| A1 Case records and everything keyed by `case_id` (events, tasks, notifications, notification events) | the core confidentiality promise: one case never shows in another case's context or to a persona without access | synthetic, modelled as CONFIDENTIAL |
| A2 Restricted case `CDF-DEMO-2026-0009` | need-to-know: invisible (not "forbidden", invisible) to every persona without an explicit assignment | synthetic, modelled as RESTRICTED |
| A3 Closed case `CDF-DEMO-2026-0010` | readable by its assigned personas, no command may change it | synthetic |
| A4 Audit ledger `audit_event` | append-only, hash-chained evidence of every command (ADR-011) | integrity-critical |
| A5 Session cookie `__Host-v13_session` and `V13_SESSION_SECRET` | whoever forges it becomes any persona | secret |
| A6 Database URL of `cdf_v13_app` | direct path to the V13 schema, bypassing the application pre-check | secret |
| A7 **The other application's data** (CDF GC Review, 75 tables/views) | V13 shares its database (ADR-012); harming it is the worst outcome of this project | not V13's; V13 must never reach it |
| A8 Notification content and previews | may disclose case facts to a recipient class that may not see them | synthetic |
| A9 Migration history and V13 role definitions | a changed role or grant silently widens access | integrity-critical |

Out of scope for M1: real data (prohibited), real e-mail delivery (stub sender, ADR-010), external recipients
(no portal, ADR-002), production hosting (blocked, ADR-005).

## 2. Actors

| Actor | Capability assumed |
| ----- | ------------------ |
| Anonymous internet user | can reach `*.vercel.app` URLs; stopped by Vercel Authentication |
| Team member past Vercel Authentication | can pick **any** synthetic persona (ADR-004, by design) |
| Signed-in persona acting outside its rights | edits URLs, ids, form fields, cookies, replays requests, opens many tabs |
| Malicious content author | puts markup or script into a field that is later rendered (case title, task note, template text) |
| Attacker with SQL injection in the BFF | can run SQL as `cdf_v13_user` inside a request transaction (and `set_config`, `reset role`) |
| Holder of the `cdf_v13_app` password | can log in to the shared database directly |
| The other application and its roles (`anon`, `authenticated`, `service_role`, `authenticator`, `cdf_app`, …) | share the cluster; must reach nothing of V13, and V13 must reach nothing of theirs |
| Project administrator `postgres` | reads and changes everything (residual, OI-014) |
| Contributor or dependency in a public repository | can propose code, dependencies or workflow changes (S4, OI-006) |

## 3. Trust boundaries and data flow

```
Browser ──(B1: Vercel Authentication)──► Vercel edge ──(B2: proxy.ts session gate, headers)──► Next.js server
   │                                                                                             │
   │  only HTML/RSC payloads and Server Action calls cross B2; no database or token reaches the browser
   │                                                                                             ▼
   │                                          (B3: lib/authz pre-check, Zod validation, CaseSourceAdapter)
   │                                                                                             │
   │                                         postgres driver, TLS, pooler (transaction mode), login cdf_v13_app
   │                                                                                             ▼
   │                         (B4: one transaction: set_config('request.v13.claims') + SET LOCAL ROLE cdf_v13_user)
   │                                                                                             │
   │                                (B5: RLS on every V13 table; api_* SECURITY DEFINER commands as cdf_v13_owner)
   │                                                                                             │
   │                                (B6: schema boundary cdf_notifications_v13 ◄─╳─► GC Review schemas and roles)
```

| Boundary | Crosses it | Enforced by |
| -------- | ---------- | ----------- |
| B1 | every HTTP request | Vercel Authentication on every deployment (ARCH; configuration, not code) |
| B2 | requests to platform routes | `proxy.ts`: cookie verification, security headers, CSP (ARCH) |
| B3 | every read and command | `lib/authz` pre-check, Zod schema per command, server-derived `case_id` (FE) |
| B4 | every SQL statement | `lib/db` `withRequestContext` (ARCH/DB) |
| B5 | every row | RLS policies and command checks through one claims helper (DB) |
| B6 | catalog and data of the other application | roles, grants, schema ACL; `database/hosted/isolation_checks.sql` C00–C12 (ARCH) |

## 4. Threats

Severity is the impact if the control failed, on the CRITICAL / HIGH / MEDIUM / LOW scale of `docs/OPEN_ISSUES.md`.
"Planned" controls do not exist yet; the test column is what will prove them.

### 4.1 Spoofing

| Id | Threat | Sev. | Planned control and enforcement point | Tests | Residual |
| -- | ------ | ---- | ------------------------------------- | ----- | -------- |
| TM-S1 | Forged or tampered session cookie (changed persona id, workspace, expiry; `alg: none`; other algorithm; key from another environment) | CRITICAL | jose HS256 with an explicit algorithm allow-list, `V13_SESSION_SECRET` ≥ 32 bytes, `exp`/`iat` checked, cookie `__Host-` HttpOnly Secure SameSite=Lax (B2); the database re-checks that the persona exists and is active (B5) | SEC-APP-03, -04, -05 | none known |
| TM-S2 | Persona sign-in used when the flag is off or missing | HIGH | sign-in refuses unless `V13_PERSONA_SIGNIN=enabled` exactly (fail closed) | SEC-APP-06 | — |
| TM-S3 | Any team member can sign in as any persona | MEDIUM | accepted by ADR-004 for synthetic data only; outer gate B1 | — (documented) | ACCEPTED; `PRODUCTION_SUBSTITUTION_REQUIRED` CDF OIDC |
| TM-S4 | **Claims forgery inside the database** (OI-018): `request.v13.claims` is an ordinary custom setting; any SQL running as `cdf_v13_user` (for example through an injection in the BFF) can call `set_config('request.v13.claims', …)` and become any persona, or `reset role` | CRITICAL | (a) parameterised SQL only, no string-built SQL in `lib/**` (lint + test); (b) `cdf_v13_app` holds no privilege, so `reset role` gains nothing; (c) claims MAC bound to the transaction (ADR-014 §4, SEC-REC-01), built in DB-001 | SEC-DB-03, -04, -28, -29, SEC-APP-12 | HIGH until DB-001 is merged; then key plant before first install (ADR-014 residual, detected because every request then sees nothing) |
| TM-S5 | Claims missing, empty, malformed JSON, unknown persona, inactive persona, persona whose membership or assignment window has ended | HIGH | the claims helper returns NULL on anything invalid and every policy and command treats NULL as "nobody" (fail closed) | SEC-DB-01, -02, -05 | — |
| TM-S6 | Workspace claim names a workspace the persona is not a member of | HIGH | the database checks membership of persona × workspace × role in its active window; never trusts the workspace claim alone | SEC-DB-06 | — |
| TM-S7 | Login CSRF: a third-party page signs the victim in as another persona | LOW | sign-in is a POST Server Action; Origin must equal the host (Next.js Server Action check) | SEC-APP-09 | — |

### 4.2 Tampering

| Id | Threat | Sev. | Planned control and enforcement point | Tests | Residual |
| -- | ------ | ---- | ------------------------------------- | ----- | -------- |
| TM-T1 | Direct INSERT/UPDATE/DELETE/TRUNCATE on V13 tables as `cdf_v13_user` or `cdf_v13_app` | CRITICAL | no table write grants (B5); `rls-coverage`-style catalog test | SEC-DB-07 | — |
| TM-T2 | Command abuse: calling an `api_*` command for another case, a restricted case without assignment, a closed case, with a stale `row_version`, with a body `case_id` that differs from the task's or notification's own case | HIGH | command derives `case_id` from the target row, checks authority inside, optimistic concurrency, refuses on CLOSED | SEC-DB-08, -09, -10, -11 | — |
| TM-T3 | Audit tampering: UPDATE/DELETE/TRUNCATE on `audit_event`, breaking or re-ordering the hash chain, inserting a forged event | CRITICAL | no privilege + trigger rejecting UPDATE/DELETE/TRUNCATE for every role (ADR-011); chain verified by a read function | SEC-DB-12, -13 | the owner role and `postgres` can still disable triggers (OI-014); see SEC-REC-03 |
| TM-T4 | SQL injection through a `SECURITY DEFINER` command (dynamic SQL) runs as `cdf_v13_owner`, which owns every table and could disable the audit trigger | CRITICAL | `SET search_path = ''`, no `EXECUTE` of built strings in V13 functions (catalog lint), all identifiers schema-qualified | SEC-DB-14 | — |
| TM-T5 | `search_path` hijack: an object created in a schema earlier on the path shadows a built-in | HIGH | `search_path = ''` on every definer function and on the login; `cdf_v13_user` cannot CREATE anywhere (C09) | SEC-DB-14, isolation C09/C11 | — |
| TM-T6 | Mass assignment in a Server Action (extra fields such as `case_id`, `status`, `persona_id`) | HIGH | Zod schema per command with `.strict()`; server-derived ids | SEC-APP-11 | — |
| TM-T7 | Duplicate or replayed notification draft | MEDIUM | idempotency key unique in the database; key includes the case id | SEC-DB-15 | — |
| TM-T8 | A migration silently widens a grant or disables RLS | HIGH | `pnpm db:lint`, catalog coverage test over every V13 table and function, independent review | SEC-DB-07, -16 | — |
| TM-T9 | Workflow or dependency change in a public repository exfiltrates secrets or pushes code | HIGH | ARCH owns `.github/**`; no `pull_request_target` with checkout of PR code; secrets only in Vercel; lockfile with exact versions; Vercel fork-PR deployment approval stays on | SEC-APP-16 (review checklist) | branch protection missing (OI-016) |

### 4.3 Repudiation

| Id | Threat | Sev. | Planned control | Tests | Residual |
| -- | ------ | ---- | --------------- | ----- | -------- |
| TM-R1 | A state change with no audit event, or an audit event without the change (separate transactions) | HIGH | every command writes its event in its own transaction; a refused command leaves neither | SEC-DB-17 (coverage guard: every state-changing `api_*` function must be exercised by the walk) | — |
| TM-R2 | Audit event that names the wrong actor (the actor taken from a request field) | HIGH | actor always from the claims helper, never from arguments | SEC-DB-17 | — |

### 4.4 Information disclosure

| Id | Threat | Sev. | Planned control and enforcement point | Tests | Residual |
| -- | ------ | ---- | ------------------------------------- | ----- | -------- |
| TM-I1 | **Cross-case read**: URL id swap (`/cases/<other uuid>`), BFF response carrying another case's rows, two tabs mixing contexts | CRITICAL | `can_access_case(uuid)` in every case-keyed policy; URL is the only case context; same response for unknown and unauthorised | SEC-DB-18, SEC-APP-01, QA Sentinel | — |
| TM-I2 | Existence oracle: different status code, body, header, timing or error for "exists but forbidden" vs "unknown" | HIGH | one 404-equivalent path; no `42501` surfaced; same code path | SEC-APP-01, -02, SEC-DB-19 | timing differences are measured, not eliminated |
| TM-I3 | Display-number lookup (`CDF-DEMO-2026-0009`) as a key, or enumeration of sequential numbers | HIGH | display numbers never keys; any lookup by number goes through the same authorised read | SEC-APP-02, SEC-DB-19 | — |
| TM-I4 | Counts, facets, pagination totals, "my work" badges or search snippets that include unauthorised or restricted cases | HIGH | counts computed from RLS-filtered rows only | SEC-DB-20, SEC-APP-07 | — |
| TM-I5 | Restricted case visible to a persona without explicit assignment (including Governance oversight views) | CRITICAL | restriction checked in `can_access_case`, not in the UI | SEC-DB-21 | — |
| TM-I6 | Notification preview or e-mail rendering discloses fields not allowed for the recipient class, or another case's data | HIGH | disclosure projection server-side before rendering (PROC-003); renderer refuses unprojected models | SEC-DB-22, PROC tests | — |
| TM-I7 | Error leakage: stack traces, SQL text, constraint names, internal ids in responses or logs | MEDIUM | generic error with correlation id; logs hold no narrative or secret | SEC-APP-10 | — |
| TM-I8 | Secret in Git, in the client bundle or in a `NEXT_PUBLIC_*` variable | CRITICAL | `.env.example` names only; secret scanning; bundle scan in CI | SEC-APP-13 | — |
| TM-I9 | **V13 reaches the other application's data** (B6) | CRITICAL | no USAGE/privilege outside V13; isolation C04–C09 on every hosted change | SEC-DB-23 (local), isolation_checks.sql (hosted, ARCH) | catalog metadata visible to every role (plan §9) |
| TM-I10 | The other application's roles reach V13 | CRITICAL | schema ACL; no grant to PUBLIC or API roles; no Data API exposure | SEC-DB-24 (local), isolation C12 (hosted) | — |
| TM-I11 | Case data cached by the browser, CDN or a shared Next.js data cache across personas | HIGH | `Cache-Control: no-store` on platform responses; no `fetch` cache or `unstable_cache` keyed without the persona | SEC-APP-14 | — |
| TM-I12 | Case data in browser storage (the V12 pattern, S1) | MEDIUM | no `localStorage`/`sessionStorage`/IndexedDB writes of case data | SEC-APP-15 | — |
| TM-I13 | Clickjacking or script injection showing one case's data to a third party | MEDIUM | CSP with `frame-ancestors 'none'`, nonce-based scripts, no `dangerouslySetInnerHTML` on user content | SEC-APP-08 | — |

### 4.5 Denial of service

| Id | Threat | Sev. | Planned control | Tests | Residual |
| -- | ------ | ---- | --------------- | ----- | -------- |
| TM-D1 | A V13 query or open transaction exhausts the shared database | MEDIUM | connection limit 8, statement 10 s, idle-in-transaction 15 s, lock 3 s (ADR-012) | isolation C01 (hosted), SEC-DB-25 (local) | shared CPU and I/O (plan §9) |
| TM-D2 | Audit chain lock held, or taken by another application with the same advisory key | LOW | V13 namespace `hashtext('cdf_notifications_v13')`; lock timeout 3 s | SEC-DB-25 | any role can take any advisory key (plan §9) |
| TM-D3 | Unbounded list or search request | LOW | keyset pagination with a server maximum | SEC-APP-07 | — |

### 4.6 Elevation of privilege

| Id | Threat | Sev. | Planned control | Tests | Residual |
| -- | ------ | ---- | --------------- | ----- | -------- |
| TM-E1 | `cdf_v13_user` or `cdf_v13_app` gains another role (membership, `SET ROLE cdf_v13_owner`, `SET SESSION AUTHORIZATION`) | CRITICAL | memberships fixed by `0000_bootstrap`; isolation C02/C03 | SEC-DB-26 | — |
| TM-E2 | A V13 function is executable by PUBLIC or a non-V13 role | HIGH | default privileges revoke EXECUTE from PUBLIC (0000); C11 | SEC-DB-16 | — |
| TM-E3 | Workspace switching widens access (a persona switches to a workspace where it has no membership, or keeps the old workspace's cases after switching) | HIGH | the database computes access from the active workspace claim and membership on every request | SEC-DB-06, SEC-APP-05 | — |
| TM-E4 | A UI-only permission (button hidden, command still accepted) | HIGH | every command checked in `lib/authz` **and** in the database; tests call the command directly | SEC-DB-08..11, SEC-APP-11 | — |

## 5. Recommendations (all four ACCEPTED by the Chief Architect, 28 Oct 2026, ADR-014)

| Id | Recommendation | Why | Status |
| -- | -------------- | --- | ---------------- |
| SEC-REC-01 | Bind the claims to the transaction with an HMAC: the server adds `sig = HMAC(secret, claims ‖ txid)`; the claims helper (`SECURITY DEFINER`, owned by `cdf_v13_owner`) verifies it with a key held in a V13 table only the owner can read, and returns NULL on mismatch | closes TM-S4: an injection as `cdf_v13_user` could no longer forge a persona, because it cannot read the key | ACCEPTED (ADR-014 §4): HMAC-SHA256 over claims ‖ `|` ‖ a transaction-unique value; key = HKDF of `V13_SESSION_SECRET`; owner-only key table; install-once audited command. Built by DB in DB-001, reviewed by SEC |
| SEC-REC-02 | Fail closed when the role is not `cdf_v13_user`: every policy and command also requires `current_user = 'cdf_v13_user'` (or the owner inside a definer function) | a query that escaped `withRequestContext` runs as `cdf_v13_app`, which already holds nothing; this makes the rule explicit and testable | ACCEPTED (ADR-014 §5), DB-001 |
| SEC-REC-03 | Audit chain verification as a scheduled read plus a hosted check after every migration, and an event-trigger-free alert when the audit trigger is disabled (`pg_trigger.tgenabled`) | an owner-level change could disable the trigger; detection is the only control left inside a shared database | ACCEPTED (ADR-014 §6), DB-001 / ARCH-005 |
| SEC-REC-04 | Vercel "Git fork protection" stays enabled and preview deployments of forked PRs never receive environment variables | the repository is public (OI-006) | ACCEPTED (ADR-014 §7); ARCH verifies in ARCH-003; database URL and session secret scoped to the `develop` preview only |

## 6. Assumptions to confirm (DB, FE, ARCH)

1. **Settled by ADR-014 §3:** claims are exactly `{"v":1,"persona_id","workspace_id","correlation_id"}`, with the MAC
   in `request.v13.claims_mac`. No role is sent; the database derives roles from active memberships.
2. Access to a case = active persona **and** active membership in the claimed workspace **and** the case visible in
   that workspace **and** (if the case is restricted) an active assignment of the persona on the case. Exact rule and
   the per-persona visibility table come from DB-002 and DB-005; the matrix tests read that table instead of
   hard-coding it.
3. Closed cases are readable by those with access and refuse every command.
4. Governance Officer oversight in M1 is read-only over its workspace's cases and never includes the restricted case
   without assignment; it changes a task only when assigned (DB note, 28 Oct).
5. A duplicate idempotency key is refused, even for an identical replay (DB note, 28 Oct).
6. `verify_audit_chain()` is callable by the owner/administrator only, not by `cdf_v13_user` (DB note, 28 Oct).

Assumptions 2–4 are confirmed or corrected by DB in its DB-001/002 PR; DB's `docs/architecture/DATA_MODEL.md` §5 holds
the visibility matrix the tests read.

## 7. Review points SEC will check on the ADR-014 build (DB-001)

1. The helpers return only ids or a boolean: no function returns, logs or raises the computed MAC or any part of the
   key (otherwise an injection could use it as a signing oracle).
2. The transaction-unique value is read inside the same transaction the claims are used in; a MAC copied from
   another transaction (for example seen in `pg_stat_activity` query text) resolves to NULL.
3. Missing MAC, empty MAC, wrong length, wrong encoding, MAC for other claims, MAC with `v` other than 1 → NULL.
4. The key table has RLS on, no policy that admits `cdf_v13_user`, no grant; the install command refuses a second,
   different key and writes an audit event without key material.
5. No `pgcrypto` or other extension (ADR-012); HMAC built from the core `sha256()` function.

A different rule in the build is not a defect by itself; an undocumented one is.
