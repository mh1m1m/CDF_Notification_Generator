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
// The screenshot library (V13-QA-014, docs/qa/M1_OPEN_QA_ROWS_DESIGN.md §2): about 200 images, so it runs only when
// asked for, in its own project (the CI visual job; `--project=visual-library` locally), never in every e2e run.
const visualLibrary = process.env.V13_E2E_VISUAL === "library";
const LIBRARY_SPEC = "visual/library.spec.ts";
// The committed visual baselines (V13-QA-015, §5): the `visual-baseline` project, only with V13_E2E_VISUAL=baseline.
const visualBaseline = process.env.V13_E2E_VISUAL === "baseline";
const BASELINE_SPEC = "visual/baseline.spec.ts";
// The case-access audit (V13-QA-022) counts one persona's ledger rows, so it runs in its own project after every other
// browser test: no other spec opens a case for that persona while it counts. If a desktop-ar test fails, Playwright
// does not start this project and the run is already red.
const ACCESS_AUDIT_SPEC = "e2e/case-access-audit.spec.ts";
/** The visual projects write no failure screenshot, trace or video: nothing the data check refused, and no cookie. */
const visualUse = {
  ...devices["Desktop Chrome"],
  deviceScaleFactor: 1,
  locale: "ar-SA",
  screenshot: "off" as const,
  trace: "off" as const,
  video: "off" as const,
};
const chromiumLaunch = chromiumPath ? { launchOptions: { executablePath: chromiumPath } } : {};

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
  // The runner never writes a baseline, in CI or locally (V13-QA-015, design §5.2, D2; ARCH B2 on #145): a missing or
  // changed one fails; the baseline spec writes a missing one's candidate to test-results/baseline-candidates/, and
  // Playwright writes a changed one's actual and diff images. Pinned by G7 in tests/sentinel/leak-suite-guard.spec.ts.
  updateSnapshots: "none",
  reporter: isCI
    ? [["list"], ["junit", { outputFile: "test-results/e2e-junit.xml" }], ["html", { open: "never" }]]
    : [["list"]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  ...(visualLibrary ? { globalTeardown: "./tests/visual/library-teardown.ts" } : {}),
  projects: [
    {
      name: "desktop-ar",
      testIgnore: [LIBRARY_SPEC, BASELINE_SPEC, ACCESS_AUDIT_SPEC],
      use: {
        ...devices["Desktop Chrome"],
        locale: "ar-SA",
        ...chromiumLaunch,
      },
    },
    {
      name: "access-audit",
      testMatch: ACCESS_AUDIT_SPEC,
      dependencies: ["desktop-ar"],
      use: {
        ...devices["Desktop Chrome"],
        locale: "ar-SA",
        ...chromiumLaunch,
      },
    },
    ...(visualLibrary
      ? [
          {
            name: "visual-library",
            testMatch: LIBRARY_SPEC,
            // A failed data check writes no image (§4), and no session cookie reaches the artifact (SEC on #132).
            use: { ...visualUse, ...chromiumLaunch },
          },
        ]
      : []),
    ...(visualBaseline
      ? [
          {
            name: "visual-baseline",
            testMatch: BASELINE_SPEC,
            // One Linux image set, committed: no browser or platform suffix in the file name (§3, §5.1).
            snapshotPathTemplate: "{testDir}/visual/__screenshots__/{arg}{ext}",
            use: { ...visualUse, ...chromiumLaunch },
          },
        ]
      : []),
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
