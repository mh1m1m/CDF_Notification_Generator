// The environment conditions under which a leak-detection suite may skip (V13-QA-019; TEST_ARCHITECTURE.md §7.1).
// Each allowed skip calls one of these functions, and the leak-skip reporter (tests/critic/leak-skip-reporter.ts)
// calls the same function when the run ends, so the test and the check can never disagree about whether the
// condition held. A skip whose file has no allowance, or whose allowance's condition does not hold, fails the run.
// Because the test and the check share each function, a wrong function would fool both: the guard spec's truth table
// (tests/sentinel/leak-suite-guard.spec.ts, V13-QA-019 R2) pins each one against the real environment and file system.
// SYNTHETIC only; reads the environment and the file system, nothing else.
import { existsSync } from "node:fs";
import { join } from "node:path";

/**
 * The external deployment this run targets (V13_E2E_BASE_URL, trimmed), or undefined for a locally started build. The
 * one definition: playwright.config.ts, the skipping tests and the leak-skip reporter all read it here.
 */
export const externalBaseUrl = (): string | undefined => process.env.V13_E2E_BASE_URL?.trim() || undefined;

/** The local build's static output, which the bundle scan reads (tests/security/e2e/surface.spec.ts). */
export const localStaticDir = (cwd: string = process.cwd()): string => join(cwd, ".next", "static");

export const SKIP_CONDITIONS = {
  /** The run has no session secret to mint sessions with: playwright.config.ts sets one for every locally started
   * build (CI included), so this holds only against an external V13_E2E_BASE_URL. */
  sessionSecretMissing: (): boolean => !process.env.V13_E2E_SESSION_SECRET,
  /** The run targets an external deployment (V13_E2E_BASE_URL), whose secrets and build this runner does not know. */
  externalDeployment: (): boolean => Boolean(externalBaseUrl()),
  /** No local build output to scan (a local run without `pnpm build`; CI fails earlier, requireBuildWhenSignalled). */
  localBuildMissing: (cwd: string = process.cwd()): boolean => !existsSync(localStaticDir(cwd)),
} as const;

export type SkipCondition = keyof typeof SKIP_CONDITIONS;

export const sessionSecretMissing = SKIP_CONDITIONS.sessionSecretMissing;
export const externalDeployment = SKIP_CONDITIONS.externalDeployment;
export const localBuildMissing = SKIP_CONDITIONS.localBuildMissing;
