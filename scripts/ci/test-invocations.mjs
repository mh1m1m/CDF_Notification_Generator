// @ts-check
// CI's test runs must reach the guards whole (V13-ARCH-018: SEC's INFO on #166, ARCH's I2 on #167). The skip guard
// (V13-ARCH-017, Vitest) and the leak-skip reporter (V13-QA-019, Playwright) are reporters set in the configs, and each
// judges only the tests its run collects. So, in every workflow and in every package.json script a workflow runs:
//   - no Vitest or Playwright run passes `--reporter` (it replaces the configured reporters, the guards with them),
//     `--config`/`-c` or Vitest's `--root`/`--dir` (another config), or a filter: a test-name or title filter (`-t`,
//     `--testNamePattern`, `-g`, `--grep`, `--grep-invert`, `--allowOnly`) or a file filter (a file argument,
//     `--exclude`, `--changed`, `--shard`, `--last-failed`, `--only-changed`, `--test-list`, `--test-list-invert`,
//     `vitest related`, Playwright's `--no-deps`). The visual runs, whose projects hold no leak suite, may pass
//     `--reporter`: the candidate run reads Playwright's JSON report (V13-ARCH-014);
//   - no run, the visual runs included, passes a snapshot option (V13-ARCH-019, SEC's INFOs 1 and 3 on #170): `-u`,
//     `--update-snapshots` or Vitest's `--update` rewrites the snapshots the run compares against (the config's
//     `updateSnapshots: "none"` keeps a visual run from accepting a changed baseline), and `--ignore-snapshots` skips
//     the screenshot and snapshot assertions;
//   - V13_DB_TESTS_REQUIRED, which turns the skip guard on, is set only by an `env:` key, to "1", and the database run's
//     job or step sets it;
//   - the runs ARCH's merge rule rests on exist (REQUIRED_RUNS): the database job runs the integration project, the e2e
//     job runs every Playwright project, and the cross-browser job runs Firefox and WebKit.
// Workflows come in as the lines of SEC's reader (`readWorkflow` in tests/security/workflow-hardening.ts, no YAML
// dependency). A finding names the file and the line of the offending word: a script's line in package.json when the
// word comes from the script. tests/unit/ci-checks.spec.ts runs the check on the repository and on planted forms.

/**
 * The shape of one line from `readWorkflow` (tests/security/workflow-hardening.ts).
 * @typedef {{ line: number, path: readonly string[], key: string | null, value: string | null,
 *   scalarOf: readonly string[] | null, text: string }} WorkflowLine
 */
/** @typedef {{ file: string, lines: readonly WorkflowLine[] }} Workflow */
/** @typedef {{ command: string, line: number }} Script */
/** @typedef {{ text: string, file: string, line: number }} Word */
/** @typedef {{ file: string, line: number, job: string | null, step: string | null, pieces: { text: string, line: number }[] }} RunLine */
/**
 * @typedef {{ tool: "vitest" | "playwright", file: string, line: number, job: string | null, step: string | null,
 *   via: string, args: Word[], projects: string[] }} Invocation
 */
/** @typedef {"reporter" | "config" | "filter" | "snapshot" | "flag" | "missing run"} InvocationRule */
/** @typedef {{ file: string, line: number, rule: InvocationRule, detail: string }} InvocationFinding */
/**
 * @typedef {{ file: string, job: string, tool: "vitest" | "playwright", projects: readonly string[], flag?: boolean,
 *   what: string }} RequiredRun
 */

/** The runs ARCH's merge rule rests on; `projects: []` means every project. */
export const REQUIRED_RUNS = Object.freeze(
  /** @type {readonly RequiredRun[]} */ ([
    {
      file: ".github/workflows/ci.yml",
      job: "integration",
      tool: "vitest",
      projects: ["integration"],
      flag: true,
      what: "CI's database tests, under the skip guard (V13-ARCH-017)",
    },
    {
      file: ".github/workflows/ci.yml",
      job: "e2e",
      tool: "playwright",
      projects: [],
      what: "CI's end-to-end run, under the leak-skip reporter (V13-QA-019)",
    },
    {
      file: ".github/workflows/cross-browser.yml",
      job: "e2e",
      tool: "playwright",
      projects: ["firefox-ar", "webkit-ar"],
      what: "the Firefox and WebKit run of ARCH's merge rule (V13-ARCH-016)",
    },
  ]),
);

