// V13-SEC-010 · when SEC's database suites may skip. Locally, a missing cluster, migration or seed skips the suite with
// a warning, so `pnpm test:db` stays usable without a database. In CI (`CI` set, as GitHub Actions does) the test:db
// job resets the database before the run, so "not ready" there means the run proves nothing: the suite fails instead
// of skipping. This makes the leak-suite guard's allow-list reason for `describe.skipIf(!present)` (V13-QA-008)
// enforced, not only written. Pure, so the unit project tests it without a database. SYNTHETIC data only.

/** `ready` when the database can be used; otherwise false locally, and an error in CI. */
export function readinessVerdict(
  label: string,
  ready: boolean,
  why: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  if (ready) return true;
  const ci = env.CI !== undefined && env.CI !== "" && env.CI !== "0" && env.CI.toLowerCase() !== "false";
  if (ci)
    throw new Error(
      `[security/db] ${label}: ${why}; in CI the database must be ready, so this fails, never skips`,
    );
  console.warn(`[security/db] skipping ${label}: ${why}`);
  return false;
}
