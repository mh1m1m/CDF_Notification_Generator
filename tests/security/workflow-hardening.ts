// V13-SEC-015 · GitHub Actions workflow hardening (REQ-SEC-002, REQ-CICD-001). SYNTHETIC-DATA REFERENCE IMPLEMENTATION.
//
// SEC's CI rules, checked on every file under .github/workflows (.yml and .yaml), read with readdir so that a workflow
// added later is scanned without a change here. Agreed with ARCH on 7 Nov 2026 (rules W1–W6):
//   W1 the workflow has a top-level `permissions:` block that is exactly `contents: read`; a job-level `permissions:`
//      block exists only in release.yml's `tag` job and is exactly `contents: write` (the reviewed exception);
//   W2 no `pull_request_target` and no `workflow_run` trigger;
//   W3 no `secrets.` (and no `secrets:` key) anywhere; `github.token` only in release.yml's `tag` job;
//   W4 every actions/checkout step sets `persist-credentials: false`;
//   W5 every `uses:` is pinned to a full 40-hex commit SHA (a trailing tag comment is fine);
//   W6 no `${{ … }}` expression inside a `run:` script: event, ref and input text reaches a script only through `env:`
//      (stricter than "no github.event / github.head_ref / inputs": no expression is interpolated into shell at all).
// A finding names the rule, the file and the line.
//
// No YAML dependency (ARCH): a line reader that tracks indentation gives each line its key path (jobs › tag › steps ›
// [2] › with › persist-credentials) and knows which lines belong to a block scalar such as a `run: |` script. It covers
// the block style these workflows use; flow-style mappings (`{ … }`) are refused as W0, so that nothing goes unread.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

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

/** W0–W6 over one workflow file. */
export function checkWorkflow(file: string, source: string): WorkflowFinding[] {
  const out: WorkflowFinding[] = [];
  const hit = (rule: string, line: number, detail: string) => out.push({ rule, file, line, detail });
  const lines = readWorkflow(source);
  const keyed = lines.filter((l) => l.scalarOf === null);

  // W0: the reader understands block style only.
  for (const l of keyed)
    if (/(^|:\s+)\{/.test(l.text) && !l.text.includes("${{"))
      hit("W0", l.line, "a flow-style mapping; write the block style so that every key is read");

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

  return out.sort((a, b) => a.line - b.line || a.rule.localeCompare(b.rule));
}

/** Every workflow file under `dir` (.yml and .yaml), by name. */
export function workflowFiles(dir: string): string[] {
  return readdirSync(dir)
    .filter((f) => /\.ya?ml$/.test(f))
    .sort();
}

/** W0–W6 over every workflow under `dir`. */
export function checkWorkflowDir(dir: string): WorkflowFinding[] {
  return workflowFiles(dir).flatMap((f) => checkWorkflow(f, readFileSync(join(dir, f), "utf8")));
}

export const formatWorkflowFindings = (f: readonly WorkflowFinding[]) =>
  f.map((x) => `${x.rule} .github/workflows/${x.file}:${x.line} ${x.detail}`).join("\n") || "(none)";
