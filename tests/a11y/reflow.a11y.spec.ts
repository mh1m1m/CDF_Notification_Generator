// Text resize, reflow and text spacing in the browser (V13-QA-010; REQ-A11Y-010; WCAG 2.2 SC 1.4.4, 1.4.10, 1.4.12).
// The six checks of docs/design/reviews/UX009_TEXT_RESIZE_REFLOW.md §4, so UX-009's R-01 … R-03 stay fixed where
// tests/unit/components/reflow.spec.ts can only pin the CSS:
//   1. no page-level horizontal scroll, and no element outside a scroll region past either viewport edge (in RTL,
//      overflow past the inline start cannot be scrolled to, so scrollWidth alone cannot see it);
//   2. at 320 × 256 every area link (nav-*) and case tab (case-tab-*) lies inside the viewport (R-01, R-02);
//   3. outside table scroll regions, no visible text is clipped by overflow hidden or clip;
//   4. every element that scrolls inline is a scroll region: role="region", an accessible name, tabindex="0";
//   5. the skip link, focused at 320 × 256 with the spacing override, lies inside the viewport (R-03);
//   6. the workspace switcher menu, open at 320 × 256 with the spacing override, lies inside the viewport; Escape
//      closes it.
// Conditions (CSS px, as the browser sees them): 640 × 450 (200% zoom), 320 × 256 (400% zoom), and 1280 × 900 and
// 320 × 256 with the 1.4.12 spacing stylesheet. Arabic and English. Each check is planted into a real page first, so a
// check that cannot see its fault fails here. Run after `pnpm db:reset`. SYNTHETIC personas and cases only.
import { expect, test, type Page } from "@playwright/test";
import { LOCALE_COOKIE } from "@/lib/i18n";
import { signInAs } from "../fixtures/personas";
import { caseId } from "../fixtures/scenario";

/** WCAG 2.2 SC 1.4.12: line height 1.5, paragraph spacing 2 × the font size, letter 0.12 em, word 0.16 em. */
const SPACING = [
  "* { line-height: 1.5 !important; letter-spacing: 0.12em !important; word-spacing: 0.16em !important; }",
  "p { margin-block-end: 2em !important; }",
].join("\n");

const CONDITIONS = [
  { name: "200% zoom (640 × 450)", width: 640, height: 450, spacing: false },
  { name: "reflow (320 × 256)", width: 320, height: 256, spacing: false },
  { name: "text spacing (1280 × 900)", width: 1280, height: 900, spacing: true },
  { name: "reflow + text spacing (320 × 256)", width: 320, height: 256, spacing: true },
] as const;

const PAGES = [
  "/portfolio",
  "/my-work",
  `/cases/${caseId("01")}`,
  `/cases/${caseId("01")}/events`,
  `/cases/${caseId("01")}/tasks`,
  `/cases/${caseId("01")}/notifications`,
  "/notifications",
  "/workspaces",
];

const LOCALES = ["ar", "en"] as const;

interface Finding {
  check: 1 | 2 | 3 | 4;
  detail: string;
}

