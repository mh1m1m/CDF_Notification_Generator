// V13-SEC-015 · GitHub Actions workflow hardening (REQ-SEC-002, REQ-CICD-001). SYNTHETIC-DATA REFERENCE IMPLEMENTATION.
//
// SEC's CI rules, checked on every file under .github/workflows (.yml and .yaml), read with readdir so that a workflow
// added later is scanned without a change here. Agreed with ARCH on 7 Nov 2026 (rules W1–W6):
//   W1 the workflow has a top-level `permissions:` block that is exactly `contents: read`; a job-level `permissions:`
//      block exists only in release.yml's `tag` job and is exactly `contents: write` (the reviewed exception);
//   W2 no `pull_request_target` and no `workflow_run` trigger;
//   W3 no `secrets.` (and no `secrets:` key) anywhere, and no reference to the `secrets` context inside an expression
//      (`${{ … }}` or an `if:` value: `secrets['X']`, `toJSON(secrets)`); `github.token` (also `github['token']`) only
//      in release.yml's `tag` job; the whole `github` context (`toJSON(github)`) nowhere, since it carries the token;
//   W4 every actions/checkout step sets `persist-credentials: false`;
//   W5 every `uses:` is pinned to a full 40-hex commit SHA (a trailing tag comment is fine);
//   W6 no `${{ … }}` expression inside a `run:` script: event, ref and input text reaches a script only through `env:`
//      (stricter than "no github.event / github.head_ref / inputs": no expression is interpolated into shell at all).
//   W7 a test run's failure fails its job (V13-SEC-016, agreed with ARCH 7 Nov). A step "runs a test" when
//      scripts/ci/test-invocations.mjs `findInvocations` finds a Vitest or Playwright run in it (one definition of a
//      test run, package.json scripts followed). Refused:
//        - `continue-on-error`, anywhere;
//        - an `if:` on a test step, on a test job, or on a job a test job needs (a skipped job reads as success),
//          except visual-library.yml's opt-in label `if:` in its exact text;
//        - a `shell:` other than `bash` on a test step, its job's or the workflow's `defaults.run.shell`;
//        - on a test run's own line: `||` (except ci.yml's visual candidate capture `… || rc=$?`, handed on the next
//          line to scripts/ci/visual-candidates.mjs), a pipe `|`/`|&` unless pipefail is on for the step (the default
//          shell is `bash -e {0}`, without pipefail; `shell: bash` or an earlier `set -o pipefail` turns it on), a
//          background `&`, and the run as a condition (`if`, `elif`, `while`, `until`, `!`);
//        - `set +e`, `set +o errexit` or `set +o pipefail` anywhere in a test step's script;
//        - on a test run's line, `&&` too (under -e only the list's last command fails the step); in a test step's
//          script, `exit` without a non-zero literal status, `exec`, `return`, `trap` and a function definition;
//        - a package script that runs a test joining commands with anything but `&&` (pnpm runs it with `sh -c`, no -e,
//          no pipefail), or holding an early exit; `.npmrc`'s `script-shell` and `shell-emulator` keys.
//      (ARCH's R1–R4 and INFO on #172.) V13-SEC-017 (ARCH's INFOs on 9a6a94b): only `exit` 1–255 is a failure;
//      `command`/`builtin` prefixes are seen through; `eval`, `source`, `.`, `alias`, `shopt … expand_aliases` and
//      `set -n` are early exits; `npm_config_script_shell`/`npm_config_shell_emulator` (any case) and the
//      `script-shell`/`shell-emulator`/`scriptShell`/`shellEmulator` settings are refused in a workflow (env:,
//      $GITHUB_ENV, export) and in pnpm-workspace.yaml. A runtime proof of each required run is V13-ARCH-020.
// A finding names the rule, the file and the line.
//
// No YAML dependency (ARCH): a line reader that tracks indentation gives each line its key path (jobs › tag › steps ›
// [2] › with › persist-credentials) and knows which lines belong to a block scalar such as a `run: |` script. It covers
// the block style these workflows use; flow-style mappings (`{ … }`, also inside a list item or a flow sequence) and
// flow sequences that hold a mapping or span lines are refused as W0, so that nothing goes unread.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { findInvocations, runLines } from "../../scripts/ci/test-invocations.mjs";

