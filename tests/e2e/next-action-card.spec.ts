// Next Action Card in the browser (V13-QA-020; V13-FE-015, PROC-026 nextActionForCase; SCREENS S3). FE's unit tests
// pin the wiring; this suite pins what a person sees, in Arabic and English at 320 px:
//   - the card shows for a persona with an own open task, names one of those tasks, and its link opens that task's row
//     on the overview (the row becomes :target);
//   - nothing at all renders for NONE (no card, no heading);
//   - on another page of the own-tasks list the card still shows the first page's task, and its link leads back to
//     the first page (ARCH ruling on FE-015).
// The oracle is the database function the overview reads, case_my_open_tasks_page (DB-022), called read-only in the
// persona's own security context (tests/fixtures/db.ts). The seed holds at most two own open tasks per case, fewer
// than a page (25), so "another page" is the page after the first task: its cursor is the first row's position as the
// app encodes it, and the database accepts it only for that row in that case. SYNTHETIC seed data only.
import { expect, test, type Page } from "@playwright/test";
import { encodeCaseListCursor } from "@/lib/adapters/case-list/cursor";
import { LOCALE_COOKIE } from "@/lib/i18n";
import { scenarioDb, visibleCases, type ScenarioDb } from "../fixtures/db";
import { signInAs } from "../fixtures/personas";

const BETA = "investigator-beta";
const WS = "INVESTIGATIONS" as const;
const LOCALES = ["ar", "en"] as const;
const NARROW = { width: 320, height: 800 };

interface OwnTask {
  id: string;
  task_code: string;
  page_cursor: string;
}

let db: ScenarioDb;
test.beforeAll(() => {
  db = scenarioDb();
});
test.afterAll(async () => {
  await db.end();
});

/** The first page of the persona's own open tasks on the case, exactly as the overview reads it. */
async function ownOpenTasks(caseId: string): Promise<OwnTask[]> {
  return db.asPersona(
    BETA,
    WS,
    (tx) => tx<OwnTask[]>`
      select id::text as id, task_code, page_cursor
        from cdf_notifications_v13.case_my_open_tasks_page(${caseId}::uuid)`,
  );
}

/** Beta's visible cases with their own open tasks (first page). */
async function casesWithOwnTasks(): Promise<{ id: string; tasks: OwnTask[] }[]> {
  const cases = await visibleCases(db, BETA, WS);
  return Promise.all(
    [...cases.values()]
      .filter((c) => c.records_state === "ACTIVE")
      .map(async (c) => ({ id: c.id, tasks: await ownOpenTasks(c.id) })),
  );
}

/** The page does not scroll sideways at 320 px (WCAG 1.4.10 reflow). */
async function expectNoSidewaysScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, "no horizontal scrolling at 320 px").toBeLessThanOrEqual(0);
}

const isTarget = (page: Page, taskId: string) =>
  page.locator(`[id="task-${taskId}"]`).evaluate((el) => el.matches(":target"));

for (const locale of LOCALES) {
  test.describe(`Next Action Card (${locale}, 320 px)`, () => {
    test.beforeEach(async ({ page, context, baseURL }) => {
      await page.setViewportSize(NARROW);
      await signInAs(page, BETA);
      await context.addCookies([{ name: LOCALE_COOKIE, value: locale, url: baseURL! }]);
    });

    test("shows one of the persona's own open tasks, and its link opens that row as :target", async ({
      page,
    }) => {
      const withTasks = (await casesWithOwnTasks()).filter((c) => c.tasks.length > 0);
      expect(withTasks.length, "Beta has an own open task on some active case").toBeGreaterThan(0);
      for (const c of withTasks) {
        await page.goto(`/cases/${c.id}`);
        await expect(page.locator("html")).toHaveAttribute("lang", locale);
        const card = page.getByTestId("next-action-card");
        await expect(card).toHaveCount(1);
        const taskId = await card.getAttribute("data-task-id");
        expect(
          c.tasks.map((t) => t.id),
          `the card names an own open task of ${c.id}`,
        ).toContain(taskId);
        await expect(card).toHaveAttribute("data-task-code", c.tasks.find((t) => t.id === taskId)!.task_code);
        const link = page.getByTestId("next-action-link");
        await expect(link).toHaveAttribute("href", `/cases/${c.id}#task-${taskId}`);
        await expectNoSidewaysScroll(page);

        await link.click();
        await expect(page).toHaveURL(new RegExp(`/cases/${c.id}#task-${taskId}$`));
        await expect(page.getByTestId("case-my-tasks").locator(`[id="task-${taskId}"]`)).toBeVisible();
        expect(await isTarget(page, taskId!), "the task's row is the :target").toBe(true);
      }
    });

    test("NONE renders nothing: no card and no heading", async ({ page }) => {
      const none = (await casesWithOwnTasks()).filter((c) => c.tasks.length === 0);
      expect(none.length, "Beta sees an active case with no own open task").toBeGreaterThan(0);
      for (const c of none) {
        await page.goto(`/cases/${c.id}`);
        await expect(page.getByTestId("case-overview")).toBeVisible();
        await expect(page.getByTestId("next-action-card")).toHaveCount(0);
        await expect(page.locator("#next-action-heading")).toHaveCount(0);
        await expect(page.getByTestId("next-action-link")).toHaveCount(0);
      }
    });

    test("another page keeps the first page's task, and its link leads to page 1", async ({ page }) => {
      const two = (await casesWithOwnTasks()).find((c) => c.tasks.length >= 2);
      expect(two, "Beta has two own open tasks on one active case").toBeDefined();
      const { id, tasks } = two!;

      await page.goto(`/cases/${id}`);
      const firstPageTask = await page.getByTestId("next-action-card").getAttribute("data-task-id");
      expect(firstPageTask).toBeTruthy();

      // The page after the first row: the cursor the app itself would write for that row.
      const after = encodeCaseListCursor("myOpenTasks", { at: tasks[0]!.page_cursor, id: tasks[0]!.id });
      await page.goto(`/cases/${id}?after=${after}`);
      const rows = page.getByTestId("case-my-tasks").locator('[id^="task-"]');
      await expect(rows).toHaveCount(tasks.length - 1);
      await expect(page.getByTestId("case-my-tasks").locator(`[id="task-${tasks[0]!.id}"]`)).toHaveCount(0);
      await expect(page.getByTestId("case-my-tasks-prev")).toBeVisible();

      const card = page.getByTestId("next-action-card");
      await expect(card).toHaveAttribute("data-task-id", firstPageTask!);
      const link = page.getByTestId("next-action-link");
      await expect(link).toHaveAttribute("href", `/cases/${id}#task-${firstPageTask}`);
      await expectNoSidewaysScroll(page);

      await link.click();
      await expect(page).toHaveURL(new RegExp(`/cases/${id}#task-${firstPageTask}$`));
      await expect(page.getByTestId("case-my-tasks").locator(`[id="task-${tasks[0]!.id}"]`)).toHaveCount(1);
      expect(await isTarget(page, firstPageTask!), "the task's row on page 1 is the :target").toBe(true);
    });
  });
}