/** Checks 1–4 on the page as it is now. Check 2 applies only when `edges` is set (the 320 px conditions). */
async function measure(page: Page, edges: boolean): Promise<Finding[]> {
  return page.evaluate((edges) => {
    const out: { check: 1 | 2 | 3 | 4; detail: string }[] = [];
    const root = document.documentElement;
    const name = (el: Element) =>
      `${el.tagName.toLowerCase()}${el.getAttribute("data-testid") ? `[${el.getAttribute("data-testid")}]` : ""}` +
      `${el.className && typeof el.className === "string" ? `.${el.className.trim().split(/\s+/).join(".")}` : ""}`;
    if (root.scrollWidth > root.clientWidth)
      out.push({ check: 1, detail: `the page scrolls inline: ${root.scrollWidth} > ${root.clientWidth}` });
    if (edges) {
      for (const link of document.querySelectorAll('a[data-testid^="nav-"], a[data-testid^="case-tab-"]')) {
        if (link.getClientRects().length === 0) continue;
        const box = link.getBoundingClientRect();
        if (box.left < -0.5 || box.right > root.clientWidth + 0.5)
          out.push({
            check: 2,
            detail: `${name(link)} lies at ${Math.round(box.left)}…${Math.round(box.right)} of ${root.clientWidth}`,
          });
      }
    }
    for (const el of document.querySelectorAll("body *")) {
      if (!(el instanceof HTMLElement) || el.getClientRects().length === 0) continue;
      if (el.closest("[data-scroll-region], .v13-scroll-region, .v13-sr-only")) continue;
      const style = getComputedStyle(el);
      if (style.visibility === "hidden") continue;
      const isRegion =
        el.getAttribute("role") === "region" &&
        el.getAttribute("tabindex") === "0" &&
        !!(el.getAttribute("aria-label") || el.getAttribute("aria-labelledby"));
      if (/auto|scroll/.test(style.overflowX) && el.scrollWidth > el.clientWidth + 1 && !isRegion)
        out.push({ check: 4, detail: `${name(el)} scrolls inline but is not a named, focusable region` });
      if (el.classList.contains("v13-skip-link") && document.activeElement !== el) continue;
      // RTL overflow past the inline start is not scrollable, so scrollWidth cannot see it; the box can (§10).
      const box = el.getBoundingClientRect();
      if (box.width > 0 && (box.left < -1 || box.right > root.clientWidth + 1))
        out.push({
          check: 1,
          detail: `${name(el)} lies at ${Math.round(box.left)}…${Math.round(box.right)} of ${root.clientWidth}`,
        });
      if (!el.textContent?.trim()) continue;
      const clips = (v: string) => v === "hidden" || v === "clip";
      if (
        (clips(style.overflowX) && el.scrollWidth > el.clientWidth + 1) ||
        (clips(style.overflowY) && el.scrollHeight > el.clientHeight + 1)
      )
        out.push({
          check: 3,
          detail: `${name(el)} clips its text: ${el.scrollWidth}×${el.scrollHeight} in ${el.clientWidth}×${el.clientHeight}`,
        });
    }
    return out;
  }, edges);
}

const format = (fs: readonly Finding[]) => fs.map((f) => `check ${f.check}: ${f.detail}`).join("\n");

async function open(page: Page, path: string, spacing: boolean) {
  const res = await page.goto(path);
  expect(res?.status(), path).toBe(200);
  await expect(page, "the page has rendered its title").toHaveTitle(/\S/);
  if (spacing) await page.addStyleTag({ content: SPACING });
}

