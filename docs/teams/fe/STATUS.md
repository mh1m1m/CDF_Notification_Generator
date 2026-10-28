# FE status — CDF V13 Enterprise (synthetic data only)

Updated: 2026-10-28 03:55 UTC · Branch: feature/V13-FE-001-bff-read-services · Head: see PR

## Completed
- Design and plan for V13-FE-001..006 — `docs/teams/fe/DESIGN.md` (rulings D6, notification detail, CSP, SEC-APP-18 recorded)
- V13-FE-001 (part 1) — `lib/authz` pre-check, `lib/server` (errors, request context, case read services, case source
  binding), `lib/adapters/case-source` (V13-records adapter, opaque cursor) — PR into `develop` — IN_REVIEW

## Changed files
- lib/authz/{actions,index}.ts
- lib/server/{errors,context,cases,case-source}.ts
- lib/adapters/case-source/{v13-records,cursor}.ts
- tests/unit/authz/precheck.spec.ts
- tests/unit/server/{cases,errors-context,v13-records-adapter}.spec.ts, tests/unit/server/support/*
- docs/teams/fe/{DESIGN,STATUS}.md

## Test evidence
| Command | Result | Counts | Commit |
| ------- | ------ | ------ | ------ |
| `pnpm lint` | pass | 0 problems | c4c7f8f |
| `pnpm typecheck` | pass | — | c4c7f8f |
| `pnpm format:check` | pass | — | c4c7f8f |
| `pnpm test` (unit) | pass | 21 files, 316 tests (65 new FE: authz 18, cases 20, errors/context 6, V13-records adapter + cursor 21) | c4c7f8f |
| Integration probe (not committed): `tests/integration/fe-case-source.spec.ts` on a local merge of this branch + `feature/V13-DB-001-m1-database-core` (b27cebb), `pnpm db:reset` then vitest integration | 3 pass, 9 fail as expected: every visible row is refused by the CaseSummary contract (no `source_system`, `source_ref`, `updated_at` from `portfolio_page`/`case_header`) | 12 tests | local |
| Same probe with the three columns filled locally by a throwaway patch (reverted, not committed) | pass: seed visibility for 8 persona/workspace pairs, 0009 only for Beta, unknown = unauthorised = null, closed readable, keyset paging, filters inside the authorised set | 12/12 | local |

## Unresolved defects
- FE-OPEN-1 (MEDIUM, blocks real case reads): contract mismatch CaseSummary vs 0002 read functions (titles in two
  languages, missing `updated_at`/`source_system`/`source_ref`, nullable `source_ref`). Raised with ARCH 28 Oct 03:39.
  Until ruled, the adapter refuses rows (fail closed) and no page uses it.

## Dependencies and requests
- ARCH: ruling on FE-OPEN-1; a path FE may own for its integration suite (proposal `tests/integration/fe/**`).
- DB: merge of DB-001..005; the read-function columns per the ruling.
- UX-002/003 for FE-002/003 pages.
