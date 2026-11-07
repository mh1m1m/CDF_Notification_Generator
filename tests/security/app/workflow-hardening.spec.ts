// V13-SEC-015, V13-SEC-016 · GitHub Actions workflow hardening (tests/security/workflow-hardening.ts, rules W0–W7).
// SYNTHETIC-DATA REFERENCE IMPLEMENTATION. The real workflows must be clean; each rule is proven by a planted negative
// reported at its file and line, and the reader by its key paths.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  checkWorkflow,
  checkWorkflowDir,
  formatWorkflowFindings,
  packageScripts,
  readWorkflow,
  shellOperators,
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
      - if: contains(github.event.pull_request.labels.*.name, 'visual') && steps.github.outputs.ok == 'yes'
        run: echo "{braces in quotes}" "[a: b]"
`;

const CHECKOUT = `      - uses: actions/checkout@${SHA} # v4.2.2\n        with:\n          persist-credentials: false\n`;

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

  it("all of them pass W0–W7", () => {
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
    // ARCH's review of f5e7282: flow mappings inside a sequence, and the secrets and token read another way.
    ["W0: a flow mapping as a list item", "W0", `${CHECKOUT}`, "      - { uses: actions/checkout@v4 }\n"],
    [
      "W0: a flow sequence of flow mappings",
      "W0",
      `    steps:\n${CHECKOUT}`,
      '    steps: [{ uses: "actions/checkout@v4" }]\n    more:\n',
    ],
    [
      "W0: a flow sequence holding a key: value pair",
      "W0",
      `    steps:\n${CHECKOUT}`,
      "    steps: [uses: actions/checkout@v4]\n    more:\n",
    ],
    [
      "W0: a flow sequence that spans lines",
      "W0",
      `    steps:\n${CHECKOUT}`,
      "    steps: [\n      uses: actions/checkout@v4 ]\n    more:\n",
    ],
    [
      "W3: secrets by index",
      "W3",
      "      TITLE: ${{ github.event.pull_request.title }}",
      "      TOKEN: ${{ secrets['NPM_TOKEN'] }}",
    ],
    [
      "W3: the whole secrets context",
      "W3",
      "      TITLE: ${{ github.event.pull_request.title }}",
      "      ALL: ${{ toJSON(secrets) }}",
    ],
    [
      "W3: the token by index",
      "W3",
      "      TITLE: ${{ github.event.pull_request.title }}",
      "      GH_TOKEN: ${{ github['token'] }}",
    ],
    [
      "W3: the whole github context",
      "W3",
      "      TITLE: ${{ github.event.pull_request.title }}",
      "      CTX: ${{ toJSON(github) }}",
    ],
    [
      "W3: secrets in an if: without delimiters",
      "W3",
      "      - run: pnpm test",
      "      - if: secrets.NPM_TOKEN != ''\n        run: pnpm test",
    ],
    [
      "W3: the whole github context in an if:",
      "W3",
      "      - run: pnpm test",
      "      - if: contains(toJSON(github), 'x')\n        run: pnpm test",
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
    // The token by index is the same exception; the whole github context and the secrets context are not.
    const indexed = release("tag", "write").replace("github.token", "github['token']");
    expect(rules("release.yml", indexed)).toEqual([]);
    expect(rules("ci.yml", indexed)).toEqual(["W1:10", "W3:15"]);
    expect(rules("release.yml", release("tag", "write").replace("github.token", "toJSON(github)"))).toEqual([
      "W3:15",
    ]);
    expect(rules("release.yml", release("tag", "write").replace("github.token", "secrets['X']"))).toEqual([
      "W3:15",
    ]);
  });
});

