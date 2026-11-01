# Dependencies — V13 Enterprise

Classification: **SYNTHETIC-DATA REFERENCE IMPLEMENTATION** — not CDF production.

Every dependency is pinned to an exact version (`save-exact=true` in `.npmrc`) and recorded in `pnpm-lock.yaml`. A new
dependency needs a row here (why, alternative considered) in the same pull request. Runtime: Node.js 22 (`.nvmrc`,
`engines`), pnpm 10.28.0 (`packageManager`). No `@supabase/*` package is allowed anywhere (ESLint
`no-restricted-imports`).

## Runtime dependencies

| Package           | Version | Why                                                                                                                                                                                     | Alternative considered                                                                                                       |
| ----------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `next`            | 16.4.2  | The application framework (App Router, Server Components, Server Actions, `proxy.ts`). Required by the architecture.                                                                    | None: fixed by the governing rules.                                                                                          |
| `react`           | 19.3.0  | Required by Next.js 16.                                                                                                                                                                 | None.                                                                                                                        |
| `react-dom`       | 19.3.0  | Required by Next.js 16; `react-dom/server` also renders components in unit tests (no DOM emulation needed).                                                                             | None.                                                                                                                        |
| `postgres`        | 3.4.9   | The only database driver: server-side SQL with tagged templates (bound parameters), `prepare: false` for Supavisor transaction mode, transactions for the per-request security context. | `pg` (node-postgres): no tagged templates, so parameter binding is easier to get wrong; `@supabase/*`: prohibited.           |
| `jose`            | 6.2.12  | Signs and verifies the HS256 session cookie with WebCrypto only, so `proxy.ts` stays edge-safe.                                                                                         | `node:crypto` HMAC by hand: no audited JWT claim checks (`exp`, `iat`, `typ`, algorithm pinning); `jsonwebtoken`: Node-only. |
| `zod`             | 4.6.7   | Contracts in `lib/contracts`: one schema per input, re-validated on the server.                                                                                                         | Hand-written guards: more code, no inferred types.                                                                           |
| `server-only`     | 0.0.1   | Build-time guard: a client bundle that imports a server module (`lib/db`, `lib/auth/server-session.ts`, `lib/auth/claims-key.ts`) fails to build.                                       | Convention only: not enforced.                                                                                               |
| `react-hook-form` | 7.91.0  | Listed by the foundation brief for multi-section forms (CLAUDE.md §9). Not imported yet; the first multi-section form will use it with the command's Zod schema.                        | Server Action forms only: fine for short command forms, which stay that way.                                                 |

## Development dependencies

| Package                     | Version | Why                                                                                                                                                                                 | Alternative considered                                                     |
| --------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `typescript`                | 6.0.3   | `strict` type checking (`pnpm typecheck`).                                                                                                                                          | None.                                                                      |
| `@types/node`               | 22.20.5 | Node.js 22 types.                                                                                                                                                                   | None.                                                                      |
| `@types/react`              | 19.3.0  | React 19 types.                                                                                                                                                                     | None.                                                                      |
| `@types/react-dom`          | 19.3.0  | React DOM 19 types.                                                                                                                                                                 | None.                                                                      |
| `eslint`                    | 9.39.5  | Flat-config linting; boundaries and the raw-SQL ban (TM-S4) use built-in rules. Same pin as the sibling repository; npm marks this version "no longer supported" (upgrade is open). | eslint-plugin-boundaries / import: extra plugins for what built-ins cover. |
| `@eslint/js`                | 9.39.5  | ESLint's recommended JavaScript rules.                                                                                                                                              | None.                                                                      |
| `typescript-eslint`         | 8.71.1  | TypeScript parser and recommended rules (not type-aware, to keep lint fast).                                                                                                        | None.                                                                      |
| `@next/eslint-plugin-next`  | 16.4.0  | Next.js rules (core web vitals). Same pin as the sibling repository; 16.4.2 (matching `next`) also exists.                                                                          | `eslint-config-next`: a full preset with more plugins than needed.         |
| `eslint-plugin-react-hooks` | 7.1.1   | Rules of hooks.                                                                                                                                                                     | None.                                                                      |
| `eslint-plugin-jsx-a11y`    | 6.10.2  | Static accessibility rules for JSX.                                                                                                                                                 | Runtime checks only (axe): catches less, later.                            |
| `globals`                   | 17.13.0 | Browser/Node global names for the flat config.                                                                                                                                      | Hand-written lists.                                                        |
| `prettier`                  | 3.9.9   | Formatting (`pnpm format:check` in CI).                                                                                                                                             | None.                                                                      |
| `tailwindcss`               | 4.3.3   | UX's utility layer next to the token stylesheet; sources limited to `app/` and `components/`.                                                                                       | Plain CSS only: the brief's stack includes Tailwind v4.                    |
| `@tailwindcss/postcss`      | 4.3.3   | Tailwind v4 through PostCSS, the only CSS tooling in the build.                                                                                                                     | Tailwind CLI: a second build step.                                         |
| `vitest`                    | 5.0.3   | Unit and integration tests (two projects; integration runs files one at a time).                                                                                                    | Jest: needs extra transforms for ESM and TypeScript.                       |
| `@playwright/test`          | 1.63.0  | End-to-end smoke tests against a production build.                                                                                                                                  | Cypress: a second runner; Playwright is the stack's e2e tool (CLAUDE.md).  |
| `@axe-core/playwright`      | 4.14.0  | Accessibility checks (axe-core) inside the Playwright suite.                                                                                                                        | Lighthouse: page-level scores, not per-rule assertions.                    |

