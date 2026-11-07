// @ts-check
// V13-ARCH-020 · the runtime proof of CI's required runs. SYNTHETIC-DATA REFERENCE IMPLEMENTATION.
//
// The static checks read the workflows and refuse the forms that let a test step end green without its tests: W7 in
// tests/security/workflow-hardening.ts (V13-SEC-016, V13-SEC-017) and scripts/ci/test-invocations.mjs (V13-ARCH-018).
// No reading of a script sees every such form: a command shadowed with `hash -p`, a start-up file, an rc file, a
// wrapper, a hook. This check looks at what the run left instead. It is the last step of each required job, with
// `if: always()`, so it runs whatever happened before it:
//
//   node scripts/ci/required-runs.mjs <unit | integration | e2e | visual | cross-browser>
//
// It fails the job unless the run's own report (Vitest's JUnit XML, Playwright's JSON) is there and complete, was
// started within the last hour (so it is this run's, not one left in the workspace), counts at least one test, and
// records every test as run and passed: none failed, flaky, skipped, todo or without a result, none pinned to fail
// (Playwright's `test.fail()`), and no error outside the tests (an unhandled error, a file that does not load). For a
// Vitest run, every test file under the project's directories must be in the report with at least one test, no other
// file may be, and no test file may use Vitest's `.fails` or give a test or suite a `retry` option: the JUnit report
// records a test pinned to fail, and a retried test that failed and then passed, as passed, so these two rules read the
// sources (`retry` on TypeScript's syntax tree). ci-checks keeps both out of vitest.config.ts (a `retry`, or a tag that
// carries `retry` or `fails`, reaches every test that names it) and out of its setup files, and test-invocations bans
// `--retry`. For a Playwright run, every project the job selects must have tests, and no other project may have run.
//
// What it cannot see, where review and the static checks stand:
//   - code that runs in the job (a test, a global setup, a package script, a pnpm hook) can write any file: the report,
//     this script, or $GITHUB_ENV and $GITHUB_PATH, which reach this step (a NODE_OPTIONS written there at run time can
//     turn this check's exit code to 0; the workflows' own writes are refused statically, these are not). An action can
//     also export a variable;
//   - `.fails` or `retry` reached through indirection (`it["fails"]`, an options object spread in from a helper file,
//     `Object.defineProperty`). A `.fails` in a comment or a string is reported too: reword it;
//   - for a Playwright run, the files: a spec file dropped by the config's testMatch, testIgnore or grep passes if its
//     project still runs a test (playwright.config.ts is pinned in ci-checks and reviewed).
//
// Its static half, `checkProofSteps` (run by tests/unit/ci-checks.spec.ts): each required job ends with this step
// exactly; every job that runs a test is a required job, except visual-library.yml's opt-in library run, which is
// outside ARCH's merge rule; no workflow sets a variable that would reach this step's own shell or `node` (BASH_ENV,
// ENV, SHELLOPTS, BASHOPTS, BASH_FUNC_*, NODE_OPTIONS, PATH, LD_*), at any `env:` level or through $GITHUB_ENV, writes
// $GITHUB_PATH, or gives a required job or its workflow `defaults:` (a shell or working directory for the step). SEC's
// W0 refuses the flow-style YAML that would hide a key from this reading.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { isAbsolute, join, relative, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { findInvocations, runLines } from "./test-invocations.mjs";
import { GUARDED_ROOTS, listTestFiles } from "./vitest-skip-guard.mjs";

/**
 * @typedef {{ tool: "vitest", report: string, project: string, roots: readonly string[] }} VitestRun
 * @typedef {{ tool: "playwright", report: string, projects: readonly string[] }} PlaywrightRun
 * @typedef {VitestRun | PlaywrightRun} RequiredRun
 * @typedef {{ run: string, where: string, problem: string }} ProofFinding
 * @typedef {{ name: string, failure: boolean, error: boolean, skipped: boolean }} JUnitCase
 * @typedef {{ name: string, timestamp: string | null, tests: number | null, cases: JUnitCase[] }} JUnitSuite
 * @typedef {{ complete: boolean, tests: number | null, failures: number | null, errors: number | null,
 *   suites: JUnitSuite[] }} JUnitReport
 * @typedef {{ where: string, title: string, project: string, expectedStatus: string, status: string,
 *   results: string[] }} PlaywrightTest
 */

