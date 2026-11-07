// The repository checks in scripts/ci. Two run inside `pnpm lint`: logical CSS only (RTL/LTR), and .env.example holding
// documented names without values. Two belong to the `visual` job of .github/workflows/ci.yml: the candidate check
// (V13-ARCH-014: a run without committed baselines passes only when it failed on missing snapshots alone and wrote one
// PNG candidate for each, and no baseline), and the mode (V13-ARCH-015: candidate mode is refused once baselines have
// been committed, so deleting every baseline fails the job). Then the trigger of .github/workflows/cross-browser.yml
// (V13-ARCH-016: every pull request and every push to develop), the skip guard of CI's database job (V13-ARCH-017:
// an integration test that did not run fails the run), and the guards' own coverage (V13-ARCH-018: a database test file
// the run did not collect fails it, and CI's test runs pass no reporter, config or filter that would keep a test from
// its guard), and the runtime proof of each required run (V13-ARCH-020: the job's last step reads the run's own report
// and fails unless every test ran and passed; its static half pins that step and keeps start-up variables out of the
// workflows).
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterAll, describe, expect, it, vi } from "vitest";
import { findReferencedEnvNames, parseEnvExample } from "@/scripts/ci/check-env-example.mjs";
import { findPhysicalClasses, findPhysicalCss } from "@/scripts/ci/check-logical-css.mjs";
import { checkCandidateRun, collectTests } from "@/scripts/ci/visual-candidates.mjs";
import { decideVisualMode } from "@/scripts/ci/visual-mode.mjs";
import {
  checkProofSteps,
  formatProofFindings,
  formatStepFindings,
  PLAYWRIGHT_REPORT,
  PROOF_JOBS,
  proveRun,
  RUNS,
  VITEST_REPORT,
} from "@/scripts/ci/required-runs.mjs";
import {
  checkTestInvocations,
  findInvocations,
  formatInvocationFindings,
  splitCommands,
} from "@/scripts/ci/test-invocations.mjs";
import {
  findUncollectedFiles,
  findUnrunTests,
  formatFindings,
  GUARDED_PROJECTS,
  GUARDED_ROOTS,
  listTestFiles,
  SkipGuardReporter,
  skipGuardReporters,
} from "@/scripts/ci/vitest-skip-guard.mjs";
import { readWorkflow, workflowFiles } from "@/tests/security/workflow-hardening";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const WORKFLOWS = join(ROOT, ".github", "workflows");
/** package.json's scripts, each with its line. */
const scriptsOf = (source: string) => {
  const lines = source.split("\n");
  const scripts = (JSON.parse(source) as { scripts: Record<string, string> }).scripts;
  return Object.fromEntries(
    Object.entries(scripts).map(([name, command]) => [
      name,
      { command, line: lines.findIndex((l) => l.trimStart().startsWith(`${JSON.stringify(name)}:`)) + 1 },
    ]),
  );
};
/** The repository's workflows as readWorkflow reads them, and package.json's scripts. */
const repositoryInput = () => ({
  workflows: workflowFiles(WORKFLOWS).map((f) => ({
    file: `.github/workflows/${f}`,
    lines: readWorkflow(readFileSync(join(WORKFLOWS, f), "utf8")),
  })),
  scripts: scriptsOf(readFileSync(join(ROOT, "package.json"), "utf8")),
});

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

