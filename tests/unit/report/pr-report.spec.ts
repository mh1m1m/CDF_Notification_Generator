// The PR quality report builder (V13-QA-017; REQ-CICD-002; docs/qa/M1_OPEN_QA_ROWS_DESIGN.md §10): its readers, its
// sections, its redaction (SEC #132 rule 4), a planted Playwright run read end to end, and its CI wiring (inputs only
// through env, never `${{ }}` in `run:`; the job status the one expression in `env:`). SYNTHETIC values only.
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  A11Y_ATTACHMENT,
  buildReport,
  cell,
  CORRECTION_FALLBACK,
  CORRECTIONS,
  emptyFindings,
  firstLine,
  MAX_ROWS,
  readJUnit,
  readPlaywright,
  redact,
  REFLOW_ATTACHMENT,
  reportFromEnv,
} from "../../report/pr-report.mjs";

const ROOT = process.cwd();
const URL_WITH_PASSWORD = "postgres://cdf_v13_app:local-only-not-a-secret@127.0.0.1:5432/v13_local";
const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64");

describe("redaction and text", () => {
  it("redacts connection strings and credentials in any URL", () => {
    expect(redact(`connect ${URL_WITH_PASSWORD} failed`)).toBe("connect postgres://[redacted] failed");
    expect(redact("postgresql://u@h/db")).toBe("postgresql://[redacted]");
    expect(redact("see https://user:secret@example.test/x")).toBe("see https://[redacted]@example.test/x");
    expect(redact("https://example.test/a?b=c")).toBe("https://example.test/a?b=c");
  });

  // ARCH Q2 and SEC's notes on #173: libpq key=value strings, environment assignments, object forms and HTTP headers
  it.each([
    [
      "libpq keyword string",
      "connect host=127.0.0.1 user=cdf_v13_app password=local-only-not-a-secret dbname=v13",
      "connect host=127.0.0.1 user=cdf_v13_app password=[redacted] dbname=v13",
    ],
    ["libpq quoted value", "password='local only not a secret' port=5432", "password=[redacted] port=5432"],
    ["environment assignment", "PGPASSWORD=local-only-not-a-secret psql", "PGPASSWORD=[redacted] psql"],
    ["spaced assignment", "API_KEY = local-only-not-a-secret;", "API_KEY = [redacted];"],
    [
      "object, single quotes",
      "{ password: 'local-only-not-a-secret', user: 'u' }",
      "{ password: '[redacted]', user: 'u' }",
    ],
    ["JSON", '{"password":"local-only-not-a-secret","user":"u"}', '{"password":"[redacted]","user":"u"}'],
    ["JSON, spaced", '{ "session_token": "local-only-not-a-secret" }', '{ "session_token": "[redacted]" }'],
    [
      "Bearer header",
      "Authorization: Bearer local-only-not-a-secret.x_y",
      "Authorization: Bearer [redacted]",
    ],
    ["Basic header", "Authorization: Basic bG9jYWw6bm90LWEtc2VjcmV0", "Authorization: Basic [redacted]"],
  ])("redacts a credential: %s", (_, input, out) => {
    expect(redact(input)).toBe(out);
    expect(firstLine(input)).not.toContain("local-only-not-a-secret");
  });

  it.each([
    "token: valid",
    "the session token is valid",
    "expected password field to be visible",
    "password: unquoted prose after a colon",
  ])("leaves prose alone: %s", (text) => {
    expect(redact(text)).toBe(text);
  });

  it("takes the first non-empty line, without colour codes, redacted and cut", () => {
    expect(firstLine(`\n\n  \u001b[31mError:\u001b[39m ${URL_WITH_PASSWORD}\nsecond`)).toBe(
      "Error: postgres://[redacted]",
    );
    expect(firstLine("x".repeat(400))).toHaveLength(300);
    expect(firstLine(undefined)).toBe("");
  });

  it("keeps a table cell on one line and neutralises Markdown and HTML", () => {
    expect(cell("a|b\n`c` <img src=x>")).toBe("a\\|b 'c' &lt;img src=x&gt;");
  });
});

