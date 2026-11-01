# Authorisation matrix — CDF V13 Enterprise, milestone M1

**SYNTHETIC-DATA REFERENCE IMPLEMENTATION — not CDF production.** Task V13-SEC-001 (deliverable E05, part 2 of 2;
threats are in `docs/security/THREAT_MODEL.md`). Owner team: SEC. Reviewer: DB.

Status: **IN_REVIEW**. Written against the **planned** M1 objects of `docs/AGENT_TASK_BOARD.md` (DB-001..004, FE-001..006).
Acceptance of V13-SEC-001 is "every matrix cell has a planned test": §6 lists every test, and each cell names one.
Nothing here has been executed yet; results go to `docs/TEST_EVIDENCE.md` (UXQA-17) when SEC-002 and SEC-003 run.

## 1. Subjects (who asks)

| Code | Subject | How it reaches the database |
| ---- | ------- | --------------------------- |
| **AS** | Persona with an active **assignment** on the case, an active membership in the claimed workspace, case visible in that workspace | `cdf_v13_user` + valid claims |
| **WS** | Persona with an active membership in the claimed workspace, case visible there, **no assignment** | `cdf_v13_user` + valid claims |
| **OW** | Persona whose claimed workspace does **not** show the case (case of **another workspace**) | `cdf_v13_user` + valid claims |
| **XM** | Claims name a workspace the persona is **not a member of** (forged workspace) | `cdf_v13_user` + forged claims |
| **EX** | Persona, membership or assignment **outside its active window** or persona inactive | `cdf_v13_user` + valid-looking claims |
| **NC** | **No claims**, empty, malformed or unknown persona id, **missing or wrong claims MAC** (ADR-014) | `cdf_v13_user` without valid claims |
| **AP** | `cdf_v13_app` with no `SET ROLE` (query escaped the request context) | login role only |
| **FR** | Foreign roles: `anon`, `authenticated`, `service_role`, `authenticator`, `cdf_app`, PUBLIC | other application's roles |

Persona roles in M1 (DB-001): **SEC-R** Committee Secretary (workspace Secretariat), **INV-R** Investigator
(Investigations), **GOV-R** Governance Officer (Governance). Role-specific rights refine the AS/WS columns below; they
never widen a cell that says "none".

Case variants: **N** normal (0001–0008), **R** restricted (0009), **C** closed (0010), **U** unknown UUID.

## 2. Legend

`R` read the row · `—` nothing (row invisible; command refused with the same answer as for an unknown id) ·
`R*` read only the fields the role may see · `X` command allowed · `X?` allowed only if the persona's role holds the
right and the case is not closed. Enforcement: **A** application pre-check (`lib/authz`), **P** RLS policy,
**F** check inside the `api_*` command, **G** grants / schema ACL, **T** trigger.

## 3. Reads

