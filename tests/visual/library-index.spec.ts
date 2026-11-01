// The screenshot library's plan, index and data check, without the app (V13-QA-014; REQ-VIS-005, -011, -015;
// docs/qa/M1_OPEN_QA_ROWS_DESIGN.md §2–§4). Runs in every e2e run (desktop-ar), not only in the library job:
//   - docs/qa/SCREENSHOT_LIBRARY.md is exactly what library-plan.ts generates (never hand-edited; regenerate locally
//     with V13_E2E_VISUAL=index, never in CI);
//   - the plan is well formed: one row per screen and state, real synthetic personas, seeded case routes only;
//   - the data check (V1–V5) refuses each planted fault and passes a clean synthetic page;
//   - an empty frame in a capture is retaken at most MAX_CAPTURE_ATTEMPTS times, then fails (frames.ts).
import { readFileSync, writeFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { PERSONAS } from "@/lib/contracts";
import { checkSynthetic, SYNTHETIC_PERSONA_NAMES } from "./data-check";
import { captureWithPaintedFrames, MAX_CAPTURE_ATTEMPTS, settleFrames } from "./frames";
import {
  CAPTURES,
  imageCount,
  MASK_COLOR,
  MASKS,
  NOT_APPLICABLE,
  renderIndex,
  VIEWPORTS,
} from "./library-plan";

const INDEX = "docs/qa/SCREENSHOT_LIBRARY.md";

test.describe("screenshot library: plan and index", () => {
  test("docs/qa/SCREENSHOT_LIBRARY.md is generated from the plan", () => {
    const generated = renderIndex();
    if (process.env.V13_E2E_VISUAL === "index" && process.env.CI !== "true") writeFileSync(INDEX, generated);
    expect(readFileSync(INDEX, "utf8"), `regenerate with V13_E2E_VISUAL=index (${INDEX})`).toBe(generated);
  });

  test("one row per screen and state; personas are synthetic; routes are seeded or unknown ids", () => {
    const keys = CAPTURES.map((c) => `${c.screen}/${c.state}`);
    expect(new Set(keys).size, "duplicate screen/state rows").toBe(keys.length);
    const slugs = new Set(PERSONAS.map((p) => p.slug));
    for (const c of CAPTURES) {
      expect(slugs.has(c.persona), `${c.screen}/${c.state}: ${c.persona} is a synthetic persona`).toBe(true);
      expect(c.route, `${c.screen}/${c.state}: a path, not a URL`).toMatch(/^\/[^/]/);
      expect(c.route.includes("{draft}"), `${c.screen}/${c.state}: {draft} only with a draft setup`).toBe(
        c.draftOnCase !== undefined,
      );
      for (const id of c.route.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g) ?? [])
        expect(id, `${c.screen}/${c.state}: seeded (0c…, 2f…) or the unknown id`).toMatch(
          /^(0c000000-0000-4000-8000-0000000000(0[1-9]|10|ff)|2f000000-0000-4000-8000-0000000000\d\d)$/,
        );
      for (const m of c.masks) expect(Object.keys(MASKS)).toContain(m);
      for (const v of c.viewports ?? []) expect(Object.keys(VIEWPORTS)).toContain(v);
      expect(c.how.trim(), "each row says how its state is reached").not.toBe("");
    }
    for (const n of NOT_APPLICABLE) expect(n.reason.trim()).not.toBe("");
    expect(imageCount()).toBeGreaterThan(100);
  });
});

test.describe("screenshot library: data check (V1–V5) refuses planted faults", () => {
  const PLANTED_VALUE = "planted-value-for-v5-0123456789";
  const clean = "<p>CDF-DEMO-2026-0001 · witness.gamma@example.test · CDF-DEMO-2026-0010</p>";
  const name = [...SYNTHETIC_PERSONA_NAMES][0]!;
  const run = (text: string, personaNames: string[] = [name]) =>
    checkSynthetic([{ where: "planted", text }], { personaNames, secrets: [PLANTED_VALUE] }).map(
      (f) => f.rule,
    );

  test("a clean synthetic page passes", () => {
    expect(run(clean)).toEqual([]);
    expect(run("CDF-DEMO-2026-٠٠٠٣")).toEqual([]);
  });

  const planted: [string, string, string[] | undefined, string][] = [
    ["V1", "CDF-DEMO-2026-0011", undefined, "a case number past the seeded ten"],
    ["V1", "CDF-DEMO-2026-٠٠١١", undefined, "the same in Arabic-Indic digits"],
    ["V1", "CDF-2026-0042", undefined, "another numbering shape"],
    ["V1", "CDF-INV-2025-0007", undefined, "another prefix and year"],
    ["V2", "contact a.person@example.com", undefined, "an address outside @example.test"],
    ["V2", "x@example.test.evil.org", undefined, "@example.test as a subdomain only"],
    ["V3", "see https://www.cdf.gov.sa/", undefined, "the real domain without an address"],
    ["V4", clean, ["Real Person"], "a persona name outside the synthetic list"],
    ["V5", `<input type="hidden" value="${PLANTED_VALUE}">`, undefined, "a session cookie value in markup"],
  ];
  for (const [rule, text, names, why] of planted) {
    test(`${rule}: ${why}`, () => {
      expect(run(text, names)).toContain(rule);
    });
  }
});

test.describe("screenshot library: frames are painted before an image is kept (ARCH on #140)", () => {
  const PAGE = `<!doctype html><html><body style="margin:0;background:#fff">
    <iframe style="inline-size:400px;block-size:200px;border:0"
      srcdoc="<p style='font:20px sans-serif'>Synthetic preview text for Witness Gamma, CDF-DEMO-2026-0001.</p>"></iframe>
  </body></html>`;
  const HIDE = "iframe { visibility: hidden; }";

  test("a capture whose frame is empty is retaken, and the attempt is counted", async ({ page }) => {
    await page.setContent(PAGE);
    await settleFrames(page);
    let calls = 0;
    const { attempts } = await captureWithPaintedFrames(
      page,
      () => page.screenshot({ style: (calls += 1) === 1 ? HIDE : "" }),
      MASK_COLOR,
    );
    expect(calls).toBe(2);
    expect(attempts).toBe(2);
  });

  test("a frame that never paints fails after the last attempt: no image is kept", async ({ page }) => {
    await page.setContent(PAGE);
    await settleFrames(page);
    let calls = 0;
    await expect(
      captureWithPaintedFrames(
        page,
        () => {
          calls += 1;
          return page.screenshot({ style: HIDE });
        },
        MASK_COLOR,
      ),
    ).rejects.toThrow(/frame 1 is painted/);
    expect(calls).toBe(MAX_CAPTURE_ATTEMPTS);
  });

  test("a painted frame is kept on the first attempt (the control)", async ({ page }) => {
    await page.setContent(PAGE);
    await settleFrames(page);
    const { attempts } = await captureWithPaintedFrames(page, () => page.screenshot(), MASK_COLOR);
    expect(attempts).toBe(1);
  });
});