describe("V13-SEC-016 W7: a test run's failure fails its job", () => {
  // `pnpm test` runs Vitest through package.json, as in the real workflows (findInvocations follows the script).
  const SCRIPTS = { test: { command: "vitest run --project unit", line: 1 } };
  const W7 = `name: W7
on:
  pull_request:
permissions:
  contents: read
jobs:
  prepare:
    runs-on: ubuntu-24.04
    steps:
      - run: echo ready
  test:
    runs-on: ubuntu-24.04
    steps:
      - uses: actions/checkout@${SHA} # v4.2.2
        with:
          persist-credentials: false
      - run: which jq || echo "no jq"
      - name: Tests
        run: |
          echo start | tee start.log
          pnpm test 2>&1
      - if: always()
        run: echo done
`;
  const w7 = (src: string, file = "planted.yml") =>
    checkWorkflow(file, src, SCRIPTS)
      .filter((f) => f.rule === "W7")
      .map((f) => f.line);
  const swap = (from: string, to: string, src = W7) => {
    expect(src.split(from).length, `exactly one "${from}"`).toBe(2);
    return src.replace(from, to);
  };
  const lineOf = (src: string, needle: string) => src.split("\n").findIndex((l) => l.includes(needle)) + 1;

  it("the control is clean: `||` and a pipe outside the test line, a redirect on it, if: always() on a non-test step", () => {
    expect(checkWorkflow("planted.yml", W7, SCRIPTS)).toEqual([]);
  });

  it("finds the test run through package.json: without the script, the same workflow has no test step", () => {
    const src = swap("          pnpm test 2>&1", "          pnpm test 2>&1 || true");
    expect(w7(src)).toEqual([lineOf(src, "|| true")]);
    expect(checkWorkflow("planted.yml", src, {}).filter((f) => f.rule === "W7")).toEqual([]);
  });

  const cases: [string, string, string, string][] = [
    // [name, from, to, the text of the line the finding names]
    [
      "continue-on-error on the test step",
      "      - name: Tests\n",
      "      - name: Tests\n        continue-on-error: true\n",
      "continue-on-error",
    ],
    [
      "continue-on-error on the test job",
      "  test:\n    runs-on: ubuntu-24.04\n",
      "  test:\n    continue-on-error: true\n    runs-on: ubuntu-24.04\n",
      "continue-on-error",
    ],
    [
      "continue-on-error on any other job",
      "  prepare:\n    runs-on: ubuntu-24.04\n",
      "  prepare:\n    continue-on-error: true\n    runs-on: ubuntu-24.04\n",
      "continue-on-error",
    ],
    [
      "if: on the test step",
      "      - name: Tests\n",
      "      - name: Tests\n        if: github.event_name == 'push'\n",
      "if: github.event_name",
    ],
    [
      "if: always() on the test step",
      "      - name: Tests\n",
      "      - name: Tests\n        if: always()\n",
      "        if: always()",
    ],
    [
      "if: on the test job",
      "  test:\n    runs-on: ubuntu-24.04\n",
      "  test:\n    if: false\n    runs-on: ubuntu-24.04\n",
      "if: false",
    ],
    [
      "if: on a job the test job needs (needs: a)",
      "  prepare:\n    runs-on: ubuntu-24.04\n    steps:\n      - run: echo ready\n  test:\n    runs-on: ubuntu-24.04\n",
      "  prepare:\n    if: false\n    runs-on: ubuntu-24.04\n    steps:\n      - run: echo ready\n  test:\n    needs: prepare\n    runs-on: ubuntu-24.04\n",
      "if: false",
    ],
    [
      "shell: sh on the test step",
      "      - name: Tests\n",
      "      - name: Tests\n        shell: sh\n",
      "shell: sh",
    ],
    [
      "shell: bash {0} (no -e) on the test step",
      "      - name: Tests\n",
      "      - name: Tests\n        shell: bash {0}\n",
      "shell: bash {0}",
    ],
    [
      "defaults.run.shell on the test job",
      "  test:\n    runs-on: ubuntu-24.04\n",
      "  test:\n    defaults:\n      run:\n        shell: pwsh\n    runs-on: ubuntu-24.04\n",
      "shell: pwsh",
    ],
    [
      "defaults.run.shell on the workflow",
      "jobs:\n",
      "defaults:\n  run:\n    shell: sh\njobs:\n",
      "shell: sh",
    ],
    ["|| true after the test run", "          pnpm test 2>&1", "          pnpm test 2>&1 || true", "|| true"],
    [
      "|| exit 0 after the test run",
      "          pnpm test 2>&1",
      "          pnpm test || exit 0",
      "|| exit 0",
    ],
    [
      "a pipe after the test run, default shell",
      "          pnpm test 2>&1",
      "          pnpm test | tee test.log",
      "| tee test.log",
    ],
    [
      "|& after the test run, default shell",
      "          pnpm test 2>&1",
      "          pnpm test |& tee test.log",
      "|& tee",
    ],
    ["the test run in the background", "          pnpm test 2>&1", "          pnpm test &", "pnpm test &"],
    [
      "the test run as an if condition",
      "          pnpm test 2>&1",
      "          if pnpm test; then echo ok; fi",
      "if pnpm test",
    ],
    ["the test run negated", "          pnpm test 2>&1", "          ! pnpm test", "! pnpm test"],
    [
      "the test run as a while condition",
      "          pnpm test 2>&1",
      "          while pnpm test; do break; done",
      "while pnpm test",
    ],
    ["set +e before the test run", "          echo start | tee start.log", "          set +e", "set +e"],
    ["set +o errexit", "          echo start | tee start.log", "          set +o errexit", "set +o errexit"],
    [
      "set +o pipefail, even with shell: bash",
      "          echo start | tee start.log",
      "          set +o pipefail",
      "set +o pipefail",
    ],
  ];
  for (const [name, from, to, at] of cases)
    it(`${name} → W7 at its line`, () => {
      const src = swap(from, to);
      expect(w7(src)).toContain(lineOf(src, at));
    });

  it("if: on a job the test job needs, in a list and transitively", () => {
    const base = swap(
      "  prepare:\n    runs-on: ubuntu-24.04\n",
      "  prepare:\n    needs: [first]\n    runs-on: ubuntu-24.04\n",
    )
      .replace(
        "  test:\n    runs-on: ubuntu-24.04\n",
        "  test:\n    needs:\n      - prepare\n    runs-on: ubuntu-24.04\n",
      )
      .replace(
        "jobs:\n",
        "jobs:\n  first:\n    runs-on: ubuntu-24.04\n    steps:\n      - run: echo first\n",
      );
    expect(w7(base)).toEqual([]);
    const src = base.replace("  first:\n    runs-on", "  first:\n    if: false\n    runs-on");
    expect(w7(src)).toEqual([lineOf(src, "if: false")]);
    // A job no test job needs may have an if:
    const free =
      base + "  other:\n    if: false\n    runs-on: ubuntu-24.04\n    steps:\n      - run: echo other\n";
    expect(w7(free)).toEqual([]);
  });

  it("pipefail on: shell: bash on the step, the job or the workflow, or an earlier set -o pipefail", () => {
    const piped = swap("          pnpm test 2>&1", "          pnpm test | tee test.log");
    expect(w7(piped.replace("      - name: Tests\n", "      - name: Tests\n        shell: bash\n"))).toEqual(
      [],
    );
    expect(
      w7(
        piped.replace(
          "  test:\n    runs-on",
          "  test:\n    defaults:\n      run:\n        shell: bash\n    runs-on",
        ),
      ),
    ).toEqual([]);
    expect(w7(piped.replace("jobs:\n", "defaults:\n  run:\n    shell: bash\njobs:\n"))).toEqual([]);
    expect(w7(piped.replace("          echo start | tee start.log", "          set -euo pipefail"))).toEqual(
      [],
    );
    // set -o pipefail after the test line does not count.
    const late = piped.replace(
      "          pnpm test | tee test.log",
      "          pnpm test | tee test.log\n          set -o pipefail",
    );
    expect(w7(late)).toEqual([lineOf(late, "| tee test.log")]);
  });

  it("shellOperators: quotes, $( ), comments and redirections are not operators", () => {
    expect(shellOperators(`pnpm test 2>&1 >&2 &>/dev/null`)).toEqual([]);
    expect(shellOperators(`echo "a || b | c &" 'x;y' $(a || b) # || c`)).toEqual([]);
    expect(shellOperators(`a && b || c | d |& e & f; g`)).toEqual(["&&", "||", "|", "|&", "&", ";"]);
  });

  describe("the reviewed exceptions hold only in their exact form", () => {
    const CAPTURE = `name: CI
on:
  pull_request:
permissions:
  contents: read
jobs:
  visual:
    runs-on: ubuntu-24.04
    steps:
      - name: Candidates
        run: |
          rc=0
          pnpm exec playwright test --project=visual-baseline --reporter=list,json --retries=0 || rc=$?
          node scripts/ci/visual-candidates.mjs "$rc" test-results/visual-baseline.json test-results/baseline-candidates tests/visual/__screenshots__
`;
    it("ci.yml's visual candidate capture, handed to the judge on the next line", () => {
      expect(w7(CAPTURE, "ci.yml")).toEqual([]);
      const at = lineOf(CAPTURE, "|| rc=$?");
      expect(w7(CAPTURE, "cross-browser.yml"), "another file").toEqual([at]);
      expect(w7(CAPTURE.replace("  visual:", "  e2e:"), "ci.yml"), "another job").toEqual([at]);
      expect(
        w7(CAPTURE.replace("--retries=0 || rc", "--retries=0 --grep x || rc"), "ci.yml"),
        "other args",
      ).toEqual([at]);
      expect(w7(CAPTURE.replace("|| rc=$?", "|| true"), "ci.yml"), "not a capture").toEqual([at]);
      const unjudged = CAPTURE.replace(
        / {10}node scripts\/ci\/visual-candidates.mjs[^\n]*\n/,
        "          exit 0\n",
      );
      expect(w7(unjudged, "ci.yml"), "the code never reaches the judge").toEqual([at]);
      const later = CAPTURE.replace(
        "          node scripts/ci",
        "          echo between\n          node scripts/ci",
      );
      expect(w7(later, "ci.yml"), "the judge not on the next line").toEqual([at]);
    });

    const LIBRARY = `name: Visual library
on:
  pull_request:
permissions:
  contents: read
jobs:
  library:
    if: contains(github.event.pull_request.labels.*.name, 'visual-library')
    runs-on: ubuntu-24.04
    steps:
      - run: pnpm exec playwright test --project=visual-library
`;
    it("visual-library.yml's opt-in label if:", () => {
      expect(w7(LIBRARY, "visual-library.yml")).toEqual([]);
      const at = lineOf(LIBRARY, "    if:");
      expect(w7(LIBRARY, "ci.yml"), "another file").toEqual([at]);
      expect(w7(LIBRARY.replace("  library:", "  e2e:"), "visual-library.yml"), "another job").toEqual([at]);
      expect(
        w7(LIBRARY.replace("'visual-library')", "'visual-library') || always()"), "visual-library.yml"),
        "widened",
      ).toEqual([at]);
    });
  });

  it("checkWorkflowDir reads the repository's package.json two levels up, so W7 follows `pnpm <script>`", () => {
    const root = mkdtempSync(join(tmpdir(), "v13-w7-"));
    try {
      const dir = join(root, ".github", "workflows");
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "a.yml"), swap("          pnpm test 2>&1", "          pnpm test || true"));
      expect(checkWorkflowDir(dir).filter((f) => f.rule === "W7")).toEqual([]);
      writeFileSync(join(root, "package.json"), JSON.stringify({ scripts: { test: "vitest run" } }, null, 2));
      expect(checkWorkflowDir(dir).map((f) => `${f.rule} ${f.file}`)).toEqual(["W7 a.yml"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("the real workflows: planting each form in ci.yml's database step is caught there", () => {
    const dir = join(process.cwd(), ".github", "workflows");
    const scripts = packageScripts(join(process.cwd(), "package.json"));
    const ci = readFileSync(join(dir, "ci.yml"), "utf8");
    const db = "      - run: pnpm test:db\n";
    expect(ci.split(db).length).toBe(2);
    for (const to of [
      "      - run: pnpm test:db || true\n",
      "      - run: pnpm test:db | tee db.log\n",
      "      - run: pnpm test:db\n        continue-on-error: true\n",
      "      - if: false\n        run: pnpm test:db\n",
      "      - run: pnpm test:db\n        shell: sh\n",
    ]) {
      const src = ci.replace(db, to);
      expect(
        checkWorkflow("ci.yml", src, scripts).map((f) => f.rule),
        to,
      ).toContain("W7");
    }
  });
});