/** The report each tool writes in CI (vitest.config.ts `outputFile.junit`; playwright.config.ts's json reporter). */
export const VITEST_REPORT = "test-results/vitest-junit.xml";
export const PLAYWRIGHT_REPORT = "test-results/playwright-results.json";

/**
 * The runs ARCH's merge rule rests on (green CI and Cross-browser), by the name each job passes. A Vitest run names its
 * project and the directories its include globs cover (pinned to vitest.config.ts in ci-checks); a Playwright run names
 * the projects the job selects (pinned to playwright.config.ts and tests/fixtures/browsers.ts in ci-checks). The visual
 * job's proof is of the comparison with the committed baselines: candidate mode, which ran only while no baseline had
 * ever been committed (scripts/ci/visual-mode.mjs refuses it since), writes no comparison report.
 * @type {Readonly<Record<string, RequiredRun>>}
 */
export const RUNS = Object.freeze({
  unit: {
    tool: "vitest",
    report: VITEST_REPORT,
    project: "unit",
    roots: ["tests/unit", "tests/security/app"],
  },
  integration: { tool: "vitest", report: VITEST_REPORT, project: "integration", roots: GUARDED_ROOTS },
  e2e: { tool: "playwright", report: PLAYWRIGHT_REPORT, projects: ["desktop-ar", "access-audit"] },
  visual: { tool: "playwright", report: PLAYWRIGHT_REPORT, projects: ["visual-baseline"] },
  "cross-browser": { tool: "playwright", report: PLAYWRIGHT_REPORT, projects: ["firefox-ar", "webkit-ar"] },
});

/** A report must have started at most this long before the check (no test job runs longer than 40 minutes). */
export const MAX_AGE_MS = 60 * 60 * 1000;
/** ... and not after it, beyond this much clock difference. */
export const MAX_AHEAD_MS = 5 * 60 * 1000;

/** The test-file name a Vitest run must not pin to fail with: `.fails` (`it.fails`, `test.fails.each`) or `fails: true`. */
export const VITEST_FAILS = /\.fails\b|\bfails\s*:\s*true\b/;

/** @type {any} TypeScript's compiler, loaded on first use: only a Vitest run's proof reads sources with it. */
let typescript;

/**
 * The lines of a Vitest test file that give a test or a suite a `retry` option, read on TypeScript's syntax tree, so a
 * comment or a string never counts: a member of an object literal named `retry` (a key, quoted or computed from a
 * literal, a shorthand, a getter or a method), or an assignment, an increment or a decrement of a `.retry` or
 * `["retry"]` property. Vitest's JUnit report records a test that failed and then passed on a retry as passed, so a
 * retried test would hide an intermittent failure, the leak a guard exists to catch (SEC's R1 on #182).
 * @param {string} file the file's path, for its script kind @param {string} text
 * @returns {number[]} 1-based line numbers, ascending
 */
