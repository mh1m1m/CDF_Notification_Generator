// Leak-suite guard (V13-QA-008; REQ-CASE-014, TEST_ARCHITECTURE.md §7.1): the suites that detect cross-case leaks
// carry no pin, no focus and no skip outside the allow-list, so a leak can never be waived in CI. Runs without a
// browser in the e2e job, before the suites it guards matter. Each forbidden form is planted into a synthetic source
// first, so a guard that cannot see it fails here before it is trusted. SYNTHETIC data only.
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { expect, test } from "@playwright/test";
import ts from "typescript";
import {
  checkEngineCoverage,
  checkListing,
  checkSnapshotConfig,
  checkSnapshotFlags,
  codeOnly,
  type EngineCoverage,
  filesPerProject,
  formatGuardViolations,
  guardLeakSuites,
  isPlaywrightSuite,
  LEAK_SUITES,
  listedTests,
  type ListedTest,
  scanSuite,
  SKIP_ALLOWANCES,
  type SkipAllowance,
  testCallLines,
} from "../critic/leak-suite-guard";
import { CHROMIUM_ONLY, CHROMIUM_PROJECT, CROSS_BROWSER_PROJECTS } from "../fixtures/browsers";

const ROOT = process.cwd();
const read = (file: string) => {
  const path = join(ROOT, file);
  return existsSync(path) ? readFileSync(path, "utf8") : null;
};
const rulesOf = (vs: { rule: string }[]) => [...new Set(vs.map((v) => v.rule))].sort();
const FILE = "tests/e2e/planted.spec.ts";
const wrap = (body: string) => `import { expect, test } from "@playwright/test";\n${body}\n`;

test("every §7.1 leak-detection suite exists and carries no pin, focus or unlisted skip", () => {
  expect(LEAK_SUITES.length).toBeGreaterThanOrEqual(15);
  const v = guardLeakSuites(read);
  expect(v, formatGuardViolations(v)).toEqual([]);
});

test("each allow-listed skip is environment-conditional and gives its reason", () => {
  for (const a of SKIP_ALLOWANCES) {
    expect(LEAK_SUITES, a.file).toContain(a.file);
    expect(a.reason.length, a.file).toBeGreaterThan(40);
    // the condition is the session secret, SEC's database-ready probe, or SEC's local-build checks
    expect(a.call.source, a.file).toMatch(
      /!process\\\.env\\\.V13_E2E_SESSION_SECRET|!present|!LOCAL_BUILD|!existsSync\\\(root\\\)/,
    );
  }
});

/**
 * The position just after the `{` of every test / it / describe / suite call's callback body (any chain:
 * test.describe.serial, …), found by the TypeScript parser, so a plant can go inside each one.
 */
