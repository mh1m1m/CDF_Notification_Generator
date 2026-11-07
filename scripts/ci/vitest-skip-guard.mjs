// @ts-check
// The Vitest half of QA-019's post-run check (V13-ARCH-017): in CI's database job, every collected test of the
// integration project must run. A test that ends skipped (`it.skip`, `describe.skipIf(true)`, `ctx.skip()`), todo, or
// without a result, and a test file that collects no test, fail the run with the file, the line and the test's name.
//
// Why: CI's database job sets V13_DB_TESTS_REQUIRED=1, and the suites throw when their database is not ready (SEC-010,
// SEC-011). A suite that skips for any other reason, or a skip committed by mistake, still ended as a green job with
// "N skipped" in the log. In CI no database test skips (649 of 649 ran in run 42381717186 on `develop` f0f8437), so the
// guard has no allowance. A skip that is ever needed in CI comes through review, as a named allowance here. A local
// run with the flag and a test-name filter (`-t`) fails too, since the filtered-out tests end skipped.
//
// vitest.config.ts adds the reporter through `skipGuardReporters(process.env)`: only when V13_DB_TESTS_REQUIRED is "1",
// so a local `pnpm test:db` without a database still skips as before.

/** @typedef {{ name: string, line: number | null, state: string, mode: string }} GuardTest */
/** @typedef {{ file: string, tests: GuardTest[] }} GuardModule */
/** @typedef {{ file: string, line: number | null, name: string, reason: "skipped" | "todo" | "no result" | "no tests" }} GuardFinding */
/** @typedef {import("vitest/node").Reporter} Reporter */
/** @typedef {import("vitest/node").TestModule} TestModule */

/** The projects whose tests must all run when the guard is on. */
export const GUARDED_PROJECTS = Object.freeze(["integration"]);

/**
 * Every test that did not run, and every module that collected no test.
 * @param {readonly GuardModule[]} modules
 * @returns {GuardFinding[]}
 */
export function findUnrunTests(modules) {
  /** @type {GuardFinding[]} */
  const out = [];
  for (const m of modules) {
    if (m.tests.length === 0)
      out.push({ file: m.file, line: null, name: "(no test collected)", reason: "no tests" });
    for (const t of m.tests) {
      if (t.state === "passed" || t.state === "failed") continue;
      const reason = t.state === "skipped" ? (t.mode === "todo" ? "todo" : "skipped") : "no result";
      out.push({ file: m.file, line: t.line, name: t.name, reason });
    }
  }
  return out;
}

/**
 * One line per finding: `file:line name (reason)`.
 * @param {readonly GuardFinding[]} findings
 */
export const formatFindings = (findings) =>
  findings.map((f) => `  ${f.file}${f.line === null ? "" : `:${f.line}`} ${f.name} (${f.reason})`).join("\n");

/**
 * A Vitest reporter that fails the run when a guarded project's test did not run.
 * @implements {Reporter}
 */
export class SkipGuardReporter {
  /** @param {{ projects?: readonly string[] }} [options] */
  constructor(options = {}) {
    this.projects = options.projects ?? GUARDED_PROJECTS;
  }

  /** @param {ReadonlyArray<TestModule>} testModules */
  onTestRunEnd(testModules) {
    /** @type {GuardModule[]} */
    const modules = testModules
      .filter((m) => this.projects.includes(m.project.name))
      .map((m) => ({
        file: m.relativeModuleId,
        tests: [...m.children.allTests()].map((t) => ({
          name: t.fullName,
          line: t.location?.line ?? null,
          state: t.result().state,
          mode: t.options.mode,
        })),
      }));
    const findings = findUnrunTests(modules);
    if (findings.length === 0) return;
    const n = findings.length;
    process.stderr.write(
      `\nskip guard (V13-ARCH-017): ${n} test${n === 1 ? "" : "s"} in ${this.projects.join(", ")} did not run; ` +
        `in CI every database test must run:\n${formatFindings(findings)}\n`,
    );
    process.exitCode = 1;
  }
}

/**
 * The guard's reporters for this environment: one when V13_DB_TESTS_REQUIRED is "1" (CI's database job), none otherwise.
 * @param {Record<string, string | undefined>} env
 * @returns {SkipGuardReporter[]}
 */
export function skipGuardReporters(env) {
  return env.V13_DB_TESTS_REQUIRED === "1" ? [new SkipGuardReporter()] : [];
}
