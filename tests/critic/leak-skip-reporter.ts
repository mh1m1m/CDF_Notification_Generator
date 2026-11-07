// Leak-skip reporter (V13-QA-019; REQ-CASE-014, TEST_ARCHITECTURE.md §7.1): the run-time half of the leak-suite guard.
// The guard (leak-suite-guard.ts) reads each leak suite's source, and its listing check L1 compares what the runner
// registers with the file's own test calls, but neither can see a skip made while a test runs: test.skip() inside a
// body or a hook, a conditional test.skip(fn), or either one in a helper in another file. This reporter sees the run's
// results. When the run ends it fails the run (Reporter.onEnd may override the status, so the exit code is non-zero)
// for every test in a leak suite that:
//   - ended "skipped", unless its file has an allowance whose condition (tests/fixtures/skip-conditions.ts, the same
//     function the skipping test calls) holds at the end of the run AND every skip annotation of that result was
//     made in the leak suite itself (its location), where the static guard allows only the allow-listed calls; a
//     helper's skip in another file is never covered;
//   - has no result at all ("did not run": an interrupted run, max failures, a failed dependency);
//   - had an attempt pinned to fail at run time (test.fail(), test.fail(true, …) from a hook, or
//     test.info().expectedStatus = "failed", in a helper): the attempt ran with an expected status other than
//     "passed", so a failing leak assertion counted as expected. This is the run-time half of G1; no allowance covers it;
//   - had an attempt that ended "passed" while carrying errors (a hook overwrote the status after a failed assertion).
// If no test began (a `--list` run, or a run that ran nothing), there is nothing to judge and it does nothing.
// Registered in playwright.config.ts for every run, CI and local. SYNTHETIC only; reads results, writes stdout.
import { dirname, isAbsolute, relative } from "node:path";
import type {
  FullConfig,
  FullResult,
  Reporter,
  Suite,
  TestCase,
  TestResult,
} from "@playwright/test/reporter";
import { SKIP_CONDITIONS, type SkipCondition } from "../fixtures/skip-conditions";
import { LEAK_SUITES, SKIP_ALLOWANCES, type SkipAllowance } from "./leak-suite-guard";

export interface LeakTestOutcome {
  /** Repository-relative path. */
  file: string;
  line: number;
  title: string;
  /** The test's last result's status, or null when it has none. */
  status: TestResult["status"] | null;
  /** Repository-relative files where the last result's skip/fixme annotations were made ("" when one has none). */
  skipFiles?: readonly string[];
  /** Some attempt ran with an expected status other than "passed" (test.fail() or expectedStatus, at run time). */
  pinned?: boolean;
  /** Some attempt ended "passed" while carrying errors (its status was overwritten). */
  passedWithErrors?: boolean;
}

export type LeakFindingCause = "skipped" | "no result" | "pinned to fail" | "passed with errors";

export interface LeakSkipFinding {
  cause: LeakFindingCause;
  file: string;
  line: number;
  title: string;
}

/** The allowances a file may skip under right now: each condition is called, never re-implemented. */
export function holdingConditions(
  file: string,
  allow: readonly Pick<SkipAllowance, "file" | "holds">[],
  conditions: Readonly<Record<SkipCondition, () => boolean>> = SKIP_CONDITIONS,
): SkipCondition[] {
  return allow
    .filter((a): a is { file: string; holds: SkipCondition } => a.file === file && a.holds !== undefined)
    .map((a) => a.holds)
    .filter((c) => conditions[c]());
}

/**
 * Every leak test that ended skipped without a holding allowance for a skip made in its own file, has no result, was
 * pinned to fail, or passed with errors. `anyBegan` false (nothing ran, e.g. `--list`) returns nothing.
 */
