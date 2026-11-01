# SEC status — CDF V13 Enterprise (synthetic data only)

Updated: 1 Nov 2026 · Branch: `security/V13-SEC-013-export-isolation` · `develop` now at `b396062`

## Completed
- Reviews: PR #5 (E02) ACCEPT `588021d`; PR #3 (PROC plan) CHANGES `1c9d826`; PR #6 (ARCH-001) ACCEPT `5c53ec4`
- V13-SEC-001 — threat model (`docs/security/THREAT_MODEL.md`) and authorisation matrix with the planned test
  catalogue (`docs/security/AUTHORIZATION_MATRIX.md`): 8 subjects × 4 case variants, 17 read objects, 7 command rows,
  16 application surfaces; 30 planned database tests (SEC-DB-01..30), 18 planned application tests (SEC-APP-01..18);
  4 recommendations SEC-REC-01..04 (all ACCEPTED, ADR-014); ruling D6 — IN_REVIEW (reviewer: DB); DB CHANGES b1786c0 (11 doc points) addressed against develop 0000–0009
- V13-SEC-003 — application adversarial tests (sessions, static boundaries, Server Actions, surface) — COMPLETE,
  merged #11 (`0f22e04`)
- V13-SEC-002 — database adversarial suites (`tests/security/db/`: context forgery with a coverage guard over every
  executable function, persona × workspace oracle, commands, catalogue hardening; `docs/security/DB_ADVERSARIAL_TESTS.md`)
  — COMPLETE, merged #29 (`50850a4`), DB ACCEPT + ARCH merge, CI run 41231449891 green
- V13-SEC-004 — hosted post-apply checks (`database/hosted/post_apply_checks.sql`, P00–P09 + VERDICT, read-only,
  rolled back; `tests/security/db/post-apply-checks.spec.ts` with 17 planted faults + hosted-simulation block) — COMPLETE,
  merged #30 (`a6c224a`), DB ACCEPT + ARCH ACCEPT `9f1e8bd`, CI run 41232084126 green; ARCH's hosted-like re-run PASS
  (7 planted faults each FAIL on the right check). ARCH runs it on hosted after each migration with isolation_checks.sql
- Reviews since: #24 PROC-002 ACCEPT `2aed44d`; #26 DB-006 ACCEPT `3f2108a`; #28 DB-009 ACCEPT `125b1f0`;
  #31 DB-010 ACCEPT `3bd1c93`; #32 FE-005 ACCEPT `018b46e`; #36 ARCH e2e database URL CHANGES (`?database=` override
  bypassed the loopback guard, proved by probe; fixed `b7f3705`) then ACCEPT; #39 authority check ACCEPT (OI-033, four
  LOWs); #40 disclosure project ACCEPT (OI-035, two LOWs); #42 DB-011 ACCEPT `3e78d52`; #44 DB-012 ACCEPT (INFO: also
  assert the trailer after the marker); #27 re-confirm ACCEPT `6e62848`; #23 ACCEPT `d439d59`; #46 DB-013 ACCEPT
  `0d9bbec`; #45 PROC-005 CHANGES `8384efe` (lifecycle projection port defaults to null, so a hand-made projected
  model passes the VALIDATED gate; OI-035 (1) still open)
- V13-SEC-005 — follow-ups: P08 detail ordered; e2e surface spec scans the bundle, HTML/flight data and health body for
  the session secret value and the app database password value (asserted by label, value never printed) — COMPLETE,
  merged #41 (`3b43530`), DB ACCEPT + ARCH ACCEPT `7529200`, CI run 41237017779 7/7; combined tree unit 1021,
  test:db 358, e2e 95

- V13-SEC-006 — case pages suite (`tests/security/e2e/case-pages.spec.ts`: SEC-APP-01 hidden, unknown, malformed,
  invalid-UTF-8 and upper-case ids on every tab for all four personas; SEC-APP-02 portfolio search by number;
  SEC-APP-09 GET with forged workspace parameters; SEC-APP-11 forged switch fields) — COMPLETE, merged #49 (`2f25577`);
  finding SEC-F-006-1 (OI-040) RESOLVED by ARCH-010 #59 (`b675e38`)
