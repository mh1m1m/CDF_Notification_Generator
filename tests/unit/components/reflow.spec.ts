// V13-UX-009 (REQ-A11Y-010; WCAG 2.2 SC 1.4.4, 1.4.10, 1.4.12): what a unit test can pin about reflow, read from the
// stylesheet. The browser-level check (200% zoom, 320 CSS px, the 1.4.12 spacing override) is QA's a11y e2e
// (docs/design/reviews/UX009_TEXT_RESIZE_REFLOW.md §4).
import { readFileSync } from "node:fs";
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

describe("reflow: navigation rows wrap, never scroll (R-01, R-02)", () => {
  it.each([".v13-side-nav", ".v13-case-tabs"])("%s has no horizontal scrolling", (selector) => {
    expect(rules(selector)).not.toMatch(/overflow(-x)?\s*:\s*(auto|scroll|hidden)/);
  });

  it.each([".v13-side-nav ul", ".v13-case-tabs ul"])("%s wraps its items", (selector) => {
    expect(rules(selector)).toMatch(/flex-wrap:\s*wrap/);
  });
});

describe("reflow: text containers never clip (1.4.12)", () => {
  it("the skip link, when shown, fits the viewport", () => {
    expect(rules(".v13-skip-link")).toMatch(/max-inline-size:\s*calc\(100vw/);
  });

  it("no rule fixes a text line height in px or clips text with a fixed block size", () => {
    // Fixed line heights and block sizes break when users raise line-height or text size.
    expect(css).not.toMatch(/line-height:\s*\d+px/);
    for (const [, body] of css.matchAll(/\{([^}]*)\}/g)) {
      if (/inline-size:\s*1px/.test(body!)) continue; // the visually-hidden pattern (sr-only, unfocused skip link)
      if (/(^|[^-])block-size:\s*\d+(px|rem)/.test(body!) && /overflow(-y)?:\s*(hidden|clip)/.test(body!))
        throw new Error(`fixed block size with clipped overflow: {${body!.trim()}}`);
    }
  });

  it("wide tables scroll only inside their own region", () => {
    expect(rules(".v13-scroll-region")).toMatch(/overflow-x:\s*auto/);
    expect(rules(".v13-scroll-region")).toMatch(/max-inline-size:\s*100%/);
  });
});
