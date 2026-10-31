// Negative-test personas see nothing (V13-QA-002; DEPENDENCIES decision 10, ARCH ruling on the Epsilon pin).
// Secretary Epsilon (membership expired 2026-06-30) and Persona Zeta (inactive persona) are never refused by the
// session layer; the database decides, and it must decide "nothing". With a minted session each one gets an empty
// portfolio with an authorised count of 0, no task on My Work, and the same 404 as an unknown case for every seeded
// case on every Case Workspace tab. The Case Context Sentinel runs with an empty visible set, so any case id or
// display number on a page or in a payload is a violation. Needs the database-backed e2e app (#36). SYNTHETIC only.
import { expect, test, type Page } from "@playwright/test";
import { formatViolations, inspectCaseContext, recordPayloads } from "../sentinel/sentinel";
import { mintSession } from "../fixtures/personas";

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
      for (const name of ["overdue", "due-week", "open"]) {
        const count = page.getByTestId(`count-my-work-${name}`);
        if ((await count.count()) > 0) await expect(count).toHaveAttribute("data-count", "0");
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
          await expect(page.getByTestId("case-workspace")).toHaveCount(0);
          const html = await page.content();
          for (const m of SEEDED) expect(html, `${n}${tab}`).not.toContain(caseRef(m));
          await expectNoCaseContext(page);
        }
      }
    });
  });
}
