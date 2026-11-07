// Accessibility sweep (V13-QA-026; QA-018 findings F-02 and F-03; REQ-A11Y-014). axe-core with every WCAG 2.0, 2.1 and
// 2.2 A/AA tag (wcag22aa adds target size), every impact, on each screen S01–S12 of docs/qa/A11Y_MANUAL_CHECKLIST.md,
// in Arabic and English, light and dark. A violation of any impact fails the test and is attached for the PR quality
// report. The smoke spec (serious and critical, S01 and S02) and the not-found spec stay as they are.
//
// What axe cannot see here, and where it is covered instead:
//   - S08's sandboxed preview frame: scripts are not allowed in it, so axe cannot be injected (it waits forever). The
//     frame is excluded; the plain-text version and the page around it are scanned. The notice HTML is checked by
//     tests/unit/notifications/a11y.spec.ts (A11Y-01 … A11Y-11) and by the manual rows of S08.
//   - Contrast over a background image or gradient: axe returns it as "incomplete", not as a violation; M-18 covers it.
//   - Contrast of Arabic-script text: axe-core 4.14.0 does not test it at all. Its color-contrast rule skips a text
//     node that its icon-ligature check (a canvas width comparison) takes for an icon font, and joined Arabic letters
//     pass for ligatures. That is why QA-018's probe found F-01 in English only. Colours come from the same tokens in
//     both languages, so the English scans of each screen stand for its contrast; UT pins the token pairs and M-18
//     is the manual check. The last planted test pins this, so a new axe that tests Arabic shows up here.
// Chromium only (tests/fixtures/browsers.ts CHROMIUM_ONLY): in Firefox and WebKit the planted tests fail, so there the
// sweep could pass without seeing a fault.
// Run after `pnpm db:reset`. SYNTHETIC personas and cases only.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { LOCALE_COOKIE } from "@/lib/i18n";
import { signInAs } from "../fixtures/personas";
import { caseId } from "../fixtures/scenario";
import { makeWitnessDraft } from "../visual/capture";

/** Every WCAG A and AA tag axe-core 4.14.0 has (2.2 adds only wcag22aa: target-size). */
const SWEEP_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

/** The PR quality report (tests/report/pr-report.mjs, V13-QA-017) reads this attachment for its axe section. */
const A11Y_ATTACHMENT = "a11y-violations";

const PREVIEW_FRAME = '[data-testid="case-notification-preview-frame"]';

interface Violation {
  rule: string;
  impact: string;
  page: string;
  nodes: number;
  targets: string[];
}

/** One axe scan of the page as it is now, every impact. `exclude` takes out a part axe cannot enter. */
async function scan(page: Page, exclude?: string): Promise<Violation[]> {
  // OI-028: a scan starts only once the document has a title (see smoke.a11y.spec.ts).
  await expect(page, "the document has a non-empty <title> before the scan").toHaveTitle(/\S/);
  let builder = new AxeBuilder({ page }).withTags(SWEEP_TAGS);
  if (exclude) builder = builder.exclude(exclude);
  const results = await builder.analyze();
  return results.violations.map((v) => ({
    rule: v.id,
    impact: v.impact ?? "unknown",
    page: new URL(page.url()).pathname,
    nodes: v.nodes.length,
    targets: v.nodes.slice(0, 5).map((n) => n.target.join(" ")),
  }));
}

/** Attaches what the scans found and fails on any violation, with the rule, impact and nodes named. */
async function expectClean(found: Violation[]) {
  if (found.length)
    await test.info().attach(A11Y_ATTACHMENT, {
      contentType: "application/json",
      body: JSON.stringify(found.map(({ rule, impact, page, nodes }) => ({ rule, impact, page, nodes }))),
    });
  expect(
    found,
    found.map((v) => `${v.rule} (${v.impact}) on ${v.page}: ${v.targets.join(", ")}`).join("\n"),
  ).toEqual([]);
}

