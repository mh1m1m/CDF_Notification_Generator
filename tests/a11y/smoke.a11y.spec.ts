// Accessibility smoke (axe-core, WCAG 2.1 A/AA rules): no serious or critical violation on the sign-in page in both
// languages and on My work. Full audits (keyboard paths, contrast in every state) belong to QA's suites.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

async function seriousViolations(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  return results.violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`);
}

test("sign-in page in Arabic", async ({ page }) => {
  await page.goto("/sign-in");
  expect(await seriousViolations(page)).toEqual([]);
});

test("sign-in page in English", async ({ page }) => {
  await page.goto("/sign-in");
  await page.getByTestId("locale-toggle").click();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  expect(await seriousViolations(page)).toEqual([]);
});

test("My work after persona sign-in", async ({ page }) => {
  await page.goto("/sign-in");
  await page.getByTestId("persona-investigator-beta").click();
  await expect(page).toHaveURL(/\/my-work$/);
  expect(await seriousViolations(page)).toEqual([]);
});
