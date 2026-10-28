#!/usr/bin/env node
// @ts-check
// Keeps .env.example honest (part of `pnpm lint`):
//   - every entry is NAME= with an EMPTY value (names only, never a value — CLAUDE.md §4);
//   - every entry has a one-line comment directly above it;
//   - names are upper-snake and unique, and none is NEXT_PUBLIC_* (nothing configured here may reach the browser);
//   - every V13_* / PW_* variable the code reads is listed.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..");
const SOURCE_DIRS = ["app", "components", "lib", "scripts", "tests"];
const SOURCE_FILES = ["proxy.ts", "next.config.ts", "playwright.config.ts", "vitest.config.ts"];
const NAME = /^[A-Z][A-Z0-9_]*$/;
/** Variables the code must document: the project's own and the Playwright sandbox override. */
const DOCUMENTED_PREFIXES = /^(V13_|PW_)/;

/**
 * @typedef {{ line: number, message: string }} Finding
 * @param {string} text
 * @returns {{ names: string[], findings: Finding[] }}
 */
export function parseEnvExample(text) {
  /** @type {string[]} */
  const names = [];
  /** @type {Finding[]} */
  const findings = [];
  const lines = text.split(/\r?\n/);
  lines.forEach((raw, index) => {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) return;
    const lineNo = index + 1;
    const eq = line.indexOf("=");
    if (eq === -1) {
      findings.push({ line: lineNo, message: "expected NAME= (names only)" });
      return;
    }
    const name = line
      .slice(0, eq)
      .replace(/^export\s+/, "")
      .trim();
    const value = line.slice(eq + 1).trim();
    if (!NAME.test(name))
      findings.push({ line: lineNo, message: `"${name}" is not an upper-snake variable name` });
    if (value !== "")
      findings.push({ line: lineNo, message: `${name} has a value; .env.example holds names only` });
    if (name.startsWith("NEXT_PUBLIC_")) {
      findings.push({
        line: lineNo,
        message: `${name}: NEXT_PUBLIC_* values are sent to the browser; not allowed here`,
      });
    }
    const previous = (lines[index - 1] ?? "").trim();
    if (!previous.startsWith("#") || previous.replace(/^#+/, "").trim() === "") {
      findings.push({ line: lineNo, message: `${name} needs a one-line comment directly above it` });
    }
    if (names.includes(name)) findings.push({ line: lineNo, message: `${name} is listed twice` });
    names.push(name);
  });
  return { names, findings };
}

/**
 * V13_* and PW_* names read through process.env.NAME or env.NAME in source text.
 * @param {string} source
 */
export function findReferencedEnvNames(source) {
  /** @type {Set<string>} */
  const names = new Set();
  for (const m of source.matchAll(/\b(?:process\.env|env)\.([A-Z][A-Z0-9_]*)\b/g)) {
    const name = /** @type {string} */ (m[1]);
    if (DOCUMENTED_PREFIXES.test(name)) names.add(name);
  }
  return names;
}

/** @param {string} dir @returns {string[]} */
function walk(dir) {
  /** @type {string[]} */
  const out = [];
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...walk(path));
    else if ([".ts", ".tsx", ".mjs", ".js"].includes(extname(path))) out.push(path);
  }
  return out;
}

function main() {
  let text;
  try {
    text = readFileSync(join(ROOT, ".env.example"), "utf8");
  } catch {
    console.error("✗ env-example: .env.example is missing");
    process.exit(1);
  }
  const { names, findings } = parseEnvExample(text);
  const problems = findings.map((f) => `.env.example:${f.line}: ${f.message}`);
  const files = [
    ...SOURCE_DIRS.flatMap((d) => walk(join(ROOT, d))),
    ...SOURCE_FILES.map((f) => join(ROOT, f)),
  ];
  /** @type {Set<string>} */
  const referenced = new Set();
  for (const file of files) {
    let source;
    try {
      source = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    for (const n of findReferencedEnvNames(source)) referenced.add(n);
  }
  for (const n of [...referenced].sort()) {
    if (!names.includes(n)) problems.push(`.env.example: ${n} is read by the code but not listed`);
  }
  for (const p of problems) console.error(p);
  if (problems.length > 0) {
    console.error(`✗ env-example: ${problems.length} problem(s)`);
    process.exit(1);
  }
  console.log(`✓ env-example: ${names.length} variable name(s), all documented, no values`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
