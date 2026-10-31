# Database adversarial tests (V13-SEC-002)

**Classification: SYNTHETIC-DATA REFERENCE IMPLEMENTATION.** Not CDF production. Owner: SEC. The test ids refer to
the catalogue in `docs/security/AUTHORIZATION_MATRIX.md` §6, and the threat ids to `docs/security/THREAT_MODEL.md`.
Both documents were delivered by PR #2 (V13-SEC-001).

The suites live in `tests/security/db`. They run in the Vitest `integration` project, so they are part of
`pnpm test:db` and of the CI job "Database integration tests". They run against the local cluster:
`pnpm db:local start && pnpm db:reset`.

Every suite works only on synthetic data: the seeded personas, the three workspaces, and cases
`CDF-DEMO-2026-0001` to `0010`. Everything a suite does as a persona, as the owner or as the administrator happens
inside a transaction that is rolled back. Nothing is committed, and no suite connects to a hosted database.

## Suites

| File                                             | Catalogue ids                                       | Threats                                    |
| ------------------------------------------------ | --------------------------------------------------- | ------------------------------------------ |
| `tests/security/db/context-forgery.spec.ts`      | SEC-DB-01, -02, -03, -06, -17 (guard), -29 (guard)  | TM-S4, TM-S5, TM-S6, TM-E3                 |
| `tests/security/db/case-matrix.spec.ts`          | SEC-DB-06, -18, -19, -20, -21                       | TM-I1 … TM-I5                              |
| `tests/security/db/commands.spec.ts`             | SEC-DB-08, -09, -10, -11, -14, -15, -17, -19, -25   | TM-T2, TM-T4, TM-T5, TM-T7, TM-R1, TM-R2, TM-D2 |
| `tests/security/db/catalog-hardening.spec.ts`    | SEC-DB-04, -14, -16, -23, -24, -25, -26             | TM-S4, TM-E1, TM-E2, TM-T8, TM-I9, TM-I10  |
| `tests/security/db/support.ts`                   | shared: hostile contexts, catalogue discovery, access oracle | —                                  |

### Forged contexts (`context-forgery.spec.ts`)

The suite discovers every V13 table from the catalogue. It also sweeps every function the request role may execute.

A coverage guard fails when the set of executable functions differs from the suite's registry. A new function cannot
ship without a "nobody" probe, or without an explicit reason why it has none. The guard also proves that
`_claims_hmac` and `_verified_claims` are not executable (SEC-DB-29).

There are 16 hostile contexts:
- no claims;
- empty claims, `{}`, malformed JSON, a missing key, `v: 2`, or an array, each with a valid MAC;
- no MAC, or an empty MAC;
- a MAC computed over other claims;
- a MAC replayed from another transaction;
- an unknown persona;
- the inactive persona Zeta;
- a workspace Alpha is not a member of, or an unknown workspace id;
- a valid context whose claims are rewritten inside its own transaction.

Each context must be nobody:
- every table gives zero rows or a privilege refusal (42501);
- every helper returns null, false or empty;
- every read function returns zero rows;
- every command is refused with V1401.

The two workspace contexts are an exception. Their persona is verified, so it may still read its own identity rows and
switch to a workspace it belongs to, and nothing else. A control run as Secretary Alpha proves the sweep is not
vacuous.

### Case matrix (`case-matrix.spec.ts`)

The matrix covers each of the 5 active personas in each of the 3 workspaces, 15 contexts in all, through the real
`withRequestContext`. Each result is compared with an oracle derived from the raw rows, independently of
`can_access_case`:
- `case_record` shows exactly the oracle;
- every other case-keyed table shows rows of oracle cases only;
- for any case outside the oracle, `case_header`, `case_events`, `case_tasks` and `case_notifications` answer
  exactly as they do for an unknown id;
- `portfolio_count` equals the number of `portfolio_page` rows, which equals the oracle; a display-number search
  never counts a hidden case;
- My Work lists oracle cases only;
- the restricted case 0009 is seen only by its assigned investigator (Beta), and never by Governance;
- a display number passed as an id gives the same refusal (22P02), whether the case is visible, hidden or absent.

### Commands (`commands.spec.ts`)

A coverage guard lists the `api_*` commands. Each command runs on the administrator connection. The context is set
exactly as the application sets it, the command runs as `cdf_v13_user`, and then the ledger is read in the same
transaction, which is rolled back.

- **A success** writes exactly one audit row. That row carries the verified claims' persona, workspace and
  correlation id, and the chain stays valid.
- **Refusals write no audit row and change no row.** The refusals tested are:
  - no context;
  - an unknown id;
  - another case's task;
  - the restricted case from a workspace member who is not assigned;
  - the closed case;
  - a stale or null version;
  - the wrong role;
  - a non-member workspace;
  - an unknown template version.
- **Unknown and unauthorised are identical.** Both give the same SQLSTATE and the same message.
- **Injection strings** (SQL fragments, dollar quotes, a right-to-left override, 10,000 characters, a JNDI string,
  markup, a NUL byte) in every text argument are refused as invalid input and stored nowhere.
