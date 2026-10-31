// The scroll-region guard itself: it must flag the markup QA found at 375 px (a plain overflow wrapper).
import { describe, expect, it } from "vitest";
import { scrollRegionProblems } from "./support/scroll-regions";

const table = (captionAttrs = ' id="c"') => `<table><caption${captionAttrs}>Tasks</caption></table>`;

describe("scrollRegionProblems", () => {
  it("accepts a focusable region named by the caption", () => {
    expect(
      scrollRegionProblems(`<div tabindex="0" role="region" aria-labelledby="c">${table()}</div>`),
    ).toEqual([]);
  });
  it.each([
    ["a plain overflow wrapper (the #23 finding)", `<div class="scroll">${table()}</div>`],
    ["no role", `<div tabindex="0" aria-labelledby="c">${table()}</div>`],
    ["not focusable", `<div role="region" aria-labelledby="c">${table()}</div>`],
    ["labelled by another id", `<div tabindex="0" role="region" aria-labelledby="x">${table()}</div>`],
    ["a caption without id", `<div tabindex="0" role="region" aria-labelledby="c">${table("")}</div>`],
    ["no wrapper at all", table()],
    ["no table", "<p>empty</p>"],
    [
      "two tables sharing one caption id",
      `<div tabindex="0" role="region" aria-labelledby="c">${table()}</div><div tabindex="0" role="region" aria-labelledby="c">${table()}</div>`,
    ],
  ])("flags %s", (_n, html) => {
    expect(scrollRegionProblems(html).length).toBeGreaterThan(0);
  });
});