describe("visual-mode (V13-ARCH-015)", () => {
  const SHOTS_DIR = "tests/visual/__screenshots__";
  const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  it("compares whenever the commit holds a baseline, whatever its first parent holds", () => {
    expect(decideVisualMode({ headPngs: 36, parentPngs: 36 }).mode).toBe("compare");
    // The change that adopts the first baselines.
    expect(decideVisualMode({ headPngs: 36, parentPngs: 0 }).mode).toBe("compare");
    // Some deleted: the comparison itself fails on each missing snapshot (updateSnapshots "none").
    expect(decideVisualMode({ headPngs: 1, parentPngs: 36 }).mode).toBe("compare");
    // No parent is needed to compare.
    expect(decideVisualMode({ headPngs: 1, parentPngs: null }).mode).toBe("compare");
  });

  it("makes candidates only when neither the commit nor its first parent holds a baseline (the control)", () => {
    expect(decideVisualMode({ headPngs: 0, parentPngs: 0 }).mode).toBe("candidates");
  });

  it("refuses candidate mode when every baseline was deleted, or when the first parent cannot be read", () => {
    const deleted = decideVisualMode({ headPngs: 0, parentPngs: 36 });
    expect(deleted.mode).toBe("refused");
    expect(deleted.reason).toContain("deleting every baseline fails the job");
    expect(decideVisualMode({ headPngs: 0, parentPngs: 1 }).mode).toBe("refused");
    expect(decideVisualMode({ headPngs: 0, parentPngs: null }).mode).toBe("refused");
  });

  it("as a command on real git history: candidates, compare, refused after deleting every baseline (also in a pull request's merge commit and a shallow clone), usage 2", () => {
    const dir = mkdtempSync(join(tmpdir(), "v13-visual-mode-"));
    try {
      const repo = join(dir, "repo");
      mkdirSync(repo);
      const git = (cwd: string, ...args: string[]) => {
        const r = spawnSync(
          "git",
          [
            "-c",
            "user.name=Synthetic Tester",
            "-c",
            "user.email=tester@example.test",
            "-c",
            "commit.gpgsign=false",
            ...args,
          ],
          { cwd, encoding: "utf8" },
        );
        expect(r.status, r.stderr).toBe(0);
      };
      const script = join(ROOT, "scripts", "ci", "visual-mode.mjs");
      const mode = (cwd = repo, args = [SHOTS_DIR]) =>
        spawnSync(process.execPath, [script, ...args], { cwd, encoding: "utf8" });
      const expectMode = (expected: "compare" | "candidates", cwd = repo) => {
        const r = mode(cwd);
        expect(r.status, r.stderr).toBe(0);
        expect(r.stdout).toBe(`${expected}\n`);
      };
      const expectRefused = (why: string, cwd = repo) => {
        const r = mode(cwd);
        expect(r.status).toBe(1);
        expect(r.stdout).toBe("");
        expect(r.stderr).toContain(why);
      };

      git(repo, "init", "-q", "--initial-branch=main");
      writeFileSync(join(repo, "README.md"), "synthetic\n");
      git(repo, "add", "README.md");
      git(repo, "commit", "-q", "-m", "root");
      // A root commit has no parent to read: fail closed.
      expectRefused("cannot be read");
      writeFileSync(join(repo, "README.md"), "synthetic, second\n");
      git(repo, "commit", "-q", "-am", "no baseline yet");
      expectMode("candidates");

      mkdirSync(join(repo, SHOTS_DIR), { recursive: true });
      for (const name of ["a-data-ar-desktop.png", "b-data-en-mobile.png"])
        writeFileSync(join(repo, SHOTS_DIR, name), PNG);
      git(repo, "add", SHOTS_DIR);
      git(repo, "commit", "-q", "-m", "adopt baselines");
      expectMode("compare");

      // Only PNG files count: a folder left with another file is still a folder without baselines.
      git(repo, "switch", "-q", "-c", "notes-only");
      git(repo, "rm", "-q", "-r", SHOTS_DIR);
      mkdirSync(join(repo, SHOTS_DIR), { recursive: true });
      writeFileSync(join(repo, SHOTS_DIR, "NOTES.txt"), "synthetic\n");
      git(repo, "add", SHOTS_DIR);
      git(repo, "commit", "-q", "-m", "every baseline deleted, a note left");
      expectRefused("holds 2 baselines and this commit holds none");
      git(repo, "switch", "-q", "main");

      // A pull request that deletes every baseline: GitHub's merge commit has the base as its first parent.
      git(repo, "switch", "-q", "-c", "delete-all");
      git(repo, "rm", "-q", "-r", SHOTS_DIR);
      git(repo, "commit", "-q", "-m", "delete every baseline");
      expectRefused("deleting every baseline fails the job");
      git(repo, "switch", "-q", "main");
      git(repo, "merge", "-q", "--no-ff", "-m", "merge commit", "delete-all");
      expectRefused("holds 2 baselines and this commit holds none");

      // The job's checkout fetches depth 2, so the first parent is there; at depth 1 it is not, and the run fails closed.
      const depth2 = join(dir, "depth2");
      git(dir, "clone", "-q", "--depth", "2", `file://${repo}`, depth2);
      expectRefused("holds 2 baselines and this commit holds none", depth2);
      const depth1 = join(dir, "depth1");
      git(dir, "clone", "-q", "--depth", "1", `file://${repo}`, depth1);
      expectRefused("cannot be read", depth1);
      // A shallow clone of a commit that holds baselines compares without its parent.
      git(repo, "switch", "-q", "-c", "keep-one", "HEAD^1");
      git(repo, "rm", "-q", join(SHOTS_DIR, "a-data-ar-desktop.png"));
      git(repo, "commit", "-q", "-m", "delete one baseline");
      const keepOne = join(dir, "keep-one");
      git(dir, "clone", "-q", "--depth", "1", "--branch", "keep-one", `file://${repo}`, keepOne);
      expectMode("compare", keepOne);

      expect(mode(repo, []).status).toBe(2);
      expect(mode(repo, [SHOTS_DIR, "extra"]).status).toBe(2);
      const notARepository = mode(dir);
      expect(notARepository.status).toBe(1);
      expect(notARepository.stderr).toContain("HEAD is not a commit");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("cross-browser trigger (V13-ARCH-016)", () => {
  // Firefox and WebKit are part of ARCH's merge rule (docs/AGENT_TASK_BOARD.md §2 rule 5), so the workflow must start by
  // itself on every pull request and every push to develop: no event-type or branch filter on pull_request, no label,
  // no job condition. Comments may still name the old `cross-browser` label.
  type Finding = { rule: "on" | "job-condition" | "label"; line: number };
  const ON_BLOCK = ["on:", "  push:", "    branches: [develop]", "  pull_request:"];

  const triggerFindings = (src: string): Finding[] => {
    const lines = src.split("\n");
    const start = lines.indexOf("on:");
    const next = lines.findIndex((l, i) => i > start && /^\S/.test(l));
    const block =
      start < 0 ? [] : lines.slice(start, next < 0 ? lines.length : next).filter((l) => l.trim() !== "");
    const findings: Finding[] = [];
    if (block.join("\n") !== ON_BLOCK.join("\n")) findings.push({ rule: "on", line: start + 1 });
    lines.forEach((l, i) => {
      if (/^ {4}if:/.test(l)) findings.push({ rule: "job-condition", line: i + 1 });
      if (!/^\s*#/.test(l) && /label/.test(l)) findings.push({ rule: "label", line: i + 1 });
    });
    return findings;
  };

  it("runs on every pull request and every push to develop, with no label and no job condition", () => {
    const src = readFileSync(join(ROOT, ".github", "workflows", "cross-browser.yml"), "utf8");
    expect(triggerFindings(src)).toEqual([]);
  });

  it("flags the label-gated form it replaced, a narrowed trigger and any job condition", () => {
    const labelGated = [
      "name: Cross-browser",
      "on:",
      "  push:",
      "    branches: [develop]",
      "  pull_request:",
      "    types: [labeled, synchronize]",
      "jobs:",
      "  e2e:",
      "    if: github.event_name == 'push' || contains(github.event.pull_request.labels.*.name, 'cross-browser')",
      "",
    ].join("\n");
    expect(triggerFindings(labelGated)).toEqual([
      { rule: "on", line: 2 },
      { rule: "label", line: 6 },
      { rule: "job-condition", line: 9 },
      { rule: "label", line: 9 },
    ]);

    const ok = [
      "# Not gated on the `cross-browser` label any more.",
      ...ON_BLOCK,
      "",
      "jobs:",
      "  e2e:",
    ].join("\n");
    expect(triggerFindings(ok)).toEqual([]);
    expect(triggerFindings(`${ok}\n    if: github.actor != 'dependabot[bot]'`)).toEqual([
      { rule: "job-condition", line: 9 },
    ]);
    expect(triggerFindings(ok.replace("  pull_request:", "  pull_request:\n    branches: [main]"))).toEqual([
      { rule: "on", line: 2 },
    ]);
    expect(triggerFindings(ok.replace("    branches: [develop]\n", ""))).toEqual([{ rule: "on", line: 2 }]);
    expect(triggerFindings(ok.replace("  pull_request:", "  pull_request_target:"))).toEqual([
      { rule: "on", line: 2 },
    ]);
    expect(triggerFindings(ok.replace("on:\n", ""))).toEqual([{ rule: "on", line: 0 }]);
  });
});

describe("skip guard (V13-ARCH-017)", () => {
  // CI's database job (V13_DB_TESTS_REQUIRED=1) fails when an integration test did not run: skipped, todo, skipped at
  // run time, no result, or a file that collected none (scripts/ci/vitest-skip-guard.mjs).
  const t = (name: string, line: number | null, state: string, mode = "run") => ({ name, line, state, mode });

  it("finds every test that did not run, and a file that collected none", () => {
    expect(
      findUnrunTests([
        {
          file: "a.spec.ts",
          tests: [
            t("ran", 3, "passed"),
            t("failed", 4, "failed"),
            t("skip", 5, "skipped", "skip"),
            t("todo", 6, "skipped", "todo"),
            t("at run time", 7, "skipped"),
            t("never ran", null, "pending"),
          ],
        },
        { file: "empty.spec.ts", tests: [] },
      ]),
    ).toEqual([
      { file: "a.spec.ts", line: 5, name: "skip", reason: "skipped" },
      { file: "a.spec.ts", line: 6, name: "todo", reason: "todo" },
      { file: "a.spec.ts", line: 7, name: "at run time", reason: "skipped" },
      { file: "a.spec.ts", line: null, name: "never ran", reason: "no result" },
      { file: "empty.spec.ts", line: null, name: "(no test collected)", reason: "no tests" },
    ]);
    // A failure is already a failed run; passing and failing tests are not findings (the control).
    expect(
      findUnrunTests([{ file: "a.spec.ts", tests: [t("ran", 3, "passed"), t("failed", 4, "failed")] }]),
    ).toEqual([]);
  });

  it("is on only when V13_DB_TESTS_REQUIRED is exactly 1, and guards the integration project only", () => {
    expect(GUARDED_PROJECTS).toEqual(["integration"]);
    const on = skipGuardReporters({ V13_DB_TESTS_REQUIRED: "1" });
    expect(on).toHaveLength(1);
    expect(on[0]).toBeInstanceOf(SkipGuardReporter);
    for (const v of [undefined, "", "0", "true", "yes", " 1"])
      expect(skipGuardReporters({ V13_DB_TESTS_REQUIRED: v })).toEqual([]);
  });

  it("the real vitest.config.ts adds the guard only with the flag, and gives integration tests their lines", async () => {
    const config = pathToFileURL(join(ROOT, "vitest.config.ts")).href;
    type Config = {
      test: { reporters: unknown[]; projects: { test: { name: string; includeTaskLocation?: boolean } }[] };
    };
    const load = async (flag: string, tag: string): Promise<Config> => {
      vi.stubEnv("V13_DB_TESTS_REQUIRED", flag);
      try {
        return ((await import(/* @vite-ignore */ `${config}?skip-guard=${tag}`)) as { default: Config })
          .default;
      } finally {
        vi.unstubAllEnvs();
      }
    };
    const on = await load("1", "on");
    const off = await load("", "off");
    expect(on.test.reporters.filter((r) => r instanceof SkipGuardReporter)).toHaveLength(1);
    expect(off.test.reporters.filter((r) => r instanceof SkipGuardReporter)).toHaveLength(0);
    const integration = on.test.projects.find((p) => p.test.name === "integration");
    expect(integration?.test.includeTaskLocation).toBe(true);
  });

  it("in a real Vitest run: a skip, a todo and a run-time skip fail the run at file:line; a clean run and a skip outside the guarded project pass", () => {
    mkdirSync(join(ROOT, "test-results"), { recursive: true });
    const dir = mkdtempSync(join(ROOT, "test-results", "skip-guard-"));
    const vitest = join(ROOT, "node_modules", "vitest", "vitest.mjs");
    const guard = pathToFileURL(join(ROOT, "scripts", "ci", "vitest-skip-guard.mjs")).href;
    // The child run must not inherit this worker's Vitest variables.
    const env: NodeJS.ProcessEnv = { ...process.env };
    for (const k of Object.keys(env)) if (k.startsWith("VITEST")) delete env[k];
    const run = (files: Record<string, string>) => {
      rmSync(join(dir, "db"), { recursive: true, force: true });
      rmSync(join(dir, "unit"), { recursive: true, force: true });
      mkdirSync(join(dir, "db"));
      mkdirSync(join(dir, "unit"));
      for (const [name, src] of Object.entries(files)) writeFileSync(join(dir, name), src);
      return spawnSync(
        process.execPath,
        [vitest, "run", "--root", dir, "--config", join(dir, "vitest.config.mjs")],
        {
          encoding: "utf8",
          env,
        },
      );
    };
    try {
      writeFileSync(
        join(dir, "vitest.config.mjs"),
        [
          `import { SkipGuardReporter } from ${JSON.stringify(guard)};`,
          "export default {",
          "  test: {",
          '    reporters: ["default", new SkipGuardReporter({ roots: ["db"] })],',
          "    includeTaskLocation: true,",
          "    projects: [",
          '      { test: { name: "integration", include: ["db/*.spec.mjs"] } },',
          '      { test: { name: "unit", include: ["unit/*.spec.mjs"] } },',
          "    ],",
          "  },",
          "};",
          "",
        ].join("\n"),
      );
      const ok = 'import { expect, it } from "vitest";\nit("runs", () => expect(1).toBe(1));\n';
      const planted = [
        'import { describe, expect, it } from "vitest";',
        'it("runs", () => expect(1).toBe(1));',
        'it.skip("planted skip", () => {});',
        'describe.skipIf(true)("planted skipIf", () => {',
        '  it("inner", () => {});',
        "});",
        'it.todo("planted todo");',
        'it("skips at run time", (ctx) => ctx.skip());',
        "",
      ].join("\n");

      const failed = run({ "db/ok.spec.mjs": ok, "db/planted.spec.mjs": planted });
      expect(failed.status, failed.stdout + failed.stderr).toBe(1);
      expect(failed.stderr).toContain("skip guard (V13-ARCH-017, V13-ARCH-018): 4 findings in integration");
      for (const line of [
        "db/planted.spec.mjs:3 planted skip (skipped)",
        "db/planted.spec.mjs:5 planted skipIf > inner (skipped)",
        "db/planted.spec.mjs:7 planted todo (todo)",
        "db/planted.spec.mjs:8 skips at run time (skipped)",
      ])
        expect(failed.stderr).toContain(line);
      expect(failed.stderr).not.toContain("db/ok.spec.mjs");

      const clean = run({ "db/ok.spec.mjs": ok, "unit/ok.spec.mjs": ok });
      expect(clean.status, clean.stdout + clean.stderr).toBe(0);
      expect(clean.stderr).not.toContain("skip guard");

      const unitSkip = run({ "db/ok.spec.mjs": ok, "unit/planted.spec.mjs": planted });
      expect(unitSkip.status, unitSkip.stdout + unitSkip.stderr).toBe(0);
      expect(unitSkip.stderr).not.toContain("skip guard");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("guard coverage (V13-ARCH-018)", () => {
  // SEC's INFO on #166 and ARCH's I2 on #167. The skip guard walks tests/integration and tests/security/db itself, so a
  // database test file that the run did not collect fails the run, whatever the include glob says. And CI's test runs,
  // with the package.json scripts they run, pass no --reporter (which replaces the configured guards), no other config
  // and no filter (scripts/ci/test-invocations.mjs).
  const vitest = join(ROOT, "node_modules", "vitest", "vitest.mjs");
  const guard = pathToFileURL(join(ROOT, "scripts", "ci", "vitest-skip-guard.mjs")).href;
  const OK_SPEC = 'import { expect, it } from "vitest";\nit("runs", () => expect(1).toBe(1));\n';
  /** A child Vitest's environment: none of this worker's Vitest variables, no CI reporters and no flag. */
  const childEnv = (): NodeJS.ProcessEnv => {
    const env: NodeJS.ProcessEnv = { ...process.env };
    for (const k of Object.keys(env)) if (k.startsWith("VITEST")) delete env[k];
    delete env.CI;
    delete env.V13_DB_TESTS_REQUIRED;
    return env;
  };
  /** A temporary root under test-results/ with `files`, and a config whose integration project has the guard. */
  const plant = (files: Record<string, string>, include: string[], roots: string[] = ["db"]) => {
    mkdirSync(join(ROOT, "test-results"), { recursive: true });
    const dir = mkdtempSync(join(ROOT, "test-results", "guard-coverage-"));
    for (const [name, src] of Object.entries(files)) {
      mkdirSync(join(dir, name, ".."), { recursive: true });
      writeFileSync(join(dir, name), src);
    }
    writeFileSync(
      join(dir, "vitest.config.mjs"),
      [
        `import { SkipGuardReporter } from ${JSON.stringify(guard)};`,
        "export default {",
        "  test: {",
        `    reporters: ["default", new SkipGuardReporter({ roots: ${JSON.stringify(roots)} })],`,
        "    projects: [",
        `      { test: { name: "integration", include: ${JSON.stringify(include)} } },`,
        '      { test: { name: "unit", include: ["unit/*.spec.mjs"] } },',
        "    ],",
        "  },",
        "};",
        "",
      ].join("\n"),
    );
    return dir;
  };
  const plantedConfig = (dir: string) => ["--root", dir, "--config", join(dir, "vitest.config.mjs")];
  /** The files the integration project collects, from `vitest list --filesOnly`, which imports no test file. */
  const integrationFiles = (root: string, ...config: string[]): string[] => {
    const run = spawnSync(
      process.execPath,
      [vitest, "list", "--project", "integration", "--filesOnly", "--json", ...config],
      { cwd: ROOT, encoding: "utf8", env: childEnv() },
    );
    expect(run.status, run.stdout + run.stderr).toBe(0);
    return (JSON.parse(run.stdout.slice(run.stdout.indexOf("["))) as { file: string; projectName: string }[])
      .filter((f) => f.projectName === "integration")
      .map((f) => relative(root, f.file).split(sep).join("/"));
  };

  it("walks the guarded directories itself: every test file by its name, and a directory that is gone", () => {
    expect(GUARDED_ROOTS).toEqual(["tests/integration", "tests/security/db"]);
    const dir = mkdtempSync(join(tmpdir(), "guard-walk-"));
    try {
      for (const f of [
        "db/a.spec.ts",
        "db/sub/b.test.mjs",
        "db/sub/deep/c.spec.tsx",
        "db/helper.ts",
        "db/notes.md",
        "other/x.spec.ts",
      ]) {
        mkdirSync(join(dir, f, ".."), { recursive: true });
        writeFileSync(join(dir, f), "");
      }
      const walked = listTestFiles(dir, ["db", "gone"]);
      expect(walked).toEqual({
        files: ["db/a.spec.ts", "db/sub/b.test.mjs", "db/sub/deep/c.spec.tsx"],
        missing: ["gone"],
      });
      expect(findUncollectedFiles(walked, ["db/a.spec.ts"])).toEqual([
        { file: "gone", line: null, name: "", reason: "directory not found" },
        { file: "db/sub/b.test.mjs", line: null, name: "", reason: "not collected" },
        { file: "db/sub/deep/c.spec.tsx", line: null, name: "", reason: "not collected" },
      ]);
      // The control: every walked file collected (a file collected beyond the walk is no finding).
      const all = ["db/a.spec.ts", "db/sub/b.test.mjs", "db/sub/deep/c.spec.tsx", "other/x.spec.ts"];
      expect(findUncollectedFiles(listTestFiles(dir, ["db"]), all)).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("the real vitest.config.ts's integration project collects every test file under the guarded directories", () => {
    const walked = listTestFiles(ROOT, GUARDED_ROOTS);
    expect(walked.missing).toEqual([]);
    expect(walked.files.length).toBeGreaterThan(0);
    const found = findUncollectedFiles(walked, integrationFiles(ROOT));
    expect(found, formatFindings(found)).toEqual([]);
  }, 60_000);

  it("a planted narrowed include glob drops a file, and the comparison names it without running a test", () => {
    const dir = plant({ "db/ok.spec.mjs": OK_SPEC, "db/sub/deep.spec.mjs": OK_SPEC }, ["db/*.spec.mjs"]);
    try {
      const files = integrationFiles(dir, ...plantedConfig(dir));
      expect(files).toEqual(["db/ok.spec.mjs"]);
      expect(findUncollectedFiles(listTestFiles(dir, ["db"]), files)).toEqual([
        { file: "db/sub/deep.spec.mjs", line: null, name: "", reason: "not collected" },
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);

  it("in a real Vitest run: a narrowed glob, a file named outside it, a file argument, a run without the integration project and a missing directory fail the run; a clean run passes", () => {
    const cases: {
      name: string;
      files: Record<string, string>;
      include: string[];
      roots?: string[];
      args?: string[];
      status: number;
      lines: string[];
    }[] = [
      {
        name: "a narrowed glob",
        files: { "db/ok.spec.mjs": OK_SPEC, "db/sub/deep.spec.mjs": OK_SPEC },
        include: ["db/*.spec.mjs"],
        status: 1,
        lines: [
          "skip guard (V13-ARCH-017, V13-ARCH-018): 1 finding in integration",
          "db/sub/deep.spec.mjs (not collected)",
        ],
      },
      {
        name: "a file named outside the glob",
        files: { "db/ok.spec.mjs": OK_SPEC, "db/other.test.mjs": OK_SPEC },
        include: ["db/**/*.spec.mjs"],
        status: 1,
        lines: ["db/other.test.mjs (not collected)"],
      },
      {
        name: "a file argument",
        files: { "db/ok.spec.mjs": OK_SPEC, "db/two.spec.mjs": OK_SPEC },
        include: ["db/**/*.spec.mjs"],
        args: ["db/ok"],
        status: 1,
        lines: ["db/two.spec.mjs (not collected)"],
      },
      {
        name: "a run without the integration project",
        files: { "db/ok.spec.mjs": OK_SPEC, "unit/ok.spec.mjs": OK_SPEC },
        include: ["db/**/*.spec.mjs"],
        args: ["--project", "unit"],
        status: 1,
        lines: ["db/ok.spec.mjs (not collected)"],
      },
      {
        name: "a missing directory",
        files: { "db/ok.spec.mjs": OK_SPEC },
        include: ["db/**/*.spec.mjs"],
        roots: ["db", "gone"],
        status: 1,
        lines: ["gone (directory not found)"],
      },
      {
        name: "a clean run (the control)",
        files: { "db/ok.spec.mjs": OK_SPEC, "db/sub/deep.spec.mjs": OK_SPEC, "unit/ok.spec.mjs": OK_SPEC },
        include: ["db/**/*.spec.mjs"],
        status: 0,
        lines: [],
      },
    ];
    for (const c of cases) {
      const dir = plant(c.files, c.include, c.roots);
      try {
        const run = spawnSync(process.execPath, [vitest, "run", ...(c.args ?? []), ...plantedConfig(dir)], {
          encoding: "utf8",
          env: childEnv(),
        });
        expect(run.status, `${c.name}\n${run.stdout}${run.stderr}`).toBe(c.status);
        for (const line of c.lines) expect(run.stderr, c.name).toContain(line);
        if (c.status === 0) expect(run.stderr, c.name).not.toContain("skip guard");
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  }, 120_000);

  it("CI's test runs, and the scripts they run, pass no reporter, config or filter; the runs the merge rule rests on exist", () => {
    const input = repositoryInput();
    const findings = checkTestInvocations(input);
    expect(findings, formatInvocationFindings(findings)).toEqual([]);
    // What the check read: every Vitest and Playwright run in the workflows. A new run, or one the reader cannot
    // see any more, shows here first.
    expect(
      findInvocations(input).map(
        (r) => `${r.file} ${r.job} ${r.tool} ${r.projects.join(",") || "every project"} (${r.via})`,
      ),
    ).toEqual([
      ".github/workflows/ci.yml unit vitest unit (pnpm test)",
      ".github/workflows/ci.yml integration vitest integration (pnpm test:db)",
      ".github/workflows/ci.yml e2e playwright every project (pnpm test:e2e)",
      ".github/workflows/ci.yml visual playwright visual-baseline (pnpm exec playwright test --project=visual-baseline)",
      ".github/workflows/ci.yml visual playwright visual-baseline (pnpm exec playwright test --project=visual-baseline --reporter=list,json --retries=0)",
      ".github/workflows/cross-browser.yml e2e playwright firefox-ar,webkit-ar (pnpm exec playwright test --project=firefox-ar --project=webkit-ar --trace=off)",
      ".github/workflows/visual-library.yml library playwright visual-library (pnpm exec playwright test --project=visual-library)",
    ]);
  });

  it("reads a run line as the shell does: quotes, $( … ), redirections, operators and comments", () => {
    const words = (text: string) =>
      splitCommands([{ text, line: 1 }], "w.yml").map((c) => c.map((w) => w.text));
    expect(
      words(
        `rc=0; FOO="a b" pnpm exec playwright test --project='x' 2>&1 >> out.log || rc=$? # a comment --grep`,
      ),
    ).toEqual([["rc=0"], ["FOO=a b", "pnpm", "exec", "playwright", "test", "--project=x"], ["rc=$?"]]);
    expect(words(`mode="$(node scripts/ci/visual-mode.mjs dir)"`)).toEqual([
      ["mode=$(node scripts/ci/visual-mode.mjs dir)"],
    ]);
    expect(words(`if [ "$mode" = compare ]; then`)).toEqual([
      ["if", "[", "$mode", "=", "compare", "]"],
      ["then"],
    ]);
    expect(words(`FOO=$(node a.mjs "x y") pnpm test:e2e`)).toEqual([
      ['FOO=$(node a.mjs "x y")', "pnpm", "test:e2e"],
    ]);
  });

  /** A planted CI workflow and cross-browser workflow, and the scripts they run; each case below changes one thing. */
  const CI_WF = [
    "name: CI",
    "on:",
    "  pull_request:",
    "jobs:",
    "  integration:",
    "    runs-on: ubuntu-24.04",
    "    env:",
    '      V13_DB_TESTS_REQUIRED: "1"',
    "    steps:",
    "      - run: pnpm db:reset",
    "      - run: pnpm test:db",
    "  e2e:",
    "    runs-on: ubuntu-24.04",
    "    steps:",
    "      - run: pnpm test:e2e",
    "  visual:",
    "    runs-on: ubuntu-24.04",
    "    steps:",
    "      - run: |",
    "          pnpm exec playwright test --project=visual-baseline --reporter=list,json || rc=$?",
    "",
  ];
  const CROSS_WF = [
    "name: Cross-browser",
    "on:",
    "  pull_request:",
    "jobs:",
    "  e2e:",
    "    runs-on: ubuntu-24.04",
    "    steps:",
    "      - run: pnpm exec playwright test --project=firefox-ar --project=webkit-ar --trace=off",
    "",
  ];
  const SCRIPTS: Record<string, string> = {
    "test:db": "vitest run --project integration",
    "test:e2e": "playwright test",
    "db:reset": "node scripts/db/reset.mjs",
  };
  /** The findings as `file:line rule`; the scripts sit on package.json's lines 20, 21 and 22. */
  const planted = (ci: readonly string[], cross: readonly string[] = CROSS_WF, scripts = SCRIPTS) =>
    checkTestInvocations({
      workflows: [
        { file: ".github/workflows/ci.yml", lines: readWorkflow(ci.join("\n")) },
        { file: ".github/workflows/cross-browser.yml", lines: readWorkflow(cross.join("\n")) },
      ],
      scripts: Object.fromEntries(
        Object.entries(scripts).map(([name, command], i) => [name, { command, line: 20 + i }]),
      ),
    }).map((f) => `${f.file.replace(".github/workflows/", "")}:${f.line} ${f.rule}`);
  /** `src` with its line `n` (from 1) replaced by `lines`, or removed when there are none. */
  const at = (src: readonly string[], n: number, ...lines: string[]) => [
    ...src.slice(0, n - 1),
    ...lines,
    ...src.slice(n),
  ];
  const withoutJobFlag = [...CI_WF.slice(0, 6), ...CI_WF.slice(8)];

  it("a planted reporter, config or filter in a workflow or a script fails at file:line, as do changes to the flag and to the runs the merge rule rests on", () => {
    expect(planted(CI_WF)).toEqual([]);

    // A filter, a reporter or another config in a workflow's run.
    expect(planted(at(CI_WF, 15, "      - run: pnpm test:e2e --grep @smoke"))).toEqual(["ci.yml:15 filter"]);
    expect(planted(at(CI_WF, 11, "      - run: pnpm test:db -t rls"))).toEqual(["ci.yml:11 filter"]);
    expect(planted(at(CI_WF, 11, "      - run: pnpm test:db tests/integration/rls.spec.ts"))).toEqual([
      "ci.yml:11 filter",
    ]);
    expect(planted(at(CI_WF, 11, "      - run: pnpm test:db --allowOnly"))).toEqual(["ci.yml:11 filter"]);
    expect(
      planted(at(CI_WF, 11, "      - run: npm run test:db -- --exclude=tests/integration/rls.spec.ts")),
    ).toEqual(["ci.yml:11 filter"]);
    expect(planted(at(CI_WF, 15, "      - run: pnpm test:e2e -c other.config.ts"))).toEqual([
      "ci.yml:15 config",
    ]);
    const crossReporter =
      "      - run: pnpm exec playwright test --project=firefox-ar --project=webkit-ar --reporter=dot";
    expect(planted(CI_WF, at(CROSS_WF, 8, crossReporter))).toEqual(["cross-browser.yml:8 reporter"]);

    // However the run is spelled.
    expect(planted(at(CI_WF, 15, "      - run: xvfb-run -a npx playwright test -g leak"))).toEqual([
      "ci.yml:15 filter",
    ]);
    expect(planted(at(CI_WF, 15, "      - run: npx playwright@1.63.0 test --grep leak"))).toEqual([
      "ci.yml:15 filter",
    ]);
    expect(planted(at(CI_WF, 15, "      - run: pnpm --reporter silent test:e2e --grep leak"))).toEqual([
      "ci.yml:15 filter",
    ]);
    expect(planted(at(CI_WF, 11, "      - run: pnpm test:db --reporter.0=dot"))).toEqual([
      "ci.yml:11 reporter",
    ]);
    expect(
      planted(at(CI_WF, 15, "      - run: node node_modules/@playwright/test/cli.js test e2e/")),
    ).toEqual(["ci.yml:15 filter"]);
    expect(
      planted(at(CI_WF, 11, "      - run: pnpm exec vitest related lib/db/x.ts --project integration")),
    ).toEqual(["ci.yml:11 filter", "ci.yml:11 filter"]);

    // Across lines: a folded block, a plain value that continues, and a backslash in a literal block.
    expect(
      planted(
        at(CI_WF, 15, "      - run: >-", "          pnpm exec playwright test", "          --grep leak"),
      ),
    ).toEqual(["ci.yml:17 filter"]);
    expect(
      planted(at(CI_WF, 15, "      - run: pnpm exec playwright test", "          --last-failed")),
    ).toEqual(["ci.yml:16 filter"]);
    expect(
      planted(
        at(CI_WF, 15, "      - run: |", "          pnpm exec playwright test \\", "            --shard=1/2"),
      ),
    ).toEqual(["ci.yml:17 filter"]);

    // In a script a workflow runs: the finding names the script's line in package.json.
    const dbReporter = { ...SCRIPTS, "test:db": "vitest run --project integration --reporter=dot" };
    expect(planted(CI_WF, CROSS_WF, dbReporter)).toEqual(["package.json:20 reporter"]);
    const e2eGrep = { ...SCRIPTS, "test:e2e": "playwright test --grep-invert @leak" };
    expect(planted(CI_WF, CROSS_WF, e2eGrep)).toEqual(["package.json:21 filter"]);

    // Only a run of visual projects alone may pass --reporter.
    const mixed =
      "          pnpm exec playwright test --project=visual-baseline --project=chromium-ar --reporter=list";
    expect(planted(at(CI_WF, 20, mixed))).toEqual(["ci.yml:20 reporter"]);

    // The flag: "1", set by an env: key of the database run's job or step, and never in a script.
    expect(planted(at(CI_WF, 8, '      V13_DB_TESTS_REQUIRED: "0"'))).toEqual([
      "ci.yml:8 flag",
      "ci.yml:11 flag",
    ]);
    expect(planted(withoutJobFlag)).toEqual(["ci.yml:9 flag"]);
    expect(planted(at(CI_WF, 11, "      - run: V13_DB_TESTS_REQUIRED=0 pnpm test:db"))).toEqual([
      "ci.yml:11 flag",
    ]);
    const toEnvFile = '      - run: echo "V13_DB_TESTS_REQUIRED=0" >> "$GITHUB_ENV"';
    expect(planted(at(CI_WF, 11, toEnvFile, "      - run: pnpm test:db"))).toEqual(["ci.yml:11 flag"]);
    const stepFlag = ["      - run: pnpm test:db", "        env:", '          V13_DB_TESTS_REQUIRED: "1"'];
    expect(planted(at(withoutJobFlag, 9, ...stepFlag))).toEqual([]);

    // The runs the merge rule rests on.
    expect(planted(at(CI_WF, 11))).toEqual(["ci.yml:5 missing run"]);
    expect(planted(CI_WF, CROSS_WF, { ...SCRIPTS, "test:db": "vitest run --project unit" })).toEqual([
      "ci.yml:5 missing run",
    ]);
    expect(planted(at(CI_WF, 15, "      - run: pnpm test:e2e --project=chromium-ar"))).toEqual([
      "ci.yml:12 missing run",
    ]);
    const firefoxOnly = "      - run: pnpm exec playwright test --project=firefox-ar --trace=off";
    expect(planted(CI_WF, at(CROSS_WF, 8, firefoxOnly))).toEqual(["cross-browser.yml:5 missing run"]);
  });

  // V13-ARCH-019 (SEC's INFOs 1 and 3 on #170): -u, --update-snapshots or Vitest's --update rewrites what a run compares
  // against, --ignore-snapshots skips the screenshot assertions, and --no-deps leaves out a run's dependency projects.
  // No run may pass them, the visual runs included: they are exempt from the --reporter rule only.
  it("a snapshot option or --no-deps fails at file:line in every run, the visual runs included (V13-ARCH-019)", () => {
    const visual = (options: string) =>
      at(
        CI_WF,
        20,
        `          pnpm exec playwright test --project=visual-baseline --reporter=list,json${options} || rc=$?`,
      );
    expect(planted(visual(""))).toEqual([]);
    expect(planted(visual(" -u"))).toEqual(["ci.yml:20 snapshot"]);
    expect(planted(visual(" --update-snapshots=all"))).toEqual(["ci.yml:20 snapshot"]);
    expect(planted(visual(" --ignore-snapshots"))).toEqual(["ci.yml:20 snapshot"]);
    // A mode after the option is its value, not a file argument; any other word after it still is one.
    expect(planted(visual(" --update-snapshots all"))).toEqual(["ci.yml:20 snapshot"]);
    expect(planted(visual(" -u changed"))).toEqual(["ci.yml:20 snapshot"]);
    expect(planted(visual(" -u tests/visual/baseline.spec.ts"))).toEqual([
      "ci.yml:20 snapshot",
      "ci.yml:20 filter",
    ]);
    const crossIgnore =
      "      - run: pnpm exec playwright test --project=firefox-ar --project=webkit-ar --ignore-snapshots";
    expect(planted(CI_WF, at(CROSS_WF, 8, crossIgnore))).toEqual(["cross-browser.yml:8 snapshot"]);
    expect(planted(at(CI_WF, 15, "      - run: pnpm test:e2e --no-deps"))).toEqual(["ci.yml:15 filter"]);

    // A cluster of short options is read letter by letter, as the CLIs read it (SEC's CHANGES on #171).
    expect(planted(visual(" -xu"))).toEqual(["ci.yml:20 snapshot"]);
    expect(planted(at(CI_WF, 15, "      - run: pnpm test:e2e -xg leak"))).toEqual(["ci.yml:15 filter"]);
    expect(planted(at(CI_WF, 15, "      - run: pnpm test:e2e -gleak"))).toEqual(["ci.yml:15 filter"]);
    // In Playwright the rest of the word is -g's value, so this is a title filter for "u", not -u.
    expect(planted(at(CI_WF, 15, "      - run: pnpm test:e2e -gu"))).toEqual(["ci.yml:15 filter"]);
    expect(planted(at(CI_WF, 15, "      - run: pnpm test:e2e -xj 2"))).toEqual([]);
    expect(planted(at(CI_WF, 11, "      - run: pnpm test:db -ut rls"))).toEqual([
      "ci.yml:11 filter",
      "ci.yml:11 snapshot",
    ]);

    // Vitest: -u and --update, with or without a type, in a workflow or in a script it runs.
    expect(planted(at(CI_WF, 11, "      - run: pnpm test:db -u"))).toEqual(["ci.yml:11 snapshot"]);
    expect(planted(at(CI_WF, 11, "      - run: pnpm test:db --update new"))).toEqual(["ci.yml:11 snapshot"]);
    expect(planted(at(CI_WF, 11, "      - run: pnpm test:db --update=all"))).toEqual(["ci.yml:11 snapshot"]);
    const dbUpdate = { ...SCRIPTS, "test:db": "vitest run --project integration --update" };
    expect(planted(CI_WF, CROSS_WF, dbUpdate)).toEqual(["package.json:20 snapshot"]);
    const e2eUpdate = { ...SCRIPTS, "test:e2e": "playwright test -u" };
    expect(planted(CI_WF, CROSS_WF, e2eUpdate)).toEqual(["package.json:21 snapshot"]);
  });
});

describe("required run proof (V13-ARCH-020)", () => {
  // The last step of each required job (`if: always()`) reads the run's own report and fails the job unless every test
  // ran and passed (scripts/ci/required-runs.mjs). Its runtime half is tried on real Vitest and Playwright runs in
  // temporary roots under test-results/, each fault planted; its static half on the repository's workflows and configs,
  // and on planted workflows.
  const vitestCli = join(ROOT, "node_modules", "vitest", "vitest.mjs");
  const playwrightCli = join(ROOT, "node_modules", "@playwright", "test", "cli.js");
  const proofCli = join(ROOT, "scripts", "ci", "required-runs.mjs");
  /** Vitest's modifier for a test pinned to fail, spelled so that this file never holds it: the proof reads unit sources. */
  const FAILS = ["", "fails"].join(".");
  const VITEST_OK = 'import { expect, it } from "vitest";\nit("runs", () => expect(1).toBe(1));\n';
  const PLAYWRIGHT_OK =
    'import { expect, test } from "@playwright/test";\ntest("runs", () => expect(1).toBe(1));\n';
  /** A child run's environment: none of this worker's Vitest or Playwright variables, and no CI. */
  const childEnv = (): NodeJS.ProcessEnv => {
    const env: NodeJS.ProcessEnv = { ...process.env };
    for (const k of Object.keys(env)) if (k.startsWith("VITEST") || k.startsWith("PLAYWRIGHT")) delete env[k];
    delete env.CI;
    delete env.V13_DB_TESTS_REQUIRED;
    return env;
  };
  const made: string[] = [];
  afterAll(() => {
    for (const dir of made) rmSync(dir, { recursive: true, force: true });
  });
  /** A temporary root under test-results/ holding `files`. */
  const plantRoot = (prefix: string, files: Record<string, string>) => {
    mkdirSync(join(ROOT, "test-results"), { recursive: true });
    const dir = mkdtempSync(join(ROOT, "test-results", `${prefix}-`));
    made.push(dir);
    for (const [name, src] of Object.entries(files)) {
      mkdirSync(join(dir, name, ".."), { recursive: true });
      writeFileSync(join(dir, name), src);
    }
    return dir;
  };
  /** The proof's findings for the run `name` in `dir`, as `where: problem`, sorted. */
  const proof = (name: string, dir: string, now?: number) =>
    proveRun(name, { root: dir, ...(now === undefined ? {} : { now }) })
      .findings.map((f) => `${f.where}: ${f.problem}`)
      .sort();
  const proofCliRun = (dir: string, ...args: string[]) => {
    const run = spawnSync(process.execPath, [proofCli, ...args], {
      cwd: dir,
      encoding: "utf8",
      env: childEnv(),
    });
    return [run.status, run.stdout, run.stderr];
  };
  const failed = (name: string, n: number, lines: string) =>
    `required run proof (V13-ARCH-020): "${name}" did not run and pass in full; ${n} finding${n === 1 ? "" : "s"}:\n${lines}\n`;

  // Vitest as CI runs it: JUnit XML at VITEST_REPORT, the unit and integration projects over their directories.
  const VITEST_CONFIG = [
    "export default {",
    "  test: {",
    '    reporters: ["default", "junit"],',
    `    outputFile: { junit: ${JSON.stringify(VITEST_REPORT)} },`,
    "    projects: [",
    '      { test: { name: "unit", include: ["tests/unit/**/*.spec.mjs", "tests/security/app/**/*.spec.mjs"] } },',
    '      { test: { name: "integration", include: ["tests/integration/**/*.spec.mjs", "tests/security/db/**/*.spec.mjs"] } },',
    "    ],",
    "  },",
    "};",
    "",
  ].join("\n");
  const vitestRun = (dir: string, project: string) =>
    spawnSync(
      process.execPath,
      [vitestCli, "run", "--project", project, "--root", dir, "--config", join(dir, "vitest.config.mjs")],
      { cwd: dir, encoding: "utf8", env: childEnv() },
    );

  it("passes a Vitest run that ran and passed every test file of its directories, and refuses its report changed or gone", () => {
    const dir = plantRoot("proof-vitest", {
      "vitest.config.mjs": VITEST_CONFIG,
      "tests/unit/a.spec.mjs": VITEST_OK,
      "tests/security/app/b.spec.mjs": VITEST_OK,
      "tests/integration/c.spec.mjs": VITEST_OK,
      "tests/security/db/d.spec.mjs": VITEST_OK,
    });
    const run = vitestRun(dir, "unit");
    expect(run.status, run.stdout + run.stderr).toBe(0);
    const summary = `2 tests in 2 files passed (${VITEST_REPORT})`;
    expect(proveRun("unit", { root: dir })).toEqual({ findings: [], summary });
    expect(proofCliRun(dir, "unit")).toEqual([
      0,
      `required run proof (V13-ARCH-020): "unit": ${summary}\n`,
      "",
    ]);

    const report = join(dir, VITEST_REPORT);
    const xml = readFileSync(report, "utf8");
    const started = [...xml.matchAll(/<testsuite [^>]*timestamp="([^"]+)"/g)].map((m) => m[1]!).sort()[0]!;
    const withReport = (text: string) => (writeFileSync(report, text), dir);
    expect(proof("unit", withReport(xml.slice(0, xml.lastIndexOf("</testsuites>"))))).toEqual([
      `${VITEST_REPORT}: the report is cut short or is not a JUnit report`,
    ]);
    // Left in the workspace by an earlier run, or from a clock ahead of the check.
    expect(proof("unit", withReport(xml), Date.parse(started) + 61 * 60_000)).toEqual([
      `${VITEST_REPORT}: the run started at ${started}, more than an hour ago: not this job's report`,
    ]);
    expect(proof("unit", withReport(xml), Date.parse(started) - 6 * 60_000)).toEqual([
      `${VITEST_REPORT}: the run started at ${started}, after the check`,
    ]);
    const dropped = xml.replace(
      /<testcase classname="tests\/unit\/a\.spec\.mjs"[^>]*?(?:\/>|>[\s\S]*?<\/testcase>)/,
      "",
    );
    expect(proof("unit", withReport(dropped))).toEqual([
      `${VITEST_REPORT}: the report's total (2) differs from its test cases (1)`,
      "tests/unit/a.spec.mjs: collected no test",
      "tests/unit/a.spec.mjs: the file's total (1) differs from its test cases (0)",
    ]);
    // The unit report read as the integration run's.
    expect(proof("integration", withReport(xml))).toEqual([
      `${VITEST_REPORT}: the report holds none of this run's 2 test files: another run's report`,
    ]);
    rmSync(report);
    const gone = `${VITEST_REPORT}: the run wrote no report: its tests did not run`;
    expect(proof("unit", dir)).toEqual([gone]);
    expect(proofCliRun(dir, "unit")).toEqual([1, "", failed("unit", 1, `  unit: ${gone}`)]);
  }, 120_000);

  it("names each test of a Vitest run that did not run and pass, each file it did not hold or collect, and each pinned to fail", () => {
    const dir = plantRoot("proof-vitest-planted", {
      "vitest.config.mjs": VITEST_CONFIG,
      "tests/unit/mixed.spec.mjs": [
        'import { expect, it } from "vitest";',
        'it("passes", () => expect(1).toBe(1));',
        'it.skip("skipped", () => {});',
        'it.todo("todo");',
        'it("skipped at run time", (ctx) => ctx.skip());',
        'it.skipIf(true)("skipped by a condition", () => {});',
        `it${FAILS}("pinned to fail", () => expect(1).toBe(2));`,
        'it("fails", () => expect(1).toBe(2));',
        "",
      ].join("\n"),
      "tests/unit/empty.spec.mjs": 'import "vitest";\n',
      "tests/unit/broken.spec.mjs": 'throw new Error("broken at load");\n',
      "tests/unit/left-out.test.mjs": VITEST_OK,
      "tests/security/app/unhandled.spec.mjs": [
        'import { it } from "vitest";',
        'it("leaves a rejection behind", () => void Promise.reject(new Error("never handled")));',
        "",
      ].join("\n"),
    });
    const run = vitestRun(dir, "unit");
    expect(run.status, run.stdout + run.stderr).toBe(1);
    expect(proof("unit", dir)).toEqual(
      [
        `${VITEST_REPORT}: the report's totals record failures: 3, errors: 1`,
        "tests/unit/left-out.test.mjs: a test file the report does not hold",
        "tests/unit/broken.spec.mjs › tests/unit/broken.spec.mjs: failed",
        "tests/unit/empty.spec.mjs › tests/unit/empty.spec.mjs: failed",
        "tests/unit/mixed.spec.mjs › skipped: skipped or todo",
        "tests/unit/mixed.spec.mjs › todo: skipped or todo",
        "tests/unit/mixed.spec.mjs › skipped at run time: skipped or todo",
        "tests/unit/mixed.spec.mjs › skipped by a condition: skipped or todo",
        "tests/unit/mixed.spec.mjs › fails: failed",
        // The JUnit report records the pinned test as passed: only the source shows it.
        `tests/unit/mixed.spec.mjs:7: a test pinned to fail (\`${FAILS}\`), which the JUnit report records as passed`,
        "vitest unhandled errors › Unhandled Rejection: never handled: an error",
      ].sort(),
    );
  }, 120_000);

  // Playwright as CI runs it: the JSON report at PLAYWRIGHT_REPORT, one retry, the projects each job selects.
  const playwrightConfig = (projects: string) =>
    [
      "export default {",
      '  testDir: "t",',
      // Playwright's default outputDir is the package's test-results/, which a run empties first: never this repository's.
      '  outputDir: "pw-out",',
      "  retries: 1,",
      `  reporter: [["json", { outputFile: ${JSON.stringify(PLAYWRIGHT_REPORT)} }]],`,
      `  projects: [${projects}],`,
      "};",
      "",
    ].join("\n");
  const E2E_PROJECTS =
    '{ name: "desktop-ar", testMatch: /main\\.spec\\.mjs$/ }, { name: "access-audit", testMatch: /audit\\.spec\\.mjs$/ }';
  const playwrightRun = (dir: string) =>
    spawnSync(process.execPath, [playwrightCli, "test", "-c", join(dir, "pw.config.mjs")], {
      cwd: dir,
      encoding: "utf8",
      env: childEnv(),
    });

  it("passes a Playwright run whose selected projects all ran and passed, and refuses its report changed or gone", () => {
    const dir = plantRoot("proof-playwright", {
      "pw.config.mjs": playwrightConfig(E2E_PROJECTS),
      "t/main.spec.mjs": PLAYWRIGHT_OK,
      "t/audit.spec.mjs": PLAYWRIGHT_OK,
    });
    const run = playwrightRun(dir);
    expect(run.status, run.stdout + run.stderr).toBe(0);
    const summary = `2 tests in desktop-ar and access-audit passed (${PLAYWRIGHT_REPORT})`;
    expect(proveRun("e2e", { root: dir })).toEqual({ findings: [], summary });
    expect(proofCliRun(dir, "e2e")).toEqual([
      0,
      `required run proof (V13-ARCH-020): "e2e": ${summary}\n`,
      "",
    ]);

    const report = join(dir, PLAYWRIGHT_REPORT);
    const json = readFileSync(report, "utf8");
    const started = (JSON.parse(json) as { stats: { startTime: string } }).stats.startTime;
    const withReport = (text: string) => (writeFileSync(report, text), dir);
    expect(proof("e2e", withReport(json.slice(0, -10)))).toEqual([
      `${PLAYWRIGHT_REPORT}: the report is cut short or is not JSON`,
    ]);
    expect(proof("e2e", withReport("{}"))).toEqual([`${PLAYWRIGHT_REPORT}: not a Playwright JSON report`]);
    expect(proof("e2e", withReport(json), Date.parse(started) + 61 * 60_000)).toEqual([
      `${PLAYWRIGHT_REPORT}: the run started at ${started}, more than an hour ago: not this job's report`,
    ]);
    expect(proof("e2e", withReport(json), Date.parse(started) - 6 * 60_000)).toEqual([
      `${PLAYWRIGHT_REPORT}: the run started at ${started}, after the check`,
    ]);
    // The e2e report read as the cross-browser run's.
    expect(proof("cross-browser", withReport(json))).toEqual(
      [
        `${PLAYWRIGHT_REPORT}: no test of the project firefox-ar ran`,
        `${PLAYWRIGHT_REPORT}: no test of the project webkit-ar ran`,
        "t/main.spec.mjs:2 runs [desktop-ar]: a project this run does not select",
        "t/audit.spec.mjs:2 runs [access-audit]: a project this run does not select",
      ].sort(),
    );
    rmSync(report);
    expect(proof("e2e", dir)).toEqual([
      `${PLAYWRIGHT_REPORT}: the run wrote no report: its tests did not run`,
    ]);
  }, 120_000);

  it("names each Playwright test that did not run and pass, a project not selected, one with no test, and an error outside the tests", () => {
    const dir = plantRoot("proof-playwright-planted", {
      "pw.config.mjs": playwrightConfig(
        `${E2E_PROJECTS}, { name: "other", testMatch: /other\\.spec\\.mjs$/ }`,
      ),
      "t/main.spec.mjs": [
        'import { expect, test } from "@playwright/test";',
        'test("passes", () => expect(1).toBe(1));',
        'test.skip("skipped", () => {});',
        'test.fixme("fixme", () => {});',
        'test("skipped at run time", () => test.skip());',
        'test("pinned to fail", () => {',
        "  test.fail();",
        "  expect(1).toBe(2);",
        "});",
        'test("flaky", ({}, info) => expect(info.retry).toBe(1));',
        'test("fails", () => expect(1).toBe(2));',
        "",
      ].join("\n"),
      "t/other.spec.mjs": PLAYWRIGHT_OK,
    });
    const run = playwrightRun(dir);
    expect(run.status, run.stdout + run.stderr).toBe(1);
    const findings = [
      `${PLAYWRIGHT_REPORT}: no test of the project access-audit ran`,
      "t/main.spec.mjs:3 skipped [desktop-ar]: skipped",
      "t/main.spec.mjs:4 fixme [desktop-ar]: skipped",
      "t/main.spec.mjs:5 skipped at run time [desktop-ar]: skipped",
      "t/main.spec.mjs:6 pinned to fail [desktop-ar]: pinned to fail (test.fail)",
      "t/main.spec.mjs:10 flaky [desktop-ar]: flaky: failed, then passed on retry",
      "t/main.spec.mjs:11 fails [desktop-ar]: failed (unexpected)",
      "t/other.spec.mjs:2 runs [other]: a project this run does not select",
      `${PLAYWRIGHT_REPORT}: the report's totals (expected 3, unexpected 1, flaky 1, skipped 3) are not 8 tests all passed`,
    ];
    expect(proof("e2e", dir)).toEqual([...findings].sort());
    const { findings: inOrder } = proveRun("e2e", { root: dir });
    expect(proofCliRun(dir, "e2e")).toEqual([1, "", failed("e2e", 9, formatProofFindings(inOrder))]);

    const broken = plantRoot("proof-playwright-load-error", {
      "pw.config.mjs": playwrightConfig(E2E_PROJECTS),
      "t/main.spec.mjs": 'throw new Error("broken at load");\n',
      "t/audit.spec.mjs": PLAYWRIGHT_OK,
    });
    const loadRun = playwrightRun(broken);
    expect(loadRun.status, loadRun.stdout + loadRun.stderr).toBe(1);
    expect(proof("e2e", broken)).toEqual(
      [
        "t/main.spec.mjs:1: an error outside the tests: Error: broken at load",
        `${PLAYWRIGHT_REPORT}: the report counts no test`,
        `${PLAYWRIGHT_REPORT}: no test of the project desktop-ar ran`,
        `${PLAYWRIGHT_REPORT}: no test of the project access-audit ran`,
      ].sort(),
    );
  }, 120_000);

  it("takes one known run name and nothing else", () => {
    const dir = plantRoot("proof-usage", {});
    const usage =
      "usage: node scripts/ci/required-runs.mjs <unit | integration | e2e | visual | cross-browser>\n";
    for (const args of [[], ["smoke"], ["unit", "e2e"], ["toString"]])
      expect(proofCliRun(dir, ...args), args.join(" ")).toEqual([2, "", usage]);
  });

  /** The variables the two configs read to pick reporters and projects, each restored after a load. */
  const CONFIG_ENV = [
    "CI",
    "V13_E2E_BROWSERS",
    "V13_E2E_VISUAL",
    "V13_E2E_BASE_URL",
    "V13_E2E_TLS_CERT",
    "V13_E2E_TLS_KEY",
    "V13_E2E_SESSION_SECRET",
  ];
  let loads = 0;
  /** A config module loaded afresh with only `env` among CONFIG_ENV set. */
  const loadConfig = async <T>(file: string, env: Record<string, string>): Promise<T> => {
    for (const k of CONFIG_ENV) vi.stubEnv(k, env[k]);
    try {
      const url = `${pathToFileURL(join(ROOT, file)).href}?required-run-proof=${++loads}`;
      return ((await import(/* @vite-ignore */ url)) as { default: T }).default;
    } finally {
      vi.unstubAllEnvs();
    }
  };
  interface VitestConfigShape {
    test: {
      reporters: unknown[];
      outputFile: { junit: string };
      projects: { test: { name: string; include: string[] } }[];
    };
  }
  interface PlaywrightConfigShape {
    reporter: unknown;
    projects: { name: string }[];
  }

  it("each required job ends with the proof of the run it makes, and each proof names what the job and the configs select", async () => {
    const input = repositoryInput();
    const findings = checkProofSteps(input);
    expect(findings, formatStepFindings(findings)).toEqual([]);
    expect(PROOF_JOBS.map((j) => j.run).sort()).toEqual(Object.keys(RUNS).sort());

    // The reports are where the configs write them in CI, and a Vitest run's directories are its include globs'.
    const vitestConfig = await loadConfig<VitestConfigShape>("vitest.config.ts", { CI: "true" });
    expect(vitestConfig.test.reporters).toContain("junit");
    expect(vitestConfig.test.outputFile.junit).toBe(VITEST_REPORT);
    for (const name of ["unit", "integration"]) {
      const want = RUNS[name]!;
      const project = vitestConfig.test.projects.find((p) => p.test.name === name)!;
      const dirs = [...new Set(project.test.include.map((g) => g.slice(0, g.indexOf("/**"))))];
      expect(want.tool === "vitest" ? [want.project, ...want.roots] : [], name).toEqual([name, ...dirs]);
    }
    const playwrightCi = await loadConfig<PlaywrightConfigShape>("playwright.config.ts", { CI: "true" });
    expect(playwrightCi.reporter).toContainEqual(["json", { outputFile: PLAYWRIGHT_REPORT }]);

    // Each proof names what its job runs: the Vitest project, or the Playwright projects the run selects, from those
    // the config lists with the job's own V13_E2E_BROWSERS and V13_E2E_VISUAL.
    for (const j of PROOF_JOBS) {
      const at = `${j.file} ${j.job}`;
      const want = RUNS[j.run]!;
      const runs = findInvocations(input).filter((r) => r.file === j.file && r.job === j.job);
      expect(runs.length, at).toBeGreaterThan(0);
      if (want.tool === "vitest") {
        for (const r of runs) expect([r.tool, ...r.projects], at).toEqual(["vitest", want.project]);
        continue;
      }
      const env: Record<string, string> = { CI: "true" };
      for (const l of input.workflows.find((w) => w.file === j.file)!.lines)
        if (
          l.path.join(" ") === `jobs ${j.job} env ${l.key}` &&
          /^V13_E2E_(BROWSERS|VISUAL)$/.test(l.key ?? "")
        )
          env[l.key!] = l.value ?? "";
      const listed = (await loadConfig<PlaywrightConfigShape>("playwright.config.ts", env)).projects.map(
        (p) => p.name,
      );
      for (const r of runs) {
        expect(r.tool, at).toBe("playwright");
        expect(r.projects.length > 0 ? r.projects : listed, at).toEqual(want.projects);
      }
      for (const p of want.projects) expect(listed, at).toContain(p);
    }
  }, 60_000);

  /** Planted workflows that pass the static half; each case below changes one thing. */
  const PROOF_STEP = (run: string) => [
    "      - name: Required run proof",
    "        if: always()",
    `        run: node scripts/ci/required-runs.mjs ${run}`,
  ];
  const PROOF_CI = [
    "name: CI",
    "on:",
    "  pull_request:",
    "jobs:",
    "  unit:",
    "    runs-on: ubuntu-24.04",
    "    steps:",
    "      - run: pnpm test",
    ...PROOF_STEP("unit"),
    "  integration:",
    "    runs-on: ubuntu-24.04",
    "    env:",
    '      V13_DB_TESTS_REQUIRED: "1"',
    "    steps:",
    "      - run: pnpm test:db",
    ...PROOF_STEP("integration"),
    "  e2e:",
    "    runs-on: ubuntu-24.04",
    "    steps:",
    "      - run: pnpm test:e2e",
    ...PROOF_STEP("e2e"),
    "  visual:",
    "    runs-on: ubuntu-24.04",
    "    steps:",
    "      - run: pnpm exec playwright test --project=visual-baseline",
    ...PROOF_STEP("visual"),
    "",
  ];
  const PROOF_CROSS = [
    "name: Cross-browser",
    "on:",
    "  pull_request:",
    "jobs:",
    "  e2e:",
    "    runs-on: ubuntu-24.04",
    "    steps:",
    "      - run: pnpm exec playwright test --project=firefox-ar --project=webkit-ar",
    ...PROOF_STEP("cross-browser"),
    "",
  ];
  const PROOF_SCRIPTS = {
    test: { command: "vitest run --project unit", line: 20 },
    "test:db": { command: "vitest run --project integration", line: 21 },
    "test:e2e": { command: "playwright test", line: 22 },
  };
  /** The static findings as `file:line detail`. */
  const steps = (ci: readonly string[], cross: readonly string[] = PROOF_CROSS) =>
    checkProofSteps({
      workflows: [
        { file: ".github/workflows/ci.yml", lines: readWorkflow(ci.join("\n")) },
        { file: ".github/workflows/cross-browser.yml", lines: readWorkflow(cross.join("\n")) },
      ],
      scripts: PROOF_SCRIPTS,
    }).map((f) => `${f.file.replace(".github/workflows/", "")}:${f.line} ${f.detail}`);
  /** `src` with `count` lines from line `n` (from 1) replaced by `lines`. */
  const swap = (src: readonly string[], n: number, count: number, ...lines: string[]) => [
    ...src.slice(0, n - 1),
    ...lines,
    ...src.slice(n - 1 + count),
  ];

  it("a planted change to a proof step, a test job without one, or a start-up variable fails at file:line", () => {
    expect(steps(PROOF_CI)).toEqual([]);
    const unit =
      "the unit job must end with exactly this step: name: Required run proof, if: always(), " +
      "run: node scripts/ci/required-runs.mjs unit";
    const proofStep = "        run: node scripts/ci/required-runs.mjs unit";

    // The proof step gone, or any part of it changed or added to.
    expect(steps(swap(PROOF_CI, 9, 3))).toEqual([`ci.yml:8 ${unit}`]);
    for (const changed of [
      swap(PROOF_CI, 11, 1, "        run: node scripts/ci/required-runs.mjs e2e"),
      swap(PROOF_CI, 10, 1, "        if: success()"),
      swap(PROOF_CI, 9, 1, "      - name: Proof"),
      swap(PROOF_CI, 11, 1, proofStep, "        shell: bash"),
      swap(PROOF_CI, 11, 1, proofStep, "        continue-on-error: true"),
      swap(PROOF_CI, 11, 1, proofStep, "        working-directory: elsewhere"),
      swap(PROOF_CI, 11, 1, proofStep, "        env:", "          FOO: bar"),
      swap(PROOF_CI, 11, 1, "        run: |", "          node scripts/ci/required-runs.mjs unit"),
    ])
      expect(steps(changed), changed.slice(8, 13).join("\n")).toEqual([`ci.yml:9 ${unit}`]);
    // A step after it, a required job gone, and the cross-browser job's proof gone.
    expect(steps(swap(PROOF_CI, 12, 0, "      - run: echo done"))).toEqual([`ci.yml:12 ${unit}`]);
    expect(steps(swap(PROOF_CI, 28, 7))).toEqual([
      'ci.yml:0 the job visual is missing: it runs the required run "visual"',
    ]);
    expect(steps(PROOF_CI, swap(PROOF_CROSS, 9, 3))).toEqual([
      "cross-browser.yml:8 the e2e job must end with exactly this step: name: Required run proof, if: always(), " +
        "run: node scripts/ci/required-runs.mjs cross-browser",
    ]);
    // A job that runs a test is a required job.
    const smoke = [
      "  smoke:",
      "    runs-on: ubuntu-24.04",
      "    steps:",
      "      - run: pnpm exec playwright test",
    ];
    expect(steps([...PROOF_CI.slice(0, -1), ...smoke, ""])).toEqual([
      "ci.yml:38 the smoke job runs a test but does not end with the required run proof",
    ]);
    // defaults: would give the proof step another shell or working directory.
    const defaults = ["defaults:", "  run:", "    working-directory: elsewhere"];
    expect(steps(swap(PROOF_CI, 4, 0, ...defaults))).toEqual([
      "ci.yml:4 defaults: where a job ends with the proof: its run settings would reach the proof step",
    ]);
    expect(steps(swap(PROOF_CI, 7, 0, "    defaults:", "      run:", "        shell: bash"))).toEqual([
      "ci.yml:7 defaults: where a job ends with the proof: its run settings would reach the proof step",
    ]);

    // A start-up variable at each env: level; an ordinary name is no finding.
    const startup = (n: number, name: string) =>
      `ci.yml:${n} ${name} in env: reaches the shell or node of later steps, the proof's included`;
    expect(
      steps(swap(PROOF_CI, 4, 0, "env:", "  BASH_ENV: /tmp/x", '  NEXT_TELEMETRY_DISABLED: "1"')),
    ).toEqual([startup(5, "BASH_ENV")]);
    expect(
      steps(swap(PROOF_CI, 15, 0, "      NODE_OPTIONS: --require ./x.cjs", "      LD_PRELOAD: /tmp/x.so")),
    ).toEqual([startup(15, "NODE_OPTIONS"), startup(16, "LD_PRELOAD")]);
    const stepEnv = [
      "        env:",
      "          SHELLOPTS: xtrace",
      "          PATH: /tmp/bin",
      "          ENV: /tmp/x",
    ];
    expect(
      steps(swap(PROOF_CI, 8, 1, "      - run: pnpm test", ...stepEnv, "          BASHOPTS: extdebug")),
    ).toEqual([startup(10, "SHELLOPTS"), startup(11, "PATH"), startup(12, "ENV"), startup(13, "BASHOPTS")]);
    expect(
      steps(swap(PROOF_CI, 15, 0, '      "BASH_ENV": /tmp/x', "      'NODE_OPTIONS': --require ./x.cjs")),
    ).toEqual([startup(15, "BASH_ENV"), startup(16, "NODE_OPTIONS")]);
    // A line whose name cannot be read, and an env: block on one line.
    const unread = (n: number) =>
      `ci.yml:${n} a line in an env: block that is not NAME: value, so its name cannot be checked`;
    expect(steps(swap(PROOF_CI, 15, 0, "      BASH_FUNC_node%%: () { true; }"))).toEqual([unread(15)]);
    expect(steps(swap(PROOF_CI, 15, 0, "      BASH_ENV : /tmp/x"))).toEqual([unread(15)]);
    expect(steps(swap(PROOF_CI, 15, 0, "      ? BASH_ENV", "      : /tmp/x"))).toEqual([
      unread(15),
      unread(16),
    ]);
    expect(steps(swap(PROOF_CI, 15, 0, "      <<: *startup"))).toEqual([unread(15)]);
    const inline = (n: number) =>
      `ci.yml:${n} an env: block on one line ({ … } or an alias), so its names cannot be checked`;
    expect(steps(swap(PROOF_CI, 14, 2, "    env: { BASH_ENV: /tmp/x, V13_DB_TESTS_REQUIRED: '1' }"))).toEqual(
      [inline(14)],
    );
    expect(steps(swap(PROOF_CI, 4, 0, "env: *startup"))).toEqual([inline(4)]);
    expect(steps(swap(PROOF_CI, 8, 1, "      - run: pnpm test", "        env: { NODE_OPTIONS: x }"))).toEqual(
      [inline(9)],
    );

    // $GITHUB_ENV only as `echo "NAME=value" >> "$GITHUB_ENV"`, never a start-up name; $GITHUB_PATH never. The
    // repository's own form and a shell comment are no finding.
    expect(
      steps(
        swap(
          PROOF_CI,
          8,
          1,
          "      - run: |",
          '          echo "NODE_OPTIONS=--require ./x.cjs" >> "$GITHUB_ENV"',
          '          echo "$NAME=1" >> "$GITHUB_ENV"',
          "          printf 'X=1\\n' >> \"$GITHUB_ENV\"",
          '          echo "X=1" | tee -a "$GITHUB_ENV"',
          '          echo "/tmp/bin" >> "$GITHUB_PATH"',
          '          echo "V13_E2E_TLS_CERT=$dir/cert.pem" >> "$GITHUB_ENV"',
          "          # a comment that names $GITHUB_ENV writes nothing",
          "          pnpm test",
        ),
      ),
    ).toEqual([
      "ci.yml:9 NODE_OPTIONS through $GITHUB_ENV reaches the shell or node of later steps",
      'ci.yml:10 write $GITHUB_ENV only as echo "NAME=value" >> "$GITHUB_ENV", one literal name a line',
      'ci.yml:11 write $GITHUB_ENV only as echo "NAME=value" >> "$GITHUB_ENV", one literal name a line',
      'ci.yml:12 write $GITHUB_ENV only as echo "NAME=value" >> "$GITHUB_ENV", one literal name a line',
      "ci.yml:13 $GITHUB_PATH is never written: it would shadow node",
    ]);
  });
});
