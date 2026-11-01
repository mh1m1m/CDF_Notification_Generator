// V13-SEC-010 · when SEC's database suites may skip. Locally, a missing cluster, migration or seed skips the suite with
// a warning, so `pnpm test:db` stays usable without a database. In CI (`CI` set, as GitHub Actions does) the test:db
// job resets the database before the run, so "not ready" there means the run proves nothing: the suite fails instead
// of skipping. This makes the leak-suite guard's allow-list reason for `describe.skipIf(!present)` (V13-QA-008)
// enforced, not only written. V13-SEC-011 (DB's suggestion on #91): three independent signals each require the
// database, so `CI=false` alone cannot turn the requirement off: a truthy `CI`, `V13_DB_TESTS_REQUIRED=1` (ci.yml sets
// it on the test:db job; tests/integration/support/clusters.ts honours it too) and `GITHUB_ACTIONS=true`. Pure, so the
// unit project tests it without a database. SYNTHETIC data only.

const truthy = (v: string | undefined) =>
  v !== undefined && v.trim() !== "" && v.trim() !== "0" && v.trim().toLowerCase() !== "false";

/** The signals that say this run must have a database; empty when none is set (a local run). */
export function requiredBy(env: Readonly<Record<string, string | undefined>>): string[] {
  const out: string[] = [];
  if (truthy(env.CI)) out.push("CI");
  if (env.V13_DB_TESTS_REQUIRED?.trim() === "1") out.push("V13_DB_TESTS_REQUIRED=1");
  if (env.GITHUB_ACTIONS?.trim().toLowerCase() === "true") out.push("GITHUB_ACTIONS");
  return out;
}

/** `ready` when the database can be used; otherwise false locally, and an error when any signal requires it. */
export function readinessVerdict(
  label: string,
  ready: boolean,
  why: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  if (ready) return true;
  const signals = requiredBy(env);
  if (signals.length > 0)
    throw new Error(
      `[security/db] ${label}: ${why}; in CI the database must be ready (${signals.join(", ")}), so this fails, never skips`,
    );
  console.warn(`[security/db] skipping ${label}: ${why}`);
  return false;
}
