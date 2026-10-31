// Accessibility smoke (axe-core, WCAG 2.1 A/AA rules): no serious or critical violation on the sign-in page in both
// languages and on My work. Full audits (keyboard paths, contrast in every state) belong to QA's suites.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

// OI-028: after a client-side navigation (the persona sign-in lands on /my-work without a page load), Next.js removes
// the old <title> and streams the new page's metadata a little later. For 4-129 ms (local probe, 40 runs) the URL is
// already the new one and the document has no <title>; an axe scan started in that gap reports document-title
// (serious). A scan therefore starts only once the document has a non-empty title. A page that never gets a title
// still fails here, so the check is not weakened.
async function seriousViolations(page: Page) {
  await expect(page, "the document has a non-empty <title> before the scan").toHaveTitle(/\S/);
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
