# FE status — CDF V13 Enterprise (synthetic data only)

Updated: 2026-11-01 03:50 UTC · Branch: feature/V13-FE-011-plain-text-preview (from develop 800ab8a; #82, #98 merged; FE-012 is #112) · Head: see PR

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
  shown in place (useActionState), nothing written. Contract `lib/contracts/notification-draft.ts`. PR #51 — COMPLETE (merged into develop 65a251d, 31 Oct).
- V13-FE-006 part 2, Notification Operations Center list (SCREENS S4) — `/notifications`: pre-check
  `notifications.center.read` first, so an investigator gets the unknown-route page (status 404, same body and same
  title) on every URL of the route (D6, SEC-APP-17); GET filter form (lifecycle status, template code, case number,
  created from/to as Asia/Riyadh days), keyset paging with previous/next, authorised total; each row names its case
  (number link by UUID + title, `data-case-id`, `data-case-ref`), template name + code + version, recipient class (a
  class, never a person), status in words ("sent — delivery not confirmed", never "delivered"), created, last event.
  Reads DB-015 (`notifications_page` + `notifications_count`, one statement). Proposed contract
  `lib/contracts/notification-center.ts` (NotificationCenterReader, row and filter schemas) and `InvalidCursorError`
  moved into `lib/contracts` (OI-031, own file `lib/contracts/cursor.ts`; `lib/adapters/case-source/cursor.ts` re-exports it): needs ARCH + SEC ACCEPT.
  Rows link to the case's Notifications tab; the in-case preview (`?n=`) is part 3. Part 2 — COMPLETE (#61, merged into develop 9290778).
- V13-FE-006 part 3, in-case preview (SCREENS S3, REQ-NOTIF-011) + UX review M1-07 — `/cases/<id>/notifications?n=<uuid>`:
  the read is keyed by the authorised case AND the notification id under RLS (`NotificationPreviewReader`, proposed
  `lib/contracts/notification-preview.ts`), so unknown, other-case, hidden and malformed values show one generic state
  with a reference; one frozen `case_record` object goes to `buildModelFromRecords` and `projectForRecipient` (ARCH
  ruling 31 Oct), no `access_list` is passed, so restricted 0009 fails closed (NO_ACCESS_LIST_RESULT); only
  `renderPlatform`'s HTML of the projected model reaches UX-006's `sandbox=""` frame; the binding's UNKNOWN_RECIPIENT
  (every database class except WITNESS, OI-037) shows the OI-037 state; any other binding or read error is the generic
  state, logged by code only. Each row of the tab and of the Center links to its preview by ids. M1-07: status and
  recipient labels from `lib/i18n/case` (DISPATCHED reads "sent — delivery not confirmed"), template name beside its
  code; `CaseNotificationSchema` gains `template_name` and `listForCase` joins `notification_template` by its unique
  code with an explicit order (proposed contract change). Needs ARCH (contracts), SEC (lib/server, keyed read), QA (UI)
  — IN_REVIEW.
- V13-FE-007 (QA defects pinned in #58) — OI-042: `app/(platform)/not-found.tsx` renders notFound() inside the
  AppShell as a section (no second `<main>`, no second `id="main"`), same visible text, `data-testid` and title as the
  root not-found page; OI-043: the Portfolio filter form is keyed on its filter values (`filterFormKey`), so Clear,
  Back and other client-side navigations remount it with the URL's values — COMPLETE (#63, merged into develop 63d1271).
- V13-FE-008 (OI-044) — the workspace switcher and My Work show a role only from a membership the database confirms
  in the request's security context (`MembershipReader`, proposed contract `lib/contracts/memberships.ts`, adapter
  `lib/adapters/identity/v13-memberships.ts`: own persona via `current_persona_id()`, active workspace, valid now).
  Session roles are never shown; no confirmed role gives an empty switcher role and "No role confirmed in this
  workspace" on My Work; a read failure shows no role (fail closed). COMPLETE (#81, merged into develop 286eb93 by ARCH). ARCH pre-review folded in: the port states its guarantees, roles in the closed set's order, planted-row negatives for a future window and an inactive workspace. The Workspaces page also uses confirmed roles. Empty-role e2e `tests/e2e/confirmed-role.spec.ts` (ARCH request, for QA review).
- V13-FE-009 (M1 design review) — Case Workspace overview (M1-09): after #90 (develop f11e65a) the Overview's task
  table uses UX's DataTable `captionVisuallyHidden` and the events list is UX's Timeline, so FE-009's own caption
  and timeline-CSS hunks were dropped (ARCH ruling). FE-009 keeps unit tests for "My open tasks in this case" shown
  once in ar and en, the caption still naming the table and scroll region, and the Tasks tab keeping its visible caption. Notification Operations Center: the table keeps a 48rem
  minimum and scrolls in its region, never the page (M1-15); template codes and the version never break (M1-16); the
  version is Latin in `<bdi>` after a translated label (M1-17, D10); dates, times and counts through
  `components/format.ts` (M1-18). UX finding on #74: the preview frame's accessible name is a UI string (disclosed event
  title + عرض تجريبي / design preview; generic word when withheld); the renderer's document title and DESIGN_PREVIEW
  marking stay inside the frame — COMPLETE (merged by ARCH, #82 → 961197e).
- V13-FE-010 (UX-009 R-04, UXB-08) — the case Notifications tab is now the shared DataTable (scope case: every row
  carries data-case-id/data-case-ref; test ids, labels, per-row preview link and aria-current kept), so its caption is
  DataTable's sticky caption. The Notification Operations Center keeps its own table and takes DataTable's caption
  pattern (size-container region `v13-scroll-region`, caption text `v13-table-caption-text`). At 320 px (= 400% zoom)
  both captions stay inside the region and wrap, also after scrolling to the far end. Unused case.module.css table
  rules removed. Added scope (ARCH 02:34, QA on 961197e): the tab's created time uses `formatDateTime` (month in words,
  as in the Center; UXB-02) and the version is Latin in `<bdi>` (UXB-04, D10); the unused `dateTimeFormat` helper is
  removed. ARCH 02:42: the draft form's template option shows the version as Latin digits, never grouped (D10; an
  `<option>` holds text only, so no `<bdi>`) — IN_REVIEW (QA).