function openerBodies(src: string): number[] {
  const sf = ts.createSourceFile("suite.ts", src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const out: number[] = [];
  const visit = (node: ts.Node) => {
    if (
      ts.isCallExpression(node) &&
      /^(?:test|it|describe|suite)(?:\.\w+)*$/.test(node.expression.getText(sf))
    ) {
      for (const a of node.arguments)
        if ((ts.isArrowFunction(a) || ts.isFunctionExpression(a)) && ts.isBlock(a.body))
          out.push(a.body.getStart(sf) + 1);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

test("a pin planted inside every test and describe body of every guarded suite is found, at its line", () => {
  let total = 0;
  for (const file of LEAK_SUITES) {
    const src = read(file)!;
    const at = openerBodies(src);
    expect(at.length, `${file} has test or describe bodies to plant into`).toBeGreaterThan(0);
    for (const i of at) {
      const planted = `${src.slice(0, i)} test.fixme(); ${src.slice(i)}`;
      const line = src.slice(0, i).split("\n").length;
      const v = scanSuite(file, planted);
      expect(
        v.map((x) => `${x.rule}:${x.line}`),
        `a test.fixme() planted at ${file}:${line} is found`,
      ).toEqual([`G1:${line}`]);
      total++;
    }
  }
  expect(total, "plants across the guarded suites").toBeGreaterThan(100);
});

test("CI fails a flaky run: a leak that fails once and passes on retry is not green", () => {
  // retries: 1 in CI would otherwise report a leak that fails on the first attempt as "flaky" and pass the job.
  const config = test.info().config;
  if (process.env.CI === "true") expect(config.failOnFlakyTests).toBe(true);
  else expect(config.failOnFlakyTests).toBe(false);
});

test("the allow-listed skips cannot fire in a locally started run: the worker has the session secret", () => {
  // negative-personas-pinning and Scenario C skip only without V13_E2E_SESSION_SECRET; playwright.config.ts sets it
  // for every locally started build (CI included). Only a run against an external V13_E2E_BASE_URL may lack it.
  if (!process.env.V13_E2E_BASE_URL?.trim())
    expect(process.env.V13_E2E_SESSION_SECRET?.trim(), "the run's session secret").toBeTruthy();
});

test.describe("planted negatives are refused", () => {
  const cases: [string, string, string][] = [
    // [form, source, rule]
    ["test.fail()", `test("t", async () => { test.fail(); });`, "G1"],
    [
      "test.fail(condition)",
      `test("t", async () => { test.fail(process.env.X === "1", "known leak"); });`,
      "G1",
    ],
    ["test.fail as a definition", `test.fail("t", async () => {});`, "G1"],
    ["test.fixme()", `test("t", async () => { test.fixme(); });`, "G1"],
    ["test.describe.fixme", `test.describe.fixme("d", () => {});`, "G1"],
    ["Vitest it.fails", `it.fails("t", () => {});`, "G1"],
    ["Vitest test.todo", `test.todo("later");`, "G1"],
    ["test.info().fail()", `test("t", async () => { test.info().fail(); });`, "G1"],
    ["testInfo.fixme()", `test("t", async ({}, testInfo) => { testInfo.fixme(); });`, "G1"],
    ["test.only", `test.only("t", async () => {});`, "G2"],
    ["test.describe.only", `test.describe.only("d", () => {});`, "G2"],
    ["test.describe.serial.only", `test.describe.serial.only("d", () => {});`, "G2"],
    ["Vitest describe.only", `describe.only("d", () => {});`, "G2"],
    ["Vitest it.only", `it.only("t", () => {});`, "G2"],
    ["fit", `fit("t", () => {});`, "G2"],
    ["test.skip()", `test("t", async () => { test.skip(); });`, "G3"],
    ["test.skip as a definition", `test.skip("t", async () => {});`, "G3"],
    ["test.skip(true)", `test("t", async () => { test.skip(true, "why"); });`, "G3"],
    ["test.describe.skip", `test.describe.skip("d", () => {});`, "G3"],
    ["Vitest it.skip", `it.skip("t", () => {});`, "G3"],
    ["Vitest describe.skipIf(true)", `describe.skipIf(true)("d", () => {});`, "G3"],
    ["xit", `xit("t", () => {});`, "G3"],
    ["xdescribe", `xdescribe("d", () => {});`, "G3"],
    ["testInfo.skip()", `test("t", async ({}, testInfo) => { testInfo.skip(); });`, "G3"],
    [
      "a conditional skip that is not on the allow-list",
      `test("t", async () => { test.skip(!process.env.V13_E2E_SESSION_SECRET, "needs the secret"); });`,
      "G3",
    ],
    ["a multi-line pin", `test("t", async () => {\n  test\n    .fail(\n      true,\n    );\n});`, "G1"],
    ["Vitest suite.only", `suite.only("d", () => {});`, "G2"],
    ["Vitest suite.skip", `suite.skip("d", () => {});`, "G3"],
    ["Vitest suite.todo", `suite.todo("later");`, "G1"],
    ["test.step.skip", `test("t", async () => { await test.step.skip("s", async () => {}); });`, "G3"],
    ["test.step.fixme", `test("t", async () => { await test.step.fixme("s", async () => {}); });`, "G1"],
    // a quote or a slash inside a regular-expression literal must not hide what follows (ARCH, review of cd15ddf)
    ["a focus after a regex holding a quote", `const r = /don't/;\ntest.only("t", async () => {});`, "G2"],
    [
      "a pin after a regex holding escaped slashes",
      `test("t", async () => {\n  const u = "x";\n  /https?:\\/\\//.test(u); test.fixme();\n});`,
      "G1",
    ],
    [
      "a pin after a regex holding a double quote",
      `const STACK = /relation "|SQLSTATE/i;\ntest("t", async () => {\n  test.fixme();\n});`,
      "G1",
    ],
    ["a pin after a division", `const half = 4 / 2;\ntest("t", async () => { test.fail(); });`, "G1"],
    // G5: the runner reached any way but a plain dotted chain or call (SEC, review of bf063a9)
    ["element access", `test("t", async () => {\n  test["fail"]();\n});`, "G5"],
    ["element access with a template", 'test("t", async () => {\n  test[`fixme`]();\n});', "G5"],
    ["element access deeper in the chain", `test.describe["only"]("d", () => {});`, "G5"],
    ["optional chaining", `test("t", async () => {\n  test?.fail();\n});`, "G5"],
    ["a non-null assertion", `test("t", async () => {\n  test!.fixme();\n});`, "G5"],
    ["parentheses", `test("t", async () => {\n  (test).fail();\n});`, "G5"],
    ["an alias", `const t = test;\nt.fail();`, "G5"],
    ["a destructured alias", `const { fixme } = test;\nfixme();`, "G5"],
    ["the runner passed as an argument", `wrap(test);`, "G5"],
    ["a renamed import", `import { test as base } from "@playwright/test";\nbase.fixme();`, "G5"],
    ["a namespace import", `import * as pw from "vitest";\npw.describe("d", () => {});`, "G5"],
    ["a runner imported from elsewhere", `import { test as t2 } from "./fixtures";`, "G5"],
    ["test imported from a fixture file", `import { test } from "./fixtures";`, "G5"],
    ["the runner declared again", `const test = base.extend({});`, "G5"],
    [
      "test.info() kept in a variable",
      `test("t", async () => {\n  const i = test.info();\n  i.fail();\n});`,
      "G5",
    ],
    ["testInfo under another name", `test("t", async ({}, info) => {\n  info.skip();\n});`, "G5"],
    ["Vitest retry on a describe", `describe("d", { retry: 3 }, () => {});`, "G5"],
    ["Vitest retry on a test", `it("t", { retry: 2 }, () => {});`, "G5"],
    ["Playwright retries in configure", `test.describe.configure({ retries: 2 });`, "G5"],
    ["retries under a computed key", `test.describe.configure({ ["retries"]: 1 });`, "G5"],
    // G6: the runners' options-object and annotation forms (ARCH, review of 488d93d; Vitest 5.0.3, Playwright 1.63.0)
    // Vitest: it(name, { skip: true }) is skipped
    ["Vitest { skip: true } on a test", `it("t", { skip: true }, () => {});`, "G6"],
    // Vitest: describe(name, { skip: true }) skips everything inside
    ["Vitest { skip: true } on a describe", `describe("d", { skip: true }, () => {});`, "G6"],
    // Vitest: { only: true } focuses, written here as a shorthand property
    ["Vitest { only } shorthand", `const only = true;\ndescribe("d", { only }, () => {});`, "G6"],
    // Vitest: { todo: true } turns the test into a todo, written here with a string key
    ["Vitest { 'todo': true }", `it("t", { "todo": true }, () => {});`, "G6"],
    // Vitest: { fails: true } turns a throwing body into an expected failure, written with a computed key
    ["Vitest { ['fails']: true }", `it("t", { ["fails"]: true }, () => {});`, "G6"],
    // Playwright: an annotation of type "skip" skips the test
    ["Playwright annotation skip", `test("t", { annotation: { type: "skip" } }, async () => {});`, "G6"],
    // Playwright: an annotation of type "fixme" skips it too, here in an array with a template string
    ["Playwright annotation fixme", 'test("t", { annotation: [{ type: `fixme` }] }, async () => {});', "G6"],
    // Playwright: an annotation of type "fail" turns a throwing body into a pass, here on a describe, computed key
    [
      "Playwright annotation fail on a describe",
      `test.describe("d", { annotation: { ["type"]: "fail" } }, () => {});`,
      "G6",
    ],
    // Playwright: an annotation pushed at run time
    [
      "a skip annotation pushed at run time",
      `test("t", async () => {\n  test.info().annotations.push({ type: "skip" });\n});`,
      "G6",
    ],
    // V13-QA-011 (SEC's INFO on #88): an annotation the parser cannot read as plain literals is refused, whatever it
    // would evaluate to, so a type built at run time ("sk" + "ip") cannot hide a skip
    [
      "an annotation type built by concatenation",
      `test("t", { annotation: { type: "sk" + "ip" } }, async () => {});`,
      "G6",
    ],
    [
      "an annotation type from a variable",
      `const k = "fixme";\ntest("t", { annotation: { type: k } }, async () => {});`,
      "G6",
    ],
    [
      "an annotation type in a template with a substitution",
      'const f = "fa";\ntest("t", { annotation: [{ type: `${f}il` }] }, async () => {});',
      "G6",
    ],
    [
      "an annotation option from a variable",
      `const a = { type: "issue" };\ntest("t", { annotation: a }, async () => {});`,
      "G6",
    ],
    [
      "an annotation option as a shorthand",
      `const annotation = { type: "issue" };\ntest("t", { annotation }, async () => {});`,
      "G6",
    ],
    [
      "an annotation array holding a variable",
      `const a = { type: "issue" };\ntest("t", { annotation: [a] }, async () => {});`,
      "G6",
    ],
    [
      "a spread inside an annotation",
      `const a = { type: "issue" };\ntest("t", { annotation: { ...a } }, async () => {});`,
      "G6",
    ],
    [
      "a computed key inside an annotation",
      `const k = "type";\ntest("t", { annotation: { [k]: "skip" } }, async () => {});`,
      "G6",
    ],
    [
      "an annotation pushed from a variable",
      `test("t", async () => {\n  const a = { type: "issue" };\n  test.info().annotations.push(a);\n});`,
      "G6",
    ],
    [
      "a pushed annotation with a built type",
      `test("t", async () => {\n  test.info().annotations.push({ type: ["sk", "ip"].join("") });\n});`,
      "G6",
    ],
    [
      "annotations reached by unshift",
      `test("t", async () => {\n  test.info().annotations.unshift({ type: "issue" });\n});`,
      "G6",
    ],
    [
      "annotations held in a variable",
      `test("t", async () => {\n  const list = test.info().annotations;\n  list.push({ type: "issue" });\n});`,
      "G6",
    ],
    [
      "annotations reached by element access and splice",
      `test("t", async ({}, testInfo) => {\n  testInfo["annotations"].splice(0, 0, { type: "issue" });\n});`,
      "G6",
    ],
  ];
  for (const [form, body, rule] of cases)
    test(`${form} → ${rule}`, () => {
      const v = scanSuite(FILE, wrap(body), []);
      expect(rulesOf(v), formatGuardViolations(v)).toEqual([rule]);
      expect(v[0]!.line, "the line of the call").toBeGreaterThan(1);
    });

  test("a missing suite and an unused allow-list entry → G4", () => {
    const stale: SkipAllowance = {
      file: FILE,
      call: /^test\.skip\(nothing\)$/,
      reason: "stale entry for the test",
    };
    const v = guardLeakSuites(
      (f) => (f === FILE ? wrap(`test("t", async () => {});`) : null),
      [FILE, "tests/e2e/gone.spec.ts"],
      [stale],
    );
    expect(rulesOf(v)).toEqual(["G4"]);
    expect(formatGuardViolations(v)).toContain("tests/e2e/gone.spec.ts");
    expect(formatGuardViolations(v)).toContain("matches nothing");
  });
});

test.describe("what is not a pin, focus or skip", () => {
  test("comments, strings and template literals that name the forms are not hits", () => {
    const src = wrap(
      [
        "// never test.fail() a leak; test.only and test.skip() are refused too",
        "/* test.fixme(); it.only(); xit( */",
        'test("a title that says test.only( and test.skip()", async () => {',
        "  const s = `test.fail(${1 + 1}) xdescribe(`;",
        "  expect(s).toBeTruthy();",
        "});",
      ].join("\n"),
    );
    expect(scanSuite(FILE, src, [])).toEqual([]);
  });

  test("identifiers that only end in test/it are not hits (contest.skip, latest.only, submit.fail)", () => {
    const src = wrap(
      `declare const contest: { skip: number }; contest.skip; declare const latest: any; latest.only; submit.fail;`,
    );
    expect(scanSuite(FILE, src, [])).toEqual([]);
    // calling such a method is G5 in a guarded suite, whatever the object (only test/it/describe/suite may be pinned)
    expect(rulesOf(scanSuite(FILE, wrap(`contest.skip();`), []))).toEqual(["G5"]);
  });

  test("an allow-listed conditional skip passes and marks its entry used", () => {
    const entry: SkipAllowance = {
      file: FILE,
      call: /^test\.skip\(!process\.env\.V13_E2E_SESSION_SECRET, "",? ?\)$/,
      reason: "the session secret is set for every locally started build",
    };
    const src = wrap(
      `test("t", async () => {\n  test.skip(\n    !process.env.V13_E2E_SESSION_SECRET,\n    "why",\n  );\n});`,
    );
    const used = new Set<SkipAllowance>();
    expect(scanSuite(FILE, src, [entry], used)).toEqual([]);
    expect(used.has(entry)).toBe(true);
    // the same call in another file is not covered by that file's entry
    expect(rulesOf(scanSuite("tests/e2e/other.spec.ts", src, [entry]))).toEqual(["G3"]);
  });

  test("codeOnly keeps line numbers", () => {
    const src = "a\n// x\n'b\nc'\n/* d\ne */\nf\n`g\n${h}\ni`\n/j\\//;\nk";
    expect(codeOnly(src).split("\n")).toHaveLength(src.split("\n").length);
  });

  test("an annotation of another type and a property named like a type are not hits", () => {
    const src = wrap(
      `test("t", { annotation: { type: "issue", description: "skip" } }, async () => {});\nconst x = { kind: "fixme" };`,
    );
    expect(scanSuite(FILE, src, [])).toEqual([]);
  });

  test("plain literal annotations, declared or pushed, are not hits (the control for the V13-QA-011 forms)", () => {
    const src = wrap(
      [
        'test("a", { annotation: [{ type: "issue", description: "OI-049" }, { type: `perf` }] }, async () => {});',
        'test("b", async () => {\n  test.info().annotations.push({ type: "issue", description: `x ${1}` });\n});',
        "const other = { type: someValue() };",
        "function someValue() {\n  return 1;\n}",
      ].join("\n"),
    );
    expect(scanSuite(FILE, src, [])).toEqual([]);
  });

  test("an unescaped regular expression that names the forms is not a hit", () => {
    // `test.only` and `it.skip(` here would match G2 and G3 if regex literals were left as code (ARCH, bf063a9)
    expect(scanSuite(FILE, wrap(`const r = /test.only|it.skip()/;\nexpect(r).toBeTruthy();`), [])).toEqual(
      [],
    );
  });

  test("a regular expression that names the forms is not a hit", () => {
    expect(
      scanSuite(FILE, wrap(`const r = /test\\.only\\(|it\\.skip\\(|"/;\nexpect(r).toBeTruthy();`), []),
    ).toEqual([]);
  });
});

// L1 (V13-QA-011): the runner's own listing against the files' own test calls, which closes the per-file scan's
// limit (a helper defined in another file). `--list` loads the files without a browser or a server.
const PLAYWRIGHT_CLI = join(ROOT, "node_modules", "@playwright", "test", "cli.js");
function playwrightList(
  args: readonly string[],
  env: Readonly<Record<string, string>> = {},
): { suites: Parameters<typeof listedTests>[0]["suites"] } {
  const out = execFileSync(process.execPath, [PLAYWRIGHT_CLI, "test", "--list", "--reporter=json", ...args], {
    cwd: ROOT,
    env: { ...process.env, ...env },
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    timeout: 120_000,
    stdio: ["ignore", "pipe", "pipe"],
  });
  return JSON.parse(out) as { suites: Parameters<typeof listedTests>[0]["suites"] };
}

test.describe("L1: what the runner registers is exactly each suite's own test calls", () => {
  test("every Playwright leak suite: each listed test comes from one of its own test( calls, each call is listed, all expected to pass", () => {
    const suites = LEAK_SUITES.filter((f) => isPlaywrightSuite(read(f)!));
    expect(suites.length, "the Playwright leak suites").toBeGreaterThanOrEqual(14);
    const listing = listedTests(playwrightList(suites));
    for (const f of suites) expect(listing.get(f)?.length ?? 0, `${f} registers tests`).toBeGreaterThan(0);
    const v = checkListing(listing, read, suites);
    expect(v, formatGuardViolations(v)).toEqual([]);
  });

  const SRC = wrap(
    [
      'test("a", async () => {});',
      'for (const l of ["ar", "en"]) test(`b ${l}`, async () => {});',
      'test.describe("d", () => {\n  test("c", async () => {});\n});',
    ].join("\n"),
  );
  const ok = (line: number, title = "t"): ListedTest => ({
    file: FILE,
    line,
    title,
    expectedStatus: "passed",
    annotations: [],
  });
  const clean = [ok(2), ok(3), ok(3), ok(5)];
  const reader = (src: string) => (f: string) => (f === FILE ? src : null);
  const l1 = (tests: ListedTest[], src = SRC) => checkListing(new Map([[FILE, tests]]), reader(src), [FILE]);

  test("the static side: the lines of the file's own test( calls", () => {
    expect([...testCallLines(SRC)].sort((a, b) => a - b)).toEqual([2, 3, 5]);
  });

  test("a listing that matches the calls is clean (the control)", () => {
    expect(l1(clean)).toEqual([]);
  });

  const planted: [string, ListedTest[]][] = [
    [
      "a test declared by a helper in another file",
      [...clean, { ...ok(2), file: "tests/fixtures/helper.ts" }],
    ],
    ["a test on a line that is not one of the file's test( calls", [...clean, ok(4)]],
    ["a test( call the runner does not register (a condition or dead code)", [ok(2), ok(3), ok(3)]],
    ["a suite that registers nothing", []],
    [
      "a test registered as expected to be skipped",
      [ok(2), ok(3), ok(3), { ...ok(5), expectedStatus: "skipped" }],
    ],
    ["a test registered as expected to fail", [ok(2), ok(3), ok(3), { ...ok(5), expectedStatus: "failed" }]],
    [
      "a fixme annotation from a helper",
      [ok(2), ok(3), ok(3), { ...ok(5), annotations: [{ type: "fixme" }] }],
    ],
    ["a skip annotation", [ok(2), ok(3), ok(3), { ...ok(5), annotations: [{ type: "skip" }] }]],
  ];
  for (const [form, tests] of planted)
    test(`${form} → L1`, () => {
      const v = l1(tests);
      expect(rulesOf(v), formatGuardViolations(v)).toEqual(["L1"]);
    });

  test("an unrelated annotation is not a hit", () => {
    expect(
      l1([ok(2), ok(3), ok(3), { ...ok(5), annotations: [{ type: "issue" }, { type: "serial" }] }]),
    ).toEqual([]);
  });

  test("end to end: a helper in another file that pins a test passes the per-file scan and is caught by L1", () => {
    const dir = mkdtempSync(join(ROOT, "test-results", "guard-l1-"));
    try {
      writeFileSync(
        join(dir, "helper.ts"),
        'import { test } from "@playwright/test";\nexport function leakCheck(name: string, body: () => Promise<void>) {\n  test.fixme(name, body);\n}\n',
      );
      const suite = wrap(
        'import { leakCheck } from "./helper";\ntest("visible", async () => {});\nleakCheck("hidden", async () => {});',
      );
      writeFileSync(join(dir, "planted.spec.ts"), suite);
      writeFileSync(
        join(dir, "pw.config.ts"),
        'import { defineConfig } from "@playwright/test";\nexport default defineConfig({ testDir: ".", testMatch: "*.spec.ts" });\n',
      );
      const file = relative(ROOT, join(dir, "planted.spec.ts"));
      // the per-file scan sees nothing: the pin is in the helper
      expect(scanSuite(file, suite, [])).toEqual([]);
      const listing = listedTests(
        playwrightList(["--config", join(dir, "pw.config.ts")]),
        `${relative(ROOT, dir)}/`,
      );
      const v = checkListing(listing, (f) => (f === file ? suite : null), [file]);
      expect(rulesOf(v), formatGuardViolations(v)).toEqual(["L1"]);
      expect(v.map((x) => x.detail).join("\n")).toMatch(/declared in another file|fixme|skipped/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

test.describe("G7: visual baselines are never written by the runner in CI (V13-QA-015, design §5.2)", () => {
  const CONFIG = "playwright.config.ts";
  const config = (props: string, extra = "") =>
    `import { defineConfig } from "@playwright/test";\n${extra}export default defineConfig({\n  testDir: "tests",\n${props}\n});\n`;
  const PINNED = '  updateSnapshots: "none",';

  test("the real config, every workflow and package.json are clean", () => {
    const src = read(CONFIG);
    expect(src).not.toBeNull();
    const v = [
      ...checkSnapshotConfig(CONFIG, src!),
      ...[".github/workflows/ci.yml", ".github/workflows/release.yml", "package.json"].flatMap((f) => {
        const text = read(f);
        return text === null ? [] : checkSnapshotFlags(f, text);
      }),
    ];
    expect(v, formatGuardViolations(v)).toEqual([]);
  });

  test("the pinned form is clean (the control), including readable spreads and literal element access", () => {
    const v = checkSnapshotConfig(
      CONFIG,
      config(
        `${PINNED}\n  ...(flag ? { globalTeardown: "./t.ts" } : {}),\n  use: { ...devices["Desktop Chrome"] },`,
        'const flag = true;\nconst devices = { "Desktop Chrome": {} };\n',
      ),
    );
    expect(v, formatGuardViolations(v)).toEqual([]);
  });

  const plantedConfigs: [string, string, string?][] = [
    ["no updateSnapshots at all (the default writes missing baselines)", ""],
    ['unconditional "all"', '  updateSnapshots: "all",'],
    ['unconditional "changed"', '  updateSnapshots: "changed",'],
    ['unconditional "missing"', '  updateSnapshots: "missing",'],
    [
      "the former CI-only form (a local run wrote baselines)",
      '  updateSnapshots: process.env.CI ? "none" : "missing",',
    ],
    ["the branches swapped", '  updateSnapshots: process.env.CI ? "missing" : "none",'],
    ["another condition", '  updateSnapshots: process.env.UPDATE ? "none" : "missing",'],
    ["a template literal", "  updateSnapshots: `none`,"],
    ["a variable holding none", `  updateSnapshots: mode,`, 'const mode = "none";\n'],
    ["the pinned value twice", `${PINNED}\n${PINNED}`],
    ["a project-level updateSnapshots", `${PINNED}\n  projects: [{ name: "p", updateSnapshots: "all" }],`],
    [
      "a shorthand property",
      `${PINNED}\n  projects: [{ updateSnapshots }],`,
      'const updateSnapshots = "all";\n',
    ],
    ["a string key", `${PINNED}\n  use: { "updateSnapshots": "all" },`],
    ["a computed key built from parts", `${PINNED}\n  [k]: "all",`, 'const k = "update" + "Snapshots";\n'],
    [
      "a spread of a variable",
      `${PINNED}\n  ...extra,`,
      'const extra = { updateSnapshots: "all" as const };\n',
    ],
    ["a spread of a call", `${PINNED}\n  ...extra(),`, "const extra = () => ({});\n"],
    [
      "an element access with a built name",
      PINNED,
      'const c: Record<string, string> = {};\nconst k = "u";\nc[k] = "all";\n',
    ],
    ["an assignment after the config", PINNED, ""],
  ];
  for (const [form, props, extra] of plantedConfigs)
    test(`config: ${form} → G7`, () => {
      const src =
        form === "an assignment after the config"
          ? config(props).replace("export default defineConfig(", "const cfg = defineConfig(") +
            'cfg.updateSnapshots = "all";\nexport default cfg;\n'
          : config(props, extra ?? "");
      const v = checkSnapshotConfig(CONFIG, src);
      expect(rulesOf(v), formatGuardViolations(v)).toEqual(["G7"]);
    });

  test("a config with no defineConfig object → G7", () => {
    expect(rulesOf(checkSnapshotConfig(CONFIG, "export default {};\n"))).toEqual(["G7"]);
  });

  const plantedFlags: [string, string, string][] = [
    [
      "a workflow --update-snapshots",
      ".github/workflows/ci.yml",
      "      - run: pnpm exec playwright test --update-snapshots",
    ],
    [
      "a workflow --update-snapshots=all",
      ".github/workflows/ci.yml",
      "        run: pnpm test:e2e --update-snapshots=all",
    ],
    ["a workflow -u", ".github/workflows/ci.yml", "      - run: pnpm exec playwright test -u"],
    [
      "a workflow --update-source-snapshots",
      ".github/workflows/ci.yml",
      "        run: npx playwright test --update-source-snapshots",
    ],
    ["a package script -u", "package.json", '    "test:visual": "playwright test -u",'],
    [
      "a package script -u before quotes",
      "package.json",
      '    "x": "playwright test --project=visual-baseline -u"',
    ],
  ];
  for (const [form, file, line] of plantedFlags)
    test(`flags: ${form} → G7, at its line`, () => {
      const v = checkSnapshotFlags(file, `name: x\n${line}\n`);
      expect(rulesOf(v), formatGuardViolations(v)).toEqual(["G7"]);
      expect(v.map((x) => x.line)).toEqual([2]);
    });

  test("flags: a -u that does not run the runner, and words containing -u, are not hits", () => {
    const text = [
      "      - run: git push -u origin x",
      "      - run: pnpm exec playwright test --project=visual-baseline",
      "      - run: sort -u list.txt",
      '    "test:e2e": "playwright test --grep-invert @slow-ui",',
    ].join("\n");
    expect(checkSnapshotFlags("ci.yml", text)).toEqual([]);
  });
});

// B1 (V13-QA-016): the Firefox and WebKit projects' testIgnore never takes a leak suite away from Chromium. The listing
// is the runner's own, with both engines selected; nothing is launched, so no Firefox or WebKit is needed here.
test.describe("B1: Chromium runs every Sentinel spec and leak suite; the engines run none of the Chromium-only ones", () => {
  // The visual projects are switched off here, so the listing's projects are exactly Chromium and the two engines in
  // any job that runs this spec.
  const ALL_ENGINES = { V13_E2E_BROWSERS: CROSS_BROWSER_PROJECTS.join(","), V13_E2E_VISUAL: "" };
  const sentinelSpecs = readdirSync(join(ROOT, "tests", "sentinel"))
    .filter((f) => f.endsWith(".spec.ts"))
    .map((f) => `tests/sentinel/${f}`);
  const coverage: EngineCoverage = {
    chromium: CHROMIUM_PROJECT,
    engines: CROSS_BROWSER_PROJECTS,
    required: [...new Set([...sentinelSpecs, ...LEAK_SUITES.filter((f) => isPlaywrightSuite(read(f)!))])],
    chromiumOnly: Object.keys(CHROMIUM_ONLY),
  };

  test("the real configuration, with both engines selected, is clean", () => {
    expect(sentinelSpecs.length, "the Sentinel specs").toBeGreaterThanOrEqual(6);
    const perProject = filesPerProject(playwrightList([], ALL_ENGINES));
    expect([...perProject.keys()].sort()).toEqual([CHROMIUM_PROJECT, ...CROSS_BROWSER_PROJECTS].sort());
    const v = checkEngineCoverage(perProject, read, coverage);
    expect(v, formatGuardViolations(v)).toEqual([]);
  });

  test("without V13_E2E_BROWSERS only Chromium is listed (a plain run needs no other engine)", () => {
    const perProject = filesPerProject(playwrightList([], { V13_E2E_BROWSERS: "", V13_E2E_VISUAL: "" }));
    expect([...perProject.keys()]).toEqual([CHROMIUM_PROJECT]);
  });

  test("an unknown name in V13_E2E_BROWSERS is refused, never a quiet Chromium-only run", () => {
    expect(() => playwrightList([], { V13_E2E_BROWSERS: "firefox" })).toThrow();
  });

  const SENTINEL = "tests/sentinel/planted-leak.spec.ts";
  const LEAK_E2E = "tests/e2e/scenario-a-case-switching.spec.ts";
  const ONLY = "tests/e2e/only.spec.ts";
  const SMOKE = "tests/e2e/smoke.spec.ts";
  const planted: EngineCoverage = {
    chromium: "desktop-ar",
    engines: ["firefox-ar", "webkit-ar"],
    required: [SENTINEL, LEAK_E2E],
    chromiumOnly: [ONLY],
  };
  const exists = (f: string) => ([SENTINEL, LEAK_E2E, ONLY, SMOKE].includes(f) ? "" : null);
  const clean = (): Map<string, Set<string>> =>
    new Map([
      ["desktop-ar", new Set([SENTINEL, LEAK_E2E, ONLY, SMOKE])],
      ["firefox-ar", new Set([SMOKE])],
      ["webkit-ar", new Set([SMOKE])],
    ]);
  const b1 = (m: Map<string, Set<string>>, c = planted) => checkEngineCoverage(m, exists, c);

  test("a listing that keeps every suite on Chromium is clean (the control)", () => {
    expect(b1(clean())).toEqual([]);
  });

  const cases: [string, (m: Map<string, Set<string>>) => void, EngineCoverage?][] = [
    ["Chromium no longer runs a Sentinel spec", (m) => m.get("desktop-ar")!.delete(SENTINEL)],
    ["Chromium no longer runs an e2e leak suite", (m) => m.get("desktop-ar")!.delete(LEAK_E2E)],
    ["the Chromium project is missing", (m) => m.delete("desktop-ar")],
    ["an engine runs a Sentinel spec", (m) => m.get("firefox-ar")!.add(SENTINEL)],
    [
      "an engine runs SEC's browser security suite",
      (m) => m.get("webkit-ar")!.add("tests/security/e2e/surface.spec.ts"),
    ],
    ["an engine runs a Chromium-only spec", (m) => m.get("webkit-ar")!.add(ONLY)],
    ["an engine project lists nothing", (m) => m.set("firefox-ar", new Set())],
    ["an engine project is missing", (m) => m.delete("webkit-ar")],
    [
      "a Chromium-only entry names no file",
      () => {},
      { ...planted, chromiumOnly: [ONLY, "tests/e2e/gone.spec.ts"] },
    ],
  ];
  for (const [form, plant, c] of cases)
    test(`${form} → B1`, () => {
      const m = clean();
      plant(m);
      const v = b1(m, c);
      expect(rulesOf(v), formatGuardViolations(v)).toEqual(["B1"]);
    });

  test("end to end: a testIgnore planted on the Chromium project is caught on the runner's listing", () => {
    const dir = mkdtempSync(join(ROOT, "test-results", "guard-b1-"));
    try {
      writeFileSync(join(dir, "leak.spec.ts"), wrap('test("leak", async () => {});'));
      writeFileSync(join(dir, "smoke.spec.ts"), wrap('test("smoke", async () => {});'));
      writeFileSync(
        join(dir, "pw.config.ts"),
        [
          'import { defineConfig } from "@playwright/test";',
          "export default defineConfig({",
          '  testDir: ".",',
          '  testMatch: "*.spec.ts",',
          "  projects: [",
          '    { name: "desktop-ar", testIgnore: "leak.spec.ts" },',
          '    { name: "firefox-ar", testMatch: "smoke.spec.ts" },',
          "  ],",
          "});",
          "",
        ].join("\n"),
      );
      const rel = `${relative(ROOT, dir)}/`;
      const perProject = filesPerProject(playwrightList(["--config", join(dir, "pw.config.ts")]), rel);
      expect(perProject.get("firefox-ar")).toEqual(new Set([`${rel}smoke.spec.ts`]));
      const v = checkEngineCoverage(perProject, () => "", {
        chromium: "desktop-ar",
        engines: [],
        required: [`${rel}leak.spec.ts`],
        chromiumOnly: [],
      });
      expect(rulesOf(v), formatGuardViolations(v)).toEqual(["B1"]);
      expect(v[0]!.detail).toMatch(/does not run this suite/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
