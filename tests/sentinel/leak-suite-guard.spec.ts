// Leak-suite guard (V13-QA-008; REQ-CASE-014, TEST_ARCHITECTURE.md §7.1): the suites that detect cross-case leaks
// carry no pin, no focus and no skip outside the allow-list, so a leak can never be waived in CI. Runs without a
// browser in the e2e job, before the suites it guards matter. Each forbidden form is planted into a synthetic source
// first, so a guard that cannot see it fails here before it is trusted. SYNTHETIC data only.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import ts from "typescript";
import {
  codeOnly,
  formatGuardViolations,
  guardLeakSuites,
  LEAK_SUITES,
  scanSuite,
  SKIP_ALLOWANCES,
  type SkipAllowance,
} from "../critic/leak-suite-guard";

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
      `const contest = { skip: 1 }; contest.skip; const latest = { only: 1 }; latest.only; submit.fail;`,
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
