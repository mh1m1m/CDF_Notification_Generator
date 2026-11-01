# Application adversarial tests (V13-SEC-003)

**Classification: SYNTHETIC-DATA REFERENCE IMPLEMENTATION.** Not CDF production. Owner: SEC. Test ids refer to the
catalogue in `docs/security/AUTHORIZATION_MATRIX.md` §6 and the threats in `docs/security/THREAT_MODEL.md`
(both delivered by PR #2, V13-SEC-001).

## Suites

| File                                          | Runner           | Catalogue ids                          | Threats                    |
| --------------------------------------------- | ---------------- | -------------------------------------- | -------------------------- |
| `tests/security/app/session-forgery.spec.ts`  | Vitest `unit`    | SEC-APP-03, -04, -06                   | TM-S1, TM-S2               |
| `tests/security/app/static-boundaries.spec.ts` | Vitest `unit`    | SEC-APP-12, -13 (static), -18 (static) | TM-S4, TM-T4, TM-I8, TM-E5 |
| `tests/security/e2e/server-actions.spec.ts`   | Playwright       | SEC-APP-07, -10 (actions), -18         | TM-E5, TM-S3, TM-I10       |
| `tests/security/e2e/surface.spec.ts`          | Playwright       | SEC-APP-08, -10, -13, -14, -15         | TM-I8, TM-I10, TM-I11, TM-I13 |
| `tests/security/public-actions.ts`            | shared allow-list | SEC-APP-18                            | TM-E5                      |
| `tests/security/e2e/case-pages.spec.ts` (V13-SEC-006) | Playwright | SEC-APP-01, -02, -09 (GET), -11 | TM-I1, TM-I2, TM-I3, TM-S7, TM-T6 |
| `tests/security/app/repo-scans.spec.ts` + `tests/security/repo-scan.ts` (V13-SEC-008) | Vitest `unit` | SEC-APP-19, -20 | TM-I8 |
| `tests/security/e2e/notification-center.spec.ts` (V13-SEC-007) | Playwright | SEC-APP-02, -07, -10 on `/notifications` | TM-I3, TM-I4, TM-I10 |
| `tests/security/app/db-readiness.spec.ts` + `tests/security/db/readiness.ts` (V13-SEC-010) | Vitest `unit` | SEC-APP-21 (+ V13-SEC-011) | — (harness integrity) |
| `tests/security/app/build-readiness.spec.ts` + `tests/security/build-readiness.ts` (V13-SEC-012) | Vitest `unit` | SEC-APP-22 | — (harness integrity) |
| `tests/security/app/export-isolation.spec.ts` (V13-SEC-013) | Vitest `unit` | SEC-APP-23 (REQ-SEC-020, export) | TM-I1, TM-I5, TM-I6 |

What each suite proves:

- **Export isolation (V13-SEC-013)**: SEC-APP-23 runs the export path end to end with the real projection, the real
  renderer and the lifecycle's default projection port (not the fixture stand-ins): `buildNotificationModel()` →
  `projectForRecipient()` from server records → `renderEmail()` → lifecycle `exportEml()`. (a) Every string of every
  field the projection withholds is replaced by a unique canary, and no canary, no internal disclosure marker
  (`*_withheld`, `_disclosure`, `PROHIBITED`), no recipient address (the only address is the committed secretariat help
  mailbox) and no addressee or send header reaches the exported bytes, in Arabic and English; `X-Unsent: 1` and the
  lifecycle label are present. (b) A model projected for another case's notification is refused before any bytes
  (`MODEL_CHANGED_SINCE_VALIDATION`) with one SECURITY denial and no export event or evidence. (c) A hand-made model
  that only claims `_disclosure_applied` is refused. (d) An unknown notification, an unknown version and a stale
  snapshot are refused with no export event. (e) A restricted case whose recipient is not on the access list renders
  nothing, so nothing can be exported. (f) Bidi overrides, isolates and zero-width characters in model values never
  reach the exported bytes. Eleven mutations of `lib/notifications` and `lib/disclosure` each fail at least one test.
  Not covered: no route exports today, so there is no HTTP export surface to probe; REQ-SEC-020's browser-history and
  cached-state clauses stay open.
- **The bundle scan never skips silently in CI (V13-SEC-012)**: SEC-APP-22 pins `requireBuildWhenSignalled()`, which
  `surface.spec.ts` calls immediately before its missing-build skip in the SEC-APP-13 bundle scan: a present build
  runs the scan; a missing `.next/static` fails when any `requiredBy()` signal is set (truthy `CI`,
  `V13_DB_TESTS_REQUIRED=1`, `GITHUB_ACTIONS=true`), naming the signals; locally it returns and the allow-listed
  `test.skip` acts. A source check fails if the call is removed or moved away from the skip, whose text is unchanged
  because QA-008's allow-list matches it.
- **Database suites never skip silently in CI (V13-SEC-010)**: SEC-APP-21 pins the readiness verdict that every
  database-security suite (`case-matrix`, `catalog-hardening`, `commands`, `context-forgery`) calls through
  `databaseReady()`: ready → run; not ready with `CI` set (`true`, `1`, `yes`, any case) → the suite **fails** with the
  suite name and the reason; not ready locally (`CI` unset, empty, `0`, `false`) → skip with a warning. V13-SEC-011
  adds two more signals, each enough on its own, so `CI=false` alone cannot turn the requirement off:
  `V13_DB_TESTS_REQUIRED=1` (set on CI's test:db job) and `GITHUB_ACTIONS=true`; the error names the signals. So the
  `describe.skipIf` allowance in QA's leak-suite guard (V13-QA-008) is enforced, not only written: a CI job that loses
  its database cannot report the security suites as green.
- **Repository scans (V13-SEC-008)**: SEC-APP-19 scans every file Git tracks (`git ls-files`; binary files and
  symbolic links skipped, nothing outside the repository read) for credential shapes: private-key blocks, connection
  strings with a password, signed tokens, GitHub/AWS/Slack/provider/Google key prefixes and literal secret
  assignments (REQ-SEC-002). SEC-APP-20 runs the seven personal-data rules of the copy-time evidence scan (EVS-01)
  over the seeds, migrations, hosted scripts, fixtures, sentinel, integration, database-security and e2e specs
  (REQ-GOV-001; migrations and hosted scripts added in V13-SEC-009). A finding reports
  rule, file and line only, never the matched text. Synthetic credentials in tests, CI service containers and local
  tooling carry the marker `not-a-secret` / `not-a-real-password`; anything else needs an ALLOW entry (one file, one
  rule, a reason; unused entries fail). Planted samples are assembled at runtime from fragments in a temporary Git
  repository, so no committed file holds a credential-shaped string.
- **Notification Center (V13-SEC-007)**: for Alpha and Delta, every row names a case visible in the workspace and no
  hidden case id or number appears in the HTML; a hidden number, also padded or lower-case, answers exactly like
  CDF-DEMO-2026-0999 (no results, count 0), and fragments of it are refused as malformed; eleven forged cursors (not
  JSON, wrong version, extra or missing key, millisecond instant, SQL in the instant, bad or upper-case id, wrong type,
  `__proto__`), an over-long cursor, a forged trail, repeated parameters and impossible dates all give the generic
  invalid state with a reference and no internals; a well-formed cursor the reader could have issued still pages only
  visible cases.

- **Session forgery**: algorithm and header confusion (HS384/HS512/none/RS256, missing alg, wrong typ, `crit`,
  `b64=false`, embedded `jwk`/`jku`/`kid`), malformed segments, claim type confusion and look-alike values
  (upper-case or braced UUIDs, arrays, objects, lower-case or unknown workspace, string `exp`, float `iat`, lifetime
  over 8 h, smuggled `roles`/`workspace_id`, `__proto__`), expiry, future `iat`, `nbf`, and every non-exact value of
  `V13_PERSONA_SIGNIN`. Every forgery verifies as null.
- **Static boundaries**: only `lib/db/security-context.ts` writes `request.v13.claims`; `set_config`, `SET ROLE` and
  the postgres driver appear only in `lib/db`; no `.unsafe`, `eval` or `new Function`; no client component imports
  server-only modules; every module using postgres or a `node:` built-in starts with `import "server-only"`; no
  `NEXT_PUBLIC_` variable; `.env.example` holds names only; `"use server"` only as a file directive; every exported
  Server Action outside the allow-list calls `getCurrentSession()` itself.
- **Server Actions**: every action id in the build's manifest is posted, encoded as React encodes a form, to
  `/sign-in`, `/my-work` and `/`, with no cookie, with a cookie signed by another secret, and cross-origin
  (`https://attacker.example.test`, `null`, a look-alike host) with and without a valid session. No session-bound
  action runs without a session; no action runs cross-origin; refusals carry a digest only; unknown action ids and
  malformed bodies get fixed short answers; a failed sign-in returns only a UUID reference.
- **Surface**: on every route, signed in or not, each security header appears exactly once with one CSP and no
  framework banner; authenticated pages are `no-store`; the session cookie is host-only, HttpOnly, Secure,
  SameSite=Lax, at most 8 h; odd cookies are refused at the gate with a redirect; odd URLs (traversal, script in
  `ref`, `.env`, `.git/config`) never give a 5xx or internals; the health body has only its documented fields; no
  secret name, connection string, V13 role, schema or claims setting appears in `.next/static`, the HTML or the
  flight data, and no source map is shipped; after sign-in and a language switch, web storage, IndexedDB, Cache
  Storage and service workers are empty and the session cookie is invisible to scripts.

- **Case pages (V13-SEC-006)**: for Secretary Alpha, Investigators Beta and Gamma and Governance Officer Delta, every
  seeded case the persona may not see (DATA_MODEL §5: other workspace, restricted 0009 without assignment) answers on
  every Case Workspace tab exactly like an unknown id: 404, the same visible text, no `data-case-id`, no other case's
  id or number in the HTML, and the Case Context Sentinel finds nothing. A control proves every visible case opens.
  A display number in the case URL is an unknown id. Malformed ids (zero UUID, suffixes, NUL, quotes, traversal,
  2 000 characters, emoji) never give a 5xx or internals; an upper-case spelling of a hidden id stays hidden.
  Portfolio search by a hidden case's number (full, `2026-00NN`, `00NN`) gives the same rows, counts and text as a
  number that does not exist. GETs with forged workspace parameters never change the session. The workspace switch
  ignores forged `persona_id`, `role`, `workspace_id`, `active_workspace` and `claims` fields and a repeated
  `workspace` field: the session never belongs to another persona or reaches a non-member workspace.
  Mutation-checked: listing a visible case as hidden fails both the 404 and the search assertions.

The browser suites that read `.next` (action manifest, bundle scan) skip themselves against `V13_E2E_BASE_URL`.

## Observations (INFO, no defect)

| Id         | Observation                                                                                                     | Why it is not a defect                                                                                              | Pinned by                                  |
| ---------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| SEC-INFO-1 | A session token with trailing whitespace (`<token> `, `<token>\n`) verifies (jose 6.2.12 with Node's base64url). | Same signed claims; no key-less party can change the payload; cookie values cannot carry it.                         | `session-forgery.spec.ts` (INFO test)      |
| SEC-INFO-2 | Next.js 16 runs a Server Action whose request has **no** `Origin` header; it checks Origin only when present.   | Browsers send `Origin` on every POST, and the session cookie is SameSite=Lax, so browser-driven CSRF cannot use it. | `server-actions.spec.ts` (INFO test)       |

Either pin fails if the behaviour changes, so a change is reviewed rather than missed.

Status (ARCH, 28 Oct 2026): SEC-INFO-1 agreed as INFO. SEC-INFO-2 **ACCEPTED by ARCH**, no change to `proxy.ts`:
a cross-site request cannot carry the session (SameSite=Lax), and a client that already holds the cookie can send
any `Origin` it likes, so requiring one adds nothing. The pin test stays.

## Evidence (local, 28 Oct 2026, branch `test/V13-SEC-003-app-adversarial` on develop `f0a7220`)

Node 22.22.0, pnpm 10.28.0, Next.js 16.4.2, Chromium from `PW_CHROMIUM_PATH=/opt/pw-browsers/chromium`.

| Command                                         | Result                                          |
| ----------------------------------------------- | ----------------------------------------------- |
| `pnpm lint`                                     | exit 0                                          |
| `pnpm typecheck`                                | exit 0                                          |
| `pnpm test`                                     | 19 files, 314 tests passed (63 of them SEC-003) |
| `pnpm test:e2e`                                 | 39 passed (27 of them SEC-003)                  |
| `npx playwright test tests/security/e2e`        | 27 passed                                       |

CI on the PR is the run of record.

## Findings (V13-SEC-006)

| Id | Severity | Finding | Status |
| -- | -------- | ------- | ------ |
| SEC-F-006-1 | LOW | A case id that is not valid UTF-8 after percent-decoding (`%C0%AF`, `%FF`, `%E0%A4%A`) makes the signed-in case routes answer a bare `500 Internal Server Error` (no internals, no case data; anonymous requests are redirected to sign-in first). Other routes answer 404. Expected: the unknown-id 404. | OPEN, reported to ARCH (`proxy.ts` or the route); pinned with `test.fail()` so the fix flips the test |

## Not covered yet

- SEC-APP-05 (deactivated after sign-in) is covered by QA's `tests/e2e/negative-personas-pinning.spec.ts` (valid
  session, expired membership or inactive persona → nothing) and `scenario-c-workspace-switch.spec.ts` (switch
  re-checked by the database); SEC adds nothing there. SEC-APP-09's POST part (foreign `Origin`) is in
  `server-actions.spec.ts`. SEC-APP-11 covers the workspace switch, the only session-bound command in the build; each
  new command action gets the same probe when it lands. SEC-APP-16 is a review checklist, applied by SEC on every
  `.github/**` change: pinned action SHAs, least `permissions`, no `pull_request_target` with checkout of the head, no
  secret in a step that runs PR code, no new third-party action without a reason. SEC-APP-17 is covered by FE's `tests/e2e/notification-center.spec.ts` (#61, SEC ACCEPT `7a729bc`): for Beta and
  Gamma every URL of `/notifications` gives status 404 with the unknown route's text and title, and no navigation item.
  The first session-bound command action besides the workspace switch is the notification draft (#51,
  `app/(platform)/cases/[caseId]/notifications/actions.ts`). It reads four named form fields only (`case_id`,
  `template_version_id`, `recipient_class`, `idempotency_key`); persona and workspace come from the session, and the
  database decides access on the form's case id, which FE's integration and Scenario E tests tamper with (0002, 0005,
  0009, 0010, unknown, malformed). `server-actions.spec.ts` takes it from the build's manifest like every other action.
- Database adversarial tests are V13-SEC-002 (`tests/security/db`): see `docs/security/DB_ADVERSARIAL_TESTS.md`.
  `static-boundaries.spec.ts` also walks `instrumentation.ts` since V13-SEC-002.
