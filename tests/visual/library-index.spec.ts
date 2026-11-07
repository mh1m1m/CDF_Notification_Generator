// The screenshot library's plan, index and data check, without the app (V13-QA-014; REQ-VIS-005, -011, -015;
// docs/qa/M1_OPEN_QA_ROWS_DESIGN.md §2–§4). Runs in every e2e run (desktop-ar), not only in the library job:
//   - docs/qa/SCREENSHOT_LIBRARY.md is exactly what library-plan.ts generates (never hand-edited; regenerate locally
//     with V13_E2E_VISUAL=index, never in CI);
//   - the plan is well formed: one row per screen and state, real synthetic personas, seeded case routes only;
//   - the data check (V1–V5) refuses each planted fault and passes a clean synthetic page;
//   - an empty frame in a capture is retaken at most MAX_CAPTURE_ATTEMPTS times, then fails (frames.ts).
import { readFileSync, writeFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { PERSONAS } from "@/lib/contracts";
import { captureCell } from "./capture";
import { checkSynthetic, SYNTHETIC_PERSONA_NAMES } from "./data-check";
import { captureWithPaintedFrames, MAX_CAPTURE_ATTEMPTS, settleFrames } from "./frames";
import {
  BASELINE_ROWS,
  BASELINE_VIEWPORTS,
  baselineCount,
  captureStyle,
  baselineFile,
  CAPTURES,
  imageCount,
  LANGUAGES,
  MASK_COLOR,
  MASKS,
  NOT_APPLICABLE,
  renderIndex,
  VIEWPORTS,
  withDraft,
  type Capture,
} from "./library-plan";
import { maskCoverage, type LibraryEntry } from "./library-teardown";
import { probeMasks } from "./mask-probe";

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

  test("the baseline subset (V13-QA-015): each data screen and the switcher, unique dash-only names, about 30 images", () => {
    expect(BASELINE_ROWS.map((c) => c.screen)).toEqual(
      CAPTURES.filter((c) => c.state === "data" && c.screen !== "mobile-navigation").map((c) => c.screen),
    );
    expect(BASELINE_ROWS.map((c) => c.screen)).toContain("workspace-switcher");
    const names = BASELINE_ROWS.flatMap((c) =>
      LANGUAGES.flatMap((l) => BASELINE_VIEWPORTS.map((v) => baselineFile(c, l, v))),
    );
    expect(new Set(names).size).toBe(names.length);
    // Playwright turns a dot before the extension into a dash: the name must already be the file's own
    for (const n of names) expect(n).toMatch(/^[a-z0-9-]+\.png$/);
    expect(names.length).toBe(baselineCount());
    expect(baselineCount()).toBeGreaterThanOrEqual(30);
    expect(baselineCount()).toBeLessThanOrEqual(40);
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

test.describe("mask width probe (V13-QA-023): the capture style holds every mask's box, and the probe can fail", () => {
  // Each captured mask needs a width rule in the capture style: a rule whose selector begins with each part of the
  // mask's selector (a descendant of the masked box counts, as for the count tile's value) and sets inline-size.
  test("every mask a captured row names has a width rule in the capture style", () => {
    const DRAFT = "0d000000-0000-4000-8000-0000000000aa";
    const rules = captureStyle(DRAFT)
      .split("}")
      .map((r) => r.split("{"))
      .filter((r) => r.length === 2)
      .map(([sel, decl]) => ({ selectors: sel!.split(",").map((x) => x.trim()), decl: decl! }));
    const named = new Set(CAPTURES.flatMap((c) => c.masks));
    expect(named.size).toBeGreaterThan(0);
    for (const mask of named) {
      for (const part of withDraft(MASKS[mask].selector, DRAFT)
        .split(",")
        .map((x) => x.trim())) {
        const covered = rules.some(
          (r) =>
            /inline-size\s*:/.test(r.decl) && r.selectors.some((s) => s === part || s.startsWith(`${part} `)),
        );
        expect(covered, `mask ${mask}: "${part}" has a width rule in the capture style`).toBe(true);
      }
    }
  });

  // A page shaped like the app's: a table whose middle cell holds a deadline, two count tiles, and a sandboxed srcdoc
  // frame with a notice reference followed by more text. Without a width rule, each mask's text moves what follows it.
  const FRAME = [
    "<p style='font:16px sans-serif'>Reference <bdi dir='ltr' data-field='notice_reference'>NTF-DEMO-0A1B2C3D</bdi>",
    " for Witness Gamma, CDF-DEMO-2026-0001.</p>",
  ].join("");
  const PAGE = `<!doctype html><html lang="en"><head><style>
      nav a { display: inline-flex; flex-direction: column; padding: 4px; border: 1px solid #333; }
      nav a > :first-child { font: 700 24px sans-serif; }
    </style></head><body style="margin:0;background:#fff;font:16px sans-serif">
    <nav><a data-testid="count-my-work-overdue" href="#"><span>3</span><span>Late</span></a>
      <a data-testid="count-my-work-due-week" href="#"><span>4</span><span>Week</span></a>
      <a data-testid="count-my-work-open" href="#"><span>7</span><span>Open</span></a></nav>
    <table><tr><td>Collect documents</td>
      <td><span class="v13-deadline v13-deadline-upcoming" data-testid="deadline" data-deadline-state="upcoming"><time dateTime="2026-11-10">10 November 2026</time><span>In 3 days</span></span></td>
      <td>Open</td></tr></table>
    <iframe data-testid="case-notification-preview-frame" sandbox="" style="inline-size:600px;block-size:120px;border:0"
      srcdoc="${FRAME}"></iframe>
  </body></html>`;
  const ROW: Capture = {
    screen: "my-work",
    state: "data",
    persona: "investigator-beta",
    route: "/fixture",
    ready: "table",
    masks: ["deadline", "deadlineCounts", "noticeReference"],
    how: "planted fixture page (library-index.spec.ts)",
  };

  async function probe(page: Page, style?: string) {
    await page.setContent(PAGE);
    await settleFrames(page);
    const { png } = await captureCell(page, ROW, null, { style });
    return probeMasks(page, ROW, null, "en", png, { style });
  }

  test("with the capture style, every mask is rewritten and no image moves (the control)", async ({
    page,
  }) => {
    const result = await probe(page);
    for (const mask of ROW.masks) {
      expect(result.masks[mask]!.matched, `${mask} matched`).toBeGreaterThan(0);
      expect(result.masks[mask]!.rewritten, `${mask} rewritten`).toBe(result.masks[mask]!.matched);
    }
    expect(result.variants.length).toBe(5);
    expect(result.variants.filter((v) => !v.identical).map((v) => v.name)).toEqual([]);
  });

  // The real capture path with one mask's width rules taken out of the real capture style: the probe must see a move.
  for (const mask of ["deadline", "deadlineCounts", "noticeReference"] as const) {
    test(`without the ${mask} width rule the probe fails (planted)`, async ({ page }) => {
      const parts = MASKS[mask].selector.split(",").map((x) => x.trim());
      const style = captureStyle(null)
        .split("}")
        .filter((r) => r.trim() !== "" && !parts.some((p) => r.trim().startsWith(p)))
        .map((r) => `${r}}`)
        .join("");
      expect(style.length, "the rule was taken out").toBeLessThan(captureStyle(null).length);
      const result = await probe(page, style);
      expect(
        result.variants.some((v) => !v.identical),
        `the probe sees ${mask} move without its rule`,
      ).toBe(true);
    });
  }
});

test.describe("mask width probe (V13-QA-023): the library run fails when a mask matched nothing", () => {
  const entry = (counts: Record<string, [number, number]>): LibraryEntry => ({
    file: "planted.png",
    maskProbe: {
      masks: Object.fromEntries(
        Object.entries(counts).map(([m, [matched, rewritten]]) => [m, { matched, rewritten }]),
      ),
    },
  });
  const all = (n: number) =>
    Object.fromEntries(Object.keys(MASKS).map((m) => [m, [n, n] as [number, number]]));

  test("every mask matched and rewritten passes (the control)", () => {
    expect(() => maskCoverage([entry(all(1)), entry(all(0))], 2)).not.toThrow();
  });
  test("a mask that matched nothing in any cell fails (planted)", () => {
    expect(() => maskCoverage([entry({ ...all(1), correlationId: [0, 0] })], 1)).toThrow(
      /correlationId matched no element/,
    );
  });
  test("a matched element that was not rewritten fails (planted)", () => {
    expect(() => maskCoverage([entry({ ...all(2), deadline: [2, 1] })], 1)).toThrow(
      /deadline matched 2 elements but rewrote 1/,
    );
  });
});