| Object (migration) | AS (N) | AS (R) | AS (C) | WS (N) | WS (R) | OW | XM | EX | NC | AP | FR | Enforced | Tests |
| ------------------ | ------ | ------ | ------ | ------ | ------ | -- | -- | -- | -- | -- | -- | -------- | ----- |
| `workspace` (0001) | own memberships | = | = | own | own | own | — | — | — | — | — | P, G | SEC-DB-05, -06, -26 |
| `role` (0001) | R | R | R | R | R | R | — | — | — | — | — | P, G | SEC-DB-05 |
| `persona` (0001) | self + active personas with an active membership in the current workspace (`_is_colleague`); e-mail only for oneself, through `current_persona()` | = | = | = | = | = | — | — | — | — | — | P, G | SEC-DB-05, -27 |
| `persona_workspace_membership` (0001) | own rows | = | = | own | own | own | — | — | — | — | — | P, G | SEC-DB-06 |
| `audit_event` (0001) | none in M1 (read through a verifier function only) | — | — | — | — | — | — | — | — | — | — | P, G | SEC-DB-12, -13 |
| `schema_migrations` (0000) | — | — | — | — | — | — | — | — | — | — | — | P (restrictive deny), G | SEC-DB-07 |
| `case_record` (0002) | R | R | R | R | **—** | — | — | — | — | — | — | A, P | SEC-DB-18, -19, -21, SEC-APP-01, -02 |
| `case_assignment` (0002) | case's assignments | = | = | case's assignments | — | — | — | — | — | — | — | A, P | SEC-DB-18, -21 |
| `procedural_event` (0003) | R | R | R | R | — | — | — | — | — | — | — | A, P | SEC-DB-18, -21 |
| `task` (0003) | R | R | R | R | — | — | — | — | — | — | — | A, P | SEC-DB-18, -20, -21 |
| `notification_template`, `_version` (0004) | R | R | R | R | R | R | — | — | — | — | — | P, G | SEC-DB-22 |
| `notification` (0004) | R ¹ | R ¹ | R ¹ | R ¹ | — | — | — | — | — | — | — | A, P | SEC-DB-18, -21, -22 |
| `notification_event` (0004) | R | R | R | R | — | — | — | — | — | — | — | A, P | SEC-DB-18, -21 |
| `case_workspace_visibility` (0002) | R with the case | = | = | = | — | — | — | — | — | — | — | P | SEC-DB-18, -21 |
| `notification_recipient_class` (0004) | R (signed in) | = | = | = | = | = | — | — | — | — | — | P, G | SEC-DB-05 |
| `claims_key` (0001) | — (owner only) | — | — | — | — | — | — | — | — | — | — | P (restrictive deny), G | P06 |
| `dispatch_outbox` (0004, content-free) | — | — | — | — | — | — | — | — | — | — | — | P, G | SEC-DB-07, -22 |
| Portfolio read function (counts, filters, pages) | in list + counted | in list + counted | in list + counted | in list + counted | **absent and not counted** | absent | — | — | — | — | — | A, P | SEC-DB-20, SEC-APP-07 |
| Case header read function | R | R | R | R | — (same as U) | — (same as U) | — | — | — | — | — | A, P | SEC-DB-19, SEC-APP-01 |
| `case_tasks`, `case_events` (0006), `case_notifications` (0004) | R | R | R | R | — | — | — | — | — | — | — | A, P | SEC-DB-18, -21 |
| `notifications_page`, `notifications_count` (0010, SECURITY INVOKER) | rows of accessible cases only, removed by RLS before filters, order, keyset limit and count; `case_number` filter is applied after authorisation | = | = | = (the database answers; the Center route itself is refused to investigators by ruling D6, see §5) | **absent and not counted** | absent | — | — | — | — | — | A, P | context-forgery registry (null claims, 0001, 0009 → no rows; count 0), FE integration `notification-center` (0009 for Gamma, hidden and unknown numbers → total 0), SEC e2e `notification-center` (SEC-APP-02, -07, -10), SEC-APP-17 |
| `my_work_tasks` (0003, columns 0008) | own work on accessible cases | = | = | = | — | — | — | — | — | — | — | A, P | SEC-DB-20 |
| `claims_key_state` (0007) | request role only, health use; key state, no key material | = | = | = | = | = | — | — | — | — | — | G | P03 |
| Foreign (GC Review) relations and functions | — | — | — | — | — | — | — | — | — | — | n/a | G | SEC-DB-23, isolation C04–C09 |

`=` same as the AS (N) cell. "WS (R) = —" is the need-to-know rule (THREAT_MODEL §6 assumption 2).

¹ The database does no column projection: access to `notification` is row-level only, through RLS on the case
(ADR-015 rules out column grants). Projection per recipient class is PROC's server-side disclosure step (TM-I6,
`lib/disclosure`, `projectForRecipient`).

## 4. Commands

| Command (migration) | AS (N) | AS (R) | AS (C) | WS (N) | WS (R) | OW | XM | EX | NC | AP | FR | Enforced | Tests |
| ------------------- | ------ | ------ | ------ | ------ | ------ | -- | -- | -- | -- | -- | -- | -------- | ----- |
| Direct INSERT/UPDATE/DELETE/TRUNCATE on any V13 table | — | — | — | — | — | — | — | — | — | — | — | G | SEC-DB-07 |
| UPDATE/DELETE/TRUNCATE `audit_event` (any role incl. owner via commands) | — | — | — | — | — | — | — | — | — | — | — | G, T | SEC-DB-12 |
| `api_update_task_status` (0003) | X? (own task or role right; current `row_version`) | X? | **—** (closed) | X? only own task | — | — | — | — | — | — | — | A, F | SEC-DB-08, -09, -10, -11, -17 |
| `api_create_notification_draft` (0004) | X? (Committee Secretary or Investigator role on an ACTIVE accessible case; `case_id` server-derived; recipient class allowed) | X? | **—** | X? same rule (a Governance Officer never drafts) | — | — | — | — | — | — | — | A, F | SEC-DB-08, -10, -15, -22, -17 |
| `api_switch_workspace` (0005) | to own member workspaces; V1404 otherwise; audit `WORKSPACE_SWITCHED` | = | = | = | = | = | — | — | — | — | — | A, F | SEC-DB-06, SEC-APP-05 |
| `api_install_claims_key` (0001, deploy only) | first writer wins; another key refused V1409; audit `CLAIMS_KEY_INSTALLED` without key material | — | — | — | — | — | — | — | — | — | — | F, G | SEC-DB-29, P06 |
| Persona sign-in (`V13_PERSONA_SIGNIN=enabled`) | active personas only | | | | | | | refused | refused | | | A (+ DB re-check) | SEC-APP-03..06, -09 |
| Any future `api_*` command | must appear in the coverage guard before merge | | | | | | | | | | | F | SEC-DB-17 |