## CI system packages (not npm)

| Package (Ubuntu 24.04, apt) | Where | Why |
| --- | --- | --- |
| `fonts-liberation`, `fonts-dejavu-core`, `fonts-crosextra-carlito`, `fonts-noto-core` | `.github/workflows/visual.yml` (V13-ARCH-014) | The app uses system font stacks (`--cdf-font-ar`, `--cdf-font-latin`), and glyph widths differ by machine (QA-010's probe: Liberation Sans 321 px against Carlito 294 px for the same link). Visual baselines are made and compared only in the visual job, on one runner image with these four packages installed explicitly (`docs/qa/M1_OPEN_QA_ROWS_DESIGN.md` §3, §8). Their versions are printed in the job log and written into the screenshot library's manifest, so a font update shows up as a reviewed baseline diff. Not pinned to a version: Ubuntu's archive keeps only the current one. Alternative considered: committed web fonts, which would change what users see and need UX's design decision. |

Deliberately **not** added: Testing Library and jsdom (component tests render with `react-dom/server`), any Supabase
SDK, any ORM, any dotenv loader (Next.js loads `.env.local` itself; scripts read `process.env`).

## Decisions to review (Chief Architect)

1. **Per-request nonce CSP** (threat TM-I13; `lib/http/csp.ts`, set by `proxy.ts`). Every page gets
   `script-src 'self' 'nonce-…' 'strict-dynamic'` with a fresh 16-byte nonce; Next.js reads it from the forwarded
   request header and puts it on its own scripts, so `script-src` never needs `'unsafe-inline'`. The cost, dynamic
   rendering of every page, is already paid: the root layout reads the locale cookie. `'unsafe-eval'` and `ws:` are
   present only under `next dev`; `upgrade-insecure-requests` only on Vercel. Paths the proxy never sees (health API,
   static files, images) get `default-src 'none'` from `next.config.ts`, so every response carries exactly one policy.
   `frame-ancestors 'none'`, `object-src 'none'`, `frame-src 'none'`, `base-uri 'self'` and `form-action 'self'` hold
   in every mode. `style-src` keeps `'unsafe-inline'` (inline style attributes run no code). Known follow-up: the
   FE-006 notification preview must not need a frame, or `frame-src` is revisited with SEC.
2. **`db:migrate` refuses non-loopback targets.** The hosted project is changed only by pasting the reviewed output of
   `pnpm db:hosted-bundle <version>` (dry run first). The bundle connects nowhere and holds no credentials.
3. **Runner and bundle set `lock_timeout = '5s'` and `search_path = ''`** inside each migration transaction, and
   serialise on `pg_advisory_xact_lock(hashtext('cdf_notifications_v13'), 0)`: key 0 of the V13 namespace is reserved
   for schema migrations (keys 1 and 2 are used by DB's migrations).
4. **The bundle's guard 4 compares every recorded predecessor** (version, name, sha256) with the repository it was
   generated from, not only the latest version.
5. **Hosted simulation as a second local cluster** (`pnpm db:local`, port 54330) whose bootstrap superuser is
   `supabase_admin`, because a cluster's bootstrap superuser can never lose SUPERUSER. CI uses a second `postgres:17`
   service the same way. Versions: CDF GC Review runs PostgreSQL **17.11** (`docs/DEPLOYMENT_STATUS.md`), so CI's
   `postgres:17` is the run of record for version-sensitive behaviour; `db:local` uses whatever server binaries the
   machine has (the build sandbox has only 16.15).
6. **Isolation probe output**: besides the requested counts it reports `inconclusive` per check (any error other than
   SQLSTATE 42501) and `login.session_user_ok`; either one fails the verdict. FAIL answers 503.
7. **`GET /api/health` answers 503 when degraded** (database missing, unreachable or isolation failed).
8. **Audit contract aligned with DB's ledger** (`AuditEventSchema` mirrors `cdf_notifications_v13.audit_event` and
   `_append_audit`), replacing the earlier draft with an `outcome` field.
9. **Session cookie helpers split**: `lib/auth/session.ts` is edge-safe (used by `proxy.ts`); `server-session.ts` holds
   the `next/headers` wrappers; `claims-key.ts` (Node `hkdfSync`) is separate and not used yet.
10. **Negative-test personas** (Secretary Epsilon, Persona Zeta) are refused by persona sign-in exactly like unknown ids
    and are never listed; tests mint their sessions directly. The registry accepts their claims, because the database
    is what refuses them.
11. **db:lint exemption**: a policy may say `TO public` only when it is
    `AS RESTRICTIVE … USING (false) [WITH CHECK (false)]`, which grants nothing. DB's 0000–0004 lint clean under all 22
    rules. New rule `notify-listen` enforces the coexistence rule "V13 never uses NOTIFY/LISTEN".
12. **`proxy.ts` matcher is anchored**: only `/api/health`, `/api/health/isolation`, `/favicon.ico`, `/robots.txt`,
    `/_next/image` and `/_next/static/*` bypass the proxy; look-alike paths do not. `/sign-in` goes through the proxy
    (for its CSP) and is the one page that needs no session (`PUBLIC_PAGES`, exact path).
13. **The isolation probe sets `lock_timeout = '2s'` and `statement_timeout = '15s'`**, because the database is shared
    with GC Review: a lock wait counts as inconclusive (FAIL), and the probe never holds up the other application.
14. **Application code never imports from `tests/`** (ESLint `no-restricted-imports` regex on `app/`, `components/`,
    `lib/`, `proxy.ts`, `instrumentation.ts`, `next.config.ts`). SEC's suites live in `tests/security/app` (unit project),
    `tests/security/db` (integration project, may use the postgres driver and raw SQL) and `tests/security/e2e`
    (Playwright).
15. **Frozen evidence copies are neither formatted nor linted.** PROC's ported tests read byte-exact copies of
    synthetic reference material under `tests/unit/**/__evidence__/`. Their sha256 hashes are recorded in
    `docs/teams/proc/EVIDENCE_MANIFEST.md`, and they are scanned for personal-data patterns before copying and on every
    test run. Prettier would rewrite them and break the recorded hashes, so `.prettierignore` and the ESLint ignores
    exclude exactly that folder name under `tests/unit/` (`tests/unit/eslint-rules.spec.ts` pins the scope). Vitest
    runs only `*.spec.*` files and `tsc` checks only TypeScript, so nothing in those folders runs as code. Evidence
    copies live nowhere else.
16. **`agentRules: false` in `next.config.ts`.** Next.js 16.4 writes an `AGENTS.md` at the project root when
    `next dev` detects an AI coding agent (option `agentRules`, default true:
    `node_modules/next/dist/server/config-shared.d.ts` and `server/lib/start-server.js`). `CLAUDE.md` is this
    repository's only agent-instructions file, so the generated file is turned off. With the option off, Next.js
    only removes its own marked block from an existing `AGENTS.md`; it never touches `CLAUDE.md`. The related
    `experimental.agentFeedback` is off unless set to true, and stays unset.
