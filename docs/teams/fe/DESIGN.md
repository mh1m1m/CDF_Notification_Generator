# FE design and plan — V13-FE-001..006

**SYNTHETIC-DATA REFERENCE IMPLEMENTATION — not CDF production.** Team FE (frontend and BFF). This file is FE's plan;
it binds nothing outside FE's paths (`docs/AGENT_TASK_BOARD.md` §1). Anything it assumes about shared contracts is
listed in §8 as a request to ARCH. Written 28 Oct 2026 before V13-ARCH-001 lands, so no code exists yet.

## 1. Principles (from CLAUDE.md, ADR-001, ADR-003, ADR-004)

1. **The URL is the only case context.** `/cases/[caseId]` with a UUID. No case id in cookies, `localStorage`,
   `sessionStorage`, React context that outlives a route, or a global store. Two tabs on two cases are two independent
   server renders (Scenario B).
2. **Workspace lives in the signed session**, never in the URL alone and never trusted from the client: switching is a
   Server Action that re-checks membership in the database before re-issuing the cookie (Scenario C).
3. **Authorisation twice.** `lib/authz` pre-checks with the claims and the persona's memberships; the database decides
   again (RLS + `can_access_case`). A pre-check pass never replaces the database answer; a pre-check refusal never
   reaches the database.
4. **Unknown = unauthorised.** Every case lookup that fails for any reason (bad UUID, unknown, not assigned, other
   workspace, restricted) becomes the same `notFound()` (404 page, same body, same headers). Display numbers
   (`CDF-DEMO-2026-NNNN`) are shown, never accepted as keys.
5. **Case data only through `CaseSourceAdapter`.** Pages call `lib/server/*` services; services call the adapter and
   the DB read functions inside `withRequestContext`. Pages never import `lib/db`.
6. **Generic errors.** Every thrown error is mapped to `{ code, correlationId }`; the user sees the localised generic
   message and the correlation id. Logs carry the correlation id and an error class, never SQL text, claims, case
   narrative or recipient addresses.
7. **Arabic RTL first.** Every string from `lib/i18n` FE namespaces; logical CSS properties only; numbers and dates
   formatted with `ar-SA-u-nu-latn` / `en-GB` (to confirm with UX).

## 2. Module layout (FE-owned paths only)

```
lib/authz/
  index.ts            precheck(claims, action, target) -> Allow | Deny  (pure, no I/O)
  actions.ts          action catalogue: case.read, case.tasks.read, task.update_status,
                      notification.read, notification.draft.create, workspace.switch, portfolio.read
  matrix.ts           role x workspace x action table (mirrors SEC's AUTHORIZATION_MATRIX once E05 exists)
lib/adapters/case-source/
  postgres.ts         CaseSourceAdapter over cdf_notifications_v13 read functions (DB-002)
  fake.ts             in-memory adapter over the 10 synthetic cases, used by unit tests until DB-002 lands
lib/server/
  context.ts          getRequestContext(): verified session -> claims -> withRequestContext wrapper; correlation id
  errors.ts           AppError codes (NOT_FOUND, CONFLICT_STALE, VALIDATION, UNAVAILABLE), toUserError()
  portfolio.ts        listPortfolio(filters, cursor) -> page of CaseSummary (counts after authorisation)
  case.ts             getCaseHeader(caseId), getCaseOverview(caseId), listCaseEvents(caseId)
  tasks.ts            listMyTasks(cursor), listCaseTasks(caseId), updateTaskStatus(cmd)
  notifications.ts    listNotifications(filters), listCaseNotifications(caseId), createDraft(cmd), getPreview(id)
  workspaces.ts       listMyWorkspaces(), switchWorkspace(workspaceId)
app/(auth)/sign-in/   persona picker (only when V13_PERSONA_SIGNIN=enabled; otherwise the refused page)
app/(platform)/
  layout.tsx          shell from components/ (UX-002): SideNav, TopBar, WorkspaceSwitcher, synthetic banner
  portfolio/page.tsx
  cases/[caseId]/layout.tsx           CaseHeader; validates UUID and access once, notFound() otherwise
  cases/[caseId]/page.tsx             overview
  cases/[caseId]/events/page.tsx
  cases/[caseId]/tasks/page.tsx
  cases/[caseId]/notifications/page.tsx  + draft form
  my-work/page.tsx
  notifications/page.tsx              Notification Operations Center
  not-found.tsx, error.tsx            generic, with correlation id
app/api/                              only if QA's Sentinel needs JSON views of BFF answers (FE-004); no
                                      browser-to-DB path, no case list API without the same authorisation
```

