# SEC status — CDF V13 Enterprise (synthetic data only)

Updated: 31 Oct 2026 22:45 UTC · Branch: `docs/V13-SEC-007-matrix-surface` · `develop` now at `4cc72ec`

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
  no-store with a session); APP_ADVERSARIAL_TESTS records SEC-APP-17 as covered by FE's Center e2e and the draft action
  — IN_REVIEW

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