/** Goes to `path` and checks the response status. */
async function visit(page: Page, path: string, status = 200) {
  const res = await page.goto(path);
  expect(res?.status(), path).toBe(status);
}

const case01 = caseId("01");

/** [screen id, persona (null: signed out), what to open and scan]. Screen ids are the checklist's. */
const SCREENS: [string, string | null, (page: Page) => Promise<Violation[]>][] = [
  [
    "S01 sign-in",
    null,
    async (page) => {
      await visit(page, "/sign-in");
      return scan(page);
    },
  ],
  [
    "S02 My Work",
    "investigator-beta",
    async (page) => {
      await visit(page, "/my-work");
      return scan(page);
    },
  ],
  [
    "S03 Case Portfolio",
    "secretary-alpha",
    async (page) => {
      await visit(page, "/portfolio");
      return scan(page);
    },
  ],
  [
    "S04 case overview",
    "investigator-beta",
    async (page) => {
      // Investigator Beta holds a task on 0001, so the "mine" flag (F-01) is on the page.
      await visit(page, `/cases/${case01}`);
      await expect(page.getByTestId("case-task-mine").first()).toBeVisible();
      return scan(page);
    },
  ],
  [
    "S05 case events",
    "secretary-alpha",
    async (page) => {
      await visit(page, `/cases/${case01}/events`);
      return scan(page);
    },
  ],
  [
    "S06 case tasks",
    "investigator-beta",
    async (page) => {
      await visit(page, `/cases/${case01}/tasks`);
      await expect(page.getByTestId("case-task-mine").first()).toBeVisible();
      return scan(page);
    },
  ],
  [
    "S07 case notifications and draft form",
    "secretary-alpha",
    async (page) => {
      await visit(page, `/cases/${case01}/notifications`);
      await expect(page.getByTestId("draft-form")).toBeVisible();
      return scan(page);
    },
  ],
  [
    "S08 notification preview",
    "investigator-beta",
    async (page) => {
      const id = await makeWitnessDraft(page, caseId("05"));
      await visit(page, `/cases/${caseId("05")}/notifications?n=${id}`);
      await expect(page.getByTestId("case-preview-ready")).toBeVisible();
      return scan(page, PREVIEW_FRAME);
    },
  ],
  [
    "S09 Notification Center",
    "secretary-alpha",
    async (page) => {
      await visit(page, "/notifications");
      return scan(page);
    },
  ],
  [
    "S10 workspace switcher",
    "governance-officer-delta",
    async (page) => {
      await visit(page, "/workspaces");
      const page1 = await scan(page);
      await page.getByTestId("workspace-switcher").click();
      await expect(page.getByTestId("workspace-menu-option-SECRETARIAT")).toBeVisible();
      return [...page1, ...(await scan(page))];
    },
  ],
  [
    "S11 side navigation at 360 px",
    "secretary-alpha",
    async (page) => {
      await page.setViewportSize({ width: 360, height: 740 });
      await visit(page, "/my-work");
      await expect(page.locator('a[data-testid^="nav-"]').first()).toBeVisible();
      return scan(page);
    },
  ],
  [
    "S12 not found",
    "secretary-alpha",
    async (page) => {
      await visit(page, "/no-such-route", 404);
      const route = await scan(page);
      // Case 0005 is outside Secretary Alpha's cases: answered exactly like an unknown id.
      await visit(page, `/cases/${caseId("05")}`, 404);
      return [...route, ...(await scan(page))];
    },
  ],
];

for (const scheme of ["light", "dark"] as const)
  for (const locale of ["ar", "en"] as const)
    test.describe(`axe sweep, ${locale}, ${scheme}`, () => {
      test.use({ colorScheme: scheme });
      test.beforeEach(async ({ context, baseURL }) => {
        await context.addCookies([{ name: LOCALE_COOKIE, value: locale, url: baseURL! }]);
      });

      for (const [screen, persona, open] of SCREENS)
        test(screen, async ({ page }) => {
          if (persona) await signInAs(page, persona);
          const found = await open(page);
          await expect(page.locator("html")).toHaveAttribute("lang", locale);
          expect(
            await page.evaluate(() => matchMedia("(prefers-color-scheme: dark)").matches),
            "the page sees the theme under test",
          ).toBe(scheme === "dark");
          await expectClean(found);
        });
    });

