// Scenario A — case switching and context restore (V13-QA-002; TEST_ARCHITECTURE.md §6, UXQA-03).
// Investigator Beta (INVESTIGATIONS) opens case 0001 from the portfolio, changes tab, switches to case 0002 through the
// portfolio, goes back twice, goes forward, and reloads. After every step the page shows exactly one case, the one in
// the URL, on the tab in the URL; the Case Context Sentinel and the Truth Inspector (database oracle) are clean, and
// no browser storage holds a case id or reference. Visibility comes from the database in Beta's own security context
// and is first pinned to DATA_MODEL.md §5, so an empty read can never make the scenario pass. SYNTHETIC data only.
import { expect, test } from "@playwright/test";
import { databaseEventOracle, scenarioDb, visibleCases, type ScenarioDb } from "../fixtures/db";
import { signInAs } from "../fixtures/personas";
import {
  caseId,
  casePath,
  expectCaseShown,
  expectNoCaseInStorage,
  SEEDED_CASE_IDS,
} from "../fixtures/scenario";
import { formatViolations, inspectCaseContext, recordPayloads } from "../sentinel/sentinel";

const BETA = "investigator-beta";
const WS = "INVESTIGATIONS" as const;
const BETA_SEES = ["01", "02", "03", "05", "06", "09", "10"].map(caseId);
const ONE = caseId("01");
const TWO = caseId("02");

let db: ScenarioDb;
test.beforeAll(() => {
  db = scenarioDb();
});
test.afterAll(async () => {
  await db?.end();
});

test("Scenario A — open, change tab, switch through the portfolio, back, forward, reload", async ({
  page,
}) => {
  const cases = await visibleCases(db, BETA, WS);
  expect([...cases.keys()].sort(), "Beta's visible cases (DATA_MODEL §5)").toEqual(BETA_SEES);
  const visible = new Map([...cases].map(([id, c]) => [id, c.ref]));
  const oracle = databaseEventOracle(db, BETA, WS);

  await signInAs(page, BETA);
  // Recording starts after sign-in: the sign-in POST carries no case and its body is gone once the page moves on.
  const payloads = recordPayloads(page, new URL(test.info().project.use.baseURL!).origin);
  await page.goto("/portfolio");
  await expect(page.locator('[data-testid^="portfolio-row-"]')).toHaveCount(visible.size);
  const pv0 = await inspectCaseContext(page, { visible });
  expect(pv0, formatViolations(pv0)).toEqual([]);

  // 1. Open case 0001 from the portfolio.
  await page.getByTestId(`portfolio-open-${ONE}`).click();
  await expectCaseShown(page, ONE, "overview", visible, oracle);
  await expectNoCaseInStorage(page);

  // 2. Change tab.
  await page.getByTestId("case-tab-tasks").click();
  await expectCaseShown(page, ONE, "tasks", visible, oracle);
  await expectNoCaseInStorage(page);

  // 3. Switch to case 0002 through the portfolio.
  await page.getByTestId("case-crumb-portfolio").click();
  await expect(page).toHaveURL(/\/portfolio$/);
  await expect(page.getByTestId("case-workspace")).toHaveCount(0);
  await page.getByTestId(`portfolio-open-${TWO}`).click();
  await expectCaseShown(page, TWO, "overview", visible, oracle);
  await page.getByTestId("case-tab-events").click();
  await expectCaseShown(page, TWO, "events", visible, oracle);
  await expectNoCaseInStorage(page);

  // 4. Browser back: 0002 overview, the portfolio, then 0001 on the tasks tab, never a mix.
  await page.goBack();
  await expectCaseShown(page, TWO, "overview", visible, oracle);
  await page.goBack();
  await expect(page).toHaveURL(/\/portfolio$/);
  await expect(page.getByTestId("case-workspace")).toHaveCount(0);
  await page.goBack();
  await expectCaseShown(page, ONE, "tasks", visible, oracle);

  // 5. Reload restores the same case and tab from the URL alone.
  await page.reload();
  await expectCaseShown(page, ONE, "tasks", visible, oracle);

  // 6. Forward twice lands on 0002 again, also after a reload.
  await page.goForward();
  await expect(page).toHaveURL(/\/portfolio$/);
  await page.goForward();
  await expectCaseShown(page, TWO, "overview", visible, oracle);
  await page.reload();
  await expectCaseShown(page, TWO, "overview", visible, oracle);
  await expectNoCaseInStorage(page);

  const pv = await payloads.violations({
    caseIds: new Set(visible.keys()),
    caseRefs: new Set(visible.values()),
    knownCaseIds: SEEDED_CASE_IDS,
  });
  expect((await payloads.summary()).unreadable).toBe(0);
  expect(pv, formatViolations(pv)).toEqual([]);
});

test("Scenario A — a case URL opened directly shows that case on that tab, on every tab", async ({
  page,
}) => {
  const cases = await visibleCases(db, BETA, WS);
  const visible = new Map([...cases].map(([id, c]) => [id, c.ref]));
  const oracle = databaseEventOracle(db, BETA, WS);
  await signInAs(page, BETA);
  for (const id of [ONE, TWO]) {
    for (const tab of ["overview", "events", "tasks", "notifications"] as const) {
      expect((await page.goto(casePath(id, tab)))?.status(), `${id} ${tab}`).toBe(200);
      await expectCaseShown(page, id, tab, visible, oracle);
    }
  }
  await expectNoCaseInStorage(page);
});