export interface WorkflowFinding {
  readonly rule: string;
  readonly file: string;
  readonly line: number;
  readonly detail: string;
}

/** One meaningful line of a workflow: its key path, and its key and value when it is `key: value`. */
export interface WorkflowLine {
  readonly line: number;
  readonly indent: number;
  /** Keys and list positions from the root to this line, the line's own key included. */
  readonly path: readonly string[];
  readonly key: string | null;
  /** The value after `key:` without its comment and quotes ("" when the key opens a block). */
  readonly value: string | null;
  /** Set for a line inside a block scalar (`key: |` or `key: >`): the path of the key that opened it. */
  readonly scalarOf: readonly string[] | null;
  /** The line's text without its comment. */
  readonly text: string;
}

/** The text before an unquoted ` #` comment. */
export function stripComment(raw: string): string {
  let quote: string | null = null;
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i]!;
    if (quote) {
      if (c === quote) quote = null;
      continue;
    }
    if (c === "'" || c === '"') quote = c;
    else if (c === "#" && (i === 0 || /\s/.test(raw[i - 1]!))) return raw.slice(0, i).trimEnd();
  }
  return raw.trimEnd();
}

const unquote = (v: string) => v.replace(/^(['"])(.*)\1$/, "$2");
const KEY = /^([A-Za-z0-9_.-]+|"[^"]*"|'[^']*'):(?:\s+(.*))?$/;

/** Reads a workflow into lines with key paths. */
export function readWorkflow(source: string): WorkflowLine[] {
  const out: WorkflowLine[] = [];
  const stack: { indent: number; name: string }[] = [];
  const counters = new Map<string, number>();
  let scalar: { indent: number; path: string[] } | null = null;
  const lines = source.split(/\r?\n/);
  for (const [i, raw] of lines.entries()) {
    const indent = raw.length - raw.trimStart().length;
    if (scalar) {
      if (raw.trim() === "" || indent > scalar.indent) {
        if (raw.trim() !== "")
          out.push({
            line: i + 1,
            indent,
            path: scalar.path,
            key: null,
            value: null,
            scalarOf: scalar.path,
            text: raw.trim(),
          });
        continue;
      }
      scalar = null;
    }
    const text = stripComment(raw).trim();
    if (text === "" || text === "---") continue;
    while (stack.length > 0 && stack[stack.length - 1]!.indent >= indent) stack.pop();
    let body = text;
    let bodyIndent = indent;
    if (body === "-" || body.startsWith("- ")) {
      const parent = stack.map((s) => s.name).join("\u0000");
      const n = counters.get(parent) ?? 0;
      counters.set(parent, n + 1);
      stack.push({ indent, name: `[${n}]` });
      body = body.slice(1).trimStart();
      bodyIndent = indent + (text.length - body.length);
      if (body === "") {
        out.push({
          line: i + 1,
          indent,
          path: stack.map((s) => s.name),
          key: null,
          value: null,
          scalarOf: null,
          text,
        });
        continue;
      }
    }
    const m = KEY.exec(body);
    if (!m) {
      out.push({
        line: i + 1,
        indent,
        path: stack.map((s) => s.name),
        key: null,
        value: null,
        scalarOf: null,
        text,
      });
      continue;
    }
    const key = unquote(m[1]!);
    const value = unquote((m[2] ?? "").trim());
    stack.push({ indent: bodyIndent, name: key });
    const path = stack.map((s) => s.name);
    out.push({ line: i + 1, indent, path, key, value, scalarOf: null, text });
    if (/^[|>][-+0-9]*$/.test(value)) scalar = { indent: bodyIndent, path };
  }
  return out;
}

const EXPRESSION = /\$\{\{([\s\S]*?)\}\}/g;
/** The text of each `${{ … }}` expression on a line. */
export const expressionsOf = (text: string): string[] => [...text.matchAll(EXPRESSION)].map((m) => m[1]!);
/** The line with its `${{ … }}` expressions removed. */
export const withoutExpressions = (text: string): string => text.replace(EXPRESSION, "");
/** The line with the contents of its quoted strings removed (the quotes stay). */
const withoutQuoted = (text: string): string =>
  text.replace(/"(?:[^"\\]|\\.)*"|'(?:[^']|'')*'/g, (q) => q[0]! + q[0]!);

const SHA_PIN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_./-]+@[0-9a-f]{40}$/;

/** The reviewed exception (W1, W3): release.yml's `tag` job. */
const RELEASE_FILE = "release.yml";
const inReleaseTagJob = (file: string, path: readonly string[]) =>
  file === RELEASE_FILE && path[0] === "jobs" && path[1] === "tag";

/** The children of the block at `path`, as `key: value` strings. */
function childrenOf(lines: readonly WorkflowLine[], path: readonly string[]): string[] {
  return lines
    .filter(
      (l) =>
        l.scalarOf === null &&
        l.key !== null &&
        l.path.length === path.length + 1 &&
        path.every((p, k) => l.path[k] === p),
    )
    .map((l) => `${l.key}: ${l.value}`);
}

const under = (l: WorkflowLine, prefix: readonly string[]) =>
  l.path.length >= prefix.length && prefix.every((p, k) => l.path[k] === p);

export interface PackageScript {
  readonly command: string;
  readonly line: number;
}

/** W7's reviewed exceptions, each in its exact text (ARCH, 7 Nov). */
export const W7_JOB_IF_ALLOWED: readonly { file: string; job: string; value: string }[] = [
  // An opt-in library run outside the merge rule (V13-ARCH-014).
  {
    file: "visual-library.yml",
    job: "library",
    value: "contains(github.event.pull_request.labels.*.name, 'visual-library')",
  },
];
/** ci.yml's visual candidate run (V13-ARCH-014): the code it captures goes, on the next line, to the judge. */
export const W7_CAPTURE = {
  file: "ci.yml",
  job: "visual",
  line: "pnpm exec playwright test --project=visual-baseline --reporter=list,json --retries=0 || rc=$?",
  next: 'node scripts/ci/visual-candidates.mjs "$rc" test-results/visual-baseline.json test-results/baseline-candidates tests/visual/__screenshots__',
} as const;

/** The shell operators outside quotes, `$( … )` and a comment; redirections (`2>&1`, `&>`, `>&2`) are not operators. */
export function shellOperators(text: string): string[] {
  const ops: string[] = [];
  let quote: string | null = null;
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quote) {
      if (c === "\\" && quote === '"') i++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === "\\") {
      i++;
      continue;
    }
    if (c === "'" || c === '"') {
      quote = c;
      continue;
    }
    if (c === "$" && text[i + 1] === "(") {
      depth++;
      i++;
      continue;
    }
    if (depth > 0) {
      if (c === "(") depth++;
      else if (c === ")") depth--;
      continue;
    }
    if (c === "#" && (i === 0 || /\s/.test(text[i - 1]!))) break;
    const two = text.slice(i, i + 2);
    if (two === "||" || two === "&&" || two === "|&") {
      ops.push(two);
      i++;
    } else if (c === "|" || c === ";") ops.push(c);
    else if (c === "&") {
      const prev = text[i - 1];
      if (prev === ">" || prev === "<" || text[i + 1] === ">") continue;
      ops.push("&");
    }
  }
  return ops;
}