/** The flag that turns the skip guard on in CI's database job. */
export const FLAG = "V13_DB_TESTS_REQUIRED";

/**
 * Options that never reach a CI test run, with what each one does to the guards.
 * @type {Record<"vitest" | "playwright", Record<string, [InvocationRule, string]>>}
 */
const BANNED = {
  vitest: {
    "--reporter": ["reporter", "replaces the configured reporters, the skip guard with them"],
    "-c": ["config", "loads another config, without the configured reporters"],
    "--config": ["config", "loads another config, without the configured reporters"],
    "-r": ["config", "moves the root, and with it the config and the test files"],
    "--root": ["config", "moves the root, and with it the config and the test files"],
    "--dir": ["config", "moves the directory the test files are found in"],
    "-t": ["filter", "a test-name filter"],
    "--testNamePattern": ["filter", "a test-name filter"],
    "--test-name-pattern": ["filter", "a test-name filter"],
    "--allowOnly": ["filter", "lets a committed .only narrow the run"],
    "--allow-only": ["filter", "lets a committed .only narrow the run"],
    "--exclude": ["filter", "a file filter"],
    "--changed": ["filter", "a file filter"],
    "--shard": ["filter", "a file filter"],
    "-u": ["snapshot", "rewrites the snapshots the run compares against"],
    "--update": ["snapshot", "rewrites the snapshots the run compares against"],
  },
  playwright: {
    "--reporter": ["reporter", "replaces the configured reporters, the leak-skip reporter with them"],
    "-c": ["config", "loads another config, without the configured reporters"],
    "--config": ["config", "loads another config, without the configured reporters"],
    "-g": ["filter", "a title filter"],
    "--grep": ["filter", "a title filter"],
    "--grep-invert": ["filter", "a title filter"],
    "--last-failed": ["filter", "a file filter"],
    "--only-changed": ["filter", "a file filter"],
    "--shard": ["filter", "a file filter"],
    "--test-list": ["filter", "a file filter"],
    "--test-list-invert": ["filter", "a file filter"],
    "--no-deps": ["filter", "leaves out the projects the run depends on"],
    "-u": ["snapshot", "rewrites the snapshots the run compares against"],
    "--update-snapshots": ["snapshot", "rewrites the snapshots the run compares against"],
    "--ignore-snapshots": ["snapshot", "skips the screenshot and snapshot assertions"],
  },
};

/** Options whose value may come as the next word; a bare word after any other option counts as a file argument. */
const TAKES_VALUE = {
  vitest: new Set([
    "-c",
    "--config",
    "-r",
    "--root",
    "--dir",
    "-t",
    "--testNamePattern",
    "--test-name-pattern",
    "--project",
    "--reporter",
    "--outputFile",
    "--exclude",
    "--shard",
    "--pool",
    "--environment",
    "--testTimeout",
    "--hookTimeout",
    "--maxWorkers",
    "--retry",
    "--bail",
    "--mode",
  ]),
  playwright: new Set([
    "-c",
    "--config",
    "-g",
    "--grep",
    "--grep-invert",
    "--project",
    "--reporter",
    "--retries",
    "--trace",
    "-j",
    "--workers",
    "--timeout",
    "--global-timeout",
    "--max-failures",
    "--repeat-each",
    "--output",
    "--shard",
    "--browser",
    "--tsconfig",
    "--test-list",
    "--test-list-invert",
  ]),
};

/**
 * Options whose value is optional: the next word is the option's own only when it is one of these values (the CLIs'
 * `-u [type]` and `-u, --update-snapshots [mode]`); any other next word is read on its own.
 * @type {Record<"vitest" | "playwright", Record<string, ReadonlySet<string>>>}
 */
const OPTIONAL_VALUE = (() => {
  const types = new Set(["true", "false", "new", "all", "none"]);
  const modes = new Set(["all", "changed", "missing", "none"]);
  return {
    vitest: { "-u": types, "--update": types },
    playwright: { "-u": modes, "--update-snapshots": modes },
  };
})();

