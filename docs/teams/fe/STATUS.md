# FE status — CDF V13 Enterprise (synthetic data only)

Updated: 2026-10-31 21:10 UTC · Branch: feature/V13-FE-006-notification-center (FE-006 part 1, Scenario E draft; #19, #23, #27, #32 merged into develop) · Head: see PR

## Completed
- Design and plan for V13-FE-001..006 — `docs/teams/fe/DESIGN.md` (rulings D6, notification detail, CSP, SEC-APP-18 recorded)
- V13-FE-001 (part 1) — `lib/authz` pre-check, `lib/server` (errors, request context, case read services, case source
  binding), `lib/adapters/case-source` (V13-records adapter, opaque cursor) — PR #9 — IN_REVIEW
- V13-FE-002 Workspace Switcher — PR #10 — IN_REVIEW (the switch is re-checked in the persona registry; DB's
  `api_switch_workspace` with audit WORKSPACE_SWITCHED is PR #17, FE wires it once #17 is on `develop`)
- V13-FE-003 Case Portfolio (SCREENS S2) — `/portfolio`: GET filter form (search, stage, records state, assigned to
  me), keyset paging with previous/next, authorised total, last recorded event, own open tasks — PR (stacked on #10)
  — IN_REVIEW. Contract change proposed in the PR (`CaseListPage.total`, `CaseListFilter.assigned_to_me`,
  `CaseListItem` = CaseSummary + `CaseListExtrasSchema`, `PORTFOLIO_DB_ROW_BOUND` = 100 and `PORTFOLIO_PAGE_MAX` = 99 as
  the filter's limit max): needs ARCH + SEC ACCEPT. Needs DB PR #15 on `develop`
  first (6-argument read functions and the row summaries; the adapter refuses rows without them).
- V13-FE-004 Case Workspace (SCREENS S3) — `/cases/[caseId]` with tabs overview, events, tasks, notifications (each its
  own URL; the route's UUID is the only case context). Header with number, stage, records state, named-access flag and
  the persona's capacity; closed notice; overview = current stage + own open tasks + last 5 recorded events. Proposed
  contracts (ARCH 31 Oct): `ProceduralRecordsReader` (listEvents, listTasks) in `lib/contracts/procedural-records.ts`,
  `NotificationRecordsReader` (listForCase) in `lib/contracts/notification-records.ts`,
  `CaseSourceAdapter.getCase` returns `CaseHeader` (summary + `my_capacity`, `CaseCapacitySchema`) in `ports.ts`/`case-summary.ts`. Task status
  badges via `lib/domain` toBadgeEpistemic (server only). `app/not-found.tsx` gains `data-testid="not-found-state"` (ARCH
  path, ARCH ACCEPT needed). PR #23 — COMPLETE (merged into develop 69e03d6, 31 Oct).
- OI-023 — workspace switch runs `api_switch_workspace` before the cookie is re-issued — PR #27 — COMPLETE (merged into develop 3cfce15, 31 Oct).
- V13-FE-005 My Work (SCREENS S1) — `/my-work`: subtitle with the workspace, count strip (Overdue, Due this week,
  Open; links that filter, counts from the authorised rows, Asia/Riyadh dates), own open tasks with case link by UUID,
  deadline in words, recorded status badges (event id; untouched OPEN unmarked) and a short Server Action form that
  offers only the transitions `api_update_task_status` accepts and sends `row_version`; closed case → no form. Stale
  version → "تغيّرت هذه المهمة منذ فتحها…" + reference; every other refusal generic + reference; success in a polite
  live region. Proposed contract `lib/contracts/my-work.ts` (MyWorkReader, TaskCommandPort,
  UpdateTaskStatusCommandSchema): needs ARCH + SEC ACCEPT. Reads DB-010's columns (migration 0008, on develop
  b5ee5f4). PR #32 — COMPLETE (merged into develop d694ff8, 31 Oct).

- V13-FE-006 part 1, Scenario E draft — the case Notifications tab offers "Create a notification draft" to roles
  that may draft (COMMITTEE_SECRETARY, INVESTIGATOR) on ACTIVE cases; Server Action → lib/server (pre-check, Zod,
  `api_create_notification_draft`); one fresh idempotency key per rendered form; a created draft redirects to the case
  id the command returned (SEC condition 1); every refusal (incl. a reused key) is one generic message with a reference,
  shown in place (useActionState), nothing written. Contract proposed in `lib/contracts/notification-draft.ts` (needs ARCH + SEC ACCEPT). — IN_REVIEW.
  Part 2 (`/notifications` with the D6 guard, the list on DB-015, the in-case preview on PROC-008) follows.

## Changed files
- lib/authz/{actions,index}.ts
- lib/server/{errors,context,cases,case-source}.ts
- lib/adapters/case-source/{v13-records,cursor}.ts
- tests/unit/authz/precheck.spec.ts
- tests/unit/server/{cases,errors-context,v13-records-adapter}.spec.ts, tests/unit/server/support/*
- docs/teams/fe/{DESIGN,STATUS}.md
- FE-003: app/(platform)/portfolio/{page.tsx,_components/PortfolioView.tsx,_components/portfolio.module.css},
  lib/server/{portfolio,portfolio-query}.ts, lib/adapters/case-source/v13-records.ts, lib/contracts/case-summary.ts
  (proposed), lib/i18n/{portfolio,case}/{ar,en}.ts, tests/unit/server/{portfolio.spec.tsx,v13-records-adapter.spec.ts,
  support/fake-case-source.ts}, tests/unit/contracts.spec.ts
- FE-004: app/(platform)/cases/[caseId]/{page.tsx,events/page.tsx,tasks/page.tsx,notifications/page.tsx,
  _components/{CaseWorkspace.tsx,render.tsx,labels.ts,case.module.css}}, app/not-found.tsx (test id only),
  lib/server/{case-workspace,records,cases}.ts, lib/adapters/{procedural-records/v13-procedural-records,
  notification-records/v13-notification-records,case-source/v13-records}.ts, lib/contracts/{procedural-records,
  notification-records,case-summary,ports,index}.ts (proposed), lib/i18n/case/{ar,en}.ts,
  tests/unit/server/{case-workspace.spec.tsx,v13-records-readers.spec.ts,cases.spec.ts,support/fake-records.ts,
  support/fake-case-source.ts}, tests/unit/contracts.spec.ts, tests/integration/fe/case-workspace-records.spec.ts
- OI-023 (PR #27): app/(platform)/workspace-actions.ts, lib/server/workspace.ts,
  tests/unit/server/workspace-switch.spec.ts, tests/integration/fe/workspace-switch.spec.ts
- FE-005: app/(platform)/my-work/{page.tsx,actions.ts,_components/{MyWorkView.tsx,my-work.module.css}},
  lib/server/{my-work,my-work-binding}.ts, lib/adapters/my-work/v13-my-work.ts, lib/contracts/{my-work,index}.ts
  (proposed), lib/i18n/myWork/{ar,en}.ts, tests/unit/server/{my-work.spec.tsx,v13-my-work-adapter.spec.ts,
  support/fake-my-work.ts,support/fake-case-source.ts}, tests/integration/fe/{my-work-command,my-work-read}.spec.ts

## Test evidence
| Command | Result | Counts | Commit |
| ------- | ------ | ------ | ------ |
| `pnpm lint` | pass | 0 problems | c4c7f8f |
| `pnpm typecheck` | pass | — | c4c7f8f |
| `pnpm format:check` | pass | — | c4c7f8f |
| `pnpm test` (unit) | pass | 21 files, 316 tests (65 new FE: authz 18, cases 20, errors/context 6, V13-records adapter + cursor 21) | c4c7f8f |
| After the contract change, merged develop e04c164: `pnpm test` | pass | 407 tests (develop + FE) | FE-001 head |
| FE-002: `pnpm test` (unit) | pass | 23 files, 328 tests at b8d02e5 (12 new: workspace switch 7, navigation/markup 5) | b8d02e5 |
| FE-002: `pnpm test:e2e` (`PW_CHROMIUM_PATH=/opt/pw-browsers/chromium`, build + start) | pass | 12/12 (e2e 9, a11y 3 incl. My Work with the new nav/switcher) | b8d02e5 |
| FE-002 after S5 alignment: `pnpm test` (unit) | pass | 419 | FE-002 head |
| FE-002 throwaway browser probe (not committed; e2e is QA's): Delta GOVERNANCE → SECRETARIAT via `/workspaces`, forged hidden value INVESTIGATIONS refused (cookie unchanged, reference shown), axe 0 serious/critical on `/workspaces`; Beta one membership shown as text, no Center link | pass | 2/2 | FE-002 head |
| Integration probe (not committed): `tests/integration/fe-case-source.spec.ts` on a local merge of this branch + `feature/V13-DB-001-m1-database-core` (b27cebb), `pnpm db:reset` then vitest integration | 3 pass, 9 fail as expected: every visible row is refused by the CaseSummary contract (no `source_system`, `source_ref`, `updated_at` from `portfolio_page`/`case_header`) | 12 tests | local |
| Same probe with the three columns filled locally by a throwaway patch (reverted, not committed) | pass: seed visibility for 8 persona/workspace pairs, 0009 only for Beta, unknown = unauthorised = null, closed readable, keyset paging, filters inside the authorised set | 12/12 | local |
| FE-003: `pnpm lint`, `pnpm typecheck`, `pnpm format:check`, `pnpm build` | pass | — | FE-003 head |
| FE-003: `pnpm test` (unit) | pass | 25 files, 472 tests (portfolio 38, adapter +14, contracts +3) | FE-003 head |
| FE-003 after merging develop a5bbb10 + FE-002 35e1e65, with `PORTFOLIO_DB_ROW_BOUND`/`PORTFOLIO_PAGE_MAX` (ARCH ruling (b) on SEC's limit+1 item): `pnpm test` | pass | 542 | FE-003 head |
| FE-003 integration probe (`tests/integration/fe-case-source.spec.ts`, not committed yet) on a local merge of FE-003 + DB PR #15 head 4eccf57, after `pnpm db:reset` | pass: seed visibility ×8 with total, 0009 only for Beta, unknown = unauthorised = null, keyset paging with constant total, filters and total agree, assigned-to-me ×6, row summaries | 15/15 | local |
| FE-003 throwaway browser probe (not committed; e2e is QA's) on the same merge, `pnpm build && pnpm start`: Alpha 7 rows = count, links by UUID, closed 0010 glyph + word, filters in URL survive back navigation, clear; Gamma search 0009 → no results, count 0, no 0009 UUID in the page; Beta sees 0009 with named-access flag; edited stage and forged cursor → generic state with correlation id, no SQL text; English LTR counts; assigned-to-me 6 rows, last event id 0e…0110 on 0010, own open tasks 2 on 0004; axe 0 serious/critical; no CSP console errors; no horizontal page scroll at 360 and 1280 px | pass | 5/5 | local |
| FE-004: `pnpm lint`, `pnpm typecheck`, `pnpm format:check`, `pnpm build` (4 new dynamic routes) | pass | — | FE-004 head |
| FE-004: `pnpm test` (unit) | pass | 29 files, 600 tests (Case Workspace 33: loader, 10 negatives × 4 tabs with no record read, generic error, markup; adapter 25) | FE-004 head |
| FE-004 integration probe (`tests/integration/fe-case-records.spec.ts`, not committed yet; lands in `tests/integration/fe/` once DB #21 is on `develop`) on a local merge of FE-004 45f0fec + DB PR #21 f53d007, after `pnpm db:reset` (7 migrations): Alpha on 0001 = SECRETARY, events TASK_STATUS_CHANGED then CASE_OPENED, own task SECRETARY OPEN without event, every task status event among the case's events; 0010 newest CASE_CLOSED 0e…0110; unknown, Alpha 0002, Alpha 0009, Gamma 0009, Delta@GOVERNANCE 0006, Epsilon expired → nothing on all four reads; Beta 0009 and Delta@SECRETARIAT 0006 readable; every visible case of Alpha and Beta parses. Plus the FE-003 probe on the same merge | pass | 10/10 + 15/15 | local |
| FE-004 throwaway browser probe (not committed; e2e is QA's), `pnpm build && pnpm start` on the same merge: Alpha portfolio → 0001 by UUID, title starts with the number, capacity SECRETARY, 1 own task, 2 last events, Truth Inspector 0 violations on overview and tasks (task status names event 0e…0201), axe 0 serious/critical on all 4 tabs, one data-case-id on the page, no CSP errors; unknown, malformed, upper-case, 0002, 0009, 0099 → HTTP 404 with the unknown-route heading and no case number or workspace in the page; 0010 closed notice + CASE_CLOSED first; no horizontal scroll at 360 px on all tabs; English LTR; Beta 0009 with named-access flag; Delta@GOVERNANCE 0006 → 404 | pass | 3/3 | local |

| FE-003 after merging develop c4b37c3 (DB #15, #17, #21, PROC #18), ARCH's two nits, explicit column lists for `portfolio_page` and `case_header` (SEC LOW): `pnpm lint`, `pnpm typecheck`, `pnpm format:check` | pass | — | FE-003 head |
| Same: `pnpm test` (unit) | pass | 771 | FE-003 head |
| Same: `pnpm db:reset` then `pnpm test:db` (includes the committed FE suite `tests/integration/fe/case-source.spec.ts`, 15) | pass | 11 files, 223 | FE-003 head |

| FE-004 after ARCH's rulings (ProceduralRecordsReader, capacity via getCaseHeader, toBadgeEpistemic, not-found-state), merged with FE-003 983ad04: lint, typecheck, format:check, build | pass | — | FE-004 head |
| Same: `pnpm test` (unit) | pass | 831 | ab90a91 |
| ARCH CHANGES 224d676 items 2–3 exactly: `getCase` returns `CaseHeader` (no separate method), `listForCase`: lint, typecheck, build; `pnpm test`; `pnpm test:db` | pass | 834; 233 | FE-004 head |
| Same: `pnpm db:reset` then `pnpm test:db` (FE suites case-source 15 + case-workspace-records 10) | pass | 12 files, 233 | FE-004 head |
| Same: `pnpm build && pnpm start`, `pnpm test:e2e` plus the throwaway FE probe (3: Truth Inspector 0 violations, axe 0 serious/critical on 4 tabs, negatives 404 with `not-found-state`, 360 px, LTR, Beta 0009, Delta other workspace) | pass | 59 passed (56 + 3), 17 skipped | FE-004 head |
| FE-005 (merged develop b5ee5f4 with 0007 + 0008): lint, typecheck, format:check, db:lint (9 migrations, 0 findings), build | pass | — | bffeb64 |
| Same: `pnpm test` (unit; My Work 47 + adapter 22 new) | pass | 38 files, 909 | bffeb64 |
| Same: `pnpm db:reset` then `pnpm test:db` (new FE suites: my-work-command 8 — Scenario B one task/event/audit row in 0001 only, stale, 4× NOT_FOUND, CASE_CLOSED, INVALID_TRANSITION, all rolled back, seed unchanged; my-work-read 9 — 6 persona/workspace lists, 0009 only Beta, DONE excluded, titles/state/event) | pass | 20 files, 350 | bffeb64 |
| Same: fresh `pnpm db:reset`, `pnpm build && pnpm start`, `pnpm test:e2e` | pass | 64 passed, 17 skipped | bffeb64 |
| FE-005 throwaway browser probe (not committed; e2e is QA's): Alpha 7 rows = Open count, Truth Inspector 0 violations, axe 0 violations (wcag2a/aa, 21a/aa), OPEN task unmarked, IN_PROGRESS recorded; update OPEN → IN_PROGRESS shows the updated notice and the badge becomes recorded; a second tab's version-1 form → stale message; forged task id (0009) → generic reference, server logs code NOT_FOUND only; Due-this-week filter link; Gamma's closed-case task has no form | pass | 1/1 | bffeb64 |
| OI-023 (PR #27, 17f4107 on develop c4b37c3): `pnpm test` / `pnpm test:db` / `pnpm test:e2e`; browser probe: forged target refused with cookie unchanged, real switch → exactly 1 WORKSPACE_SWITCHED row | pass | 725 / 212 / 56 (17 skipped) / 1 | 17f4107 |
| FE-005 after merging develop 69e03d6 (#23 merged), My Work table in `ScrollRegion` (caption `my-work-table-caption`) + guard test: lint, typecheck, format:check / `pnpm test` / `pnpm db:reset` + `pnpm test:db` / `pnpm db:reset` + `pnpm test:e2e` / throwaway narrow axe probe incl. `/my-work` at 375 and 1280 px, ar + en (not committed) | pass | — / 1177 / 389 / 101 / 2/2 | FE-005 head |

| FE-006 part 1 (develop ec8653a): lint, typecheck, format:check, build / `pnpm test` / `pnpm db:reset` + `pnpm test:db` (new `tests/integration/fe/notification-draft.spec.ts`, 12) / `pnpm db:reset` + `pnpm test:e2e` / throwaway Scenario E browser probe (not committed; e2e is QA's): Alpha drafts on 0001 (count +1, row marked, axe 0, no CSP console error), id absent from 0003, resubmitted old key → duplicate notice and no new row, case id tampered to 0009 → not-found page, no draft form on closed 0010 or for Delta | pass | — / 1615 (52 new: service+markup+action 33, adapter 19) / 384 / 101 / 2/2 | FE-006 head |

| FE-006 part 1 after merging develop d694ff8 + ARCH/SEC conditions (DB-returned case id only, one generic refusal shown in place, swap test, negatives): lint, typecheck, format:check, build / `pnpm test` / `pnpm db:reset` + `pnpm test:db` (FE draft suite 13) / `pnpm db:reset` + `pnpm test:e2e` / throwaway probe (`/mnt/project-files/v13-fe/probes/zz-fe-draft-probe.spec.ts`, offered to QA): Alpha WITNESS draft on 0001 (+1, axe 0, no CSP error), id absent from 0003; own key again, 0009, 0002, 0010, unknown and malformed case ids → same generic reference on the 0001 page, counts on 0001 and 0010 unchanged; no form on 0010 or for Delta | pass | — / 1706 / 402 / 101 / 2/2 | FE-006 head |

## Unresolved defects
- FE-006 part 1 known limit: a Server Action cannot read route params, so the form carries the route case id as a hidden
  field. A tampered id to a case the persona may not draft on is refused generically, nothing written; a swap to
  another case it may draft on lands the draft and its audit event there only (tested). ARCH + SEC accepted this
  binding without an HMAC helper (31 Oct).
- FE-OPEN-1 RULED by ARCH 28 Oct 03:47: `synthetic_title` is `{ar, en} | null`, `source_ref` follows the database
  pattern `^[A-Za-z0-9._:-]{1,80}$` (both in `lib/contracts`, this PR, needs ARCH + SEC ACCEPT); DB returns
  `updated_at`, `source_system`, `source_ref` and makes `source_ref` NOT NULL in its PR (b). Until DB's PR lands the
  adapter keeps refusing rows without those columns (fail closed).

- FE-003 known gaps: stage names live in `case.stage.*` until PROC's stage catalogue exists; generic labels duplicate
  UX's `common.*` until UX-002 lands; `/cases/[id]` links answer 404 until FE-004; no sort control (S1/S2 sorting is
  by case number only, the keyset order).
- FE-003: the "last recorded event" date carries `data-event-id` but not `data-epistemic`. The Truth Inspector (T2) needs
  `data-status-kind` and `data-status` on every `data-epistemic` element, and the portfolio row has no event code or
  status yet. It becomes a full `RecordedEventDate` once DB returns the event's status and PROC's status kinds land
  (asked of ARCH, 31 Oct).

- FE-004 known gaps: notification status and recipient class are shown as recorded codes until PROC's status catalogue
  lands; event names exist for CASE_OPENED, CASE_CLOSED, TASK_STATUS_CHANGED (others show their code); timeline
  entries and dates carry `data-event-id` without `data-epistemic`; task status badges are full recorded elements; an
  untouched OPEN task carries no epistemic claim (ARCH ruling 31 Oct). Dates and timeline entries become inspectable
  once PROC's status-kind vocabulary is used and DB returns each event's resulting status (later task). Domain task
  statuses (lib/domain: OPEN, IN_PROGRESS, ON_HOLD, RETURNED, COMPLETED, CANCELLED, FAILED) differ from DB's task
  statuses (OPEN, IN_PROGRESS, BLOCKED, DONE, CANCELLED), so task labels stay in `case.task.status.*` (raised to ARCH).

- FE-005 known gaps: deadline text is FE's own (Intl.RelativeTimeFormat) until UX's DeadlineText lands; task status
  labels stay in `case.task.status.*` (OI-029); the count strip has no "due today" bucket (today counts as this week).
- Local note: with migration 0007 the database holds one claims key; after `pnpm test:db` (test key) run `pnpm db:reset`
  before starting the app with another session secret, otherwise every read fails closed (CLAIMS_KEY_MISMATCH).

## Dependencies and requests
- DB-010 (my_work_tasks columns, migration 0008): merged on develop b5ee5f4; FE-005 reads it.
- FE owns `tests/integration/fe/**` (ARCH, 03:48). `tests/integration/fe/case-source.spec.ts` is committed with FE-003.
- DB: merge of DB-001..005; the read-function columns per the ruling.
- UX-002/003: FE-002 ships minimal nav/switcher markup; swapped for UX's SideNav/WorkspaceSwitcher when they land.
- QA: Scenario C end-to-end (Delta GOVERNANCE ↔ SECRETARIAT) in QA-002; FE did not add e2e (tests/e2e is QA's).