Every "—" in a command row means: no state change, no business audit event, and an answer indistinguishable from the
answer for an unknown id (SEC-DB-19).

## 5. Application surface (BFF and routes)

| Surface | Rule | Enforced | Tests |
| ------- | ---- | -------- | ----- |
| `/cases/[caseId]` and its tabs | 404-equivalent for U, OW, WS(R), malformed UUID — identical status, body shape, headers | A, P | SEC-APP-01 |
| Any route or search accepting `CDF-DEMO-2026-NNNN` | resolves only through the authorised read; same answer as U when not authorised | A, P | SEC-APP-02 |
| Session cookie | tampered, re-signed with another key, `alg: none`, expired, future `iat`, missing → signed-out answer, no data | A (proxy.ts) | SEC-APP-03, -04 |
| Persona in cookie later deactivated | next request gets no data | P | SEC-APP-05 |
| Sign-in flag off / absent / any value other than `enabled` | sign-in refused | A | SEC-APP-06 |
| Portfolio, My Work, Notification Center | lists and counts only authorised rows; page size capped | A, P | SEC-APP-07 |
| Notification Operations Center (`/notifications`) for **INV-R** (ruling D6, below) | not offered: absent from navigation; the route gives the same 404-equivalent as an unknown route; investigators use the case Notifications tab of cases they can access | A (+ P on every row in any case) | SEC-APP-17 |
| Server Actions by action id (SEC-APP-18, TM-E5) | Every exported Server Action, called by action id without a session, with an expired or foreign-secret cookie, and with another persona's session, changes nothing and returns the generic answer; also called through the public `/sign-in` path | A, F | SEC-APP-18 |
| Undecodable paths (`/cases/%C0%AF`, OI-040) | with a session: the generic not-found page, status 404, same visible text as an unknown page, headers set once; without a session: the usual redirect to /sign-in | A (proxy.ts) | SEC-APP-01, SEC-APP-08 |
| Security headers | CSP (`frame-ancestors 'none'`, no `unsafe-eval`), `X-Content-Type-Options`, `Referrer-Policy`, HSTS, no `X-Powered-By` | A (proxy.ts) | SEC-APP-08 |
| Server Actions | cross-origin `Origin` refused; GET cannot change state | A (Next.js) | SEC-APP-09 |
| Errors | generic message + correlation id; no stack, SQL text, constraint or role name | A | SEC-APP-10 |
| Command inputs | Zod `.strict()`; extra `case_id`/`persona_id`/`status` fields refused | A, F | SEC-APP-11 |
| SQL construction | no string-built SQL in `lib/**` (`sql.unsafe`, template concatenation) | lint/test | SEC-APP-12 |
| Secrets | none in Git, client bundle or `NEXT_PUBLIC_*` | CI | SEC-APP-13 |
| Caching | `Cache-Control: no-store` on authenticated pages and BFF responses | A | SEC-APP-14 |
| Browser storage | no case data in `localStorage`/`sessionStorage`/IndexedDB | A | SEC-APP-15 |
| CI and repository | no `pull_request_target` with PR checkout; secrets not exposed to fork PRs | review | SEC-APP-16 |

## 6. Test catalogue

Planned files: `tests/security/db/*.spec.ts` (Vitest against `pnpm db:local`, V13-SEC-002) and
`tests/security/app/*.spec.ts` (Vitest for handlers and Playwright request API for routes, V13-SEC-003). Each test
loops over every subject and case variant in its cell, and reads the expected visibility from the seed's documented
visibility table (DB-005) instead of hard-coding it. A negative test asserts **both** the refusal and that nothing
changed (row counts, `row_version`, audit tail).

