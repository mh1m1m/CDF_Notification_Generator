// Playwright: end-to-end and accessibility smoke tests (pnpm test:e2e).
//
// By default it builds the app and starts it on port 3100 with persona sign-in enabled and a session secret generated
// for this run (V13_E2E_SESSION_SECRET overrides it; nothing is ever committed or printed). With V13_E2E_BASE_URL set
// it tests that deployment instead and starts nothing.
//
// Database (V13-ARCH-008): the started app reads and writes the LOOPBACK database v13_local as cdf_v13_app, the same
// way staging uses its database: V13_E2E_DATABASE_URL, or by default the local primary cluster of `pnpm db:local`
// with the local-only app password `pnpm db:reset` sets. Anything but the loopback v13_local as cdf_v13_app (no query,
// no fragment) is refused, because the tests write (switches, task commands), db:reset rebuilds only that database,
// and another login would bypass the security context the suites test. The app installs the claims key for
// this run's secret at start (ADR-014), so the database must not hold another key: run `pnpm db:reset` before every
// local run (CI runs it in the e2e job). The database URL is never printed.
//
// One project for now, desktop-ar (Arabic, RTL, the primary language). QA adds further projects, including the
// `staging` project that `pnpm test:e2e:staging` selects.
// PW_CHROMIUM_PATH points Playwright at a pre-installed Chromium in sandboxes without browser downloads; CI runs
// `playwright install --with-deps chromium` instead.
import { randomBytes } from "node:crypto";
import { defineConfig, devices } from "@playwright/test";
import { isLoopbackUrl, LOCAL_DATABASE, localPrimaryPort, V13_APP } from "./scripts/db/lib/migrations.mjs";
import { DEFAULT_LOCAL_APP_PASSWORD } from "./scripts/db/reset-local.mjs";

const PORT = 3100;
const externalBaseUrl = process.env.V13_E2E_BASE_URL?.trim();
const baseURL = externalBaseUrl || `http://localhost:${PORT}`;
const sessionSecret = process.env.V13_E2E_SESSION_SECRET?.trim() || randomBytes(32).toString("base64url");
// Workers inherit the environment: tests that mint a negative-test persona's session read the same secret.
if (!externalBaseUrl) process.env.V13_E2E_SESSION_SECRET = sessionSecret;

/**
 * The database the locally started app uses (see the header): exactly the loopback v13_local as cdf_v13_app, with no
 * query or fragment. postgres.js turns query parameters into startup parameters that can replace the database and the
 * user (SEC review of #36), and any other login (a superuser above all) would bypass the security context under test.
 * The error never contains the URL.
 */
function e2eDatabaseUrl(env: Readonly<Record<string, string | undefined>>): string {
  const configured = env.V13_E2E_DATABASE_URL?.trim();
  const password = encodeURIComponent(env.V13_LOCAL_APP_PASSWORD || DEFAULT_LOCAL_APP_PASSWORD);
  const url =
    configured || `postgres://${V13_APP}:${password}@127.0.0.1:${localPrimaryPort(env)}/${LOCAL_DATABASE}`;
  let accepted = false;
  try {
    const u = new URL(url);
    accepted =
      (u.protocol === "postgres:" || u.protocol === "postgresql:") &&
      isLoopbackUrl(url) &&
      decodeURIComponent(u.username) === V13_APP &&
      decodeURIComponent(u.pathname.replace(/^\//, "")) === LOCAL_DATABASE &&
      u.search === "" &&
      u.hash === "";
  } catch {
    accepted = false;
  }
  if (!accepted) {
    throw new Error(
      `V13_E2E_DATABASE_URL must be the loopback database ${LOCAL_DATABASE} as ${V13_APP}, with no query or fragment`,
    );
  }
  return url;
}
const chromiumPath = process.env.PW_CHROMIUM_PATH?.trim();
const isCI = process.env.CI === "true";

export default defineConfig({
  testDir: "tests",
  // QA's suites (e2e, a11y, Sentinel, Truth Inspector, visual) and SEC's browser-level security suites.
  testMatch: [
    "e2e/**/*.spec.ts",
    "a11y/**/*.spec.ts",
    "sentinel/**/*.spec.ts",
    "truth/**/*.spec.ts",
    "visual/**/*.spec.ts",
    "security/e2e/**/*.spec.ts",
  ],
  outputDir: "test-results/playwright",
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  // A test that fails and then passes on its retry fails the CI run: a leak that shows once is never a green "flaky"
  // (V13-QA-008, TEST_ARCHITECTURE.md §7.1; pinned in tests/sentinel/leak-suite-guard.spec.ts).
  failOnFlakyTests: isCI,
  reporter: isCI
    ? [["list"], ["junit", { outputFile: "test-results/e2e-junit.xml" }], ["html", { open: "never" }]]
    : [["list"]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "desktop-ar",
      use: {
        ...devices["Desktop Chrome"],
        locale: "ar-SA",
        ...(chromiumPath ? { launchOptions: { executablePath: chromiumPath } } : {}),
      },
    },
  ],
  webServer: externalBaseUrl
    ? undefined
    : {
        command: `pnpm build && pnpm start --port ${PORT}`,
        // /api/health answers 503 without a database; the sign-in page is the readiness signal.
        url: `${baseURL}/sign-in`,
        reuseExistingServer: false,
        timeout: 300_000,
        stdout: "ignore",
        stderr: "pipe",
        env: {
          V13_PERSONA_SIGNIN: "enabled",
          V13_SESSION_SECRET: sessionSecret,
          // Set explicitly, so the app never inherits another V13_DATABASE_URL from the shell.
          V13_DATABASE_URL: e2eDatabaseUrl(process.env),
          // Playwright merges the runner's environment into the server's: the app gets no administrator URL.
          V13_ADMIN_DATABASE_URL: "",
          V13_HOSTED_SIM_SUPERUSER_URL: "",
          NEXT_TELEMETRY_DISABLED: "1",
        },
      },
});