for (const locale of LOCALES) {
  test.describe(`text resize and reflow, ${locale}`, () => {
    test.beforeEach(async ({ context, baseURL }) => {
      await context.addCookies([{ name: LOCALE_COOKIE, value: locale, url: baseURL! }]);
    });

    for (const c of CONDITIONS) {
      test(`checks 1–4 on every page: ${c.name}`, async ({ page }) => {
        await signInAs(page, "secretary-alpha");
        await page.setViewportSize({ width: c.width, height: c.height });
        const found: string[] = [];
        for (const path of PAGES) {
          await open(page, path, c.spacing);
          await expect(page.locator("html")).toHaveAttribute("lang", locale);
          const f = await measure(page, c.width === 320);
          if (f.length) found.push(`${path}\n${format(f)}`);
        }
        expect(found, found.join("\n")).toEqual([]);
      });
    }

    test("check 5: the focused skip link lies inside the viewport at 320 × 256 with text spacing", async ({
      page,
    }) => {
      await signInAs(page, "secretary-alpha");
      await page.setViewportSize({ width: 320, height: 256 });
      for (const path of ["/portfolio", `/cases/${caseId("01")}/tasks`]) {
        await open(page, path, true);
        await page.keyboard.press("Tab");
        const skip = page.locator(".v13-skip-link");
        await expect(skip, "the first Tab reaches the skip link").toBeFocused();
        const box = await skip.evaluate((el) => {
          const b = el.getBoundingClientRect();
          return {
            left: b.left,
            right: b.right,
            top: b.top,
            bottom: b.bottom,
            width: innerWidth,
            height: innerHeight,
          };
        });
        expect(box.left, path).toBeGreaterThanOrEqual(0);
        expect(box.right, path).toBeLessThanOrEqual(box.width);
        expect(box.top, path).toBeGreaterThanOrEqual(0);
        expect(box.bottom, path).toBeLessThanOrEqual(box.height);
      }
    });

    test("check 6: the open switcher menu lies inside the viewport at 320 × 256 with text spacing; Escape closes it", async ({
      page,
    }) => {
      // Governance Officer Delta holds two workspaces, so the menu lists another one to switch to.
      await signInAs(page, "governance-officer-delta");
      await page.setViewportSize({ width: 320, height: 256 });
      await open(page, "/my-work", true);
      await page.getByTestId("workspace-switcher").click();
      const option = page.getByTestId("workspace-menu-option-SECRETARIAT");
      await expect(option).toBeVisible();
      const items = page.locator('[data-testid^="workspace-menu-"]');
      expect(await items.count()).toBeGreaterThanOrEqual(2);
      const boxes = await items.evaluateAll((els) =>
        els.map((el) => {
          const b = el.getBoundingClientRect();
          return { id: el.getAttribute("data-testid"), left: b.left, right: b.right, width: innerWidth };
        }),
      );
      for (const b of boxes) {
        expect(b.left, `${b.id}`).toBeGreaterThanOrEqual(0);
        expect(b.right, `${b.id}`).toBeLessThanOrEqual(b.width);
      }
      expect((await measure(page, true)).filter((f) => f.check === 1)).toEqual([]);
      await page.keyboard.press("Escape");
      await expect(option).toBeHidden();
    });
  });
}

test.describe("each check sees its fault (planted into a real page)", () => {
  const plants: [string, 1 | 2 | 3 | 4, (doc: Document) => void][] = [
    [
      "a block wider than the viewport",
      1,
      (doc) => {
        const d = doc.createElement("div");
        d.style.inlineSize = "900px";
        d.textContent = "wide";
        doc.querySelector("main")!.append(d);
      },
    ],
    [
      "an area link pushed off-screen",
      2,
      (doc) => {
        const a = doc.querySelector<HTMLElement>('a[data-testid^="nav-"]')!;
        a.style.position = "fixed";
        a.style.insetInlineStart = "-400px";
      },
    ],
    [
      "text clipped by a fixed box",
      3,
      (doc) => {
        const p = doc.createElement("p");
        Object.assign(p.style, {
          inlineSize: "40px",
          blockSize: "1em",
          overflow: "hidden",
          whiteSpace: "nowrap",
        });
        p.textContent = "Employee Alpha's synthetic note that cannot fit";
        doc.querySelector("main")!.append(p);
      },
    ],
    [
      "an inline scroller that is not a named region",
      4,
      (doc) => {
        const d = doc.createElement("div");
        d.style.overflowX = "auto";
        d.style.maxInlineSize = "100%";
        const inner = doc.createElement("div");
        inner.style.inlineSize = "900px";
        inner.textContent = "wide content";
        d.append(inner);
        doc.querySelector("main")!.append(d);
      },
    ],
    [
      "a block pushed past the inline start in RTL (invisible to scrollWidth)",
      1,
      (doc) => {
        const d = doc.createElement("div");
        Object.assign(d.style, { position: "relative", insetInlineStart: "-200px", inlineSize: "120px" });
        d.textContent = "start overflow";
        doc.querySelector("main")!.append(d);
      },
    ],
  ];
  for (const [what, check, plant] of plants) {
    test(`check ${check}: ${what}`, async ({ page }) => {
      await signInAs(page, "secretary-alpha");
      await page.setViewportSize({ width: 320, height: 256 });
      await open(page, "/portfolio", true);
      expect(await measure(page, true), "the page is clean before the plant").toEqual([]);
      await page.evaluate(`(${plant.toString()})(document)`);
      const f = await measure(page, true);
      expect(
        f.map((x) => x.check),
        format(f),
      ).toContain(check);
    });
  }
});