/** Words that open a shell construct before the command itself. */
const SHELL_PREFIX = new Set([
  "if",
  "then",
  "elif",
  "else",
  "do",
  "while",
  "until",
  "!",
  "{",
  "time",
  "exec",
  "command",
]);
/** Vitest commands that run no test. */
const VITEST_NO_RUN = new Set(["list", "init", "bench", "typecheck"]);

/** @param {readonly string[]} path */
const jobOf = (path) => (path[0] === "jobs" && path[1] !== undefined ? path[1] : null);
/** @param {readonly string[]} path */
const stepOf = (path) =>
  path[0] === "jobs" && path[2] === "steps" && path[3] !== undefined ? path[3] : null;
/** @param {readonly string[]} a @param {readonly string[]} b */
const samePath = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

/**
 * Every shell line a workflow's `run:` keys hold. A `run: |` block gives one line per line (a trailing backslash
 * continues it); a plain or quoted value that spans lines, and a `run: >` block, give one line.
 * @param {Workflow} workflow
 * @returns {RunLine[]}
 */
export function runLines(workflow) {
  /** @type {RunLine[]} */
  const out = [];
  const lines = workflow.lines;
  for (let i = 0; i < lines.length; i++) {
    const l = /** @type {WorkflowLine} */ (lines[i]);
    if (l.key !== "run" || l.scalarOf !== null) continue;
    const at = { file: workflow.file, job: jobOf(l.path), step: stepOf(l.path) };
    /** @type {WorkflowLine[]} */
    const body = [];
    let j = i + 1;
    for (; j < lines.length; j++) {
      const b = /** @type {WorkflowLine} */ (lines[j]);
      if (b.key !== null || !samePath(b.path, l.path)) break;
      body.push(b);
    }
    i = j - 1;
    const value = l.value ?? "";
    if (value.startsWith("|")) {
      /** @type {{ text: string, line: number }[]} */
      let pieces = [];
      for (const b of body) {
        const continued = b.text.endsWith("\\");
        pieces.push({ text: continued ? b.text.slice(0, -1) : b.text, line: b.line });
        if (!continued) {
          out.push({ ...at, line: /** @type {{ line: number }} */ (pieces[0]).line, pieces });
          pieces = [];
        }
      }
      if (pieces.length > 0)
        out.push({ ...at, line: /** @type {{ line: number }} */ (pieces[0]).line, pieces });
      continue;
    }
    const pieces = [
      ...(value.startsWith(">") ? [] : [{ text: value, line: l.line }]),
      ...body.map((b) => ({ text: b.text, line: b.line })),
    ];
    // A quoted value that spans lines keeps its quotes in readWorkflow: drop the outer pair.
    const first = pieces[0];
    const last = pieces[pieces.length - 1];
    if (
      first &&
      last &&
      pieces.length > 1 &&
      /^["']/.test(first.text) &&
      last.text.endsWith(first.text.charAt(0))
    ) {
      first.text = first.text.slice(1);
      last.text = last.text.slice(0, -1);
    }
    if (first) out.push({ ...at, line: first.line, pieces });
  }
  return out;
}

const OPERATORS = ["&&", "||", ";;", "|&", ";", "|", "&", "(", ")"];
const REDIRECT = /^(\d*|&)(>>?|<)(&\d*-?)?/;

/**
 * Splits shell text into simple commands of words, with quotes removed, `$( … )` kept whole, comments and
 * redirections dropped. Each word keeps the file and line it came from.
 * @param {readonly { text: string, line: number }[]} pieces the parts of one shell line, joined by spaces
 * @param {string} file
 * @returns {Word[][]}
 */
export function splitCommands(pieces, file) {
  const text = pieces.map((p) => p.text).join(" ");
  /** @type {number[]} */
  const starts = [];
  let offset = 0;
  for (const p of pieces) {
    starts.push(offset);
    offset += p.text.length + 1;
  }
  /** @param {number} at */
  const lineAt = (at) => {
    let k = 0;
    while (k + 1 < starts.length && /** @type {number} */ (starts[k + 1]) <= at) k++;
    return /** @type {{ line: number }} */ (pieces[k]).line;
  };
  /** @type {Word[][]} */
  const commands = [[]];
  let skipTarget = false;
  let i = 0;
  while (i < text.length) {
    const c = text.charAt(i);
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (c === "#") break;
    const redirect = REDIRECT.exec(text.slice(i));
    if (redirect) {
      i += redirect[0].length;
      skipTarget = !/[\d-]$/.test(redirect[3] ?? "");
      continue;
    }
    const op = OPERATORS.find((o) => text.startsWith(o, i));
    if (op) {
      commands.push([]);
      i += op.length;
      continue;
    }
    const start = i;
    let word = "";
    while (i < text.length && !/\s/.test(text.charAt(i)) && !OPERATORS.some((o) => text.startsWith(o, i))) {
      const ch = text.charAt(i);
      if (ch === "'") {
        const end = text.indexOf("'", i + 1);
        const stop = end < 0 ? text.length : end;
        word += text.slice(i + 1, stop);
        i = stop + 1;
      } else if (ch === '"') {
        let k = i + 1;
        while (k < text.length && text.charAt(k) !== '"') {
          if (text.charAt(k) === "\\" && k + 1 < text.length) {
            word += text.charAt(k + 1);
            k += 2;
          } else word += text.charAt(k++);
        }
        i = k + 1;
      } else if (ch === "\\" && i + 1 < text.length) {
        word += text.charAt(i + 1);
        i += 2;
      } else if (ch === "$" && text.charAt(i + 1) === "(") {
        let depth = 0;
        let k = i + 1;
        do {
          if (text.charAt(k) === "(") depth++;
          else if (text.charAt(k) === ")") depth--;
          k++;
        } while (k < text.length && depth > 0);
        word += text.slice(i, k);
        i = k;
      } else {
        word += ch;
        i++;
      }
    }
    if (skipTarget) {
      skipTarget = false;
      continue;
    }
    /** @type {Word[]} */ (commands[commands.length - 1]).push({ text: word, file, line: lineAt(start) });
  }
  return commands.filter((w) => w.length > 0);
}

/** @param {string} word */
const isPlaywright = (word) =>
  /(^|\/)(@playwright\/test|playwright)(@[^/]*)?$/.test(word) || /playwright(\/test)?\/cli\.js$/.test(word);
/** @param {string} word */
const isVitest = (word) => /(^|\/)vitest(@[^/]*)?(\.mjs)?$/.test(word);
/** @param {string} word */
const isAssignment = (word) => /^[A-Za-z_][A-Za-z0-9_]*=/.test(word);

/**
 * The Vitest and Playwright runs in one simple command, following `pnpm <script>` (and npm's or yarn's) into
 * package.json, where the words after the script's name join the script's last command.
 * @param {readonly Word[]} words
 * @param {{ file: string, line: number, job: string | null, step: string | null, via: string | null,
 *   scripts: Readonly<Record<string, Script>>, depth: number }} at
 * @returns {Invocation[]}
 */
function invocationsIn(words, at) {
  let k = 0;
  while (k < words.length) {
    const w = /** @type {Word} */ (words[k]).text;
    const afterEnv = w.startsWith("-") && k > 0 && words[k - 1]?.text === "env";
    if (SHELL_PREFIX.has(w) || isAssignment(w) || w === "env" || afterEnv) k++;
    else break;
  }
  const rest = words.slice(k);
  const base = { file: at.file, line: at.line, job: at.job, step: at.step };
  const pw = rest.findIndex((w, n) => isPlaywright(w.text) && rest[n + 1]?.text === "test");
  if (pw >= 0) {
    const args = rest.slice(pw + 2);
    const via = at.via ?? rest.map((w) => w.text).join(" ");
    return [{ tool: "playwright", ...base, via, args, projects: projectsOf(args) }];
  }
  const vt = rest.findIndex((w) => isVitest(w.text));
  if (vt >= 0) {
    let args = rest.slice(vt + 1);
    const sub = args[0]?.text;
    if (sub !== undefined && VITEST_NO_RUN.has(sub)) return [];
    if (sub === "run" || sub === "watch" || sub === "dev") args = args.slice(1);
    const via = at.via ?? rest.map((w) => w.text).join(" ");
    return [{ tool: "vitest", ...base, via, args, projects: projectsOf(args) }];
  }
  const n = scriptAt(rest, at.scripts);
  if (n < 0 || at.depth > 4) return [];
  const name = /** @type {Word} */ (rest[n]).text;
  const script = /** @type {Script} */ (at.scripts[name]);
  const extra = rest.slice(n + 1).filter((w) => w.text !== "--");
  const commands = splitCommands([{ text: script.command, line: script.line }], "package.json");
  const lastCommand = commands[commands.length - 1];
  if (lastCommand) lastCommand.push(...extra);
  const via =
    at.via ??
    rest
      .slice(0, n + 1)
      .map((w) => w.text)
      .join(" ");
  return commands.flatMap((c) => invocationsIn(c, { ...at, via, depth: at.depth + 1 }));
}

/**
 * Where a command runs a package.json script: the first word after `pnpm`, `npm` or `yarn` that names one (the package
 * manager's own options, and their values, come before it); -1 when it runs none.
 * @param {readonly Word[]} words
 * @param {Readonly<Record<string, Script>>} scripts
 */
function scriptAt(words, scripts) {
  const pm = words.findIndex((w) => w.text === "pnpm" || w.text === "npm" || w.text === "yarn");
  return pm < 0 ? -1 : words.findIndex((w, k) => k > pm && Object.hasOwn(scripts, w.text));
}

/**
 * The projects a run selects with `--project=a` or `--project a`.
 * @param {readonly Word[]} args
 */
function projectsOf(args) {
  /** @type {string[]} */
  const out = [];
  args.forEach((w, n) => {
    if (w.text.startsWith("--project=")) out.push(w.text.slice("--project=".length));
    else if (w.text === "--project" && args[n + 1] !== undefined)
      out.push(/** @type {Word} */ (args[n + 1]).text);
  });
  return out;
}

/**
 * Every Vitest and Playwright run in the workflows.
 * @param {{ workflows: readonly Workflow[], scripts: Readonly<Record<string, Script>> }} input
 * @returns {Invocation[]}
 */
export function findInvocations({ workflows, scripts }) {
  return workflows.flatMap((wf) =>
    runLines(wf).flatMap((run) =>
      splitCommands(run.pieces, run.file).flatMap((words) =>
        invocationsIn(words, {
          file: run.file,
          line: run.line,
          job: run.job,
          step: run.step,
          via: null,
          scripts,
          depth: 0,
        }),
      ),
    ),
  );
}

/**
 * What one run passes that would keep a test from its guard.
 * @param {Invocation} run
 * @returns {InvocationFinding[]}
 */
export function argumentFindings(run) {
  /** @type {InvocationFinding[]} */
  const out = [];
  const banned = BANNED[run.tool];
  const takesValue = TAKES_VALUE[run.tool];
  const visualOnly =
    run.tool === "playwright" &&
    run.projects.length > 0 &&
    run.projects.every((p) => p.startsWith("visual-"));
  const tool = run.tool === "vitest" ? "Vitest" : "Playwright";
  for (let n = 0; n < run.args.length; n++) {
    const word = /** @type {Word} */ (run.args[n]);
    const t = word.text;
    // A word from a package.json script also names the workflow line that runs it.
    const where = `${tool} run "${run.via}"${word.file === run.file ? "" : ` (run by ${run.file}:${run.line})`}`;
    if (t === "--") continue;
    if (t.startsWith("-")) {
      const long = t.startsWith("--");
      const name = long ? /** @type {string} */ (t.split("=")[0]?.split(".")[0]) : t.slice(0, 2);
      const attached = long ? t.includes("=") : t.length > 2;
      const ban = banned[name];
      if (ban && !(ban[0] === "reporter" && visualOnly))
        out.push({ file: word.file, line: word.line, rule: ban[0], detail: `${where}: ${t} ${ban[1]}` });
      const next = run.args[n + 1]?.text;
      const optional = OPTIONAL_VALUE[run.tool][name];
      if (!attached && (takesValue.has(name) || (next !== undefined && optional?.has(next)))) n++;
      continue;
    }
    out.push({
      file: word.file,
      line: word.line,
      rule: "filter",
      detail: `${where}: ${t} is a file argument, a file filter`,
    });
  }
  return out;
}

/**
 * V13-ARCH-018's check of the workflows and the scripts they run. An empty list means every CI test run reaches its
 * guard whole.
 * @param {{ workflows: readonly Workflow[], scripts: Readonly<Record<string, Script>>,
 *   required?: readonly RequiredRun[] }} input
 * @returns {InvocationFinding[]}
 */
export function checkTestInvocations({ workflows, scripts, required = REQUIRED_RUNS }) {
  const runs = findInvocations({ workflows, scripts });
  /** @type {InvocationFinding[]} */
  const out = runs.flatMap(argumentFindings);

  // The flag is set by an `env:` key, to "1", and never in a script.
  for (const wf of workflows)
    for (const l of wf.lines)
      if (l.key === FLAG && l.scalarOf === null && l.value !== "1")
        out.push({
          file: wf.file,
          line: l.line,
          rule: "flag",
          detail: `${FLAG} is "${l.value}"; the skip guard needs "1"`,
        });
  /** @type {Set<string>} */
  const seen = new Set();
  for (const wf of workflows)
    for (const run of runLines(wf))
      for (const words of splitCommands(run.pieces, run.file))
        for (const w of expandWords(words, scripts, 0))
          if (w.text.includes(FLAG) && !seen.has(`${w.file}:${w.line}:${w.text}`)) {
            seen.add(`${w.file}:${w.line}:${w.text}`);
            out.push({
              file: w.file,
              line: w.line,
              rule: "flag",
              detail: `${w.text}: ${FLAG} is set only by a job's or step's env: key, to "1", never in a script`,
            });
          }

  for (const req of required) {
    const wf = workflows.find((w) => w.file === req.file);
    const jobLine =
      wf?.lines.find((l) => l.key === req.job && samePath(l.path, ["jobs", req.job]))?.line ?? 0;
    const want = [...req.projects].sort().join(",");
    const found = runs.filter(
      (r) =>
        r.file === req.file &&
        r.job === req.job &&
        r.tool === req.tool &&
        [...r.projects].sort().join(",") === want,
    );
    const selection =
      req.projects.length > 0
        ? `--project ${req.projects.join(" and ")}`
        : "every project, with no --project";
    if (found.length === 0) {
      out.push({
        file: req.file,
        line: jobLine,
        rule: "missing run",
        detail: `the ${req.job} job must run ${req.tool === "vitest" ? "Vitest" : "Playwright"} with ${selection}: ${req.what}`,
      });
      continue;
    }
    if (!req.flag) continue;
    for (const r of found) {
      const flagged = (wf?.lines ?? []).some(
        (l) =>
          l.key === FLAG &&
          l.value === "1" &&
          (samePath(l.path, ["jobs", req.job, "env", FLAG]) ||
            (r.step !== null && samePath(l.path, ["jobs", req.job, "steps", r.step, "env", FLAG]))),
      );
      if (!flagged)
        out.push({
          file: r.file,
          line: r.line,
          rule: "flag",
          detail: `${req.what} need ${FLAG}: "1" in the ${req.job} job's or this step's env:; the skip guard is off without it`,
        });
    }
  }
  return out.sort(
    (a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.detail.localeCompare(b.detail),
  );
}

/**
 * The words of a simple command, with each `pnpm <script>` replaced by the script's words (to find the flag in either).
 * @param {readonly Word[]} words
 * @param {Readonly<Record<string, Script>>} scripts
 * @param {number} depth
 * @returns {Word[]}
 */
function expandWords(words, scripts, depth) {
  const n = scriptAt(words, scripts);
  if (n < 0 || depth > 4) return [...words];
  const script = /** @type {Script} */ (scripts[/** @type {Word} */ (words[n]).text]);
  const inner = splitCommands([{ text: script.command, line: script.line }], "package.json").flatMap((c) =>
    expandWords(c, scripts, depth + 1),
  );
  return [...words, ...inner];
}

/**
 * One line per finding: `file:line rule: detail`.
 * @param {readonly InvocationFinding[]} findings
 */
export const formatInvocationFindings = (findings) =>
  findings.map((f) => `  ${f.file}:${f.line} ${f.rule}: ${f.detail}`).join("\n");
