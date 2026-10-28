# SEC status — CDF V13 Enterprise (synthetic data only)

Updated: 28 Oct 2026 02:00 UTC · Branch: `docs/V13-SEC-001-threat-model` · Base: `develop` `38dc495`

## Completed
- V13-SEC-001 — threat model (`docs/security/THREAT_MODEL.md`) and authorisation matrix with the planned test
  catalogue (`docs/security/AUTHORIZATION_MATRIX.md`): 8 subjects × 4 case variants, 17 read objects, 7 command rows,
  16 application surfaces; 30 planned database tests (SEC-DB-01..30), 17 planned application tests (SEC-APP-01..17);
  4 recommendations SEC-REC-01..04 (all ACCEPTED, ADR-014); ruling D6 — IN_REVIEW (reviewer: DB)

## Changed files
- `docs/security/THREAT_MODEL.md`, `docs/security/AUTHORIZATION_MATRIX.md`, `docs/teams/sec/STATUS.md`

## Test evidence
| Command | Result | Counts | Commit |
| ------- | ------ | ------ | ------ |
| Local PostgreSQL 16.x, `0000_bootstrap.sql` applied, then as `cdf_v13_user` inside one transaction: `select set_config('request.v13.claims', '{"persona_id":"FORGED"}', true)` | **succeeds**, `current_user = cdf_v13_user` — confirms TM-S4: the request role can rewrite its own claims, so the claims are only as trustworthy as the SQL the BFF sends | 1 probe | `b02e672` |

No SEC-DB or SEC-APP test exists yet: they need V13-ARCH-001 (tooling) and DB-001..004 / FE-001..006.

## Unresolved defects
- TM-S4 / OI-018 (HIGH, design, IN_PROGRESS): claims forgeable by SQL running as `cdf_v13_user`. Fix accepted as
  ADR-014 §4 (claims MAC); DB builds it in DB-001, SEC reviews it against THREAT_MODEL §7. Until merged, the only
  control is parameterised SQL (no `unsafe` calls outside migration tooling, lint-enforced by ARCH-001).

## Dependencies and requests
- ARCH: SEC-REC-01..04 accepted (ADR-014); SEC-REC-04 checked by ARCH in ARCH-003. SEC reviews ARCH-001
  (`lib/auth/session.ts`, `lib/db/security-context.ts`, `proxy.ts`, `app/api/health/**`, CI workflow).
- DB: confirm or correct THREAT_MODEL §6 assumptions 2–4 in DB-001/002; visibility matrix in DATA_MODEL §5.
- FE/UX: ruling D6 (investigators: case Notifications tab only, no Notification Operations Center in M1).
