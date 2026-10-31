# FE status — CDF V13 Enterprise (synthetic data only)

Updated: 2026-10-31 18:30 UTC · Branches: feature/V13-FE-003-case-portfolio, feature/V13-FE-004-case-workspace · Head: see PRs

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
  the persona's capacity; closed notice; overview = current stage + own open tasks + last 5 recorded events. New
  `CaseRecordsReader` port proposed in `lib/contracts/case-records.ts` (needs ARCH + SEC ACCEPT); V13 adapter over DB-008
  reads (`case_events`, `case_tasks`, `case_header.my_capacity`, PR #21) and `case_notifications` (0004). Stacked on
  FE-003. Draft PR — IN_PROGRESS until DB #21 is on `develop` and the integration probe passes.

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
  _components/{CaseWorkspace.tsx,render.tsx,labels.ts,case.module.css}}, lib/server/{case-workspace,case-records}.ts,
  lib/adapters/case-records/v13-case-records.ts, lib/contracts/{case-records,index}.ts (proposed),
  lib/i18n/case/{ar,en}.ts, tests/unit/server/{case-workspace.spec.tsx,v13-case-records-adapter.spec.ts,
  support/fake-case-records.ts}

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

## Unresolved defects
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
  entries carry `data-event-id` without `data-epistemic` and an untouched OPEN task carries no epistemic claim (FE's
  default, asked of ARCH 31 Oct); `app/not-found.tsx` has no `data-testid="not-found-state"` (ARCH's file, asked).

## Dependencies and requests
- FE owns `tests/integration/fe/**` (ARCH, 03:48). The suite lands once DB's PR with the claims-key test support and
  the three columns is on `develop`.
- DB: merge of DB-001..005; the read-function columns per the ruling.
- UX-002/003: FE-002 ships minimal nav/switcher markup; swapped for UX's SideNav/WorkspaceSwitcher when they land.
- QA: Scenario C end-to-end (Delta GOVERNANCE ↔ SECRETARIAT) in QA-002; FE did not add e2e (tests/e2e is QA's).