### 6.1 Database (V13-SEC-002)

| Id | What it proves | Threats |
| -- | -------------- | ------- |
| SEC-DB-01 | No claims / empty / malformed JSON / missing keys → zero rows on every V13 table and view, every command refused | TM-S5 |
| SEC-DB-02 | Unknown persona UUID, inactive persona → same as SEC-DB-01 | TM-S5 |
| SEC-DB-03 | `set_config('request.v13.claims', …)` rewritten inside the transaction as `cdf_v13_user` (other persona, other workspace, `v` changed) without a matching MAC → every helper NULL, zero rows, commands refused (ADR-014 §4) | TM-S4 |
| SEC-DB-04 | `reset role` / `set role none` / `set role cdf_v13_owner` / `set session authorization` inside the request → no V13 data, owner refused | TM-S4, TM-E1 |
| SEC-DB-05 | Reference reads (`workspace`, `role`, `persona`) show only what the matrix allows | TM-I1 |
| SEC-DB-06 | Forged workspace claim (XM) and switching to a non-member workspace → nothing; switching never keeps the previous workspace's cases | TM-S6, TM-E3 |
| SEC-DB-07 | Catalog walk: every V13 table has RLS enabled and forced where needed, no INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER grant to `cdf_v13_user`, `cdf_v13_app`, PUBLIC; live write attempts fail with 42501; `schema_migrations` unreadable | TM-T1, TM-T8 |
| SEC-DB-08 | Commands for another case's object (task/notification id of case B under case A's context, or for an OW case) refused, nothing changed | TM-T2, TM-E4 |
| SEC-DB-09 | Stale `row_version` refused; concurrent updates do not both succeed | TM-T2 |
| SEC-DB-10 | Commands on the closed case refused | TM-T2 |
| SEC-DB-11 | Commands on the restricted case by WS refused with the unknown-id answer | TM-T2, TM-I5 |
| SEC-DB-12 | UPDATE/DELETE/TRUNCATE on `audit_event` refused for `cdf_v13_user`, `cdf_v13_app` and through every command | TM-T3 |
| SEC-DB-13 | Chain verifier detects a planted break (done as the administrator in a rolled-back transaction) | TM-T3 |
| SEC-DB-14 | Catalog lint: every `SECURITY DEFINER` V13 function has `search_path=''`, no `EXECUTE` of a built string, owner `cdf_v13_owner`; injection strings in every text argument are stored as data | TM-T4, TM-T5 |
| SEC-DB-15 | Duplicate idempotency key refused; keys are unique per author, and the same author's key under another case is refused with V1409, never merged | TM-T7 |
| SEC-DB-16 | No V13 function executable by PUBLIC or a non-V13 role | TM-E2, TM-T8 |
| SEC-DB-17 | Coverage guard: every state-changing `api_*` function is exercised; success writes exactly one audit event with the claims' actor; refusal writes none | TM-R1, TM-R2 |
| SEC-DB-18 | Cross-case read: for every case-keyed table, AS of case A sees no row of case B | TM-I1 |
| SEC-DB-19 | Unknown UUID, unauthorised UUID and display-number lookups give identical results (rows, error code, message) | TM-I2, TM-I3 |
| SEC-DB-20 | Portfolio and My Work counts equal the number of visible rows; restricted and other-workspace cases never counted | TM-I4 |
| SEC-DB-21 | Restricted case 0009 invisible on every table and read function to every non-assigned persona, Governance included | TM-I5 |
| SEC-DB-22 | Notification rows readable only with the case; outbox holds no content and is unreadable (field projection is PROC's, not the database's) | TM-I6 |
| SEC-DB-23 | Local Supabase-like cluster with a planted foreign schema: V13 roles cannot read, call or create anything there (mirrors hosted C04–C09) | TM-I9 |
| SEC-DB-24 | Planted `anon`/`authenticated`/`service_role` roles cannot reach any V13 object | TM-I10 |
| SEC-DB-25 | Login settings hold (statement, idle, lock timeouts; connection limit); a held chain lock times out instead of hanging | TM-D1, TM-D2 |
| SEC-DB-26 | Memberships of the V13 roles are exactly those of `0000_bootstrap` | TM-E1 |
| SEC-DB-27 | Persona reads show only oneself and workspace colleagues (`_is_colleague`); never another persona's e-mail | TM-I1 |
| SEC-DB-28 | Claims MAC: missing, empty, malformed, copied from another transaction, computed for other claims → NULL; the key table is unreadable by `cdf_v13_user`/`cdf_v13_app`; the install command refuses a second different key, is idempotent for the same key, and audits without key material | TM-S4 |
| SEC-DB-29 | No V13 function returns, raises or logs a MAC or key material; `_claims_hmac` and `_verified_claims` are not executable by `cdf_v13_user` or `cdf_v13_app` (otherwise a signing oracle) | TM-S4 |
| SEC-DB-30 | Catalog test: every V13 view has `security_invoker = true`; every read function is `SECURITY INVOKER`; `SECURITY DEFINER` only in the four groups of E02 §5.1 — `api_*` commands (each case-keyed one calls `can_access_case()`), claims and access-rule helpers (`_claims_hmac`, `_verified_claims`, `_claim_uuid`, `current_*`, `has_role`, `_is_colleague`, `is_assigned_to_case`, `can_access_case`, trigger `_case_owning_visibility`), `current_persona()`, audit internals (`_append_audit`, `verify_audit_chain`, not granted to `cdf_v13_user`) | TM-T10 |

