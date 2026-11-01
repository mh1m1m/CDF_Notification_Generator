# Browser testing architecture — CDF V13 Enterprise (V13-QA-001 design)

**SYNTHETIC-DATA REFERENCE IMPLEMENTATION — not CDF production.** Team QA. Status: **DESIGN (IN_REVIEW)** — nothing in
this file has been built or run yet. It becomes code after V13-ARCH-001 is on `develop`. Requirement ids: UXQA-01,
UXQA-02, UXQA-03, UXQA-04, UXQA-05, UXQA-07, UXQA-08, UXQA-15, UXQA-16; gates QG-02/B, QG-04/I, QG-06/A, QG-08/E,
QG-09/F, G, QG-12/J.

## 1. Scope and principles

1. Playwright Test is the only browser engine. Tests use roles, labels and accessible names first, `data-testid`
   second, never CSS structure or text that is not from `lib/i18n`.
2. Every assertion about cases is made against **two sources**: what the browser shows and what the database recorded.
   A test that only checks that a page renders is a smoke test and is labelled so.
3. No test is skipped, retried into green or weakened. `retries: 0` locally; `retries: 1` in CI only for the
   `staging` project, and every retry is reported as a flaky result, not a pass.
4. Synthetic data only. Fixtures use the DB-005 seed; tests that create data create it under the seeded cases and
   persona names, with `@example.test` addresses.
5. A browser result is reported as "Chromium/Firefox/WebKit emulation"; never as real-device or native-browser testing.
6. Every M1 component has a **planted-fault self-test** that proves it can fail (§7). A component whose self-test does
   not fail is broken, whatever its other results.

## 2. Files QA will add (all in QA-owned paths)

```
playwright.config.ts
tests/fixtures/            personas.ts, seed-facts.ts, db.ts, signin.ts, evidence.ts, test.ts (extended test)
tests/e2e/                 smoke.spec.ts, scenario-a…e.spec.ts
tests/sentinel/            sentinel.ts (library), ui.spec.ts, api.spec.ts, db.spec.ts, planted-leak.spec.ts
tests/truth/               inspector.ts (library), truth.spec.ts, planted-badge.spec.ts
tests/a11y/                axe.spec.ts, keyboard.spec.ts, reflow.a11y.spec.ts
tests/visual/              rtl.spec.ts, responsive.spec.ts, library.spec.ts (screenshot library, UXQA-05)
tests/critic/              (M2; harness for the UX Design Critic)
docs/qa/                   this file, SCENARIOS.md, SCREENSHOT_LIBRARY.md, reports per run
```

## 3. Playwright projects

| Project | Browser | Viewport | Locale / dir | Runs | Purpose |
| ------- | ------- | -------- | ------------ | ---- | ------- |
| `desktop-ar` | Chromium | 1280×800 | `ar-SA`, `rtl` | every PR | primary: scenarios, Sentinel, Truth |
| `desktop-en` | Chromium | 1280×800 | `en-GB`, `ltr` | every PR | language parity |
| `mobile-ar` | Chromium | 360×780 (Pixel-class) | `ar-SA` | every PR | Gate G, mobile navigation |
| `tablet-ar` | Chromium | 768×1024 | `ar-SA` | every PR | Gate G |
| `wide-ar` | Chromium | 1920×1080 | `ar-SA` | every PR (visual only) | Gate G |
| `firefox-ar`, `webkit-ar` | Firefox, WebKit | 1280×800 | `ar-SA` | CI nightly / on demand | cross-engine; not in the Claude sandbox (only Chromium is installed there) |
| `db-only` | none | — | — | every PR | Sentinel DB half and Truth DB half (no browser) |
| `staging` | Chromium | 1280×800 | `ar-SA` | on demand / Gate J | read-only smoke + isolation against the staging preview (§9) |

Configuration rules: `executablePath` from `PW_CHROMIUM_PATH` when set (Claude sandboxes:
`/opt/pw-browsers/chromium`); CI uses the browsers of the pinned `@playwright/test` version. `fullyParallel: true`,
but tests that write data run against a per-worker transaction-free design (§5.3). `trace: 'retain-on-failure'`,
`screenshot: 'only-on-failure'` for functional projects; the visual projects take their screenshots explicitly.
`webServer` starts `pnpm build && pnpm start` on port 3100 with `V13_PERSONA_SIGNIN=enabled` against the local
database (CLAUDE.md §8); the reporter writes `list`, `html` (`test-results/html`) and `json`
(`test-results/results.json`).