export function retryOptionLines(file, text) {
  typescript ??= createRequire(import.meta.url)("typescript");
  const ts = typescript;
  const kind = file.endsWith(".tsx")
    ? ts.ScriptKind.TSX
    : /\.[cm]?ts$/.test(file)
      ? ts.ScriptKind.TS
      : file.endsWith(".jsx")
        ? ts.ScriptKind.JSX
        : ts.ScriptKind.JS;
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind);
  /** @param {any} node a name or an element access's argument */
  const literal = (node) =>
    node && (ts.isIdentifier(node) || ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
      ? node.text
      : null;
  /** @param {any} name */
  const memberName = (name) =>
    name && ts.isComputedPropertyName(name)
      ? ts.isIdentifier(name.expression)
        ? null
        : literal(name.expression)
      : literal(name);
  /** @type {Set<number>} */
  const lines = new Set();
  /** @param {any} node */
  const at = (node) => lines.add(source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1);
  /** @param {any} target the property an assignment or an update writes */
  const isRetry = (target) =>
    (ts.isPropertyAccessExpression(target) && target.name.text === "retry") ||
    (ts.isElementAccessExpression(target) &&
      !ts.isIdentifier(target.argumentExpression) &&
      literal(target.argumentExpression) === "retry");
  /** @param {any} node */
  const visit = (node) => {
    if (ts.isObjectLiteralExpression(node))
      for (const member of node.properties) if (memberName(member.name) === "retry") at(member);
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
      node.operatorToken.kind <= ts.SyntaxKind.LastAssignment &&
      isRetry(node.left)
    )
      at(node);
    if (
      (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) &&
      (node.operator === ts.SyntaxKind.PlusPlusToken || node.operator === ts.SyntaxKind.MinusMinusToken) &&
      isRetry(node.operand)
    )
      at(node);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return [...lines].sort((a, b) => a - b);
}

/**
 * Where a loaded Vitest config would let a test that did not pass end passed in the JUnit report, each with its value:
 * a `retry` at its root or in a project, or a tag (`test.tags`, at the root or in a project) that carries `retry` or
 * `fails`, which every test that names the tag takes on. CI runs Vitest with none of them (retryOptionLines says why);
 * a `retry` of 0 and a `fails` of false are none.
 * @param {any} config the config module's default export
 * @returns {string[]}
 */
export function vitestConfigFindings(config) {
  /** @type {string[]} */
  const out = [];
  /** @param {string} where @param {any} test */
  const check = (where, test) => {
    const retry = test?.["retry"];
    if (retry !== undefined && retry !== 0) out.push(`${where}test.retry = ${JSON.stringify(retry)}`);
    const tags = test?.["tags"];
    if (Array.isArray(tags))
      for (const tag of tags) {
        const name = `${where}test.tags ${JSON.stringify(tag?.name)}`;
        if (tag?.retry !== undefined && tag.retry !== 0)
          out.push(`${name}: retry = ${JSON.stringify(tag.retry)}`);
        if (tag?.fails) out.push(`${name}: fails = ${JSON.stringify(tag.fails)}`);
      }
  };
  check("", config?.test);
  const projects = config?.test?.projects;
  if (Array.isArray(projects))
    projects.forEach((p, i) => {
      if (p && typeof p === "object") check(`project ${p.test?.name ?? i}: `, p.test);
    });
  return out;
}

/** The suite Vitest's JUnit reporter lists errors outside the tests under (an unhandled rejection, say). */
const UNHANDLED = "vitest unhandled errors";

/** @param {string} text */
const decode = (text) =>
  text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, "&");

/** @param {string} attrs */
function attributes(attrs) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const m of attrs.matchAll(/([\w:-]+)="([^"]*)"/g))
    out[/** @type {string} */ (m[1])] = decode(m[2] ?? "");
  return out;
}

/** @param {string | undefined} value */
const count = (value) => (value !== undefined && /^\d+$/.test(value) ? Number(value) : null);

/**
 * Reads Vitest's JUnit XML. The writer escapes `<` in every text, so a tag can be found by its name; a report that does
 * not end with `</testsuites>` was cut short.
 * @param {string} xml
 * @returns {JUnitReport}
 */