export function leakSkipFindings(
  outcomes: readonly LeakTestOutcome[],
  anyBegan: boolean,
  allow: readonly Pick<SkipAllowance, "file" | "holds">[] = SKIP_ALLOWANCES,
  conditions: Readonly<Record<SkipCondition, () => boolean>> = SKIP_CONDITIONS,
): LeakSkipFinding[] {
  if (!anyBegan) return [];
  const out: LeakSkipFinding[] = [];
  for (const o of outcomes) {
    const at = { file: o.file, line: o.line, title: o.title };
    if (o.status === null) out.push({ cause: "no result", ...at });
    else if (o.status === "skipped") {
      const inOwnFile = (o.skipFiles ?? []).length > 0 && (o.skipFiles ?? []).every((f) => f === o.file);
      if (!inOwnFile || holdingConditions(o.file, allow, conditions).length === 0)
        out.push({ cause: "skipped", ...at });
    }
    if (o.pinned) out.push({ cause: "pinned to fail", ...at });
    if (o.passedWithErrors) out.push({ cause: "passed with errors", ...at });
  }
  return out.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
}

export const formatLeakSkipFindings = (f: readonly LeakSkipFinding[]) =>
  f.map((x) => `  ${x.cause}: ${x.file}:${x.line} › ${x.title}`).join("\n");

export interface LeakSkipReporterOptions {
  /** Repository-relative leak suites; the real list by default (planted runs pass their own). */
  suites?: readonly string[];
  /** Allowances as file + condition name; the real SKIP_ALLOWANCES by default. */
  allowances?: readonly { file: string; holds?: SkipCondition }[];
  /** The directory paths are relative to; the configuration file's directory by default. */
  root?: string;
}

export default class LeakSkipReporter implements Reporter {
  private readonly suites: ReadonlySet<string>;
  private readonly allowances: readonly { file: string; holds?: SkipCondition }[];
  private root: string;
  private readonly rootGiven: boolean;
  private tests: TestCase[] = [];
  private readonly last = new Map<TestCase, TestResult>();
  private readonly pinned = new Set<TestCase>();
  private readonly passedWithErrors = new Set<TestCase>();
  private began = false;

  constructor(options: LeakSkipReporterOptions = {}) {
    this.suites = new Set(options.suites ?? LEAK_SUITES);
    this.allowances = options.allowances ?? SKIP_ALLOWANCES;
    this.root = options.root ?? process.cwd();
    this.rootGiven = options.root !== undefined;
  }

  printsToStdio() {
    return false;
  }

  onBegin(config: FullConfig, suite: Suite) {
    if (config.configFile && !this.rootGiven) this.root = dirname(config.configFile);
    this.tests = suite.allTests().filter((t) => this.suites.has(this.fileOf(t)));
  }

  onTestBegin() {
    this.began = true;
  }

  onTestEnd(test: TestCase, result: TestResult) {
    this.began = true;
    this.last.set(test, result);
    // test.expectedStatus is this attempt's: a run-time test.fail() or expectedStatus assignment sets it to "failed"
    if (result.status !== "skipped" && test.expectedStatus !== "passed") this.pinned.add(test);
    if (result.status === "passed" && result.errors.length > 0) this.passedWithErrors.add(test);
  }

  async onEnd(result: FullResult): Promise<{ status: FullResult["status"] } | undefined> {
    const outcomes = this.tests.map((t): LeakTestOutcome => {
      const last = this.last.get(t);
      return {
        file: this.fileOf(t),
        line: t.location.line,
        // titlePath: the root, the project and the file come first, then describes and the title
        title: t.titlePath().slice(3).join(" › "),
        status: last?.status ?? null,
        skipFiles: (last?.annotations ?? [])
          .filter((a) => a.type === "skip" || a.type === "fixme")
          .map((a) => (a.location ? this.relativeFile(a.location.file) : "")),
        pinned: this.pinned.has(t),
        passedWithErrors: this.passedWithErrors.has(t),
      };
    });
    const findings = leakSkipFindings(outcomes, this.began, this.allowances);
    if (findings.length === 0) return undefined;
    process.stdout.write(
      `\nLeak-skip check (V13-QA-019): ${findings.length} leak-detection finding(s): a test did not run to a result ` +
        `or was waived at run time ` +
        `(TEST_ARCHITECTURE.md §7.1):\n${formatLeakSkipFindings(findings)}\n`,
    );
    return { status: result.status === "interrupted" ? "interrupted" : "failed" };
  }

  private fileOf(t: TestCase) {
    return this.relativeFile(t.location.file);
  }

  private relativeFile(f: string) {
    return (isAbsolute(f) ? relative(this.root, f) : f).split("\\").join("/");
  }
}