## 3. Request flow

```
page/server action
  -> lib/server/context.getRequestContext()      verify __Host-v13_session (lib/auth), new correlation id
  -> lib/authz.precheck(claims, action, target)  Deny -> NOT_FOUND (case targets) or FORBIDDEN-as-NOT_FOUND
  -> withRequestContext(claims, tx => ...)       SET LOCAL ROLE cdf_v13_user + request.v13.claims (lib/db, ARCH)
       -> CaseSourceAdapter / DB read functions / api_* commands
  -> map rows to view models (no raw rows to components)
```

Server Actions: `'use server'`, parse input with the command's Zod schema from `lib/contracts`, derive `case_id` from
the route param re-validated on the server (never from a hidden form field alone), pass `row_version` for optimistic
concurrency, return `{ ok } | { error: { code, correlationId } }`. Next.js origin checks stay on (SEC-003).

## 4. Tasks

| Task | Deliverable | Tests (positive and negative) |
| ---- | ----------- | ----------------------------- |
| FE-001 | `lib/authz`, `lib/server/{context,errors}`, `lib/adapters/case-source/{fake,postgres}`, read services | unit: precheck matrix incl. every deny path; adapter contract test run against fake (now) and postgres (integration, after DB-002); unknown UUID, malformed id, display number as id, other workspace, restricted 0009 for non-assigned persona, closed 0010 read-only — all give one identical NOT_FOUND; error mapper never leaks message text |
| FE-002 | `(platform)/layout.tsx`, workspace switch Server Action | switch to own workspace OK; switch to a workspace without membership refused and session unchanged; expired membership refused; navigation items per role |
| FE-003 | `/portfolio` | keyset pagination stable; filters kept in the URL query (not storage); restricted case absent and not counted for non-assigned personas; total count equals visible rows' authorised count |
| FE-004 | `/cases/[caseId]/**` | header/overview/events/tasks/notifications all keyed by the route id; two-tab independence; id swap to unauthorised case = same 404 as unknown; no case id in any storage (QA asserts) |
| FE-005 | `/my-work` + status update | own tasks only, across authorised cases; stale `row_version` -> generic error with correlation id; update in case A leaves case B unchanged |
| FE-006 | `/notifications` + case tab + draft generation | draft created under the route case only; tampered case id in form refused; duplicate idempotency key refused generically; preview rendered server-side through PROC's disclosure projection; no notification of case A listed under case B |

Each task is its own PR into `develop` (`feature/V13-FE-00N-…`), reviewed by QA (UI) and SEC (`lib/server`,
`lib/adapters`, `lib/authz`).

## 5. Order and dependencies

1. After ARCH-001: FE-001 with the fake adapter (unit only). Integration half follows DB-002.
2. FE-002 after UX-002 shell components and DB-001 memberships; a minimal unstyled shell may land first if UX-002 is
   late, replaced by UX's components (no FE-owned styling).
3. FE-003 after FE-001 + UX-003 DataTable; FE-004 after PROC-001 status types.
4. FE-005 after DB-003; FE-006 after DB-004 + PROC-005.

## 6. Scenarios A–E — where FE makes each hold

