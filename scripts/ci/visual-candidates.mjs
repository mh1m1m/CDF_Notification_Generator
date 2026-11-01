#!/usr/bin/env node
// @ts-check
// The visual job's candidate check (V13-ARCH-014; docs/qa/M1_OPEN_QA_ROWS_DESIGN.md §5, §8; ruling D2).
//
// While no baseline is committed under tests/visual/__screenshots__/, the `visual-baseline` project has nothing to
// compare with: every cell fails with "A snapshot doesn't exist" and tests/visual/baseline.spec.ts writes the cell's
// image to test-results/baseline-candidates/. .github/workflows/visual.yml then runs this check, which passes that run
// only when
//   - the runner exited 1 (failures), never 0 and never another code (a crash, an interrupted run);
//   - at least one test ran, none was skipped or flaky, and every test failed only with missing snapshots;
//   - test-results/baseline-candidates/ holds exactly one PNG per missing snapshot, under the snapshot's own name, and
//     nothing else;
//   - nothing exists under tests/visual/__screenshots__/ (the runner wrote no baseline: updateSnapshots "none", G7).
// Any other failure (a data check, a timeout, an unpainted frame, a missing candidate) fails the job. It prints each
// candidate's sha256 and size, so an image adopted from the job's artifact can be checked against the run that made it.
//
//   node scripts/ci/visual-candidates.mjs <runner exit code> <json report> <candidates dir> <screenshots dir>
//
// Once baselines are committed, the job compares instead and this check is not used.
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

/** Playwright's message for a snapshot that does not exist, under updateSnapshots "none". */
const MISSING = /^(?:Error: )?A snapshot doesn't exist at (\S+)\.$/;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * @typedef {{ message?: string }} ReportError
 * @typedef {{ status?: string, errors?: ReportError[] }} ReportResult
 * @typedef {{ status?: string, projectName?: string, results?: ReportResult[] }} ReportTest
 * @typedef {{ title?: string, tests?: ReportTest[] }} ReportSpec
 * @typedef {{ title?: string, specs?: ReportSpec[], suites?: ReportSuite[] }} ReportSuite
 * @typedef {{ suites?: ReportSuite[] }} Report
 * @typedef {{ title: string, test: ReportTest }} FoundTest
 */

/**
 * Every test of a Playwright JSON report (suites nest), with its spec title.
 * @param {Report} report
 * @returns {FoundTest[]}
 */
export function collectTests(report) {
  /** @type {FoundTest[]} */
  const out = [];
  /** @param {ReportSuite} suite */
  const walk = (suite) => {
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests ?? []) out.push({ title: spec.title ?? "(untitled)", test });
    }
    for (const child of suite.suites ?? []) walk(child);
  };
  for (const suite of report.suites ?? []) walk(suite);
  return out;
}

/** The file name at the end of a path, for either separator. @param {string} path */
const fileName = (path) => path.slice(Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")) + 1);

/**
 * Checks one candidate run. `candidates` maps each file in the candidates folder to its bytes; `screenshotFiles` lists
 * every file under the screenshots folder.
 * @param {{ exitCode: number, report: Report, candidates: Map<string, Buffer>, screenshotFiles: string[] }} run
 * @returns {{ problems: string[], missing: string[] }}
 */
export function checkCandidateRun({ exitCode, report, candidates, screenshotFiles }) {
  /** @type {string[]} */
  const problems = [];
  /** @type {Set<string>} */
  const missing = new Set();
  if (exitCode !== 1) problems.push(`the runner exited ${exitCode}; a candidate run fails with exit code 1`);
  const tests = collectTests(report);
  if (tests.length === 0) problems.push("the report holds no test");
  for (const { title, test } of tests) {
    if (test.status !== "unexpected") {
      problems.push(
        `${title}: status ${test.status ?? "unknown"}; every test must fail on missing snapshots only`,
      );
      continue;
    }
    const results = test.results ?? [];
    for (const [i, result] of results.entries()) {
      const errors = result.errors ?? [];
      if (errors.length === 0) problems.push(`${title}: attempt ${i + 1} failed without an error`);
      for (const error of errors) {
        const firstLine = (error.message ?? "").split("\n")[0]?.trim() ?? "";
        const match = MISSING.exec(firstLine);
        if (!match)
          problems.push(
            `${title}: attempt ${i + 1} failed for another reason: ${firstLine || "(no message)"}`,
          );
        else missing.add(fileName(/** @type {string} */ (match[1])));
      }
    }
  }
  for (const name of missing) {
    const bytes = candidates.get(name);
    if (!bytes) problems.push(`no candidate for the missing snapshot ${name}`);
    else if (!bytes.subarray(0, 8).equals(PNG_SIGNATURE))
      problems.push(`candidate ${name} is not a PNG image`);
  }
  for (const name of candidates.keys()) {
    if (!missing.has(name)) problems.push(`candidate ${name} matches no missing snapshot`);
  }
  for (const file of screenshotFiles)
    problems.push(`the run left a file under the baselines folder: ${file}`);
  return { problems, missing: [...missing].sort() };
}

/**
 * Every file under a folder, relative to it (an absent folder holds none).
 * @param {string} dir
 * @returns {string[]}
 */
function listFiles(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true, encoding: "utf8" }).filter((p) =>
    statSync(join(dir, p)).isFile(),
  );
}

/** @param {string[]} argv */
function main(argv) {
  if (argv.length !== 4) {
    console.error(
      "usage: visual-candidates.mjs <runner exit code> <json report> <candidates dir> <screenshots dir>",
    );
    return 2;
  }
  const [code, reportPath, candidatesDir, screenshotsDir] = /** @type {[string, string, string, string]} */ (
    argv
  );
  const exitCode = /^\d+$/.test(code) ? Number(code) : -1;
  /** @type {Report} */
  let report = {};
  try {
    report = JSON.parse(readFileSync(reportPath, "utf8"));
  } catch {
    console.error(`visual candidates: the JSON report ${reportPath} is missing or unreadable`);
    return 1;
  }
  /** @type {Map<string, Buffer>} */
  const candidates = new Map(
    listFiles(candidatesDir).map((name) => [name, readFileSync(join(candidatesDir, name))]),
  );
  const { problems, missing } = checkCandidateRun({
    exitCode,
    report,
    candidates,
    screenshotFiles: listFiles(screenshotsDir),
  });
  if (problems.length > 0) {
    console.error(`visual candidates: FAIL (${problems.length})`);
    for (const p of problems) console.error(`  - ${p}`);
    return 1;
  }
  console.log(
    `visual candidates: PASS, ${missing.length} candidates, no baseline written (sha256, bytes, file):`,
  );
  for (const name of missing) {
    const bytes = /** @type {Buffer} */ (candidates.get(name));
    console.log(`${createHash("sha256").update(bytes).digest("hex")}  ${bytes.length}  ${name}`);
  }
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2));
}
