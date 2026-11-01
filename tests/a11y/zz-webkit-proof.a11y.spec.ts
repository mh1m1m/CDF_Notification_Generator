// THROWAWAY EXPERIMENT on the never-merged proof branch (#154). It loads the case Notifications page in WebKit with
// each candidate CSS fix present before the first layout and reports the page width. SYNTHETIC personas and cases only.
import { expect, test } from "@playwright/test";
import { LOCALE_COOKIE } from "@/lib/i18n";
import { signInAs } from "../fixtures/personas";
import { caseId } from "../fixtures/scenario";

const SPACING =
  "* { line-height: 1.5 !important; letter-spacing: 0.12em !important; word-spacing: 0.16em !important; } p { margin-block-end: 2em !important; }";

const CANDIDATES: Record<string, string> = {
  "#153 as is": "",
  "T #153 + select overflow clip": "select.v13-control { overflow: clip; }",
  "U #153 + select overflow hidden": "select.v13-control { overflow: hidden; }",
};

test("WebKit draft form: page width per candidate fix", async ({ page, browserName, baseURL, context }) => {
  test.skip(browserName !== "webkit" && !process.env.QA_LOCAL_TRY, "WebKit experiment only");
  test.setTimeout(900_000);
  const results: string[] = [];
  await signInAs(page, "secretary-alpha");
  for (const locale of ["ar", "en"]) {
    await context.addCookies([{ name: LOCALE_COOKIE, value: locale, url: baseURL! }]);
    for (const [width, height] of [
      [320, 256],
      [640, 450],
    ] as [number, number][]) {
      for (const spacing of [false, true]) {
        for (const [label, css] of Object.entries(CANDIDATES)) {
          const p = await context.newPage();
          await p.setViewportSize({ width, height });
          const style = `${css}\n${spacing ? SPACING : ""}`;
          await p.addInitScript((s) => {
            const add = () => {
              const el = document.createElement("style");
              el.textContent = s;
              (document.head || document.documentElement).appendChild(el);
            };
            if (document.documentElement) add();
            else document.addEventListener("DOMContentLoaded", add);
          }, style);
          await p.goto(`/cases/${caseId("01")}/notifications`);
          await expect(p).toHaveTitle(/\S/);
          const m = await p.evaluate(() => {
            const r = document.documentElement;
            const f = document.querySelector("[data-testid='draft-form']") as HTMLElement | null;
            const s = document.querySelector("[data-testid='draft-template']") as HTMLElement | null;
            const first = r.scrollWidth;
            const form = f ? `${f.scrollWidth}/${f.clientWidth}` : "none";
            const sel = s ? `${Math.round(s.getBoundingClientRect().width)}` : "none";
            if (f) {
              f.style.display = "none";
              void f.offsetWidth;
              f.style.display = "";
            }
            // The widest option label, measured in the select's own font: does it match the extra width?
            let widest = 0;
            if (s) {
              const cs = getComputedStyle(s);
              const ctx = document.createElement("canvas").getContext("2d");
              if (ctx) {
                ctx.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
                for (const o of (s as HTMLSelectElement).options)
                  widest = Math.max(widest, ctx.measureText(o.text).width);
              }
            }
            return `${first} (form ${form}, select ${sel}, widest option text ${Math.round(widest)}; after form relayout ${r.scrollWidth})`;
          });
          results.push(`${locale} ${width}${spacing ? "+spacing" : ""} ${label}: page ${m}`);
          await p.close();
        }
      }
    }
  }
  expect(results, `EXPERIMENT\n${results.join("\n")}`).toEqual([]);
});