## 4. Personas and sign-in

Persona sign-in is ADR-004's synthetic identity. The fixture `signin.ts` uses the real sign-in page (role-based
locators: the persona list, the sign-in button) once per persona and saves the storage state to
`test-results/.auth/<persona>.json` (never committed). Tests then start already signed in. One spec,
`smoke.spec.ts`, signs in through the UI every run, and one negative test proves that with `V13_PERSONA_SIGNIN`
unset the page refuses (with SEC-003).

Seed facts the tests rely on are **read from the database at the start of the run** (`seed-facts.ts`, as
`cdf_v13_user` with each persona's claims, plus one owner-level read used only to compute the expected visibility
table). Tests never hard-code which persona sees which case; they compare the UI with what the database says the
persona may see. The DB-005 visibility table is checked against the same query, so a seed change that alters
visibility fails loudly instead of silently changing the expectation.

## 5. Contracts QA needs from other teams

These are requests, routed through ARCH. None of them is a test-only bypass; all are production-safe attributes.

### 5.1 From FE and UX — case-context attributes (for the Sentinel)

| Where | Attribute | Value |
| ----- | --------- | ----- |
| The element that owns a case's content (case workspace root, each portfolio row, each My Work task row, each notification row, each preview) | `data-case-id` | the case UUID |
| Same element | `data-case-ref` | the display number `CDF-DEMO-2026-NNNN` |
| Case workspace root | `data-testid="case-workspace"` | — |
| Workspace switcher and the active-workspace marker | `data-testid="workspace-switcher"`, `data-workspace-code` | workspace code |
| Every count shown (portfolio total, tab badges, My Work totals) | `data-testid="count-<name>"`, `data-count` | the number |

Rule the Sentinel enforces: inside any element with `data-case-id=X`, no descendant may carry a different
`data-case-id`, and no visible text may contain a `CDF-DEMO-2026-NNNN` other than X's reference.

### 5.2 From UX and PROC — epistemic attributes (for the Truth Inspector)

Every StatusBadge, Timeline entry and progress mark renders:

| Attribute | Values |
| --------- | ------ |
| `data-epistemic` | `recorded` · `expected` · `conditional` · `awaiting_approval` (the PROC-001 states) |
| `data-event-id` | the `procedural_event` UUID — **required when `data-epistemic="recorded"`**, absent otherwise |
| `data-status-kind` | `procedure` · `task` · `meeting` · `decision` · `notification` · `delivery` |
| `data-status` | the status code |

Rule the Inspector enforces: every `recorded` element names an event that exists in the database, belongs to the same
case as its nearest `data-case-id` ancestor, and whose status code produces the shown status through the PROC-001
fold. A `recorded` element without `data-event-id` is a failure. `expected`/`conditional`/`awaiting_approval` must be
visibly distinct from `recorded` without colour alone (checked in `tests/a11y`: accessible name or text differs).

### 5.3 From DB — test database access

- The local database as built by `pnpm db:reset` (roles `cdf_v13_app`, `cdf_v13_user`). QA's DB fixture connects as
  `cdf_v13_app`, then per query `SET LOCAL ROLE cdf_v13_user` with the persona's claims — the same security context as
  the app (ADR-003). It never connects as the owner role except for the single expected-visibility read in §4, which
  runs in a read-only transaction.
- A reset per CI job (not per test). Write tests (Scenario B, E) create their own rows through the app and assert on
  their own rows by id, so parallel workers never depend on each other's writes.

### 5.4 From ARCH