### 6.2 Application (V13-SEC-003)

| Id | What it proves | Threats |
| -- | -------------- | ------- |
| SEC-APP-01 | URL id swap and malformed ids on every case route: identical 404-equivalent for U, OW, WS(R) | TM-I1, TM-I2 |
| SEC-APP-02 | Display-number lookups and search by number: no existence leak | TM-I3 |
| SEC-APP-03 | Tampered payload, other key, `alg: none`, `HS512`, truncated signature → signed out, no data | TM-S1 |
| SEC-APP-04 | Expired cookie, future `iat`, missing `exp` → signed out | TM-S1 |
| SEC-APP-05 | Persona or membership deactivated after sign-in → next request has no data; workspace switch re-checked | TM-S1, TM-E3 |
| SEC-APP-06 | `V13_PERSONA_SIGNIN` unset, `disabled`, `Enabled`, `true` → sign-in refused | TM-S2 |
| SEC-APP-07 | Lists and counts on Portfolio, My Work, Notification Center match the DB visibility table; page size capped | TM-I4, TM-D3 |
| SEC-APP-08 | Security headers and CSP present on every route, including error pages | TM-I13 |
| SEC-APP-09 | Server Action with a foreign `Origin`, and state change by GET, refused (incl. sign-in) | TM-S7 |
| SEC-APP-10 | Forced errors (bad input, DB refusal, timeout) show a generic message with correlation id; no stack, SQL, constraint or role name in body, headers or RSC payload | TM-I7 |
| SEC-APP-11 | Extra and mismatched fields in every command input refused (mass assignment) | TM-T6, TM-E4 |
| SEC-APP-12 | Static check: no `sql.unsafe` or string-built SQL in `lib/**` and `app/**` | TM-S4, TM-T4 |
| SEC-APP-13 | Built client bundle and `NEXT_PUBLIC_*` contain no secret or database URL | TM-I8 |
| SEC-APP-14 | `Cache-Control: no-store` on authenticated responses | TM-I11 |
| SEC-APP-15 | After a full Playwright walk, browser storage holds no case data | TM-I12 |
| SEC-APP-16 | Workflow review checklist for every `.github/**` change (SEC reviews ARCH) | TM-T9 |
| SEC-APP-17 | Signed in as an Investigator, `/notifications` and its BFF list are absent and answer like an unknown route (D6) | TM-I4 |

## 7. Rulings

- **D6 (UX open item, ruled by SEC 28 Oct 2026):** Investigators do **not** get the Notification Operations Center in
  M1; they see notifications only in the Notifications tab of a case they can access. Reason: need-to-know and least
  privilege; a cross-case list adds no investigator task in M1 and widens what one screen shows. This is defence in
  depth, not the only control: RLS still limits every notification row to authorised cases. Committee Secretary and
  Governance Officer keep the Center over their authorised cases. Revisit only with a stated investigator task.

## 8. Ownership of the tests

SEC writes and runs all `SEC-DB-*` and `SEC-APP-*` tests in `tests/security/**`. QA's Case Context Sentinel covers the
UI half of TM-I1; its DB half reuses SEC-DB-18. Hosted isolation (C00–C12) stays with ARCH. PROC owns disclosure unit
tests; SEC-DB-22 checks the database side only.