export function readJUnit(xml) {
  const text = xml.trim();
  const root = /<testsuites\b([^>]*)>/.exec(text);
  const top = attributes(root?.[1] ?? "");
  /** @type {JUnitSuite[]} */
  const suites = [];
  for (const s of text.matchAll(/<testsuite\b([^>]*?)(?:\/>|>([\s\S]*?)<\/testsuite>)/g)) {
    const a = attributes(s[1] ?? "");
    /** @type {JUnitCase[]} */
    const cases = [];
    for (const c of (s[2] ?? "").matchAll(/<testcase\b([^>]*?)(?:\/>|>([\s\S]*?)<\/testcase>)/g)) {
      const body = c[2] ?? "";
      cases.push({
        name: attributes(c[1] ?? "").name ?? "",
        failure: /<failure\b/.test(body),
        error: /<error\b/.test(body),
        skipped: /<skipped\b/.test(body),
      });
    }
    suites.push({ name: a.name ?? "", timestamp: a.timestamp ?? null, tests: count(a.tests), cases });
  }
  return {
    complete: root !== null && text.endsWith("</testsuites>"),
    tests: count(top.tests),
    failures: count(top.failures),
    errors: count(top.errors),
    suites,
  };
}

/**
 * A path as the job's log should show it: relative to the repository when it lies inside it.
 * @param {string} file @param {string} root
 */
const shown = (file, root) => {
  if (!root || !isAbsolute(file)) return file;
  const rel = relative(root, file);
  return rel.startsWith("..") || isAbsolute(rel) ? file : rel.split(sep).join("/");
};

/**
 * Every test in a Playwright JSON report, one per spec and project, its file shown relative to `root`.
 * @param {any} report @param {string} [root]
 * @returns {PlaywrightTest[]}
 */
export function playwrightTests(report, root = "") {
  const base = typeof report?.config?.rootDir === "string" ? report.config.rootDir : "";
  /** @type {PlaywrightTest[]} */
  const out = [];
  /** @param {any} suite @param {string[]} titles */
  const walk = (suite, titles) => {
    const here =
      suite?.title && !String(suite.file ?? "").endsWith(suite.title) ? [...titles, suite.title] : titles;
    for (const spec of suite?.specs ?? [])
      for (const t of spec?.tests ?? [])
        out.push({
          where: `${shown(join(base, String(spec.file ?? suite.file ?? "?")), root)}:${spec.line ?? 0}`,
          title: [...here, spec.title].join(" › "),
          project: String(t?.projectName ?? ""),
          expectedStatus: String(t?.expectedStatus ?? ""),
          status: String(t?.status ?? ""),
          results: (t?.results ?? []).map((/** @type {any} */ r) => String(r?.status ?? "")),
        });
    for (const child of suite?.suites ?? []) walk(child, here);
  };
  for (const s of report?.suites ?? []) walk(s, []);
  return out;
}

/** @param {unknown} text */
const firstLine = (text) =>
  String(text ?? "")
    // eslint-disable-next-line no-control-regex
    .replace(/\u001b\[[0-9;]*[A-Za-z]/g, "")
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l !== "")
    ?.slice(0, 200) ?? "";

/**
 * Whether a run's start time is this run's: not more than MAX_AGE_MS before `now`, not more than MAX_AHEAD_MS after.
 * @param {string | null | undefined} iso @param {number} now
 * @returns {string | null} the problem, or null
 */
function staleness(iso, now) {
  const t = iso ? Date.parse(iso) : Number.NaN;
  if (!Number.isFinite(t)) return "the report records no start time";
  if (t < now - MAX_AGE_MS) return `the run started at ${iso}, more than an hour ago: not this job's report`;
  if (t > now + MAX_AHEAD_MS) return `the run started at ${iso}, after the check`;
  return null;
}

/**
 * The findings for a Vitest run's JUnit report.
 * @param {string} name the run's name @param {VitestRun} run
 * @param {JUnitReport} report
 * @param {{ files: readonly string[], missing: readonly string[] }} expected the test files on disk
 * @param {Readonly<Record<string, string>>} sources each expected file's text, for the `.fails` and `retry` rules
 * @param {number} now
 * @returns {ProofFinding[]}
 */
