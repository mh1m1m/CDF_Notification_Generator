// The repository checks in scripts/ci. Two run inside `pnpm lint`: logical CSS only (RTL/LTR), and .env.example holding
// documented names without values. The third is the visual job's candidate check (V13-ARCH-014,
// .github/workflows/visual.yml): a run without committed baselines passes only when it failed on missing snapshots alone
// and wrote one PNG candidate for each, and no baseline.
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { findReferencedEnvNames, parseEnvExample } from "@/scripts/ci/check-env-example.mjs";
import { findPhysicalClasses, findPhysicalCss } from "@/scripts/ci/check-logical-css.mjs";
import { checkCandidateRun, collectTests } from "@/scripts/ci/visual-candidates.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));

describe("check-logical-css", () => {
  it("flags physical properties, values and direction-dependent shorthands", () => {
    const css = [
      ".a { margin-left: 1rem; }",
      ".b { padding-right: 2px !important; }",
      ".c { border-left-width: 1px; }",
      ".d { left: 0; }",
      ".e { text-align: right; }",
      ".f { float: left; }",
      ".g { margin: 0 1rem 0 2rem; }",
      ".h { border-top-left-radius: 4px; }",
    ].join("\n");
    expect(findPhysicalCss(css).map((f) => f.line)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it("accepts logical properties, symmetric shorthands, selectors and comments", () => {
    const css = `/* margin-left: 1rem; is only a comment */
.a:hover { margin-inline-start: 1rem; padding-inline-end: 2px; inset-inline-start: 0; }
.b { text-align: start; float: inline-end; margin: 0 1rem 0 1rem; padding: 1px 2px; }
.c { border-start-start-radius: 4px; }`;
    expect(findPhysicalCss(css)).toEqual([]);
  });

  it("flags physical Tailwind utilities, including variants and important", () => {
    const source = `<div className="ml-2 md:pr-4 !left-0 text-right rounded-tl-lg border-l hover:-mr-1" />`;
    expect(findPhysicalClasses(source)).toHaveLength(7);
    expect(
      findPhysicalClasses(`<div className="ms-2 md:pe-4 start-0 text-start rounded-ss-lg border-s" />`),
    ).toEqual([]);
  });

  it("passes on the repository", () => {
    const run = spawnSync(process.execPath, [join(ROOT, "scripts", "ci", "check-logical-css.mjs")], {
      encoding: "utf8",
    });
    expect(run.status, run.stderr).toBe(0);
  });
});

describe("check-env-example", () => {
  it("accepts NAME= lines with a comment directly above", () => {
    expect(parseEnvExample("# One line.\nV13_EXAMPLE=\n\n# Another.\nexport PW_EXAMPLE=\n")).toEqual({
      names: ["V13_EXAMPLE", "PW_EXAMPLE"],
      findings: [],
    });
  });

  it("rejects values, missing comments, bad names, duplicates and NEXT_PUBLIC_*", () => {
    const { findings } = parseEnvExample(
      [
        "# Has a value.",
        "V13_A=something",
        "V13_B=",
        "# Bad name.",
        "v13_lower=",
        "# Browser-visible.",
        "NEXT_PUBLIC_X=",
        "# Twice.",
        "V13_A=",
        "# Not an assignment.",
        "V13_C",
      ].join("\n"),
    );
    const messages = findings.map((f) => `${f.line}: ${f.message}`);
    expect(messages).toEqual([
      "2: V13_A has a value; .env.example holds names only",
      "3: V13_B needs a one-line comment directly above it",
      '5: "v13_lower" is not an upper-snake variable name',
      "7: NEXT_PUBLIC_X: NEXT_PUBLIC_* values are sent to the browser; not allowed here",
      "9: V13_A is listed twice",
      "11: expected NAME= (names only)",
    ]);
  });

  it("finds the V13_* and PW_* names the code reads", () => {
    const names = findReferencedEnvNames(
      "process.env.V13_DATABASE_URL; env.V13_SESSION_SECRET; process.env.PW_CHROMIUM_PATH; process.env.NODE_ENV; env.CI",
    );
    expect([...names].sort()).toEqual(["PW_CHROMIUM_PATH", "V13_DATABASE_URL", "V13_SESSION_SECRET"]);
  });

  it("passes on the repository, whose .env.example holds names only", () => {
    const { names, findings } = parseEnvExample(readFileSync(join(ROOT, ".env.example"), "utf8"));
    expect(findings).toEqual([]);
    expect(names).toContain("V13_SESSION_SECRET");
    expect(names).toContain("V13_DATABASE_URL");
    const run = spawnSync(process.execPath, [join(ROOT, "scripts", "ci", "check-env-example.mjs")], {
      encoding: "utf8",
    });
    expect(run.status, run.stderr).toBe(0);
  });
});

describe("visual-candidates (V13-ARCH-014)", () => {
  const SHOTS = "/runner/work/app/tests/visual/__screenshots__";
  const PNG = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.from("synthetic"),
  ]);
  const missing = (name: string) => ({
    message: `Error: A snapshot doesn't exist at ${SHOTS}/${name}.\n\n  at baseline.spec.ts:46`,
  });
  // Two tests in nested suites, as Playwright's JSON reporter writes them: four missing snapshots in all.
  const report = (overrides: Record<string, unknown> = {}) => ({
    suites: [
      {
        title: "baseline.spec.ts",
        specs: [
          {
            title: "baseline: my-work / data",
            tests: [
              {
                status: "unexpected",
                results: [
                  {
                    errors: [missing("my-work-data-ar-desktop.png"), missing("my-work-data-en-desktop.png")],
                  },
                ],
                ...overrides,
              },
            ],
          },
        ],
        suites: [
          {
            title: "nested",
            specs: [
              {
                title: "baseline: workspace-switcher / data",
                tests: [
                  {
                    status: "unexpected",
                    results: [
                      {
                        errors: [
                          missing("workspace-switcher-data-ar-mobile.png"),
                          missing("workspace-switcher-data-en-mobile.png"),
                        ],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  });
  const NAMES = [
    "my-work-data-ar-desktop.png",
    "my-work-data-en-desktop.png",
    "workspace-switcher-data-ar-mobile.png",
    "workspace-switcher-data-en-mobile.png",
  ];
  const candidates = (names = NAMES) => new Map(names.map((n) => [n, PNG]));
  const run = (o: Partial<Parameters<typeof checkCandidateRun>[0]> = {}) =>
    checkCandidateRun({ exitCode: 1, report: report(), candidates: candidates(), screenshotFiles: [], ...o });

  it("passes a run that failed only on missing snapshots, with one PNG candidate each (the control)", () => {
    expect(collectTests(report())).toHaveLength(2);
    expect(run()).toEqual({ problems: [], missing: NAMES });
  });

  it("fails unless the runner exited 1", () => {
    expect(run({ exitCode: 0 }).problems).toEqual([
      "the runner exited 0; a candidate run fails with exit code 1",
    ]);
    expect(run({ exitCode: 130 }).problems).toEqual([
      "the runner exited 130; a candidate run fails with exit code 1",
    ]);
    expect(run({ exitCode: -1 }).problems).toHaveLength(1);
  });

  it("fails a test that failed for any other reason, even next to a missing snapshot", () => {
    const other = {
      status: "unexpected",
      results: [
        {
          errors: [
            missing("my-work-data-ar-desktop.png"),
            { message: "Error: data check V2: an address outside @example.test" },
          ],
        },
      ],
    };
    const { problems } = run({
      report: report(other),
      candidates: candidates(["my-work-data-ar-desktop.png", ...NAMES.slice(2)]),
    });
    expect(problems).toEqual([
      "baseline: my-work / data: attempt 1 failed for another reason: Error: data check V2: an address outside @example.test",
    ]);
    expect(
      run({
        report: report({ results: [{ errors: [{ message: "Test timeout of 180000ms exceeded." }] }] }),
        candidates: candidates(NAMES.slice(2)),
      }).problems,
    ).toEqual([
      "baseline: my-work / data: attempt 1 failed for another reason: Test timeout of 180000ms exceeded.",
    ]);
    expect(
      run({ report: report({ results: [{ errors: [] }] }), candidates: candidates(NAMES.slice(2)) }).problems,
    ).toEqual(["baseline: my-work / data: attempt 1 failed without an error"]);
  });

  it("fails a test that passed, was skipped or was flaky, and a report with no test", () => {
    for (const status of ["expected", "skipped", "flaky"]) {
      const { problems } = run({ report: report({ status }), candidates: candidates(NAMES.slice(2)) });
      expect(problems).toEqual([
        `baseline: my-work / data: status ${status}; every test must fail on missing snapshots only`,
      ]);
    }
    expect(run({ report: { suites: [] }, candidates: new Map() }).problems).toEqual([
      "the report holds no test",
    ]);
  });

  it("fails a missing, extra or non-PNG candidate", () => {
    expect(run({ candidates: candidates(NAMES.slice(1)) }).problems).toEqual([
      "no candidate for the missing snapshot my-work-data-ar-desktop.png",
    ]);
    expect(run({ candidates: new Map([...candidates(), ["stray.png", PNG]]) }).problems).toEqual([
      "candidate stray.png matches no missing snapshot",
    ]);
    const notPng = new Map(candidates());
    notPng.set("my-work-data-en-desktop.png", Buffer.from("GIF89a synthetic"));
    expect(run({ candidates: notPng }).problems).toEqual([
      "candidate my-work-data-en-desktop.png is not a PNG image",
    ]);
  });

  it("fails when the run left any file under the baselines folder", () => {
    expect(run({ screenshotFiles: ["my-work-data-ar-desktop.png"] }).problems).toEqual([
      "the run left a file under the baselines folder: my-work-data-ar-desktop.png",
    ]);
  });

  it("as a command: exit 0 with each candidate's sha256 on the control, exit 1 on a planted fault", () => {
    const dir = mkdtempSync(join(tmpdir(), "v13-visual-candidates-"));
    try {
      const reportFile = join(dir, "visual-baseline.json");
      const cands = join(dir, "baseline-candidates");
      const shots = join(dir, "__screenshots__");
      mkdirSync(cands);
      writeFileSync(reportFile, JSON.stringify(report()));
      for (const n of NAMES) writeFileSync(join(cands, n), PNG);
      const script = join(ROOT, "scripts", "ci", "visual-candidates.mjs");
      const exec = (code: string) =>
        spawnSync(process.execPath, [script, code, reportFile, cands, shots], { encoding: "utf8" });
      const ok = exec("1");
      expect(ok.status, ok.stderr).toBe(0);
      expect(ok.stdout).toContain("visual candidates: PASS, 4 candidates, no baseline written");
      expect(ok.stdout.trim().split("\n").slice(1)).toEqual(
        NAMES.map((n) =>
          expect.stringMatching(new RegExp(`^[0-9a-f]{64}  ${PNG.length}  ${n.replace(/\./g, "\\.")}$`)),
        ),
      );
      expect(exec("0").status).toBe(1);
      mkdirSync(shots);
      writeFileSync(join(shots, NAMES[0]!), PNG);
      const leftBaseline = exec("1");
      expect(leftBaseline.status).toBe(1);
      expect(leftBaseline.stderr).toContain("the run left a file under the baselines folder");
      rmSync(shots, { recursive: true });
      writeFileSync(reportFile, "{ not json");
      expect(exec("1").status).toBe(1);
      expect(spawnSync(process.execPath, [script, "1"], { encoding: "utf8" }).status).toBe(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