- devDependencies (exact versions, reasons for `docs/DEPENDENCIES.md`): `@playwright/test` **1.63.0** (matches the
  sandbox's pre-installed browsers, so no `playwright install` is needed locally) and `@axe-core/playwright` **4.14.0**
  (axe rules for Gate E; no other accessibility engine is needed for M1).
- Scripts: `test:e2e` = `playwright test`, `test:e2e:staging` = `playwright test --project=staging`.
- CI job `e2e` (UXQA-15): after `build`, start local PostgreSQL 16, `pnpm db:reset`, `pnpm exec playwright install
  --with-deps chromium` (CI only), run all per-PR projects, upload `test-results/` as an artifact (14 days), fail the
  workflow on any failure. A nightly job adds Firefox and WebKit.

## 6. Scenarios A–E (UXQA-03, UXQA-04)

Detail and step tables go in `docs/qa/SCENARIOS.md` once the screens exist. Outline:

| Scenario | Steps | Assertions (UI **and** DB) | Negative cases |
| -------- | ----- | -------------------------- | -------------- |
| **A** Case switching and context restore | Open case 0001, change tab, switch to 0002 via portfolio, browser back, reload | URL is the only context; after each step the workspace shows exactly one case and it is the URL's; reload restores the same case and tab; Sentinel clean at every step | no browser storage holds a case id (`localStorage`/`sessionStorage` empty of UUIDs and refs) |
| **B** Two cases, two tabs | Tab 1 case 0001, tab 2 case 0002; update a task in tab 2 | DB: only the task's row and its audit event changed; tab 1 after reload unchanged; tab 2 shows the new status; stale update (old `row_version`) gives the generic error with a correlation id | update a task of a case the persona cannot see → same result as unknown id |
| **C** Workspace switching | For each multi-workspace persona (seed: Governance Officer Delta, GOVERNANCE + SECRETARIAT), switch through each of its memberships (Governance → Secretariat → Governance); single-membership personas see the switcher as plain text | navigation, portfolio rows and counts equal the DB visibility for (persona, workspace), as in `docs/architecture/DATA_MODEL.md` §5 and re-read from the DB (§4); switching never widens access | a switch to a workspace without a membership (Delta → Investigations) is refused by the database; the UI shows the generic error and the active workspace stays as it was; same for an expired membership (Secretary Epsilon → Secretariat) and a forged workspace code |
| **D** Search and filters (M1 basics; full in M2) | filter portfolio by stage and status, paginate, open a case, come back | filters kept in the URL; counts equal DB counts after authorisation; restricted 0009 absent for unassigned personas, also from counts | display-number URL `/cases/CDF-DEMO-2026-0009` and a random UUID give the same 404-equivalent page |
| **E** Notification in case A never appears as case B's | generate a draft in 0001, open 0002's Notifications tab and the Notification Operations Center | DB: the new notification row has 0001's `case_id`; it is listed only under 0001; preview shows only 0001's reference, stage, recipient | same idempotency key twice → one row; Sentinel clean on the preview |

**E, disclosure to the recipient** (V13-QA-009, REQ-NOTIF-011). For a WITNESS draft previewed in an Arabic and an
English template, the oracle is the policy file read directly (`lib/disclosure/policy_v13.json`, WITNESS rows, the
policy's own precedence and restrictiveness order), not `lib/disclosure`, so a projector that drifts from the policy is
caught; and for every field the app's own `decide()` (loaded through `tests/fixtures/server-module.ts`, which runs it in a child
Node process with `server-only` stubbed, so the Playwright worker's module loading is untouched) must give the same outcome, so a drift on either side names the field. Every field the policy withholds (today `case_number`, `card_content`, `preheader`, `subject_detail`,
`delivery_status`) must leave no marker in the frame's document, its text, its accessible names (ARIA snapshot), the
frame's title, or the frame document inside any document or RSC payload; field names and the projector's log never
appear in a payload at all. The GENERALIZED `classification_marking` shows the class-safe wording only. Control: the
allowed fields are rendered. A withheld field without browser markers in the test fails it. Mutation checks: the
loader writing the case number into the frame, and the policy no longer generalizing the classification, both fail
the test; making `case_number` or `delivery_status` ALLOWED in the policy is clamped by the projector's WITNESS
scenario ceiling (defence in depth), so nothing changes in the browser. The bodies are read in the test through
`page.route` and `route.fetch()` and handed on to the page unchanged (V13-QA-012). Reading them from the browser
afterwards (`response.text()`) missed the click's RSC payload: the router aborts its RSC fetch once it has consumed the
payload, Chromium keeps no body for an aborted request, and the unread body passed every negative check as an empty
string (SEC INFO 1 on #114). A body the test cannot fetch is now recorded and fails the test, and the click's payload
and the reload's document must each carry the frame's document. Mutations: dropping the RSC bodies fails the click
check; an RSC body that cannot be fetched fails the unread check. The plain-text version (V13-FE-011), opened as the
page shows it, withholds the same fields: no withheld-field marker or field name and not the notice's own marking; the
class-safe wording, the event title, issuer, notice reference and confidentiality notice are in it (control).
Mutations: the loader appending the case number to the text, or the notice's own marking, fails the test. Database precondition (V13-QA-012): the disclosure tests need no fresh data (they
assert on their own rows by id; the whole Scenario E spec passed twice in a row against one app on one database). Like
every database-backed e2e test, they need the database to hold this app's claims key (ADR-014): an app started with a
new session secret on a database holding the previous run's key refuses every request (`CLAIMS_KEY_MISMATCH`), and the
first step times out at the draft form's template select. Run `pnpm db:reset` before each local run that starts a new
app (`playwright.config.ts`); CI resets in the e2e job.

## 7. Case Context Sentinel (QG-02, Gate B)

Library `tests/sentinel/sentinel.ts`. Where each rule runs today (ARCH and SEC review of #84; the design aim is every
navigation of every scenario, which C and E do not meet yet):

| Rules | Runs in |
| ----- | ------- |
| S1–S8 (page) | `tests/e2e/scenario-a-case-switching.spec.ts`, `scenario-b-two-cases-two-tabs.spec.ts` and `scenario-d-search-filters.spec.ts` (through `expectCaseShown` in `tests/fixtures/scenario.ts`, and directly in A and D), `negative-personas-pinning.spec.ts`, SEC's `tests/security/e2e/case-pages.spec.ts`; proven by `tests/sentinel/planted-leak.spec.ts` |
| P1–P2 (responses) | `scenario-a-case-switching.spec.ts`, `scenario-d-search-filters.spec.ts`, `negative-personas-pinning.spec.ts`; proven by `planted-leak.spec.ts` |
| P3–P4 (requests) | `tests/sentinel/request-leak-app.spec.ts` only; proven by `tests/sentinel/planted-request-leak.spec.ts` |
| D1–D4 (database) | `tests/sentinel/db.spec.ts` (five persona/workspace pairs, planted faults); read functions in `tests/sentinel/db-functions.spec.ts` |

Scenarios C (`scenario-c-workspace-switch.spec.ts`) and E (`scenario-e-notification-draft.spec.ts`) do not call the
Sentinel yet; C's switch and E's draft post are covered for P3–P4 by `request-leak-app.spec.ts`.

- **UI layer.** Walks the DOM (including open dialogs and the preview frame): the rule of §5.1, plus every count on
  screen equals the database count for the persona and workspace, plus every `data-case-id` on the page is a case the
  persona may see (from §4).
- **API layer.** Records every BFF response (`page.on('response')` for `/api/**` and Server Action/RSC payloads) and
  scans the JSON/flight text for case UUIDs and `CDF-DEMO-2026-NNNN` references; every one found must be a case in
  context or, on list pages, a case the persona may see. Restricted case 0009's UUID and reference must never appear
  for an unassigned persona — not in HTML, not in RSC payloads, not in headers.
- **Outbound requests** (V13-QA-007, OI-048; REQ-QA-013 "data submitted for the wrong case"). `recordRequests` records
  every same-origin POST, PUT, PATCH and DELETE the page sends, with the URL of the page that sent it, and names its
  kind: `server-action` (a `Next-Action` header), `form-post` (a plain form submission) or `fetch` (fetch, XHR,
  beacon). GET requests carry no body; what they bring back is P1's. **P3**: its URL and body (also percent-decoded, so Arabic-Indic digits in a form post are matched)
  name no case id or reference but that page's own case; off a case page, none unless the test allows it. P3 matches
  case ids and `CDF-DEMO-YYYY-NNNN` references only, not child ids (task, notification, event ids): a post carrying
  another case's task id passes P3. No M1 case-page post carries a child id; the server's command checks own that. **P4**: a
  body that was not handed over is never a pass. Playwright hands over every body Chromium sends (2 MB measured) and
  none for an empty one, so a request without a body is scanned by its URL alone, except a multipart request, which
  always has a body and is P4 without one. `planted-request-leak.spec.ts` plants (p)–(u) on fixture pages;
  `request-leak-app.spec.ts` checks Secretary Alpha's draft (Server Action, the same-case control: recorded, read,
  judged against its case, clean) and locale posts on the real app and
  catches a draft form tampered to name hidden case 0002 (the server refuses it with the generic state).
