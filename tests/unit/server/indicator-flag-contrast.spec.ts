// V13-FE-019 (QA-018 F-01): FE's small indicator flags (the case "mine" task flag, the portfolio "restricted" flag and
// the Center flag) write --cdf-indicator-text, which is #101820 in both themes. Without a fill it sat on the dark
// surfaces at 1.1:1 (overview) and 1.5:1 (tasks). Every FE rule that writes the indicator text now also paints the
// indicator's own fill, --cdf-named-access, the pair UX's .v13-indicator-outline uses. This pins that pair at 4.5:1
// (WCAG 1.4.3) in light and in both dark blocks, read from the real stylesheets. The browser check is QA's.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const tokens = readFileSync(join(ROOT, "styles/tokens.css"), "utf8");

/** The body of the block that opens at `selector {` (brace-matched). */
function body(css: string, at: number): string {
  const open = css.indexOf("{", at);
  let depth = 0;
  for (let i = open; i < css.length; i += 1) {
    if (css[i] === "{") depth += 1;
    if (css[i] === "}" && --depth === 0) return css.slice(open + 1, i);
  }
  throw new Error("unclosed block");
}

function vars(selector: string): Record<string, string> {
  const at = tokens.indexOf(`${selector} {`);
  if (at < 0) throw new Error(`no ${selector} block`);
  const out: Record<string, string> = {};
  for (const m of body(tokens, at).matchAll(/(--cdf-[\w-]+):\s*([^;]+);/g)) out[m[1]!] = m[2]!.trim();
  return out;
}

const light = vars(":root");
const THEMES = {
  light,
  "dark (prefers-color-scheme)": { ...light, ...vars(':root:not([data-theme="light"])') },
  "dark (data-theme)": { ...light, ...vars(':root[data-theme="dark"]') },
};

function hex(theme: Record<string, string>, name: string): string {
  const value = theme[name];
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

/** Every rule in an FE page CSS module that writes the indicator text, with its file and selector. */
function indicatorRules(): { file: string; selector: string; rule: string }[] {
  const out: { file: string; selector: string; rule: string }[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (name.endsWith(".module.css")) {
        const css = readFileSync(path, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
        for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g))
          if (/color:\s*var\(--cdf-indicator-text\)/.test(m[2]!))
            out.push({ file: path.slice(ROOT.length), selector: m[1]!.trim(), rule: m[2]! });
      }
    }
  };
  walk(join(ROOT, "app/(platform)"));
  return out;
}

describe("indicator flag contrast (FE-019)", () => {
  const rules = indicatorRules();

  it("finds the three FE flags (case mine, portfolio restricted, Center)", () => {
    expect(rules.map((r) => r.file).sort()).toEqual([
      "app/(platform)/cases/[caseId]/_components/case.module.css",
      "app/(platform)/notifications/_components/center.module.css",
      "app/(platform)/portfolio/_components/portfolio.module.css",
    ]);
  });

  it.each(rules.map((r) => [`${r.file} ${r.selector}`, r] as const))(
    "%s paints the indicator fill under the indicator text",
    (_n, r) => {
      expect(r.selector).toBe(".flag");
      expect(r.rule).toMatch(/background-color:\s*var\(--cdf-named-access\)\s*;/);
      expect(r.rule).not.toMatch(/background(-color)?:\s*(transparent|none)/);
    },
  );

  for (const [name, theme] of Object.entries(THEMES)) {
    it(`${name}: indicator text on the indicator fill is at least 4.5:1`, () => {
      const pair = contrast(hex(theme, "--cdf-indicator-text"), hex(theme, "--cdf-named-access"));
      expect(pair).toBeGreaterThanOrEqual(4.5);
    });
  }

  it("negative: in dark, the indicator text without its fill fails on the overview and tasks surfaces", () => {
    for (const theme of [THEMES["dark (prefers-color-scheme)"], THEMES["dark (data-theme)"]]) {
      const text = hex(theme, "--cdf-indicator-text");
      expect(contrast(text, hex(theme, "--cdf-surface"))).toBeLessThan(4.5);
      expect(contrast(text, hex(theme, "--cdf-surface-subtle"))).toBeLessThan(4.5);
    }
  });

  it("the fill stands apart from the dark surfaces (the flag is visible, 3:1 non-text)", () => {
    for (const theme of [THEMES["dark (prefers-color-scheme)"], THEMES["dark (data-theme)"]]) {
      const fill = hex(theme, "--cdf-named-access");
      for (const surface of ["--cdf-surface", "--cdf-surface-subtle", "--cdf-surface-elevated", "--cdf-bg"])
        expect(contrast(fill, hex(theme, surface))).toBeGreaterThanOrEqual(3);
    }
  });
});