export function checkVitestReport(name, run, report, expected, sources, now) {
  /** @type {ProofFinding[]} */
  const out = [];
  /** @param {string} where @param {string} problem */
  const hit = (where, problem) => out.push({ run: name, where, problem });
  if (!report.complete) hit(run.report, "the report is cut short or is not a JUnit report");
  const cases = report.suites.reduce((n, s) => n + s.cases.length, 0);
  if (cases === 0) hit(run.report, "the report counts no test");
  if (report.tests !== cases)
    hit(run.report, `the report's total (${report.tests ?? "none"}) differs from its test cases (${cases})`);
  if (report.failures !== 0 || report.errors !== 0)
    hit(
      run.report,
      `the report's totals record failures: ${report.failures ?? "none"}, errors: ${report.errors ?? "none"}`,
    );
  const starts = report.suites.map((s) => s.timestamp);
  const earliest = starts.includes(null) ? null : [...starts].sort()[0];
  const stale = staleness(earliest, now);
  if (stale) hit(run.report, stale);

  const inReport = new Set(report.suites.map((s) => s.name));
  const wanted = new Set(expected.files);
  for (const dir of expected.missing) hit(dir, "the directory the run's tests live in is not there");
  if (expected.files.length === 0 && expected.missing.length === 0)
    hit(run.roots.join(", "), "the run's directories hold no test file");
  const files = report.suites.filter((s) => s.name !== UNHANDLED);
  if (expected.files.length > 0 && files.length > 0 && files.every((s) => !wanted.has(s.name))) {
    hit(
      run.report,
      `the report holds none of this run's ${expected.files.length} test files: another run's report`,
    );
    return out;
  }
  for (const file of expected.files)
    if (!inReport.has(file)) hit(file, "a test file the report does not hold");
  for (const s of report.suites) {
    if (!wanted.has(s.name) && s.name !== UNHANDLED) hit(s.name, "not a test file of this run's directories");
    if (s.cases.length === 0) hit(s.name, "collected no test");
    if (s.tests !== null && s.tests !== s.cases.length)
      hit(s.name, `the file's total (${s.tests}) differs from its test cases (${s.cases.length})`);
    for (const c of s.cases) {
      if (c.error) hit(`${s.name} › ${c.name}`, "an error");
      if (c.failure) hit(`${s.name} › ${c.name}`, "failed");
      if (c.skipped) hit(`${s.name} › ${c.name}`, "skipped or todo");
    }
  }
  for (const [file, text] of Object.entries(sources))
    text.split("\n").forEach((line, i) => {
      if (VITEST_FAILS.test(line))
        hit(`${file}:${i + 1}`, "a test pinned to fail (`.fails`), which the JUnit report records as passed");
    });
  for (const [file, text] of Object.entries(sources))
    for (const line of retryOptionLines(file, text))
      hit(
        `${file}:${line}`,
        "a `retry` option: the JUnit report records a retried test as passed, even when an attempt failed",
      );
  return out;
}

/**
 * The findings for a Playwright run's JSON report.
 * @param {string} name @param {PlaywrightRun} run
 * @param {any} report the parsed JSON
 * @param {number} now
 * @param {string} [root] the repository, which the findings' paths are shown relative to
 * @returns {ProofFinding[]}
 */
