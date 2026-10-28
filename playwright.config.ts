// Playwright: end-to-end and accessibility smoke tests (pnpm test:e2e).
//
// By default it builds the app and starts it on port 3100 with persona sign-in enabled and a session secret generated
// for this run (V13_E2E_SESSION_SECRET overrides it; nothing is ever committed or printed). With V13_E2E_BASE_URL set
// it tests that deployment instead and starts nothing. No database is needed: sign-in and the shell are DB-free.
//
// One project for now, desktop-ar (Arabic, RTL, the primary language). QA adds further projects, including the
// `staging` project that `pnpm test:e2e:staging` selects.
// PW_CHROMIUM_PATH points Playwright at a pre-installed Chromium in sandboxes without browser downloads; CI runs
// `playwright install --with-deps chromium` instead.
import { randomBytes } from "node:crypto";
import { defineConfig, devices } from "@playwright/test";

const PORT = 3100;
const externalBaseUrl = process.env.V13_E2E_BASE_URL?.trim();
const baseURL = externalBaseUrl || `http://localhost:${PORT}`;
const sessionSecret = process.env.V13_E2E_SESSION_SECRET?.trim() || randomBytes(32).toString("base64url");
const chromiumPath = process.env.PW_CHROMIUM_PATH?.trim();
const isCI = process.env.CI === "true";

export default defineConfig({
  testDir: "tests",
  testMatch: ["e2e/**/*.spec.ts", "a11y/**/*.spec.ts"],
  outputDir: "test-results/playwright",
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
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
          NEXT_TELEMETRY_DISABLED: "1",
        },
      },
});
