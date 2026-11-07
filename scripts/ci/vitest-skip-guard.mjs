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
// The guard also checks that every test file ran (V13-ARCH-018, SEC's INFO on #166). It walks tests/integration and
// tests/security/db itself, without Vitest's include glob, and a test file there that the run did not collect fails it.
// That catches an include glob that drops or narrows a suite, a test file named outside the glob, a file argument on
// the command line, and a run with the flag that leaves out the integration project; a guarded directory that no
// longer exists fails it too. CI's invocations and the test:db script are pinned in tests/unit/ci-checks.spec.ts
// (scripts/ci/test-invocations.mjs): a `--reporter` on the command line would replace this reporter.
//
// vitest.config.ts adds the reporter through `skipGuardReporters(process.env)`: only when V13_DB_TESTS_REQUIRED is "1",
// so a local `pnpm test:db` without a database still skips as before.
import { readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";

/** @typedef {{ name: string, line: number | null, state: string, mode: string }} GuardTest */
/** @typedef {{ file: string, tests: GuardTest[] }} GuardModule */
/** @typedef {"skipped" | "todo" | "no result" | "no tests" | "not collected" | "directory not found"} GuardReason */
/** @typedef {{ file: string, line: number | null, name: string, reason: GuardReason }} GuardFinding */
/** @typedef {import("vitest/node").Reporter} Reporter */
/** @typedef {import("vitest/node").TestModule} TestModule */

/** The projects whose tests must all run when the guard is on. */
export const GUARDED_PROJECTS = Object.freeze(["integration"]);

/** The directories, from the root, whose every test file those projects must collect (V13-ARCH-018). */
export const GUARDED_ROOTS = Object.freeze(["tests/integration", "tests/security/db"]);

/** A test file by its name, whatever the include glob says: `x.spec.ts`, `x.test.mjs`, `x.spec.tsx`. */
export const TEST_FILE = /\.(spec|test)\.[cm]?[jt]sx?$/;

/** @param {string} path */
const posix = (path) => path.split(sep).join("/");

/**
 * Every test file under the guarded directories, found by walking them rather than through Vitest's include glob, as
 * root-relative paths with forward slashes. A directory that cannot be read is listed under `missing`.
 * @param {string} root
 * @param {readonly string[]} dirs
 * @returns {{ files: string[], missing: string[] }}
 */
export function listTestFiles(root, dirs) {
  /** @type {Set<string>} */
  const files = new Set();
  /** @type {string[]} */
  const missing = [];
  for (const dir of dirs) {
    let entries;
    try {
      entries = readdirSync(join(root, dir), { recursive: true, withFileTypes: true });
    } catch {
      missing.push(dir);
      continue;
    }
    for (const entry of entries)
      if (entry.isFile() && TEST_FILE.test(entry.name))
        files.add(posix(relative(root, join(entry.parentPath, entry.name))));
  }
  return { files: [...files].sort(), missing };
}

/**
 * Every guarded directory that was not found, and every test file the walk found that the run did not collect.
 * @param {{ files: readonly string[], missing: readonly string[] }} expected
 * @param {Iterable<string>} collected root-relative paths of the modules the guarded projects collected
 * @returns {GuardFinding[]}
 */
export function findUncollectedFiles(expected, collected) {
  const seen = new Set(collected);
  /** @type {GuardFinding[]} */
  const out = [];
  for (const dir of expected.missing)
    out.push({ file: dir, line: null, name: "", reason: "directory not found" });
  for (const file of expected.files)
    if (!seen.has(file)) out.push({ file, line: null, name: "", reason: "not collected" });
  return out;
}

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
 * One line per finding: `file:line name (reason)`, or `file (reason)` for a file or a directory.
 * @param {readonly GuardFinding[]} findings
 */
export const formatFindings = (findings) =>
  findings
    .map(
      (f) =>
        `  ${f.file}${f.line === null ? "" : `:${f.line}`}${f.name === "" ? "" : ` ${f.name}`} (${f.reason})`,
    )
    .join("\n");

/**
 * A Vitest reporter that fails the run when a guarded project's test or test file did not run.
 * @implements {Reporter}
 */
export class SkipGuardReporter {
  /** @param {{ projects?: readonly string[], roots?: readonly string[] }} [options] */
  constructor(options = {}) {
    this.projects = options.projects ?? GUARDED_PROJECTS;
    this.roots = options.roots ?? GUARDED_ROOTS;
    /** The run's root, which `roots` and the collected files are relative to; Vitest's own once onInit has run. */
    this.root = process.cwd();
  }

  /** @param {import("vitest/node").Vitest} vitest */
  onInit(vitest) {
    this.root = vitest.config.root;
  }

  /** @param {ReadonlyArray<TestModule>} testModules */
  onTestRunEnd(testModules) {
    const guarded = testModules.filter((m) => this.projects.includes(m.project.name));
    /** @type {GuardModule[]} */
    const modules = guarded.map((m) => ({
      file: m.relativeModuleId,
      tests: [...m.children.allTests()].map((t) => ({
        name: t.fullName,
        line: t.location?.line ?? null,
        state: t.result().state,
        mode: t.options.mode,
      })),
    }));
    const collected = guarded.map((m) => posix(relative(this.root, m.moduleId)));
    const findings = [
      ...findUncollectedFiles(listTestFiles(this.root, this.roots), collected),
      ...findUnrunTests(modules),
    ];
    if (findings.length === 0) return;
    const n = findings.length;
    process.stderr.write(
      `\nskip guard (V13-ARCH-017, V13-ARCH-018): ${n} finding${n === 1 ? "" : "s"} in ${this.projects.join(", ")}; ` +
        `in CI every database test file and every test must run:\n${formatFindings(findings)}\n`,
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