- **DB layer (with SEC).** As `cdf_v13_user` with each persona's claims: every case-keyed table returns only rows of
  visible cases; no row of a task/notification/event has a `case_id` that disagrees with its parent; SEC owns the
  adversarial half (forged claims, bypass attempts), QA owns the "everything visible is consistent" half.
  Built (V13-QA-003/004): `tests/fixtures/db-snapshot.ts` reads one persona's view in a single repeatable-read
  transaction; `tests/sentinel/db-sentinel.ts` rules **D1** (a readable row of any case-keyed table, found in the
  catalogue, belongs to a hidden case), **D2** (a child row readable while its parent is not), **D3** (a child's case
  differs from its parent's), **D4** (V13-QA-007, OI-048: a notification's `recipient_persona_id` is not on that
  case's team, i.e. no `case_assignment` of the same case, any capacity, whose window holds the notification's
  `created_at`; the detail says when the persona is on another case's team instead); `tests/sentinel/db.spec.ts` runs them for the five persona/workspace pairs pinned to
  DATA_MODEL §5 and plants each fault into a copy of a real snapshot.
  `tests/sentinel/db-functions.spec.ts` checks the read functions the pages use (`can_access_case`, `case_header`,
  `case_events`, `case_tasks`, `case_notifications`, `portfolio_page`/`_count`, `my_work_tasks`,
  `notifications_page`/`_count`) for every pair and every seeded case: nothing for a hidden case, only that case's
  rows (equal to the table reads) for a visible one. Epsilon and Zeta read nothing in any workspace.
- **Planted-leak self-test** (acceptance). `planted-leak.spec.ts` serves a real case page and injects, through
  `page.route` on the HTML/RSC response, (a) a second `data-case-id` inside the case workspace, (b) another case's
  reference in text, (c) restricted 0009's UUID in an RSC payload. Each plant is asserted to make the Sentinel report
  a violation (`expect(() => sentinel.check(page)).rejects…`). The plants never touch application code or the
  database. The CI job fails if any plant is not detected.

### 7.1 Defect triage: cross-case leaks (REQ-CASE-014, THREAT_MODEL TM-I1)

Any cross-case data leak is a **CRITICAL** defect that **blocks merge and release**: a case's id, display number, row
or content shown, returned, counted or readable in the context of another case, or for a persona or workspace that may
not see that case. No severity downgrade, waiver or `test.fail()` pin applies to a leak; it is fixed before the PR
merges and before any release. It is detected by:

- the Case Context Sentinel on pages, responses and requests (`tests/sentinel/sentinel.ts`, rules S1–S8, P1–P4), in
  the specs the table in §7 names (Scenarios A, B and D, the negative-persona pins, `request-leak-app.spec.ts`),
  proven by `tests/sentinel/planted-leak.spec.ts` and `tests/sentinel/planted-request-leak.spec.ts`;
- the Sentinel's database half (`tests/sentinel/db.spec.ts`, D1–D4, five persona/workspace pairs);
- the negative-persona pins (`tests/e2e/negative-personas-pinning.spec.ts`: Epsilon and Zeta see nothing);
- SEC's isolation suites: `tests/security/db/case-matrix.spec.ts` (SEC-DB-18, every case-keyed table),
  `tests/security/e2e/case-pages.spec.ts` (case pages and Server Actions),
  `tests/security/e2e/notification-center.spec.ts` (the Notification Center) and `tests/security/e2e/surface.spec.ts`
  (what reaches the client).

The rule is enforced, not only written (V13-QA-008, REQ-CASE-014): `tests/sentinel/leak-suite-guard.spec.ts` (library
`tests/critic/leak-suite-guard.ts`) reads the source of every suite above and of Scenarios A–E and fails the e2e job on
**G1** a pin (`test.fail`, `test.fails`, `test.fixme`, `.todo`, `testInfo.fail/fixme`), **G2** a focus (`.only`,
`fit`, `fdescribe`), **G3** a skip (`.skip`, `.skipIf`, `.runIf`, `test.step.skip`, `xit`/`xdescribe`, `testInfo.skip`;
Vitest's `suite` alias counts as `describe` throughout) that is not on
its allow-list, **G4** a named suite that is missing or an allow-list entry that matches nothing, and **G5** the
runner reached any other way than a plain dotted chain or call: an alias (`const t = test`, destructuring, an
argument), a renamed, namespace or default import, an import of `test`/`it`/`describe`/`suite` from anywhere but
`@playwright/test` or `vitest`, a redeclaration, element access (`test["fail"]`), `?.`, `!` or parentheses; a pin,
focus or skip method called on anything else (`const info = test.info(); info.fail()`, a renamed `testInfo`); and a
`retry`/`retries` option (however its key is written), so neither runner can turn an intermittent leak green; and
**G6** the runners' options-object and annotation forms: an object property `skip`, `only`, `todo` or `fails` (Vitest's
`it(name, { skip: true }, …)` and the like skip, focus or pin), and a property `type` whose value is `"skip"`,
`"fixme"` or `"fail"` (Playwright's `{ annotation: { type: "skip" } }` skips, `"fixme"` skips, `"fail"` inverts),
however the key is written. The allow-list holds only conditional
skips, each with its reason: the session-secret skips in `negative-personas-pinning.spec.ts` and Scenario C (they apply
only against an external `V13_E2E_BASE_URL`), SEC's `describe.skipIf(!present)` in `case-matrix.spec.ts` (since
V13-SEC-010/011 a database that is not ready fails, not skips, in CI), and SEC's local-build skips in
`surface.spec.ts`. An unconditional skip can never be allow-listed. G1–G3 match the source after the TypeScript parser
has tokenised it and comments and string, template and regular-expression literals are blanked, so a quote inside a
regular expression cannot hide the rest of a file; G5 and G6 work on the syntax tree. Every form is planted into a synthetic
source in the same spec, and a `test.fixme()` is planted inside every test and describe body of every guarded suite
(156 bodies) and must be found at its line. The same spec pins that the worker has the session secret whenever no
external `V13_E2E_BASE_URL` is set, so the allow-listed skips cannot fire in a locally started or CI run, and that CI
runs with `failOnFlakyTests`: with `retries: 1`, a leak that fails once and passes on its retry fails the job instead
of passing as "flaky". Adding a skip to a leak suite therefore needs a reviewed change to the allow-list. Limit: the
scan is per file, so a helper defined in another file that pins or skips is out of its reach; review covers that.

## 8. Procedural Truth Inspector (QG-04, Gate I — M1 scope)

Library `tests/truth/inspector.ts`.

- Collects every element with `data-epistemic` on case workspace, My Work and notification screens.
- For `recorded`: loads the event by `data-event-id` as `cdf_v13_user`; fails if missing, if it belongs to another
  case, if its recorded time is in the future, or if the PROC-001 fold of the case's events does not yield the shown
  `data-status`. Fails if a "completed"-class status is shown with any epistemic other than `recorded`.
- For `expected`/`conditional`/`awaiting_approval`: fails if the element's accessible text is the same as a recorded
  element of the same status (they must be distinguishable without colour).
- **Database half** (`tests/truth/db-truth.ts`, `tests/truth/db.spec.ts`): in each persona's snapshot, **U1** a
  task's status equals the fold of its TASK_STATUS_CHANGED events from OPEN (each step starts where the last ended),
  **U2** no event is recorded in the future or occurred after it was recorded, **U3** one CASE_OPENED per case and
  CLOSED ⇔ CASE_CLOSED, **U4** every notification starts with DRAFT_CREATED. Planted-fault self-test as above.
- **Notification preview frames** (ARCH ruling, 31 Oct): inside a preview frame T1 and T8 do not apply; **T9** every
  `data-epistemic` there is one of the renderer's values, `DATA_EPISTEMIC_VALUES` imported from
  `lib/notifications/data-epistemic.ts` (V13-PROC-011), never copied. A status badge planted in a frame still gets
  T2–T6; an unreadable frame stays T7; outside a frame nothing changes.
- **Planted-badge self-test** (acceptance). `planted-badge.spec.ts` injects (via `page.route`) a StatusBadge marked
  `data-epistemic="recorded"` `data-status="COMPLETED"` with (a) no `data-event-id`, (b) a random UUID, (c) the id of a
  real event of another case. Each must make the Inspector fail.

## 9. Staging verification (UXQA-16, Gate J, V13-QA-006)

The staging preview sits behind Vercel Authentication and the sandbox cannot open `*.vercel.app` in a browser
(OI-008). Plan, in order of preference:

1. **HTTP smoke now** through the Vercel connector's authenticated fetch: `/api/health`, `/api/health/isolation`,
   sign-in page, portfolio for one persona (status codes, no stack trace or SQL text, synthetic banner present,
   deployment id and commit recorded). Reported as "HTTP smoke", not as a browser test.
2. **Full Playwright `staging` project** from GitHub Actions with a Vercel protection-bypass secret held only as a
   GitHub secret — needs the owner's approval of that protection setting (ARCH raises it; QA does not).
3. Fallback: the owner's own browser, guided step by step.

Results go to `docs/DEPLOYMENT_STATUS.md` (via ARCH) with deployment id, commit, project and real counts.

## 10. Accessibility, RTL, responsive, screenshot library (V13-QA-005)

- **axe** (`@axe-core/playwright`, tags `wcag2a wcag2aa wcag21aa`) on the five screens in `desktop-ar`, `desktop-en`
  and `mobile-ar`: 0 serious/critical. Every violation is listed with rule, node and screen, never suppressed globally.
- **Keyboard**: Tab order reaches the switcher, navigation, table rows and primary actions; focus is visible; dialogs
  trap and return focus; Escape closes.
- **RTL**: `html[dir=rtl][lang=ar]`; logical layout — start-side elements have the larger x in RTL; no element
  overflows the viewport on either side (bounding-rect check, since RTL start overflow is invisible to `scrollWidth`);
  icons with direction mirror; case numbers and dates render as the i18n layer formats them; long Arabic titles
  truncate with an accessible full name.
- **Responsive**: 360, 768, 1280, 1920 px; no horizontal scroll; navigation reachable on mobile.
- **Text resize, reflow, text spacing** (V13-QA-010; REQ-A11Y-010; WCAG 1.4.4, 1.4.10, 1.4.12;
  `tests/a11y/reflow.a11y.spec.ts`): the six checks of `docs/design/reviews/UX009_TEXT_RESIZE_REFLOW.md` §4 in ar and
  en on Portfolio, My Work, the four Case Workspace tabs, the Operations Center and Workspaces, at 640 × 450 (200%),
  320 × 256 (400%), and 1280 × 900 and 320 × 256 with the 1.4.12 spacing stylesheet: (1) no page-level inline scroll
  and no element outside a scroll region past either edge (the box check also catches RTL start overflow, which
  `scrollWidth` cannot see); (2) every `nav-*` and `case-tab-*` link inside the viewport at 320 px; (3) no clipped
  text outside scroll regions; (4) every inline scroller a named, focusable `region`; (5) the focused skip link inside
  the viewport; (6) the open switcher menu inside the viewport, closed by Escape. Each of checks 1–4 is planted into a
  real page first; reverting UX-009's R-01 makes checks 2 and 4 fail. A marked scroll region is measured itself (a
  region that lost its role, name or tabindex fails check 4, planted); only the content inside it is exempt. Limit:
  check 3 sees text cut off by `overflow: hidden` or `clip`, not text that overlaps other text or spills out of a box
  with `overflow: visible`; those are left to the screenshot review.
- **Screenshot library (UXQA-05)**: the five M1 screens × {desktop, tablet, mobile} × {ar, en} × the states the
  screens actually support (data, empty, error, restricted, loading only where it can be captured deterministically).
  Files under `test-results/library/` with an index in `docs/qa/SCREENSHOT_LIBRARY.md`; states that do not exist are
  listed as "not applicable", never staged.

## 11. Evidence and reporting

Every run writes `test-results/results.json`; QA records command, commit, project and real pass/fail/flaky counts in
`docs/teams/qa/STATUS.md` and sends them to ARCH for `docs/TEST_EVIDENCE.md`. Screenshots contain only synthetic data.

## 12. Open points for ARCH

1. Branch naming: QA uses the board convention (`docs/V13-QA-001-test-architecture`), not the generic session branch
   `claude/project-thread-yds8m3`, which several team threads may share and which was already deleted on the remote.
2. Approve the attribute contracts in §5.1 and §5.2 and pass them to FE, UX and PROC.
3. The devDependencies, scripts and CI job in §5.4.
4. The staging route in §9 option 2 (owner decision on a protection bypass).