const CONDITION = new Set(["if", "elif", "while", "until", "!"]);
const ERREXIT_OFF = /(^|[;&|\s])set\s+(\+[a-z]*e[a-z]*\b|\+o\s+(errexit|pipefail)\b)/;
const PIPEFAIL_ON = /(^|[;&|\s])set\s+(-[a-z]*o\s+pipefail\b|-o\s+pipefail\b)/;

/** Whether shell text runs a Vitest or Playwright test, by `findInvocations` (package.json scripts followed). */
function runsATest(text: string, scripts: Readonly<Record<string, PackageScript>>): boolean {
  const line = {
    line: 1,
    path: ["jobs", "j", "steps", "[0]", "run"],
    key: "run",
    value: text,
    scalarOf: null,
    text,
  };
  return findInvocations({ workflows: [{ file: "-", lines: [line] }], scripts }).length > 0;
}

/** The text with the contents of its quoted strings emptied, so that words inside quotes are not read as commands. */
const unquoted = (text: string) => text.replace(/"(?:[^"\\]|\\.)*"|'[^']*'/g, (q) => q[0]! + q[0]!);

/**
 * What in a test step's script line can end the step early with success, or turn a failure into one (ARCH's R4 on
 * #172): `exit` without a non-zero literal status, `exec`, `return`, `trap`, and a function definition (which can shadow
 * the runner).
 */
