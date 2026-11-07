// V13-SEC-015, V13-SEC-016 · GitHub Actions workflow hardening (tests/security/workflow-hardening.ts, rules W0–W7).
// SYNTHETIC-DATA REFERENCE IMPLEMENTATION. The real workflows must be clean; each rule is proven by a planted negative
// reported at its file and line, and the reader by its key paths.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  checkNpmrc,
  checkPnpmWorkspace,
  checkTestScripts,
  checkWorkflow,
  checkWorkflowDir,
  earlyExits,
  formatWorkflowFindings,
  packageScripts,
  readWorkflow,
  shellOperators,
  stripComment,
  W7_CAPTURE,
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
    // R1 on #172: `&&` joins the test run to a command that can end the step first.
    ["&& on the test line", "          pnpm test 2>&1", "          pnpm test && echo ok", "&& echo ok"],
    // R4 on #172: anything that can end the step with success before, or instead of, the test run.
    [
      '[ -z "$X" ] && exit 0 before the test run',
      "          echo start | tee start.log",
      '          [ -z "$X" ] && exit 0',
      "exit 0",
    ],
    [
      "a bare exit before the test run",
      "          echo start | tee start.log",
      "          exit",
      "          exit",
    ],
    [
      "exec true before the test run",
      "          echo start | tee start.log",
      "          exec true",
      "exec true",
    ],
    [
      "a function that shadows the runner",
      "          echo start | tee start.log",
      "          pnpm() { :; }",
      "pnpm()",
    ],
    [
      "a function keyword definition",
      "          echo start | tee start.log",
      "          function pnpm { :; }",
      "function pnpm",
    ],
    ["trap 'exit 0' EXIT", "          echo start | tee start.log", "          trap 'exit 0' EXIT", "trap"],
    ["return before the test run", "          echo start | tee start.log", "          return 0", "return 0"],
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

  it("R4: exit with a non-zero literal status and the words inside quotes are allowed", () => {
    expect(w7(swap("          echo start | tee start.log", '          [ -n "$X" ] || exit 1'))).toEqual([]);
    expect(
      w7(swap("          echo start | tee start.log", '          echo "exit 0; exec true; f() {}"')),
    ).toEqual([]);
    expect(earlyExits("exit 2")).toEqual([]);
    expect(earlyExits("exit $rc")).toEqual(["`exit $rc`"]);
    expect(earlyExits("exit 0")).toEqual(["`exit 0`"]);
    expect(earlyExits("echo 'exit 0' && printf exec")).toEqual([]);
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
        "          echo no judge\n",
      );
      expect(w7(unjudged, "ci.yml"), "the code never reaches the judge").toEqual([at]);
      const later = CAPTURE.replace(
        "          node scripts/ci",
        "          echo between\n          node scripts/ci",
      );
      expect(w7(later, "ci.yml"), "the judge not on the next line").toEqual([at]);
      // R2 on #172: the judge line is compared whole, so nothing may follow it.
      const judge = W7_CAPTURE.next;
      for (const tail of [" || true", "; true", " | tee judge.log", " && exit 0"]) {
        const src = CAPTURE.replace(judge, judge + tail);
        expect(w7(src, "ci.yml"), `judge${tail}`).toContain(at);
      }
      const otherArgs = CAPTURE.replace(judge, judge.replace("tests/visual/__screenshots__", "/tmp"));
      expect(w7(otherArgs, "ci.yml"), "a judge with other arguments").toEqual([at]);
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

  describe("R3: a package script that runs a test (pnpm runs it with sh -c: no -e, no pipefail)", () => {
    const at = (scripts: Record<string, string>) =>
      checkTestScripts(
        Object.fromEntries(Object.entries(scripts).map(([n, c], i) => [n, { command: c, line: i + 10 }])),
      ).map((f) => `${f.file}:${f.line}`);
    it("only && may join its commands", () => {
      expect(at({ test: "vitest run --project unit" })).toEqual([]);
      expect(at({ test: "pnpm lint && vitest run --project unit" })).toEqual([]);
      for (const bad of [
        "vitest run || true",
        "vitest run; echo done",
        "vitest run | tee unit.log",
        "vitest run |& tee unit.log",
        "vitest run &",
        "vitest run\necho done",
        "exit 0 && vitest run",
        "exec true && vitest run",
      ])
        expect(at({ test: bad }), bad).toEqual(["package.json:10"]);
    });
    it("follows a nested script, and leaves a script that runs no test alone", () => {
      // The flaw is in the script that holds it; the one that only calls it is clean.
      expect(at({ test: "pnpm unit", unit: "vitest run; exit 0" })).toEqual(["package.json:11"]);
      expect(at({ test: "pnpm unit || true", unit: "vitest run" })).toEqual(["package.json:10"]);
      expect(at({ lint: "eslint . || true", fmt: "prettier --check . | cat" })).toEqual([]);
    });
    it("the repository's scripts are clean", () => {
      expect(
        formatWorkflowFindings(checkTestScripts(packageScripts(join(process.cwd(), "package.json")))),
      ).toBe("(none)");
    });
    it("checkWorkflowDir reports them at package.json:line, and .npmrc shell keys at .npmrc:line", () => {
      const root = mkdtempSync(join(tmpdir(), "v13-w7-scripts-"));
      try {
        const dir = join(root, ".github", "workflows");
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, "a.yml"), W7);
        writeFileSync(
          join(root, "package.json"),
          JSON.stringify({ scripts: { lint: "eslint .", test: "vitest run || true" } }, null, 2),
        );
        expect(checkWorkflowDir(dir).map((f) => `${f.rule} ${f.file}:${f.line}`)).toEqual([
          "W7 package.json:4",
        ]);
        writeFileSync(
          join(root, ".npmrc"),
          "engine-strict=true\nscript-shell = /bin/true\n shell-emulator=true\n",
        );
        expect(checkNpmrc(join(root, ".npmrc")).map((f) => `${f.file}:${f.line}`)).toEqual([
          ".npmrc:2",
          ".npmrc:3",
        ]);
        expect(formatWorkflowFindings(checkWorkflowDir(dir))).toContain("W7 .npmrc:2 ");
        expect(checkNpmrc(join(root, "missing.npmrc"))).toEqual([]);
        expect(checkNpmrc(join(process.cwd(), ".npmrc")), "the repository's .npmrc").toEqual([]);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });
  });

  describe("V13-SEC-017: ARCH's INFOs on 9a6a94b", () => {
    const before = "          echo start | tee start.log";
    it("exit: only a literal 1–255 is a failure (the shell keeps the status modulo 256)", () => {
      for (const ok of ["exit 1", "exit 2", "exit 99", "exit 199", "exit 249", "exit 255"])
        expect(earlyExits(ok), ok).toEqual([]);
      for (const bad of ["exit 0", "exit 256", "exit 512", "exit 300", "exit 00", "exit 01", "exit -1"])
        expect(earlyExits(bad), bad).toEqual([`\`${bad}\``]);
      const src = swap(before, '          [ -n "$X" ] || exit 256');
      expect(w7(src)).toEqual([lineOf(src, "exit 256")]);
    });
    it("command, builtin, eval, source, ., alias, shopt expand_aliases and set -n in a test step", () => {
      for (const [line, at] of [
        ["command exit 0", "command exit"],
        ["builtin exit 0", "builtin exit"],
        ["command builtin exec true", "exec true"],
        ["eval 'exit 0'", "eval"],
        ["source ./ci.sh", "source"],
        [". ./ci.sh", ". ./ci.sh"],
        ["alias pnpm=true", "alias"],
        ["shopt -s expand_aliases", "shopt"],
        ["set -n", "set -n"],
        ["set -en", "set -en"],
        ["set -o noexec", "noexec"],
      ] as const) {
        const src = swap(before, `          ${line}`);
        expect(w7(src), line).toEqual([lineOf(src, at)]);
      }
    });
    it("allowed: set -euo pipefail, a dot inside a word or quotes, a comment, command -v", () => {
      for (const line of [
        "set -euo pipefail",
        "set -eux",
        "node ./scripts/x.mjs",
        'echo "source . eval alias"',
        "# exit 0 (see ARCH-015). source x",
        "command -v jq",
        "echo done. # ok",
      ])
        expect(w7(swap(before, `          ${line}`)), line).toEqual([]);
    });
    it("npm_config_script_shell / shell_emulator in env:, a $GITHUB_ENV write or an export, any case", () => {
      for (const [from, to, at] of [
        [
          "  test:\n    runs-on: ubuntu-24.04\n",
          "  test:\n    env:\n      npm_config_script_shell: /bin/true\n    runs-on: ubuntu-24.04\n",
          "npm_config_script_shell",
        ],
        ["jobs:\n", "env:\n  NPM_CONFIG_SCRIPT_SHELL: /bin/true\njobs:\n", "NPM_CONFIG_SCRIPT_SHELL"],
        [
          "      - run: echo ready\n",
          '      - run: echo "npm_config_shell_emulator=true" >> "$GITHUB_ENV"\n',
          "GITHUB_ENV",
        ],
        [before, "          export npm_config_script_shell=/bin/true", "export"],
        [before, "          pnpm config set script-shell /bin/true", "config set"],
        [before, "          pnpm config set shellEmulator true", "config set"],
      ] as const) {
        const src = swap(from, to);
        expect(
          checkWorkflow("planted.yml", src, {})
            .filter((f) => f.rule === "W7")
            .map((f) => f.line),
          to,
        ).toEqual([lineOf(src, at)]);
      }
      // A comment that names it is not a setting.
      expect(w7(swap(before, "          echo start # npm_config_script_shell is refused"))).toEqual([]);
    });
    it("R1 on #174: only space and tab start a comment (U+00A0 before # is part of a word, in bash and YAML)", () => {
      const nbsp = "\u00a0";
      for (const [line, at] of [
        [`echo a${nbsp}#; exit 0`, "exit 0"],
        [`echo a${nbsp}#; export npm_config_script_shell=/bin/true`, "export"],
      ] as const) {
        const src = swap(before, `          ${line}`);
        expect(w7(src), line).toEqual([lineOf(src, at)]);
      }
      expect(stripComment(`a:${nbsp}# b`)).toBe(`a:${nbsp}# b`);
      expect(stripComment("a:\t# b")).toBe("a:");
      // A tab before # still starts a comment.
      expect(w7(swap(before, "          echo a\t# ; exit 0"))).toEqual([]);
    });
    it("R2 on #174: command -p / --, builtin --, set -Cn, npm_config_script-shell", () => {
      for (const [line, at] of [
        ["command -p exit 0", "command -p"],
        ["command -- exit 0", "command --"],
        ["command -p -- exit 0", "command -p --"],
        ["builtin -- exit 0", "builtin --"],
        ["set -Cn", "set -Cn"],
        ["export npm_config_script-shell=/bin/true", "export"],
        ["export NPM_CONFIG_SHELL-EMULATOR=true", "export"],
      ] as const) {
        const src = swap(before, `          ${line}`);
        expect(w7(src), line).toEqual([lineOf(src, at)]);
      }
      for (const line of ["command -v jq", "command -V pnpm", "command -pv jq"])
        expect(w7(swap(before, `          ${line}`)), line).toEqual([]);
      const env = swap(
        "  test:\n    runs-on: ubuntu-24.04\n",
        "  test:\n    env:\n      npm_config_script-shell: /bin/true\n    runs-on: ubuntu-24.04\n",
      );
      expect(w7(env)).toEqual([lineOf(env, "npm_config_script-shell")]);
    });
    it("R3 on #174: prefixes bash allows, words built at run time, escapes and backslash-newline", () => {
      for (const [line, at] of [
        ["if exit 0; then :; fi", "if exit"],
        ["if true; then :; elif exit 0; then :; fi", "elif exit"],
        ["while exit 0; do :; done", "while exit"],
        ["until exit 0; do :; done", "until exit"],
        ["time exit 0", "time exit"],
        ["time -p exit 0", "time -p"],
        ["X=1 exit 0", "X=1"],
        ["A=1 B[2]=x C+=y exit 0", "A=1"],
        ['"exit" 0', '"exit"'],
        ["\\exit 0", "exit 0"],
        ['e"x"it 0', 'e"x"it'],
        ["echo \\'; exit 0; echo \\'", "echo \\'"],
        ["x=exit; $x 0", "$x"],
        ["`echo exit` 0", "`echo"],
        ["$(echo exit) 0", "$(echo"],
        // An escaped backslash: the `;` after it is an operator again.
        ["echo \\\\; exit 0", "echo \\\\;"],
      ] as const) {
        const src = swap(before, `          ${line}`);
        expect(w7(src), line).toEqual([lineOf(src, at)]);
      }
      const joined = swap(before, "          ex\\\n          it 0");
      expect(w7(joined), "ex\\ + it 0").toEqual([lineOf(joined, "ex\\")]);
      // Allowed: a quoted argument, an assignment alone, a variable as an argument, a continued test command.
      for (const line of [
        'mode="$(node x.mjs)"',
        'echo "$X" \\"done\\"',
        '[ "$mode" = compare ]',
        "X=1 node x.mjs",
        'if [ -n "$X" ]; then echo y; fi',
        "echo a \\\n          b",
        // An escaped `;` is a word, not an operator: bash echoes "; exit 0".
        "echo \\; exit 0",
      ])
        expect(w7(swap(before, `          ${line}`)), line).toEqual([]);
    });
    it("pnpm-workspace.yaml scriptShell / shellEmulator, through checkWorkflowDir", () => {
      const root = mkdtempSync(join(tmpdir(), "v13-w7-ws-"));
      try {
        const dir = join(root, ".github", "workflows");
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, "a.yml"), W7);
        expect(checkWorkflowDir(dir, SCRIPTS)).toEqual([]);
        writeFileSync(
          join(root, "pnpm-workspace.yaml"),
          "packages:\n  - .\n# scriptShell is refused\nscriptShell: /bin/true\nshellEmulator: true\n",
        );
        expect(
          checkPnpmWorkspace(join(root, "pnpm-workspace.yaml")).map((f) => `${f.file}:${f.line}`),
        ).toEqual(["pnpm-workspace.yaml:4", "pnpm-workspace.yaml:5"]);
        expect(formatWorkflowFindings(checkWorkflowDir(dir, SCRIPTS))).toContain("W7 pnpm-workspace.yaml:4 ");
        expect(checkPnpmWorkspace(join(process.cwd(), "pnpm-workspace.yaml")), "the repository's").toEqual(
          [],
        );
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });
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
