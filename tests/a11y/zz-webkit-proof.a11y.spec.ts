// THROWAWAY EXPERIMENT on the never-merged proof branch (#154). It loads the case Notifications page in WebKit with
// each candidate CSS fix present before the first layout and reports the page width. SYNTHETIC personas and cases only.
import { expect, test } from "@playwright/test";
import { LOCALE_COOKIE } from "@/lib/i18n";
import { signInAs } from "../fixtures/personas";
import { caseId } from "../fixtures/scenario";

const SPACING =
  "* { line-height: 1.5 !important; letter-spacing: 0.12em !important; word-spacing: 0.16em !important; } p { margin-block-end: 2em !important; }";

const CANDIDATES: Record<string, string> = {
  baseline: "",
  "A select inline-size 100%": "select.v13-control { inline-size: 100%; }",
  "B form>select flex 1 1 100%": "[data-testid='draft-form'] > select { flex: 1 1 100%; }",
  "C select contain inline-size": "select.v13-control { contain: inline-size; }",
  "D select overflow hidden": "select.v13-control { overflow: hidden; }",
  "E form column": "[data-testid='draft-form'] { flex-direction: column; align-items: stretch; }",
  "F select min-inline-size 0 + inline-size 100%":
    "select.v13-control { min-inline-size: 0; inline-size: 100%; }",
  "G no code paragraph": "[data-testid='draft-template-code'] { display: none; }",
};

test("WebKit draft form: page width per candidate fix", async ({ page, browserName, baseURL, context }) => {
  test.skip(browserName !== "webkit" && !process.env.QA_LOCAL_TRY, "WebKit experiment only");
  test.setTimeout(240_000);
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
            return `${first} (form ${form}, select ${sel}; after form relayout ${r.scrollWidth})`;
          });
          results.push(`${locale} ${width}${spacing ? "+spacing" : ""} ${label}: page ${m}`);
          await p.close();
        }
      }
    }
  }
  expect(results, `EXPERIMENT\n${results.join("\n")}`).toEqual([]);
});
