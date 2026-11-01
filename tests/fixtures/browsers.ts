// Firefox and WebKit projects (V13-QA-016, REQ-QA-003; M1_OPEN_QA_ROWS_DESIGN §9). They exist only when
// V13_E2E_BROWSERS names them, so a plain `pnpm test:e2e`, in a Claude sandbox above all (only Chromium is installed
// there; `playwright install` is never run), still runs Chromium only. CI's cross-browser workflow installs both
// engines and selects them. Results are "Chromium/Firefox/WebKit emulation", never real-device testing.
//
// They run the engine-neutral suites: the e2e scenarios and smoke, and tests/a11y. The suites below stay
// Chromium-only through the projects' testIgnore, never through test.skip (a skip in a leak-detection suite is refused
// by the leak-suite guard). The guard also checks, on the runner's own listing, that Chromium (desktop-ar) still runs
// every Sentinel spec and every Playwright leak-detection suite, and that the two engines run none of these.
import { devices, type PlaywrightTestProject } from "@playwright/test";

export const CROSS_BROWSER_PROJECTS = ["firefox-ar", "webkit-ar"] as const;
export type CrossBrowserProject = (typeof CROSS_BROWSER_PROJECTS)[number];

/** The Chromium project that runs every suite. */
export const CHROMIUM_PROJECT = "desktop-ar";

/**
 * What the two engines run: specs directly under tests/e2e and tests/a11y. A regular expression on the absolute path,
 * not a glob: Playwright matches a glob such as `e2e/**` at any depth, which would add SEC's tests/security/e2e.
 */
export const CROSS_BROWSER_MATCH = /[\\/]tests[\\/](?:e2e|a11y)[\\/][^\\/]+\.spec\.ts$/;

/** Specs inside CROSS_BROWSER_MATCH that stay Chromium-only, each with its reason. Repository-relative paths. */
export const CHROMIUM_ONLY: Readonly<Record<string, string>> = {
  "tests/e2e/scenario-a-case-switching.spec.ts":
    "the Sentinel's response-body reads, and history steps over CDP (tests/fixtures/history.ts)",
  "tests/e2e/scenario-d-search-filters.spec.ts":
    "the Sentinel's response-body reads, and history steps over CDP (tests/fixtures/history.ts)",
  "tests/e2e/scenario-e-notification-draft.spec.ts":
    "its CSP console checks match Chromium's message text; elsewhere they would pass without seeing a violation",
  "tests/e2e/negative-personas-pinning.spec.ts": "the Sentinel's response-body reads",
};

const ENGINE: Record<CrossBrowserProject, string> = {
  "firefox-ar": "Desktop Firefox",
  "webkit-ar": "Desktop Safari",
};

/**
 * The cross-browser projects V13_E2E_BROWSERS names (comma-separated; empty or unset gives none). An unknown name is
 * refused, so a typo never turns into a run that quietly tests Chromium only.
 */
export function selectedBrowsers(raw: string | undefined): CrossBrowserProject[] {
  const names = (raw ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s !== "");
  const out: CrossBrowserProject[] = [];
  for (const name of names) {
    if (!(CROSS_BROWSER_PROJECTS as readonly string[]).includes(name))
      throw new Error(
        `V13_E2E_BROWSERS names an unknown project (allowed: ${CROSS_BROWSER_PROJECTS.join(", ")})`,
      );
    if (!out.includes(name as CrossBrowserProject)) out.push(name as CrossBrowserProject);
  }
  return out;
}

/** The projects that reach the app through the local TLS front (tests/fixtures/tls-front.mjs) when it runs. */
export const TLS_PROJECTS: readonly CrossBrowserProject[] = ["webkit-ar"];

/**
 * One cross-browser project: 1280 × 800, ar-SA, the engine-neutral suites only. With `tlsBaseURL` (the TLS front is
 * running) a TLS project uses it: Playwright's WebKit on Linux drops the `Secure` session cookie on plain-http
 * localhost, so without the front no signed-in WebKit test can pass. The front's certificate is self-signed and
 * throwaway, hence ignoreHTTPSErrors.
 */
export function crossBrowserProject(name: CrossBrowserProject, tlsBaseURL?: string): PlaywrightTestProject {
  const tls = tlsBaseURL !== undefined && TLS_PROJECTS.includes(name);
  return {
    name,
    testMatch: CROSS_BROWSER_MATCH,
    testIgnore: Object.keys(CHROMIUM_ONLY).map((f) => f.replace(/^tests\//, "")),
    use: {
      ...devices[ENGINE[name]],
      viewport: { width: 1280, height: 800 },
      locale: "ar-SA",
      ...(tls ? { baseURL: tlsBaseURL, ignoreHTTPSErrors: true } : {}),
    },
  };
}
