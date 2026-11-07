// V13-SEC-015 · GitHub Actions workflow hardening (tests/security/workflow-hardening.ts, rules W0–W6).
// SYNTHETIC-DATA REFERENCE IMPLEMENTATION. The real workflows must be clean; each rule is proven by a planted negative
// reported at its file and line, and the reader by its key paths.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  checkWorkflow,
  checkWorkflowDir,
  formatWorkflowFindings,
  readWorkflow,
  stripComment,
  workflowFiles,
} from "../workflow-hardening";

const DIR = join(process.cwd(), ".github", "workflows");
const SHA = "11bd71901bbe5b1630ceea73d27597364c9af683";

/** A clean workflow; each planted negative changes one thing in it. */
const CLEAN = `name: Clean
on:
  push:
    branches: [develop]
  pull_request:

permissions:
  contents: read

concurrency:
  group: clean-\${{ github.ref }}

jobs:
  test:
    runs-on: ubuntu-24.04
    env:
      TITLE: \${{ github.event.pull_request.title }}
    steps:
      - uses: actions/checkout@${SHA} # v4.2.2
        with:
          persist-credentials: false
      - name: Use the title only through env
        run: |
          printf '%s\\n' "$TITLE"
      - run: pnpm test
`;

const rules = (file: string, src: string) => checkWorkflow(file, src).map((f) => `${f.rule}:${f.line}`);

