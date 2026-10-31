// Negative-test personas see nothing (V13-QA-002; DEPENDENCIES decision 10, ARCH ruling on the Epsilon pin).
// Secretary Epsilon (membership expired 2026-06-30) and Persona Zeta (inactive persona) are never refused by the
// session layer; the database decides, and it must decide "nothing". With a minted session each one gets an empty
// portfolio with an authorised count of 0, no task on My Work, and the same 404 as an unknown case for every seeded
// case on every Case Workspace tab. The Case Context Sentinel runs with an empty visible set, so any case id or
// display number on a page or in a payload is a violation. Needs the database-backed e2e app (#36). SYNTHETIC only.
import { expect, test, type Page } from "@playwright/test";
import { formatViolations, inspectCaseContext, recordPayloads } from "../sentinel/sentinel";
import { mintSession, signInAs } from "../fixtures/personas";

const SEEDED = Array.from({ length: 10 }, (_, i) => String(i + 1).padStart(2, "0"));
const caseId = (n: string) => `0c000000-0000-4000-8000-0000000000${n}`;
const caseRef = (n: string) => `CDF-DEMO-2026-00${n}`;
const NOTHING = new Map<string, string>();
const TABS = ["", "/events", "/tasks", "/notifications"];

async function expectNoCaseContext(page: Page) {
  await expect(page.locator("[data-case-id]")).toHaveCount(0);
  const v = await inspectCaseContext(page, { visible: NOTHING });
  expect(v, formatViolations(v)).toEqual([]);
}

for (const slug of ["secretary-epsilon", "persona-zeta"]) {
  test.describe(`${slug} (minted session)`, () => {
    test.beforeEach(async ({ context }) => {
      test.skip(
        !process.env.V13_E2E_SESSION_SECRET,
        "needs the run's session secret (locally started build)",
      );
      await mintSession(context, test.info().project.use.baseURL!, slug, "SECRETARIAT");
    });

    test("portfolio is empty and its authorised count is 0, also when searching a seeded case", async ({
      page,
    }) => {
      const payloads = recordPayloads(page, new URL(test.info().project.use.baseURL!).origin);
      for (const path of ["/portfolio", "/portfolio?q=2026-0001", "/portfolio?mine=1"]) {
        const res = await page.goto(path);
        expect(res?.status(), path).toBe(200);
        await expect(page.getByTestId("portfolio-page")).toBeVisible();
        await expect(page.locator('[data-testid^="portfolio-row-"]')).toHaveCount(0);
        await expect(page.getByTestId("count-portfolio-results")).toHaveAttribute("data-count", "0");
        const total = page.getByTestId("count-portfolio-total");
        if ((await total.count()) > 0) await expect(total).toHaveAttribute("data-count", "0");
        await expectNoCaseContext(page);
      }
      const pv = await payloads.violations({
        caseIds: new Set(),
        caseRefs: new Set(),
        knownCaseIds: new Set(SEEDED.map(caseId)),
      });
      expect((await payloads.summary()).unreadable).toBe(0);
      expect(pv, formatViolations(pv)).toEqual([]);
    });

    test("My Work lists no task and counts none", async ({ page }) => {
      expect((await page.goto("/my-work"))?.status()).toBe(200);
      await expect(page.locator('[data-testid^="my-work-row-"]')).toHaveCount(0);
      // FE-005 (#32) renders the strip for every persona, so it must be there and read 0.
      for (const name of ["overdue", "due-week", "open"]) {
        await expect(page.getByTestId(`count-my-work-${name}`)).toHaveAttribute("data-count", "0");
      }
      await expectNoCaseContext(page);
    });

    test("every seeded case answers 404 on every Case Workspace tab, like an unknown case", async ({
      page,
    }) => {
      for (const n of [...SEEDED, "99"]) {
        for (const tab of TABS) {
          const res = await page.goto(`/cases/${caseId(n)}${tab}`);
          expect(res?.status(), `${n}${tab}`).toBe(404);
          await expect(page.getByTestId("not-found-state")).toBeVisible();
          await expect(page.getByTestId("case-workspace")).toHaveCount(0);
          const html = await page.content();
          for (const m of SEEDED) expect(html, `${n}${tab}`).not.toContain(caseRef(m));
          await expectNoCaseContext(page);
        }
      }
    });
  });
}

// Positive control (ARCH, review of #43): the same paths and the same assertions' targets, for a persona who does see
// cases. Secretary Alpha (SECRETARIAT) sees 0001, 0003, 0004, 0006, 0007, 0008 and 0010 (DATA_MODEL §5) and has 7
// open tasks. If these paths stopped rendering cases at all, the pin above would pass for the wrong reason; this
// control fails instead.
const ALPHA_VISIBLE = ["01", "03", "04", "06", "07", "08", "10"];

test.describe("positive control: secretary-alpha on the pinned paths", () => {
  test.beforeEach(async ({ page }) => {
    await signInAs(page, "secretary-alpha");
  });

  test("portfolio lists Alpha's 7 cases with an authorised count of 7", async ({ page }) => {
    await page.goto("/portfolio");
    const rows = await page
      .locator('[data-testid^="portfolio-row-"]')
      .evaluateAll((els) => els.map((e) => e.getAttribute("data-case-id")));
    expect(rows.sort()).toEqual(ALPHA_VISIBLE.map(caseId).sort());
    await expect(page.getByTestId("count-portfolio-results")).toHaveAttribute("data-count", "7");
    await expect(page.getByTestId("count-portfolio-total")).toHaveAttribute("data-count", "7");
  });

  test("My Work lists Alpha's 7 open tasks and the strip counts them", async ({ page }) => {
    await page.goto("/my-work");
    await expect(page.locator('[data-testid^="my-work-row-"]')).toHaveCount(7);
    await expect(page.getByTestId("count-my-work-open")).toHaveAttribute("data-count", "7");
  });

  test("a visible case renders on every tab; a hidden one answers 404 like for the pinned personas", async ({
    page,
  }) => {
    for (const tab of TABS) {
      expect((await page.goto(`/cases/${caseId("01")}${tab}`))?.status(), `01${tab}`).toBe(200);
      await expect(page.getByTestId("case-workspace")).toHaveAttribute("data-case-id", caseId("01"));
      expect((await page.goto(`/cases/${caseId("02")}${tab}`))?.status(), `02${tab}`).toBe(404);
      await expect(page.getByTestId("not-found-state")).toBeVisible();
    }
  });
});
