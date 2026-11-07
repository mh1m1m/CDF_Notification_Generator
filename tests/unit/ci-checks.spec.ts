// The repository checks in scripts/ci. Two run inside `pnpm lint`: logical CSS only (RTL/LTR), and .env.example holding
// documented names without values. Two belong to the `visual` job of .github/workflows/ci.yml: the candidate check
// (V13-ARCH-014: a run without committed baselines passes only when it failed on missing snapshots alone and wrote one
// PNG candidate for each, and no baseline), and the mode (V13-ARCH-015: candidate mode is refused once baselines have
// been committed, so deleting every baseline fails the job). The last describe pins the trigger of
// .github/workflows/cross-browser.yml (V13-ARCH-016): every pull request and every push to develop.
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { findReferencedEnvNames, parseEnvExample } from "@/scripts/ci/check-env-example.mjs";
import { findPhysicalClasses, findPhysicalCss } from "@/scripts/ci/check-logical-css.mjs";
import { checkCandidateRun, collectTests } from "@/scripts/ci/visual-candidates.mjs";
import { decideVisualMode } from "@/scripts/ci/visual-mode.mjs";

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