export function checkPlaywrightReport(name, run, report, now, root = "") {
  /** @type {ProofFinding[]} */
  const out = [];
  /** @param {string} where @param {string} problem */
  const hit = (where, problem) => out.push({ run: name, where, problem });
  if (!report || typeof report !== "object" || !report.stats || !Array.isArray(report.suites)) {
    hit(run.report, "not a Playwright JSON report");
    return out;
  }
  for (const e of Array.isArray(report.errors)
    ? report.errors
    : [{ message: "the report's errors are unreadable" }]) {
    const at = e?.location ? `${shown(String(e.location.file), root)}:${e.location.line}` : run.report;
    hit(at, `an error outside the tests: ${firstLine(e?.message ?? e?.value ?? "")}`);
  }
  const stale = staleness(report.stats.startTime, now);
  if (stale) hit(run.report, stale);
  const tests = playwrightTests(report, root);
  if (tests.length === 0) hit(run.report, "the report counts no test");
  for (const p of run.projects)
    if (!tests.some((t) => t.project === p)) hit(run.report, `no test of the project ${p} ran`);
  for (const t of tests) {
    const at = `${t.where} ${t.title} [${t.project}]`;
    if (!run.projects.includes(t.project)) hit(at, "a project this run does not select");
    if (t.expectedStatus === "failed") hit(at, "pinned to fail (test.fail)");
    else if (t.expectedStatus !== "passed" && t.expectedStatus !== "skipped")
      hit(at, `expected to end ${t.expectedStatus}`);
    if (t.status === "skipped") hit(at, "skipped");
    else if (t.status === "flaky") hit(at, "flaky: failed, then passed on retry");
    else if (t.status !== "expected") hit(at, `failed (${t.status})`);
    if (t.results.length === 0) hit(at, "no result");
    else if (
      t.status === "expected" &&
      t.expectedStatus === "passed" &&
      t.results.some((r) => r !== "passed")
    )
      hit(at, `a result that is not passed (${t.results.join(", ")})`);
  }
  const s = report.stats;
  if (s.expected !== tests.length || s.unexpected !== 0 || s.flaky !== 0 || s.skipped !== 0)
    hit(
      run.report,
      `the report's totals (expected ${s.expected}, unexpected ${s.unexpected}, flaky ${s.flaky}, skipped ` +
        `${s.skipped}) are not ${tests.length} tests all passed`,
    );
  return out;
}

/**
 * Runs the proof for one named run in `root`.
 * @param {string} name @param {{ root: string, now?: number }} options
 * @returns {{ findings: ProofFinding[], summary: string }}
 */
export function proveRun(name, { root, now = Date.now() }) {
  const run = RUNS[name];
  if (!run) throw new Error(`unknown run "${name}"`);
  let text;
  try {
    text = readFileSync(join(root, run.report), "utf8");
  } catch {
    return {
      findings: [{ run: name, where: run.report, problem: "the run wrote no report: its tests did not run" }],
      summary: "",
    };
  }
  if (run.tool === "vitest") {
    const report = readJUnit(text);
    const expected = listTestFiles(root, run.roots);
    /** @type {Record<string, string>} */
    const sources = {};
    for (const f of expected.files) sources[f] = readFileSync(join(root, f), "utf8");
    const cases = report.suites.reduce((n, s) => n + s.cases.length, 0);
    return {
      findings: checkVitestReport(name, run, report, expected, sources, now),
      summary: `${cases} tests in ${report.suites.length} files passed (${run.report})`,
    };
  }
  let report;
  try {
    report = JSON.parse(text);
  } catch {
    return {
      findings: [{ run: name, where: run.report, problem: "the report is cut short or is not JSON" }],
      summary: "",
    };
  }
  const tests = playwrightTests(report, root);
  return {
    findings: checkPlaywrightReport(name, run, report, now, root),
    summary: `${tests.length} tests in ${run.projects.join(" and ")} passed (${run.report})`,
  };
}

/** @param {readonly ProofFinding[]} findings */
export const formatProofFindings = (findings) =>
  findings.map((f) => `  ${f.run}: ${f.where}: ${f.problem}`).join("\n");

// ---------------------------------------------------------------------------------------------------------------------
// The static half: the workflows.

/**
 * The shape of one line from `readWorkflow` (tests/security/workflow-hardening.ts).
 * @typedef {{ line: number, path: readonly string[], key: string | null, value: string | null,
 *   scalarOf: readonly string[] | null, text: string }} WorkflowLine
 * @typedef {{ file: string, lines: readonly WorkflowLine[] }} Workflow
 * @typedef {{ command: string, line: number }} Script
 * @typedef {{ file: string, line: number, detail: string }} StepFinding
 */

