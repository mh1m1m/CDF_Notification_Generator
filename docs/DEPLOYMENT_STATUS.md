# Deployment status — CDF V13 Enterprise

**SYNTHETIC-DATA REFERENCE IMPLEMENTATION — not CDF production.** Actual state of every connected system, checked
through the connected integrations at the time given. Nothing here is a plan presented as a fact. Production is blocked
by the hosting gate (ADR-005); staging holds synthetic data only.

Last checked: **1 Nov 2026 04:05 UTC** by the Chief Architect (§1 GitHub and §3 Vercel deployments; §2 Supabase: see its own times).

## 1. GitHub

| Item | Value | Checked |
| ---- | ----- | ------- |
| Repository | [`mh1m1m/CDF_Notification_Generator`](https://github.com/mh1m1m/CDF_Notification_Generator) (existing; no other repository created) | 01:29 |
| Visibility | public (OPEN_ISSUES OI-006) | E01 §1.2 |
| Default branch | `main` at `9f1edaf` (README and .gitignore only); unchanged: only the owner merges `develop` → `main` | 31 Oct 19:56 |
| Integration branch | `develop` at `220b9d2` (merge of #113, V13-PROC-022); 110 PRs merged into it since 28 Oct, each with its CI runs in `docs/TEST_EVIDENCE.md` §4.1; migrations `0000`–`0011` in Git | 1 Nov 04:05 |
| Branch protection | **none on `main` or `develop`** (`protected: false`); the GitHub connector cannot set protection rules (OI-016) | 31 Oct 19:08 |
| CI | `.github/workflows/ci.yml`, six jobs on every PR and every push to `develop`: lint/typecheck/format/db:lint, unit, shared-database rehearsal, database integration, build, Playwright. Since #36 (V13-ARCH-008) the Playwright job runs the app against a PostgreSQL 17 service built by `pnpm db:reset`. Latest `develop` push run [41271407997](https://github.com/mh1m1m/CDF_Notification_Generator/actions/runs/41271407997) on `220b9d2`: success | 1 Nov 04:05 |

## 2. Supabase (database)

| Item | Value | Checked |
| ---- | ----- | ------- |
| Organisation / plan | "CDF", free plan (project limit reached; no project created for V13, by owner decision) | E01 §1.2 |
| Project | **CDF GC Review**, ref `jeseeznffxlxmcljpmiu`, region `eu-central-1`, PostgreSQL 17.11, shared with the GC Review application (ADR-012) | 01:24 |
| V13 schema | `cdf_notifications_v13`, owned by `cdf_v13_owner`; ACL `{cdf_v13_owner=UC/cdf_v13_owner,cdf_v13_user=U/cdf_v13_owner}` | 01:28 |
| V13 roles | `cdf_v13_owner` (NOLOGIN), `cdf_v13_app` (LOGIN, connection limit 8, **no password**: nobody can log in; the owner sets it with `database/hosted/owner_set_app_login.sql`), `cdf_v13_user` (NOLOGIN) | 01:42 |
| V13 migrations applied | 6: `0000 bootstrap` (28 Oct 01:03:21) and `0001`–`0005` (31 Oct 19:01–19:36), runner `hosted`, applied by `postgres`, each history sha256 equal to the migration file's (`docs/TEST_EVIDENCE.md` §2.1). `0006`–`0010` and the two seed files wait for the owner to answer the connector's confirmation (OI-034; `0009` from #42 and `0010` from #52 joined the queue; V13-DB-016, #56, rehearses the whole resume sequence on the Supabase-like cluster) | 31 Oct 20:30 |
| Isolation | PASS, 27 checks, 0 breaches, after `0000` and after each of `0001`–`0005` (`docs/TEST_EVIDENCE.md` §2, §2.1) | 31 Oct 19:37 |
| GC Review objects | fingerprint of all 648 non-V13 objects identical to the baseline after every V13 step, TOTAL `40c9efe5697d19552d15f5ef85c2f85f`; GC Review's table statistics unchanged; its production deployment READY with `/` and `/api/health` 200 after each step | 31 Oct 19:40 |
| Supabase Auth / Storage / Realtime / Edge Functions / Data API | not used by V13; no V13 user, bucket, function or exposed schema | — |
| Advisors | security: GC Review's pre-existing WARN only (the V13 INFO of OI-009 cleared with `0001`); performance: GC Review's 4 pre-existing INFO plus 23 INFO on V13 tables (OI-032, decided in migration 0009: one index reshaped, 13 foreign keys accepted with reasons; the unused-index findings are expected without traffic) | 31 Oct 20:30 |

## 3. Vercel (hosting)

| Item | Value | Checked |
| ---- | ----- | ------- |
| Team | `team_tJxfhTJObyoeBcCmY0SQnFHL` (the owner's team) | 01:10 |
| Project | `cdf_notification_generator` (`prj_dr5kaRCFueAkDU26efym7QCrQ2zK`), framework Next.js, Node 22.x, functions in `fra1` | 01:10 |
| Git link | `mh1m1m/CDF_Notification_Generator`; every pushed branch builds a preview | 01:10 |
| Deployment protection | Vercel Authentication on all deployments except custom domains (no custom domain exists); password protection off; trusted IPs off | 01:10 |
| Protection bypass | one shareable link on the staging alias, created 1 Nov 00:00:52 UTC (taken to be the Vercel connector's authenticated fetch for the 00:00:55 health check) and expiring 1 Nov 23:00:52 UTC; its token is not recorded anywhere (OI-052) | 1 Nov 02:51 |
| Production domain | `cdfnotificationgenerator-malsalehs-projects.vercel.app` — serves nothing (no successful deployment) | 01:10 |
| Staging (develop) alias | `cdfnotificationgenerator-git-develop-malsalehs-projects.vercel.app` | 01:10 |
| Environment variables | `V13_PERSONA_SIGNIN`, `V13_ISOLATION_PROBE` (plain, Preview, branch `develop`); the two sensitive values still wait for the owner step (names listed, values not read) | 31 Oct 19:05 |

Deployments:

| Deployment | Commit | Target | State | Note |
| ---------- | ------ | ------ | ----- | ---- |
| `dpl_CAY2ZqUCvHquz5yMfTqvE4YG16kv` | `develop` `47ce691` | production (Vercel's choice for the first build, OI-011) | ERROR | `NEXT_NO_VERSION`: no Next.js app yet (28 Oct) |
| `dpl_3bZoHdySGtoh9JLqxYpwU1FBF4er` | `develop` `3512507` | preview | ERROR | `NEXT_NO_VERSION`: no Next.js app yet (28 Oct) |
| every `develop` merge since #6 (V13-ARCH-001) | — | preview | READY | the five most recent, read 31 Oct 19:05: `b193a1c`, `f431b98`, `558d4ae`, `50850a4`, `b5ee5f4` |
| `dpl_cZWKWPdPL9suLcPBtJCnnKMMRBpG` | `develop` `b5ee5f4` | preview | READY | the alias pointed here at 19:05; the push of `a6c224a` builds the next one |
| `dpl_5exSSyLjcmg7fMPDiBUEjM7A78gN` | `develop` `d694ff8` (#32) | preview | READY | still the newest `develop` deployment at 22:00 (created 20:47 UTC). No deployment exists for the fourteen later merges (`267944a` … `b5d810c`): the account's daily deployment limit refuses them (OI-038), so the staging alias lags `develop` until the limit resets |
| `dpl_8EmseVV6PbaYTEX2mXeDRQP2pVPu` | `develop` `dabc11f` (#64) | preview | READY | created 22:16 UTC; the merges between `d694ff8` and `dabc11f` have no deployment (OI-038) |
| `dpl_D4bipFNReuGFu81KoYVpPrrYtjjh` | `develop` `9290778` (#61) | preview | READY | the newest `develop` deployment at 23:28 (created 23:10 UTC); `9787419` and `4cc72ec` have none (OI-038). The staging alias was not re-read at 23:28 |
| `dpl_D8oLwP43MfU9Awe1RKj31u4Y6S8K` | `develop` `63d1271` (#63) | preview | READY | created 23:57 UTC; the staging alias pointed here when read through the Vercel connector on 1 Nov at 00:00 UTC. The seven merges between `9290778` and `63d1271` (`f069850` … `5153388`) have no deployment (OI-038) |
| `dpl_GRqTQrsWFBcixuqmBvR959Fk529W` | `develop` `e9cd74d` (#76) | preview | READY | created 00:26:53 UTC; the staging alias pointed here when read through the Vercel connector on 1 Nov at 00:32 UTC. The three merges between `63d1271` and `e9cd74d` (`d5b61b0`, `24616f6`, `fddbff8`) have no deployment (OI-038) |
| `dpl_ErmmMhvsjhQ7c2fKWFHruVxGGBTw` | `develop` `76ed4b8` (#86) | preview | READY | created 01:02:18 UTC. The three merges between `e9cd74d` and `76ed4b8` (`7d6a431`, `d26ada9`, `a93fa61`) have no deployment (OI-038) |
| `dpl_DdvyZah41aBUzjsRwnpXzpqZqv33` | `develop` `286eb93` (#81) | preview | READY | created 01:21:36 UTC; the staging alias pointed here when read through the Vercel connector on 1 Nov at 01:32 UTC and again at 01:49 UTC. `eee17f7` and `f45f192` have no deployment, and none existed for `25a1c48` (#87), `4ad41c2` (#89) or `b22f153` (#91) at 01:49 UTC (OI-038). Read again at 02:51 UTC: still the newest `develop` deployment; none exists for the ten merges `7f14f33` (#92) … `a0bf765` (#99) (OI-038) |
| `dpl_HsFmSFZP9h8bveNSnAtCAUcao9UF` | `develop` `21dbbaa` (#98) | preview | READY | created 03:31:25 UTC. The five merges between `a0bf765` and `21dbbaa` (`373f19c`, `4bf455d`, `b396062`, `85f7332`, `75733ba`) have no deployment (OI-038) |
| `dpl_56mzznCdbLVrKHMgQWeqrr4nGDHb` | `develop` `aecd7ef` (#107) | preview | READY | created 03:47:01 UTC; the newest `develop` deployment at 04:05 UTC. The four merges between `21dbbaa` and `aecd7ef` (`185b2ff`, `2bcd183`, `c0e6655`, `800ab8a`) have no deployment, and neither do the later merges `937cff3` (#115) and `220b9d2` (#113) (OI-038). The staging alias follows the last READY `develop` build (OI-038), so it should point here; it was not read (OI-052) |

Staging alias check, 1 Nov 2026 01:32:43 UTC (through the Vercel connector's authenticated fetch; Vercel
Authentication stays on): `GET /api/health` → **HTTP 503**
`{"status":"degraded","app":"v13-enterprise","commit":"286eb93…","db":{"status":"DB_NOT_CONFIGURED"}}`, the same answer
as the first check on 31 Oct at 19:05:36 UTC on `b5ee5f4` and the checks on 1 Nov at 00:00:55 UTC on `63d1271` and 00:32:18 UTC on `e9cd74d`. That is the
expected answer while `V13_DATABASE_URL` is unset (owner step), and the app serves no case data without it. The response
carried the resource Content-Security-Policy (`default-src 'none'`), `Cache-Control: no-store`, HSTS, `X-Frame-Options:
DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, COOP/CORP `same-origin`, the
Permissions-Policy and an `X-Correlation-Id`.

## 4. Environment variables (names only; values never in Git)

Planned for the staging (`develop` preview) and development environments; production gets none while ADR-005 blocks it.

| Name | Type in Vercel | Purpose | Status |
| ---- | -------------- | ------- | ------ |
| `V13_DATABASE_URL` | sensitive | `cdf_v13_app` login through the Supabase pooler (transaction mode) | not set: owner step (`docs/hosted/OWNER_STEP_APP_LOGIN.md`) |
| `V13_SESSION_SECRET` | sensitive | signs the persona session cookie (≥ 32 bytes); the request-claims key is derived from it (ADR-014) | not set: owner step |
| `V13_PERSONA_SIGNIN` | plain | `enabled` turns on synthetic persona sign-in | `enabled`, Preview, branch `develop` (02:00) |
| `V13_ISOLATION_PROBE` | plain | `enabled` turns on `/api/health/isolation` (counts only) | `enabled`, Preview, branch `develop` (02:00) |

There is no Supabase URL, anon key or service-role key: V13 does not use the Supabase client or Data API.

## 5. Verification checklist (Cloud Initialization §6)

| Check | Status | Evidence |
| ----- | ------ | -------- |
| GitHub ↔ Vercel connected | DONE | deployments built from `develop` pushes |
| Successful build | DONE | every `develop` merge since #6 deploys READY (§3) |
| Health endpoint on the deployment | DONE (degraded, as expected) | 503 `DB_NOT_CONFIGURED` with the security headers (§3) |
| Database reachable from the deployed app | BLOCKED | owner step: `V13_DATABASE_URL` and `V13_SESSION_SECRET` (`docs/hosted/OWNER_STEP_APP_LOGIN.md`); V13-ARCH-003 |
| Authentication test (persona sign-in) on the deployment | BLOCKED | same owner step |
| Playwright smoke against the deployment | NOT_STARTED | OI-008 |
| Isolation probe from the app login | BLOCKED | same owner step; plan §5.3, V13-ARCH-003 |