- V13-FE-011 Plain-text version in the in-case preview (REQ-NOTIF-011; PROC-021 #106) — the preview view carries
  `renderPlatform(...).text` from the same projected model as the frame's HTML. It is shown under the frame in a
  native `<details>` (closed by default, works without JavaScript), as escaped text in a `<pre>` with the notice's
  `lang` and `dir`, wrapped so 320 px has no page scroll. Unmapped and unavailable states show none — IN_REVIEW (QA).

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
- FE-006 part 2: app/(platform)/notifications/{page.tsx,_components/{NotificationCenterView.tsx,center.module.css}},
  lib/server/{notification-center,notification-center-query,records}.ts,
  lib/adapters/notification-records/v13-notification-center.ts, lib/adapters/case-source/cursor.ts,
  lib/contracts/{notification-center,index}.ts (proposed), lib/i18n/notifications/{ar,en}.ts,
  tests/unit/server/{notification-center.spec.tsx,v13-notification-center-adapter.spec.ts,
  support/fake-notification-center.ts}, tests/integration/fe/notification-center.spec.ts,
  tests/e2e/notification-center.spec.ts (FE-committed, for QA's review, as agreed for Scenario E on #51)

## Test evidence
| Command | Result | Counts | Commit |
| FE-006 part 3 + M1-07 after merging develop 9290778 (#61; Center rows open `?n=`): lint, typecheck, format:check / `pnpm test` (preview 25 + adapter 11 + list-reader 3 new) / `pnpm db:reset` + `pnpm test:db` (new `tests/integration/fe/notification-preview.spec.ts` 9: keyed read, other-case/hidden/unknown/other-workspace null, WITNESS draft renders inside a rolled-back request, 0009 fails closed, four database classes show OI-037, list names + order) / `pnpm db:reset` + `pnpm test:e2e` (Scenario E preview 5 + Center row link 1 new; axe on the page in legacy mode with iframes off, and on the srcdoc as its own page; the two ✘ are QA's `test.fail()` pins that #63 removes) | pass | 1927 / 456 / 156 | FE-006 part 3 head |
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
| FE-006 part 2 (branch from develop b24db04): lint, typecheck, format, db:lint (11 migrations, 0 findings), build (`/notifications` dynamic route) | pass | — | FE-006 part 2 head |
| Same: `pnpm test` (unit; Center 40 + adapter/cursor 43 new) | pass | 66 files, 1764 | FE-006 part 2 head |
| Same: `pnpm db:reset` then `pnpm test:db` (new FE suite notification-center 13: Alpha 4 rows newest first, never 0009; row shape; Delta in both workspaces; 0009 Beta only; hidden, other-workspace and unknown case numbers and Epsilon → no rows, total 0; filters; one-row keyset walk with microsecond cursor; bad cursor refused; Scenario E draft in 0001 appears first with case 0001 only, rolled back) | pass | 26 files, 423 | FE-006 part 2 head |
| Same: `pnpm db:reset` then `pnpm test:e2e` (new spec 6: Beta and Gamma 404 identical to an unknown route on 4 URLs, no nav item; Alpha via nav, rows name visible cases only, count = rows; case filter; hidden/unknown case → no results; edited URL → invalid with reference; Delta GOVERNANCE) | pass | 132 passed | FE-006 part 2 head |
| FE-006 part 2 + keyed Center filter form (OI-043 fix applied to S4): `pnpm test` / `pnpm db:reset` + `pnpm test:e2e` with a throwaway probe (Center Clear empties status and case, Back restores them; not committed) | pass | 1765 / 133 (132 + probe) | FE-006 part 2 head |
| FE-006 part 2 after ARCH CHANGES ac30892: `InvalidCursorError` in its own `lib/contracts/cursor.ts` (both ports name the refusal), `lib/server/cases.ts` imports it from contracts, page-max comment, page + count in one statement (one snapshot at READ COMMITTED): lint, typecheck / `pnpm test` / `pnpm db:reset` + `pnpm test:db` / `pnpm db:reset` + `pnpm test:e2e` | pass | — / 1765 / 423 / 132 | FE-006 part 2 head |
| FE-007 (branch from develop 718b07b): lint, typecheck, format / `pnpm test` (not-found 4 + filter key 3 new) / `pnpm db:reset` + `pnpm test:db` / `pnpm db:reset` + `pnpm test:e2e` | pass | — / 65 files, 1691 / 418 / 126 | FE-007 head |
| FE-007 throwaway browser probe (not committed; QA's pinned tests are in #58): Gamma on hidden 0009 and unknown 0099 → 404, one `main`, one `id="main"`, axe 0 violations; Alpha `/portfolio?stage=INVESTIGATION&state=ACTIVE` → Clear shows empty selects, Back shows both again. Same probe on the code without the fix: 2/2 fail | pass | 2/2 | FE-007 head |
| FE-007 after QA CHANGES e1434b4 and develop b5d810c (#58): `autoComplete="off"` on the Portfolio filter form (back_forward document loads), QA's two `test.fail()` pins removed (board §1 exception, ARCH): lint, typecheck / `pnpm test` / `pnpm db:reset` + `pnpm test:db` / `pnpm db:reset` + `pnpm test:e2e` (both former pins pass: case-404 one main, Scenario D Clear/Back) | pass | — / 1725 / 418 / 138 | FE-007 head |

| FE-006 part 1 (develop ec8653a): lint, typecheck, format:check, build / `pnpm test` / `pnpm db:reset` + `pnpm test:db` (new `tests/integration/fe/notification-draft.spec.ts`, 12) / `pnpm db:reset` + `pnpm test:e2e` / throwaway Scenario E browser probe (not committed; e2e is QA's): Alpha drafts on 0001 (count +1, row marked, axe 0, no CSP console error), id absent from 0003, resubmitted old key → duplicate notice and no new row, case id tampered to 0009 → not-found page, no draft form on closed 0010 or for Delta | pass | — / 1615 (52 new: service+markup+action 33, adapter 19) / 384 / 101 / 2/2 | FE-006 head |

| FE-006 part 1 after merging develop d694ff8 + ARCH/SEC conditions (DB-returned case id only, one generic refusal shown in place, swap test, negatives): lint, typecheck, format:check, build / `pnpm test` / `pnpm db:reset` + `pnpm test:db` (FE draft suite 13) / `pnpm db:reset` + `pnpm test:e2e` / throwaway probe (`/mnt/project-files/v13-fe/probes/zz-fe-draft-probe.spec.ts`, committed as tests/e2e/scenario-e-notification-draft.spec.ts): Alpha WITNESS draft on 0001 (+1, axe 0, no CSP error), id absent from 0003; own key again, 0009, 0002, 0010, unknown and malformed case ids → same generic reference on the 0001 page, counts on 0001 and 0010 unchanged; no form on 0010 or for Delta | pass | — / 1706 / 402 / 101 / 2/2 | FE-006 head |
| FE-006 part 1, SEC CHANGES 150d54a (integration access negatives, all NOT_FOUND with no notification, event or audit row): Alpha on 0002 and 0005, Alpha and Gamma on restricted 0009, unknown UUID, Gamma (Investigations) on 0008 (visible only in other workspaces), Delta (role): `pnpm db:reset` + `pnpm test:db` (FE draft suite 16) | pass | 405 | FE-006 head |
| FE-006 part 1: committed `tests/e2e/scenario-e-notification-draft.spec.ts` (ARCH: rides #51, QA reviews; SEC condition 2 with relative counts): `pnpm db:reset` + `pnpm test:e2e`; then `db:reset` + the spec with `--repeat-each=2 --workers=1` (second pass on a database the first wrote to). A second server start without `db:reset` fails every e2e suite with CLAIMS_KEY_MISMATCH (migration 0007, known local constraint), not this spec | pass | 103 / 4 | FE-006 head |
| FE-006 part 2 after merging develop 65a251d (#51; records.ts keeps both bindings, contracts index keeps both exports): lint, typecheck / `pnpm test` / `pnpm db:reset` + `pnpm test:db` / `pnpm db:reset` + `pnpm test:e2e` | pass | — / 69 files, 1860 / 28 files, 447 / 150 | FE-006 part 2 head |
| FE-006 part 3, QA CHANGES 982bd76: preview link accessible name from the template name and the class label (never raw codes, pinned in e2e by `toHaveAccessibleName`); OI-037 notice shows the class label with the code in `<bdi>`: lint, typecheck, format:check / `pnpm test` / `pnpm db:reset` + `pnpm test:db` / `pnpm db:reset` + `pnpm test:e2e` | pass | — / 75 files, 1947 / 456 / 179 | FE-006 part 3 head |
| FE-008 after merging develop e9cd74d (#76): the Epsilon and Zeta negatives, session roles ignored, another workspace never filling this one, strict rows, a read failure giving none, and planted rows rolled back (future window, inactive workspace, positive control; each negative fails when its predicate is deleted). Empty-role e2e: Epsilon, Zeta, Alpha control. Commands: lint, typecheck, format:check / `pnpm test` / `pnpm db:reset` + `pnpm test:db` (memberships integration 9) / `pnpm db:reset` + `pnpm test:e2e`. (Correction: the earlier 456/179 reported for fad4803 came from the FE-006 tree; fad4803's own run is not recorded.) | pass | — / 75 files, 1939 / 456 / 197 | 466ea5d |
| FE-008, ARCH CHANGES 466ea5d (end of the window): planted negatives for an ended membership (valid_to = now() − 1 h) and the exact exclusive end (valid_to = now()), plus a positive control (+1 h); deleting the valid_to predicate fails 2 tests, `>` → `>=` fails the exact-end test. Commands: format:check / `pnpm test` / `pnpm db:reset` + `pnpm test:db` (memberships integration 12) / `pnpm db:reset` + `pnpm test:e2e` | pass | — / 75 files, 1939 / 459 / 197 | FE-008 head |
| FE-009 on fix/V13-FE-009-overview-and-center-polish: lint, typecheck, format:check / `pnpm test` / `pnpm db:reset` + `pnpm test:db` / `pnpm db:reset` + `pnpm test:e2e` (new: Center at 360 and 768 px in ar and en — no page scroll, region scrolls at 360, codes on one line, Latin version, month in words; the four fail on the old Center markup, checked) | pass | — / 73 files, 1910 / 447 / 177 | FE-009 head |
| FE-009 after merging develop a93fa61 (#74) + the frame title (unit: ar/en titles, withheld title, no raw marking; e2e: Scenario E frame name ends in عرض تجريبي): format:check / `pnpm test` / `pnpm db:reset` + `pnpm test:db` / `pnpm db:reset` + `pnpm test:e2e` | pass | — / 76 files, 1968 / 456 / 204 | FE-009 head |
| FE-009, SEC CHANGES 61d2853 + develop 286eb93 (#81) merged: loader-level frame-title tests on the real projection with event_title stubbed as the projector's outcomes (absent / null = PROHIBITED or REDACTED → generic word; SAFE_REFERENCE → null, token and label never in the name; GENERALIZED → the generic text; malformed → null); returning the token for an object fails the SAFE_REFERENCE test (checked). QA nit on #81: /workspaces role lines in `confirmed-role.spec.ts`. Commands: lint, typecheck, format:check / `pnpm test` / `pnpm db:reset` + `pnpm test:db` / `pnpm db:reset` + `pnpm test:e2e`. The full e2e run had 1 failure in QA's Sentinel self-test `planted-leak.spec.ts` "(o) … fetching the same GET again" (30 s timeout; its fixture page loads no application file); re-run of that spec + the edited spec after `db:reset`: 27/27 | pass (see note) | — / 77 files, 1994 / 468 / 230 of 231, re-run 27/27 | FE-009 head |
| FE-009 after merging develop f11e65a (#90 UX-008(c), SEC-009 #87): conflicts in CaseWorkspace.tsx and case.module.css resolved to develop's version (FE caption + timeline hunks dropped), frame title re-applied, M1-09 unit tests moved to the DataTable caption markup. Commands: lint, typecheck / `pnpm test` / `pnpm db:reset` + `pnpm test:db` / `pnpm db:reset` + `pnpm test:e2e` | pass | 78 files, 2008 / 468 / 231 of 231 | FE-009 head |
| FE-010 on develop 961197e: new unit pins (case tab DataTable markup, sticky caption, row ids and ADR-013 attributes, ar/en; Center caption span + size-container region; removing either Center class fails the pin, checked) and e2e at 320 px (Center + case tab, ar/en, caption inside the region before and after scrolling; all 4 fail on develop's markup, checked). Commands: lint, typecheck, format:check / `pnpm test` / `pnpm db:reset` + `pnpm test:db` / `pnpm db:reset` + `pnpm test:e2e` | pass | 78 files, 2011 / 468 / 235 of 235 | FE-010 head |
| FE-010 + UXB-02/UXB-04 (case tab dates and version) after merging develop 11fad34: unit pins in ar and en for the month-in-words created time (equals `formatDateTime`, no `/`) and the Latin `<bdi>` version; restoring the numeric date or `numberFormat` version fails them (checked). Commands as above | pass | 79 files, 2018 / 468 / 235 of 235 | FE-010 head |
| FE-010 + draft option version (D10) after merging develop 68a42b9: unit pin in ar and en with version 1234 ("الإصدار 1234" / "version 1234", no Arabic-Indic digits, no grouping); numberFormat output fails it (checked). Commands as above | pass | 80 files, 2026 / 468 / 235 of 235 | FE-010 head |
| FE-010 after merging develop a0bf765 (#99, QA's leak-suite guard): commands as above | pass | 80 files, 2026 / 468 / 312 of 312 | FE-010 head |
| FE-011 on develop 800ab8a: lint, typecheck, format:check / `pnpm test` (notification-preview 5 new: loader text is the renderer's twin for the projected model, ar + en; closed localised disclosure after the frame; notice's lang/dir; markup escaped; no text in unmapped/unavailable/none) / `pnpm db:reset` + `pnpm test:db` / `pnpm db:reset` + `pnpm test:e2e` (Scenario E: text version at 320 px, text only, axe). Mutation: the HTML in place of the text fails the loader test; `white-space: pre` fails the 320 px test (799 vs 320) | pass | 84 files, 2059 / 485 / 313 of 313 | FE-011 head |

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

- FE-006 part 2 known gaps: the template filter is a code text field (no template catalogue read for the Center yet);
  status and recipient labels live in `notifications.status.*` / `notifications.recipient.*` until PROC's catalogue
  (OI-029); rows link to the case's Notifications tab until the in-case preview (part 3, after #51 and UX #54).

## Dependencies and requests
- DB-010 (my_work_tasks columns, migration 0008): merged on develop b5ee5f4; FE-005 reads it.
- FE owns `tests/integration/fe/**` (ARCH, 03:48). `tests/integration/fe/case-source.spec.ts` is committed with FE-003.
- DB: merge of DB-001..005; the read-function columns per the ruling.
- UX-002/003: FE-002 ships minimal nav/switcher markup; swapped for UX's SideNav/WorkspaceSwitcher when they land.
- QA: Scenario C end-to-end (Delta GOVERNANCE ↔ SECRETARIAT) in QA-002; FE did not add e2e (tests/e2e is QA's).