- **A** case switching: every case page is a server render of the route id; back/forward restores from the URL.
- **B** two tabs: no shared client state; after a mutation `revalidatePath('/cases/<id>')` for that id only.
- **C** workspace switch: Server Action -> DB membership check -> new cookie -> redirect to `/portfolio`; the portfolio
  re-queries under the new claims.
- **D** search/filters (M1 basics): filters in the query string, authorisation in SQL before counts.
- **E** notifications: `case_id` comes from the route and is re-checked by `api_create_notification_draft`.

## 7. What replaces the prototype

Persona sign-in -> CDF corporate IdP (OIDC) through `IdentityProvider`; postgres `CaseSourceAdapter` -> authoritative
CDF case system adapter. Both marked `PRODUCTION_SUBSTITUTION_REQUIRED` in code.

## 8. Requests to ARCH (shared paths FE cannot edit)

1. `lib/contracts`: the `CaseSourceAdapter` interface, `CaseSummary`/`CaseHeader` types, `Claims` type, and Zod schemas
   for `UpdateTaskStatus`, `CreateNotificationDraft`, `SwitchWorkspace` (or confirm FE proposes them in a PR to ARCH).
2. `lib/db`: signature of `withRequestContext(claims, fn)` and whether it accepts a correlation id for logging.
3. `lib/auth`: a `getSession()` / `issueSession()` pair FE can call from Server Actions (workspace switch re-issues).
4. `lib/i18n/index.ts`: register FE namespaces `portfolio`, `case`, `myWork`, `notifications`, `workspaces` (registered by ARCH, see §9).
5. Dependencies: none beyond the app foundation (Next.js, React, Zod, postgres) expected for FE-001..006.

## 9. ARCH answers (28 Oct 2026 01:53 UTC; ADR-013, ADR-014 on `develop` at 38dc495)

1. `lib/contracts` (ARCH-001): `CaseSourceAdapter { sourceSystem; listCases(identity, filter) -> CaseListPage
   {items, next_cursor} (no total count; counts from authorised SQL); getCase(identity, caseId) -> CaseSummary | null }`
   (null = unknown or unauthorised, indistinguishable). `CaseSummary`: case_id, case_number, title_key |
   synthetic_title, lifecycle_stage, is_restricted, records_state, source_system, source_ref, updated_at. Also
   `CaseListFilter`, `RequestIdentity {persona_id, active_workspace, roles}`, `ClockPort`, `IdGeneratorPort`,
   `AuditSinkPort`. No `Claims` type: FE uses `RequestIdentity`. FE proposes `CaseHeader` and the three command
   schemas as new files under `lib/contracts` in its FE PR; they need ARCH and SEC ACCEPT.
2. `withRequestContext(identity, fn, { correlationId?, sql? })` in `lib/db/security-context.ts`: one transaction,
   claims `{"v":1, persona_id, workspace_id, correlation_id}`, then `SET LOCAL ROLE cdf_v13_user`. FE passes its
   correlation id. DB adds a claims MAC (ADR-014) without changing the signature.
3. `lib/auth/session.ts`: `getCurrentSession() -> {persona, identity, claims} | null`,
   `createSessionToken({persona_id, active_workspace})`, `setSessionCookie(token)`, `clearSessionCookie()` (Server
   Actions and Route Handlers only). Workspace switch = target in the persona's memberships (contracts registry) ->
   new token -> set cookie; the database re-checks membership on every request (ADR-014 §2).
4. i18n namespaces registered: `auth`, `portfolio`, `case`, `myWork` (camelCase), `notifications`, `workspaces`;
   file format per ADR-013.
5. No new dependencies.

Fixed ids: personas `0b…0001`–`0004` (0005/0006 are negative-test personas, not on the sign-in page); workspaces
`0a…0001`–`0003`; Delta holds GOVERNANCE and SECRETARIAT (Scenario C). ADR-013 DOM attributes on every case-owning
element: `data-case-id`, `data-case-ref`; the switcher carries `data-workspace-code`; counts are `count-<name>` with
`data-count`. FE starts on the ARCH-001 branch head when ARCH says the PR is up.