// The shape of Playwright 1.63's JSON report: suites by file, nested describes, specs, tests per project, results.
const PLAYWRIGHT_REPORT = {
  config: { rootDir: join(ROOT, "tests") },
  suites: [
    {
      title: "a11y/smoke.a11y.spec.ts",
      file: "a11y/smoke.a11y.spec.ts",
      specs: [
        {
          title: "sign-in page in Arabic",
          file: "a11y/smoke.a11y.spec.ts",
          line: 24,
          tests: [
            {
              projectName: "desktop-ar",
              status: "unexpected",
              results: [
                {
                  status: "failed",
                  errors: [{ message: `\u001b[2mexpect(\u001b[22mreceived).toEqual()\nmore` }],
                  attachments: [
                    {
                      name: A11Y_ATTACHMENT,
                      contentType: "application/json",
                      body: b64([{ rule: "color-contrast", impact: "serious", page: "/sign-in", nodes: 3 }]),
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
    {
      title: "a11y/reflow.a11y.spec.ts",
      file: "a11y/reflow.a11y.spec.ts",
      specs: [],
      suites: [
        {
          title: "text resize and reflow, en",
          file: "a11y/reflow.a11y.spec.ts",
          specs: [
            {
              title: "checks 1–4 on every page: reflow (320 × 256)",
              file: "a11y/reflow.a11y.spec.ts",
              line: 194,
              tests: [
                {
                  projectName: "desktop-ar",
                  status: "unexpected",
                  results: [
                    {
                      status: "failed",
                      errors: [{ message: "found" }],
                      attachments: [
                        {
                          name: REFLOW_ATTACHMENT,
                          contentType: "application/json",
                          body: b64([
                            {
                              page: "/portfolio",
                              language: "en",
                              condition: "reflow (320 × 256)",
                              check: 1,
                              detail: "div.x past the inline end",
                            },
                          ]),
                        },
                      ],
                    },
                  ],
                },
              ],
            },
            {
              title: "check 5: the focused skip link lies inside the viewport",
              file: "a11y/reflow.a11y.spec.ts",
              line: 208,
              tests: [
                {
                  projectName: "desktop-ar",
                  status: "unexpected",
                  results: [
                    { status: "failed", errors: [{ message: "expected 330 to be <= 320" }], attachments: [] },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
    {
      title: "visual/baseline.spec.ts",
      file: "visual/baseline.spec.ts",
      specs: [
        {
          title: "baseline: my-work / data",
          file: "visual/baseline.spec.ts",
          line: 44,
          tests: [
            {
              projectName: "visual-baseline",
              status: "flaky",
              results: [
                {
                  status: "failed",
                  errors: [{ message: "Screenshot comparison failed" }],
                  attachments: [
                    {
                      name: "my-work-data-ar-desktop-expected.png",
                      path: join(ROOT, "tests/visual/__screenshots__/x.png"),
                    },
                    {
                      name: "my-work-data-ar-desktop-actual.png",
                      path: join(ROOT, "test-results/playwright/a/x-actual.png"),
                    },
                    {
                      name: "my-work-data-ar-desktop-diff.png",
                      path: join(ROOT, "test-results/playwright/a/x-diff.png"),
                    },
                  ],
                },
                { status: "passed", errors: [], attachments: [] },
              ],
            },
          ],
        },
        {
          title: "passes",
          file: "visual/baseline.spec.ts",
          line: 90,
          tests: [{ projectName: "visual-baseline", status: "expected", results: [{ status: "passed" }] }],
        },
      ],
    },
  ],
};

describe("readPlaywright", () => {
  const f = readPlaywright(PLAYWRIGHT_REPORT, ROOT);

  it("lists unexpected and flaky tests with title, file:line and the first error line", () => {
    expect(f.tests.map((t) => [t.kind, t.title, t.where, t.error])).toEqual([
      [
        "failed",
        "sign-in page in Arabic [desktop-ar]",
        "tests/a11y/smoke.a11y.spec.ts:24",
        "expect(received).toEqual()",
      ],
      [
        "failed",
        "text resize and reflow, en › checks 1–4 on every page: reflow (320 × 256) [desktop-ar]",
        "tests/a11y/reflow.a11y.spec.ts:194",
        "found",
      ],
      [
        "failed",
        "text resize and reflow, en › check 5: the focused skip link lies inside the viewport [desktop-ar]",
        "tests/a11y/reflow.a11y.spec.ts:208",
        "expected 330 to be <= 320",
      ],
      [
        "flaky",
        "baseline: my-work / data [visual-baseline]",
        "tests/visual/baseline.spec.ts:44",
        "Screenshot comparison failed",
      ],
    ]);
  });

  it("reads the axe and reflow attachments, and a failed reflow test that attached none", () => {
    expect(f.axe).toEqual([{ rule: "color-contrast", impact: "serious", page: "/sign-in", nodes: 3 }]);
    expect(f.reflow).toEqual([
      {
        page: "/portfolio",
        language: "en",
        condition: "reflow (320 × 256)",
        check: 1,
        detail: "div.x past the inline end",
      },
    ]);
    expect(f.reflowFailures.map((t) => t.where)).toEqual(["tests/a11y/reflow.a11y.spec.ts:208"]);
  });

  it("reads errors outside any test (global setup, a file that did not load) from the report's top-level errors", () => {
    const g = readPlaywright(
      {
        config: { rootDir: join(ROOT, "tests") },
        suites: [],
        errors: [
          {
            message: `Error: global setup failed: ${URL_WITH_PASSWORD}\n    at setup`,
            location: { file: join(ROOT, "tests", "e2e", "global-setup.ts"), line: 12, column: 3 },
          },
          { message: "Error: Timed out waiting 60000ms from config.webServer." },
        ],
      },
      ROOT,
    );
    expect(g.runErrors).toEqual([
      { where: "tests/e2e/global-setup.ts:12", error: "Error: global setup failed: postgres://[redacted]" },
      { where: "", error: "Error: Timed out waiting 60000ms from config.webServer." },
    ]);
    expect(g.tests).toEqual([]);
  });

  it("groups a screenshot comparison's expected, actual and diff images by snapshot, as repository paths", () => {
    expect(f.shots).toEqual([
      {
        title: "baseline: my-work / data [visual-baseline]",
        name: "my-work-data-ar-desktop",
        expected: "tests/visual/__screenshots__/x.png",
        actual: "test-results/playwright/a/x-actual.png",
        diff: "test-results/playwright/a/x-diff.png",
      },
    ]);
  });
});

describe("readJUnit", () => {
  it("lists test cases with a failure or an error; passing and skipped ones are not findings", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8" ?>
<testsuites><testsuite name="tests/unit/a.spec.ts">
  <testcase classname="tests/unit/a.spec.ts" name="passes" time="0.1"></testcase>
  <testcase classname="tests/unit/a.spec.ts" name="self-closing" time="0.1"/>
  <testcase classname="tests/unit/a.spec.ts" name="skipped"><skipped/></testcase>
  <testcase classname="tests/unit/a.spec.ts" name="fails &amp; &quot;quotes&quot;" time="0.2">
    <failure message="expected &lt;a&gt; to be 1 ${URL_WITH_PASSWORD}" type="AssertionError">stack</failure>
  </testcase>
  <testcase classname="tests/unit/b.spec.ts" name="errors"><error type="Error">Error: boom
at x</error></testcase>
</testsuite></testsuites>`;
    expect(readJUnit(xml).tests).toEqual([
      {
        kind: "failed",
        title: 'fails & "quotes"',
        where: "tests/unit/a.spec.ts",
        error: "expected <a> to be 1 postgres://[redacted]",
      },
      { kind: "failed", title: "errors", where: "tests/unit/b.spec.ts", error: "Error: boom" },
    ]);
  });

  it("takes the line from the first ❯ frame in the test's own file (ARCH INFO on #173)", () => {
    const xml = `<testsuites><testsuite name="tests/unit/a.spec.ts">
  <testcase classname="tests/unit/a.spec.ts" name="fails"><failure message="expected 1 to be 2">AssertionError: expected 1 to be 2
 ❯ lib/helper.ts:7:9
 ❯ tests/unit/a.spec.ts:41:17
 ❯ tests/unit/a.spec.ts:90:3
</failure></testcase>
</testsuite></testsuites>`;
    expect(readJUnit(xml).tests[0]?.where).toBe("tests/unit/a.spec.ts:41");
  });
});

describe("buildReport", () => {
  const inputs = [{ name: "test-results/playwright-results.json", produced: true }];

  it("has every §10.1 section; performance stays open; no conformance claim", () => {
    const md = buildReport("End-to-end", emptyFindings(), inputs);
    for (const h of [
      "## PR quality report: End-to-end",
      "### Failed tests (0)",
      "### Screenshots (0)",
      "### UX findings: text resize and reflow (0)",
      "### Accessibility findings: axe (0)",
      "### Performance changes",
      "### Recommended corrections",
    ])
      expect(md).toContain(h);
    expect(md).toContain("Not measured in M1: no performance baseline or budget exists.");
    expect(md).toContain("This is not a claim of conformance");
    expect(md).not.toContain("Flaky tests");
  });

  it("fills the sections from the findings, with corrections from the fixed table and the fallback otherwise", () => {
    const f = readPlaywright(PLAYWRIGHT_REPORT, ROOT);
    f.axe.push({ rule: "no-such-rule", impact: "minor", page: "/x", nodes: 1 });
    const md = buildReport("Run", f, inputs);
    expect(md).toContain("### Failed tests (3)");
    expect(md).toContain("### Flaky tests: passed on a retry (1)");
    expect(md).toContain(
      "| baseline: my-work / data [visual-baseline] | my-work-data-ar-desktop | tests/visual/__screenshots__/x.png | test-results/playwright/a/x-actual.png | test-results/playwright/a/x-diff.png |",
    );
    expect(md).toContain("| /portfolio | en | reflow (320 × 256) | check 1 | div.x past the inline end |");
    expect(md).toContain(
      "check 5: the focused skip link lies inside the viewport [desktop-ar] | test failed |",
    );
    expect(md).toContain("| color-contrast | serious | /sign-in | 3 |");
    expect(md).toContain(`| axe:color-contrast | ${cell(CORRECTIONS["axe:color-contrast"]!)} |`);
    expect(md).toContain(`| reflow:1 | ${cell(CORRECTIONS["reflow:1"]!)} |`);
    expect(md).toContain(`| axe:no-such-rule | ${cell(CORRECTION_FALLBACK)} |`);
  });

  it("never writes a connection string, wherever it came from", () => {
    const f = emptyFindings();
    f.tests.push({ kind: "failed", title: `t ${URL_WITH_PASSWORD}`, where: "x", error: URL_WITH_PASSWORD });
    f.axe.push({ rule: "r", impact: "i", page: URL_WITH_PASSWORD, nodes: 1 });
    const md = buildReport(URL_WITH_PASSWORD, f, [{ name: URL_WITH_PASSWORD, produced: true }]);
    expect(md).not.toContain("local-only-not-a-secret");
    expect(md).not.toMatch(/postgres:\/\/[^[]/);
  });

  // ARCH Q1 on #173: a job that failed outside a test case never reads as "None."
  it.each([
    ["success", "None."],
    ["failure", "None listed, but **the job failed outside the listed tests**"],
    ["cancelled", "None listed, but **the job failed outside the listed tests**"],
    [undefined, "None listed in the reports."],
  ])("with no failed test and job status %s, Failed tests says %j", (status, text) => {
    const md = buildReport("Run", emptyFindings(), inputs, status);
    expect(md).toContain(`### Failed tests (0)\n\n${text}`);
    if (status) expect(md).toContain(`Job status when the report was built: **${status}**.`);
    else expect(md).not.toContain("Job status");
    if (status !== "success") expect(md).not.toMatch(/### Failed tests \(0\)\n\nNone\.$/m);
  });

  it("lists errors outside tests in their own section", () => {
    const f = emptyFindings();
    f.runErrors.push({ where: "tests/e2e/global-setup.ts:12", error: "Error: setup" });
    const md = buildReport("Run", f, inputs, "failure");
    expect(md).toContain("### Errors outside tests (1)");
    expect(md).toContain("| tests/e2e/global-setup.ts:12 | Error: setup |");
    expect(buildReport("Run", emptyFindings(), inputs, "success")).not.toContain("Errors outside tests");
  });

  it(`caps each section at ${MAX_ROWS} rows and counts the rest`, () => {
    const f = emptyFindings();
    for (let i = 0; i < MAX_ROWS + 7; i += 1)
      f.tests.push({ kind: "failed", title: `t${i}`, where: "x", error: "" });
    const md = buildReport("Run", f, inputs);
    expect(md.match(/^\| t\d+ \|/gm)).toHaveLength(MAX_ROWS);
    expect(md).toContain("… and 7 more (see the job's artifact).");
  });

  it("says when no test report was produced, and names an input that was not produced", () => {
    expect(buildReport("Run", emptyFindings(), [{ name: "a.json", produced: false }])).toContain(
      "**No test report was produced.**",
    );
    const md = buildReport("Run", emptyFindings(), [
      { name: "a.json", produced: true },
      { name: "b.json", produced: false },
    ]);
    expect(md).toContain("Named but not produced in this run: `b.json`.");
    expect(md).not.toContain("No test report was produced");
  });

  it("reads its inputs from the environment; a missing file is not an error", () => {
    const md = reportFromEnv({
      PR_REPORT_TITLE: "Unit tests",
      PR_REPORT_JUNIT: "test-results/no-such-junit.xml",
      PR_REPORT_PLAYWRIGHT: "",
    });
    expect(md).toContain("## PR quality report: Unit tests");
    expect(md).toContain("**No test report was produced.**");
  });

  it("reports a cut-short or invalid input as unreadable instead of throwing (ARCH and SEC INFOs on #173)", () => {
    const dir = mkdtempSync(join(ROOT, "test-results", "pr-report-"));
    try {
      const json = join(dir, "results.json");
      const xml = join(dir, "junit.xml");
      writeFileSync(json, JSON.stringify(PLAYWRIGHT_REPORT).slice(0, 200));
      writeFileSync(
        xml,
        `<testsuites><testsuite name="a"><testcase classname="tests/unit/a.spec.ts" name="before the cut"><failure message="m">x</failure></testcase><testcase classname="tests/unit/a.spec.ts" name="cu`,
      );
      const md = reportFromEnv(
        {
          PR_REPORT_TITLE: "Cut",
          PR_REPORT_PLAYWRIGHT: json,
          PR_REPORT_JUNIT: xml,
          PR_REPORT_JOB_STATUS: "failure",
        },
        ROOT,
      );
      expect(md).toContain("**No test report was produced.**");
      expect(md).toMatch(/\*\*Unreadable:\*\* `[^`]+results\.json`, `[^`]+junit\.xml`/);
      expect(md, "the cases before the cut still show").toContain(
        "| before the cut | tests/unit/a.spec.ts | m |",
      );
      expect(md).toContain("Job status when the report was built: **failure**.");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("end to end: a planted Playwright run read through its real JSON report", () => {
  it("names the failure, the axe and reflow findings, a screenshot's images, and redacts the error", () => {
    const dir = mkdtempSync(join(ROOT, "test-results", "pr-report-"));
    try {
      mkdirSync(join(dir, "img"));
      for (const n of ["expected", "actual", "diff"]) writeFileSync(join(dir, "img", `${n}.png`), "png");
      writeFileSync(
        join(dir, "planted.spec.ts"),
        'import { expect, test } from "@playwright/test";\n' +
          `test("fails", async () => {\n` +
          `  await test.info().attach(${JSON.stringify(A11Y_ATTACHMENT)}, { contentType: "application/json", body: JSON.stringify([{ rule: "label", impact: "critical", page: "/sign-in", nodes: 2 }]) });\n` +
          `  await test.info().attach(${JSON.stringify(REFLOW_ATTACHMENT)}, { contentType: "application/json", body: JSON.stringify([{ page: "/my-work", language: "ar", condition: "reflow (320 × 256)", check: 3, detail: "text clipped" }]) });\n` +
          `  for (const n of ["expected", "actual", "diff"]) await test.info().attach("shot-" + n + ".png", { path: ${JSON.stringify(join(dir, "img"))} + "/" + n + ".png", contentType: "image/png" });\n` +
          `  expect("${URL_WITH_PASSWORD}").toBe("ok");\n});\n` +
          'test("passes", () => {});\n',
      );
      writeFileSync(
        join(dir, "pw.config.ts"),
        'import { defineConfig } from "@playwright/test";\n' +
          'export default defineConfig({ testDir: ".", outputDir: "out", workers: 1, ' +
          `reporter: [["json", { outputFile: ${JSON.stringify(join(dir, "results.json"))} }]] });\n`,
      );
      const env: NodeJS.ProcessEnv = { ...process.env };
      delete env.CI;
      const run = spawnSync(
        process.execPath,
        [
          join(ROOT, "node_modules", "@playwright", "test", "cli.js"),
          "test",
          "--config",
          join(dir, "pw.config.ts"),
        ],
        { cwd: ROOT, env, encoding: "utf8", timeout: 120_000 },
      );
      expect(run.status, `${run.stdout}${run.stderr}`).toBe(1);
      const md = reportFromEnv(
        { PR_REPORT_TITLE: "Planted", PR_REPORT_PLAYWRIGHT: join(dir, "results.json") },
        ROOT,
      );
      expect(md).toContain("### Failed tests (1)");
      expect(md).toMatch(
        /\| fails \| test-results\/pr-report-[^/]+\/planted\.spec\.ts:2 \| Error: expect\(received\)\.toBe\(expected\)/,
      );
      expect(md).toContain("| label | critical | /sign-in | 2 |");
      expect(md).toContain("| /my-work | ar | reflow (320 × 256) | check 3 | text clipped |");
      expect(md).toMatch(
        /\| fails \| shot \| test-results\/pr-report-[^/]+\/\S+expected\S*\.png \| \S+actual\S*\.png \| \S+diff\S*\.png \|/,
      );
      expect(md).not.toContain("local-only-not-a-secret");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 120_000);
});

describe("end to end: a planted run that fails outside any test", () => {
  it("a spec file that does not load shows under Errors outside tests, and Failed tests does not say None.", () => {
    const dir = mkdtempSync(join(ROOT, "test-results", "pr-report-"));
    try {
      writeFileSync(
        join(dir, "broken.spec.ts"),
        `throw new Error("planted load failure ${URL_WITH_PASSWORD}");\n`,
      );
      writeFileSync(
        join(dir, "pw.config.ts"),
        'import { defineConfig } from "@playwright/test";\n' +
          'export default defineConfig({ testDir: ".", outputDir: "out", workers: 1, ' +
          `reporter: [["json", { outputFile: ${JSON.stringify(join(dir, "results.json"))} }]] });\n`,
      );
      const env: NodeJS.ProcessEnv = { ...process.env };
      delete env.CI;
      const run = spawnSync(
        process.execPath,
        [
          join(ROOT, "node_modules", "@playwright", "test", "cli.js"),
          "test",
          "--config",
          join(dir, "pw.config.ts"),
        ],
        { cwd: ROOT, env, encoding: "utf8", timeout: 120_000 },
      );
      expect(run.status, `${run.stdout}${run.stderr}`).toBe(1);
      const md = reportFromEnv(
        {
          PR_REPORT_TITLE: "Planted",
          PR_REPORT_PLAYWRIGHT: join(dir, "results.json"),
          PR_REPORT_JOB_STATUS: "failure",
        },
        ROOT,
      );
      expect(md).toContain("### Failed tests (0)");
      expect(md).toContain("None listed, but **the job failed outside the listed tests**");
      // Playwright 1.63 lists the load error, then "No tests found"
      expect(md).toContain("### Errors outside tests (2)");
      expect(md).toContain("|  | Error: No tests found |");
      expect(md).toMatch(
        /\| test-results\/pr-report-[^/]+\/broken\.spec\.ts:1 \| Error: planted load failure postgres:\/\/\[redacted\]/,
      );
      expect(md).not.toContain("local-only-not-a-secret");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 120_000);
});

describe("wiring", () => {
  const ci = readFileSync(join(ROOT, ".github", "workflows", "ci.yml"), "utf8");
  const steps = ci.split(/\n(?= {6}- )/).filter((s) => s.includes("node tests/report/pr-report.mjs"));

  it("CI runs the report in the unit, database, e2e and visual jobs, always, with inputs only through env", () => {
    expect(steps.map((s) => /PR_REPORT_TITLE: (.+)/.exec(s)?.[1])).toEqual([
      "Unit tests",
      "Database integration tests",
      "End-to-end (Playwright)",
      "Visual baselines (Playwright)",
    ]);
    for (const s of steps) {
      expect(s).toContain("if: always()");
      // ARCH Q1 on #173: the one expression allowed is the job status, and only in env
      expect(s).toContain("\n          PR_REPORT_JOB_STATUS: ${{ job.status }}\n");
      expect(
        s.replaceAll("PR_REPORT_JOB_STATUS: ${{ job.status }}", ""),
        "no other expression in the step",
      ).not.toContain("${{");
      expect(s).toContain("PR_REPORT_OUT: test-results/pr-report.md");
      expect(s).toMatch(/\n {8}run: node tests\/report\/pr-report\.mjs\n?$/);
    }
    expect(ci, "the visual artifact names the report").toContain("            test-results/pr-report.md\n");
  });

  it("the Playwright inputs CI names are the JSON report playwright.config.ts writes in CI", () => {
    const config = readFileSync(join(ROOT, "playwright.config.ts"), "utf8");
    expect(config).toContain('["json", { outputFile: "test-results/playwright-results.json" }]');
    for (const s of steps.filter((x) => x.includes("PR_REPORT_PLAYWRIGHT")))
      expect(s).toContain("PR_REPORT_PLAYWRIGHT: test-results/playwright-results.json");
  });

  it("the a11y specs attach their findings under the names the report reads", () => {
    const read = (f: string) => readFileSync(join(ROOT, "tests", "a11y", f), "utf8");
    for (const f of ["smoke.a11y.spec.ts", "not-found.a11y.spec.ts"])
      expect(read(f)).toContain(`const A11Y_ATTACHMENT = "${A11Y_ATTACHMENT}";`);
    expect(read("reflow.a11y.spec.ts")).toContain(`const REFLOW_ATTACHMENT = "${REFLOW_ATTACHMENT}";`);
  });
});
