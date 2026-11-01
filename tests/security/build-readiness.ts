// V13-SEC-012 · when SEC-APP-13's bundle scan may skip. `tests/security/e2e/surface.spec.ts` scans the local build's
// `.next/static`; a missing build used to skip that scan everywhere. playwright.config.ts builds the app before every
// locally started run, CI included, so a missing build in CI means the scan proved nothing: it now fails whenever any
// signal of `requiredBy()` (V13-SEC-010/011: a truthy `CI`, `V13_DB_TESTS_REQUIRED=1`, `GITHUB_ACTIONS=true`) is set,
// and skips (with the guard's allow-listed `test.skip`) only in a local run. Pure, so the unit project tests it.
// SYNTHETIC data only.
import { requiredBy } from "./db/readiness";

/** Returns normally when the build is present or no signal requires it; throws when a signal requires it. */
export function requireBuildWhenSignalled(
  label: string,
  present: boolean,
  env: Readonly<Record<string, string | undefined>> = process.env,
): void {
  if (present) return;
  const signals = requiredBy(env);
  if (signals.length > 0)
    throw new Error(
      `[security/e2e] ${label}: no local build (.next/static); in CI the build must exist (${signals.join(", ")}), so this fails, never skips`,
    );
}
