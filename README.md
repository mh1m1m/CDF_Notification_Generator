# CDF Case & Notification Intelligence Platform — V13 Enterprise

منصة الصندوق الثقافي لإدارة القضايا والإشعارات — الإصدار الثالث عشر

> **Classification: SYNTHETIC-DATA REFERENCE IMPLEMENTATION.**
> This repository is not CDF production and is not approved hosting for real CDF
> information. It holds synthetic data only (names such as _Employee Alpha_,
> case numbers such as `CDF-DEMO-2026-0001`, addresses under `example.test`).
> Production promotion stays blocked until CDF's hosting, data-residency,
> cybersecurity and privacy approvals are verified.

The application is being built in reviewed pull requests.

- Work in progress lands on the `develop` integration branch.
- `main` changes only through a pull request merged by an authorised human.

## Developing locally

Requirements: Node.js 22 (`.nvmrc`), pnpm 10.28 (`corepack enable`), and PostgreSQL 16 or 17 server binaries
(`initdb`, `pg_ctl`; found through `pg_config`, `/usr/lib/postgresql/<n>/bin`, or `V13_PG_BIN`). No Docker is needed.

```bash
pnpm install
cp .env.example .env.local   # then fill in the values you need; .env.local is never committed
pnpm db:local start          # two local clusters on 127.0.0.1 (data in .local/, git-ignored)
pnpm db:reset                # rebuild v13_local from database/migrations (+ database/seed)
pnpm dev                     # http://localhost:3000
```

For persona sign-in, `.env.local` needs `V13_PERSONA_SIGNIN=enabled` and a `V13_SESSION_SECRET` of at least 32 random
bytes in base64url, for example the output of
`node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"`. For database access from the
app, `V13_DATABASE_URL=postgres://cdf_v13_app:local-only-not-a-secret@127.0.0.1:54329/v13_local` (the local-only
password that `db:reset` sets; it is not a secret and never used outside local clusters).

| Command                                                          | What it does                                                                                                           |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `pnpm lint`                                                      | ESLint (import boundaries, raw-SQL ban, i18n and a11y rules), logical-CSS check, `.env.example` check                  |
| `pnpm typecheck`                                                 | TypeScript `strict`                                                                                                    |
| `pnpm format:check`                                              | Prettier                                                                                                               |
| `pnpm db:lint`                                                   | Static checks on every migration (scope, RLS, grants, roles, search_path, …)                                           |
| `pnpm test`                                                      | Unit tests (Vitest, no database)                                                                                       |
| `pnpm test:db`                                                   | Integration and security tests against the local clusters (skipped with a message when they are not running)           |
| `pnpm test:e2e`                                                  | Playwright smoke and accessibility tests on a production build (port 3100; `PW_CHROMIUM_PATH` for a local Chromium)    |
| `pnpm db:local [start\|stop\|status] [primary\|hosted-sim\|all]` | Local clusters: `primary` (port 54329, superuser `postgres`) and `hosted-sim` (port 54330, superuser `supabase_admin`) |
| `pnpm db:migrate [--dry-run]`                                    | Apply pending migrations to a loopback database (default: the local primary cluster)                                   |
| `pnpm db:hosted-bundle <version> [--dry-run]`                    | Print the reviewed SQL for one hosted migration (connects nowhere, holds no credentials)                               |

The hosted simulation reproduces the shared hosted project's role layout, where the administrator `postgres` is not a
superuser; the integration suites build a Supabase-like layout there before each scenario. Stop the clusters with
`pnpm db:local stop`.
