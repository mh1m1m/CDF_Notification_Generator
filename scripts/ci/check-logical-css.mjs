#!/usr/bin/env node
// @ts-check
// Fails when styles use physical left/right properties or Tailwind utilities instead of logical ones (Arabic RTL and
// English LTR share one stylesheet). Part of `pnpm lint`; ESLint covers inline `style` props in components.
//
// Checked: CSS files under app/, components/ and styles/ (declarations), and className strings in .ts/.tsx files under
// app/ and components/ (Tailwind utilities).
import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..");
const SCAN_DIRS = ["app", "components", "styles"];

/** CSS property names that name a physical side. */
export const PHYSICAL_PROPERTIES = [
  {
    pattern: /^(margin|padding|scroll-margin|scroll-padding)-(left|right)$/,
    use: "…-inline-start / …-inline-end",
  },
  { pattern: /^border-(left|right)(-(width|style|color))?$/, use: "border-inline-start / border-inline-end" },
  { pattern: /^border-(top|bottom)-(left|right)-radius$/, use: "border-start-start-radius and friends" },
  { pattern: /^(left|right)$/, use: "inset-inline-start / inset-inline-end" },
];
/** Properties whose left/right values are physical. */
export const PHYSICAL_VALUES = [
  {
    pattern: /^(text-align|float|clear)$/,
    values: /^(left|right)$/,
    use: "start / end (inline-start / inline-end)",
  },
];
/** Four-value shorthands whose 2nd (right) and 4th (left) values differ are direction-dependent. */
const FOUR_SIDED =
  /^(margin|padding|inset|scroll-margin|scroll-padding|border-width|border-style|border-color)$/;

/** Tailwind utilities that name a physical side (variants and `!` are stripped first). */
export const PHYSICAL_UTILITIES = [
  { pattern: /^-?(m|p|scroll-m|scroll-p)[lr]-/, use: "ms-/me-/ps-/pe-" },
  { pattern: /^-?(left|right)-/, use: "start-/end-" },
  { pattern: /^(text|float|clear)-(left|right)$/, use: "text-start/text-end, float-start/float-end" },
  { pattern: /^rounded-(l|r|tl|tr|bl|br)(-|$)/, use: "rounded-s/-e/-ss/-se/-es/-ee" },
  { pattern: /^border-[lr](-|$)/, use: "border-s/border-e" },
];

/**
 * @typedef {{ line: number, message: string }} Finding
 */

/** @param {string} text @param {number} offset */
const lineAt = (text, offset) => text.slice(0, offset).split("\n").length;

/**
 * Physical declarations in a stylesheet.
 * @param {string} css
 * @returns {Finding[]}
 */
export function findPhysicalCss(css) {
  /** @type {Finding[]} */
  const findings = [];
  const text = css.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, " "));
  const declaration = /(^|[{;\s])(-?[a-z][a-z-]*)\s*:\s*([^;{}]+)/g;
  for (const m of text.matchAll(declaration)) {
    const property = /** @type {string} */ (m[2]);
    const value = /** @type {string} */ (m[3]).trim().replace(/\s*!important$/, "");
    const offset = (m.index ?? 0) + (m[1]?.length ?? 0);
    // Selectors such as `a:hover` also match the pattern; a declaration value never contains a brace and is followed by
    // `;` or `}`, a selector is followed by `{`.
    const after = text.slice((m.index ?? 0) + m[0].length, (m.index ?? 0) + m[0].length + 1);
    if (after === "{") continue;
    for (const rule of PHYSICAL_PROPERTIES) {
      if (rule.pattern.test(property))
        findings.push({ line: lineAt(text, offset), message: `${property}: use ${rule.use}` });
    }
    for (const rule of PHYSICAL_VALUES) {
      if (rule.pattern.test(property) && rule.values.test(value)) {
        findings.push({ line: lineAt(text, offset), message: `${property}: ${value}: use ${rule.use}` });
      }
    }
    if (FOUR_SIDED.test(property)) {
      const parts = value.split(/\s+(?![^(]*\))/);
      if (parts.length === 4 && parts[1] !== parts[3]) {
        findings.push({
          line: lineAt(text, offset),
          message: `${property}: ${value}: four-value shorthand differs left/right; use the -block/-inline forms`,
        });
      }
    }
  }
  return findings;
}

/**
 * Physical Tailwind utilities in className strings of a component file.
 * @param {string} source
 * @returns {Finding[]}
 */
export function findPhysicalClasses(source) {
  /** @type {Finding[]} */
  const findings = [];
  const classAttr = /className=(?:"([^"]*)"|'([^']*)'|\{\s*`([^`]*)`\s*\}|\{\s*"([^"]*)"\s*\})/g;
  for (const m of source.matchAll(classAttr)) {
    const value = m[1] ?? m[2] ?? m[3] ?? m[4] ?? "";
    for (const raw of value.split(/\s+/)) {
      if (!raw || raw.startsWith("${")) continue;
      const utility = raw
        .replace(/^!/, "")
        .replace(/^(?:[^:\s]*:)+/, "")
        .replace(/^!/, "");
      for (const rule of PHYSICAL_UTILITIES) {
        if (rule.pattern.test(utility)) {
          findings.push({ line: lineAt(source, m.index ?? 0), message: `class "${raw}": use ${rule.use}` });
        }
      }
    }
  }
  return findings;
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
    else out.push(path);
  }
  return out;
}

function main() {
  const files = SCAN_DIRS.flatMap((d) => walk(join(ROOT, d)));
  /** @type {string[]} */
  const problems = [];
  let checked = 0;
  for (const file of files) {
    const ext = extname(file);
    if (ext !== ".css" && ext !== ".ts" && ext !== ".tsx") continue;
    checked += 1;
    const text = readFileSync(file, "utf8");
    const found = ext === ".css" ? findPhysicalCss(text) : findPhysicalClasses(text);
    for (const f of found) problems.push(`${relative(ROOT, file)}:${f.line}: ${f.message}`);
  }
  for (const p of problems) console.error(p);
  if (problems.length > 0) {
    console.error(`✗ logical-css: ${problems.length} physical left/right usage(s) in ${checked} file(s)`);
    process.exit(1);
  }
  console.log(`✓ logical-css: ${checked} file(s), no physical left/right properties`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
