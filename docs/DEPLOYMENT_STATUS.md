# Deployment status — CDF V13 Enterprise

**SYNTHETIC-DATA REFERENCE IMPLEMENTATION — not CDF production.** Actual state of every connected system, checked
through the connected integrations at the time given. Nothing here is a plan presented as a fact. Production is blocked
by the hosting gate (ADR-005); staging holds synthetic data only.

Last checked: **28 Oct 2026 01:30 UTC** by the Chief Architect.

## 1. GitHub

| Item | Value | Checked |
| ---- | ----- | ------- |
| Repository | [`mh1m1m/CDF_Notification_Generator`](https://github.com/mh1m1m/CDF_Notification_Generator) (existing; no other repository created) | 01:29 |
| Visibility | public (OPEN_ISSUES OI-006) | E01 §1.2 |
| Default branch | `main` at `9f1edaf` (README and .gitignore only) | 01:29 |
| Integration branch | `develop` | 01:29 |
| Branch protection | **none on `main` or `develop`** (`protected: false`); the GitHub connector cannot set protection rules (OI-016) | 01:29 |
| CI | none yet (V13-ARCH-001 adds `.github/workflows/ci.yml`) | — |

## 2. Supabase (database)

| Item | Value | Checked |
| ---- | ----- | ------- |
| Organisation / plan | "CDF", free plan (project limit reached; no project created for V13, by owner decision) | E01 §1.2 |
| Project | **CDF GC Review**, ref `jeseeznffxlxmcljpmiu`, region `eu-central-1`, PostgreSQL 17.11, shared with the GC Review application (ADR-012) | 01:24 |
| V13 schema | `cdf_notifications_v13`, owned by `cdf_v13_owner`; ACL `{cdf_v13_owner=UC/cdf_v13_owner,cdf_v13_user=U/cdf_v13_owner}` | 01:28 |
| V13 roles | `cdf_v13_owner` (NOLOGIN), `cdf_v13_app` (LOGIN, connection limit 8, **no password set yet** — nobody can log in), `cdf_v13_user` (NOLOGIN) | 01:28 |
| V13 migrations applied | 1: `0000 bootstrap` (sha256 `0f80be82…5c01`) at 01:03:21, runner `hosted` | 01:24 |
| Isolation | PASS, 27 checks, 0 breaches (`docs/TEST_EVIDENCE.md` §2) | 01:28 |
| GC Review objects | fingerprint of all 648 non-V13 objects identical to the baseline, TOTAL `40c9efe5697d19552d15f5ef85c2f85f` | 01:18 |
| Supabase Auth / Storage / Realtime / Edge Functions / Data API | not used by V13; no V13 user, bucket, function or exposed schema | — |
| Advisors | security: one pre-existing WARN (GC Review) + one INFO on V13 (OI-009); performance: 4 pre-existing INFO | 01:07 |

## 3. Vercel (hosting)

| Item | Value | Checked |
| ---- | ----- | ------- |
| Team | `team_tJxfhTJObyoeBcCmY0SQnFHL` (the owner's team) | 01:10 |
| Project | `cdf_notification_generator` (`prj_dr5kaRCFueAkDU26efym7QCrQ2zK`), framework Next.js, Node 22.x, functions in `fra1` | 01:10 |
| Git link | `mh1m1m/CDF_Notification_Generator`; every pushed branch builds a preview | 01:10 |
| Deployment protection | Vercel Authentication on all deployments except custom domains (no custom domain exists); password protection off; trusted IPs off | 01:10 |
| Production domain | `cdfnotificationgenerator-malsalehs-projects.vercel.app` — serves nothing (no successful deployment) | 01:10 |
| Staging (develop) alias | `cdfnotificationgenerator-git-develop-malsalehs-projects.vercel.app` | 01:10 |
| Environment variables | **none set** | 01:29 |

Deployments so far:

| Deployment | Commit | Target | State | Cause |
| ---------- | ------ | ------ | ----- | ----- |
| `dpl_CAY2ZqUCvHquz5yMfTqvE4YG16kv` | `develop` `47ce691` | production (Vercel's choice for the first build, OI-011) | ERROR | `NEXT_NO_VERSION`: no Next.js app yet |
| `dpl_3bZoHdySGtoh9JLqxYpwU1FBF4er` | `develop` `3512507` | preview | ERROR | `NEXT_NO_VERSION`: no Next.js app yet |

## 4. Environment variables (names only; values never in Git)

Planned for the staging (`develop` preview) and development environments; production gets none while ADR-005 blocks it.

| Name | Type in Vercel | Purpose | Status |
| ---- | -------------- | ------- | ------ |
| `V13_DATABASE_URL` | sensitive | `cdf_v13_app` login through the Supabase pooler (transaction mode) | not set (V13-ARCH-003) |
| `V13_SESSION_SECRET` | sensitive | signs the persona session cookie (≥ 32 bytes) | not set |
| `V13_PERSONA_SIGNIN` | plain | `enabled` turns on synthetic persona sign-in | not set |
| `V13_ISOLATION_PROBE` | plain | `enabled` turns on `/api/health/isolation` (counts only) | not set |

There is no Supabase URL, anon key or service-role key: V13 does not use the Supabase client or Data API.

## 5. Verification checklist (Cloud Initialization §6)

| Check | Status | Evidence |
| ----- | ------ | -------- |
| GitHub ↔ Vercel connected | DONE | deployments built from `develop` pushes |
| Database reachable from the deployed app | NOT_STARTED | V13-ARCH-003 |
| Successful build | NOT_STARTED | waits for V13-ARCH-001 |
| Authentication test (persona sign-in) on the deployment | NOT_STARTED | waits for V13-ARCH-001 and -003 |
| Playwright smoke against the deployment | NOT_STARTED | OI-008 |
| Isolation probe from the app login | NOT_STARTED | plan §5.3, V13-ARCH-003 |