/** The jobs that end with the proof, and the run each one proves. */
export const PROOF_JOBS = Object.freeze([
  { file: ".github/workflows/ci.yml", job: "unit", run: "unit" },
  { file: ".github/workflows/ci.yml", job: "integration", run: "integration" },
  { file: ".github/workflows/ci.yml", job: "e2e", run: "e2e" },
  { file: ".github/workflows/ci.yml", job: "visual", run: "visual" },
  { file: ".github/workflows/cross-browser.yml", job: "e2e", run: "cross-browser" },
]);

/** Jobs that run a test without the proof, each with its reason. */
export const PROOF_EXEMPT = Object.freeze([
  {
    file: ".github/workflows/visual-library.yml",
    job: "library",
    why: "the opt-in screenshot library (label `visual-library`), outside ARCH's merge rule",
  },
]);

/** The name of the proof step, which the job's log shows. */
export const PROOF_STEP_NAME = "Required run proof";

/** Variables that would reach the proof step's own shell or `node` if a workflow set them. */
export const STARTUP_VARIABLE = /^(BASH_ENV|ENV|SHELLOPTS|BASHOPTS|BASH_FUNC_.*|NODE_OPTIONS|PATH|LD_.*)$/;

/** The one way a run script may write $GITHUB_ENV: `echo "NAME=value" >> "$GITHUB_ENV"`, one variable a line. */
const GITHUB_ENV_WRITE = /^echo "([A-Za-z_][A-Za-z0-9_]*)=[^"]*" >> "\$GITHUB_ENV"$/;

/** @param {readonly string[]} a @param {readonly string[]} b */
const startsWith = (a, b) => b.every((x, i) => a[i] === x);

/** Whether `path` is an `env:` block a step's process inherits: the workflow's, a job's or a step's. */
const isEnvBlock = (/** @type {readonly string[]} */ path) =>
  (path.length === 1 && path[0] === "env") ||
  (path.length === 3 && path[0] === "jobs" && path[2] === "env") ||
  (path.length === 5 && path[0] === "jobs" && path[2] === "steps" && path[4] === "env");

/**
 * The static half of the proof over the workflows (and the package.json scripts their runs go through).
 * @param {{ workflows: readonly Workflow[], scripts: Readonly<Record<string, Script>> }} input
 * @returns {StepFinding[]}
 */
