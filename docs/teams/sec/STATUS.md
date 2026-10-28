# SEC status — CDF V13 Enterprise (synthetic data only)

Updated: 28 Oct 2026 · Branch: `docs/V13-SEC-001-threat-model` · Base: `develop` `b02e672`

## Completed
- V13-SEC-001 — threat model (`docs/security/THREAT_MODEL.md`) and authorisation matrix with the planned test
  catalogue (`docs/security/AUTHORIZATION_MATRIX.md`): 8 subjects × 4 case variants, 17 read objects, 7 command rows,
  16 application surfaces; 27 planned database tests (SEC-DB-01..27), 16 planned application tests (SEC-APP-01..16);
  4 recommendations for ARCH/DB (SEC-REC-01..04) — IN_REVIEW (reviewer: DB)

## Changed files
- `docs/security/THREAT_MODEL.md`, `docs/security/AUTHORIZATION_MATRIX.md`, `docs/teams/sec/STATUS.md`

## Test evidence
| Command | Result | Counts | Commit |
| ------- | ------ | ------ | ------ |
| Local PostgreSQL 16.x, `0000_bootstrap.sql` applied, then as `cdf_v13_user` inside one transaction: `select set_config('request.v13.claims', '{"persona_id":"FORGED"}', true)` | **succeeds**, `current_user = cdf_v13_user` — confirms TM-S4: the request role can rewrite its own claims, so the claims are only as trustworthy as the SQL the BFF sends | 1 probe | `b02e672` |

No SEC-DB or SEC-APP test exists yet: they need V13-ARCH-001 (tooling) and DB-001..004 / FE-001..006.

## Unresolved defects
- TM-S4 (HIGH, design): claims forgeable by any SQL running as `cdf_v13_user`. Proposed fix SEC-REC-01 (HMAC-bound
  claims verified by an owner-only helper). Decision: ARCH + DB, in V13-DB-001. Until then SEC-APP-12 (no string-built
  SQL) is the only control.

## Dependencies and requests
- ARCH: decide SEC-REC-01..04; tell SEC when V13-ARCH-001 is on `develop` (SEC-002/003 start then).
- DB: confirm the four assumptions in THREAT_MODEL §6 in DB-001/002; publish the per-persona visibility table with
  DB-005 (the tests read it).
- FE: Zod `.strict()` on command inputs; one 404-equivalent path for unknown and unauthorised.