- Reviews 31 Oct (afternoon and evening): #32 ACCEPT `29106d7`; #45 ACCEPT `48db0c4` (after CHANGES `8384efe`,
  `59d420c`); #47 DB-014 ACCEPT `8c6f4f4` (after CHANGES `5c83f5c`); #48 PROC-007 ACCEPT `8f3c3fa`; #52 DB-015 ACCEPT
  `fcd2db3` (after CHANGES `0bb7f09`, half cursor); #51 FE-006 part 1 ACCEPT `661b7e7`, re-confirmed `74176da` (after
  CHANGES `150d54a`, `d13479d`); #54 UX-006 ACCEPT `8292db2` (sandbox/CSP part); #55 PROC-008 ACCEPT `8b32602`;
  #56 DB-016 ACCEPT `54e1925` (LOW → OI-041); #57 ACCEPT `cf19670`; #59 ARCH-010 ACCEPT `3799d20`; #60 ACCEPT
  `8604208`; #62 DB-017 ACCEPT `2fe462d` (OI-041 RESOLVED); #50 UX-005 SEC-APP-11 hunk ACCEPT `77d1268`; #61 FE-006
  part 2 ACCEPT `dd9aa9c`, re-confirmed `7a729bc`; #65 ARCH-002 ACCEPT `a99454c`; #64 PROC-010 CHANGES `d16bbac`
  (SEC-F-064-1 MEDIUM: ledger written under the read-only base through a linked ancestor; reproduced on a scratch
  fixture) then ACCEPT `30f325a`; #67 PROC-011 ACCEPT `9c37ecd`
- V13-SEC-007 — matrix and surface follow-ups: `—` in the `api_install_claims_key` row; a reads row for
  `notifications_page` / `notifications_count` (0010); the SEC-APP-18 row given its own columns; an undecodable-path
  surface row; `surface.spec.ts` ROUTES add `/notifications`, a hidden case and two undecodable paths (headers once,
  no-store with a session); APP_ADVERSARIAL_TESTS records SEC-APP-17 as covered by FE's Center e2e and the draft action;
  after #61, `tests/security/e2e/notification-center.spec.ts` (Alpha and Delta: rows name visible cases only, hidden
  numbers answer like unknown ones, 11 forged cursors, forged trails and odd parameters refused with a reference) —
  COMPLETE, merged #70 (`fddbff8`), DB ACCEPT `06d7043`, re-confirmed `84c9fd8`
- V13-SEC-008 — repository scans: SEC-APP-19 credential shapes in every tracked file (REQ-SEC-002), SEC-APP-20
  personal-data shapes in seeds, fixtures and test inputs (REQ-GOV-001); findings report rule, file and line only —
  COMPLETE, merged #72 (`afa6684`), DB ACCEPT `0082185`, CI 41249715821
- Reviews 31 Oct–1 Nov (night): #71 PROC-012 ACCEPT `94fefc3` (33/33 rows); #74 FE-006 part 3 ACCEPT `982bd76`,
  re-confirmed `aa61079`, `e8829ce`; #75 ARCH-002 + E01 ACCEPT `b8f47ab`; #77 ARCH-011 ACCEPT `749dc43`; #79 ARCH-002
  ACCEPT `7ed5caf`; #80 PROC-013 CHANGES `2fde455` (REQ-QA-013 claimed COMPLETE without a recipient check or an
  outbound-request check → OI-048) then ACCEPT `59e7613`; #83 ARCH-002 ACCEPT `0ad54ba`; #84 QA-007 CHANGES `7381c0f`
  then ACCEPT `570d984`; #86 PROC-014 ACCEPT `77db3d4`, re-confirmed `0a4bb27`; #81 FE-008 CHANGES `466ea5d` (the
  membership `valid_to` predicate survived deletion, shown by mutation) then ACCEPT `5dbe293`; #82 FE-009 CHANGES
  `61d2853` (no negative test that a withheld event title stays out of the frame name)
- V13-SEC-009 — the personal-data scan (SEC-APP-20) also covers `database/migrations/` and `database/hosted/` (DB's
  suggestion on #72), with a scope test that fails if either entry is dropped — COMPLETE, merged #87 (`25a1c48`)
- Reviews 1 Nov: #88 QA-008 CHANGES (the leak-suite guard misses a pin after a regex literal, bracket access, aliases,
  a renamed import and `describe.configure({ retries })`, shown by probe); #89 PROC ACCEPT (INFO: REQ-SEC-020 Evidence
  cell contradicts itself)