export function earlyExits(text: string): string[] {
  // Quoted text emptied, then a shell comment (an unquoted `#` at a word start) removed.
  const bare = unquoted(text).replace(/(^|\s)#.*$/, "$1");
  const out: string[] = [];
  if (/(^|[;&|{(\s])(function\s+[A-Za-z_][\w-]*|[A-Za-z_][\w-]*\s*\(\s*\))/.test(bare))
    out.push("a function definition");
  for (const segment of bare.split(/;|&&|\|\||\|&|\||&|\(|\)|\{|\}|\bthen\b|\bdo\b|\belse\b/)) {
    const words = segment
      .trim()
      .split(/\s+/)
      .filter((w) => w !== "!");
    // `command exit 0` and `builtin exit 0` run the same builtin (SEC-017).
    while (words[0] === "command" || words[0] === "builtin") words.shift();
    const [first, second] = words;
    // The shell keeps the status modulo 256, so only 1–255 is a failure (`exit 256` exits 0).
    if (first === "exit" && !(second !== undefined && EXIT_FAILURE.test(second)))
      out.push(`\`exit${second === undefined ? "" : ` ${second}`}\``);
    else if (first !== undefined && EARLY_WORDS.has(first)) out.push(`\`${first}\``);
    else if (first === "set" && words.slice(1).some((w) => /^-[a-z]*n[a-z]*$/.test(w) || w === "noexec"))
      out.push("`set -n` (noexec)");
    else if (first === "shopt" && words.includes("expand_aliases")) out.push("`shopt expand_aliases`");
  }
  return out;
}

const EXIT_FAILURE = /^([1-9]|[1-9][0-9]|1[0-9][0-9]|2[0-4][0-9]|25[0-5])$/;
/** Words that end the step or run text the checker cannot see (SEC-017: `eval`, `source`, `.`, `alias`). */
const EARLY_WORDS = new Set(["exec", "return", "trap", "eval", "source", ".", "alias"]);

/**
 * SEC-017: settings that change the shell pnpm runs package scripts in, by environment or pnpm configuration:
 * `npm_config_script_shell` / `npm_config_shell_emulator` (any case, in `env:`, a `$GITHUB_ENV` write or an
 * `export`), and `script-shell` / `shell-emulator` / `scriptShell` / `shellEmulator` named anywhere else.
 */
const SCRIPT_SHELL =
  /npm_config_(script_shell|shell_emulator)|(^|[^\w-])(script-shell|shell-emulator|scriptShell|shellEmulator)([^\w-]|$)/i;

/** Every line of a file (its comment removed) that names a script-shell setting, as W7 findings. */
function scriptShellLines(file: string, source: string, detail: string): WorkflowFinding[] {
  return source
    .split(/\r?\n/)
    .flatMap((l, i) =>
      SCRIPT_SHELL.test(stripComment(l)) ? [{ rule: "W7", file, line: i + 1, detail }] : [],
    );
}

/**
 * R3 on #172: pnpm runs a package script with `sh -c`, without errexit or pipefail, so a script that runs a test may
 * hold only `&&` between its commands: `;`, `||`, `|`, `|&`, `&` or a newline would let it exit 0 when the test failed.
 */
export function checkTestScripts(scripts: Readonly<Record<string, PackageScript>>): WorkflowFinding[] {
  const out: WorkflowFinding[] = [];
  for (const [name, script] of Object.entries(scripts)) {
    if (!runsATest(`pnpm ${name}`, scripts)) continue;
    const bad = shellOperators(script.command).filter((o) => o !== "&&");
    if (script.command.includes("\n")) bad.push("a newline");
    const exits = earlyExits(script.command);
    if (bad.length > 0 || exits.length > 0)
      out.push({
        rule: "W7",
        file: "package.json",
        line: script.line,
        detail: `the script "${name}" runs a test with sh -c (no -e, no pipefail); only \`&&\` may join its commands, found ${[...new Set([...bad, ...exits])].join(", ")}`,
      });
  }
  return out;
}

/** `.npmrc` keys that change the shell every package script runs in (ARCH's INFO on #172). */
export function checkNpmrc(npmrc: string): WorkflowFinding[] {
  if (!existsSync(npmrc)) return [];
  return readFileSync(npmrc, "utf8")
    .split(/\r?\n/)
    .flatMap((l, i) =>
      /^\s*(script-shell|shell-emulator)\s*=/.test(l)
        ? [
            {
              rule: "W7",
              file: ".npmrc",
              line: i + 1,
              detail: "a key that changes the shell package scripts run in",
            },
          ]
        : [],
    );
}

/** pnpm 10 reads `scriptShell` and `shellEmulator` from pnpm-workspace.yaml as well (SEC-017). */
export function checkPnpmWorkspace(path: string): WorkflowFinding[] {
  if (!existsSync(path)) return [];
  return scriptShellLines(
    "pnpm-workspace.yaml",
    readFileSync(path, "utf8"),
    "a setting that changes the shell package scripts run in",
  );
}

/** W7 over one workflow's lines. */
function checkTestExitCodes(
  file: string,
  lines: readonly WorkflowLine[],
  scripts: Readonly<Record<string, PackageScript>>,
  hit: (rule: string, line: number, detail: string) => void,
) {
  const keyed = lines.filter((l) => l.scalarOf === null);
  const workflow = { file, lines };
  const runs = findInvocations({ workflows: [workflow], scripts });

  const testJobs = new Set(runs.map((r) => r.job).filter((j): j is string => j !== null));
  const testSteps = new Set(runs.map((r) => `${r.job}\u0000${r.step}`));
  const testLines = new Set(runs.map((r) => `${r.job}\u0000${r.step}\u0000${r.line}`));
  const at = (path: readonly string[]) => keyed.find((l) => samePath(l.path, path));

  // The jobs a test job needs, transitively: `needs: a`, `needs: [a, b]` or a block list.
  const needsOf = (job: string): string[] => {
    const n = at(["jobs", job, "needs"]);
    if (!n) return [];
    if (n.value)
      return n.value
        .replace(/[[\]]/g, "")
        .split(/[\s,]+/)
        .filter(Boolean);
    return lines
      .filter((l) => l.path.length === 4 && samePath(l.path.slice(0, 3), ["jobs", job, "needs"]))
      .map((l) => unquote(l.text.replace(/^-\s*/, "")));
  };
  const guarded = new Set<string>();
  const queue = [...testJobs];
  while (queue.length > 0) {
    const j = queue.pop()!;
    if (guarded.has(j)) continue;
    guarded.add(j);
    queue.push(...needsOf(j));
  }

  for (const l of keyed) {
    if (l.key === "continue-on-error")
      hit(
        "W7",
        l.line,
        "`continue-on-error` lets a failing step or job pass; a test's failure must fail its job",
      );
    if (l.key === "if" && l.path.length === 3 && l.path[0] === "jobs" && guarded.has(l.path[1]!)) {
      const job = l.path[1]!;
      const allowed = W7_JOB_IF_ALLOWED.some((a) => a.file === file && a.job === job && a.value === l.value);
      if (!allowed)
        hit(
          "W7",
          l.line,
          testJobs.has(job)
            ? "an `if:` on a job that runs a test; a skipped job reads as success"
            : "an `if:` on a job a test job needs; skipping it skips the test job, which reads as success",
        );
    }
    if (
      l.key === "if" &&
      l.path.length === 5 &&
      l.path[0] === "jobs" &&
      l.path[2] === "steps" &&
      testSteps.has(`${l.path[1]}\u0000${l.path[3]}`)
    )
      hit("W7", l.line, "an `if:` on a step that runs a test; a skipped step reads as success");
  }

  // The shell: only GitHub's default (`bash -e {0}`) or `bash` (`bash --noprofile --norc -eo pipefail {0}`).
  const shellAt = (path: readonly string[]) => at(path)?.value ?? null;
  const badShell = (l: WorkflowLine | undefined) => l !== undefined && l.value !== "bash";
  const workflowShell = at(["defaults", "run", "shell"]);
  if (testJobs.size > 0 && badShell(workflowShell))
    hit("W7", workflowShell!.line, "a `defaults.run.shell` other than `bash` in a workflow that runs a test");
  for (const job of testJobs) {
    const jobShell = at(["jobs", job, "defaults", "run", "shell"]);
    if (badShell(jobShell))
      hit("W7", jobShell!.line, "a `defaults.run.shell` other than `bash` on a job that runs a test");
  }

  const scriptLines = runLines(workflow);
  for (const key of testSteps) {
    const [job, step] = key.split("\u0000") as [string, string];
    const stepShell = at(["jobs", job, "steps", step, "shell"]);
    if (badShell(stepShell))
      hit("W7", stepShell!.line, "a `shell:` other than `bash` on a step that runs a test");
    const shell =
      shellAt(["jobs", job, "steps", step, "shell"]) ??
      shellAt(["jobs", job, "defaults", "run", "shell"]) ??
      shellAt(["defaults", "run", "shell"]);
    const mine = scriptLines.filter((r) => r.job === job && r.step === step).sort((a, b) => a.line - b.line);
    let pipefail = shell === "bash";
    for (const [n, r] of mine.entries()) {
      const text = r.pieces.map((p) => p.text).join(" ");
      if (ERREXIT_OFF.test(text))
        hit("W7", r.line, "`set +e`, `set +o errexit` or `set +o pipefail` in a step that runs a test");
      if (PIPEFAIL_ON.test(text)) pipefail = true;
      for (const e of earlyExits(text))
        hit("W7", r.line, `${e} in a step that runs a test can end it with success before or after the run`);
      if (!testLines.has(`${job}\u0000${step}\u0000${r.line}`)) continue;
      const ops = shellOperators(text);
      if (ops.includes("||")) {
        const capture =
          file === W7_CAPTURE.file &&
          job === W7_CAPTURE.job &&
          text === W7_CAPTURE.line &&
          mine[n + 1]?.pieces.map((p) => p.text).join(" ") === W7_CAPTURE.next;
        if (!capture)
          hit(
            "W7",
            r.line,
            "`||` after a test run swallows its failure (only the visual candidate capture may)",
          );
      }
      if ((ops.includes("|") || ops.includes("|&")) && !pipefail)
        hit("W7", r.line, "a pipe after a test run without pipefail exits with the last command's status");
      if (ops.includes("&")) hit("W7", r.line, "a test run in the background; its exit status is lost");
      if (ops.includes("&&"))
        hit(
          "W7",
          r.line,
          "`&&` on a test run's line: under bash -e only the list's last command fails the step",
        );
      const commands = text.split(/;|&&|\|\||\bthen\b|\bdo\b/);
      for (const c of commands) {
        const first = c.trim().split(/\s+/)[0] ?? "";
        if (CONDITION.has(first) && runsATest(c.trim().slice(first.length).trim(), scripts))
          hit("W7", r.line, `a test run as the condition of \`${first}\`; its failure only picks a branch`);
      }
    }
  }
}

const samePath = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((x, i) => x === b[i]);

/** W0–W7 over one workflow file; `scripts` are package.json's, which W7 follows to find a test run. */
export function checkWorkflow(
  file: string,
  source: string,
  scripts: Readonly<Record<string, PackageScript>> = {},
): WorkflowFinding[] {
  const out: WorkflowFinding[] = [];
  const hit = (rule: string, line: number, detail: string) => out.push({ rule, file, line, detail });
  const lines = readWorkflow(source);
  const keyed = lines.filter((l) => l.scalarOf === null);
  // W7 (SEC-017): no workflow changes the shell pnpm runs package scripts in.
  for (const f of scriptShellLines(
    file,
    source,
    "a setting that changes the shell package scripts run in (`npm_config_script_shell`, `script-shell`, …)",
  ))
    hit(f.rule, f.line, f.detail);

  // W0: the reader understands block style only. Outside block scalars, once the `${{ … }}` expressions are removed,
  // no `{` or `}` may remain (a flow mapping, also inside a list item or a flow sequence), and a flow sequence may hold
  // neither a `key: value` pair nor run onto the next line.
  for (const l of keyed) {
    const bare = withoutQuoted(withoutExpressions(l.text));
    if (/[{}]/.test(bare))
      hit("W0", l.line, "a flow-style mapping; write the block style so that every key is read");
    const opens = (bare.match(/\[/g) ?? []).length;
    const closes = (bare.match(/\]/g) ?? []).length;
    if (opens !== closes || /\[[^\]]*:(\s|\]|,|$)/.test(bare))
      hit("W0", l.line, "a flow sequence that holds a mapping or spans lines; write the block style");
  }

  // W1: permissions.
  const top = keyed.find((l) => l.path.length === 1 && l.key === "permissions");
  if (!top) hit("W1", 1, "no top-level `permissions:` block");
  else {
    const kids = childrenOf(lines, ["permissions"]);
    if (top.value !== "" || kids.length !== 1 || kids[0] !== "contents: read")
      hit("W1", top.line, "the top-level `permissions:` block must be exactly `contents: read`");
  }
  for (const l of keyed) {
    if (l.key !== "permissions" || l.path.length === 1) continue;
    const allowed =
      inReleaseTagJob(file, l.path) &&
      l.path.length === 3 &&
      l.value === "" &&
      childrenOf(lines, l.path).join("|") === "contents: write";
    if (!allowed)
      hit(
        "W1",
        l.line,
        "a job-level `permissions:` block outside release.yml's tag job, or not exactly `contents: write`",
      );
  }

  // W2: triggers.
  const on = keyed.find((l) => l.path.length === 1 && (l.key === "on" || l.key === "true"));
  if (!on) hit("W2", 1, "no `on:` block");
  for (const l of keyed) {
    if (!on || !under(l, on.path)) continue;
    const names =
      l.path.length === 1 ? (l.value ?? "").replace(/[[\]]/g, "").split(/[\s,]+/) : [l.key ?? l.text];
    for (const name of names.map((n) => n.replace(/^-\s*/, "")))
      if (name === "pull_request_target" || name === "workflow_run")
        hit("W2", l.line, `the trigger \`${name}\` is not allowed`);
  }

  // W3: secrets and the token.
  for (const l of lines) {
    if (/\bsecrets\./.test(l.text)) hit("W3", l.line, "`secrets.` is not allowed in any workflow");
    if (l.scalarOf === null && l.key === "secrets") hit("W3", l.line, "a `secrets:` key is not allowed");
    if (/\bgithub\.token\b/.test(l.text) && !inReleaseTagJob(file, l.path))
      hit("W3", l.line, "`github.token` is read only in release.yml's tag job");
    // Inside an expression (`${{ … }}`, or an `if:` value, which is an expression without delimiters): any reference
    // to the `secrets` context; the token by index; the whole `github` context (it carries the token), anywhere.
    const exprs = expressionsOf(l.text);
    if (l.scalarOf === null && l.key === "if" && l.value && !l.value.includes("${{")) exprs.push(l.value);
    for (const e of exprs) {
      if (/(?<![\w.-])secrets\b/.test(e))
        hit("W3", l.line, "the `secrets` context is not allowed in any workflow");
      if (/(?<![\w.-])github\s*\[\s*(['"])token\1\s*\]/.test(e) && !inReleaseTagJob(file, l.path))
        hit("W3", l.line, "`github.token` is read only in release.yml's tag job");
      if (/(?<![\w.-])github\b(?!\s*[.[])/.test(e))
        hit("W3", l.line, "the whole `github` context carries the token; name the field you need");
    }
  }

  // W4 and W5: steps and their actions.
  for (const l of keyed) {
    if (l.key !== "uses") continue;
    const step = l.path.slice(0, -1);
    if (!SHA_PIN.test(l.value ?? ""))
      hit("W5", l.line, "`uses:` must name an action pinned to a full commit SHA");
    if ((l.value ?? "").startsWith("actions/checkout@")) {
      const persist = keyed.find(
        (c) =>
          c.key === "persist-credentials" &&
          c.path.join("\u0000") === [...step, "with", "persist-credentials"].join("\u0000"),
      );
      if (!persist || persist.value !== "false")
        hit("W4", l.line, "actions/checkout must set `persist-credentials: false`");
    }
  }

  // W6: no expression inside a run script.
  for (const l of lines) {
    const inRun =
      (l.scalarOf !== null && l.scalarOf[l.scalarOf.length - 1] === "run") ||
      (l.key === "run" && l.scalarOf === null);
    if (inRun && /\$\{\{/.test(l.scalarOf !== null ? l.text : (l.value ?? "")))
      hit("W6", l.line, "a `${{ }}` expression inside `run:`; pass the value through `env:`");
  }

  checkTestExitCodes(file, lines, scripts, hit);

  const seen = new Set<string>();
  return out
    .filter((f) => {
      const k = `${f.rule}\u0000${f.line}\u0000${f.detail}`;
      return seen.has(k) ? false : (seen.add(k), true);
    })
    .sort((a, b) => a.line - b.line || a.rule.localeCompare(b.rule));
}

/** Every workflow file under `dir` (.yml and .yaml), by name. */
export function workflowFiles(dir: string): string[] {
  return readdirSync(dir)
    .filter((f) => /\.ya?ml$/.test(f))
    .sort();
}

/** package.json's scripts, each with its line, as scripts/ci/test-invocations.mjs reads them ({} without the file). */
export function packageScripts(packageJson: string): Record<string, PackageScript> {
  if (!existsSync(packageJson)) return {};
  const source = readFileSync(packageJson, "utf8");
  const lines = source.split("\n");
  const scripts = (JSON.parse(source) as { scripts?: Record<string, string> }).scripts ?? {};
  return Object.fromEntries(
    Object.entries(scripts).map(([name, command]) => [
      name,
      { command, line: lines.findIndex((l) => l.trimStart().startsWith(`${JSON.stringify(name)}:`)) + 1 },
    ]),
  );
}

/** W0–W7 over every workflow under `dir` (`.github/workflows`), with the repository's package.json scripts. */
export function checkWorkflowDir(
  dir: string,
  scripts: Readonly<Record<string, PackageScript>> = packageScripts(join(dir, "..", "..", "package.json")),
): WorkflowFinding[] {
  return [
    ...workflowFiles(dir).flatMap((f) => checkWorkflow(f, readFileSync(join(dir, f), "utf8"), scripts)),
    ...checkTestScripts(scripts),
    ...checkNpmrc(join(dir, "..", "..", ".npmrc")),
    ...checkPnpmWorkspace(join(dir, "..", "..", "pnpm-workspace.yaml")),
  ];
}

/** Findings in the repository root's files; every other file is a workflow under .github/workflows. */
const ROOT_FILES = new Set(["package.json", ".npmrc", "pnpm-workspace.yaml"]);

export const formatWorkflowFindings = (f: readonly WorkflowFinding[]) =>
  f
    .map(
      (x) =>
        `${x.rule} ${ROOT_FILES.has(x.file) ? x.file : `.github/workflows/${x.file}`}:${x.line} ${x.detail}`,
    )
    .join("\n") || "(none)";
