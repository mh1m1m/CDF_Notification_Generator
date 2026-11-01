// Leak-suite guard (V13-QA-008; REQ-CASE-014, TEST_ARCHITECTURE.md §7.1): the suites that detect cross-case leaks
// carry no pin, no focus and no skip outside the allow-list, so a leak can never be waived in CI. Runs without a
// browser in the e2e job, before the suites it guards matter. Each forbidden form is planted into a synthetic source
// first, so a guard that cannot see it fails here before it is trusted. SYNTHETIC data only.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
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
  expect(LEAK_SUITES.length).toBeGreaterThanOrEqual(13);
  const v = guardLeakSuites(read);
  expect(v, formatGuardViolations(v)).toEqual([]);
});

test("each allow-listed skip is environment-conditional and gives its reason", () => {
  for (const a of SKIP_ALLOWANCES) {
    expect(LEAK_SUITES, a.file).toContain(a.file);
    expect(a.reason.length, a.file).toBeGreaterThan(40);
    // the condition is an environment check: the session secret, or SEC's database-ready probe
    expect(a.call.source, a.file).toMatch(/!process\\\.env\\\.V13_E2E_SESSION_SECRET|!present/);
  }
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
      `const contest = { skip() {} }; contest.skip(); const latest = { only: 1 }; latest.only; submit.fail;`,
    );
    expect(scanSuite(FILE, src, [])).toEqual([]);
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
    const src = "a\n// x\n'b\nc'\n/* d\ne */\nf";
    expect(codeOnly(src).split("\n")).toHaveLength(src.split("\n").length);
  });
});