test.describe("the sweep sees each kind of fault (planted into a real page)", () => {
  test.use({ colorScheme: "dark" });

  const plants: [string, string, (doc: Document) => void][] = [
    [
      "low-contrast text (any impact, dark theme)",
      "color-contrast",
      (doc) => {
        const p = doc.createElement("p");
        Object.assign(p.style, { color: "#2a2f36", backgroundColor: "#303841" });
        p.textContent = "Witness Gamma — synthetic";
        doc.querySelector("main")!.append(p);
      },
    ],
    [
      "a 10 px target next to another (WCAG 2.2, wcag22aa)",
      "target-size",
      (doc) => {
        const wrap = doc.createElement("div");
        for (const label of ["a", "b"]) {
          const b = doc.createElement("button");
          Object.assign(b.style, { inlineSize: "10px", blockSize: "10px", padding: "0", margin: "0" });
          b.setAttribute("aria-label", `synthetic ${label}`);
          wrap.append(b);
        }
        doc.querySelector("main")!.append(wrap);
      },
    ],
    [
      "a deprecated ARIA role (minor impact counts too)",
      "aria-deprecated-role",
      (doc) => {
        const list = doc.createElement("div");
        list.setAttribute("role", "directory");
        list.textContent = "synthetic directory";
        doc.querySelector("main")!.append(list);
      },
    ],
  ];

  for (const [what, rule, plant] of plants)
    test(`${rule}: ${what}`, async ({ page }) => {
      await signInAs(page, "secretary-alpha");
      await visit(page, "/my-work");
      expect(await scan(page), "the page is clean before the plant").toEqual([]);
      await page.evaluate(`(${plant.toString()})(document)`);
      expect((await scan(page)).map((v) => v.rule)).toContain(rule);
    });

  test("color-contrast does not test Arabic-script text (axe-core 4.14.0); Latin text on the same page it does", async ({
    page,
  }) => {
    await signInAs(page, "secretary-alpha");
    await visit(page, "/my-work");
    const plant = (text: string, id: string) =>
      page.evaluate(
        ({ text, id }) => {
          const p = document.createElement("p");
          Object.assign(p.style, { color: "#2a2f36", backgroundColor: "#303841" });
          p.id = id;
          p.textContent = text;
          document.querySelector("main")!.append(p);
        },
        { text, id },
      );
    await plant("مسندة إليك", "zz-arabic");
    await plant("Assigned to you", "zz-latin");
    const contrast = (await scan(page)).filter((v) => v.rule === "color-contrast").flatMap((v) => v.targets);
    expect(contrast).toContain("#zz-latin");
    expect(contrast, "axe now tests Arabic text: update the sweep's header and the audit").not.toContain(
      "#zz-arabic",
    );
  });

  test("the preview frame is the only part left out of S08", async ({ page }) => {
    await signInAs(page, "investigator-beta");
    const id = await makeWitnessDraft(page, caseId("05"));
    await visit(page, `/cases/${caseId("05")}/notifications?n=${id}`);
    await expect(page.getByTestId("case-preview-ready")).toBeVisible();
    await expect(page.locator(PREVIEW_FRAME)).toHaveCount(1);
    // A fault planted beside the frame is still found.
    await page.evaluate(() => {
      const p = document.createElement("p");
      Object.assign(p.style, { color: "#2a2f36", backgroundColor: "#303841" });
      p.textContent = "synthetic";
      document.querySelector('[data-testid="case-preview-ready"]')!.append(p);
    });
    expect((await scan(page, PREVIEW_FRAME)).map((v) => v.rule)).toContain("color-contrast");
  });
});