export function checkProofSteps({ workflows, scripts }) {
  /** @type {StepFinding[]} */
  const out = [];
  /** @param {string} file @param {number} line @param {string} detail */
  const hit = (file, line, detail) => out.push({ file, line, detail });

  for (const pj of PROOF_JOBS) {
    const wf = workflows.find((w) => w.file === pj.file);
    const jobLine = wf?.lines.find(
      (l) => l.path.length === 2 && l.path[0] === "jobs" && l.path[1] === pj.job,
    );
    if (!wf || !jobLine) {
      hit(pj.file, 0, `the job ${pj.job} is missing: it runs the required run "${pj.run}"`);
      continue;
    }
    const stepLines = wf.lines.filter(
      (l) => startsWith(l.path, ["jobs", pj.job, "steps"]) && l.path.length >= 5,
    );
    const indexOf = (/** @type {WorkflowLine} */ l) => Number(/^\[(\d+)\]$/.exec(l.path[3] ?? "")?.[1] ?? -1);
    const last = Math.max(-1, ...stepLines.map(indexOf));
    const own = stepLines.filter((l) => indexOf(l) === last && l.path.length === 5);
    const keys = Object.fromEntries(own.map((l) => [l.key ?? "", l.value ?? ""]));
    const want = `node scripts/ci/required-runs.mjs ${pj.run}`;
    const at = own[0]?.line ?? jobLine.line;
    const ok =
      own.length === 3 &&
      keys.name === PROOF_STEP_NAME &&
      keys.if === "always()" &&
      keys.run === want &&
      wf.lines.every(
        (l) => !(startsWith(l.path, ["jobs", pj.job, "steps", `[${last}]`]) && l.path.length > 5),
      ) &&
      own.every((l) => l.scalarOf === null);
    if (!ok)
      hit(
        pj.file,
        at,
        `the ${pj.job} job must end with exactly this step: name: ${PROOF_STEP_NAME}, if: always(), run: ${want}`,
      );
  }

  const covered = new Set([...PROOF_JOBS, ...PROOF_EXEMPT].map((j) => `${j.file} ${j.job}`));
  /** @type {Set<string>} */
  const seen = new Set();
  for (const r of findInvocations({ workflows, scripts })) {
    const key = `${r.file} ${r.job}`;
    if (covered.has(key) || seen.has(key)) continue;
    seen.add(key);
    hit(r.file, r.line, `the ${r.job ?? "?"} job runs a test but does not end with the required run proof`);
  }

  for (const wf of workflows) {
    const proofJobs = new Set(PROOF_JOBS.filter((j) => j.file === wf.file).map((j) => j.job));
    for (const l of wf.lines) {
      if (l.scalarOf !== null) continue;
      if (
        l.key === "defaults" &&
        proofJobs.size > 0 &&
        (l.path.length === 1 ||
          (l.path.length === 3 && l.path[0] === "jobs" && proofJobs.has(l.path[1] ?? "")))
      )
        hit(
          wf.file,
          l.line,
          "defaults: where a job ends with the proof: its run settings would reach the proof step",
        );
      if (l.key === "env" && isEnvBlock(l.path) && (l.value ?? "") !== "")
        hit(wf.file, l.line, "an env: block on one line ({ … } or an alias), so its names cannot be checked");
      else if (isEnvBlock(l.path) && l.key === null)
        hit(
          wf.file,
          l.line,
          "a line in an env: block that is not NAME: value, so its name cannot be checked",
        );
      else if (l.key !== null && isEnvBlock(l.path.slice(0, -1)) && STARTUP_VARIABLE.test(l.key))
        hit(
          wf.file,
          l.line,
          `${l.key} in env: reaches the shell or node of later steps, the proof's included`,
        );
    }
    for (const run of runLines(wf))
      for (const p of run.pieces) {
        const t = p.text.trim();
        if (t.startsWith("#")) continue; // a shell comment line writes nothing
        if (/GITHUB_PATH/.test(t))
          hit(wf.file, p.line, "$GITHUB_PATH is never written: it would shadow node");
        if (!/GITHUB_ENV/.test(t)) continue;
        const m = GITHUB_ENV_WRITE.exec(t);
        if (!m)
          hit(
            wf.file,
            p.line,
            'write $GITHUB_ENV only as echo "NAME=value" >> "$GITHUB_ENV", one literal name a line',
          );
        else if (STARTUP_VARIABLE.test(m[1] ?? ""))
          hit(wf.file, p.line, `${m[1]} through $GITHUB_ENV reaches the shell or node of later steps`);
      }
  }
  return out.sort(
    (a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.detail.localeCompare(b.detail),
  );
}

/** @param {readonly StepFinding[]} findings */
export const formatStepFindings = (findings) =>
  findings.map((f) => `  ${f.file}:${f.line} ${f.detail}`).join("\n");

// ---------------------------------------------------------------------------------------------------------------------

/** @param {string[]} argv */
function main(argv) {
  const name = argv[0];
  if (argv.length !== 1 || name === undefined || !Object.hasOwn(RUNS, name)) {
    process.stderr.write(`usage: node scripts/ci/required-runs.mjs <${Object.keys(RUNS).join(" | ")}>\n`);
    return 2;
  }
  const { findings, summary } = proveRun(name, { root: process.cwd() });
  if (findings.length > 0) {
    const n = findings.length;
    process.stderr.write(
      `required run proof (V13-ARCH-020): "${name}" did not run and pass in full; ${n} finding${n === 1 ? "" : "s"}:\n` +
        `${formatProofFindings(findings.slice(0, 200))}\n` +
        (n > 200 ? `  … and ${n - 200} more\n` : ""),
    );
    return 1;
  }
  process.stdout.write(`required run proof (V13-ARCH-020): "${name}": ${summary}\n`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  process.exitCode = main(process.argv.slice(2));