- **Replays.** A second update with the same expected version in one transaction is stale (V1409). The same
  idempotency key by the same author is V1409.
- **Bounded lock wait.** When one session holds a task's lock, a second caller fails with `55P03` at the login's
  `lock_timeout` (3 s) instead of hanging.

### Catalogue hardening (`catalog-hardening.spec.ts`)

- **SEC-DB-14.** Every V13 function pins `search_path = ''`, and no plpgsql body runs `EXECUTE`.
- **SEC-DB-16 / -24.** The suite plants Supabase's `anon`, `authenticated` and `service_role`, plus a stand-in for the
  other application's login. Neither they, nor any other non-V13 role, nor PUBLIC hold any privilege on the V13
  schema, its relations or its functions. In practice, reads and calls fail with 42501.
- **SEC-DB-23.** The suite plants a foreign schema with a table, a view, a sequence and a PUBLIC-executable function.
  For `cdf_v13_user` and `cdf_v13_app` that schema is unreachable. Neither role can create anything in it, in
  `public`, in the V13 schema, or as a new schema.
- **SEC-DB-26.** The V13 roles' memberships are exactly the bootstrap's: the app may SET ROLE to the request role,
  and the bootstrap administrator is the only other member. Every membership is SET-only, with no INHERIT and no ADMIN.
- **SEC-DB-04.** Inside a verified context, every attempt to change identity is refused: SET ROLE,
  `set_config('role')` or SET SESSION AUTHORIZATION to the owner, `postgres`, `pg_read_all_data` or
  `pg_write_all_data`. RESET ROLE, SET ROLE NONE and SET ROLE `cdf_v13_app` leave the app login, which reads and calls
  nothing.
- **SEC-DB-25.** The app login carries a statement timeout, an idle-in-transaction timeout, a lock timeout and an
  empty `search_path`.

## Already covered by DB's integration suites (not duplicated)

| Catalogue id                     | Covered in                                                                                   |
| -------------------------------- | -------------------------------------------------------------------------------------------- |
| SEC-DB-05, -27                   | `tests/integration/identity-claims.spec.ts` (identity read policies, e-mail column hidden)   |
| SEC-DB-07, -12, -13, -30         | `tests/integration/catalog-audit.spec.ts` (RLS walk, write grants, ledger, definer allow-list) |
| SEC-DB-22                        | `tests/integration/case-access.spec.ts` (outbox unreadable, notification reads per case)      |
| SEC-DB-28                        | `tests/integration/identity-claims.spec.ts` (claims MAC, key install and protection)         |

## Observations

| Id         | Observation                                                                                                                                                                                                                                          | Why it is not a defect                                                                                                                                                                                                                                                                                                                                                                       | Pinned by                                   |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| SEC-INFO-3 | `cdf_v13_user` and `cdf_v13_app` can create temporary tables. PostgreSQL grants TEMP on the database to PUBLIC by default.                                                                                                                             | On the shared hosted project, V13 may not change database-level grants (ADR-012). Every V13 function pins `search_path = ''` and qualifies every name. Temporary tables named like `case_record`, `case_workspace_visibility`, `case_assignment`, `task` and `persona_workspace_membership`, filled to grant access, change no answer. | `catalog-hardening.spec.ts` (INFO test)     |

## Mutation checks (local, 31 Oct 2026)

Two checks show that the suites catch a regression; both were applied to the local cluster only and then rebuilt
with `pnpm db:reset`.

- **Restriction rule removed.** `can_access_case` was replaced with a version that drops the restricted-case rule.
  8 tests fail: four matrix contexts, the Governance 0009 test, two restricted-case refusals, and one
  identical-answer pair.
- **Execute and usage granted to PUBLIC.** EXECUTE on `portfolio_count` and USAGE on the V13 schema were granted to
  PUBLIC. The catalogue sweep (SEC-DB-16 / -24) fails.

## Evidence (local, 31 Oct 2026, branch `test/V13-SEC-002-db-adversarial` on develop `c4b37c3`)

Node 22.22.0, pnpm 10.28.0, PostgreSQL 16 local cluster (`pnpm db:local`).

| Command                                                        | Result                                      |
| -------------------------------------------------------------- | ------------------------------------------- |
| `npx vitest run --project integration tests/security/db`       | 4 files, 74 tests passed                    |
| `npx vitest run --project integration` (all of `pnpm test:db`) | 14 files, 282 tests passed                  |
| After merging develop 558d4ae (migration 0007): `pnpm test:db` | 15 files, 294 tests passed |

CI on the PR is the run of record.

## Not covered yet

- SEC-DB-09 under true concurrency with commits: two sessions committing the same version. The suite proves the
  version re-check inside one transaction and the bounded lock wait, but does not commit, because there is no path
  to restore seed rows without one.
- Hosted runs of these checks belong to the Chief Architect: SEC proposes post-apply checks for
  `database/hosted/isolation_checks.sql`, and only ARCH runs SQL on the hosted project.
