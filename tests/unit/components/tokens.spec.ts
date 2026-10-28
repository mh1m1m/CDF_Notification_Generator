// V13-UX-001: styles/tokens.css is the single token source (ADR-009). These tests read the real CSS, so a token change
// that breaks contrast, drifts from the case platform, or a colour literal outside tokens.css fails here.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const css = readFileSync(join(ROOT, "styles/tokens.css"), "utf8");

/** Custom properties declared in the block that starts at `selector {`. */
function block(selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`no ${selector} block`);
  const open = css.indexOf("{", start);
  let depth = 0;
  let end = open;
  for (let i = open; i < css.length; i += 1) {
    if (css[i] === "{") depth += 1;
    if (css[i] === "}") depth -= 1;
    if (depth === 0) {
      end = i;
      break;
    }
  }
  const body = css.slice(open + 1, end);
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/(--cdf-[\w-]+):\s*([^;]+);/g)) out[m[1]!] = m[2]!.trim();
  return out;
}

const light = block(":root");
const darkMedia = block(':root:not([data-theme="light"])');
const darkForced = block(':root[data-theme="dark"]');
const dark = { ...light, ...darkForced };

function hex(theme: Record<string, string>, name: string): string {
  let value = theme[name];
  for (let i = 0; value?.startsWith("var("); i += 1) {
    if (i > 5) throw new Error(`unresolved ${name}`);
    value = theme[value.slice(4, -1).trim()];
  }
  if (!value || !/^#[0-9a-f]{6}$/i.test(value))
    throw new Error(`${name} is not a hex colour: ${String(value)}`);
  return value.toLowerCase();
}

function luminance(h: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(h.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

const ratio = (t: Record<string, string>, fg: string, bg: string) => contrast(hex(t, fg), hex(t, bg));
const THEMES = [
  ["light", light],
  ["dark", dark],
] as const;
const SURFACES = ["--cdf-bg", "--cdf-surface", "--cdf-surface-subtle"] as const;
const TINTS = ["--cdf-info-bg", "--cdf-success-bg", "--cdf-warning-bg", "--cdf-danger-bg"] as const;

describe("tokens.css — text contrast (WCAG 2.2 AA 1.4.3, 4.5:1)", () => {
  for (const [name, t] of THEMES) {
    for (const bg of SURFACES) {
      for (const fg of ["--cdf-text", "--cdf-text-secondary", "--cdf-text-muted", "--cdf-expected-text"]) {
        it(`${fg} on ${bg} (${name})`, () => expect(ratio(t, fg, bg)).toBeGreaterThanOrEqual(4.5));
      }
    }
    for (const [fg, bg] of [
      ["--cdf-info", "--cdf-info-bg"],
      ["--cdf-success", "--cdf-success-bg"],
      ["--cdf-warning", "--cdf-warning-bg"],
      ["--cdf-danger", "--cdf-danger-bg"],
      ["--cdf-primary-text", "--cdf-primary"],
      ["--cdf-primary-text", "--cdf-primary-hover"],
      ["--cdf-critical-text", "--cdf-critical"],
      ["--cdf-table-header-text", "--cdf-table-header-bg"],
      ["--cdf-header-text", "--cdf-header-bg"],
      ["--cdf-banner-text", "--cdf-banner-bg"],
      ["--cdf-text", "--cdf-selected-bg"],
      ["--cdf-disabled-text", "--cdf-disabled-bg"],
    ] as const) {
      it(`${fg} on ${bg} (${name})`, () => expect(ratio(t, fg, bg)).toBeGreaterThanOrEqual(4.5));
    }
  }
  it("indicator text (Cinder) on every classification fill", () => {
    for (const fill of [
      "--cdf-class-internal",
      "--cdf-class-restricted",
      "--cdf-class-confidential",
      "--cdf-class-secret",
      "--cdf-named-access",
      "--cdf-legal-hold",
    ]) {
      expect(ratio(light, "--cdf-indicator-text", fill)).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe("tokens.css — non-text contrast (WCAG 2.2 1.4.11, 3:1)", () => {
  for (const [name, t] of THEMES) {
    for (const bg of [...SURFACES, ...TINTS]) {
      it(`--cdf-border-control on ${bg} (${name})`, () =>
        expect(ratio(t, "--cdf-border-control", bg)).toBeGreaterThanOrEqual(3));
    }
    for (const bg of SURFACES) {
      it(`--cdf-expected-border on ${bg} (${name})`, () =>
        expect(ratio(t, "--cdf-expected-border", bg)).toBeGreaterThanOrEqual(3));
      it(`--cdf-focus on ${bg} (${name})`, () =>
        expect(ratio(t, "--cdf-focus", bg)).toBeGreaterThanOrEqual(3));
    }
  }
  it("keeps the decorative border below 3:1, so it can never be the boundary of a control", () => {
    expect(ratio(light, "--cdf-border", "--cdf-surface")).toBeLessThan(3);
  });
  it("rejects the V13 reference outline #878B8F, which fails 3:1 on the subtle surface tints (ruling D3)", () => {
    expect(contrast("#878b8f", hex(light, "--cdf-info-bg"))).toBeLessThan(3.5);
    expect(hex(light, "--cdf-expected-border")).not.toBe("#878b8f");
  });
});

describe("tokens.css — lineage and structure", () => {
  // The case platform's values (mh1m1m/cdf_case_management packages/ui/src/tokens.css at feffabe). A change on
  // either side must update this pin in the same PR, with a reason (DESIGN_SYSTEM.md §1.1).
  const PLATFORM_LIGHT: Record<string, string> = {
    "--cdf-cinder-black": "#101820",
    "--cdf-warm-gray": "#d7d2cb",
    "--cdf-powder-blue": "#bbdde6",
    "--cdf-wistful-blue": "#a5b0e3",
    "--cdf-chardonnay-yellow": "#fdd086",
    "--cdf-light-salmon": "#fa9370",
    "--cdf-jetstream-green": "#b5e1c4",
    "--cdf-bg": "#f3f4f4",
    "--cdf-surface": "#ffffff",
    "--cdf-surface-subtle": "#f8f8f7",
    "--cdf-text": "#101820",
    "--cdf-text-secondary": "#5e646b",
    "--cdf-text-muted": "#5e646b",
    "--cdf-border-control": "#5e646b",
    "--cdf-border": "#d7d2cb",
    "--cdf-primary": "#101820",
    "--cdf-focus": "#4b6fff",
    "--cdf-success": "#22633d",
    "--cdf-warning": "#7a4a00",
    "--cdf-danger": "#8a2f1b",
    "--cdf-info": "#245667",
    "--cdf-success-bg": "#e6f4ea",
    "--cdf-warning-bg": "#fdf3df",
    "--cdf-danger-bg": "#fbe9e4",
    "--cdf-info-bg": "#e5f2f6",
    "--cdf-table-header-bg": "#101820",
    "--cdf-class-secret": "#fa9370",
    "--cdf-legal-hold": "#a5b0e3",
  };
  const PLATFORM_DARK: Record<string, string> = {
    "--cdf-bg": "#101820",
    "--cdf-surface": "#19212b",
    "--cdf-surface-subtle": "#303841",
    "--cdf-text": "#ffffff",
    "--cdf-text-secondary": "#d8dadd",
    "--cdf-border-control": "#8b9095",
    "--cdf-primary": "#ffffff",
    "--cdf-focus": "#bbdde6",
    "--cdf-danger": "#ffb19a",
    "--cdf-info-bg": "#1b3038",
    "--cdf-surface-elevated": "#252e38",
  };

  it("pins the copied light values to the case platform", () => {
    for (const [k, v] of Object.entries(PLATFORM_LIGHT)) expect(hex(light, k), k).toBe(v);
  });
  it("pins the copied dark values to the case platform", () => {
    for (const [k, v] of Object.entries(PLATFORM_DARK)) expect(hex(dark, k), k).toBe(v);
  });
  it("keeps the prefers-color-scheme dark block identical to the forced dark block", () => {
    expect(darkMedia).toEqual(darkForced);
  });
  it("redefines in dark every semantic colour it overrides, and nothing outside the light set", () => {
    for (const k of Object.keys(darkForced)) expect(light, k).toHaveProperty(k);
  });
  it("uses square controls and pill chips only (DG pp. 33, 37; D1)", () => {
    expect(light["--cdf-radius-control"]).toBe("0");
    expect(light["--cdf-radius-pill"]).toBe("9999px");
    expect(css).not.toMatch(/--cdf-radius-(sm|md|lg|xl)\b/);
  });
  it("labels the Arabic brand font as SOURCE_REQUIRED and downloads no font", () => {
    expect(css).toContain("BRAND FONT SOURCE_REQUIRED (OI-005)");
    expect(css).not.toMatch(/@font-face|url\(/);
    expect(light["--cdf-font-ar"]).toMatch(/Noto Sans Arabic/);
  });
  it("exposes the tokens to Tailwind through @theme", () => {
    expect(css).toMatch(/@theme inline \{[^}]*--color-cdf-surface: var\(--cdf-surface\);/s);
  });
});

describe("colour literals live only in tokens.css (board V13-UX-001: no literal colours in components)", () => {
  // A hex colour is #RGB, #RGBA, #RRGGBB or #RRGGBBAA standing alone; a link fragment such as href="#add" is not one
  // (QA review of PR #8).
  const LITERAL =
    /(?<!href=["'])(?<![\w&/])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![\w-])|\brgba?\(|\bhsla?\(|\boklch\(/;
  /** Removes comments; a `//` right after `:` (as in https://) is part of a string, not a comment. */
  const stripComments = (src: string) =>
    src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  function files(dir: string, exts: string[]): string[] {
    const out: string[] = [];
    let entries: string[] = [];
    try {
      entries = readdirSync(dir);
    } catch {
      return out;
    }
    for (const e of entries) {
      const p = join(dir, e);
      if (statSync(p).isDirectory()) out.push(...files(p, exts));
      else if (exts.includes(extname(p))) out.push(p);
    }
    return out;
  }

  it("has none in components/** or app/**", () => {
    const offenders = [
      ...files(join(ROOT, "components"), [".ts", ".tsx", ".css"]),
      ...files(join(ROOT, "app"), [".ts", ".tsx", ".css"]),
    ].filter((f) => LITERAL.test(stripComments(readFileSync(f, "utf8"))));
    expect(offenders).toEqual([]);
  });

  it("has none in styles/globals.css", () => {
    const globals = stripComments(readFileSync(join(ROOT, "styles/globals.css"), "utf8"));
    expect(globals).not.toMatch(LITERAL);
    expect(globals).toContain('@import "./tokens.css";');
  });

  it("detects a literal when one is planted (negative control)", () => {
    expect(LITERAL.test("color: #101820;")).toBe(true);
    expect(LITERAL.test("background: rgb(0 0 0);")).toBe(true);
    expect(LITERAL.test("color: var(--cdf-text);")).toBe(false);
    expect(LITERAL.test("color: #fff;")).toBe(true);
    expect(LITERAL.test("fill: #101820cc;")).toBe(true);
    expect(LITERAL.test('<a href="#add">')).toBe(false);
    expect(LITERAL.test("<a href='#face'>")).toBe(false);
    expect(LITERAL.test("#12345")).toBe(false);
  });

  it("strips comments without eating a URL inside a string (negative control)", () => {
    expect(stripComments('const u = "https://example.test"; // note #101820')).toBe(
      'const u = "https://example.test"; ',
    );
    expect(LITERAL.test(stripComments('const u = "https://example.test/#x"; const c = "#101820";'))).toBe(
      true,
    );
    expect(stripComments("/* #101820 */ a")).toBe(" a");
  });
});
