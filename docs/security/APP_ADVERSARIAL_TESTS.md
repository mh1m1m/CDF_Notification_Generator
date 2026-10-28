# Application adversarial tests (V13-SEC-003)

**Classification: SYNTHETIC-DATA REFERENCE IMPLEMENTATION.** Not CDF production. Owner: SEC. Test ids refer to the
catalogue in `docs/security/AUTHORIZATION_MATRIX.md` §6 and the threats in `docs/security/THREAT_MODEL.md`
(both delivered by PR #2, V13-SEC-001).

## Suites

| File                                          | Runner           | Catalogue ids                          | Threats                    |
| --------------------------------------------- | ---------------- | -------------------------------------- | -------------------------- |
| `tests/security/app/session-forgery.spec.ts`  | Vitest `unit`    | SEC-APP-03, -04, -06                   | TM-S1, TM-S2               |
| `tests/security/app/static-boundaries.spec.ts` | Vitest `unit`    | SEC-APP-12, -13 (static), -18 (static) | TM-S4, TM-T4, TM-I8, TM-E5 |
| `tests/security/e2e/server-actions.spec.ts`   | Playwright       | SEC-APP-07, -10 (actions), -18         | TM-E5, TM-S3, TM-I10       |
| `tests/security/e2e/surface.spec.ts`          | Playwright       | SEC-APP-08, -10, -13, -14, -15         | TM-I8, TM-I10, TM-I11, TM-I13 |
| `tests/security/public-actions.ts`            | shared allow-list | SEC-APP-18                            | TM-E5                      |

What each suite proves:

- **Session forgery**: algorithm and header confusion (HS384/HS512/none/RS256, missing alg, wrong typ, `crit`,
  `b64=false`, embedded `jwk`/`jku`/`kid`), malformed segments, claim type confusion and look-alike values
  (upper-case or braced UUIDs, arrays, objects, lower-case or unknown workspace, string `exp`, float `iat`, lifetime
  over 8 h, smuggled `roles`/`workspace_id`, `__proto__`), expiry, future `iat`, `nbf`, and every non-exact value of
  `V13_PERSONA_SIGNIN`. Every forgery verifies as null.
- **Static boundaries**: only `lib/db/security-context.ts` writes `request.v13.claims`; `set_config`, `SET ROLE` and
  the postgres driver appear only in `lib/db`; no `.unsafe`, `eval` or `new Function`; no client component imports
  server-only modules; every module using postgres or a `node:` built-in starts with `import "server-only"`; no
  `NEXT_PUBLIC_` variable; `.env.example` holds names only; `"use server"` only as a file directive; every exported
  Server Action outside the allow-list calls `getCurrentSession()` itself.
- **Server Actions**: every action id in the build's manifest is posted, encoded as React encodes a form, to
  `/sign-in`, `/my-work` and `/`, with no cookie, with a cookie signed by another secret, and cross-origin
  (`https://attacker.example.test`, `null`, a look-alike host) with and without a valid session. No session-bound
  action runs without a session; no action runs cross-origin; refusals carry a digest only; unknown action ids and
  malformed bodies get fixed short answers; a failed sign-in returns only a UUID reference.
- **Surface**: on every route, signed in or not, each security header appears exactly once with one CSP and no
  framework banner; authenticated pages are `no-store`; the session cookie is host-only, HttpOnly, Secure,
  SameSite=Lax, at most 8 h; odd cookies are refused at the gate with a redirect; odd URLs (traversal, script in
  `ref`, `.env`, `.git/config`) never give a 5xx or internals; the health body has only its documented fields; no
  secret name, connection string, V13 role, schema or claims setting appears in `.next/static`, the HTML or the
  flight data, and no source map is shipped; after sign-in and a language switch, web storage, IndexedDB, Cache
  Storage and service workers are empty and the session cookie is invisible to scripts.

The browser suites that read `.next` (action manifest, bundle scan) skip themselves against `V13_E2E_BASE_URL`.

## Observations (INFO, no defect)

| Id         | Observation                                                                                                     | Why it is not a defect                                                                                              | Pinned by                                  |
| ---------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| SEC-INFO-1 | A session token with trailing whitespace (`<token> `, `<token>\n`) verifies (jose 6.2.12 with Node's base64url). | Same signed claims; no key-less party can change the payload; cookie values cannot carry it.                         | `session-forgery.spec.ts` (INFO test)      |
| SEC-INFO-2 | Next.js 16 runs a Server Action whose request has **no** `Origin` header; it checks Origin only when present.   | Browsers send `Origin` on every POST, and the session cookie is SameSite=Lax, so browser-driven CSRF cannot use it. | `server-actions.spec.ts` (INFO test)       |

Either pin fails if the behaviour changes, so a change is reviewed rather than missed.

Status (ARCH, 28 Oct 2026): SEC-INFO-1 agreed as INFO. SEC-INFO-2 **ACCEPTED by ARCH**, no change to `proxy.ts`:
a cross-site request cannot carry the session (SameSite=Lax), and a client that already holds the cookie can send
any `Origin` it likes, so requiring one adds nothing. The pin test stays.

## Evidence (local, 28 Oct 2026, branch `test/V13-SEC-003-app-adversarial` on develop `f0a7220`)

Node 22.22.0, pnpm 10.28.0, Next.js 16.4.2, Chromium from `PW_CHROMIUM_PATH=/opt/pw-browsers/chromium`.

| Command                                         | Result                                          |
| ----------------------------------------------- | ----------------------------------------------- |
| `pnpm lint`                                     | exit 0                                          |
| `pnpm typecheck`                                | exit 0                                          |
| `pnpm test`                                     | 19 files, 314 tests passed (63 of them SEC-003) |
| `pnpm test:e2e`                                 | 39 passed (27 of them SEC-003)                  |
| `npx playwright test tests/security/e2e`        | 27 passed                                       |

CI on the PR is the run of record.

## Not covered yet

- SEC-APP-01/02/05/09/11/16/17 need case pages and the BFF (FE-002..006); they follow when those land, using the
  same allow-list and probes. With no session-bound action in the build yet, the "no session-bound action runs
  without a session" probe has nothing to post; it covers every new action automatically.
- Database adversarial tests are V13-SEC-002 (`tests/security/db`), after DB-001..004.