- V13-SEC-010 — database-security suites fail in CI when the database is not ready (SEC-APP-21; ARCH's suggestion on
  #88): `tests/security/db/readiness.ts`, `databaseReady()` in `support.ts` — COMPLETE, merged #91 (`b22f153`), DB
  ACCEPT `8bf777c`, CI 41261731296
- Reviews 1 Nov (cont.): #82 FE-009 ACCEPT `45301ea` (three mutations each fail tests); #88 QA-008 CHANGES `bf063a9`
  (bracket access, `?.`, `!.`, parentheses, aliases, renamed imports and a Vitest per-suite retry still pass the guard)
- V13-SEC-011 — `V13_DB_TESTS_REQUIRED=1` and `GITHUB_ACTIONS=true` also require the database (DB's suggestion on #91),
  so `CI=false` alone cannot turn SEC-010 off — COMPLETE, merged #92 (`7f14f33`), DB ACCEPT `38ecdef`, CI 41262513652
- Reviews 1 Nov (early morning): #82 FE-009 ACCEPT re-confirmed `0c5c0ba`, `830c26d`; #88 QA-008 CHANGES `bf063a9` then
  ACCEPT `488d93d` (superseded by ARCH's CHANGES on runner option forms) and ACCEPT `e2000b9` (28 planted forms);
  #93 ARCH-002 ACCEPT `dd625a5`; #94 PROC-016 ACCEPT `0ce06d6`; #95 PROC-018 ACCEPT `81f82d3` (JI-03 pin mutation-checked;
  LOW: an event with no `case_id` passed) then ACCEPT `93a489e` (JI-07); #99 PROC-017 ACCEPT `7f14954`, `a847241`,
  `8dd4e4b` (REQ-JRN-007 COMPLETE checked on QG-02)
- V13-SEC-012 — SEC-APP-13's bundle scan fails, not skips, when `.next/static` is missing and any `requiredBy()` signal
  is set (QA's and ARCH's follow-up on #88); SEC-APP-22 — COMPLETE, merged #103 (`4bf455d`)
- Reviews 1 Nov (morning): #95 PROC-018 ACCEPT `93a489e`; #101 DB-018 ACCEPT `c6f83cb`, `434c1c7`; #102 PROC-019 ACCEPT
  `82b1467`; #105 ARCH-002 ACCEPT `d801f86`
- V13-SEC-013 — export isolation (REQ-SEC-020, "export" clause), SEC-APP-23, reviewer PROC — IN_REVIEW. Two findings
  reported to ARCH, not pinned: the export does not bind `rendered` to the validated model, and it does not strip bidi
  or zero-width characters from caller-supplied subject and text

## Changed files
- `docs/security/THREAT_MODEL.md`, `docs/security/AUTHORIZATION_MATRIX.md`, `docs/security/APP_ADVERSARIAL_TESTS.md`,
  `tests/security/e2e/case-pages.spec.ts`, `tests/security/e2e/surface.spec.ts`, `docs/teams/sec/STATUS.md`

## Test evidence
| Command | Result | Counts | Commit |
| ------- | ------ | ------ | ------ |
| Local PostgreSQL 16.x, `0000_bootstrap.sql` applied, then as `cdf_v13_user` inside one transaction: `select set_config('request.v13.claims', '{"persona_id":"FORGED"}', true)` | **succeeds**, `current_user = cdf_v13_user` — confirms TM-S4: the request role can rewrite its own claims, so the claims are only as trustworthy as the SQL the BFF sends | 1 probe | `b02e672` |
| Local, ARCH-001 head `5c53ec4`: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, then manual probes against `next start` (synthetic secret, no DB) | lint 0, typecheck 0, unit **251 passed / 17 files**, build ok; signOut action by id: runs via `/my-work` with cookie, refused cross-origin (500, digest only), **not run** via public `/sign-in` without cookie; health has resource CSP + no-store | 251 + 8 probes | `5c53ec4` |

| Local, #32 head `018b46e` merged with `develop` `a6c224a` (throwaway branch): `pnpm db:reset`, `pnpm typecheck`, `pnpm test`, `pnpm test:db` | typecheck 0, unit **909/909**, test:db **377/377** (includes SEC-002 suites and post-apply checks) | 909 + 377 | `018b46e` + `a6c224a` |
| Local, #41 head `7529200`: `pnpm db:reset`, `pnpm test:e2e`; post-apply spec | e2e **93/93**, post-apply spec **27/27** | 93 + 27 | `7529200` |
| Local, V13-SEC-009 on `develop` `eee17f7`: `pnpm lint`, `pnpm typecheck`, `vitest --project unit tests/security/app`; mutation: the `database/hosted` scope entry removed | lint 0, typecheck 0, **75/75**; with the entry removed 2 tests fail | 75 | SEC-009 head |
| Local, V13-SEC-010 on `develop` `25a1c48`: `pnpm lint`, `pnpm typecheck`, `pnpm test`; `CI=true vitest --project integration tests/security/db` with the DB up; then the DB stopped: `CI=true` and `CI` unset on `case-matrix` | lint 0, typecheck 0, **3/3** (full unit **1987/1987**, 78 files); DB up **101/101** (5 files); DB stopped + `CI=true`: the file **fails** with `[security/db] case-matrix: the local cluster does not answer …`; DB stopped + `CI` unset: 18 skipped with a warning | 3 + 101 | SEC-010 head |
| Local, V13-SEC-011 on `develop` `b22f153`: `pnpm lint`, `pnpm typecheck`, `pnpm test`; each of the three signals deleted in turn; the DB stopped with `CI=false V13_DB_TESTS_REQUIRED=1` and with all three unset on `case-matrix`; `CI=true` security DB suites after `pnpm db:reset` | unit **1989/1989**, SEC-APP-21 **5/5**; each deleted signal fails 2 tests; DB stopped: the file **fails** with `CI=false V13_DB_TESTS_REQUIRED=1`, 18 skipped with none set; DB up **101/101** | 5 + 101 | SEC-011 head |
| Local, V13-SEC-012 on `develop` `a0bf765`: `pnpm lint`, `pnpm typecheck`, `pnpm test`; the `requireBuildWhenSignalled` call removed from `surface.spec.ts`; the leak-suite guard over the 15 suites; `CI=true` Playwright `tests/security/e2e/surface.spec.ts` after `pnpm db:reset` | lint 0, typecheck 0, unit **2026/2026** (SEC-APP-22 4/4); with the call removed 1 test fails; guard `[]`; surface **12/12**, the bundle scan ran (not skipped). A first surface run with the local DB stopped had 1 flaky sign-in test; re-run with the DB up 12/12 | 4 + 12 | SEC-012 head |
| Local, V13-SEC-013 on `develop` `b396062`: `pnpm lint`, `pnpm typecheck`, `pnpm test`; eleven mutations of `lib/notifications` / `lib/disclosure`, one at a time, then restored | lint 0, typecheck 0, unit **2032/2032** (82 files; SEC-APP-23 6/6); every mutation fails at least one SEC-APP-23 test (model-hash check, export projection gate, revision check, unknown-version fallback, render suppression, renderer bidi strip, `X-Unsent`, an added `To:`, projection keeping a withheld field, renderer showing withheld fields, SECURITY denial not written) | 6 | SEC-013 head |

## Unresolved defects
- TM-S4 / OI-018: claims MAC (ADR-014 §4) built by DB and pinned by SEC-002 context-forgery suite.
- SEC-INFO-3 (LOW, residual risk ACCEPTED by ARCH, OPEN_ISSUES): PUBLIC holds TEMP on the database, so the request
  role can create temp tables; pinned by catalog-hardening so a change is visible.
- OI-033 (four LOWs, authority `check()` binding) and OI-035 (1) (disclosure context from server records) open.
- INFO on #32: `?ref=`/`?stale=` echo any well-formed UUID as a reference (no disclosure).

## Dependencies and requests
- ARCH: SEC-REC-01..04 accepted (ADR-014); SEC-REC-04 checked by ARCH in ARCH-003. SEC reviews ARCH-001
  (`lib/auth/session.ts`, `lib/db/security-context.ts`, `proxy.ts`, `app/api/health/**`, CI workflow).
- DB: confirm or correct THREAT_MODEL §6 assumptions 2–4 in DB-001/002; visibility matrix in DATA_MODEL §5.
- FE/UX: ruling D6 (investigators: case Notifications tab only, no Notification Operations Center in M1) — built and
  tested in #61.
- FE: the preview frame (FE-006 part 3) — SEC reviews `sandbox=""`, no CSP violation, a planted script never runs,
  one case record for model and projection.
- PROC: V13-PROC-012 security-control rows (QG-02, QG-03, QG-05, SEC-owned) — SEC checks citations before COMPLETE.