describe("V13-SEC-015: the repository's workflows", () => {
  it("every workflow under .github/workflows is read (readdir, .yml and .yaml)", () => {
    const files = workflowFiles(DIR);
    expect(files.length).toBeGreaterThanOrEqual(4);
    for (const f of ["ci.yml", "cross-browser.yml", "release.yml", "visual-library.yml"])
      expect(files).toContain(f);
  });

  it("a .yaml file is read too, and nothing else (a workflow added later is scanned without a change here)", () => {
    const dir = mkdtempSync(join(tmpdir(), "v13-workflows-"));
    try {
      for (const f of ["a.yml", "b.yaml", "notes.md", "c.yml.bak"]) writeFileSync(join(dir, f), "name: x\n");
      expect(workflowFiles(dir)).toEqual(["a.yml", "b.yaml"]);
      writeFileSync(join(dir, "b.yaml"), CLEAN.replace("pull_request:", "pull_request_target:"));
      expect(
        checkWorkflowDir(dir)
          .filter((f) => f.file === "b.yaml")
          .map((f) => f.rule),
      ).toContain("W2");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("all of them pass W0–W6", () => {
    const findings = checkWorkflowDir(DIR);
    expect(findings, formatWorkflowFindings(findings)).toEqual([]);
  });
});

describe("V13-SEC-015: the reader", () => {
  it("gives a step's keys their path and keeps a run script as a block scalar", () => {
    const lines = readWorkflow(CLEAN);
    const persist = lines.find((l) => l.key === "persist-credentials")!;
    expect(persist.path).toEqual(["jobs", "test", "steps", "[0]", "with", "persist-credentials"]);
    expect(persist.value).toBe("false");
    const script = lines.find((l) => l.text.startsWith("printf"))!;
    expect(script.scalarOf).toEqual(["jobs", "test", "steps", "[1]", "run"]);
    expect(lines.find((l) => l.value === "pnpm test")!.path).toEqual(["jobs", "test", "steps", "[2]", "run"]);
  });

  it("strips comments but not a # inside quotes", () => {
    expect(stripComment("uses: a/b@x # v1")).toBe("uses: a/b@x");
    expect(stripComment(`run: echo "a # b"`)).toBe(`run: echo "a # b"`);
  });

  it("the clean workflow is clean (the control)", () => {
    expect(rules("clean.yml", CLEAN)).toEqual([]);
  });
});

describe("V13-SEC-015: planted negatives, each reported at file:line", () => {
  const plant = (from: string, to: string) => {
    expect(CLEAN.split(from).length, `exactly one "${from}"`).toBe(2);
    return CLEAN.replace(from, to);
  };
  const lineOf = (src: string, needle: string) => src.split("\n").findIndex((l) => l.includes(needle)) + 1;

  const cases: [string, string, string, string, string?][] = [
    // [name, rule, planted change (from → to), and the text of the line the finding must name when it is not the
    // first line of the change]
    ["W1: no top-level permissions", "W1", "permissions:\n  contents: read\n", ""],
    ["W1: top-level write", "W1", "  contents: read", "  contents: write", "permissions:"],
    [
      "W1: an extra top-level permission",
      "W1",
      "  contents: read",
      "  contents: read\n  id-token: write",
      "permissions:",
    ],
    ["W1: read-all", "W1", "permissions:\n  contents: read", "permissions: read-all"],
    [
      "W1: a job-level block outside release.yml",
      "W1",
      "    runs-on: ubuntu-24.04",
      "    runs-on: ubuntu-24.04\n    permissions:\n      contents: write",
      "    permissions:",
    ],
    ["W2: pull_request_target", "W2", "  pull_request:\n", "  pull_request_target:\n"],
    ["W2: workflow_run", "W2", "  pull_request:\n", "  workflow_run:\n    workflows: [CI]\n"],
    [
      "W2: an inline trigger list",
      "W2",
      "on:\n  push:\n    branches: [develop]\n  pull_request:\n",
      "on: [push, pull_request_target]\n",
    ],
    [
      "W3: a repository secret",
      "W3",
      "      TITLE: ${{ github.event.pull_request.title }}",
      "      TOKEN: ${{ secrets.NPM_TOKEN }}",
    ],
    [
      "W3: secrets: inherit",
      "W3",
      "    runs-on: ubuntu-24.04",
      "    runs-on: ubuntu-24.04\n    secrets: inherit",
      "secrets: inherit",
    ],
    [
      "W3: github.token outside release.yml's tag job",
      "W3",
      "      TITLE: ${{ github.event.pull_request.title }}",
      "      GH_TOKEN: ${{ github.token }}",
    ],
    [
      "W4: checkout keeps credentials",
      "W4",
      "          persist-credentials: false",
      "          persist-credentials: true",
    ],
    ["W4: checkout without the setting", "W4", "        with:\n          persist-credentials: false\n", ""],
    ["W5: a tag, not a SHA", "W5", `actions/checkout@${SHA}`, "actions/checkout@v4"],
    ["W5: a short SHA", "W5", `actions/checkout@${SHA}`, "actions/checkout@11bd719"],
    ["W5: a branch", "W5", `actions/checkout@${SHA}`, "actions/checkout@main"],
    [
      "W6: event text in a run script",
      "W6",
      `printf '%s\\n' "$TITLE"`,
      'echo "${{ github.event.pull_request.title }}"',
    ],
    [
      "W6: head_ref in an inline run",
      "W6",
      "      - run: pnpm test",
      "      - run: git checkout ${{ github.head_ref }}",
    ],
    ["W6: an input in a run script", "W6", `printf '%s\\n' "$TITLE"`, "echo ${{ inputs.name }}"],
    [
      "W0: a flow-style mapping",
      "W0",
      "        with:\n          persist-credentials: false\n",
      "        with: { persist-credentials: false }\n",
    ],
  ];

  for (const [name, rule, from, to, at] of cases) {
    it(`${name} → ${rule}`, () => {
      const src = plant(from, to);
      const findings = checkWorkflow("planted.yml", src);
      const mine = findings.filter((f) => f.rule === rule);
      expect(mine.length, formatWorkflowFindings(findings)).toBeGreaterThan(0);
      for (const f of mine) {
        expect(f.file).toBe("planted.yml");
        expect(f.line).toBeGreaterThanOrEqual(1);
      }
      // The finding names the planted line (the first line of the change unless the case says otherwise).
      const needle =
        at ??
        to
          .split("\n")
          .find((l) => l.trim() !== "")
          ?.trim();
      if (needle && rule !== "W4") expect(mine.map((f) => f.line)).toContain(lineOf(src, needle));
    });
  }

  it("W4 reports the checkout's own `uses:` line", () => {
    const src = plant("          persist-credentials: false", "          persist-credentials: true");
    expect(rules("planted.yml", src)).toEqual([`W4:${lineOf(src, "actions/checkout@")}`]);
  });

  it("W1/W3: release.yml's tag job may hold `contents: write` and read `github.token`; nowhere else", () => {
    const release = (job: string, perm: string) => `name: Release
on:
  push:
    branches: [main]
permissions:
  contents: read
jobs:
  ${job}:
    runs-on: ubuntu-24.04
    permissions:
      contents: ${perm}
    steps:
      - name: Tag
        env:
          GH_TOKEN: \${{ github.token }}
        run: gh release view
`;
    expect(rules("release.yml", release("tag", "write"))).toEqual([]);
    expect(rules("release.yml", release("other", "write"))).toEqual(["W1:10", "W3:15"]);
    expect(rules("release.yml", release("tag", "read"))).toEqual(["W1:10"]);
    expect(rules("ci.yml", release("tag", "write"))).toEqual(["W1:10", "W3:15"]);
  });
});
