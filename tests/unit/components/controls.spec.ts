// V13-UX-014 (UXB-17, UXB-18; WCAG 2.2 SC 1.4.1, 1.4.11, 2.5.8): one shared form-control rule and one table-cell
// link style, read from the real stylesheet and the real page sources. The browser check (computed border, contrast
// and size at 320–1280 px, ar and en) is QA's review; the token contrast itself is pinned in tokens.spec.ts
// (--cdf-border-control ≥ 3:1 on every surface, both themes).
import { readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync("styles/globals.css", "utf8");

/** Every declaration block for a selector (at any media level), joined. */
function rules(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const found = [...css.matchAll(new RegExp(`(?:^|[\\s,}])${escaped}\\s*\\{([^}]*)\\}`, "g"))].map(
    (m) => m[1],
  );
  if (found.length === 0) throw new Error(`no rule for ${selector}`);
  return found.join("\n");
}

function files(dir: string, exts: readonly string[]): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path, exts);
    return exts.includes(extname(path)) ? [path] : [];
  });
}

const SOURCES = [...files("app", [".tsx"]), ...files("components", [".tsx"])];

/** Every opening JSX tag of the given element in a source file, attributes included. */
function tags(source: string, element: string): string[] {
  return [...source.matchAll(new RegExp(`<${element}\\b[^>]*>`, "g"))].map((m) => m[0]);
}

const typeOf = (tag: string) => /\stype="([^"]+)"/.exec(tag)?.[1] ?? "text";
const NOT_A_FIELD = new Set(["hidden", "checkbox", "radio", "submit", "button", "reset"]);

describe("form controls: one shared rule (UXB-17)", () => {
  it("v13-control draws a border with the control token, so the field is visible (SC 1.4.11)", () => {
    expect(rules(".v13-control")).toMatch(
      /border:\s*var\(--cdf-border-hairline\)\s+solid\s+var\(--cdf-border-control\)/,
    );
  });

  it("v13-control fills the field with the surface colour and inherits the page font", () => {
    const control = rules(".v13-control");
    expect(control).toMatch(/background-color:\s*var\(--cdf-surface\)/);
    expect(control).toMatch(/color:\s*var\(--cdf-text\)/);
    expect(control).toMatch(/font:\s*inherit/);
  });

  it("v13-control is at least 2.5rem tall (40 px: above SC 2.5.8's 24 px)", () => {
    const size = /min-block-size:\s*([\d.]+)rem/.exec(rules(".v13-control"));
    expect(size, "min-block-size in rem").not.toBeNull();
    expect(Number(size![1])).toBeGreaterThanOrEqual(2.5);
  });

  it("v13-control never grows past its container (reflow at 320 px, QA's #51 fix)", () => {
    const control = rules(".v13-control");
    expect(control).toMatch(/max-inline-size:\s*100%/);
    expect(control).not.toMatch(/(^|[^-])(width|height|left|right|top|bottom)\s*:/);
    expect(control).not.toMatch(/(margin|padding)-(left|right|top|bottom)/);
  });

  it("a v13-control select has no native menulist, so WebKit does not count its options as page overflow (UXB-20, SC 1.4.10)", () => {
    const select = rules("select.v13-control");
    expect(select).toMatch(/(^|[\s;])appearance:\s*none/);
    expect(select).not.toMatch(/(^|[^-])(width|inline-size|flex)\s*:/);
  });

  it("the select draws its own chevron at the inline end, in the text colour, with room for it (SC 1.4.11)", () => {
    const select = rules("select.v13-control");
    expect(select).toMatch(
      /background-image:[^;]*linear-gradient\(45deg,[^)]*currentColor[^;]*linear-gradient\(135deg,[^)]*currentColor/,
    );
    expect(select).toMatch(
      /background-position:\s*calc\(100% - [\d.]+rem\) 50%,\s*calc\(100% - [\d.]+rem\) 50%/,
    );
    expect(select).toMatch(/background-repeat:\s*no-repeat/);
    const end = /padding-inline-end:\s*([\d.]+)rem/.exec(select);
    expect(end, "padding-inline-end in rem").not.toBeNull();
    expect(Number(end![1])).toBeGreaterThanOrEqual(1.5);
    expect(rules('[dir="rtl"] select.v13-control')).toMatch(
      /background-position:\s*[\d.]+rem 50%,\s*[\d.]+rem 50%/,
    );
  });

  it("forced colours get the native arrow back and drop the drawn chevron", () => {
    const block =
      /@media \(forced-colors: active\)\s*\{\s*select\.v13-control\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(block).toMatch(/appearance:\s*auto/);
    expect(block).toMatch(/background-image:\s*none/);
  });

  it.each(SOURCES)("every field in %s uses v13-control", (path) => {
    const source = readFileSync(path, "utf8");
    const fields = [
      ...tags(source, "select"),
      ...tags(source, "textarea"),
      ...tags(source, "input").filter((tag) => !NOT_A_FIELD.has(typeOf(tag))),
    ];
    for (const tag of fields) expect(tag, path).toMatch(/className="[^"]*\bv13-control\b/);
  });

  it.each(SOURCES)("every button in %s has a style class (no bare browser button)", (path) => {
    for (const tag of tags(readFileSync(path, "utf8"), "button")) expect(tag, path).toMatch(/className=/);
  });

  it.each([
    "app/(platform)/notifications/_components/center.module.css",
    "app/(platform)/portfolio/_components/portfolio.module.css",
    "app/(platform)/cases/[caseId]/_components/case.module.css",
    "app/(platform)/my-work/_components/my-work.module.css",
  ])("%s defines no field look of its own (one definition)", (path) => {
    let source: string;
    try {
      source = readFileSync(path, "utf8");
    } catch {
      return; // the module does not exist on this page
    }
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "");
    expect(code).not.toMatch(/(^|[\s,>])(input|select|textarea)\b[^{};]*\{/m);
  });

  it("the case draft form keeps QA's #51 reflow guard on its children", () => {
    const module = readFileSync("app/(platform)/cases/[caseId]/_components/case.module.css", "utf8");
    const guard = /\.form > \*\s*\{([^}]*)\}/.exec(module)?.[1] ?? "";
    expect(guard).toMatch(/min-inline-size:\s*0/);
    expect(guard).toMatch(/max-inline-size:\s*100%/);
  });

  it("the case draft form submits with the primary button", () => {
    const form = readFileSync(
      "app/(platform)/cases/[caseId]/notifications/_components/DraftForm.tsx",
      "utf8",
    );
    const submit = tags(form, "button").find((tag) => tag.includes('data-testid="draft-submit"'));
    expect(submit).toMatch(/className="v13-btn v13-btn-primary"/);
  });
});

describe("links in table cells look like links (UXB-18, SC 1.4.1)", () => {
  it("a link in any table body is underlined, a cue that is not colour alone", () => {
    expect(rules("tbody a:not(.v13-btn)")).toMatch(/text-decoration-line:\s*underline/);
  });

  it("the underline is defined once, in globals.css, not per page", () => {
    for (const path of files("app", [".css"]))
      expect(readFileSync(path, "utf8"), path).not.toMatch(/text-decoration[^;]*underline/);
  });
});
